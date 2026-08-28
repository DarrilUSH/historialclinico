/**
 * Test de la lógica pura de instalación de la PWA (`lib/pwa/boton-instalar.ts`).
 * Sin DOM: `environment: "node"` en `vitest.config.ts`.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import {
  debeMostrarBotonInstalar,
  detectarIOS,
  estadoTarjetaInstalar,
} from "@/lib/pwa/boton-instalar.ts"

describe("lib/pwa/boton-instalar.ts#debeMostrarBotonInstalar", () => {
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

describe("lib/pwa/boton-instalar.ts#detectarIOS", () => {
  it("detecta un iPhone por el userAgent clásico", () => {
    const userAgent =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
    expect(detectarIOS({ userAgent, maxTouchPoints: 5 })).toBe(true)
  })

  it("detecta un iPad disfrazado de Mac (iPadOS 13+, userAgent de escritorio + táctil)", () => {
    const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15"
    expect(detectarIOS({ userAgent, maxTouchPoints: 5 })).toBe(true)
  })

  it("una Mac de verdad (sin puntos táctiles) NO es iOS", () => {
    const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15"
    expect(detectarIOS({ userAgent, maxTouchPoints: 0 })).toBe(false)
  })

  it("Android no es iOS", () => {
    const userAgent = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36"
    expect(detectarIOS({ userAgent, maxTouchPoints: 5 })).toBe(false)
  })
})

describe("lib/pwa/boton-instalar.ts#estadoTarjetaInstalar", () => {
  it("con el prompt capturado, en celular, sin instalar: 'instalar' (hay botón real)", () => {
    expect(
      estadoTarjetaInstalar({
        promptCapturado: true,
        enModoStandalone: false,
        esIOS: false,
        esViewportMovil: true,
      }),
    ).toBe("instalar")
  })

  it("iOS, sin prompt (Safari nunca lo dispara), en celular: 'instrucciones_ios'", () => {
    expect(
      estadoTarjetaInstalar({
        promptCapturado: false,
        enModoStandalone: false,
        esIOS: true,
        esViewportMovil: true,
      }),
    ).toBe("instrucciones_ios")
  })

  it("ya instalada (standalone): 'oculto', aunque haya prompt capturado", () => {
    expect(
      estadoTarjetaInstalar({
        promptCapturado: true,
        enModoStandalone: true,
        esIOS: false,
        esViewportMovil: true,
      }),
    ).toBe("oculto")
  })

  it("viewport de escritorio: 'oculto', aunque haya prompt capturado (consejo específico de celular)", () => {
    expect(
      estadoTarjetaInstalar({
        promptCapturado: true,
        enModoStandalone: false,
        esIOS: false,
        esViewportMovil: false,
      }),
    ).toBe("oculto")
  })

  it("celular, sin instalar, sin prompt y sin ser iOS (Chrome que todavía no emitió el evento): 'oculto', NUNCA un botón muerto", () => {
    expect(
      estadoTarjetaInstalar({
        promptCapturado: false,
        enModoStandalone: false,
        esIOS: false,
        esViewportMovil: true,
      }),
    ).toBe("oculto")
  })
})
