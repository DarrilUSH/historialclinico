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
 *
 * Es un módulo puro: no toca Supabase ni hace red, para poder testearlo sin
 * mocks (`tests/unit/laboratorio.test.ts`). La ÚLTIMA palabra de validación
 * es igual el RPC — ver el comentario de esa migración — así que acá no hace
 * falta (ni conviene) repetir cada guarda con el mismo nivel de paranoia.
 */

import { normalizarMetrica, normalizarTexto } from '@/lib/laboratorio/diccionario'
import type { MetricaExtraida } from '@/lib/gemini/schemas'

/** Fila lista para insertar en `lab_metrics` (mismos nombres de columna, sin `id`/`profile_id`/`document_id`: esos los completa el llamador). */
export interface FilaLabMetricPreparada {
  metric_name: string
  metric_canonical: string | null
  value: number
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

const PATRON_RANGO = /^(-?\d+(?:[.,]\d+)?)\s*-\s*(-?\d+(?:[.,]\d+)?)/
const PATRON_MENOR = /^<\s*=?\s*(-?\d+(?:[.,]\d+)?)/
const PATRON_HASTA = /^hasta\s+(-?\d+(?:[.,]\d+)?)/i
const PATRON_MAYOR = /^>\s*=?\s*(-?\d+(?:[.,]\d+)?)/

function aNumero(crudo: string): number {
  return Number(crudo.replace(',', '.'))
}

export interface RangoParseado {
  reference_range: string | null
  reference_min: number | null
  reference_max: number | null
}

/**
 * Parsea un rango de referencia textual a límites numéricos cuando tiene una
 * de las cuatro formas que traen los estudios argentinos:
 *
 *   - Intervalo: "70 - 110" (admite coma decimal: "4,5 - 5,5")
 *   - Techo con "<" o "<=": "< 200", "<= 200"
 *   - Techo en palabras: "hasta 200"
 *   - Piso con ">" o ">=": ">= 40", "> 40"
 *
 * El texto puede traer la unidad pegada ("70 - 110 mg/dl"): los patrones no
 * exigen que la cadena TERMINE en el número, así que el sufijo se ignora.
 *
 * Si no matchea ninguna forma, se conserva el texto tal cual en
 * `reference_range` y los límites quedan en `null` — no es un error, es un
 * rango que solo un humano puede interpretar ("según método", "no aplica").
 */
export function parsearRangoReferencia(rangoCrudo: string | null | undefined): RangoParseado {
  const texto = rangoCrudo?.trim()
  if (!texto) {
    return { reference_range: null, reference_min: null, reference_max: null }
  }

  const rango = texto.match(PATRON_RANGO)
  if (rango) {
    const min = aNumero(rango[1])
    const max = aNumero(rango[2])
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      return { reference_range: texto, reference_min: min, reference_max: max }
    }
  }

  const menor = texto.match(PATRON_MENOR)
  if (menor) {
    const max = aNumero(menor[1])
    if (Number.isFinite(max)) {
      return { reference_range: texto, reference_min: null, reference_max: max }
    }
  }

  const hasta = texto.match(PATRON_HASTA)
  if (hasta) {
    const max = aNumero(hasta[1])
    if (Number.isFinite(max)) {
      return { reference_range: texto, reference_min: null, reference_max: max }
    }
  }

  const mayor = texto.match(PATRON_MAYOR)
  if (mayor) {
    const min = aNumero(mayor[1])
    if (Number.isFinite(min)) {
      return { reference_range: texto, reference_min: min, reference_max: null }
    }
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

    if (typeof metrica.valor !== 'number' || !Number.isFinite(metrica.valor)) continue

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
      value: metrica.valor,
      unit: unidad || null,
      reference_range,
      reference_min,
      reference_max,
      measurement_date: fechaDocumento,
    })
  }

  return { filas, duplicadas }
}
