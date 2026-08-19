/**
 * Tests unitarios de `lib/laboratorio/series.ts` y `lib/laboratorio/periodo.ts`
 * (Sprint 5, tarea 5.4).
 *
 * Cubre:
 * - Agrupación por métrica canónica, incluyendo el mismatch de casing entre
 *   `supabase/seed.sql` y el pipeline real de confirmación (ver el
 *   encabezado de `series.ts`).
 * - Orden de puntos dentro de cada serie y de series entre sí.
 * - `fueraDeRango` y `metricasDisponibles` (última medición).
 * - Corte de período (`calcularFechaCorte`) con fecha fija, incluyendo el
 *   límite exacto.
 * - `contarEstudiosDistintos` y el aviso de "muestra chica"
 *   (`debeAvisarMuestraChica`/`mensajeMuestraChica`), sumados en la mejora
 *   de tendencias del 2026-08-19 (ver el encabezado de `periodo.ts`).
 *
 *   npm run test -- series-laboratorio
 */

import { describe, it, expect } from "vitest"

import {
  agruparEnSeries,
  contarEstudiosDistintos,
  estaFueraDeRango,
  obtenerMetricasDisponibles,
  type FilaLabMetrica,
} from "@/lib/laboratorio/series"
import {
  calcularFechaCorte,
  debeAvisarMuestraChica,
  mensajeMuestraChica,
  parsearPeriodo,
  UMBRAL_MUESTRA_CHICA,
} from "@/lib/laboratorio/periodo"

function fila(parcial: Partial<FilaLabMetrica> & { measurement_date: string; value: number }): FilaLabMetrica {
  return {
    metric_name: "Glucemia",
    metric_canonical: null,
    unit: "mg/dL",
    reference_range: null,
    reference_min: null,
    reference_max: null,
    document_id: null,
    ...parcial,
  }
}

