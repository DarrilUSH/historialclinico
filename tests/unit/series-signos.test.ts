/**
 * Tests unitarios de `lib/signos/series.ts` y `lib/signos/periodo.ts`
 * (Sprint 9, tarea 9.4 — ROADMAP_SPRINTS.md).
 *
 * Cubre el criterio de aceptación: orden de la serie, separación de las dos
 * líneas de tensión, marcado fuera-de-umbral con umbrales CUSTOM (no
 * recalculado: viene de la alerta persistida, `docs/modelo-signos.md` §11),
 * y el filtro de período.
 *
 *   npm run test -- series-signos
 */

import { describe, it, expect } from "vitest"

import {
  construirSerieSigno,
  etiquetaFueraDeUmbral,
  type FilaAlertaParaSerie,
  type FilaVitalSignParaSerie,
  type SerieSignoGlucemia,
  type SerieSignoPeso,
  type SerieSignoTension,
} from "@/lib/signos/series"
import { calcularCorteSignos, parsearPeriodoSignos } from "@/lib/signos/periodo"
import { UMBRALES_POR_DEFECTO, type UmbralesSignos } from "@/lib/signos/umbrales"

const AHORA = new Date("2026-08-14T12:00:00.000Z")

function filaTension(
  parcial: Partial<FilaVitalSignParaSerie> & { id: string; measuredAt: string; systolic: number; diastolic: number },
): FilaVitalSignParaSerie {
  return { value: null, ...parcial }
}

function filaValor(
  parcial: Partial<FilaVitalSignParaSerie> & { id: string; measuredAt: string; value: number },
): FilaVitalSignParaSerie {
  return { systolic: null, diastolic: null, ...parcial }
}

function alerta(parcial: Partial<FilaAlertaParaSerie> & Pick<FilaAlertaParaSerie, "vitalSignId" | "regla">): FilaAlertaParaSerie {
  return { valor: 0, umbral: 0, referencia: null, ...parcial }
}

describe("lib/signos/periodo.ts", () => {
  it("calcularCorteSignos resta exactamente 30/90 días en milisegundos", () => {
    expect(calcularCorteSignos("30d", AHORA)).toBe(new Date("2026-07-15T12:00:00.000Z").toISOString())
    expect(calcularCorteSignos("90d", AHORA)).toBe(new Date("2026-05-16T12:00:00.000Z").toISOString())
  })

  it("'todo' no tiene corte", () => {
    expect(calcularCorteSignos("todo", AHORA)).toBeNull()
  })

  it("parsearPeriodoSignos cae al default '30d' ante cualquier valor desconocido", () => {
    expect(parsearPeriodoSignos(undefined)).toBe("30d")
    expect(parsearPeriodoSignos(null)).toBe("30d")
    expect(parsearPeriodoSignos("6m")).toBe("30d")
    expect(parsearPeriodoSignos("90d")).toBe("90d")
    expect(parsearPeriodoSignos("todo")).toBe("todo")
  })
})

