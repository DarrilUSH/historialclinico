import "server-only"

/**
 * Series temporales de métricas de laboratorio para `/estudios/tendencias`
 * (Sprint 5, tarea 5.4): agrupa `lab_metrics` por métrica canónica, ordena
 * cada serie por fecha y aplica el corte de período (6 meses / 1 año / todo).
 *
 * `server-only` a propósito -mismo criterio que `lib/estudios/consultas.ts`
 * documenta-: `obtenerSeries` y `existenMetricasDeLaboratorio` tocan un
 * `ClienteSupabaseServidor` real (se lo pasan por parámetro, no lo crean
 * ellas mismas, pero igual son código pensado para correr solo en el
 * servidor). Los componentes de cliente (`components/estudios/panel-tendencias.tsx`,
 * `grafico-metrica.tsx`) reciben `SerieMetrica[]`/`MetricaDisponible[]` ya
 * resueltos como PROPS desde `app/(app)/(con-nav)/estudios/tendencias/page.tsx`
 * -datos planos, nunca importan nada de este archivo-. La ÚNICA pieza que un
 * Client Component sí necesita ejecutar de nuevo (el tipo `PeriodoSerie` y
 * sus etiquetas, para pintar los tres botones segmentados) vive aparte, en
 * `lib/laboratorio/periodo.ts`, que SÍ es isomórfico: ver su encabezado.
 *
 * ## Por qué la agrupación NO usa `metric_canonical` tal cual está en la fila
 *
 * El roadmap pide agrupar "por `metric_canonical` (fallback `metric_name`)",
 * y eso es literalmente lo que hace `resolverClaveYEtiqueta` -pero con un
 * paso extra, necesario por un mismatch real en los datos de este proyecto:
 * `supabase/seed.sql` inserta `metric_canonical` en minúsculas y con guion
 * bajo ("glucosa", "colesterol_total", "hdl", "hemoglobina"), mientras que el
 * pipeline real de confirmación de documentos
 * (`lib/laboratorio/normalizacion.ts` → `normalizarMetrica`,
 * `supabase/migrations/20260813020000_metricas_en_confirmacion.sql`) guarda
 * el canónico con mayúscula inicial y espacios ("Glucosa", "Colesterol
 * total"). Agrupar por el string crudo de `metric_canonical` haría que un
 * documento del seed y un documento subido de verdad para la MISMA métrica
 * terminaran en dos series distintas -exactamente el problema que
 * `lib/laboratorio/diccionario.ts` dice en su propio encabezado que existe
 * para evitar ("para que `lib/laboratorio/series.ts` (Sprint 5) pueda armar
 * UNA serie temporal por métrica")-.
 *
 * La solución: en vez de confiar en el string crudo, se vuelve a pasar
 * `metric_canonical` (o `metric_name` si no hay canónico) por
 * `normalizarMetrica` -la misma función pura que ya usa
 * `lib/laboratorio/normalizacion.ts` al confirmar un documento-. Si el
 * diccionario reconoce el texto (con cualquier capitalización: la
 * normalización interna de `normalizarMetrica` es case/tilde-insensible),
 * la CLAVE de agrupación y la ETIQUETA de exhibición son siempre el mismo
 * nombre canónico "lindo" ("Glucosa"), sin importar si vino del seed en
 * minúsculas o de un documento real con mayúscula. Si el diccionario NO lo
 * reconoce (una métrica todavía no catalogada), se usa el texto tal cual
 * llegó -mismo criterio de "nunca perder el dato original" que ya aplica
 * `prepararMetricas`- y esa métrica simplemente no se fusiona con ninguna
 * otra hasta que se amplíe el diccionario.
 *
 * ## Corte de período: en `lib/laboratorio/periodo.ts`, no acá
 *
 * El tipo `PeriodoSerie`, las etiquetas de los tres botones segmentados y
 * `calcularFechaCorte` viven en `lib/laboratorio/periodo.ts` -módulo
 * ISOMÓRFICO, sin `server-only`- porque `components/estudios/selector-periodo.tsx`
 * (Client Component) los necesita, y este archivo SÍ tiene `server-only`.
 * Ver el encabezado de `periodo.ts` para el detalle completo de esa
 * separación (mismo criterio que `lib/estudios/filtros.ts` vs.
 * `lib/estudios/consultas.ts`).
 */

