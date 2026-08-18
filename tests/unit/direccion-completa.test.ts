/**
 * Tests de `lib/ubicacion/formato.ts#direccionCompleta` (Sprint 16, tarea 16.1).
 *
 *   npm run test -- direccion-completa
 */

import { describe, it, expect } from "vitest"

import { direccionCompleta } from "@/lib/ubicacion/formato"

describe("lib/ubicacion/formato.ts#direccionCompleta", () => {
  it("combina calle, ciudad y provincia en ese orden", () => {
    expect(
      direccionCompleta({
        direccion: "Avenida 51 Nº 315",
        ciudad: "La Plata",
        provincia: "Buenos Aires",
      }),
    ).toBe("Avenida 51 Nº 315, La Plata, Buenos Aires")
  })

  it("funciona solo con la calle (turno viejo, sin ciudad/provincia cargadas)", () => {
    expect(direccionCompleta({ direccion: "Gob. Paz 150" })).toBe("Gob. Paz 150")
  })

  it("saltea la calle si falta, sin dejar comas colgando", () => {
    expect(direccionCompleta({ ciudad: "La Plata", provincia: "Buenos Aires" })).toBe(
      "La Plata, Buenos Aires",
    )
  })

  it("saltea la ciudad si falta pero hay calle y provincia", () => {
    expect(
      direccionCompleta({ direccion: "Gob. Paz 150", provincia: "Tierra del Fuego, Antártida e Islas del Atlántico Sur" }),
    ).toBe("Gob. Paz 150, Tierra del Fuego, Antártida e Islas del Atlántico Sur")
  })

  it("devuelve null si las tres partes están ausentes", () => {
    expect(direccionCompleta({})).toBeNull()
  })

  it("devuelve null si las tres partes son null", () => {
    expect(direccionCompleta({ direccion: null, ciudad: null, provincia: null })).toBeNull()
  })

  it("devuelve null si las tres partes son solo espacios", () => {
    expect(direccionCompleta({ direccion: "   ", ciudad: "  ", provincia: " " })).toBeNull()
  })

  it("recorta espacios de cada parte", () => {
    expect(
      direccionCompleta({ direccion: "  Gob. Paz 150  ", ciudad: " Ushuaia ", provincia: undefined }),
    ).toBe("Gob. Paz 150, Ushuaia")
  })
})