describe("lib/signos/series.ts", () => {
  describe("orden", () => {
    it("ordena los puntos por fecha ascendente aunque las filas lleguen desordenadas", () => {
      const filas = [
        filaValor({ id: "c", measuredAt: "2026-08-10T09:00:00Z", value: 90 }),
        filaValor({ id: "a", measuredAt: "2026-08-01T09:00:00Z", value: 80 }),
        filaValor({ id: "b", measuredAt: "2026-08-05T09:00:00Z", value: 85 }),
      ]
      const serie = construirSerieSigno("glucemia", filas, [], UMBRALES_POR_DEFECTO, "todo", AHORA) as SerieSignoGlucemia
      expect(serie.puntos.map((p) => p.vitalSignId)).toEqual(["a", "b", "c"])
      expect(serie.puntos.map((p) => p.valor)).toEqual([80, 85, 90])
    })

    it("ordena por INSTANTE, no por texto: 'Z' y '+00:00' del mismo instante quedan en orden", () => {
      const filas = [
        filaValor({ id: "z", measuredAt: "2026-08-05T10:00:00Z", value: 100 }),
        filaValor({ id: "offset", measuredAt: "2026-08-05T09:00:00+00:00", value: 95 }),
      ]
      const serie = construirSerieSigno("glucemia", filas, [], UMBRALES_POR_DEFECTO, "todo", AHORA) as SerieSignoGlucemia
      expect(serie.puntos.map((p) => p.vitalSignId)).toEqual(["offset", "z"])
    })
  })

  describe("separación de las dos líneas de tensión", () => {
    it("cada fila de tensión produce un punto en sistólica y uno en diastólica, alineados por índice", () => {
      const filas = [
        filaTension({ id: "v1", measuredAt: "2026-08-01T08:00:00Z", systolic: 120, diastolic: 78 }),
        filaTension({ id: "v2", measuredAt: "2026-08-03T08:00:00Z", systolic: 165, diastolic: 102 }),
      ]
      const serie = construirSerieSigno("tension", filas, [], UMBRALES_POR_DEFECTO, "todo", AHORA) as SerieSignoTension

      expect(serie.sistolica.map((p) => p.valor)).toEqual([120, 165])
      expect(serie.diastolica.map((p) => p.valor)).toEqual([78, 102])
      expect(serie.sistolica.map((p) => p.vitalSignId)).toEqual(serie.diastolica.map((p) => p.vitalSignId))
      expect(serie.umbralSistolica).toBe(160)
      expect(serie.umbralDiastolica).toBe(100)
    })

    it("una sistólica alta con diastólica normal marca SOLO la línea de sistólica", () => {
      const filas = [filaTension({ id: "v1", measuredAt: "2026-08-01T08:00:00Z", systolic: 168, diastolic: 84 })]
      const alertas = [alerta({ vitalSignId: "v1", regla: "sistolica_alta", valor: 168, umbral: 160 })]

      const serie = construirSerieSigno("tension", filas, alertas, UMBRALES_POR_DEFECTO, "todo", AHORA) as SerieSignoTension

      expect(serie.sistolica[0]!.fueraDeUmbral).toBe(true)
      expect(serie.sistolica[0]!.etiquetaUmbral).toBe("Por encima del umbral (160)")
      expect(serie.diastolica[0]!.fueraDeUmbral).toBe(false)
      expect(serie.diastolica[0]!.etiquetaUmbral).toBeNull()
    })

    it("165/102 (el caso del seed) marca las DOS líneas", () => {
      const filas = [filaTension({ id: "v1", measuredAt: "2026-08-01T08:00:00Z", systolic: 165, diastolic: 102 })]
      const alertas = [
        alerta({ vitalSignId: "v1", regla: "sistolica_alta", valor: 165, umbral: 160 }),
        alerta({ vitalSignId: "v1", regla: "diastolica_alta", valor: 102, umbral: 100 }),
      ]

      const serie = construirSerieSigno("tension", filas, alertas, UMBRALES_POR_DEFECTO, "todo", AHORA) as SerieSignoTension

      expect(serie.sistolica[0]!.fueraDeUmbral).toBe(true)
      expect(serie.diastolica[0]!.fueraDeUmbral).toBe(true)
      expect(serie.sistolica[0]!.direccion).toBe("arriba")
      expect(serie.diastolica[0]!.direccion).toBe("arriba")
    })
  })

  describe("marcado fuera-de-umbral con umbrales CUSTOM (no recalcula, usa la alerta persistida)", () => {
    it("un umbral de perfil distinto al default NO cambia el marcado: manda la alerta guardada", () => {
      // Umbrales de HOY mucho más laxos que cuando se cargó la medición: si la
      // función recalculara, este punto ya no marcaría. docs/modelo-signos.md
      // §11 exige que siga marcado porque la alerta ya quedó persistida.
      const umbralesHoy: UmbralesSignos = { ...UMBRALES_POR_DEFECTO, sistolicaMax: 200 }
      const filas = [filaTension({ id: "v1", measuredAt: "2026-08-01T08:00:00Z", systolic: 165, diastolic: 80 })]
      const alertas = [alerta({ vitalSignId: "v1", regla: "sistolica_alta", valor: 165, umbral: 160 })]

      const serie = construirSerieSigno("tension", filas, alertas, umbralesHoy, "todo", AHORA) as SerieSignoTension

      expect(serie.sistolica[0]!.fueraDeUmbral).toBe(true)
      expect(serie.sistolica[0]!.etiquetaUmbral).toBe("Por encima del umbral (160)")
      // La banda sí refleja el umbral de HOY, no el que se aplicó al punto.
      expect(serie.umbralSistolica).toBe(200)
    })

    it("sin alerta persistida, un valor alto NO se marca (no se recalcula con evaluar.ts)", () => {
      const filas = [filaTension({ id: "v1", measuredAt: "2026-08-01T08:00:00Z", systolic: 165, diastolic: 102 })]
      const serie = construirSerieSigno("tension", filas, [], UMBRALES_POR_DEFECTO, "todo", AHORA) as SerieSignoTension

      expect(serie.sistolica[0]!.fueraDeUmbral).toBe(false)
      expect(serie.diastolica[0]!.fueraDeUmbral).toBe(false)
    })

    it("glucemia baja marca dirección 'abajo' (rombo) y el texto correcto", () => {
      const filas = [filaValor({ id: "v1", measuredAt: "2026-08-01T08:00:00Z", value: 65 })]
      const alertas = [alerta({ vitalSignId: "v1", regla: "glucemia_baja", valor: 65, umbral: 70 })]

      const serie = construirSerieSigno("glucemia", filas, alertas, UMBRALES_POR_DEFECTO, "todo", AHORA) as SerieSignoGlucemia

      expect(serie.puntos[0]!.direccion).toBe("abajo")
      expect(serie.puntos[0]!.etiquetaUmbral).toBe("Por debajo del umbral (70)")
      expect(serie.umbralMin).toBe(70)
      expect(serie.umbralMax).toBe(250)
    })

    it("peso: variación hacia abajo (perdió peso) marca dirección 'abajo' con el delta en el texto", () => {
      const filas = [filaValor({ id: "v1", measuredAt: "2026-08-01T08:00:00Z", value: 76 })]
      const alertas = [alerta({ vitalSignId: "v1", regla: "peso_variacion", valor: 76, umbral: 2, referencia: 78.5 })]

      const serie = construirSerieSigno("peso", filas, alertas, UMBRALES_POR_DEFECTO, "todo", AHORA) as SerieSignoPeso

      expect(serie.puntos[0]!.direccion).toBe("abajo")
      expect(serie.puntos[0]!.etiquetaUmbral).toBe("2,5 kg menos que la referencia (78,5 kg)")
    })

    it("peso: variación hacia arriba (subió peso) marca dirección 'arriba'", () => {
      const filas = [filaValor({ id: "v1", measuredAt: "2026-08-01T08:00:00Z", value: 81 })]
      const alertas = [alerta({ vitalSignId: "v1", regla: "peso_variacion", valor: 81, umbral: 2, referencia: 78.5 })]

      const serie = construirSerieSigno("peso", filas, alertas, UMBRALES_POR_DEFECTO, "todo", AHORA) as SerieSignoPeso

      expect(serie.puntos[0]!.direccion).toBe("arriba")
      expect(serie.puntos[0]!.etiquetaUmbral).toBe("2,5 kg más que la referencia (78,5 kg)")
    })

    it("etiquetaFueraDeUmbral: glucemia alta", () => {
      expect(etiquetaFueraDeUmbral({ regla: "glucemia_alta", umbral: 250, valor: 260, referencia: null })).toBe(
        "Por encima del umbral (250)",
      )
    })
  })

  describe("filtro de período", () => {
    const filas = [
      filaValor({ id: "viejo", measuredAt: "2026-05-01T08:00:00Z", value: 70 }), // ~105 días antes de AHORA
      filaValor({ id: "medio", measuredAt: "2026-07-01T08:00:00Z", value: 75 }), // ~44 días antes
      filaValor({ id: "reciente", measuredAt: "2026-08-10T08:00:00Z", value: 80 }), // 4 días antes
    ]

    it("'30d' deja afuera todo lo anterior al corte", () => {
      const serie = construirSerieSigno("glucemia", filas, [], UMBRALES_POR_DEFECTO, "30d", AHORA) as SerieSignoGlucemia
      expect(serie.puntos.map((p) => p.vitalSignId)).toEqual(["reciente"])
    })

    it("'90d' incluye 'medio' y 'reciente' pero no 'viejo'", () => {
      const serie = construirSerieSigno("glucemia", filas, [], UMBRALES_POR_DEFECTO, "90d", AHORA) as SerieSignoGlucemia
      expect(serie.puntos.map((p) => p.vitalSignId)).toEqual(["medio", "reciente"])
    })

    it("'todo' incluye las tres", () => {
      const serie = construirSerieSigno("glucemia", filas, [], UMBRALES_POR_DEFECTO, "todo", AHORA) as SerieSignoGlucemia
      expect(serie.puntos.map((p) => p.vitalSignId)).toEqual(["viejo", "medio", "reciente"])
    })

    it("el corte es inclusive: una medición exactamente en el límite de 30 días entra", () => {
      const corte = calcularCorteSignos("30d", AHORA)!
      const filaEnElLimite = filaValor({ id: "limite", measuredAt: corte, value: 90 })
      const serie = construirSerieSigno(
        "glucemia",
        [filaEnElLimite],
        [],
        UMBRALES_POR_DEFECTO,
        "30d",
        AHORA,
      ) as SerieSignoGlucemia
      expect(serie.puntos).toHaveLength(1)
    })
  })

  describe("filas vacías", () => {
    it("sin mediciones devuelve arreglos vacíos, no lanza", () => {
      const tension = construirSerieSigno("tension", [], [], UMBRALES_POR_DEFECTO, "todo", AHORA) as SerieSignoTension
      expect(tension.sistolica).toEqual([])
      expect(tension.diastolica).toEqual([])

      const peso = construirSerieSigno("peso", [], [], UMBRALES_POR_DEFECTO, "todo", AHORA) as SerieSignoPeso
      expect(peso.puntos).toEqual([])
    })
  })
})
