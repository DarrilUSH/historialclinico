/**
 * Tests de `lib/validacion/signo.schema.ts` (Sprint 9, tarea 9.1).
 *
 *   npm run test -- signo-schema
 */

import { describe, it, expect } from "vitest"

import { validarSigno } from "@/lib/validacion/signo.schema"

// "Ahora" de referencia: mismo criterio que `turno-schema.test.ts`.
const AHORA = new Date("2026-08-12T09:00:00-03:00")

function datosTension(extra: Record<string, string> = {}) {
  return {
    tipo: "tension",
    sistolica: "120",
    diastolica: "80",
    pulso: "72",
    valor: "",
    fecha: "2026-08-12",
    hora: "08:30",
    ...extra,
  }
}

function datosGlucemia(extra: Record<string, string> = {}) {
  return {
    tipo: "glucemia",
    sistolica: "",
    diastolica: "",
    pulso: "",
    valor: "95",
    fecha: "2026-08-12",
    hora: "08:30",
    ...extra,
  }
}

function datosPeso(extra: Record<string, string> = {}) {
  return {
    tipo: "peso",
    sistolica: "",
    diastolica: "",
    pulso: "",
    valor: "70,5",
    fecha: "2026-08-12",
    hora: "08:30",
    ...extra,
  }
}

