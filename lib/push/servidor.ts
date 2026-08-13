import "server-only"

/**
 * Envío de Web Push — EXCLUSIVAMENTE SERVIDOR (Sprint 6, tarea 6.3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO LEE `VAPID_PRIVATE_KEY` Y USA LA `SUPABASE_SERVICE_ROLE_KEY`.
 *      Jamás se importa desde un Client Component, un hook, ni nada que
 *      termine en el bundle del navegador. Mismo contrato que
 *      `lib/storage-admin.ts`, y por el mismo motivo: la service role key
 *      tiene BYPASSRLS.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Qué es un envío Web Push, en una línea
 *
 * Un POST HTTP al `endpoint` que el navegador nos dio, firmado con la clave
 * VAPID privada (para que el Push Service sepa que somos la misma aplicación
 * que la persona autorizó) y con el cuerpo cifrado `aes128gcm` (RFC 8291) con
 * las claves `p256dh`/`auth` de ESE navegador. El Push Service -FCM para
 * Chrome/Android, autopush para Firefox- no puede leer el contenido: solo lo
 * enruta. Es gratis y no requiere ninguna cuenta ni SDK propietario.
 *
 * ## Por qué `web-push` y no cifrado a mano
 *
 * `web-push` (MIT, el paquete de referencia del ecosistema) implementa
 * ECDH P-256 + HKDF + AES-128-GCM y el JWT ES256 de VAPID. Reimplementar eso
 * en este proyecto sería reescribir criptografía para no ganar nada: el
 * objetivo de esta tarea es infraestructura CONFIABLE, y el valor propio está
 * en lo de abajo -qué se hace con cada código de respuesta-, no en repetir un
 * RFC.
 *
 * ## La parte que sí es decisión de este proyecto: qué significa cada error
 *
 * | Respuesta del Push Service | Qué significa | Qué hacemos |
 * |---|---|---|
 * | 201 / 200 | Aceptado para entrega | nada |
 * | **404 / 410** | La suscripción **murió** (el navegador la revocó, se desinstaló la app, se limpiaron los datos del sitio) | `revoked_at = now()`: no se vuelve a intentar nunca |
 * | 429 | Estamos mandando demasiado rápido | log y seguir; el próximo ciclo reintenta |
 * | 5xx | El Push Service está caído o con problemas | log y seguir; el próximo ciclo reintenta |
 * | 400 / 403 | Payload inválido, o **la clave VAPID no coincide** con la que autorizó la suscripción | log fuerte: es un bug de configuración nuestro, no del usuario |
 *
 * La diferencia entre la fila 2 y las filas 3-4 es el corazón del módulo. Un
 * 410 tratado como error transitorio deja la base llenándose de endpoints
 * muertos que se reintentan para siempre; un 5xx tratado como muerte
 * desuscribe a gente que no hizo nada, y esa gente se entera cuando NO le
 * llega el recordatorio del turno. Por eso la clasificación es explícita y
 * está cubierta por tests (`tests/unit/push-servidor.test.ts`).
 *
 * **Un envío nunca lanza.** `enviarPush` devuelve un `ResultadoEnvio`
 * discriminado. El criterio es el mismo que documenta `lib/auditoria.ts`: el
 * fallo de una notificación no puede tumbar el barrido que le está mandando a
 * otras diez personas, ni la Server Action que la disparó.
 *
 * ## Contrato con las tareas que vienen
 *
 * La Edge Function de recordatorios (6.4), las alertas de medicación
 * (Sprint 7) y las de presión (Sprint 9) consumen `enviarPushAUsuario()`. No
 * deben hablar con `web-push` ni con la tabla directamente: toda la política
 * de bajas vive acá, en un solo lugar.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import webpush, { WebPushError } from "web-push"

import type { Database } from "@/types/database.types"

/** Contenido de una notificación. Lo lee `public/sw.js` en el handler `push`. */
export interface PayloadPush {
  /** Título en negrita. Obligatorio: una notificación sin título no se muestra. */
  titulo: string
  /** Cuerpo del mensaje. */
  cuerpo: string
  /**
   * Ruta que se abre al tocar la notificación. Relativa a la app
   * (`/turnos/abc-123`). Default: `/inicio`.
   */
  url?: string
  /**
   * Agrupador. Dos notificaciones con el mismo `tag` se REEMPLAZAN en vez de
   * apilarse: es la antiduplicación del lado del dispositivo. Convención del
   * proyecto: `turno-{id}-{ventana}`, `medicacion-{id}`, `presion-{id}`.
   */
  tag?: string
}

