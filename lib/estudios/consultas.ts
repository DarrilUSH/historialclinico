import "server-only"

/**
 * Consultas de Supabase de `/estudios` (Sprint 5, tarea 5.2): armado de la
 * consulta filtrada de la galería y el listado de instituciones distintas
 * que puebla el `<Select>` de `components/estudios/filtros-estudios.tsx`.
 *
 * `server-only` a propósito: las dos funciones de acá tocan un
 * `ClienteSupabaseServidor` real. El parseo/validación de los `searchParams`
 * y el armado de query strings (chips, "Limpiar todo", "Ver más") son
 * ISOMÓRFICOS -los necesita también el Client Component
 * `filtros-estudios.tsx`- y viven en `lib/estudios/filtros.ts`, sin este
 * import: mezclar los dos en un solo archivo rompe la build apenas un
 * Client Component importa algo de acá (`server-only` no distingue QUÉ
 * export se usó, solo que el módulo se cargó del lado del cliente).
 */

import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import { saneaTextoBusqueda, type FiltrosEstudios } from "@/lib/estudios/filtros"

/**
 * Arma la consulta de Supabase de la galería con los filtros ya aplicados,
 * lista para que quien la llama agregue `.order()` y `.range()` (la
 * paginación vive aparte, en `components/estudios/lista-estudios.tsx`, para
 * no acoplar esta función a `POR_PAGINA`).
 *
 * `count: "exact"` de entrada: el total con los filtros puestos es lo que
 * decide si el resultado está realmente vacío o si "Ver más" tiene sentido.
 */
export function construirConsultaEstudios(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
  filtros: FiltrosEstudios,
) {
  let consulta = supabase
    .from("documents")
    .select("id, title, category, document_date, institution, ai_summary", { count: "exact" })
    .eq("profile_id", perfilId)

  if (filtros.categoria) {
    consulta = consulta.eq("category", filtros.categoria)
  }
  if (filtros.institucion) {
    consulta = consulta.eq("institution", filtros.institucion)
  }
  if (filtros.desde) {
    consulta = consulta.gte("document_date", filtros.desde)
  }
  if (filtros.hastaFecha) {
    consulta = consulta.lte("document_date", filtros.hastaFecha)
  }
  if (filtros.q) {
    // Un solo `ilike` contra `search_text` -columna generada que concatena
    // title + ai_summary + institution ya normalizados, sin tildes, ver
    // `supabase/migrations/20260823120000_busqueda_sin_tildes_documentos.sql`-
    // en vez del `.or()` de tres `ilike` contra las columnas crudas que había
    // antes: misma semántica de OR (la columna ya las concatena), menos
    // trabajo para Postgres, y ahora SÍ encuentra "Absceso hepático" buscando
    // "hepatico" -antes el buscador exigía tildes porque solo el needle se
    // normalizaba, nunca el pajar-.
    const patron = `%${saneaTextoBusqueda(filtros.q)}%`
    consulta = consulta.ilike("search_text", patron)
  }

  return consulta
}

/**
 * Instituciones distintas de los documentos del perfil (sin filtrar por los
 * filtros activos: el `<Select>` de institución tiene que ofrecer SIEMPRE
 * todas las opciones posibles, no solo las que sobreviven al filtro actual).
 *
 * No hay `DISTINCT` en el query builder de PostgREST sin pasar por un RPC
 * dedicado; para el volumen de documentos de un historial personal/familiar
 * (decenas o cientos, no miles) traer la columna `institution` entera y
 * deduplicarla en memoria es la opción simple que alcanza, en vez de sumar
 * una función de base solo para esto.
 */
export async function obtenerInstitucionesDistintas(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("institution")
    .eq("profile_id", perfilId)
    .not("institution", "is", null)

  if (error || !data) {
    return []
  }

  const distintas = new Set<string>()
  for (const fila of data) {
    if (fila.institution) {
      distintas.add(fila.institution)
    }
  }

  return Array.from(distintas).sort((a, b) => a.localeCompare(b, "es"))
}
