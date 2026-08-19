/**
 * Normalización de métricas de laboratorio para persistir en `lab_metrics`
 * (Sprint 4, tarea 4.6).
 *
 * `prepararMetricas` es el puente entre lo que muestra
 * `components/documentos/formulario-revision.tsx` (la extracción de Gemini,
 * de solo lectura en esa pantalla) y las filas que el RPC
 * `confirmar_documento_recien_subido` inserta en `lab_metrics`
 * (`supabase/migrations/20260813020000_metricas_en_confirmacion.sql`). Hace
 * tres cosas, ninguna de las cuales puede vivir del lado de la base sin
 * perder legibilidad:
 *
 *   1. Resuelve el nombre canónico con `normalizarMetrica`
 *      (`lib/laboratorio/diccionario.ts`).
 *   2. Parsea el rango de referencia textual a `reference_min`/`reference_max`
 *      cuando tiene forma numérica reconocible.
 *   3. Deduplica dentro del MISMO documento: dos métricas que resuelven al
 *      mismo nombre (canónico, o el nombre limpio si no hay canónico) violan
 *      el `UNIQUE (document_id, metric_name)` de `lab_metrics` si se manda
 *      dos veces el mismo `metric_name` — y aunque no lo violaran, dos
 *      "Glucosa" el mismo día no son dos mediciones reales, son la misma
 *      métrica leída dos veces del documento. Gana la PRIMERA aparición.
 *   4. Acepta un resultado CUALITATIVO ("Negativo", "No reactivo") cuando no
 *      hay valor numérico (Sprint 18): antes se descartaba en silencio
 *      cualquier métrica sin `valor` numérico -perdiendo resultados
 *      clínicamente importantes que el estudio SÍ trae-; ahora se guarda en
 *      `value_text` si `metrica.valorTexto` viene con texto. Ver
 *      `FilaLabMetricPreparada` para el contrato exacto (al menos uno de
 *      `value`/`value_text`, nunca los dos `null`).
 *
 * Es un módulo puro: no toca Supabase ni hace red, para poder testearlo sin
 * mocks (`tests/unit/laboratorio.test.ts`). La ÚLTIMA palabra de validación
 * es igual el RPC — ver el comentario de esa migración — así que acá no hace
 * falta (ni conviene) repetir cada guarda con el mismo nivel de paranoia.
 */

import { normalizarMetrica, normalizarTexto } from '@/lib/laboratorio/diccionario'
import type { MetricaExtraida } from '@/lib/gemini/schemas'

/**
 * Fila lista para insertar en `lab_metrics` (mismos nombres de columna, sin
 * `id`/`profile_id`/`document_id`: esos los completa el llamador).
 *
 * `value`/`value_text` son mutuamente opcionales pero no mutuamente
 * excluyentes -mismo contrato que el CHECK `lab_metrics_valor_o_texto`
 * (`supabase/migrations/20260819190000_lab_metrics_resultados_cualitativos.sql`):
 * al menos uno de los dos no es `null`, nunca los dos-. Ver el comentario de
 * `prepararMetricas` para cómo se decide cuál se completa.
 */
export interface FilaLabMetricPreparada {
  metric_name: string
  metric_canonical: string | null
  value: number | null
  value_text: string | null
  unit: string | null
  reference_range: string | null
  reference_min: number | null
  reference_max: number | null
  /** Fecha CONFIRMADA del documento (ver el encabezado del archivo), no la fecha original detectada por la IA. */
  measurement_date: string
}

export interface MetricaDuplicada {
  /** Nombre tal como venía en la métrica descartada. */
  nombre: string
  /** Clave de deduplicación por la que se consideró repetida (canónico o nombre limpio normalizado). */
  claveDedup: string
}

export interface ResultadoPrepararMetricas {
  filas: FilaLabMetricPreparada[]
  duplicadas: MetricaDuplicada[]
}

