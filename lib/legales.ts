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
 * ## Dos funciones con dos contratos de error distintos
 *
 * Calcado del criterio que deja escrito `lib/auditoria.ts`: *"si algún día
 * aparece una acción cuya auditoría sea condición de la operación misma,
 * esa acción necesita su propia función que SÍ propague el error"*. Acá
 * aparecen las dos mitades de esa frase, para dos casos reales del roadmap:
 *
 * - **`registrarConsentimientosDeAlta`** — el registro (`registrarse`,
 *   `app/(auth)/actions.ts`). El consentimiento a Privacidad y Términos ES
 *   la base legal que habilita crear la cuenta (art. 5 de la Ley 25.326:
 *   consentimiento libre, expreso e informado). Si el `INSERT` de estas dos
 *   filas falla, la cuenta queda creada sin prueba de haber consentido, así
 *   que la función **propaga el error** y `registrarse` se lo muestra a la
 *   persona en vez de dejarlo pasar en silencio.
 * - **`registrarConsentimiento`** — el otorgamiento de acceso familiar
 *   (`invitarFamiliar`, `app/(app)/(con-nav)/familia/actions.ts`). Acá la
 *   fila de `consents` es la CONSTANCIA de una acción que ya ocurrió (el
 *   `INSERT` en `family_permissions` ya se hizo): es auditoría, no
 *   condición. Por eso **nunca lanza** -mismo contrato que
 *   `registrarAcceso`- y un fallo de red no debe dejar a quien otorgó el
 *   acceso sin saber si el otorgamiento en sí funcionó.
 *
 * Las dos escriben con el cliente del USUARIO, nunca con `service_role`: la
 * política `consents_insert_propio` exige `user_id = auth.uid()`, así que
 * quien decide si la fila entra es RLS, no este archivo.
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

const DOCUMENTOS_DE_ALTA: readonly DocumentoLegal[] = ["privacidad", "terminos"]

/** IP del cliente actual, o `null` si no hay ninguna cabecera utilizable. Ver `normalizarIp`. */
async function obtenerIpActual(): Promise<string | null> {
  const encabezados = await headers()
  return (
    normalizarIp(encabezados.get("x-forwarded-for")) ??
    normalizarIp(encabezados.get("x-real-ip"))
  )
}

export interface ResultadoConsentimiento {
  error: string | null
}

/**
 * Registra, en una sola escritura, el consentimiento a Privacidad Y
 * Términos que exige completar el registro (criterio de aceptación del
 * ROADMAP, Sprint 12 tarea 12.1). Se llama SOLO después de que `profiles`
 * quedó insertado con éxito, con el mismo cliente ya autenticado por
 * `signUp`.
 *
 * **Propaga el error** -ver el porqué en el encabezado del archivo-.
 */
export async function registrarConsentimientosDeAlta(
  supabase: ClienteSupabaseServidor,
  userId: string,
): Promise<ResultadoConsentimiento> {
  const ip = await obtenerIpActual()

  const { error } = await supabase.from("consents").insert(
    DOCUMENTOS_DE_ALTA.map((documento) => ({
      user_id: userId,
      document: documento,
      version: VERSION_LEGALES,
      ip,
    })),
  )

  if (error) {
    return { error: error.message }
  }
  return { error: null }
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