import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import { normalizarMetrica, normalizarTexto } from "@/lib/laboratorio/diccionario"
import { calcularFechaCorte, type PeriodoSerie } from "@/lib/laboratorio/periodo"

export type { PeriodoSerie } from "@/lib/laboratorio/periodo"
export { calcularFechaCorte, ETIQUETA_PERIODO, PERIODOS_EN_ORDEN, parsearPeriodo } from "@/lib/laboratorio/periodo"

/** Punto de una serie, ya con `fueraDeRango` resuelto (se calcula una sola vez acá, no en cada componente que lo pinta). */
export interface PuntoSerie {
  /** `measurement_date`, `YYYY-MM-DD`. */
  fecha: string
  valor: number
  unidad: string | null
  /** Texto original del rango ("70 - 100", "<200"), para mostrar tal cual venía del estudio. */
  rangoTexto: string | null
  min: number | null
  max: number | null
  /** `null` cuando la métrica no está asociada a ningún documento (o el documento fue borrado). */
  documentoId: string | null
  fueraDeRango: boolean
}

export interface SerieMetrica {
  /** Clave estable de agrupación (texto normalizado, sin tildes/mayúsculas): ver el encabezado del archivo. */
  clave: string
  /** Nombre para mostrar: canónico del diccionario si lo reconoce, si no el texto tal cual llegó. */
  etiqueta: string
  /** Unidad de la medición MÁS RECIENTE de la serie (fallback: la primera no nula que aparezca). */
  unidad: string | null
  /** Ordenados por `fecha` ascendente. */
  puntos: PuntoSerie[]
}

export interface MetricaDisponible {
  clave: string
  etiqueta: string
  unidad: string | null
  ultimaFecha: string
  ultimoValor: number
  fueraDeRango: boolean
}

export interface ResultadoSeries {
  /** Ordenadas alfabéticamente por `etiqueta` (`localeCompare` es-AR), mismo criterio que `obtenerInstitucionesDistintas`. */
  series: SerieMetrica[]
  metricasDisponibles: MetricaDisponible[]
  /**
   * Cantidad de estudios DISTINTOS (ver `contarEstudiosDistintos`) con al
   * menos una métrica dentro del período elegido. Alimenta el aviso de
   * "muestra chica" de `tendencias/page.tsx`
   * (`lib/laboratorio/periodo.ts#debeAvisarMuestraChica`).
   */
  estudiosEnPeriodo: number
  /**
   * `true` si existe al menos una medición ANTERIOR al corte del período
   * elegido -es decir, si cambiar a "Todo" mostraría más datos-. Siempre
   * `false` para `periodo === "todo"` (no hay "antes" de eso).
   */
  hayEstudiosAnteriores: boolean
}

/** Fila cruda de `lab_metrics`, con los únicos campos que necesita este módulo. */
export interface FilaLabMetrica {
  metric_name: string
  metric_canonical: string | null
  value: number
  unit: string | null
  reference_range: string | null
  reference_min: number | null
  reference_max: number | null
  measurement_date: string
  document_id: string | null
}

/**
 * ¿El valor cae fuera del rango de referencia? Mismo criterio que ya usa
 * `estaFueraDeRango` en `app/(app)/(con-nav)/estudios/[id]/page.tsx`
 * (duplicado a propósito: es una función de tres líneas sin estado, y
 * importarla desde una página no es un módulo compartido que valga la pena
 * crear todavía; si aparece una tercera necesidad, se extrae).
 */
export function estaFueraDeRango(
  valor: number,
  min: number | null,
  max: number | null,
): boolean {
  if (min !== null && valor < min) return true
  if (max !== null && valor > max) return true
  return false
}

