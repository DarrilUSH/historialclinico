/**
 * Resumen de "último valor" para una serie de métrica de laboratorio
 * (Sprint 5, tarea 5.2). Lógica pura, sin dependencia de Supabase.
 *
 * Dado una serie temporal de mediciones de una métrica, calcula:
 * - El valor más reciente con su fecha y unidad.
 * - Señal de rango (dentro/fuera de rango de referencia).
 * - Variación vs. la medición anterior (dirección y diferencia), o
 *   ninguna si solo hay una (ver `esMedicionUnica`).
 *
 * Con una sola medición NO se inventa tendencia: la flecha no se muestra.
 * La dirección es informativa (solo dice "subió" o "bajó"), nunca semántica
 * ("bueno" o "malo") — eso lo decide el rango de referencia del badge,
 * independiente.
 *
 * `esMedicionUnica` (pedido en vivo del usuario, 2026-08-19: "si solo existe
 * una medición que aclare que es la única medición") es la misma condición
 * que ya usaba `resumenUltimoValor` para dejar `variacion` en `null`, ahora
 * nombrada aparte y exportada: antes `components/estudios/tarjeta-ultimo-valor.tsx`
 * la infería indirectamente (`!resumen.variacion`) para mostrar "Primera
 * medición"; con el diálogo de detalle nuevo (`dialogo-detalle-metrica.tsx`)
 * la misma pregunta hace falta en un segundo lugar, así que pasa a ser una
 * función con nombre propio en vez de repetir la inferencia indirecta.
 */

export interface PuntoMedicion {
  valor: number
  fecha: string
  unidad: string | null
  min: number | null
  max: number | null
}

export type DireccionVariacion = "subio" | "bajo" | "igual"

export interface Variacion {
  direccion: DireccionVariacion
  diferencia: number
  diferenciaPorcentaje?: number
}

export interface ResumenUltimoValor {
  /** El valor más reciente. */
  valor: number
  /** Unidad de la medición (puede ser null). */
  unidad: string | null
  /** Fecha de la medición más reciente, formato `YYYY-MM-DD`. */
  fecha: string
  /**
   * Rango dentro/fuera de referencia: `true` si está en rango, `false` si fuera.
   * `null` si no hay rango de referencia definido (no mostrar badge).
   */
  enRango: boolean | null
  /**
   * Variación vs. la medición anterior: flecha, diferencia y unidad.
   * `null` si hay una sola medición (mostrar "Primera medición" en vez de flecha).
   */
  variacion: Variacion | null
}

/**
 * ¿El valor cae dentro del rango de referencia?
 * Mismo criterio que `estaFueraDeRango` en `lib/laboratorio/series.ts`.
 */
function estaEnRango(valor: number, min: number | null, max: number | null): boolean {
  if (min !== null && valor < min) return false
  if (max !== null && valor > max) return false
  return true
}

/**
 * Calcula la variación entre dos valores consecutivos.
 * Devuelve la dirección (subio/bajo/igual) y la diferencia con signo.
 */
function calcularVariacion(ultimoValor: number, penultimoValor: number): Variacion {
  const diferencia = ultimoValor - penultimoValor
  const diferenciaPorcentaje =
    penultimoValor !== 0 ? Math.round((diferencia / penultimoValor) * 100) : undefined

  if (diferencia > 0) {
    return {
      direccion: "subio",
      diferencia: Math.round(diferencia * 100) / 100,
      diferenciaPorcentaje,
    }
  } else if (diferencia < 0) {
    return {
      direccion: "bajo",
      diferencia: Math.round(Math.abs(diferencia) * 100) / 100,
      diferenciaPorcentaje,
    }
  } else {
    return {
      direccion: "igual",
      diferencia: 0,
    }
  }
}

/**
 * ¿Es esta la única medición en `puntos`? Genérica en el elemento a
 * propósito -la usan tanto `PuntoMedicion[]` (tarjeta) como `PuntoSerie[]`
 * (`lib/laboratorio/series.ts`, diálogo de detalle), y las dos veces la
 * pregunta es exactamente "¿el arreglo tiene largo 1?", sin tocar ningún
 * campo particular del punto-.
 */
export function esMedicionUnica(puntos: readonly unknown[]): boolean {
  return puntos.length === 1
}

/**
 * Resumen de "último valor" para una serie de mediciones.
 *
 * @param puntos Array ordenado por fecha (ascendente, más viejo primero).
 *               Debe tener al menos 1 punto.
 * @returns Resumen con último valor, rango, y variación vs. anterior (o null si es la única).
 */
export function resumenUltimoValor(puntos: readonly PuntoMedicion[]): ResumenUltimoValor {
  if (puntos.length === 0) {
    throw new Error("resumenUltimoValor: array vacío")
  }

  const ultimo = puntos[puntos.length - 1]!
  const enRango =
    ultimo.min !== null || ultimo.max !== null
      ? estaEnRango(ultimo.valor, ultimo.min, ultimo.max)
      : null

  let variacion: Variacion | null = null
  if (puntos.length >= 2) {
    const penultimo = puntos[puntos.length - 2]!
    variacion = calcularVariacion(ultimo.valor, penultimo.valor)
  }

  return {
    valor: ultimo.valor,
    unidad: ultimo.unidad,
    fecha: ultimo.fecha,
    enRango,
    variacion,
  }
}
