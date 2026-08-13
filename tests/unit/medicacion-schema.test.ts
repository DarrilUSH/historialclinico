/**
 * Tests unitarios de `lib/validacion/medicacion.schema.ts`.
 *
 *   npm run test -- medicacion-schema
 */

import { describe, it, expect } from "vitest"
import { validarMedicacion } from "@/lib/validacion/medicacion.schema"

const base = {
  nombre: "Glucophage",
  droga: "Metformina",
  presentacion: "Comprimidos 850 mg",
  dosisCantidad: "1",
  dosisUnidad: "comprimido",
  frecuencia: "daily",
  horarios: ["08:00", "20:00"],
  fechaInicio: "2026-06-01",
  stock: "60",
}

describe("lib/validacion/medicacion.schema.ts", () => {
  it("acepta el ejemplo del ROADMAP: daily con 2 horarios y stock", () => {
    const resultado = validarMedicacion(base)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.dosisCantidad).toBe(1)
      expect(resultado.datos.horarios).toEqual(["08:00", "20:00"])
      expect(resultado.datos.stock).toBe(60)
      expect(resultado.datos.intervaloHoras).toBeUndefined()
    }
  })

  it("acepta interval_hours con intervaloHoras y sin horarios", () => {
    const resultado = validarMedicacion({
      ...base,
      frecuencia: "interval_hours",
      horarios: [],
      intervaloHoras: "8",
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.intervaloHoras).toBe(8)
      expect(resultado.datos.horarios).toEqual([])
    }
  })

  it("acepta as_needed sin horarios ni intervalo, con stock informativo", () => {
    const resultado = validarMedicacion({
      ...base,
      frecuencia: "as_needed",
      horarios: [],
      stock: "20",
    })
    expect(resultado.ok).toBe(true)
  })

  it("rechaza daily sin ningún horario cargado", () => {
    const resultado = validarMedicacion({ ...base, horarios: [] })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza daily con un horario duplicado", () => {
    const resultado = validarMedicacion({ ...base, horarios: ["08:00", "08:00"] })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza daily con un horario mal formado", () => {
    const resultado = validarMedicacion({ ...base, horarios: ["8hs"] })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza interval_hours sin intervaloHoras", () => {
    const resultado = validarMedicacion({
      ...base,
      frecuencia: "interval_hours",
      horarios: [],
    })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza interval_hours fuera de rango (25)", () => {
    const resultado = validarMedicacion({
      ...base,
      frecuencia: "interval_hours",
      horarios: [],
      intervaloHoras: "25",
    })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza interval_hours con horarios cargados a la vez", () => {
    const resultado = validarMedicacion({
      ...base,
      frecuencia: "interval_hours",
      horarios: ["08:00"],
      intervaloHoras: "8",
    })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza as_needed con horarios cargados", () => {
    const resultado = validarMedicacion({ ...base, frecuencia: "as_needed", horarios: ["08:00"] })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza nombre vacío", () => {
    const resultado = validarMedicacion({ ...base, nombre: "   " })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza dosis cero o negativa", () => {
    expect(validarMedicacion({ ...base, dosisCantidad: "0" }).ok).toBe(false)
    expect(validarMedicacion({ ...base, dosisCantidad: "-1" }).ok).toBe(false)
  })

  it("rechaza stock negativo", () => {
    const resultado = validarMedicacion({ ...base, stock: "-5" })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza fecha de fin anterior a la fecha de inicio", () => {
    const resultado = validarMedicacion({ ...base, fechaFin: "2026-05-01" })
    expect(resultado.ok).toBe(false)
  })

  it("acepta fecha de fin igual a la fecha de inicio", () => {
    const resultado = validarMedicacion({ ...base, fechaFin: "2026-06-01" })
    expect(resultado.ok).toBe(true)
  })

  it("rechaza fecha de inicio inexistente (30 de febrero)", () => {
    const resultado = validarMedicacion({ ...base, fechaInicio: "2026-02-30" })
    expect(resultado.ok).toBe(false)
  })

  it("acepta sin droga, presentación, fecha de fin, stock ni notas (todos opcionales)", () => {
    const resultado = validarMedicacion({
      nombre: "Ibuprofeno",
      dosisCantidad: "1",
      dosisUnidad: "comprimido",
      frecuencia: "as_needed",
      horarios: [],
      fechaInicio: "2026-06-01",
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.droga).toBeUndefined()
      expect(resultado.datos.stock).toBeUndefined()
    }
  })

  it("acepta dosis con coma decimal", () => {
    const resultado = validarMedicacion({ ...base, dosisCantidad: "0,5" })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.dosisCantidad).toBe(0.5)
    }
  })
})
