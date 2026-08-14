/**
 * Motor de evaluación de umbrales clínicos (Sprint 9, tarea 9.2 —
 * ROADMAP_SPRINTS.md).
 *
 * Módulo **puro**: sin IO, sin Supabase, sin reloj. Recibe una medición, los
 * umbrales ya resueltos (`lib/signos/umbrales.ts`) y —solo para peso— el
 * historial reciente, y devuelve la lista de reglas violadas con todo lo que
 * hace falta para persistir la alerta y para escribir el banner de la 9.3.
 * Quien lo llama es `lib/signos/registrar-alertas.ts`; quien lo prueba es
 * `tests/unit/umbrales.test.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  EL BORDE: EL UMBRAL PERTENECE SIEMPRE AL LADO QUE ALERTA (≥ / ≤)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El criterio de aceptación del ROADMAP lo pide explícito: *"16/10 exacto
 * dispara según la regla definida y queda documentado si el límite es
 * inclusivo"*. **Es inclusivo.** 160/100 exactos DISPARAN las dos alertas;
 * 159/99 no disparan ninguna.
 *
 * Y la inclusividad es **uniforme para las cuatro comparaciones**, no solo para
 * la presión:
 *
 * | Regla | Dispara cuando | 160 / 100 / 70 / 250 exactos |
 * |---|---|---|
 * | `sistolica_alta`  | `sistólica >= sistolicaMax`  | dispara |
 * | `diastolica_alta` | `diastólica >= diastolicaMax`| dispara |
 * | `glucemia_baja`   | `glucemia  <= glucemiaMin`   | dispara |
 * | `glucemia_alta`   | `glucemia  >= glucemiaMax`   | dispara |
 * | `peso_variacion`  | `|Δ|       >= pesoVariacionKg` | dispara |
 *
 * Dos razones, y la segunda pesa más que la primera:
 *
 * 1. **Una sola regla es una regla que se recuerda.** La alternativa era la
 *    lectura literal del ejemplo del ROADMAP ("sistólica ≥ 160 … glucemia < 70
 *    o > 250"), que mezcla inclusivo para presión y exclusivo para glucemia. Un
 *    motor con dos convenciones de borde es una fábrica de errores off-by-one:
 *    nadie recuerda cuál columna era cuál a los seis meses. Acá los umbrales se
 *    llaman `max`/`min` porque son **umbrales de alerta** —el primer valor que
 *    ya preocupa—, no los extremos del rango normal.
 * 2. **La asimetría del costo.** Un falso positivo cuesta que alguien mire un
 *    número. Un falso negativo cuesta que nadie lo mire. Ante la duda de un
 *    borde exacto, un aviso orientativo tiene que caer del lado de avisar. Y
 *    los defaults elegidos acompañan esa lectura: 70 mg/dL es literalmente el
 *    *alert value* de hipoglucemia de la ADA —el valor en el que hay que actuar,
 *    no el primero por debajo—, y 250 mg/dL es la zona en la que la guía ya
 *    indica control de cetonas.
 *
 * Quien necesite el corte exclusivo tiene la herramienta sin tocar código:
 * `vital_sign_thresholds` es por perfil, y un `glucemia_min` de 69 reproduce
 * exactamente el "< 70".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  LO QUE ESTE MOTOR NO HACE: EL VALOR IMPOSIBLE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Una sistólica de 500, una glucemia de −3 o un peso de 0 **nunca llegan
 * hasta acá**. Los frenan dos capas anteriores e independientes:
 *
 *   · `lib/validacion/signo.schema.ts` (Zod), que devuelve el error a la
 *     pantalla antes de gastar el viaje de red.
 *   · Los `CHECK` de `vital_signs` (`20260812200000_schema_inicial.sql` §4.9):
 *     `vital_signs_sistolica_plausible` (50–300),
 *     `vital_signs_diastolica_plausible` (30–200),
 *     `vital_signs_sistolica_mayor_diastolica`, `vital_signs_pulso_plausible`
 *     y `vital_signs_valor_positivo`.
 *
 * La separación es deliberada: **plausibilidad ≠ peligro**. Este motor opera
 * sobre lo *plausible pero peligroso*; si además rechazara lo implausible
 * habría dos definiciones del rango válido y un día no coincidirían. La
 * consecuencia práctica es que el motor no valida: si igual recibiera un valor
 * ausente o no finito, no inventa una alerta (comparar contra `undefined` da
 * `false`) y tampoco lanza — devuelve la lista vacía y la carga sigue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  EL DESCARGO VA EN TODOS LOS MENSAJES, SIEMPRE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * "Los umbrales son orientativos, no diagnóstico: el texto debe decirlo"
 * (ROADMAP). Todo `mensaje` que sale de acá termina con `DESCARGO_CLINICO`, y
 * la base lo hace cumplir con `vital_sign_alerts_mensaje_con_descargo`: una
 * alerta sin el descargo no se puede persistir.
 */

