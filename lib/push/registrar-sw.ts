/**
 * Registro del service worker — lado NAVEGADOR (Sprint 6, tarea 6.3).
 *
 * Sin service worker no hay Web Push: el handler `push` vive ahí y es lo
 * único que el navegador despierta cuando llega una notificación con la app
 * cerrada.
 *
 * ## Por qué el registro NO va en el layout raíz
 *
 * La tentación es registrar el SW al cargar la aplicación, para "tenerlo
 * listo". No se hace, por dos motivos:
 *
 * 1. **Presupuesto de la primera carga.** Registrar el SW dispara una
 *    descarga y la instalación de un worker que hoy solo sirve para
 *    notificaciones. Quien nunca las active no gana nada a cambio.
 * 2. **Honestidad con el navegador.** El SW aparece recién cuando la persona
 *    pide activar los recordatorios, junto con el permiso. Un worker
 *    registrado "por las dudas" antes de cualquier gesto es exactamente el
 *    patrón que `mobile-ux-patterns` marca (permisos e infraestructura
 *    pedidos en el pageload).
 *
 * Cuando llegue la PWA instalable (Sprint 8/11) el registro sí va a subir al
 * arranque -ahí el SW también sirve el modo offline y el install prompt-, y
 * este módulo pasa a ser el punto único que esa tarea reutiliza.
 */

/** Scope del service worker. Un solo SW para toda la app (ver `public/sw.js`). */
const RUTA_SW = "/sw.js"

/**
 * ¿Este navegador puede recibir Web Push?
 *
 * Los tres chequeos son necesarios y ninguno implica a los otros:
 * - `serviceWorker`: falta en contextos no seguros y en modo incógnito de
 *   algunos navegadores.
 * - `PushManager`: **Safari en iOS solo lo expone si la app fue agregada a la
 *   pantalla de inicio**. En el Safari normal esta comprobación da `false`, y
 *   está bien que dé `false`: ahí no hay push posible.
 * - `Notification`: la API de presentación.
 *
 * Se llama desde un Client Component, así que también contempla el render en
 * servidor (`typeof window === "undefined"`), donde nada de esto existe.
 */
export function haySoportePush(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

/**
 * Registra `/sw.js` y espera a que quede LISTO para usarse.
 *
 * `navigator.serviceWorker.ready` no es decorativo: `register()` resuelve
 * apenas el navegador acepta el archivo, pero `pushManager.subscribe()`
 * necesita un registro ya *activo*. Sin la espera, la primera activación
 * falla con `InvalidStateError` en un navegador limpio y funciona en el
 * segundo intento — el peor tipo de bug, el que no se reproduce cuando lo
 * mirás.
 *
 * Devuelve `null` si el navegador no soporta service workers; propaga el
 * error si el registro falla de verdad (archivo inaccesible, contexto no
 * seguro), para que la interfaz pueda decirlo.
 */
export async function registrarServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!haySoportePush()) {
    return null
  }

  await navigator.serviceWorker.register(RUTA_SW, { scope: "/" })
  return navigator.serviceWorker.ready
}

/**
 * Devuelve el registro existente sin crear uno nuevo.
 *
 * Sirve para la carga inicial de la pantalla: hay que saber si ya hay una
 * suscripción activa SIN instalar un service worker de paso a quien todavía
 * no activó nada.
 */
export async function obtenerRegistroExistente(): Promise<ServiceWorkerRegistration | null> {
  if (!haySoportePush()) {
    return null
  }
  return (await navigator.serviceWorker.getRegistration("/")) ?? null
}