/** Los datos de una suscripción que hacen falta para enviarle algo. */
export interface SuscripcionPush {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export type ResultadoEnvio =
  /** El Push Service aceptó el mensaje (no garantiza que se haya mostrado). */
  | { estado: "entregado"; suscripcionId: string }
  /** 404/410: la suscripción murió y quedó marcada con `revoked_at`. */
  | { estado: "revocada"; suscripcionId: string; codigo: number }
  /** 429/5xx: transitorio, tiene sentido reintentar en el próximo ciclo. */
  | { estado: "reintentable"; suscripcionId: string; codigo: number | null; mensaje: string }
  /** 400/403 y cualquier otra cosa: no reintentar, hay algo mal de nuestro lado. */
  | { estado: "fallido"; suscripcionId: string; codigo: number | null; mensaje: string }

/**
 * Tope de payload. El récord `aes128gcm` admite 4096 bytes, de los cuales el
 * cifrado se come 103 (16 de tag + 86 de cabecera + 1 de padding mínimo).
 * 3500 deja margen cómodo y es más chico que cualquier notificación sensata:
 * si un payload lo supera es un bug de quien lo armó -metió un resumen
 * clínico entero en el cuerpo-, no un caso a soportar.
 */
export const MAX_PAYLOAD_BYTES = 3500

/** Ruta que se abre si el payload no trae `url`. */
export const URL_POR_DEFECTO = "/inicio"

/**
 * 24 horas. Si el teléfono estuvo apagado más que eso, el recordatorio del
 * turno ya no sirve de nada y es mejor que el Push Service lo descarte a que
 * aparezca a destiempo. (`TTL: 0` sería "entregá ahora o tirá", demasiado
 * frágil para un celular que duerme.)
 */
const TTL_SEGUNDOS = 24 * 60 * 60

/** Nombre estable para grepear los logs del servidor. */
const PREFIJO = "[push]"

// -----------------------------------------------------------------------------
// Funciones puras (testeadas sin red ni base)
// -----------------------------------------------------------------------------

/**
 * Serializa y valida el payload que va cifrado en el push.
 *
 * Lanza -a diferencia del envío- porque un payload inválido es un error de
 * programación del llamador, detectable en desarrollo, y no un fallo de
 * entrega que haya que degradar con elegancia.
 */
export function serializarPayload(payload: PayloadPush): string {
  const titulo = payload.titulo?.trim()
  if (!titulo) {
    throw new Error("El payload de un push necesita un título no vacío.")
  }

  const url = payload.url?.trim() || URL_POR_DEFECTO
  if (!url.startsWith("/")) {
    // Una URL absoluta acá permitiría que un push abra un origen ajeno. El
    // service worker igual la resuelve contra su propio scope, pero se corta
    // en el origen del dato en vez de confiar en el consumidor.
    throw new Error(
      `La url de un push tiene que ser una ruta relativa de la app (recibido: "${url}").`,
    )
  }

  const json = JSON.stringify({
    titulo,
    cuerpo: payload.cuerpo?.trim() ?? "",
    url,
    ...(payload.tag?.trim() ? { tag: payload.tag.trim() } : {}),
  })

  const bytes = Buffer.byteLength(json, "utf8")
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `El payload del push pesa ${bytes} bytes y el máximo es ${MAX_PAYLOAD_BYTES}. ` +
        "Acortá el cuerpo: una notificación es un titular, no un informe.",
    )
  }

  return json
}

export type ClasificacionEnvio = "revocada" | "reintentable" | "fallido"

/**
 * Traduce el código HTTP del Push Service a lo que hay que hacer con la
 * suscripción. Ver la tabla del encabezado del módulo.
 *
 * Sin código (timeout, DNS, socket cortado) cuenta como reintentable: no hubo
 * respuesta, así que no hay ninguna evidencia de que la suscripción esté
 * muerta.
 */
export function clasificarErrorPush(codigo: number | null | undefined): ClasificacionEnvio {
  if (codigo === 404 || codigo === 410) {
    return "revocada"
  }
  if (codigo === 429 || (typeof codigo === "number" && codigo >= 500 && codigo <= 599)) {
    return "reintentable"
  }
  if (codigo === null || codigo === undefined) {
    return "reintentable"
  }
  return "fallido"
}

// -----------------------------------------------------------------------------
// Configuración y clientes (perezosos: importar el módulo nunca debe explotar)
// -----------------------------------------------------------------------------

let vapidConfigurado = false

/**
 * Configura `web-push` con el par VAPID del entorno.
 *
 * Es perezoso a propósito: si se hiciera al importar, `next build` fallaría
 * en cualquier entorno sin las variables cargadas (CI, un `build` de
 * verificación) aunque no se mande un solo push. Falla recién cuando alguien
 * intenta enviar de verdad, que es cuando la falta de claves es un problema.
 */
function configurarVapid(): void {
  if (vapidConfigurado) return

  const subject = process.env.VAPID_SUBJECT
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY

  const faltantes = [
    !subject && "VAPID_SUBJECT",
    !publicKey && "VAPID_PUBLIC_KEY",
    !privateKey && "VAPID_PRIVATE_KEY",
  ].filter(Boolean)

  if (faltantes.length > 0) {
    throw new Error(
      `Faltan variables de entorno para Web Push: ${faltantes.join(", ")}. ` +
        "Generá el par con `node scripts/generar-vapid.mjs` (ver docs/push.md).",
    )
  }

  webpush.setVapidDetails(subject!, publicKey!, privateKey!)
  vapidConfigurado = true
}

let clienteCache: SupabaseClient<Database> | null = null

