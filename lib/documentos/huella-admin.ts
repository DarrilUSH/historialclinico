import "server-only"

/**
 * Backfill PEREZOSO de `documents.content_sha256` — EXCLUSIVAMENTE SERVIDOR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. Mismo contrato que
 *      `lib/gmail/mensajes-admin.ts` y `lib/storage-admin.ts`: jamás se
 *      importa desde código cliente, y aborta al cargarse si detecta un
 *      navegador.
 *
 *      **ESTE MÓDULO NO AUTORIZA NADA.** Recibe un `perfilId` y hace lo que le
 *      piden. Quien llama (`ingestarDocumento`, ANTES de esto, exige
 *      `requerirPermiso(perfilId, "upload")`) es responsable de haber
 *      comprobado el permiso. Toda escritura de acá abajo lleva
 *      `.eq("profile_id", perfilId)` además del id de la fila.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué existe: los documentos de ANTES de esta migración no tienen huella
 *
 * `20260818150000_huella_documentos.sql` no hizo backfill en SQL -los bytes
 * viven en Storage, no en la base, y una migración no los puede leer-. Sin
 * este módulo, el cotejo de duplicados (`lib/documentos/huella.ts`) solo
 * encontraría coincidencias entre documentos cargados DESPUÉS de esta
 * migración, y cualquier estudio viejo sería invisible para el cotejo para
 * siempre. En vez de un script one-shot contra producción -que hay que
 * acordarse de correr, y que en Neolo/Supabase Free no tiene dónde vivir
 * corriendo solo-, el backfill se dispara SOLO, la primera vez que hace falta:
 * cuando alguien carga un archivo nuevo a un perfil que todavía tiene
 * documentos sin huella.
 *
 * ## Por qué `service_role` y no el cliente del usuario
 *
 * El UPDATE de `documents` por RLS (`documents_update_administrador`) exige
 * `puede_administrar_perfil` -`can_manage`, no `can_upload`-. Una cuidadora con
 * SOLO `can_upload` sobre un perfil compartido (el caso típico: sube estudios
 * pero no administra la ficha) no podría backfillear las huellas de ESE perfil
 * con su propio cliente, y el cotejo quedaría manco justo para quien más lo
 * usa. `content_sha256` no es un dato que el cliente dicte -es 100% derivado
 * por el servidor, de bytes que YA estaban en el bucket bajo el mismo
 * `profile_id`-, así que escribir con `service_role`, acotado a ESE perfil, es
 * el mismo criterio que ya usa `lib/gmail/mensajes-admin.ts` para
 * `document_id`/`appointment_id`.
 *
 * ## Acotado y best-effort, a propósito
 *
 * - **Tandas chicas** (`LIMITE_BACKFILL_POR_COTEJO`): un perfil con años de
 *   estudios no puede convertir la subida de HOY en una corrida de Storage de
 *   minutos. Lo que sobra se completa solo, un documento más por cada carga
 *   siguiente, hasta que no quede ninguno sin huella.
 * - **Un documento que falla no aborta a los demás.** Si el objeto ya no está
 *   en Storage (huérfano viejo, purgado a mano) o la descarga falla, se loguea
 *   y se sigue con el siguiente. El cotejo de la carga en curso simplemente no
 *   va a encontrar coincidencia contra esa fila -exactamente lo mismo que
 *   pasaría si nunca se hubiera intentado el backfill-, nunca bloquea la
 *   subida nueva.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { calcularHuellaSha256 } from "@/lib/documentos/huella"
import { BUCKETS, descargarObjeto } from "@/lib/storage-admin"
import type { Database } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/documentos/huella-admin.ts se importó desde el navegador. Este módulo usa la " +
      "SERVICE_ROLE_KEY: sólo puede ejecutarse en el servidor.",
  )
}

/**
 * Cuántos documentos sin huella se completan por cada cotejo. Un número chico
 * a propósito: el backfill corre SINCRÓNICO, dentro de la misma request que
 * está subiendo un archivo nuevo, y esa request ya tiene su propio presupuesto
 * de tiempo (Vercel/función serverless). Con esto, un perfil con 200
 * documentos viejos termina de backfillear su historial entero en unas 40
 * cargas -normal a lo largo de meses de uso-, sin que ninguna carga individual
 * se sienta lenta.
 */
export const LIMITE_BACKFILL_POR_COTEJO = 5

let clienteCache: SupabaseClient<Database> | null = null

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
 * Completa `content_sha256` de hasta `LIMITE_BACKFILL_POR_COTEJO` documentos
 * del perfil `perfilId` que todavía no lo tienen.
 *
 * Nunca lanza: es una mejora del cotejo, no un requisito para poder subir. Si
 * la consulta inicial falla (base caída) o algún documento individual no se
 * puede leer de Storage, se loguea con el prefijo `[huella]` -mismo criterio
 * que `[gmail-barrido]`- y la función devuelve igual. Quien llama
 * (`ingestarDocumento`) no necesita `await` con manejo de error propio: total,
 * lo peor que pasa es que el cotejo de esta carga puntual no vea ese documento
 * viejo.
 */
export async function backfillHuellasFaltantes(perfilId: string): Promise<void> {
  const admin = clienteAdmin()

  const { data: pendientes, error: errorSelect } = await admin
    .from("documents")
    .select("id, storage_path")
    .eq("profile_id", perfilId)
    .is("content_sha256", null)
    .limit(LIMITE_BACKFILL_POR_COTEJO)

  if (errorSelect) {
    console.error(`[huella] No se pudo listar documentos sin huella de ${perfilId}:`, errorSelect.message)
    return
  }
  if (!pendientes || pendientes.length === 0) return

  for (const documento of pendientes) {
    try {
      const { datos } = await descargarObjeto(BUCKETS.documentos, documento.storage_path)
      const bytes = new Uint8Array(await datos.arrayBuffer())
      const huella = calcularHuellaSha256(bytes)

      const { error: errorUpdate } = await admin
        .from("documents")
        .update({ content_sha256: huella })
        .eq("id", documento.id)
        .eq("profile_id", perfilId)

      if (errorUpdate) {
        console.error(
          `[huella] No se pudo guardar la huella backfilleada de ${documento.id}:`,
          errorUpdate.message,
        )
      }
    } catch (error) {
      // Objeto purgado, Storage caído, lo que sea: este documento se queda sin
      // huella por ahora y el cotejo sigue sin él. Best-effort, ver encabezado.
      console.error(
        `[huella] No se pudo backfillear la huella de ${documento.id} (${documento.storage_path}):`,
        error instanceof Error ? error.message : error,
      )
    }
  }
}
