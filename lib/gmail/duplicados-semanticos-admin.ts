import "server-only"

/**
 * Cotejo de duplicados semánticos (Capas 2 y 3,
 * `lib/documentos/duplicados-semanticos.ts`) para la carga AUTOMÁTICA de
 * Gmail — EXCLUSIVAMENTE SERVIDOR (Sprint 17, extendido por el hotfix de
 * duplicados semánticos).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. Mismo contrato y mismo motivo que
 *      `lib/gmail/pendientes-admin.ts`: el barrido automático lo dispara
 *      `pg_cron`, sin sesión que RLS pueda evaluar. Acotado por `perfilId`,
 *      que quien llama (`lib/gmail/auto-carga.ts`) ya resolvió desde la
 *      configuración de la conexión -nunca desde un formulario-.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué existe un módulo aparte de `lib/documentos/duplicados-semanticos-consulta.ts`
 *
 * Esa consulta va con el cliente del USUARIO y excluye "el propio documento
 * que se está revisando" -tiene sentido ahí porque el documento YA se creó
 * antes de que exista la extracción de Gemini (ver el encabezado de
 * `lib/documentos/ingesta.ts`)-. En la carga automática el ORDEN es al revés:
 * la compuerta (`lib/gmail/auto-ingesta.ts`) tiene que decidir SI cargar ANTES
 * de que el documento exista, así que no hay ningún id que excluir -todo
 * documento confirmado del perfil es candidato-. Dos módulos con la firma que
 * cada caller necesita, en vez de una función con un parámetro opcional que
 * solo uno de los dos usa.
 *
 * ## Qué pasa si la consulta falla
 *
 * **Se trata como "hay duplicado, no cargues"**, mismo criterio -y mismo
 * motivo- que `huellaYaCargadaEnPerfil` (`lib/gmail/pendientes-admin.ts`): si
 * la base no contesta, la respuesta segura no es "seguí adelante y cargá
 * solo", es "esto va a revisión humana". El correo queda pendiente con el
 * motivo genérico de error que ya usa el resto de `lib/gmail/auto-carga.ts`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  buscarDuplicadoSemanticoEntreCandidatos,
  type CandidatoDuplicado,
  type DatosComparablesDocumento,
  type MotivoDuplicadoSemantico,
} from "@/lib/documentos/duplicados-semanticos"
import type { CategoriaDocumentoExtraida } from "@/lib/gemini/schemas"
import type { Database } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/gmail/duplicados-semanticos-admin.ts se importó desde el navegador. Este módulo usa la " +
      "SERVICE_ROLE_KEY: sólo puede ejecutarse en el servidor.",
  )
}

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
 * ¿El perfil `perfilId` ya tiene un documento CONFIRMADO que sea duplicado
 * semántico de `nuevo`? Devuelve el motivo (Capa 2 o Capa 3), o `null` si
 * ninguno coincide.
 *
 * Ante un error de la base, devuelve `"mismo_numero_orden"` como motivo
 * conservador -cualquiera de los dos alcanza para que la compuerta mande el
 * correo a revisión-, y lo deja logueado. Ver el encabezado del archivo.
 */
export async function buscarDuplicadoSemanticoEnPerfil(
  perfilId: string,
  nuevo: DatosComparablesDocumento,
): Promise<MotivoDuplicadoSemantico | null> {
  const admin = clienteAdmin()

  const { data: documentos, error: errorDocumentos } = await admin
    .from("documents")
    .select("id, title, document_date, category, institution, doctor_name, numero_orden")
    .eq("profile_id", perfilId)
    .not("confirmed_at", "is", null)

  if (errorDocumentos) {
    console.error(
      `[gmail-auto] no se pudo cotejar duplicados semánticos en el perfil ${perfilId} (se asume duplicado):`,
      errorDocumentos.message,
    )
    return "mismo_numero_orden"
  }
  if (!documentos || documentos.length === 0) return null

  const ids = documentos.map((documento) => documento.id)

  const { data: metricas, error: errorMetricas } = await admin
    .from("lab_metrics")
    .select("document_id, metric_name, metric_canonical, value, value_text, unit")
    .in("document_id", ids)

  if (errorMetricas) {
    console.error(
      `[gmail-auto] no se pudieron leer las métricas para el cotejo de duplicados del perfil ${perfilId} (se asume duplicado):`,
      errorMetricas.message,
    )
    return "mismo_numero_orden"
  }

  const metricasPorDocumento = new Map<string, { nombre: string; valor: number | null; valorTexto?: string; unidad: string }[]>()
  for (const fila of metricas ?? []) {
    if (!fila.document_id) continue
    const lista = metricasPorDocumento.get(fila.document_id) ?? []
    // `value` es nullable desde el Sprint 18 (resultados CUALITATIVOS, ver
    // `MetricaComparable` en `lib/documentos/duplicados-semanticos.ts`):
    // `Number(null)` daría `0` y confundiría un "No Reactivo" con un cero
    // real, así que se propaga el `null` y se suma `value_text`.
    lista.push({
      nombre: fila.metric_canonical ?? fila.metric_name,
      valor: fila.value === null ? null : Number(fila.value),
      valorTexto: fila.value_text ?? undefined,
      unidad: fila.unit ?? "",
    })
    metricasPorDocumento.set(fila.document_id, lista)
  }

  const candidatos: CandidatoDuplicado[] = documentos.map((documento) => ({
    documentoId: documento.id,
    titulo: documento.title,
    fecha: documento.document_date,
    categoria: documento.category as CategoriaDocumentoExtraida,
    institucion: documento.institution ?? "",
    medico: documento.doctor_name ?? "",
    numeroOrden: documento.numero_orden ?? "",
    metricas: metricasPorDocumento.get(documento.id) ?? [],
  }))

  const encontrado = buscarDuplicadoSemanticoEntreCandidatos(nuevo, candidatos)
  return encontrado?.motivo ?? null
}