describe("lib/laboratorio/series.ts", () => {
  describe("estaFueraDeRango", () => {
    it("está dentro de rango cuando el valor cae entre min y max", () => {
      expect(estaFueraDeRango(85, 70, 100)).toBe(false)
    })

    it("está fuera de rango por debajo del mínimo", () => {
      expect(estaFueraDeRango(60, 70, 100)).toBe(true)
    })

    it("está fuera de rango por encima del máximo", () => {
      expect(estaFueraDeRango(145, 70, 100)).toBe(true)
    })

    it("sin límites definidos nunca está fuera de rango", () => {
      expect(estaFueraDeRango(999999, null, null)).toBe(false)
    })
  })

  describe("agruparEnSeries", () => {
    it("agrupa por metric_canonical cuando está presente", () => {
      const series = agruparEnSeries([
        fila({ metric_canonical: "glucosa", measurement_date: "2026-07-01", value: 90 }),
        fila({ metric_canonical: "glucosa", measurement_date: "2026-08-01", value: 95 }),
      ])
      expect(series).toHaveLength(1)
      expect(series[0].puntos).toHaveLength(2)
    })

    it("cae a metric_name cuando metric_canonical es null", () => {
      const series = agruparEnSeries([
        fila({ metric_name: "Colesterol total", metric_canonical: null, measurement_date: "2026-07-01", value: 210 }),
      ])
      expect(series).toHaveLength(1)
      expect(series[0].etiqueta).toBe("Colesterol total")
    })

    it("fusiona el 'glucosa' en minúsculas del seed con el 'Glucemia' del pipeline real en UNA sola serie", () => {
      // Reproduce el mismatch documentado en el encabezado de series.ts:
      // seed.sql guarda metric_canonical="glucosa" (minúscula, guion bajo);
      // un documento real sin canónico resuelto guarda metric_name="Glucemia".
      // Las dos tienen que terminar en la MISMA serie "Glucosa".
      const series = agruparEnSeries([
        fila({ metric_canonical: "glucosa", metric_name: "Glucemia", measurement_date: "2026-06-01", value: 135 }),
        fila({ metric_canonical: null, metric_name: "Glucemia", measurement_date: "2026-07-01", value: 140 }),
        fila({ metric_canonical: null, metric_name: "GLU", measurement_date: "2026-08-01", value: 90 }),
      ])
      expect(series).toHaveLength(1)
      expect(series[0].etiqueta).toBe("Glucosa")
      expect(series[0].puntos).toHaveLength(3)
    })

    it("una métrica no reconocida por el diccionario conserva su nombre original y no se fusiona con otra distinta", () => {
      const series = agruparEnSeries([
        fila({ metric_canonical: null, metric_name: "Ferritina", measurement_date: "2026-07-01", value: 50 }),
        fila({ metric_canonical: null, metric_name: "Vitamina D", measurement_date: "2026-07-01", value: 30 }),
      ])
      expect(series.map((s) => s.etiqueta).sort()).toEqual(["Ferritina", "Vitamina D"])
    })

    it("ordena los puntos de cada serie por fecha ascendente sin importar el orden de entrada", () => {
      const series = agruparEnSeries([
        fila({ metric_canonical: "glucosa", measurement_date: "2026-08-01", value: 95 }),
        fila({ metric_canonical: "glucosa", measurement_date: "2026-06-01", value: 135 }),
        fila({ metric_canonical: "glucosa", measurement_date: "2026-07-01", value: 140 }),
      ])
      expect(series[0].puntos.map((p) => p.fecha)).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"])
    })

    it("ordena las series alfabéticamente por etiqueta", () => {
      const series = agruparEnSeries([
        fila({ metric_canonical: "hemoglobina", measurement_date: "2026-08-01", value: 13.8 }),
        fila({ metric_canonical: "glucosa", measurement_date: "2026-08-01", value: 95 }),
        fila({ metric_canonical: "colesterol_total", measurement_date: "2026-08-01", value: 210 }),
      ])
      expect(series.map((s) => s.etiqueta)).toEqual(["Colesterol total", "Glucosa", "Hemoglobina"])
    })

    it("calcula fueraDeRango por punto y toma la unidad de la medición más reciente", () => {
      const series = agruparEnSeries([
        fila({
          metric_canonical: "glucosa",
          measurement_date: "2026-06-01",
          value: 90,
          unit: "mg/dl",
          reference_min: 70,
          reference_max: 100,
        }),
        fila({
          metric_canonical: "glucosa",
          measurement_date: "2026-08-01",
          value: 145,
          unit: "mg/dL",
          reference_min: 70,
          reference_max: 100,
        }),
      ])
      const [serie] = series
      expect(serie.unidad).toBe("mg/dL")
      expect(serie.puntos[0].fueraDeRango).toBe(false)
      expect(serie.puntos[1].fueraDeRango).toBe(true)
    })

    it("con filas vacías devuelve un arreglo vacío de series", () => {
      expect(agruparEnSeries([])).toEqual([])
    })
  })

  describe("obtenerMetricasDisponibles", () => {
    it("devuelve la última medición de cada serie", () => {
      const series = agruparEnSeries([
        fila({ metric_canonical: "glucosa", measurement_date: "2026-06-01", value: 90 }),
        fila({ metric_canonical: "glucosa", measurement_date: "2026-08-01", value: 145, reference_max: 100 }),
      ])
      const disponibles = obtenerMetricasDisponibles(series)
      expect(disponibles).toHaveLength(1)
      expect(disponibles[0]).toMatchObject({
        etiqueta: "Glucosa",
        ultimaFecha: "2026-08-01",
        ultimoValor: 145,
        fueraDeRango: true,
      })
    })
  })

  describe("contarEstudiosDistintos", () => {
    it("un solo document_id repetido en varias filas cuenta como UN estudio (PSA + Volumen del mismo laboratorio)", () => {
      // Reproduce el caso real que motivó el aviso de "muestra chica": un
      // único estudio de laboratorio (02/06/2026) trae dos métricas, PSA y
      // Volumen -dos FILAS de `lab_metrics`, un solo `document_id`-.
      const cantidad = contarEstudiosDistintos([
        { document_id: "doc-1", measurement_date: "2026-06-02" },
        { document_id: "doc-1", measurement_date: "2026-06-02" },
      ])
      expect(cantidad).toBe(1)
    })

    it("document_id distintos cuentan como estudios distintos", () => {
      const cantidad = contarEstudiosDistintos([
        { document_id: "doc-1", measurement_date: "2026-06-02" },
        { document_id: "doc-2", measurement_date: "2026-07-10" },
      ])
      expect(cantidad).toBe(2)
    })

    it("sin document_id, agrupa por measurement_date", () => {
      const cantidad = contarEstudiosDistintos([
        { document_id: null, measurement_date: "2026-06-02" },
        { document_id: null, measurement_date: "2026-06-02" },
        { document_id: null, measurement_date: "2026-07-10" },
      ])
      expect(cantidad).toBe(2)
    })

    it("mezcla de filas con y sin document_id", () => {
      const cantidad = contarEstudiosDistintos([
        { document_id: "doc-1", measurement_date: "2026-06-02" },
        { document_id: null, measurement_date: "2026-06-02" },
        { document_id: null, measurement_date: "2026-07-10" },
      ])
      // "doc-1" y "fecha:2026-06-02" son claves distintas aunque compartan
      // fecha -sin el vínculo de documento no hay forma de saber que son el
      // mismo estudio, así que se cuentan aparte-.
      expect(cantidad).toBe(3)
    })

    it("arreglo vacío: cero estudios", () => {
      expect(contarEstudiosDistintos([])).toBe(0)
    })
  })
})