const NUM = '(-?\\d+(?:[.,]\\d+)?)'
const PATRON_RANGO = new RegExp(`^${NUM}\\s*-\\s*${NUM}`)
const PATRON_DE_A = new RegExp(`^de\\s+${NUM}\\s+a\\s+${NUM}`, 'i')
const PATRON_MENOR = new RegExp(`^<\\s*=?\\s*${NUM}`)
const PATRON_MENOR_PALABRA = new RegExp(`^menor\\s+(?:a|de|que)\\s+${NUM}`, 'i')
const PATRON_HASTA = new RegExp(`^hasta\\s+${NUM}`, 'i')
const PATRON_MAYOR = new RegExp(`^>\\s*=?\\s*${NUM}`)
const PATRON_MAYOR_PALABRA = new RegExp(`^mayor\\s+(?:a|de|que)\\s+${NUM}`, 'i')

/**
 * Palabras que, en un rango MULTILÍNEA/multi-etiqueta ("Deficiencia: menor a
 * 10.0 / Insuficiencia: menor a 30.0 / Suficiencia: de 30.00 a 100.0"),
 * marcan cuál de los segmentos es el rango de NORMALIDAD -el que hay que
 * usar- y no una categoría de severidad. `\b` (límite de palabra) es
 * necesario: "insuficiencia" contiene "suficiencia" como substring y NO
 * tiene que matchear.
 */
const PALABRAS_NORMALIDAD = ['normal', 'suficiencia', 'deseable', 'optimo', 'adecuado', 'recomendado']

/** Separador de segmentos en un rango multi-etiqueta: salto de línea, o " / " con espacios (no "mg/dl"). */
const SEPARADOR_SEGMENTOS = /\r?\n|\s+\/\s+/

function aNumero(crudo: string): number {
  return Number(crudo.replace(',', '.'))
}

/** ¿Este segmento está marcado como el rango "normal" (ver `PALABRAS_NORMALIDAD`)? */
function segmentoEsNormal(segmento: string): boolean {
  const normalizado = normalizarTexto(segmento)
  return PALABRAS_NORMALIDAD.some((palabra) => new RegExp(`\\b${palabra}\\b`).test(normalizado))
}

/**
 * Quita un prefijo de ETIQUETA CUALITATIVA seguido de dos puntos ("Valor
 * óptimo: menor a 100" → "menor a 100", "Deseable: menor de 200" → "menor de
 * 200"). Sin el prefijo, el resto del texto queda intacto.
 */
function quitarPrefijoEtiqueta(texto: string): string {
  const conPrefijo = texto.match(/^[\p{L}\s]{1,40}:\s*(.+)$/u)
  return conPrefijo ? conPrefijo[1] : texto
}

/** El texto ya empieza con algo que un patrón numérico reconoce (número, comparador o palabra clave). */
const PATRON_INICIO_RECONOCIDO = /^(?:[<>]|-?\d|menor\b|mayor\b|hasta\b|de\s+-?\d)/i

/**
 * Quita una PRIMERA PALABRA cualitativa que antecede al umbral sin dos
 * puntos ("Negativo < 5.0" → "< 5.0"). Solo actúa cuando el texto NO
 * arranca ya con algo reconocible -así no le come la palabra "hasta" ni
 * "menor"/"mayor" a los patrones que las necesitan-.
 */
function quitarPrefijoCualitativo(texto: string): string {
  if (PATRON_INICIO_RECONOCIDO.test(texto)) return texto
  const sinPrimeraPalabra = texto.replace(/^[^\s<>=\d]+[\s:]*/, '')
  return sinPrimeraPalabra || texto
}

interface LimitesParseados {
  reference_min: number | null
  reference_max: number | null
}

/**
 * Intenta las siete formas numéricas reconocidas sobre UN segmento (ya sin
 * saltos de línea ni etiquetas de severidad). `null` si ninguna matchea.
 */
