/**
 * Tests de `lib/ubicacion/provincias.ts` (Sprint 16, tarea 16.1).
 *
 *   npm run test -- provincias
 */

import { describe, it, expect } from "vitest"

import { PROVINCIAS_ARGENTINAS } from "@/lib/ubicacion/provincias"

describe("lib/ubicacion/provincias.ts", () => {
  it("tiene exactamente 24 jurisdicciones (23 provincias + CABA)", () => {
    expect(PROVINCIAS_ARGENTINAS).toHaveLength(24)
  })

  it("no tiene jurisdicciones duplicadas", () => {
    const unicas = new Set(PROVINCIAS_ARGENTINAS)
    expect(unicas.size).toBe(PROVINCIAS_ARGENTINAS.length)
  })

  it("incluye CABA con su nombre completo, no la sigla", () => {
    expect(PROVINCIAS_ARGENTINAS).toContain("Ciudad Autónoma de Buenos Aires")
    expect(PROVINCIAS_ARGENTINAS).not.toContain("CABA")
  })

  it("nunca incluye 'Ushuaia' como jurisdicción -es una ciudad, no una provincia-", () => {
    expect(PROVINCIAS_ARGENTINAS).not.toContain("Ushuaia")
  })

  it("incluye Tierra del Fuego con su nombre oficial completo", () => {
    expect(PROVINCIAS_ARGENTINAS).toContain(
      "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
    )
  })

  it("está ordenada alfabéticamente", () => {
    const ordenada = [...PROVINCIAS_ARGENTINAS].sort((a, b) => a.localeCompare(b, "es"))
    expect([...PROVINCIAS_ARGENTINAS]).toEqual(ordenada)
  })

  it("ninguna entrada está vacía o solo con espacios", () => {
    for (const provincia of PROVINCIAS_ARGENTINAS) {
      expect(provincia.trim().length).toBeGreaterThan(0)
    }
  })
})