describe("lib/validacion/signo.schema.ts", () => {
  describe("tensión", () => {
    it("acepta una tensión válida con pulso", () => {
      const resultado = validarSigno(datosTension(), { ahora: AHORA })
      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        expect(resultado.datos.tipo).toBe("tension")
        expect(resultado.datos.systolic).toBe(120)
        expect(resultado.datos.diastolic).toBe(80)
        expect(resultado.datos.pulse).toBe(72)
        expect(resultado.datos.value).toBeUndefined()
        expect(resultado.datos.measuredAtIso).toBe(new Date("2026-08-12T08:30:00-03:00").toISOString())
      }
    })

    it("acepta una tensión sin pulso (opcional)", () => {
      const resultado = validarSigno(datosTension({ pulso: "" }), { ahora: AHORA })
      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        expect(resultado.datos.pulse).toBeUndefined()
      }
    })

    it("acepta los límites exactos de sistólica y diastólica (50/30 y 300/200)", () => {
      const bajo = validarSigno(datosTension({ sistolica: "50", diastolica: "30" }), { ahora: AHORA })
      expect(bajo.ok).toBe(true)
      const alto = validarSigno(datosTension({ sistolica: "300", diastolica: "200" }), { ahora: AHORA })
      expect(alto.ok).toBe(true)
    })

    it("rechaza una sistólica implausible (400) con mensaje claro", () => {
      const resultado = validarSigno(datosTension({ sistolica: "400" }), { ahora: AHORA })
      expect(resultado.ok).toBe(false)
      if (!resultado.ok) {
        expect(resultado.error).toMatch(/sistólica de 400 no parece correcta/)
      }
    })

    it("rechaza una sistólica por debajo del mínimo plausible (49)", () => {
      const resultado = validarSigno(datosTension({ sistolica: "49", diastolica: "30" }), { ahora: AHORA })
      expect(resultado.ok).toBe(false)
    })

    it("rechaza una diastólica implausible (250)", () => {
      const resultado = validarSigno(datosTension({ diastolica: "250" }), { ahora: AHORA })
      expect(resultado.ok).toBe(false)
      if (!resultado.ok) {
        expect(resultado.error).toMatch(/diastólica de 250 no parece correcta/)
      }
    })

    it("rechaza sistólica menor o igual a la diastólica", () => {
      const resultado = validarSigno(datosTension({ sistolica: "80", diastolica: "80" }), { ahora: AHORA })
      expect(resultado.ok).toBe(false)
      if (!resultado.ok) {
        expect(resultado.error).toMatch(/mayor que la diastólica/)
      }

      const invertida = validarSigno(datosTension({ sistolica: "70", diastolica: "90" }), { ahora: AHORA })
      expect(invertida.ok).toBe(false)
    })

    it("rechaza un pulso implausible cuando se carga (300)", () => {
      const resultado = validarSigno(datosTension({ pulso: "300" }), { ahora: AHORA })
      expect(resultado.ok).toBe(false)
      if (!resultado.ok) {
        expect(resultado.error).toMatch(/pulso de 300 no parece correcto/)
      }
    })

    it("acepta los límites exactos de pulso (20 y 250)", () => {
      expect(validarSigno(datosTension({ pulso: "20" }), { ahora: AHORA }).ok).toBe(true)
      expect(validarSigno(datosTension({ pulso: "250" }), { ahora: AHORA }).ok).toBe(true)
    })

    it("rechaza sistólica o diastólica faltantes", () => {
      expect(validarSigno(datosTension({ sistolica: "" }), { ahora: AHORA }).ok).toBe(false)
      expect(validarSigno(datosTension({ diastolica: "" }), { ahora: AHORA }).ok).toBe(false)
    })

    it("rechaza valores con coma o decimales en sistólica/diastólica/pulso (smallint)", () => {
      expect(validarSigno(datosTension({ sistolica: "120,5" }), { ahora: AHORA }).ok).toBe(false)
      expect(validarSigno(datosTension({ pulso: "72.5" }), { ahora: AHORA }).ok).toBe(false)
    })
  })

  describe("glucemia", () => {
    it("acepta una glucemia válida", () => {
      const resultado = validarSigno(datosGlucemia(), { ahora: AHORA })
      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        expect(resultado.datos.tipo).toBe("glucemia")
        expect(resultado.datos.value).toBe(95)
        expect(resultado.datos.systolic).toBeUndefined()
      }
    })

    it("rechaza glucemia menor o igual a 0", () => {
      expect(validarSigno(datosGlucemia({ valor: "0" }), { ahora: AHORA }).ok).toBe(false)
      expect(validarSigno(datosGlucemia({ valor: "-5" }), { ahora: AHORA }).ok).toBe(false)
    })

    it("rechaza glucemia faltante", () => {
      expect(validarSigno(datosGlucemia({ valor: "" }), { ahora: AHORA }).ok).toBe(false)
    })
  })

  describe("peso", () => {
    it("acepta un peso válido con coma decimal", () => {
      const resultado = validarSigno(datosPeso(), { ahora: AHORA })
      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        expect(resultado.datos.tipo).toBe("peso")
        expect(resultado.datos.value).toBeCloseTo(70.5)
      }
    })

    it("acepta un peso con punto decimal", () => {
      const resultado = validarSigno(datosPeso({ valor: "70.5" }), { ahora: AHORA })
      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        expect(resultado.datos.value).toBeCloseTo(70.5)
      }
    })

    it("rechaza peso menor o igual a 0", () => {
      expect(validarSigno(datosPeso({ valor: "0" }), { ahora: AHORA }).ok).toBe(false)
    })
  })

  describe("tipo", () => {
    it("rechaza un tipo inválido", () => {
      const resultado = validarSigno(datosTension({ tipo: "otro" }), { ahora: AHORA })
      expect(resultado.ok).toBe(false)
    })
  })

  describe("fecha y hora", () => {
    it("rechaza una fecha con formato inválido", () => {
      const resultado = validarSigno(datosGlucemia({ fecha: "12-08-2026" }), { ahora: AHORA })
      expect(resultado.ok).toBe(false)
    })

    it("rechaza una fecha que no existe en el calendario", () => {
      const resultado = validarSigno(datosGlucemia({ fecha: "2026-02-30" }), { ahora: AHORA })
      expect(resultado.ok).toBe(false)
    })

    it("rechaza una hora con formato inválido", () => {
      const resultado = validarSigno(datosGlucemia({ hora: "25:00" }), { ahora: AHORA })
      expect(resultado.ok).toBe(false)
    })

    it("rechaza fecha y hora futuras", () => {
      const resultado = validarSigno(datosGlucemia({ fecha: "2026-08-12", hora: "09:01" }), { ahora: AHORA })
      expect(resultado.ok).toBe(false)
      if (!resultado.ok) {
        expect(resultado.error).toMatch(/no pueden ser futuras/)
      }
    })

    it("rechaza un día futuro aunque la hora sea más temprano que ahora", () => {
      // Caso trampa: si se comparara solo la HORA (o solo la fecha sin hora),
      // "mañana a las 08:00" podría colarse como "no futuro". Acá se compara
      // el instante completo.
      const resultado = validarSigno(datosGlucemia({ fecha: "2026-08-13", hora: "08:00" }), { ahora: AHORA })
      expect(resultado.ok).toBe(false)
    })

    it('el caso borde del roadmap: HOY con la hora ACTUAL exacta NO es futuro (se acepta)', () => {
      // Este es el bug documentado en ROADMAP_SPRINTS.md 9.1 y en la regla
      // global del bang de `DateTimeImmutable::createFromFormat`: comparar
      // una fecha pura contra "ahora" arrastrando la hora del momento de
      // carga rompe casi todo el día salvo a medianoche exacta. Acá fecha Y
      // hora viajan siempre juntas a `combinarFechaHoraUshuaia`, así que el
      // instante de "ahora mismo" tiene que aceptarse, no solo la medianoche.
      const resultado = validarSigno(datosGlucemia({ fecha: "2026-08-12", hora: "09:00" }), { ahora: AHORA })
      expect(resultado.ok).toBe(true)
    })

    it("acepta un instante pasado del mismo día", () => {
      const resultado = validarSigno(datosGlucemia({ fecha: "2026-08-12", hora: "07:00" }), { ahora: AHORA })
      expect(resultado.ok).toBe(true)
    })

    it("acepta un día anterior", () => {
      const resultado = validarSigno(datosGlucemia({ fecha: "2026-08-11", hora: "23:59" }), { ahora: AHORA })
      expect(resultado.ok).toBe(true)
    })
  })
})
