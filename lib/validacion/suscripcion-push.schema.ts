/**
 * Schema Zod de entrada de las Server Actions `guardarSuscripcion` y
 * `revocarSuscripcion` (`app/(app)/(con-nav)/inicio/actions.ts`).
 *
 * ## Por qué esto no es paranoia de más
 *
 * Una Server Action es un endpoint HTTP público: el `DatosSuscripcion` que
 * arma `lib/push/suscripcion.ts` a partir de las APIs del navegador es lo que
 * llega en el caso normal, pero cualquiera puede postear otra cosa. Y lo que
 * se guarda acá no es un dato inerte: el `endpoint` es la URL a la que el
 * servidor va a hacer un POST en cada barrido de recordatorios, para siempre.
 * Aceptar cualquier string es aceptar que alguien nos convierta en un cliente
 * HTTP que golpea el host que él elija (SSRF de baja intensidad pero
 * perfectamente real, y encima con nuestra firma VAPID en el header).
 *
 * De ahí las tres reglas de `endpoint`:
 * 1. **`https://` obligatorio** — mismo CHECK que la base
 *    (`push_subscriptions_endpoint_es_https`). Las dos capas dicen lo mismo a
 *    propósito.
 * 2. **URL parseable, sin credenciales embebidas** (`https://user:pass@host`)
 *    y con host no vacío.
 * 3. **Largo acotado.** Los endpoints reales rondan los 150-250 caracteres;
 *    2048 es techo de sobra y evita que la columna `text` reciba un payload.
 *
 * `p256dh` y `auth` se validan como base64url del largo correcto: 65 bytes de
 * punto P-256 sin comprimir (87-88 caracteres) y 16 bytes de secreto (22-24).
 * Un valor mal formado no se detectaría hasta el primer envío -y ahí fallaría
 * el cifrado con un error críptico dentro de `web-push`-, así que se corta
 * acá, donde todavía se le puede decir algo útil a la persona.
 *
 * **No se valida contra una lista de hosts conocidos** (`fcm.googleapis.com`,
 * `updates.push.services.mozilla.com`, `*.notify.windows.com`). Sería la
 * defensa más fuerte, pero cada navegador nuevo o cada cambio de dominio de
 * un Push Service existente rompería las activaciones en silencio y sin que
 * nadie pueda arreglarlo desde la aplicación. La restricción a https + host
 * válido es el punto donde el costo de mantenimiento todavía se paga solo.
 */

import { z } from "zod"

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Los endpoints reales rondan 150-250 caracteres. */
export const MAX_ENDPOINT = 2048

const MENSAJE_ENDPOINT =
  "La suscripción del navegador no es válida. Probá desactivar y volver a activar las notificaciones."

const MENSAJE_CLAVES =
  "El navegador no entregó las claves de cifrado de la notificación. Probá de nuevo."

/** base64url: alfabeto A-Z a-z 0-9 - _ y sin `=` de relleno. */
const PATRON_BASE64URL = /^[A-Za-z0-9_-]+$/

const endpoint = z
  .string({ message: MENSAJE_ENDPOINT })
  .trim()
  .min(1, MENSAJE_ENDPOINT)
  .max(MAX_ENDPOINT, MENSAJE_ENDPOINT)
  .refine((valor) => {
    if (!valor.toLowerCase().startsWith("https://")) {
      return false
    }
    try {
      const url = new URL(valor)
      return url.hostname.length > 0 && url.username === "" && url.password === ""
    } catch {
      return false
    }
  }, MENSAJE_ENDPOINT)

export const schemaSuscripcionPush = z.object({
  endpoint,

  // 65 bytes en base64url = 87 caracteres (88 con relleno, que se acepta por
  // tolerancia aunque `lib/push/suscripcion.ts` no lo genere).
  p256dh: z
    .string({ message: MENSAJE_CLAVES })
    .trim()
    .min(80, MENSAJE_CLAVES)
    .max(100, MENSAJE_CLAVES)
    .regex(PATRON_BASE64URL, MENSAJE_CLAVES),

  // 16 bytes en base64url = 22 caracteres.
  auth: z
    .string({ message: MENSAJE_CLAVES })
    .trim()
    .min(16, MENSAJE_CLAVES)
    .max(40, MENSAJE_CLAVES)
    .regex(PATRON_BASE64URL, MENSAJE_CLAVES),

  userAgent: z
    .string()
    .trim()
    .max(512)
    .optional()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined)),

  /**
   * Perfil activo al momento de suscribirse. Es CONTEXTO, no autorización: el
   * RPC `registrar_suscripcion_push` lo descarta si el llamador no puede ver
   * ese perfil, y los envíos resuelven destinatarios por `user_id` +
   * `family_permissions`, nunca por este campo.
   */
  perfilId: z
    .string()
    .trim()
    .regex(PATRON_UUID)
    .optional()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined)),
})

export type SuscripcionPushValidada = z.infer<typeof schemaSuscripcionPush>

export function validarSuscripcionPush(
  data: unknown,
): { ok: true; datos: SuscripcionPushValidada } | { ok: false; error: string } {
  const resultado = schemaSuscripcionPush.safeParse(data)
  if (resultado.success) {
    return { ok: true, datos: resultado.data }
  }
  return {
    ok: false,
    error: resultado.error.issues[0]?.message ?? "Los datos de la suscripción no son válidos.",
  }
}

export const schemaRevocacionPush = z.object({ endpoint })

export function validarRevocacionPush(
  data: unknown,
): { ok: true; datos: { endpoint: string } } | { ok: false; error: string } {
  const resultado = schemaRevocacionPush.safeParse(data)
  if (resultado.success) {
    return { ok: true, datos: resultado.data }
  }
  return {
    ok: false,
    error: resultado.error.issues[0]?.message ?? "Los datos de la suscripción no son válidos.",
  }
}