/**
 * Resuelve la clave de agrupación y la etiqueta de exhibición de una fila:
 * ver "Por qué la agrupación NO usa `metric_canonical` tal cual está en la
 * fila" en el encabezado del archivo.
 *
 * Un segundo mismatch, más chico, que aparece con el mismo `metric_canonical`
 * del seed: viene en `snake_case` ("colesterol_total"), mientras que las
 * claves de `lib/laboratorio/diccionario.ts` usan espacios ("colesterol
 * total"). `normalizarTexto` (que usa el diccionario internamente) no trata
 * el guion bajo como espacio -no tiene por qué: un `metric_name` tipeado o
 * leído por Gemini nunca trae guiones bajos-, así que acá, SOLO para el
 * intento de reconocimiento por el diccionario, se reemplazan guiones bajos
 * y guiones medios por espacios. Si el diccionario no reconoce el resultado
 * de todos modos, se conserva `base` tal cual (sin ese reemplazo) como
 * etiqueta: un `metric_canonical` desconocido en `snake_case` mostrado
 * literal ("mi_metrica_rara") sigue siendo más honesto que inventarle
 * espaciado a un texto que no se sabe si de verdad los lleva.
 */
function resolverClaveYEtiqueta(
  fila: Pick<FilaLabMetrica, "metric_canonical" | "metric_name">,
): { clave: string; etiqueta: string } {
  const base = fila.metric_canonical?.trim() || fila.metric_name.trim()
  const candidatoParaDiccionario = base.replace(/[_-]+/g, " ")
  const { canonico } = normalizarMetrica(candidatoParaDiccionario)
  const etiqueta = canonico ?? base
  const clave = normalizarTexto(etiqueta)
  return { clave, etiqueta }
}

/** Último valor no nulo recorriendo `puntos` de atrás para adelante (los puntos ya vienen ordenados ascendente). */
function ultimoNoNulo<T, V>(puntos: readonly T[], seleccionar: (item: T) => V | null): V | null {
  for (let i = puntos.length - 1; i >= 0; i--) {
    const valor = seleccionar(puntos[i])
    if (valor !== null) return valor
  }
  return null
}

/**
 * Agrupa filas crudas de `lab_metrics` en series por métrica, ordenadas por
 * fecha ascendente dentro de cada serie y alfabéticamente entre series.
 *
 * Pura: no asume que `filas` venga ya ordenada de la consulta (ordena ella
 * misma), así se puede testear con arreglos armados a mano en cualquier
 * orden.
 */
export function agruparEnSeries(filas: readonly FilaLabMetrica[]): SerieMetrica[] {
  const porClave = new Map<string, { etiqueta: string; puntos: PuntoSerie[] }>()

  for (const fila of filas) {
    const { clave, etiqueta } = resolverClaveYEtiqueta(fila)

    const punto: PuntoSerie = {
      fecha: fila.measurement_date,
      valor: fila.value,
      unidad: fila.unit,
      rangoTexto: fila.reference_range,
      min: fila.reference_min,
      max: fila.reference_max,
      documentoId: fila.document_id,
      fueraDeRango: estaFueraDeRango(fila.value, fila.reference_min, fila.reference_max),
    }

    const existente = porClave.get(clave)
    if (existente) {
      existente.puntos.push(punto)
    } else {
      porClave.set(clave, { etiqueta, puntos: [punto] })
    }
  }

  const series: SerieMetrica[] = []
  for (const [clave, { etiqueta, puntos }] of porClave) {
    puntos.sort((a, b) => a.fecha.localeCompare(b.fecha))
    const unidad = ultimoNoNulo(puntos, (p) => p.unidad)
    series.push({ clave, etiqueta, unidad, puntos })
  }

  series.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"))
  return series
}

