/**
 * Períodos del historial de signos vitales (Sprint 9, tarea 9.4 —
 * ROADMAP_SPRINTS.md): tipo, orden, etiquetas y corte de fecha.
 *
 * Isomórfico -sin IO, sin `server-only`-, mismo espíritu de separación que
 * `lib/laboratorio/periodo.ts` documenta para su propio par de archivos, pero
 * con una diferencia deliberada: acá el corte se aplica DENTRO de la función
 * pura `lib/signos/series.ts#construirSerieSigno`, nunca en una consulta SQL.
 *
 * `/estudios/tendencias` (Sprint 5) sí necesita un viaje de ida y vuelta al
 * servidor por período (`.gte("measurement_date", fechaCorte)` en
 * `lib/laboratorio/series.ts#obtenerSeries`) porque el volumen de
 * `lab_metrics` puede ser grande. Acá `lib/signos/consultas.ts#obtenerHistorialSigno`
 * trae TODO el historial de un tipo en una sola consulta -el volumen realista
 * de mediciones diarias de un adulto mayor (como mucho unos pocos miles a lo
 * largo de años) no justifica paginar ni recortar en la base todavía-, y
 * cambiar de período en `/signos/historial` es una operación 100% de cliente:
 * `components/signos/selector-periodo-signo.tsx` usa estado local (sin
 * `router.replace`) porque no hace falta una consulta nueva, a diferencia de
 * `components/estudios/selector-periodo.tsx`. Si el historial de signos
 * vitales crece mucho en un sprint futuro, el corte se puede empujar a la
 * consulta sin tocar este módulo (solo agregarle el `.gte()` a
 * `obtenerHistorialSigno` con el mismo `calcularCorteSignos`).
 *
 * `measured_at` es `timestamptz` (no `date` puro como `measurement_date` de
 * laboratorio), así que el corte es un INSTANTE real -se resta en
 * milisegundos, no en meses calendario-, no una fecha de calendario.
 */

export type PeriodoSignos = "30d" | "90d" | "todo"

export const PERIODOS_SIGNOS_EN_ORDEN: readonly PeriodoSignos[] = ["30d", "90d", "todo"]

export const ETIQUETA_PERIODO_SIGNOS: Record<PeriodoSignos, string> = {
  "30d": "30 días",
  "90d": "90 días",
  todo: "Todo",
}

const DIAS_POR_PERIODO: Record<Exclude<PeriodoSignos, "todo">, number> = {
  "30d": 30,
  "90d": 90,
}

const MS_POR_DIA = 86_400_000

function esPeriodoSignosValido(valor: string): valor is PeriodoSignos {
  return (PERIODOS_SIGNOS_EN_ORDEN as readonly string[]).includes(valor)
}

/**
 * Parsea el período de la URL o de cualquier fuente externa; cualquier valor
 * desconocido cae al default `"30d"` -mismo criterio tolerante que
 * `parsearPeriodo` de laboratorio: un parámetro manipulado a mano nunca debe
 * romper la pantalla-. `"30d"` primero en `PERIODOS_SIGNOS_EN_ORDEN` y
 * también el default, mismo criterio que el `"6m"` de laboratorio: el período
 * más corto es el que menos sorprende a quien recién carga la pantalla.
 */
export function parsearPeriodoSignos(crudo: string | undefined | null): PeriodoSignos {
  if (crudo && esPeriodoSignosValido(crudo)) return crudo
  return "30d"
}

/**
 * Instante de corte (ISO 8601, límite inferior inclusive) para un período, o
 * `null` para `"todo"` -sin corte-. `ahora` es un parámetro (no `new Date()`
 * fijo dentro de la función) para que los tests puedan fijar "hoy" y
 * verificar el corte exacto sin depender de la fecha real de ejecución.
 */
export function calcularCorteSignos(periodo: PeriodoSignos, ahora: Date = new Date()): string | null {
  if (periodo === "todo") return null
  const dias = DIAS_POR_PERIODO[periodo]
  return new Date(ahora.getTime() - dias * MS_POR_DIA).toISOString()
}
