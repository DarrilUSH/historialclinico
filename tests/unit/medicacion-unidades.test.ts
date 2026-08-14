/**
 * Tests unitarios de `lib/medicacion/unidades.ts` (Sprint 7, tarea 7.4).
 *
 * El bug que originó el módulo: la tarjeta de medicación mostraba
 * **"90 comprimido disponibles"**, porque `medications.dose_unit` se guarda en
 * singular (su uso primario es la dosis por toma: "1 comprimido") y se
 * concatenaba tal cual con el stock.
 *
 *   npm run test -- medicacion-unidades
 */

import { describe, it, expect } from "vitest"

import {
  formatearCantidad,
  pluralizarUnidad,
  textoCantidadConUnidad,
} from "@/lib/medicacion/unidades"

describe("lib/medicacion/unidades.ts", () => {
  describe("pluralizarUnidad", () => {
    it("con cantidad 1 devuelve el singular guardado", () => {
      expect(pluralizarUnidad(1, "comprimido")).toBe("comprimido")
      expect(pluralizarUnidad(1, "unidad")).toBe("unidad")
    })

    it("pluraliza los sustantivos terminados en vocal con -s (el caso del bug)", () => {
      expect(pluralizarUnidad(90, "comprimido")).toBe("comprimidos")
      expect(pluralizarUnidad(2, "cápsula")).toBe("cápsulas")
      expect(pluralizarUnidad(3, "gota")).toBe("gotas")
      expect(pluralizarUnidad(4, "sobre")).toBe("sobres")
      expect(pluralizarUnidad(5, "parche")).toBe("parches")
    })

    it("pluraliza con -es lo terminado en d, l, n o r", () => {
      expect(pluralizarUnidad(20, "unidad")).toBe("unidades")
      expect(pluralizarUnidad(2, "papel")).toBe("papeles")
    })

    it("resuelve el plural irregular de -ón", () => {
      // Sin esta regla, la de `-es` daría "aplicaciónes".
      expect(pluralizarUnidad(3, "aplicación")).toBe("aplicaciones")
      expect(pluralizarUnidad(2, "inhalación")).toBe("inhalaciones")
    })

    it("deja intactos los símbolos de medida, que en castellano son invariables", () => {
      // La RAE fija que los símbolos de unidades de medida no llevan plural:
      // "10 ml", nunca "10 mls".
      expect(pluralizarUnidad(10, "ml")).toBe("ml")
      expect(pluralizarUnidad(850, "mg")).toBe("mg")
      expect(pluralizarUnidad(2, "g")).toBe("g")
      expect(pluralizarUnidad(30, "UI")).toBe("UI")
      expect(pluralizarUnidad(5, "cc")).toBe("cc")
      expect(pluralizarUnidad(2, "puff")).toBe("puff")
    })

    it("no toca lo que ya viene en plural ni lo que no sabe pluralizar", () => {
      expect(pluralizarUnidad(3, "gotas")).toBe("gotas")
      expect(pluralizarUnidad(2, "dosis")).toBe("dosis")
      // Terminación imprevista: preferible dejarla igual a inventar una forma.
      expect(pluralizarUnidad(2, "vademécum")).toBe("vademécum")
    })

    it("preserva la capitalización original", () => {
      expect(pluralizarUnidad(4, "Comprimido")).toBe("Comprimidos")
      expect(pluralizarUnidad(10, "ML")).toBe("ML")
    })

    it("tolera unidad vacía, nula o con espacios sobrantes", () => {
      expect(pluralizarUnidad(5, null)).toBe("")
      expect(pluralizarUnidad(5, undefined)).toBe("")
      expect(pluralizarUnidad(5, "   ")).toBe("")
      expect(pluralizarUnidad(5, "  comprimido  ")).toBe("comprimidos")
    })

    it("cantidad 0 usa el plural (no queda ningún comprimido)", () => {
      expect(pluralizarUnidad(0, "comprimido")).toBe("comprimidos")
    })

    it("una cantidad decimal usa el plural aunque sea menor que 1", () => {
      // "0,5 comprimidos" es lo que dice una persona; el singular se reserva
      // para el 1 exacto.
      expect(pluralizarUnidad(0.5, "comprimido")).toBe("comprimidos")
      expect(pluralizarUnidad(1.5, "comprimido")).toBe("comprimidos")
    })
  })

  describe("formatearCantidad", () => {
    it("los enteros van pelados, sin decimales de relleno", () => {
      expect(formatearCantidad(90)).toBe("90")
      expect(formatearCantidad(0)).toBe("0")
    })

    it("los decimales usan la coma del castellano", () => {
      expect(formatearCantidad(7.5)).toBe("7,5")
      expect(formatearCantidad(0.25)).toBe("0,25")
    })

    it("null y undefined cuentan como 0", () => {
      expect(formatearCantidad(null)).toBe("0")
      expect(formatearCantidad(undefined)).toBe("0")
    })
  })

  describe("textoCantidadConUnidad", () => {
    it("resuelve el caso del bug de punta a punta", () => {
      expect(textoCantidadConUnidad(90, "comprimido")).toBe("90 comprimidos")
    })

    it("mantiene el singular de la dosis por toma", () => {
      expect(textoCantidadConUnidad(1, "comprimido")).toBe("1 comprimido")
    })

    it("combina decimal e invariable", () => {
      expect(textoCantidadConUnidad(7.5, "ml")).toBe("7,5 ml")
    })

    it("sin unidad devuelve solo el número, sin espacio colgando", () => {
      expect(textoCantidadConUnidad(12, null)).toBe("12")
      expect(textoCantidadConUnidad(12, "")).toBe("12")
    })
  })
})
