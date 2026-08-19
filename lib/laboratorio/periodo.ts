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
 * Umbral de "muestra chica" para el aviso de período con pocos estudios
 * (pedido en vivo del usuario, 2026-08-19, verificado por el orquestador
 * contra su historial real: con el filtro "6 meses" solo aparecían PSA y
 * Volumen porque el único laboratorio de ese período es el del 02/06/2026 —
 * comportamiento correcto, pero confuso sin explicación). 1 o 2 estudios no
 * alcanzan para leer ninguna tendencia real -el aviso de "única medición" de
 * cada tarjeta ya cubre el caso de UN estudio con una sola métrica, ver
 * `lib/laboratorio/ultimo-valor.ts`-; a partir de 3 estudios en el período
 * el aviso deja de mostrarse, incluso si hay más "afuera": 3 puntos ya arman
 * una lectura razonable, y empujar a "Todo" solo porque exista en teoría un
 * cuarto estudio más viejo sería más ruido que ayuda.
 */
export const UMBRAL_MUESTRA_CHICA = 2

/**
 * ¿Corresponde avisar que el período elegido deja pocos estudios afuera de
 * lo que hay disponible?
 *
 * - `"todo"` nunca avisa: ya se está viendo todo lo que existe, no hay nada
 *   más ancho que sugerir.
 * - Si NO hay estudios más viejos que el corte (`hayEstudiosAnteriores`
 *   `false`), tampoco avisa: el período elegido ya contiene el historial
 *   completo, así que sugerir "Todo" sería un consejo roto (no cambiaría
 *   nada).
 * - Si hay más estudios afuera, avisa solo cuando la cantidad DENTRO del
 *   período no supera `UMBRAL_MUESTRA_CHICA`.
 */
export function debeAvisarMuestraChica(
  periodo: PeriodoSerie,
  estudiosEnPeriodo: number,
  hayEstudiosAnteriores: boolean,
): boolean {
  if (periodo === "todo") return false
  if (!hayEstudiosAnteriores) return false
  return estudiosEnPeriodo <= UMBRAL_MUESTRA_CHICA
}

const PREFIJO_PERIODO: Record<Exclude<PeriodoSerie, "todo">, string> = {
  "6m": "En los últimos 6 meses",
  "1a": "En el último año",
}

/**
 * Mensaje del aviso de muestra chica: dice el número REAL de estudios que
 * hay en el período -nunca "pocos" ni "algunos", un número concreto, mismo
 * criterio de honestidad que el resto de la pantalla- y sugiere el período
 * que sí los mostraría a todos. Ej.: `"En los últimos 6 meses hay 1 estudio
 * con resultados. Probá "Todo" para ver la serie completa."`.
 *
 * Se arma acá -no en `app/(app)/(con-nav)/estudios/tendencias/page.tsx`,
 * que es quien lo pinta- por el mismo motivo que el resto de este archivo:
 * es texto isomórfico sin Supabase de por medio, así que se puede testear
 * sin mocks (`tests/unit/series-laboratorio.test.ts`).
 */
export function mensajeMuestraChica(
  periodo: Exclude<PeriodoSerie, "todo">,
  estudiosEnPeriodo: number,
): string {
  const textoEstudios = estudiosEnPeriodo === 1 ? "1 estudio" : `${estudiosEnPeriodo} estudios`
  return `${PREFIJO_PERIODO[periodo]} hay ${textoEstudios} con resultados. Probá "Todo" para ver la serie completa.`
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
