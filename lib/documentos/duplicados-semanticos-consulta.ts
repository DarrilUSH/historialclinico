import "server-only"

/**
 * Trae los candidatos y corre el cotejo de duplicados semánticos (Capas 2 y
 * 3, `lib/documentos/duplicados-semanticos.ts`) para las TRES puertas
 * HUMANAS: subida a mano, Web Share Target y "Revisar este estudio" de la
 * bandeja de Gmail. Las tres convergen en la misma pantalla de revisión
 * (`/estudios/nuevo/procesando`), así que este módulo se llama en UN solo
 * lugar: `app/api/documentos/extraer/route.ts`, justo después de validar la
 * extracción de Gemini — es el primer momento en que existen datos
 * estructurados con los que comparar.
 *
 * ## Por qué los candidatos son solo documentos YA CONFIRMADOS
 *
 * `institution`/`specialty`/`doctor_name`/`numero_orden` y las filas de
 * `lab_metrics` se persisten recién en `confirmar_documento_recien_subido`
 * (`supabase/migrations/20260813030000_...sql`, `20260813020000_...sql`,
 * `20260818180000_duplicados_semanticos.sql`). Un documento TODAVÍA sin
 * confirmar -el que la propia persona puede estar revisando en otra pestaña,
 * o cualquier otro que quedó a medio revisar- tiene esos campos en su valor
 * provisional (`category = 'other'`, institución/médico/número de orden en
 * NULL), que no es información real del estudio y compararía contra datos que
 * no significan nada. Se filtra con `confirmed_at is not null`. Los
 * documentos que entran por la carga AUTOMÁTICA (Sprint 17) nacen
 * `confirmed_at = now()`, así que participan igual como candidatos.
 *
 * ## Por qué va con el cliente del USUARIO
 *
 * Mismo criterio que `lib/documentos/huella.ts#buscarDuplicadoPorHuella`: es
 * una lectura de `documents`/`lab_metrics` del perfil activo, y la política
 * `documents_select_puede_ver` (`puede_ver_perfil`) ya es exactamente la
 * autorización que corresponde. No hace falta `service_role` ni ninguna
 * política nueva.
 */

import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import {
  buscarDuplicadoSemanticoEntreCandidatos,
  type CandidatoDuplicado,
  type DatosComparablesDocumento,
  type MotivoDuplicadoSemantico,
} from "@/lib/documentos/duplicados-semanticos"
import type { CategoriaDocumentoExtraida } from "@/lib/gemini/schemas"

/** Lo que la pantalla de revisión necesita para mostrar la franja de aviso. */
export interface DuplicadoSemanticoDetectado {
  documentoId: string
  titulo: string
  /** `document_date` del candidato, `YYYY-MM-DD` — para formatear con `formatearFechaDuplicado`. */
  fecha: string
  motivo: MotivoDuplicadoSemantico
}

/**
 * Cotejo de duplicados semánticos (Capas 2 y 3) para el perfil `perfilId`,
 * excluyendo el propio documento que se está revisando (`documentoIdActual`
 * — todavía sin confirmar en este punto del flujo, pero por las dudas: nunca
 * tiene sentido que un documento se compare consigo mismo).
 *
 * Dos consultas (documentos candidatos + sus métricas) en vez de un JOIN: es
 * el mismo criterio de legibilidad que ya eligió
 * `app/(app)/(con-nav)/perfil/gmail/page.tsx` para los documentos/turnos
 * creados por la carga automática, y el volumen por perfil (historial médico
 * de una familia, no una base clínica completa) hace que el costo de la
 * segunda consulta sea irrelevante.
 */
export async function buscarDuplicadoSemantico(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
  documentoIdActual: string,
  nuevo: DatosComparablesDocumento,
): Promise<DuplicadoSemanticoDetectado | null> {
  const { data: documentos, error: errorDocumentos } = await supabase
    .from("documents")
    .select("id, title, document_date, category, institution, doctor_name, numero_orden")
    .eq("profile_id", perfilId)
    .not("confirmed_at", "is", null)
    .neq("id", documentoIdActual)

  if (errorDocumentos) {
    throw new Error(`No se pudo cotejar duplicados semánticos: ${errorDocumentos.message}`)
  }
  if (!documentos || documentos.length === 0) return null

  const ids = documentos.map((documento) => documento.id)

  const { data: metricas, error: errorMetricas } = await supabase
    .from("lab_metrics")
    .select("document_id, metric_name, metric_canonical, value, unit")
    .in("document_id", ids)

  if (errorMetricas) {
    throw new Error(`No se pudo leer las métricas para el cotejo de duplicados: ${errorMetricas.message}`)
  }

  const metricasPorDocumento = new Map<string, { nombre: string; valor: number; unidad: string }[]>()
  for (const fila of metricas ?? []) {
    if (!fila.document_id) continue
    const lista = metricasPorDocumento.get(fila.document_id) ?? []
    lista.push({
      nombre: fila.metric_canonical ?? fila.metric_name,
      valor: Number(fila.value),
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
  if (!encontrado) return null

  return {
    documentoId: encontrado.candidato.documentoId,
    titulo: encontrado.candidato.titulo,
    fecha: encontrado.candidato.fecha,
    motivo: encontrado.motivo,
  }
}
