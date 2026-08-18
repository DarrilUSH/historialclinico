import "server-only"

/**
 * Consultas de lectura del catálogo REFES (Sprint 16, tarea 16.3).
 *
 * A diferencia de `lib/lugares/sincronizacion.ts`, **acá no hay service_role**:
 * todo se lee con el cliente de la SESIÓN, así que pasa por
 * `health_centers_select_con_sesion` como cualquier otra consulta de la app.
 * Es lectura de un dato público, pero el catálogo igual no se expone a `anon`
 * (ver §3 de `20260818100000_catalogo_refes.sql`).
 */

import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import { normalizarBusqueda } from "@/lib/lugares/normalizar"
import {
  CATEGORIA_TODAS,
  TODAS_LAS_TIPOLOGIAS,
  tipologiasDelFiltro,
} from "@/lib/lugares/tipologias"

export const COLUMNAS_CENTRO =
  "refes_id, name, typology_id, typology_code, typology_name, funding_origin, " +
  "province, province_refes, department_name, locality_name, postal_code, address, " +
  "website, latitude, longitude"

/** Un centro tal como lo muestran `/lugares` y el autocompletar de "Lugar". */
export interface CentroDelCatalogo {
  refes_id: string
  name: string
  typology_id: number | null
  typology_code: string | null
  typology_name: string | null
  funding_origin: string | null
  province: string | null
  province_refes: string
  department_name: string | null
  locality_name: string | null
  postal_code: string | null
  address: string | null
  website: string | null
  latitude: number | null
  longitude: number | null
}

export interface FiltrosCatalogo {
  /** Texto libre: matchea nombre, localidad, departamento o provincia. */
  consulta?: string | null
  /** Provincia canónica (uno de `PROVINCIAS_ARGENTINAS`), o vacío para todas. */
  provincia?: string | null
  /** Localidad, texto libre. */
  localidad?: string | null
  /** Id de `CATEGORIAS_TIPOLOGIA`, `"todas"` para no filtrar, o vacío para el default. */
  categoria?: string | null
  limite?: number
}

const LIMITE_POR_DEFECTO = 40
const LIMITE_MAXIMO = 100

/**
 * Escapa los comodines de `LIKE` en lo que teclea la persona.
 *
 * Sin esto, buscar "100%" pediría "cualquier cosa" y un guion bajo se
 * convertiría en "cualquier carácter": resultados incomprensibles, no un
 * agujero de seguridad -PostgREST parametriza el valor igual-, pero
 * incomprensibles al fin.
 */
function escaparComodines(texto: string): string {
  return texto.replace(/[\\%_]/g, (caracter) => `\\${caracter}`)
}

/**
 * Busca centros en el catálogo.
 *
 * El texto libre se compara contra `health_centers.search_text` con la MISMA
 * normalización que se usó al ingerir (`lib/lugares/normalizar.ts`), así que
 * "cordoba" encuentra "CÓRDOBA" y "guaymallen" encuentra "GUAYMALLÉN". Es un
 * `like %texto%` -subcadena en cualquier posición, no solo al principio-, el
 * mismo criterio generoso del autocompletar de especialidades de la tarea
 * 16.2 (`lib/especialidades/coincidencias.ts`).
 *
 * Cada palabra del texto aporta su propio `like`, así que "san jorge ushuaia"
 * exige las tres —y encuentra la clínica de Ushuaia sin traer las 66 "san
 * jorge" del resto del país—, sin importar en qué orden se escriban.
 */
export async function buscarCentros(
  supabase: ClienteSupabaseServidor,
  filtros: FiltrosCatalogo,
): Promise<{ centros: CentroDelCatalogo[]; total: number }> {
  const limite = Math.min(Math.max(filtros.limite ?? LIMITE_POR_DEFECTO, 1), LIMITE_MAXIMO)

  // `count: "exact"` y no "estimated": el estimado sale del planificador y
  // con filtros `like` es una adivinanza -puede decir 500 cuando hay 3-, y lo
  // que la pantalla muestra es "N centros encontrados". Medido sobre las
  // 36.046 filas, el conteo exacto con filtros cuesta decenas de
  // milisegundos: no vale la pena mentir para ahorrarlos.
  let consulta = supabase.from("health_centers").select(COLUMNAS_CENTRO, { count: "exact" })

  const texto = normalizarBusqueda(filtros.consulta ?? "")
  if (texto.length > 0) {
    for (const palabra of texto.split(" ")) {
      if (palabra.length === 0) continue
      consulta = consulta.like("search_text", `%${escaparComodines(palabra)}%`)
    }
  }

  const provincia = (filtros.provincia ?? "").trim()
  if (provincia.length > 0) {
    consulta = consulta.eq("province", provincia)
  }

  const localidad = normalizarBusqueda(filtros.localidad ?? "")
  if (localidad.length > 0) {
    consulta = consulta.like("locality_search", `%${escaparComodines(localidad)}%`)
  }

  const tipologias =
    filtros.categoria === CATEGORIA_TODAS
      ? TODAS_LAS_TIPOLOGIAS
      : tipologiasDelFiltro(filtros.categoria)
  consulta = consulta.in("typology_id", [...tipologias])

  const { data, error, count } = await consulta
    .order("name", { ascending: true })
    .limit(limite)
    .returns<CentroDelCatalogo[]>()

  if (error) {
    throw new Error(`No se pudo consultar el catálogo de centros de salud: ${error.message}`)
  }

  return { centros: data ?? [], total: count ?? (data?.length ?? 0) }
}

/** Estado del catálogo que ve la pantalla: cuántos centros hay y de cuándo son. */
export interface EstadoCatalogo {
  centros: number
  ultimaActualizacion: string | null
  edicion: string | null
  /** `true` si hay una sincronización corriendo ahora mismo. */
  sincronizando: boolean
  /** Mensaje de la última corrida fallida, si la hubo. */
  ultimoError: string | null
  /** `true` si una corrida quedó a medio hacer y se puede retomar. */
  hayCorridaIncompleta: boolean
}

export async function leerEstadoCatalogo(
  supabase: ClienteSupabaseServidor,
): Promise<EstadoCatalogo> {
  // El `select` va como UN literal y no como una concatenación: PostgREST-js
  // infiere el tipo de la fila a partir del literal, y una suma de dos
  // strings lo deja en `GenericStringError` -el error de tipos que aparece
  // como "Property 'status' does not exist on type 'GenericStringError'"-.
  const { data, error } = await supabase
    .from("health_centers_sync")
    .select(
      "status, current_row_count, current_synced_at, current_resource_url, run_error, run_byte_offset, run_total_bytes, run_heartbeat_at",
    )
    .single()

  if (error || !data) {
    // Un catálogo sin fila de estado no es motivo para tumbar la pantalla:
    // se muestra como "nunca sincronizado", que es la verdad operativa.
    return {
      centros: 0,
      ultimaActualizacion: null,
      edicion: null,
      sincronizando: false,
      ultimoError: null,
      hayCorridaIncompleta: false,
    }
  }

  const total = Number(data.run_total_bytes ?? 0)
  const hecho = Number(data.run_byte_offset ?? 0)

  return {
    centros: data.current_row_count ?? 0,
    ultimaActualizacion: data.current_synced_at,
    edicion: data.current_resource_url,
    sincronizando: data.status === "running",
    ultimoError: data.status === "error" ? data.run_error : null,
    hayCorridaIncompleta: total > 0 && hecho > 0 && hecho < total,
  }
}
