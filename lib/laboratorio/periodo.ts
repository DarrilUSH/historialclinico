/**
 * Períodos de `/estudios/tendencias` (Sprint 5, tarea 5.4): tipo, orden,
 * etiquetas y cálculo puro del corte de fecha.
 *
 * Módulo ISOMÓRFICO a propósito -mismo criterio que documenta
 * `lib/estudios/filtros.ts` para su propia separación de
 * `lib/estudios/consultas.ts`-: `components/estudios/selector-periodo.tsx`
 * (Client Component) necesita el tipo `PeriodoSerie` y las etiquetas de los
 * tres botones segmentados SIN arrastrar "server-only" -que si viviera en
 * `lib/laboratorio/series.ts` (que sí lo importa, ver su encabezado) rompería
 * la build apenas un Client Component tocara ese archivo, sin importar que
 * el import fuera "solo un tipo"-. `lib/laboratorio/series.ts` importa
 * `calcularFechaCorte` de acá para `obtenerSeries`; nada de este archivo
 * toca Supabase ni ninguna API de servidor, así que es seguro en los dos
 * lados.
 */

export type PeriodoSerie = "6m" | "1a" | "todo"

export const PERIODOS_EN_ORDEN: readonly PeriodoSerie[] = ["6m", "1a", "todo"]

export const ETIQUETA_PERIODO: Record<PeriodoSerie, string> = {
  "6m": "6 meses",
  "1a": "1 año",
  todo: "Todo",
}

function esPeriodoValido(valor: string): valor is PeriodoSerie {
  return PERIODOS_EN_ORDEN.includes(valor as PeriodoSerie)
}

/** Parsea el `?periodo=` crudo de la URL; cualquier valor desconocido cae al default `"6m"` (mismo criterio tolerante que `parsearFiltrosEstudios`: un search param manipulado a mano nunca debe romper la pantalla). */
export function parsearPeriodo(crudo: string | undefined | null): PeriodoSerie {
  if (crudo && esPeriodoValido(crudo)) return crudo
  return "6m"
}

/**
 * Fecha de corte (`YYYY-MM-DD`, límite inferior inclusive) para un período.
 * `null` para `"todo"` -sin corte-. `ahora` es un parámetro (no
 * `new Date()` fijo dentro de la función) para que los tests puedan fijar
 * "hoy" y verificar el corte exacto sin depender de la fecha real de
 * ejecución. `measurement_date` es un `date` puro de Postgres (sin hora),
 * así que el corte se arma también en UTC, sin mezclar con la hora local del
 * entorno que ejecuta el código -mismo motivo que documenta
 * `lib/estudios/agrupacion.ts` para `document_date`-.
 */
export function calcularFechaCorte(periodo: PeriodoSerie, ahora: Date = new Date()): string | null {
  if (periodo === "todo") return null

  const corte = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()))
  if (periodo === "6m") {
    corte.setUTCMonth(corte.getUTCMonth() - 6)
  } else {
    corte.setUTCFullYear(corte.getUTCFullYear() - 1)
  }
  return corte.toISOString().slice(0, 10)
}