/**
 * Cuenta estudios DISTINTOS entre filas crudas de `lab_metrics`: agrupa por
 * `document_id` cuando lo hay -un documento subido es, por definición, UN
 * estudio, sin importar cuántas métricas o filas produzca-, y por
 * `measurement_date` cuando no -sin ese vínculo, la fecha es la mejor
 * aproximación disponible: dos filas sin documento en la misma fecha se
 * asumen del mismo estudio-.
 *
 * Pura -recibe solo los dos campos que necesita, no toda `FilaLabMetrica`-
 * para poder testearla sin construir filas completas ni tocar Supabase.
 * Usada por `obtenerSeries` para `estudiosEnPeriodo` (ver el aviso de
 * "muestra chica" en `lib/laboratorio/periodo.ts`).
 */
export function contarEstudiosDistintos(
  filas: readonly Pick<FilaLabMetrica, "document_id" | "measurement_date">[],
): number {
  const claves = new Set(filas.map((fila) => fila.document_id ?? `fecha:${fila.measurement_date}`))
  return claves.size
}

/** Resumen de "última medición" por serie, para los chips del selector de métrica. */
export function obtenerMetricasDisponibles(series: readonly SerieMetrica[]): MetricaDisponible[] {
  const metricas: MetricaDisponible[] = []
  for (const serie of series) {
    const ultimo = serie.puntos[serie.puntos.length - 1]
    if (!ultimo) continue
    metricas.push({
      clave: serie.clave,
      etiqueta: serie.etiqueta,
      unidad: serie.unidad,
      ultimaFecha: ultimo.fecha,
      ultimoValor: ultimo.valor,
      fueraDeRango: ultimo.fueraDeRango,
    })
  }
  return metricas
}

/**
 * Trae y agrupa las métricas de laboratorio del perfil para el período
 * pedido. `.gte("measurement_date", fechaCorte)` filtra del lado de la base
 * -no tiene sentido traer filas que después se van a descartar-, así que
 * `metricasDisponibles` refleja SOLO las métricas con al menos una medición
 * DENTRO del período elegido: cambiar de período puede hacer aparecer o
 * desaparecer un chip si esa métrica no tiene datos en la ventana nueva. Es
 * una decisión deliberada, no un descuido -mismo criterio que ya aplica
 * `EstadoVacioFiltrado` en `lista-estudios.tsx`: mostrar un chip que llevaría
 * a un gráfico vacío sería peor experiencia que no mostrarlo-.
 */
export async function obtenerSeries(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
  periodo: PeriodoSerie,
  ahora: Date = new Date(),
): Promise<ResultadoSeries> {
  const fechaCorte = calcularFechaCorte(periodo, ahora)

  // `.not("value", "is", null)` (Sprint 18, resultados cualitativos):
  // `lab_metrics.value` pasó a nullable -una fila puede traer en cambio
  // `value_text`-, y esta consulta alimenta el GRÁFICO numérico, que no
  // sabe qué hacer con un punto sin número. Los resultados cualitativos
  // tienen su propio camino, ver `obtenerResultadosCualitativos` más abajo.
  let consulta = supabase
    .from("lab_metrics")
    .select(
      "metric_name, metric_canonical, value, unit, reference_range, reference_min, reference_max, measurement_date, document_id",
    )
    .eq("profile_id", perfilId)
    .not("value", "is", null)
    .order("measurement_date", { ascending: true })

  if (fechaCorte) {
    consulta = consulta.gte("measurement_date", fechaCorte)
  }

  const { data, error } = await consulta

  if (error || !data) {
    return { series: [], metricasDisponibles: [], estudiosEnPeriodo: 0, hayEstudiosAnteriores: false }
  }

  // El filtro de arriba ya garantiza esto en tiempo de ejecución; el type
  // guard es lo que hace falta para que TypeScript lo sepa también -el tipo
  // generado de la columna sigue siendo `number | null` sin importar el
  // `.not()`, que Supabase no refleja en el tipo estático de la consulta-.
  const filasNumericas = data.filter(
    (fila): fila is typeof fila & { value: number } => fila.value !== null,
  )

  const series = agruparEnSeries(filasNumericas)
  const estudiosEnPeriodo = contarEstudiosDistintos(filasNumericas)

  // Consulta liviana aparte -`head: true`, sin traer filas, mismo patrón
  // que `existenMetricasDeLaboratorio` más abajo-, SOLO cuando hay corte:
  // con `periodo === "todo"` no hay "antes" que buscar. Alimenta el aviso
  // de "muestra chica" (`lib/laboratorio/periodo.ts#debeAvisarMuestraChica`):
  // sin esto no hay forma de distinguir "el período recortó datos" de "el
  // período ya contiene todo el historial", y sugerir "Todo" en el segundo
  // caso sería un consejo roto.
  let hayEstudiosAnteriores = false
  if (fechaCorte) {
    const { count } = await supabase
      .from("lab_metrics")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", perfilId)
      .lt("measurement_date", fechaCorte)
    hayEstudiosAnteriores = (count ?? 0) > 0
  }

  return {
    series,
    metricasDisponibles: obtenerMetricasDisponibles(series),
    estudiosEnPeriodo,
    hayEstudiosAnteriores,
  }
}