describe("lib/laboratorio/periodo.ts", () => {
  const AHORA = new Date("2026-08-13T15:00:00Z")

  describe("calcularFechaCorte", () => {
    it("'todo' no tiene corte", () => {
      expect(calcularFechaCorte("todo", AHORA)).toBeNull()
    })

    it("'6m' corta exactamente 6 meses antes de hoy", () => {
      expect(calcularFechaCorte("6m", AHORA)).toBe("2026-02-13")
    })

    it("'1a' corta exactamente 1 año antes de hoy", () => {
      expect(calcularFechaCorte("1a", AHORA)).toBe("2025-08-13")
    })

    it("un punto justo en el límite del corte queda incluido (corte inclusive)", () => {
      const corte = calcularFechaCorte("6m", AHORA)
      // measurement_date >= corte: el propio corte tiene que pasar el filtro.
      expect(corte !== null && "2026-02-13" >= corte).toBe(true)
    })

    it("no depende de la hora local: mismo resultado con distintas horas del mismo día UTC", () => {
      const alAmanecer = new Date("2026-08-13T02:00:00Z")
      const ala_noche = new Date("2026-08-13T23:00:00Z")
      expect(calcularFechaCorte("6m", alAmanecer)).toBe(calcularFechaCorte("6m", ala_noche))
    })
  })

  describe("parsearPeriodo", () => {
    it("acepta los tres valores válidos", () => {
      expect(parsearPeriodo("6m")).toBe("6m")
      expect(parsearPeriodo("1a")).toBe("1a")
      expect(parsearPeriodo("todo")).toBe("todo")
    })

    it("cualquier valor desconocido o ausente cae al default '6m'", () => {
      expect(parsearPeriodo("bogus")).toBe("6m")
      expect(parsearPeriodo(undefined)).toBe("6m")
      expect(parsearPeriodo(null)).toBe("6m")
      expect(parsearPeriodo("")).toBe("6m")
    })
  })

  describe("debeAvisarMuestraChica", () => {
    it("caso real: '6m', 1 estudio en el período, hay estudios más viejos -> avisa", () => {
      expect(debeAvisarMuestraChica("6m", 1, true)).toBe(true)
    })

    it("'todo' nunca avisa, sin importar la cantidad", () => {
      expect(debeAvisarMuestraChica("todo", 1, true)).toBe(false)
      expect(debeAvisarMuestraChica("todo", 0, true)).toBe(false)
    })

    it("sin estudios más viejos (el período ya muestra todo el historial): no avisa aunque la cantidad sea chica", () => {
      expect(debeAvisarMuestraChica("6m", 1, false)).toBe(false)
    })

    it("justo en el umbral: avisa", () => {
      expect(debeAvisarMuestraChica("6m", UMBRAL_MUESTRA_CHICA, true)).toBe(true)
    })

    it("un estudio más que el umbral: no avisa", () => {
      expect(debeAvisarMuestraChica("6m", UMBRAL_MUESTRA_CHICA + 1, true)).toBe(false)
    })

    it("aplica igual a '1a'", () => {
      expect(debeAvisarMuestraChica("1a", 1, true)).toBe(true)
      expect(debeAvisarMuestraChica("1a", 10, true)).toBe(false)
    })
  })

  describe("mensajeMuestraChica", () => {
    it("singular: '1 estudio', no '1 estudios'", () => {
      expect(mensajeMuestraChica("6m", 1)).toBe(
        'En los últimos 6 meses hay 1 estudio con resultados. Probá "Todo" para ver la serie completa.',
      )
    })

    it("plural para 2 o más", () => {
      expect(mensajeMuestraChica("6m", 2)).toBe(
        'En los últimos 6 meses hay 2 estudios con resultados. Probá "Todo" para ver la serie completa.',
      )
    })

    it("prefijo distinto para '1a'", () => {
      expect(mensajeMuestraChica("1a", 1)).toBe(
        'En el último año hay 1 estudio con resultados. Probá "Todo" para ver la serie completa.',
      )
    })
  })
})