import type { SignoTipo } from "@/lib/signos/tipos"
import type { UmbralesSignos } from "@/lib/signos/umbrales"

/**
 * La frase que cierra el texto de toda alerta. El fragmento "no reemplaza el
 * criterio médico" es el que verifica el `CHECK` de la base: la redacción de
 * alrededor se puede mejorar sin una migración, ese pedazo no.
 */
export const DESCARGO_CLINICO = "Valor orientativo — no reemplaza el criterio médico."

/** Las cinco reglas del enum `public.vital_sign_alert_rule`. */
export type ReglaAlerta =
  | "sistolica_alta"
  | "diastolica_alta"
  | "glucemia_baja"
  | "glucemia_alta"
  | "peso_variacion"

/** La medición a evaluar, con los campos ya tipados (nunca la fila cruda de Supabase). */
export interface MedicionAEvaluar {
  tipo: SignoTipo
  /** Solo en `tension`. */
  systolic?: number | null
  /** Solo en `tension`. */
  diastolic?: number | null
  /** Glucemia en mg/dL o peso en kg, según el tipo. */
  value?: number | null
  /** `measured_at` en ISO. Define el extremo derecho de la ventana de peso. */
  measuredAt: string
}

/** Una medición de peso anterior, para la ventana de referencia. */
export interface PesoPrevio {
  /** Kilos. */
  valor: number
  /** `measured_at` en ISO. */
  measuredAt: string
}

/** Una regla violada: lo que se persiste en `vital_sign_alerts` y lo que lee el banner. */
export interface ReglaViolada {
  regla: ReglaAlerta
  tipo: SignoTipo
  /** Valor observado, en la unidad de la regla. En `peso_variacion` es el peso nuevo, no la diferencia. */
  valor: number
  /** Umbral aplicado. Se persiste para que cambiarlo mañana no reescriba esta alerta. */
  umbral: number
  /** Solo en `peso_variacion`: la mediana de la ventana. `null` en el resto. */
  referencia: number | null
  /** Texto ya redactado, con el descargo. Es lo que se guarda y lo que se muestra. */
  mensaje: string
}

/**
 * Tolerancia de la comparación de bordes. `82.3 - 80.3` da `1.9999999999999996`
 * en coma flotante binaria: sin esta épsilon, "2 kg exactos disparan" sería
 * verdad o mentira según los decimales de la balanza, que es la peor forma
 * posible de definir un umbral clínico. Es 1e-9 kg —un microgramo— así que no
 * puede cambiar ningún caso real.
 */
const EPSILON = 1e-9

const MS_POR_DIA = 86_400_000

/** `a >= b` tolerante al ruido binario (ver `EPSILON`). */
function alcanza(a: number, b: number): boolean {
  return a - b >= -EPSILON
}

function esNumero(valor: number | null | undefined): valor is number {
  return typeof valor === "number" && Number.isFinite(valor)
}

const FORMATO = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 })

/** Coma decimal y sin ceros de relleno: "160", "82,5", "2". */
function n(valor: number): string {
  return FORMATO.format(valor)
}

/**
 * La mediana de una lista de números. Con cantidad par promedia los dos
 * centrales, que es la definición estándar. Devuelve `null` con lista vacía:
 * "no hay referencia" es un estado, no un cero.
 */
export function mediana(valores: readonly number[]): number | null {
  const ordenados = valores.filter(esNumero).slice().sort((a, b) => a - b)
  if (ordenados.length === 0) return null

  const medio = Math.floor(ordenados.length / 2)
  return ordenados.length % 2 === 1
    ? ordenados[medio]!
    : (ordenados[medio - 1]! + ordenados[medio]!) / 2
}

/**
 * Los pesos que caen dentro de la ventana de referencia: **estrictamente
 * anteriores** a la medición nueva y no más viejos que `ventanaDias`.
 *
 * El extremo izquierdo es inclusivo (una medición de hace exactamente 7 días
 * cuenta como "de los últimos 7 días") y el derecho es exclusivo, lo que hace
 * que la propia medición que se está evaluando nunca se cuele en su propia
 * referencia aunque el llamador la incluya en la lista.
 */
export function pesosEnVentana(
  historial: readonly PesoPrevio[],
  measuredAtNuevo: string,
  ventanaDias: number,
): number[] {
  const hasta = Date.parse(measuredAtNuevo)
  if (!Number.isFinite(hasta)) return []

  const desde = hasta - ventanaDias * MS_POR_DIA

  return historial
    .filter((previo) => {
      if (!esNumero(previo.valor) || previo.valor <= 0) return false
      const momento = Date.parse(previo.measuredAt)
      return Number.isFinite(momento) && momento >= desde && momento < hasta
    })
    .map((previo) => previo.valor)
}

