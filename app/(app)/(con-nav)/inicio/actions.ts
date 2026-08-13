"use server"

/**
 * Server Actions de las notificaciones push (Sprint 6, tarea 6.3).
 *
 * Viven bajo `/inicio` porque es donde está el banner que las dispara
 * (`components/notificaciones/activar-notificaciones.tsx`). Son dos, y las
 * dos operan sobre la CUENTA de quien llama -no sobre un perfil-: una
 * suscripción push pertenece a un navegador de una persona, y por eso las
 * políticas de `push_subscriptions` quedan fuera del modelo familiar
 * (nota ⑰ de `supabase/migrations/20260812220000_rls.sql`).
 *
 * ## Por qué el alta pasa por un RPC y no por un `upsert` directo
 *
 * `registrar_suscripcion_push()`
 * (`supabase/migrations/20260813040000_push_suscripciones.sql`) resuelve el
 * caso del dispositivo compartido: el endpoint es único a nivel global, así
 * que si la madre ya activó las notificaciones en ese teléfono y después
 * entra la hija con su cuenta, el `upsert` del cliente chocaría contra la
 * fila ajena y la activación fallaría para siempre. El RPC reasigna la fila y
 * de paso valida el `profile_id`. La justificación completa -incluido el
 * análisis de qué se está aceptando al reasignar- está en el encabezado de esa
 * migración.
 *
 * ## Por qué la baja NO pasa por un RPC
 *
 * "Desactivar" es un `UPDATE` sobre una fila propia: entra tal cual por
 * `push_subscriptions_update_propias` (`user_id = auth.uid()`). Si el endpoint
 * que llega es de otra cuenta, el `UPDATE` no matchea ninguna fila y no pasa
 * nada — que es exactamente lo que tiene que pasar. Darle a la baja el mismo
 * poder de reasignación que al alta permitiría apagarle las notificaciones a
 * otra persona sin más que conocer su endpoint.
 *
 * Ninguna de las dos audita en `access_logs`: el enum `access_action` no tiene
 * un literal para "activó notificaciones" y registrarlo como cualquier otro
 * mentiría sobre lo que pasó -mismo criterio que la deuda declarada de
 * `subir_documento` en `lib/auditoria.ts`-. Además no son un acceso a datos de
 * salud de nadie: son una preferencia de dispositivo de la propia cuenta.
 */

import { createClient } from "@/lib/supabase/server"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import {
  validarRevocacionPush,
  validarSuscripcionPush,
} from "@/lib/validacion/suscripcion-push.schema"

export interface ResultadoAccionPush {
  ok: boolean
  error: string | null
}

const SIN_SESION = "Tu sesión venció. Volvé a entrar para activar las notificaciones."

const ERROR_GUARDAR =
  "No pudimos activar las notificaciones. Probá de nuevo en unos minutos."

const ERROR_REVOCAR =
  "No pudimos desactivar las notificaciones. Probá de nuevo en unos minutos."

const OK: ResultadoAccionPush = { ok: true, error: null }

/**
 * Guarda (o renueva) la suscripción del navegador que la manda.
 *
 * Recibe un objeto plano en vez de `FormData` porque los datos no vienen de
 * un formulario sino de `pushManager.subscribe()`. Eso NO relaja la
 * validación: `validarSuscripcionPush` corre igual sobre `unknown`, porque una
 * Server Action es un endpoint público y lo que llega puede no haber pasado
 * nunca por nuestro cliente (ver el encabezado de
 * `lib/validacion/suscripcion-push.schema.ts`).
 */
export async function guardarSuscripcion(datos: unknown): Promise<ResultadoAccionPush> {
  const validacion = validarSuscripcionPush(datos)
  if (!validacion.ok) {
    return { ok: false, error: validacion.error }
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { ok: false, error: SIN_SESION }
    }

    // El perfil activo es contexto y sale de la cookie del servidor, NUNCA
    // del cliente: mismo criterio que `crearTurno`. Si no hay perfil activo
    // -recién registrada, todavía sin elegir- la suscripción se guarda igual
    // con `profile_id` nulo, que es un estado válido de la columna.
    const activo = await obtenerPerfilActivo()

    const { error } = await supabase.rpc("registrar_suscripcion_push", {
      p_endpoint: validacion.datos.endpoint,
      p_p256dh: validacion.datos.p256dh,
      p_auth: validacion.datos.auth,
      p_profile_id: activo?.perfil.id,
      p_user_agent: validacion.datos.userAgent,
    })

    if (error) {
      console.error("[push] No se pudo registrar la suscripción:", error)
      return { ok: false, error: ERROR_GUARDAR }
    }

    return OK
  } catch (error) {
    console.error("[push] Fallo inesperado al registrar la suscripción:", error)
    return { ok: false, error: ERROR_GUARDAR }
  }
}

/**
 * Marca como revocada la suscripción de este navegador.
 *
 * La fila NO se borra: `revoked_at` deja constancia de cuándo dejó de estar
 * activa (comentario de la columna en el esquema inicial) y hace que el
 * barrido de envíos la saltee, sin perder la traza de que ese dispositivo
 * existió. Quien llama ya hizo `unsubscribe()` en el navegador: esta acción
 * cierra el círculo del lado de la base.
 */
export async function revocarSuscripcion(datos: unknown): Promise<ResultadoAccionPush> {
  const validacion = validarRevocacionPush(datos)
  if (!validacion.ok) {
    return { ok: false, error: validacion.error }
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { ok: false, error: SIN_SESION }
    }

    // Sin `user_id` explícito: `push_subscriptions_update_propias` ya limita
    // el UPDATE a las filas propias. Cero filas afectadas (endpoint de otra
    // cuenta, o ya revocado) es éxito: el estado final es el que se pedía.
    const { error } = await supabase
      .from("push_subscriptions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("endpoint", validacion.datos.endpoint)
      .is("revoked_at", null)

    if (error) {
      console.error("[push] No se pudo revocar la suscripción:", error)
      return { ok: false, error: ERROR_REVOCAR }
    }

    return OK
  } catch (error) {
    console.error("[push] Fallo inesperado al revocar la suscripción:", error)
    return { ok: false, error: ERROR_REVOCAR }
  }
}
