/**
 * Suscripción Web Push — lado NAVEGADOR (Sprint 6, tarea 6.3).
 *
 * Artefacto `lib/push/suscripcion.ts` del roadmap. Encapsula el diálogo con
 * las APIs del navegador -`Notification.requestPermission`,
 * `pushManager.subscribe`, `unsubscribe`- y devuelve datos planos y ya
 * codificados, listos para mandarle a la Server Action. La interfaz
 * (`components/notificaciones/activar-notificaciones.tsx`) no toca ninguna de
 * esas APIs directamente.
 *
 * ## La regla que este módulo hace cumplir: gesto explícito
 *
 * `pedirPermisoYSuscribir()` **tiene que llamarse desde el manejador de un
 * click**. No es una recomendación de estilo:
 *
 * - Chrome exige activación del usuario para `Notification.requestPermission()`
 *   y, sin ella, en vez del prompt aplica "quiet UI": la persona no ve nada y
 *   nosotros recibimos un `default` indistinguible de "todavía no decidió".
 * - Un permiso `denied` en Chrome **es permanente para el sitio**: no se
 *   vuelve a preguntar nunca. Un prompt disparado en el pageload, que la
 *   persona descarta por reflejo sin leer, quema la única oportunidad de
 *   activar los recordatorios de turno. Recuperarlo exige entrar a la
 *   configuración del sitio en el navegador: nada que se pueda pedir por
 *   teléfono a un adulto mayor.
 *
 * Por eso hay una sola función que pide permiso, tiene el gesto en el nombre,
 * y devuelve `"denegado"` como un estado NORMAL del flujo -no como un error-,
 * con la interfaz obligada a manejarlo.
 */

import { registrarServiceWorker } from "@/lib/push/registrar-sw"

/** Suscripción lista para persistir: strings, sin `ArrayBuffer` ni objetos del navegador. */
export interface DatosSuscripcion {
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string
}

export type ResultadoSuscripcion =
  | { estado: "suscripto"; datos: DatosSuscripcion }
  /** La persona dijo que no (o ya lo había dicho antes). No es un error. */
  | { estado: "denegado" }
  /** Cerró el prompt sin elegir: se puede volver a preguntar más adelante. */
  | { estado: "sin_respuesta" }
  /** Algo falló de verdad (sin soporte, SW inaccesible, Push Service caído). */
  | { estado: "error"; mensaje: string }

/**
 * `applicationServerKey` viaja como bytes crudos de la clave P-256 (65 bytes,
 * formato "uncompressed point"), no como el string base64url que guardamos en
 * el `.env`.
 *
 * El `+`/`/` del padding: la clave viene en base64**url** (`-` y `_`), y
 * `atob` solo entiende base64 clásico. Traducir los dos caracteres y
 * completar el `=` es todo lo que hace falta.
 */
function base64UrlABytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const relleno = "=".repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + relleno).replace(/-/g, "+").replace(/_/g, "/")
  const binario = atob(base64)
  // El `ArrayBuffer` explícito no es decorativo: `applicationServerKey` pide
  // un `BufferSource` respaldado por `ArrayBuffer`, y un `Uint8Array` "a
  // secas" se tipa como `ArrayBufferLike` (que incluye `SharedArrayBuffer`).
  const bytes = new Uint8Array(new ArrayBuffer(binario.length))
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i)
  }
  return bytes
}

/** Inversa: los `ArrayBuffer` que devuelve `getKey()` a base64url, que es como los guarda la base. */
function bytesABase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return ""
  const bytes = new Uint8Array(buffer)
  let binario = ""
  for (const byte of bytes) {
    binario += String.fromCharCode(byte)
  }
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Convierte la suscripción del navegador al formato plano que persiste la base. */
function aDatosPlanos(suscripcion: PushSubscription): DatosSuscripcion {
  return {
    endpoint: suscripcion.endpoint,
    p256dh: bytesABase64Url(suscripcion.getKey("p256dh")),
    auth: bytesABase64Url(suscripcion.getKey("auth")),
    userAgent: navigator.userAgent,
  }
}

/** Estado del permiso, sin pedirlo. `"unsupported"` si el navegador no tiene la API. */
export function estadoPermiso(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported"
  }
  return Notification.permission
}

/**
 * Devuelve la suscripción vigente de este navegador, o `null`.
 *
 * No registra el service worker ni pide permisos: solo mira. Es lo que corre
 * al abrir la pantalla para decidir si mostrar "Activar recordatorios" o
 * "Notificaciones activadas".
 */
export async function obtenerSuscripcionActual(): Promise<DatosSuscripcion | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null
  }
  const registro = await navigator.serviceWorker.getRegistration("/")
  if (!registro) return null

  const suscripcion = await registro.pushManager.getSubscription()
  return suscripcion ? aDatosPlanos(suscripcion) : null
}

/**
 * **Llamar SIEMPRE desde el manejador de un click.** Ver el encabezado.
 *
 * Encadena las tres cosas que hay que hacer, en el único orden que funciona:
 * registrar el service worker, pedir el permiso, y recién entonces
 * suscribirse en el Push Service.
 *
 * Si ya había una suscripción vigente la reutiliza en vez de crear otra: el
 * endpoint sería el mismo de todos modos (mismo navegador + misma clave
 * VAPID) y `subscribe()` con una clave distinta a la ya registrada tira
 * `InvalidStateError`.
 */
export async function pedirPermisoYSuscribir(
  clavePublicaVapid: string,
): Promise<ResultadoSuscripcion> {
  if (!clavePublicaVapid) {
    return {
      estado: "error",
      mensaje:
        "Falta NEXT_PUBLIC_VAPID_PUBLIC_KEY en el entorno. Ver docs/push.md.",
    }
  }

  try {
    const registro = await registrarServiceWorker()
    if (!registro) {
      return {
        estado: "error",
        mensaje: "Este navegador no puede recibir notificaciones.",
      }
    }

    const permiso = await Notification.requestPermission()
    if (permiso === "denied") {
      return { estado: "denegado" }
    }
    if (permiso !== "granted") {
      return { estado: "sin_respuesta" }
    }

    const existente = await registro.pushManager.getSubscription()
    if (existente) {
      return { estado: "suscripto", datos: aDatosPlanos(existente) }
    }

    const suscripcion = await registro.pushManager.subscribe({
      // Obligatorio en Chrome: se compromete a que TODO push produzca una
      // notificación visible. Es la contracara del permiso — nada de trabajo
      // silencioso en segundo plano.
      userVisibleOnly: true,
      applicationServerKey: base64UrlABytes(clavePublicaVapid),
    })

    return { estado: "suscripto", datos: aDatosPlanos(suscripcion) }
  } catch (error) {
    return {
      estado: "error",
      mensaje: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Cancela la suscripción en el Push Service y devuelve el endpoint que estaba
 * activo, para que quien llama pueda marcar la fila de la base.
 *
 * Devuelve `null` si no había nada que cancelar. **El orden importa**: se lee
 * el endpoint ANTES de `unsubscribe()`, porque después el objeto ya no sirve
 * para identificar la fila.
 */
export async function cancelarSuscripcion(): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null
  }
  const registro = await navigator.serviceWorker.getRegistration("/")
  if (!registro) return null

  const suscripcion = await registro.pushManager.getSubscription()
  if (!suscripcion) return null

  const endpoint = suscripcion.endpoint
  await suscripcion.unsubscribe()
  return endpoint
}
