import "server-only"

/**
 * Consentimiento legal (Ley 25.326, Sprint 12, tarea 12.1).
 *
 * `consents` (`supabase/migrations/20260814130000_consents.sql`) es el
 * registro probatorio de que una CUENTA aceptó un documento legal en un
 * momento dado, con qué versión de ese documento y desde qué IP. Es
 * append-only -mismo tratamiento que `access_logs`-, porque su valor
 * probatorio depende de que nadie, ni siquiera su propio titular, pueda
 * reescribir lo que ya se firmó.
 *
 * ## El consentimiento del ALTA no se registra desde acá
 *
 * Hasta el hotfix de `supabase/migrations/20260814140000_alta_de_cuenta.sql`,
 * este archivo exportaba además `registrarConsentimientosDeAlta`, que
 * insertaba las filas de `privacidad` y `terminos` desde `registrarse`
 * (`app/(auth)/actions.ts`) con la sesión que devolvía `signUp`. En producción
 * esa sesión NO existe —la confirmación por correo está encendida y la sesión
 * llega recién al confirmar—, así que las dos filas nunca se escribían: la
 * cuenta quedaba creada, sin perfil y sin prueba de consentimiento.
 *
 * Ese registro pasó a ser responsabilidad de la base, en el trigger
 * `auth_users_crear_perfil_de_cuenta`, que corre en la misma transacción que
 * el alta y lee la versión aceptada de `auth.users.raw_user_meta_data`. Lo
 * único que sigue viniendo de este archivo para ese flujo es la constante
 * `VERSION_LEGALES`, que `registrarse` manda en `options.data`.
 *
 * ## Lo que sí queda acá: el consentimiento de acceso familiar
 *
 * `registrarConsentimiento` cubre el otorgamiento de acceso familiar
 * (`invitarFamiliar`, `app/(app)/(con-nav)/familia/actions.ts`), donde la fila
 * de `consents` es la CONSTANCIA de una acción que ya ocurrió (el `INSERT` en
 * `family_permissions` ya se hizo): es auditoría, no condición. Por eso
 * **nunca lanza** -mismo contrato que `registrarAcceso` en `lib/auditoria.ts`-
 * y un fallo de red no debe dejar a quien otorgó el acceso sin saber si el
 * otorgamiento en sí funcionó.
 *
 * Escribe con el cliente del USUARIO, nunca con `service_role`: la política
 * `consents_insert_propio` exige `user_id = auth.uid()`, así que quien decide
 * si la fila entra es RLS, no este archivo. (El trigger del alta es la única
 * excepción posible y por eso vive en la base, como `SECURITY DEFINER`, y no
 * como una clave de servicio en manos de la aplicación web.)
 */

import { headers } from "next/headers"

import { normalizarIp } from "@/lib/auditoria"
import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"

/**
 * Versión vigente de los documentos legales. Cambia cuando el TEXTO de
 * Privacidad o de Términos cambia de forma sustancial -no en cada typo-: es
 * lo que permite, más adelante, saber si el consentimiento que guarda una
 * cuenta corresponde a la versión vigente o a una anterior.
 *
 * Formato `AAAA-MM-DD-vN`: fecha de publicación + número de versión de ese
 * día, para poder publicar más de una revisión el mismo día sin ambigüedad.
 *
 * **Tiene un espejo en SQL.** `completar_alta_de_cuenta`
 * (`supabase/migrations/20260814140000_alta_de_cuenta.sql`) repite este valor
 * como constante, para poder fechar el consentimiento de una cuenta que no
 * nació del formulario de registro y por lo tanto no trae `legales_version` en
 * su metadata. La base no puede importar TypeScript; al cambiar esta constante
 * hay que escribir una migración que actualice la otra.
 * `tests/unit/alta-de-cuenta.test.ts` falla si las dos se separan.
 */
export const VERSION_LEGALES = "2026-08-14-v1"

/**
 * Los tres documentos que este proyecto hace firmar, calcados 1:1 del CHECK
 * `consents_document_valido` de la migración. `'privacidad'` y `'terminos'`
 * se firman juntos al registrarse; `'acceso_familiar'` se firma cada vez que
 * una cuenta otorga acceso sobre un perfil a otra persona
 * (`docs/modelo-permisos.md` §4.4).
 */
export type DocumentoLegal = "privacidad" | "terminos" | "acceso_familiar"

/** IP del cliente actual, o `null` si no hay ninguna cabecera utilizable. Ver `normalizarIp`. */
async function obtenerIpActual(): Promise<string | null> {
  const encabezados = await headers()
  return (
    normalizarIp(encabezados.get("x-forwarded-for")) ??
    normalizarIp(encabezados.get("x-real-ip"))
  )
}

/**
 * Registra el consentimiento de UN documento puntual. Hoy el único llamador
 * es `invitarFamiliar` con `documento: "acceso_familiar"`.
 *
 * **No lanza nunca** -ver el porqué en el encabezado del archivo-: cualquier
 * error se deja en la consola del servidor con el prefijo estable
 * `[legales]`, igual que `[auditoria]` en `registrarAcceso`.
 */
export async function registrarConsentimiento(
  supabase: ClienteSupabaseServidor,
  userId: string,
  documento: DocumentoLegal,
): Promise<void> {
  try {
    const ip = await obtenerIpActual()

    const { error } = await supabase.from("consents").insert({
      user_id: userId,
      document: documento,
      version: VERSION_LEGALES,
      ip,
    })

    if (error) {
      console.error(`[legales] No se pudo registrar el consentimiento "${documento}": ${error.message}`)
    }
  } catch (error) {
    console.error(`[legales] Fallo al registrar el consentimiento "${documento}":`, error)
  }
}
