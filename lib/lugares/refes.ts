/**
 * Traducción de una fila del CSV del REFES a una fila de `health_centers`
 * (Sprint 16, tarea 16.3). Lógica pura, testeada en
 * `tests/unit/refes-fila.test.ts` con filas reales del archivo del
 * Ministerio.
 *
 * Este archivo es el único lugar del proyecto que sabe en qué ORDEN vienen
 * las 19 columnas del CSV. Todo lo demás trabaja con el objeto ya tipado.
 */

import { normalizarBusqueda, provinciaCanonica } from "@/lib/lugares/normalizar"

/**
 * Las 19 columnas del CSV, en su orden exacto. Se verifica contra el
 * encabezado real en cada sincronización (`verificarEncabezado`): si el
 * Ministerio reordena o renombra una columna, la corrida falla con un mensaje
 * claro en vez de guardar la longitud en `latitude` y la localidad en
 * `domicilio`.
 */
export const COLUMNAS_REFES = [
  "establecimiento_id",
  "establecimiento_nombre",
  "localidad_id",
  "localidad_nombre",
  "provincia_id",
  "provincia_nombre",
  "departamento_id",
  "departamento_nombre",
  "codloc",
  "codent",
  "origen_financiamiento",
  "tipologia_id",
  "tipologia_sigla",
  "tipologia_nombre",
  "cp",
  "domicilio",
  "sitio_web",
  "longitud",
  "latitud",
] as const

const INDICE = Object.fromEntries(COLUMNAS_REFES.map((nombre, i) => [nombre, i])) as Record<
  (typeof COLUMNAS_REFES)[number],
  number
>

/** Fila lista para el `upsert` a `public.health_centers`. */
export interface CentroParaGuardar {
  refes_id: string
  name: string
  typology_id: number | null
  typology_code: string | null
  typology_name: string | null
  funding_origin: string | null
  province_refes: string
  province: string | null
  department_name: string | null
  locality_name: string | null
  postal_code: string | null
  address: string | null
  website: string | null
  latitude: number | null
  longitude: number | null
  search_text: string
  locality_search: string | null
}

export class ErrorFormatoRefes extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = "ErrorFormatoRefes"
  }
}

/**
 * Comprueba que el encabezado del CSV sea el esperado. Lanza
 * `ErrorFormatoRefes` si no lo es.
 *
 * Se compara normalizado (minúsculas, sin tildes, sin espacios de borde) para
 * no fallar por un cambio cosmético, pero sí por un cambio real de orden,
 * cantidad o nombre de columna. Sin esta verificación, un rediseño del CSV
 * cargaría 36 mil filas de basura en silencio, y el catálogo quedaría peor
 * que vacío: quedaría MAL, con direcciones en el campo de sitio web y turnos
 * apuntando a coordenadas inventadas.
 */
export function verificarEncabezado(fila: readonly string[]): void {
  const recibido = fila.map((columna) => normalizarBusqueda(columna))
  const esperado = COLUMNAS_REFES.map((columna) => normalizarBusqueda(columna))

  if (recibido.length !== esperado.length) {
    throw new ErrorFormatoRefes(
      `El CSV del REFES trae ${recibido.length} columnas y se esperaban ${esperado.length}. ` +
        "El formato de la fuente cambió: hay que revisar lib/lugares/refes.ts antes de sincronizar.",
    )
  }

  for (let i = 0; i < esperado.length; i += 1) {
    if (recibido[i] !== esperado[i]) {
      throw new ErrorFormatoRefes(
        `La columna ${i + 1} del CSV del REFES es "${fila[i]}" y se esperaba "${COLUMNAS_REFES[i]}". ` +
          "El formato de la fuente cambió: hay que revisar lib/lugares/refes.ts antes de sincronizar.",
      )
    }
  }
}

function texto(fila: readonly string[], columna: (typeof COLUMNAS_REFES)[number]): string {
  return (fila[INDICE[columna]] ?? "").trim()
}

