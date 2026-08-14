/**
 * Test de la lógica pura del botón de instalación (`lib/pwa/boton-instalar.ts`).
 * Sin DOM: `environment: "node"` en `vitest.config.ts`.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import { debeMostrarBotonInstalar } from "@/lib/pwa/boton-instalar.ts"

describe("lib/pwa/boton-instalar.ts", () => {
  it("se muestra con el prompt capturado y sin estar instalada", () => {
    expect(
      debeMostrarBotonInstalar({ promptCapturado: true, enModoStandalone: false }),
    ).toBe(true)
  })

  it("no se muestra sin el prompt (iOS, o Chrome que todavía no lo emitió)", () => {
    expect(
      debeMostrarBotonInstalar({ promptCapturado: false, enModoStandalone: false }),
    ).toBe(false)
  })

  it("no se muestra si ya está instalada, aunque el prompt haya llegado antes", () => {
    expect(
      debeMostrarBotonInstalar({ promptCapturado: true, enModoStandalone: true }),
    ).toBe(false)
  })

  it("no se muestra sin prompt y ya instalada", () => {
    expect(
      debeMostrarBotonInstalar({ promptCapturado: false, enModoStandalone: true }),
    ).toBe(false)
  })
})