function intentarParsearSegmento(segmentoOriginal: string): LimitesParseados | null {
  const segmento = quitarPrefijoCualitativo(quitarPrefijoEtiqueta(segmentoOriginal))

  const rango = segmento.match(PATRON_RANGO)
  if (rango) {
    const min = aNumero(rango[1])
    const max = aNumero(rango[2])
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      return { reference_min: min, reference_max: max }
    }
  }

  const deA = segmento.match(PATRON_DE_A)
  if (deA) {
    const min = aNumero(deA[1])
    const max = aNumero(deA[2])
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      return { reference_min: min, reference_max: max }
    }
  }

  const menor = segmento.match(PATRON_MENOR)
  if (menor) {
    const max = aNumero(menor[1])
    if (Number.isFinite(max)) return { reference_min: null, reference_max: max }
  }

  const menorPalabra = segmento.match(PATRON_MENOR_PALABRA)
  if (menorPalabra) {
    const max = aNumero(menorPalabra[1])
    if (Number.isFinite(max)) return { reference_min: null, reference_max: max }
  }

  const hasta = segmento.match(PATRON_HASTA)
  if (hasta) {
    const max = aNumero(hasta[1])
    if (Number.isFinite(max)) return { reference_min: null, reference_max: max }
  }

  const mayor = segmento.match(PATRON_MAYOR)
  if (mayor) {
    const min = aNumero(mayor[1])
    if (Number.isFinite(min)) return { reference_min: min, reference_max: null }
  }

  const mayorPalabra = segmento.match(PATRON_MAYOR_PALABRA)
  if (mayorPalabra) {
    const min = aNumero(mayorPalabra[1])
    if (Number.isFinite(min)) return { reference_min: min, reference_max: null }
  }

  return null
}

export interface RangoParseado {
  reference_range: string | null
  reference_min: number | null
  reference_max: number | null
}

/**
 * Parsea un rango de referencia textual a límites numéricos. Formas
 * reconocidas (todas admiten coma decimal, "70 - 110"/"70,5 - 110,2", y
 * unidad pegada, "< 200 mg/dl" — los patrones no exigen que la cadena
 * TERMINE en el número):
 *
 *   - Intervalo con guion: "70 - 110".
 *   - Intervalo en palabras: "de 13,5 a 17,0".
 *   - Techo con "<"/"<=": "< 200", "<= 200".
 *   - Techo en palabras: "hasta 200", "menor a 45", "menor de 200".
 *   - Piso con ">"/">=": ">= 40", "> 40".
 *   - Piso en palabras: "mayor a 40", "mayor de 40".
 *
 * Sobre esas siete formas, dos capas más ANTES de intentar matchear (ver
 * `quitarPrefijoEtiqueta`/`quitarPrefijoCualitativo`): un prefijo de
 * ETIQUETA con dos puntos ("Valor óptimo: menor a 100") y una palabra
 * cualitativa suelta antes del umbral ("Negativo < 5.0"). Ninguna de las dos
 * toca `reference_range`: el texto que se persiste es SIEMPRE el original
 * completo, la limpieza es solo para encontrar el número.
 *
 * Y una capa MULTILÍNEA (ver `SEPARADOR_SEGMENTOS`/`segmentoEsNormal`) para
 * el caso de un laboratorio que imprime varios niveles de severidad
 * ("Deficiencia: menor a 10.0 / Insuficiencia: menor a 30.0 / Suficiencia:
 * de 30.00 a 100.0"): se usa el segmento marcado como normal/deseable si hay
 * exactamente uno, o -si ninguna etiqueta lo distingue sin ambigüedad- se
 * prueba desde el ÚLTIMO segmento hacia el primero, porque los laboratorios
 * argentinos ordenan de mayor a menor severidad y terminan en el rango sano.
 *
 * Si nada matchea, se conserva el texto tal cual en `reference_range` y los
 * límites quedan en `null` — no es un error, es un rango que solo un humano
 * puede interpretar ("según método", "no aplica").
 */
