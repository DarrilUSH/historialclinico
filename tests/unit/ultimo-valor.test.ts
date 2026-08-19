import { describe, expect, it } from "vitest"

import { esMedicionUnica, resumenUltimoValor, type PuntoMedicion } from "@/lib/laboratorio/ultimo-valor"

describe("esMedicionUnica", () => {
  it("un solo elemento: true", () => {
    expect(esMedicionUnica([{ valor: 1 }])).toBe(true)
  })

  it("dos o más elementos: false", () => {
    expect(esMedicionUnica([{ valor: 1 }, { valor: 2 }])).toBe(false)
    expect(esMedicionUnica([{ valor: 1 }, { valor: 2 }, { valor: 3 }])).toBe(false)
  })

  it("arreglo vacío: false (no hay ninguna medición, no es 'la única')", () => {
    expect(esMedicionUnica([])).toBe(false)
  })
})

describe("resumenUltimoValor", () => {
  it("última medición correcta: valor, fecha, unidad", () => {
    const puntos: PuntoMedicion[] = [
      { valor: 100, fecha: "2024-01-01", unidad: "mg/dl", min: 70, max: 100 },
      { valor: 110, fecha: "2024-01-15", unidad: "mg/dl", min: 70, max: 100 },
    ]

    const resumen = resumenUltimoValor(puntos)

    expect(resumen.valor).toBe(110)
    expect(resumen.fecha).toBe("2024-01-15")
    expect(resumen.unidad).toBe("mg/dl")
  })

  it("una sola medición: sin variación, muestra 'Primera medición'", () => {
    const puntos: PuntoMedicion[] = [
      { valor: 85, fecha: "2024-01-01", unidad: "mg/dl", min: 70, max: 100 },
    ]

    const resumen = resumenUltimoValor(puntos)

    expect(resumen.variacion).toBeNull()
  })

  it("variación positiva (subio): flecha y diferencia correcta", () => {
    const puntos: PuntoMedicion[] = [
      { valor: 100, fecha: "2024-01-01", unidad: "mg/dl", min: null, max: null },
      { valor: 108, fecha: "2024-01-15", unidad: "mg/dl", min: null, max: null },
    ]

    const resumen = resumenUltimoValor(puntos)

    expect(resumen.variacion).toBeDefined()
    expect(resumen.variacion?.direccion).toBe("subio")
    expect(resumen.variacion?.diferencia).toBe(8)
  })

  it("variación negativa (bajo): flecha y diferencia correcta (valor positivo)", () => {
    const puntos: PuntoMedicion[] = [
      { valor: 150, fecha: "2024-01-01", unidad: "mg/dl", min: null, max: null },
      { valor: 120, fecha: "2024-01-15", unidad: "mg/dl", min: null, max: null },
    ]

    const resumen = resumenUltimoValor(puntos)

    expect(resumen.variacion).toBeDefined()
    expect(resumen.variacion?.direccion).toBe("bajo")
    expect(resumen.variacion?.diferencia).toBe(30)
  })

  it("variación igual: marca 'igual', diferencia 0", () => {
    const puntos: PuntoMedicion[] = [
      { valor: 100, fecha: "2024-01-01", unidad: "mg/dl", min: null, max: null },
      { valor: 100, fecha: "2024-01-15", unidad: "mg/dl", min: null, max: null },
    ]

    const resumen = resumenUltimoValor(puntos)

    expect(resumen.variacion).toBeDefined()
    expect(resumen.variacion?.direccion).toBe("igual")
    expect(resumen.variacion?.diferencia).toBe(0)
  })

  it("en rango: min/max definidos, valor dentro", () => {
    const puntos: PuntoMedicion[] = [
      { valor: 85, fecha: "2024-01-01", unidad: "mg/dl", min: 70, max: 100 },
    ]

    const resumen = resumenUltimoValor(puntos)

    expect(resumen.enRango).toBe(true)
  })

  it("fuera de rango (bajo): valor menor que min", () => {
    const puntos: PuntoMedicion[] = [
      { valor: 60, fecha: "2024-01-01", unidad: "mg/dl", min: 70, max: 100 },
    ]

    const resumen = resumenUltimoValor(puntos)

    expect(resumen.enRango).toBe(false)
  })

  it("fuera de rango (alto): valor mayor que max", () => {
    const puntos: PuntoMedicion[] = [
      { valor: 110, fecha: "2024-01-01", unidad: "mg/dl", min: 70, max: 100 },
    ]

    const resumen = resumenUltimoValor(puntos)

    expect(resumen.enRango).toBe(false)
  })

  it("sin rango de referencia: enRango es null", () => {
    const puntos: PuntoMedicion[] = [
      { valor: 200, fecha: "2024-01-01", unidad: "mg/dl", min: null, max: null },
    ]

    const resumen = resumenUltimoValor(puntos)

    expect(resumen.enRango).toBeNull()
  })

  it("unidad null: persiste en resumen", () => {
    const puntos: PuntoMedicion[] = [
      { valor: 100, fecha: "2024-01-01", unidad: null, min: null, max: null },
    ]

    const resumen = resumenUltimoValor(puntos)

    expect(resumen.unidad).toBeNull()
  })

  it("variación porcentual: se calcula cuando hay dos mediciones", () => {
    const puntos: PuntoMedicion[] = [
      { valor: 100, fecha: "2024-01-01", unidad: "mg/dl", min: null, max: null },
      { valor: 150, fecha: "2024-01-15", unidad: "mg/dl", min: null, max: null },
    ]

    const resumen = resumenUltimoValor(puntos)

    expect(resumen.variacion?.diferenciaPorcentaje).toBe(50)
  })

  it("error: array vacío", () => {
    expect(() => resumenUltimoValor([])).toThrow("resumenUltimoValor: array vacío")
  })
})