function textoOpcional(
  fila: readonly string[],
  columna: (typeof COLUMNAS_REFES)[number],
): string | null {
  const valor = texto(fila, columna)
  return valor.length > 0 ? valor : null
}

/**
 * Coordenada válida, o `null`.
 *
 * **No es paranoia defensiva: el archivo trae basura de verdad.** Sobre la
 * edición de diciembre de 2025 hay 29 latitudes y 34 longitudes fuera de
 * rango -valores como `-313722383` o `5850954`, claramente un punto decimal
 * perdido en la carga original- y una fila con una sola de las dos
 * coordenadas. Si estos valores llegaran al `upsert`, el CHECK
 * `health_centers_latitude_valida` abortaría el LOTE ENTERO de 2.000 filas y
 * la sincronización se caería sin poder avanzar nunca.
 *
 * Se recorta a 6 decimales porque la columna es `numeric(9, 6)`: sin el
 * recorte, `-60.15687838960921` haría fallar la escala del tipo.
 */
function coordenada(crudo: string, tope: number): number | null {
  if (crudo.length === 0) return null

  const valor = Number.parseFloat(crudo)
  if (!Number.isFinite(valor) || Math.abs(valor) > tope) return null

  return Number(valor.toFixed(6))
}

/**
 * Convierte una fila del CSV en una fila de `health_centers`, o `null` si la
 * fila no sirve (sin id o sin nombre: los dos CHECK `no_vacio` de la tabla).
 *
 * Devolver `null` en vez de lanzar es deliberado: una fila rota de la fuente
 * no puede hacer fracasar la sincronización de las otras 36.045. La cuenta de
 * descartadas se reporta igual (`lib/lugares/sincronizacion.ts`).
 */
export function filaAcentro(fila: readonly string[]): CentroParaGuardar | null {
  if (fila.length !== COLUMNAS_REFES.length) return null

  const refesId = texto(fila, "establecimiento_id")
  const nombre = texto(fila, "establecimiento_nombre")
  if (refesId.length === 0 || nombre.length === 0) return null

  let latitude = coordenada(texto(fila, "latitud"), 90)
  let longitude = coordenada(texto(fila, "longitud"), 180)
  // `health_centers_coordenadas_completas`: van las dos o no va ninguna.
  if (latitude === null || longitude === null) {
    latitude = null
    longitude = null
  }

  const provinciaRefes = texto(fila, "provincia_nombre")
  const localidad = textoOpcional(fila, "localidad_nombre")
  const departamento = textoOpcional(fila, "departamento_nombre")
  const tipologiaCruda = texto(fila, "tipologia_id")
  const tipologiaId = /^\d+$/.test(tipologiaCruda) ? Number(tipologiaCruda) : null

  return {
    refes_id: refesId,
    name: nombre,
    typology_id: tipologiaId,
    typology_code: textoOpcional(fila, "tipologia_sigla"),
    typology_name: textoOpcional(fila, "tipologia_nombre"),
    funding_origin: textoOpcional(fila, "origen_financiamiento"),
    province_refes: provinciaRefes,
    province: provinciaCanonica(provinciaRefes),
    department_name: departamento,
    locality_name: localidad,
    postal_code: textoOpcional(fila, "cp"),
    address: textoOpcional(fila, "domicilio"),
    website: textoOpcional(fila, "sitio_web"),
    latitude,
    longitude,
    // Nombre + localidad + departamento + provincia: lo mínimo para que
    // "san jorge ushuaia" o "britanico caba" encuentren lo que la persona
    // busca en una sola consulta. El DOMICILIO queda fuera a propósito -"51",
    // "25 de mayo" o "san martín" son nombres de calle en media Argentina y
    // convertirían cualquier búsqueda en ruido-.
    search_text: normalizarBusqueda(
      [nombre, localidad, departamento, provinciaRefes].filter(Boolean).join(" "),
    ),
    // Solo la localidad, para que el filtro "Localidad" de /lugares no
    // arrastre los centros que TIENEN el nombre de una ciudad en su razón
    // social pero están en otra.
    locality_search: localidad ? normalizarBusqueda(localidad) : null,
  }
}
