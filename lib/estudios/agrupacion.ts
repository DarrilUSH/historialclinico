/**
 * Agrupación de estudios por período (mes y año) para la galería de
 * `/estudios` (Sprint 5, tarea 5.1).
 *
 * `agruparPorPeriodo` recibe una lista YA ordenada por `document_date`
 * descendente -la consulta de `components/estudios/lista-estudios.tsx` la
 * entrega así- y la parte en grupos contiguos por "YYYY-MM". Como la fecha
 * nunca CRECE a medida que se recorre la lista, un barrido secuencial
 * alcanza: una vez que se deja un mes no se puede volver a él más adelante
 * en el arreglo, así que no hace falta ni un `Map` ni reordenar nada.
 */

export interface GrupoEstudios<T> {
  /** Clave del período, `"YYYY-MM"`. Sirve de `key` en React. */
  clave: string
  /** Encabezado legible, ej. "Marzo 2026". */
  etiqueta: string
  documentos: T[]
}

/**
 * `document_date` es un `date` de Postgres ("2026-08-12", sin hora): se
 * formatea **en UTC a propósito**, mismo motivo que documentaba
 * `formatearFecha` en la versión mínima de `estudios/page.tsx` (Sprint 4) -
 * `new Date("2026-08-12")` se parsea como medianoche UTC, y formatear eso en
 * hora de Ushuaia (-03) movería la fecha un día. Una fecha sin hora no tiene
 * que viajar por ninguna zona horaria.
 */
const FORMATO_PERIODO = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
})

/**
 * `"2026-03"` -> `"Marzo 2026"`.
 *
 * Se arma con `formatToParts` y no con el resultado directo de `format()`
 * porque `es-AR` intercala "de" (`"marzo de 2026"`): el diseño pide el
 * encabezado corto, sin esa palabra, así que se toman las partes "month" y
 * "year" sueltas y se unen a mano.
 */
export function etiquetaDePeriodo(clavePeriodo: string): string {
  const fecha = new Date(`${clavePeriodo}-01T00:00:00Z`)
  const partes = FORMATO_PERIODO.formatToParts(fecha)
  const mes = partes.find((parte) => parte.type === "month")?.value ?? ""
  const anio = partes.find((parte) => parte.type === "year")?.value ?? ""
  const mesCapitalizado = mes.length > 0 ? mes.charAt(0).toUpperCase() + mes.slice(1) : mes
  return `${mesCapitalizado} ${anio}`.trim()
}

/**
 * Agrupa documentos (o cualquier fila con `document_date`) por mes y año,
 * preservando el orden de entrada dentro de cada grupo y entre grupos.
 */
export function agruparPorPeriodo<T extends { document_date: string }>(
  documentos: readonly T[],
): GrupoEstudios<T>[] {
  const grupos: GrupoEstudios<T>[] = []

  for (const documento of documentos) {
    const clave = documento.document_date.slice(0, 7)
    const ultimo = grupos[grupos.length - 1]

    if (ultimo && ultimo.clave === clave) {
      ultimo.documentos.push(documento)
    } else {
      grupos.push({ clave, etiqueta: etiquetaDePeriodo(clave), documentos: [documento] })
    }
  }

  return grupos
}