export function parsearRangoReferencia(rangoCrudo: string | null | undefined): RangoParseado {
  const texto = rangoCrudo?.trim()
  if (!texto) {
    return { reference_range: null, reference_min: null, reference_max: null }
  }

  const segmentos = texto
    .split(SEPARADOR_SEGMENTOS)
    .map((segmento) => segmento.trim())
    .filter(Boolean)

  if (segmentos.length <= 1) {
    const limites = intentarParsearSegmento(texto)
    return limites
      ? { reference_range: texto, ...limites }
      : { reference_range: texto, reference_min: null, reference_max: null }
  }

  // Multi-segmento: preferir el ÚNICO marcado como normal; si no hay uno
  // solo inequívoco, probar de atrás para adelante (ver el porqué arriba).
  const normales = segmentos.filter(segmentoEsNormal)
  const ordenIntento =
    normales.length === 1
      ? [normales[0], ...[...segmentos].reverse().filter((s) => s !== normales[0])]
      : [...segmentos].reverse()

  for (const segmento of ordenIntento) {
    const limites = intentarParsearSegmento(segmento)
    if (limites) return { reference_range: texto, ...limites }
  }

  return { reference_range: texto, reference_min: null, reference_max: null }
}

/**
 * Normaliza y deduplica las métricas de una extracción para dejarlas listas
 * para `lab_metrics`.
 *
 * `metricas` se tipa laxo (`unknown` en cada campo vía `Partial`) a
 * propósito: en la práctica llega parseada de un campo oculto del formulario
 * (`JSON.parse` de un string que viajó por HTTP), no de una llamada directa a
 * Gemini con el tipo ya garantizado por TypeScript. Un item con forma
 * incorrecta se descarta en silencio -no aborta el resto del documento- y el
 * RPC repite la validación fuerte del lado de la base (defensa en profundidad,
 * mismo criterio que el resto del flujo de confirmación).
 *
 * @param fechaDocumento Fecha YA CONFIRMADA del documento (`YYYY-MM-DD`), no
 *   la fecha que trajo la extracción de la IA: es la que efectivamente queda
 *   en `documents.document_date` tras la confirmación.
 */
export function prepararMetricas(
  metricas: readonly Partial<MetricaExtraida>[] | null | undefined,
  fechaDocumento: string,
): ResultadoPrepararMetricas {
  const filas: FilaLabMetricPreparada[] = []
  const duplicadas: MetricaDuplicada[] = []
  const vistos = new Set<string>()

  for (const metrica of metricas ?? []) {
    if (!metrica || typeof metrica !== 'object') continue

    const nombreCrudo = typeof metrica.nombre === 'string' ? metrica.nombre.trim() : ''
    if (!nombreCrudo) continue

    // Valor numérico O resultado cualitativo (Sprint 18): una métrica sin
    // NINGUNO de los dos no tiene nada que guardar -mismo descarte
    // silencioso que antes hacía "sin valor numérico", mismo criterio de
    // "el resto del documento sigue"-. `valorTexto` viene de
    // `MetricaExtraida.valorTexto` (ver su comentario: hoy solo lo puebla un
    // llamador que no pasa por la extracción en vivo de Gemini, ver deuda en
    // el Resumen de Entrega del Sprint 18).
    const valorNumerico =
      typeof metrica.valor === 'number' && Number.isFinite(metrica.valor) ? metrica.valor : null
    const valorTexto =
      typeof metrica.valorTexto === 'string' && metrica.valorTexto.trim().length > 0
        ? metrica.valorTexto.trim()
        : null
    if (valorNumerico === null && valorTexto === null) continue

    const { canonico } = normalizarMetrica(nombreCrudo)
    const claveDedup = normalizarTexto(canonico ?? nombreCrudo)

    if (vistos.has(claveDedup)) {
      duplicadas.push({ nombre: nombreCrudo, claveDedup })
      console.warn(
        `[laboratorio] Métrica duplicada dentro del mismo documento -se descarta la repetida-: "${nombreCrudo}" (clave "${claveDedup}").`,
      )
      continue
    }
    vistos.add(claveDedup)

    const unidad = typeof metrica.unidad === 'string' ? metrica.unidad.trim() : ''
    const { reference_range, reference_min, reference_max } = parsearRangoReferencia(
      typeof metrica.rango === 'string' ? metrica.rango : null,
    )

    filas.push({
      metric_name: nombreCrudo,
      metric_canonical: canonico,
      value: valorNumerico,
      value_text: valorTexto,
      unit: unidad || null,
      reference_range,
      reference_min,
      reference_max,
      measurement_date: fechaDocumento,
    })
  }

  return { filas, duplicadas }
}