/**
 * Cliente con `service_role` para marcar bajas.
 *
 * Es la única forma correcta de hacerlo: la baja por 410 la decide el Push
 * Service durante un barrido de servidor donde no hay ninguna sesión de
 * usuario, así que no hay JWT con el que pasar por
 * `push_subscriptions_update_propias`. El alcance de lo que este cliente
 * escribe es una sola columna de una sola tabla, siempre filtrando por el
 * `id` de la fila que acaba de fallar.
 */
function clienteAdmin(): SupabaseClient<Database> {
  if (clienteCache) return clienteCache

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error("Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL.")
  if (!serviceRoleKey) {
    throw new Error("Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY.")
  }

  clienteCache = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return clienteCache
}

/**
 * Marca una suscripción como revocada. Idempotente: `revoked_at` no se pisa
 * si ya estaba puesto, para conservar el momento REAL de la baja.
 */
export async function marcarSuscripcionRevocada(suscripcionId: string): Promise<void> {
  try {
    const { error } = await clienteAdmin()
      .from("push_subscriptions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", suscripcionId)
      .is("revoked_at", null)

    if (error) {
      console.error(
        `${PREFIJO} No se pudo marcar como revocada la suscripción ${suscripcionId}: ${error.message}`,
      )
    }
  } catch (error) {
    console.error(`${PREFIJO} Fallo al marcar revocada ${suscripcionId}:`, error)
  }
}

// -----------------------------------------------------------------------------
// Envío
// -----------------------------------------------------------------------------

/**
 * Manda una notificación a UNA suscripción.
 *
 * **No lanza por errores de entrega**: devuelve un `ResultadoEnvio`. Sí puede
 * lanzar si el payload es inválido (bug del llamador) o si faltan las claves
 * VAPID (bug de configuración) — las dos cosas que conviene que exploten
 * fuerte y temprano en desarrollo.
 */
export async function enviarPush(
  suscripcion: SuscripcionPush,
  payload: PayloadPush,
): Promise<ResultadoEnvio> {
  const cuerpo = serializarPayload(payload)
  configurarVapid()

  try {
    await webpush.sendNotification(
      {
        endpoint: suscripcion.endpoint,
        keys: { p256dh: suscripcion.p256dh, auth: suscripcion.auth },
      },
      cuerpo,
      { TTL: TTL_SEGUNDOS, urgency: "normal" },
    )
    return { estado: "entregado", suscripcionId: suscripcion.id }
  } catch (error) {
    const codigo = error instanceof WebPushError ? error.statusCode : null
    const mensaje = error instanceof Error ? error.message : String(error)
    const clasificacion = clasificarErrorPush(codigo)

    if (clasificacion === "revocada") {
      // La suscripción murió: se marca y NO se reintenta nunca más.
      await marcarSuscripcionRevocada(suscripcion.id)
      console.warn(
        `${PREFIJO} Suscripción ${suscripcion.id} dada de baja por el Push Service (${codigo}). Marcada como revocada.`,
      )
      return { estado: "revocada", suscripcionId: suscripcion.id, codigo: codigo as number }
    }

    if (clasificacion === "reintentable") {
      console.warn(
        `${PREFIJO} Envío transitoriamente fallido a ${suscripcion.id} (${codigo ?? "sin código"}): ${mensaje}`,
      )
      return { estado: "reintentable", suscripcionId: suscripcion.id, codigo, mensaje }
    }

    // 400 (payload/cabecera mal armados) y 403 (clave VAPID que no coincide
    // con la que autorizó la suscripción) son bugs NUESTROS y hay que verlos.
    console.error(
      `${PREFIJO} Envío rechazado a ${suscripcion.id} (${codigo}): ${mensaje}. ` +
        "Un 403 típicamente significa que las claves VAPID cambiaron después de que esta persona se suscribió.",
    )
    return { estado: "fallido", suscripcionId: suscripcion.id, codigo, mensaje }
  }
}

/**
 * Manda la misma notificación a TODAS las suscripciones activas de una
 * cuenta (una persona puede tener el teléfono y la computadora).
 *
 * Punto de entrada de los envíos programados: recordatorios de turnos (6.4),
 * alertas de medicación (Sprint 7) y de presión (Sprint 9). Lee con
 * `service_role` porque corre sin sesión; quien llama es responsable de haber
 * resuelto que a ESE `userId` le corresponde recibir ESE aviso.
 *
 * Los envíos van en paralelo: son POSTs independientes a un servicio externo
 * y serializarlos multiplicaría la latencia del barrido por la cantidad de
 * dispositivos sin ninguna ganancia.
 */
export async function enviarPushAUsuario(
  userId: string,
  payload: PayloadPush,
): Promise<ResultadoEnvio[]> {
  const { data, error } = await clienteAdmin()
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId)
    .is("revoked_at", null)

  if (error) {
    console.error(
      `${PREFIJO} No se pudieron leer las suscripciones de ${userId}: ${error.message}`,
    )
    return []
  }

  if (!data || data.length === 0) {
    return []
  }

  return Promise.all(data.map((suscripcion) => enviarPush(suscripcion, payload)))
}