function mensajeTension(
  etiqueta: "sistólica" | "diastólica",
  valor: number,
  umbral: number,
): string {
  return `Presión ${etiqueta} alta: ${n(valor)} mmHg (umbral de alerta: ${n(umbral)}). ${DESCARGO_CLINICO}`
}

function mensajeGlucemia(direccion: "baja" | "alta", valor: number, umbral: number): string {
  return `Glucemia ${direccion}: ${n(valor)} mg/dL (umbral de alerta: ${n(umbral)}). ${DESCARGO_CLINICO}`
}

function mensajePeso(
  valor: number,
  referencia: number,
  umbral: number,
  ventanaDias: number,
): string {
  const delta = valor - referencia
  const direccion = delta >= 0 ? "más" : "menos"
  const dias = ventanaDias === 1 ? "del último día" : `de los últimos ${n(ventanaDias)} días`
  return (
    `Peso ${n(valor)} kg: ${n(Math.abs(delta))} kg ${direccion} que la referencia ` +
    `${dias} (${n(referencia)} kg; umbral de alerta: ${n(umbral)} kg). ` +
    DESCARGO_CLINICO
  )
}

/**
 * Evalúa una medición contra los umbrales del perfil y devuelve **todas** las
 * reglas que viola, no la primera.
 *
 * Que devuelva varias importa: 160/100 viola `sistolica_alta` y
 * `diastolica_alta`, y son dos hechos distintos para quien atiende —una
 * sistólica alta con diastólica normal no es lo mismo que las dos altas—. La
 * base admite las dos filas y la antiduplicación es por `(medición, regla)`,
 * justamente para esto.
 *
 * @param historialPesoReciente mediciones de peso ANTERIORES del mismo perfil,
 *   sin filtrar por fecha: la ventana la aplica este motor
 *   (`pesosEnVentana`) para que la regla sea verificable sin base. Se ignora en
 *   los otros dos tipos.
 */
export function evaluarSigno(
  medicion: MedicionAEvaluar,
  umbrales: UmbralesSignos,
  historialPesoReciente: readonly PesoPrevio[] = [],
): ReglaViolada[] {
  const violadas: ReglaViolada[] = []

  if (medicion.tipo === "tension") {
    if (esNumero(medicion.systolic) && alcanza(medicion.systolic, umbrales.sistolicaMax)) {
      violadas.push({
        regla: "sistolica_alta",
        tipo: "tension",
        valor: medicion.systolic,
        umbral: umbrales.sistolicaMax,
        referencia: null,
        mensaje: mensajeTension("sistólica", medicion.systolic, umbrales.sistolicaMax),
      })
    }

    if (esNumero(medicion.diastolic) && alcanza(medicion.diastolic, umbrales.diastolicaMax)) {
      violadas.push({
        regla: "diastolica_alta",
        tipo: "tension",
        valor: medicion.diastolic,
        umbral: umbrales.diastolicaMax,
        referencia: null,
        mensaje: mensajeTension("diastólica", medicion.diastolic, umbrales.diastolicaMax),
      })
    }

    return violadas
  }

  if (medicion.tipo === "glucemia") {
    if (!esNumero(medicion.value)) return violadas

    // Las dos ramas son excluyentes por construcción: el CHECK
    // `vital_sign_thresholds_glucemia_min_menor_max` impide configurar un
    // rango invertido que las hiciera ciertas a la vez.
    if (alcanza(umbrales.glucemiaMin, medicion.value)) {
      violadas.push({
        regla: "glucemia_baja",
        tipo: "glucemia",
        valor: medicion.value,
        umbral: umbrales.glucemiaMin,
        referencia: null,
        mensaje: mensajeGlucemia("baja", medicion.value, umbrales.glucemiaMin),
      })
    } else if (alcanza(medicion.value, umbrales.glucemiaMax)) {
      violadas.push({
        regla: "glucemia_alta",
        tipo: "glucemia",
        valor: medicion.value,
        umbral: umbrales.glucemiaMax,
        referencia: null,
        mensaje: mensajeGlucemia("alta", medicion.value, umbrales.glucemiaMax),
      })
    }

    return violadas
  }

  // Peso. Sin referencia en la ventana no hay regla: la primera vez que alguien
  // se pesa no puede haber "variación", y decir que sí sería inventar un dato.
  if (!esNumero(medicion.value)) return violadas

  const referencia = mediana(
    pesosEnVentana(historialPesoReciente, medicion.measuredAt, umbrales.pesoVentanaDias),
  )
  if (referencia === null) return violadas

  const delta = Math.abs(medicion.value - referencia)
  if (alcanza(delta, umbrales.pesoVariacionKg)) {
    violadas.push({
      regla: "peso_variacion",
      tipo: "peso",
      valor: medicion.value,
      umbral: umbrales.pesoVariacionKg,
      referencia,
      mensaje: mensajePeso(
        medicion.value,
        referencia,
        umbrales.pesoVariacionKg,
        umbrales.pesoVentanaDias,
      ),
    })
  }

  return violadas
}
