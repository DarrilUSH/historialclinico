// @vitest-environment jsdom

/**
 * Test de render del velo de espera global (`components/base/velo-espera.tsx`,
 * Sprint 14, "Feedback de espera global").
 *
 * Es el PRIMER test de esta suite que necesita DOM real: `vitest.config.ts`
 * sigue corriendo el resto de `tests/unit/` en `environment: "node"` -sin
 * jsdom, más rápido, y suficiente para lógica pura-, y este archivo pide su
 * propio entorno con el comentario `@vitest-environment` de la primera línea
 * (debe ser literalmente eso: la convención que lee Vitest para overridear el
 * entorno POR ARCHIVO). No se usan matchers de `@testing-library/jest-dom`
 * -no está instalado, y agregar una cuarta dependencia de test solo para
 * azúcar sintáctica (`toBeInTheDocument`, etc.) no valía la pena-: se afirma
 * con la API del DOM directamente (`.textContent`, `.getAttribute`,
 * `queryByRole(...) === null`).
 *
 *   npm run test
 */

import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { VeloEspera } from "@/components/base/velo-espera"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("components/base/velo-espera.tsx", () => {
  describe("aparición diferida", () => {
    it("no aparece antes de los 450ms por defecto (evita el parpadeo en operaciones rápidas)", () => {
      render(<VeloEspera visible mensaje="Guardando…" />)

      act(() => {
        vi.advanceTimersByTime(449)
      })

      expect(screen.queryByRole("status")).toBeNull()
    })

    it("aparece apenas se cumplen los 450ms si la operación sigue en curso", () => {
      render(<VeloEspera visible mensaje="Guardando…" />)

      act(() => {
        vi.advanceTimersByTime(450)
      })

      expect(screen.getByRole("status").textContent).toContain("Guardando…")
    })

    it("nunca llega a aparecer si `visible` vuelve a `false` antes del retraso", () => {
      const { rerender } = render(<VeloEspera visible mensaje="Guardando…" />)

      act(() => {
        vi.advanceTimersByTime(300)
      })
      rerender(<VeloEspera visible={false} mensaje="Guardando…" />)

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(screen.queryByRole("status")).toBeNull()
    })

    it("respeta un `retrasoMs` propio en vez del default", () => {
      render(<VeloEspera visible mensaje="Guardando…" retrasoMs={100} />)

      act(() => {
        vi.advanceTimersByTime(99)
      })
      expect(screen.queryByRole("status")).toBeNull()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(screen.queryByRole("status")).not.toBeNull()
    })

    it("se desmonta apenas `visible` vuelve a `false`, sin esperar ninguna animación de salida", () => {
      const { rerender } = render(<VeloEspera visible mensaje="Guardando…" />)

      act(() => {
        vi.advanceTimersByTime(450)
      })
      expect(screen.queryByRole("status")).not.toBeNull()

      rerender(<VeloEspera visible={false} mensaje="Guardando…" />)

      expect(screen.queryByRole("status")).toBeNull()
    })
  })

  describe("mensaje por etapa", () => {
    it("actualiza el texto sin desmontarse cuando cambia `mensaje` (las etapas de la ingesta de estudios)", () => {
      const { rerender } = render(<VeloEspera visible mensaje="Subiendo el archivo…" />)

      act(() => {
        vi.advanceTimersByTime(450)
      })
      expect(screen.getByRole("status").textContent).toContain("Subiendo el archivo…")

      rerender(
        <VeloEspera visible mensaje="La inteligencia artificial está leyendo tu estudio…" />,
      )

      expect(screen.getByRole("status").textContent).toContain(
        "La inteligencia artificial está leyendo tu estudio…",
      )
      expect(screen.getByRole("status").textContent).not.toContain("Subiendo el archivo…")
    })
  })

  describe("accesibilidad", () => {
    it("expone role=status y aria-live=polite, con mensaje y submensaje", () => {
      render(
        <VeloEspera
          visible
          mensaje="Subiendo el archivo…"
          submensaje="Esto puede tardar hasta un minuto. No cierres la aplicación."
        />,
      )

      act(() => {
        vi.advanceTimersByTime(450)
      })

      const tarjeta = screen.getByRole("status")
      expect(tarjeta.getAttribute("aria-live")).toBe("polite")
      expect(tarjeta.textContent).toContain("Subiendo el archivo…")
      expect(tarjeta.textContent).toContain(
        "Esto puede tardar hasta un minuto. No cierres la aplicación.",
      )
    })

    it("no renderiza ningún submensaje cuando no se pasa la prop", () => {
      render(<VeloEspera visible mensaje="Guardando…" />)

      act(() => {
        vi.advanceTimersByTime(450)
      })

      // Un solo párrafo (el mensaje principal) dentro de la tarjeta.
      expect(screen.getByRole("status").querySelectorAll("p")).toHaveLength(1)
    })

    it("marca `inert` en el resto de la página mientras está visible, y lo restaura al ocultarse", () => {
      const otroControl = document.createElement("button")
      otroControl.textContent = "Un botón de la pantalla de atrás"
      document.body.appendChild(otroControl)

      const { rerender } = render(<VeloEspera visible mensaje="Guardando…" />)

      // Antes de montar el velo, nada detrás está marcado.
      expect(otroControl.hasAttribute("inert")).toBe(false)

      act(() => {
        vi.advanceTimersByTime(450)
      })

      expect(otroControl.hasAttribute("inert")).toBe(true)

      rerender(<VeloEspera visible={false} mensaje="Guardando…" />)

      expect(otroControl.hasAttribute("inert")).toBe(false)

      otroControl.remove()
    })
  })
})
