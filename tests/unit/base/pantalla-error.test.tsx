// @vitest-environment jsdom

/**
 * Test de render del estado de error de pantalla completa
 * (`components/base/pantalla-error.tsx`), el que reemplazó a la pantalla
 * cruda de Next tras el P0 del 2026-08-19.
 *
 * Lo que se fija acá no es estética: es la promesa que la pantalla tiene que
 * cumplir cuando alguien con 47 estudios cargados ve que su historial no
 * abre. Tres cosas, y las tres son requisitos, no adornos:
 *
 *   1. Decir, en castellano y sin jerga, que **los datos no se perdieron**.
 *   2. Ofrecer un camino de vuelta que se pueda tocar (reintentar).
 *   3. No mostrar nunca la palabra "JWT", ni un stack, ni un mensaje en
 *      inglés.
 *
 * Sin matchers de `@testing-library/jest-dom` (no está instalado), igual que
 * `tests/unit/base/velo-espera.test.tsx`: se afirma con la API del DOM.
 *
 *   npm run test
 */

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PantallaError } from "@/components/base/pantalla-error"

function errorDePrueba(digest?: string): Error & { digest?: string } {
  // Así llega en producción: Next borra el mensaje original del servidor y
  // deja solo el genérico más el digest.
  const error = new Error(
    "An error occurred in the Server Components render. The specific message is omitted in production builds.",
  ) as Error & { digest?: string }
  if (digest) {
    error.digest = digest
  }
  return error
}

beforeEach(() => {
  // El componente registra el error en consola a propósito (queda en la
  // captura que manda quien reporta el problema). Acá se silencia.
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("components/base/pantalla-error.tsx", () => {
  it("dice que el historial está guardado, que es lo que la persona necesita saber primero", () => {
    render(<PantallaError error={errorDePrueba()} alReintentar={() => {}} />)

    const texto = document.body.textContent ?? ""
    expect(texto).toContain("Tu historial está guardado y completo")
    expect(texto).toContain("no se perdió nada")
  })

  it("encabeza con un h1 en castellano", () => {
    render(<PantallaError error={errorDePrueba()} alReintentar={() => {}} />)

    const titulo = screen.getByRole("heading", { level: 1 })
    expect(titulo.textContent).toBe("No pudimos abrir esta pantalla")
  })

  it("el botón de reintentar llama a `retry` del boundary de Next", async () => {
    const alReintentar = vi.fn()
    render(<PantallaError error={errorDePrueba()} alReintentar={alReintentar} />)

    const boton = screen.getByRole("button", { name: /probar de nuevo/i })
    boton.click()

    expect(alReintentar).toHaveBeenCalledTimes(1)
  })

  it("ofrece además una salida a /inicio como navegación completa (no <Link>)", () => {
    render(<PantallaError error={errorDePrueba()} alReintentar={() => {}} />)

    const enlace = screen.getByRole("link", { name: /ir al inicio/i })
    expect(enlace.getAttribute("href")).toBe("/inicio")
  })

  it("`sinEnlaceAlInicio` saca esa salida (la usa global-error: el layout raíz es el que falló)", () => {
    render(<PantallaError error={errorDePrueba()} alReintentar={() => {}} sinEnlaceAlInicio />)

    expect(screen.queryByRole("link", { name: /ir al inicio/i })).toBeNull()
  })

  it("muestra el digest para poder cruzarlo con el log del servidor", () => {
    render(<PantallaError error={errorDePrueba("2003924932")} alReintentar={() => {}} />)

    expect(document.body.textContent).toContain("2003924932")
  })

  it("sin digest no inventa ningún código", () => {
    render(<PantallaError error={errorDePrueba()} alReintentar={() => {}} />)

    expect(document.body.textContent).not.toContain("pasanos este código")
  })

  it("no filtra jerga técnica ni el mensaje en inglés que trae el error", () => {
    render(<PantallaError error={errorDePrueba("2003924932")} alReintentar={() => {}} />)

    const texto = document.body.textContent ?? ""
    for (const jerga of ["JWT", "Server Components", "error occurred", "500", "PGRST"]) {
      expect(texto).not.toContain(jerga)
    }
  })
})
