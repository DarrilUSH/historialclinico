/**
 * Tests de `lib/especialidades/coincidencias.ts` (Sprint 16, tarea 16.2):
 * el criterio de coincidencia del autocompletar de especialidades -tildes,
 * mayúsculas, prefijos y subcadenas-.
 *
 *   npm run test -- coincidencias-especialidad
 */

import { describe, it, expect } from "vitest"

import { especialidadCoincide } from "@/lib/especialidades/coincidencias"

describe("lib/especialidades/coincidencias.ts", () => {
  it("matchea un prefijo exacto", () => {
    expect(especialidadCoincide("Cardiología", "Cardio")).toBe(true)
  })

  it("es insensible a mayúsculas/minúsculas", () => {
    expect(especialidadCoincide("Cardiología", "cardio")).toBe(true)
    expect(especialidadCoincide("Cardiología", "CARDIO")).toBe(true)
    expect(especialidadCoincide("clínica médica", "CLÍNICA")).toBe(true)
  })

  it("es insensible a tildes", () => {
    expect(especialidadCoincide("Cardiología", "cardiologia")).toBe(true)
    expect(especialidadCoincide("Otorrinolaringología", "otorrinolaringologia")).toBe(true)
    expect(especialidadCoincide("Traumatología y Ortopedia", "traumatologia")).toBe(true)
  })

  it("es insensible a mayúsculas Y tildes combinadas", () => {
    expect(especialidadCoincide("Cardiología", "CARDIOLOGIA")).toBe(true)
  })

  it("matchea una subcadena en el medio de la etiqueta, no solo el prefijo", () => {
    expect(especialidadCoincide("Clínica Médica", "médica")).toBe(true)
    expect(especialidadCoincide("Cirugía Cardiovascular", "cardio")).toBe(true)
  })

  it("no matchea una palabra que no está en ningún lado", () => {
    expect(especialidadCoincide("Cardiología", "pediatría")).toBe(false)
  })

  it("una consulta vacía (o solo espacios) matchea cualquier etiqueta", () => {
    expect(especialidadCoincide("Cardiología", "")).toBe(true)
    expect(especialidadCoincide("Cardiología", "   ")).toBe(true)
  })

  it("una consulta más larga que la etiqueta nunca matchea", () => {
    expect(especialidadCoincide("ORL", "Otorrinolaringología")).toBe(false)
  })

  it("ignora espacios sobrantes alrededor de la consulta", () => {
    expect(especialidadCoincide("Cardiología", "  cardio  ")).toBe(true)
  })

  it("no matchea un carácter suelto que no aparece en la etiqueta", () => {
    expect(especialidadCoincide("Pediatría", "z")).toBe(false)
  })
})
