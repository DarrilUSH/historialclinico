import "server-only"

/**
 * Las dos consultas que la pasada automática necesita hacer SIN sesión
 * (Sprint 17, auto-carga sin dudas).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. Mismo contrato que
 *      `lib/gmail/mensajes-admin.ts`: jamás desde el navegador, y ninguna
 *      función autoriza nada — las dos están acotadas por `user_id` o por
 *      `profile_id`, que quien llama ya resolvió desde la configuración de la
 *      conexión (nunca desde un formulario).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué no se reusan `lib/documentos/huella.ts` ni `lib/gmail/mensajes.ts`
 *
 * Las dos leen con el cliente del USUARIO y dejan que RLS decida, que es la
 * regla del proyecto y está bien para todo lo que dispara una persona. El
 * barrido automático lo dispara `pg_cron`: no hay sesión que RLS pueda
 * evaluar, así que esas funciones devolverían cero filas siempre —y cero filas
 * en el cotejo de duplicados significa "no hay duplicado", que es justo la
 * respuesta equivocada—. Un cotejo que falla en silencio hacia el lado
 * permisivo es peor que no tener cotejo.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { CorreoParaDeteccion } from "@/lib/gmail/deteccion-duplicados"
import type { AdjuntoGmail } from "@/lib/gmail/mensaje"
import type { Database, Json } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/gmail/pendientes-admin.ts se importó desde el navegador. Este módulo usa la " +
      "SERVICE_ROLE_KEY: sólo puede ejecutarse en el servidor.",
  )
}

/**
 * Tope de correos pendientes que se miran para la marca de "posible
 * duplicado". El mismo criterio que `LIMITE_PENDIENTES` de
 * `lib/gmail/mensajes.ts`: es una ayuda, no un censo.
 */
const LIMITE_PENDIENTES = 60

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
 * ¿El perfil ya tiene un documento con esta huella?
 *
 * Es el mismo cotejo que `buscarDuplicadoPorHuella` (`lib/documentos/huella.ts`)
 * pero devolviendo solo el booleano: acá nadie va a ver una franja con el
 * título del otro estudio, porque no hay nadie mirando. La respuesta se usa
 * para NO cargar y mandar el correo a revisión, donde el cotejo completo
 * -con su franja y sus dos botones- corre igual cuando la persona toca
 * "Revisar este estudio".
 *
 * **Ante un error, devuelve `true` (o sea: "hay duplicado, no cargues").** Es
 * al revés de lo habitual y es a propósito: si la base no contesta, la
 * respuesta segura no es "seguí adelante y cargá", es "esto va a revisión
 * humana".
 */
export async function huellaYaCargadaEnPerfil(perfilId: string, huella: string): Promise<boolean> {
  const { data, error } = await clienteAdmin()
    .from("documents")
    .select("id")
    .eq("profile_id", perfilId)
    .eq("content_sha256", huella)
    .limit(1)

  if (error) {
    console.error(
      `[gmail-auto] no se pudo cotejar la huella en el perfil ${perfilId} (se asume duplicado):`,
      error.message,
    )
    return true
  }

  return (data ?? []).length > 0
}

function adjuntosDesdeJson(valor: Json | null): AdjuntoGmail[] {
  return Array.isArray(valor) ? (valor as unknown as AdjuntoGmail[]) : []
}

/**
 * Los OTROS correos pendientes de la cuenta, con sus adjuntos, para alimentar
 * `emparejarPorNombreYTamano`.
 *
 * Se excluye el correo en curso porque quien llama lo agrega él mismo a la
 * lista: si viniera de las dos fuentes, se emparejaría consigo mismo y todo
 * adjunto quedaría marcado como posible duplicado de sí mismo.
 *
 * Ante un error devuelve lista vacía: la marca de "posible duplicado" es una
 * heurística por metadatos que solo AGREGA dudas. Perderla no hace que entre
 * nada indebido —el cotejo por contenido (`huellaYaCargadaEnPerfil`), que sí
 * es la barrera real, corre igual—.
 */
export async function otrosPendientesConAdjuntos(
  userId: string,
  exceptoCorreoId: string,
): Promise<CorreoParaDeteccion[]> {
  const { data, error } = await clienteAdmin()
    .from("gmail_messages")
    .select("id, attachments")
    .eq("user_id", userId)
    .eq("status", "pendiente_revision")
    .neq("id", exceptoCorreoId)
    .limit(LIMITE_PENDIENTES)

  if (error) {
    console.error("[gmail-auto] no se pudieron leer los otros correos pendientes:", error.message)
    return []
  }

  return (data ?? []).map((fila) => ({
    id: fila.id,
    adjuntos: adjuntosDesdeJson(fila.attachments).map((adjunto) => ({
      attachmentId: adjunto.attachmentId,
      filename: adjunto.filename,
      size: adjunto.size,
      apto: adjunto.apto,
    })),
  }))
}
