import { describe, it, expect } from "vitest"

import { generarCSVSignos, type MedicionParaCSV } from "@/lib/signos/csv"

describe("lib/signos/csv.ts", () => {
  it("genera un CSV de tensión con encabezados en español", () => {
    const mediciones: MedicionParaCSV[] = [
      {
        fecha: "14/08/2026",
        hora: "10:30",
        sistolica: 120,
        diastolica: 80,
        pulso: 72,
      },
    ]

    const csv = generarCSVSignos("tension", mediciones)

    // Primera línea debe empezar con BOM (U+FEFF = "﻿").
    expect(csv[0]).toBe("﻿")

    // Contiene encabezados correctos con `;` separador.
    expect(csv).toContain("Fecha;Hora;Sistólica (mmHg);Diastólica (mmHg);Pulso (lat/min)")

    // Contiene los datos.
    expect(csv).toContain("14/08/2026;10:30;120;80;72")
  })

  it("genera un CSV de glucemia", () => {
    const mediciones: MedicionParaCSV[] = [
      {
        fecha: "14/08/2026",
        hora: "08:00",
        valor: 95.5,
      },
    ]

    const csv = generarCSVSignos("glucemia", mediciones)

    expect(csv).toContain("Fecha;Hora;Valor (mg/dL)")
    // Decimales con coma (es-AR).
    expect(csv).toContain("14/08/2026;08:00;95,5")
  })

  it("genera un CSV de peso", () => {
    const mediciones: MedicionParaCSV[] = [
      {
        fecha: "14/08/2026",
        hora: "09:00",
        valor: 70.5,
      },
    ]

    const csv = generarCSVSignos("peso", mediciones)

    expect(csv).toContain("Fecha;Hora;Peso (kg)")
    expect(csv).toContain("14/08/2026;09:00;70,5")
  })

  it("maneja valores null como guión", () => {
    const mediciones: MedicionParaCSV[] = [
      {
        fecha: "14/08/2026",
        hora: "10:30",
        sistolica: null,
        diastolica: 80,
        pulso: null,
      },
    ]

    const csv = generarCSVSignos("tension", mediciones)

    // Null aparece como "—".
    expect(csv).toContain("14/08/2026;10:30;—;80;—")
  })

  it("escapa valores con punto y coma dentro de comillas", () => {
    const mediciones: MedicionParaCSV[] = [
      {
        fecha: '14/08/2026; extra"foo',
        hora: "10:30",
        valor: 100,
      },
    ]

    const csv = generarCSVSignos("glucemia", mediciones)

    // El valor con ";" y comilla debe estar escapado: las comillas se duplican.
    expect(csv).toContain('"14/08/2026; extra""foo";10:30;100')
  })

  it("el BOM UTF-8 es el primer carácter (U+FEFF)", () => {
    const mediciones: MedicionParaCSV[] = []
    const csv = generarCSVSignos("tension", mediciones)

    // U+FEFF == "﻿" (BOM).
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it("múltiples mediciones se separan por saltos de línea", () => {
    const mediciones: MedicionParaCSV[] = [
      { fecha: "14/08/2026", hora: "10:30", valor: 95 },
      { fecha: "13/08/2026", hora: "09:00", valor: 105 },
      { fecha: "12/08/2026", hora: "14:30", valor: 90 },
    ]

    const csv = generarCSVSignos("glucemia", mediciones)

    const lineas = csv.split("\n")
    // Primera línea = BOM + encabezados.
    // Siguientes = 3 mediciones. Total = 4 líneas sin trailing newline.
    expect(lineas).toHaveLength(4)
  })

  it("decimales en tensión (si hay) usan coma", () => {
    // Aunque la tensión típicamente es integer, el helper debe funcionar.
    const mediciones: MedicionParaCSV[] = [
      {
        fecha: "14/08/2026",
        hora: "10:30",
        sistolica: 120.5,
        diastolica: 80.25,
        pulso: 72,
      },
    ]

    const csv = generarCSVSignos("tension", mediciones)

    expect(csv).toContain("120,5")
    expect(csv).toContain("80,25")
  })
})