/** Un resultado CUALITATIVO ("Negativo", "No reactivo") dentro del período elegido, sin curva. */
export interface ResultadoCualitativo {
  /** Misma clave de agrupación que `SerieMetrica.clave` (por si algún día hace falta cruzar con una serie numérica de la misma métrica). */
  clave: string
  etiqueta: string
  valorTexto: string
  /** `measurement_date`, `YYYY-MM-DD`. */
  fecha: string
  documentoId: string | null
}

/**
 * Resultados de laboratorio CUALITATIVOS (Sprint 18): mismo perfil y mismo
 * corte de período que `obtenerSeries`, pero para filas con `value_text` en
 * vez de `value` -no tienen curva posible, así que no entran en
 * `agruparEnSeries`-. `/estudios/tendencias` los muestra como una lista
 * aparte ("marca sin curva", ver `components/estudios/lista-resultados-cualitativos.tsx`),
 * más reciente primero.
 *
 * Reusa `resolverClaveYEtiqueta` -la única razón de que esa función tomara
 * un `Pick` en vez de `FilaLabMetrica` completa- para que "PCR" cualitativo
 * y "PCR" numérico (si algún día coexisten) resuelvan a la MISMA etiqueta
 * canónica que el resto de la app.
 */
export async function obtenerResultadosCualitativos(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
  periodo: PeriodoSerie,
  ahora: Date = new Date(),
): Promise<ResultadoCualitativo[]> {
  const fechaCorte = calcularFechaCorte(periodo, ahora)

  let consulta = supabase
    .from("lab_metrics")
    .select("metric_name, metric_canonical, value_text, measurement_date, document_id")
    .eq("profile_id", perfilId)
    .not("value_text", "is", null)
    .order("measurement_date", { ascending: false })

  if (fechaCorte) {
    consulta = consulta.gte("measurement_date", fechaCorte)
  }

  const { data, error } = await consulta
  if (error || !data) return []

  return data
    .filter((fila): fila is typeof fila & { value_text: string } => fila.value_text !== null)
    .map((fila) => {
      const { clave, etiqueta } = resolverClaveYEtiqueta(fila)
      return {
        clave,
        etiqueta,
        valorTexto: fila.value_text,
        fecha: fila.measurement_date,
        documentoId: fila.document_id,
      }
    })
}

/**
 * ¿El perfil tiene al menos una métrica de laboratorio cargada? Consulta
 * liviana (`head: true`, sin traer filas) para decidir si `/estudios`
 * muestra el link "Ver tendencias" -mismo patrón `count: "exact", head:
 * true` que ya usa el resto del proyecto para chequeos de existencia sin
 * pagar el costo de traer datos que no se van a usar-.
 */
export async function existenMetricasDeLaboratorio(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("lab_metrics")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", perfilId)

  if (error) return false
  return (count ?? 0) > 0
}
