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

    it("no queda montado para siempre si el temporizador dispara DESPUÉS de que `visible` volvió a false [regresión, Sprint 17]", () => {
      // ── LA VENTANA REAL, Y POR QUÉ HAY QUE FORZARLA
      //
      // El ajuste de estado del render apaga `montado` en el acto, y la
      // limpieza del efecto cancela el temporizador. Pero la limpieza es un
      // efecto PASIVO: React la agenda para después del commit. Si el
      // temporizador dispara en esa ventana, `setMontado(true)` entra con
      // `visible` ya en `false`, y desde ahí `visible === visiblePrevio` para
      // siempre: el ajuste del render no vuelve a correr y el velo queda
      // montado de forma permanente, con toda la página `inert` detrás.
      //
      // `rerender` de testing-library envuelve todo en `act`, que flushea los
      // efectos pasivos de inmediato: la ventana no existe adentro del test.
      // Por eso se captura el callback del temporizador y se lo ejecuta A MANO
      // después del rerender — que es exactamente lo que pasa en el navegador
      // cuando ya había disparado antes de que corriera la limpieza.
      //
      // Encontrado en el Galaxy real desconectando Gmail (Sprint 17, 17.1):
      // la Server Action revalida la ruta y el `isPending` de `useActionState`
      // se apaga alrededor de los 450 ms, justo en la ventana.
      const disparos: Array<() => void> = []
      const espia = vi
        .spyOn(window, "setTimeout")
        .mockImplementation(((callback: () => void) => {
          disparos.push(callback)
          return 0 as unknown as ReturnType<typeof window.setTimeout>
        }) as unknown as typeof window.setTimeout)

      const { rerender } = render(<VeloEspera visible mensaje="Desconectando…" />)
      rerender(<VeloEspera visible={false} mensaje="Desconectando…" />)

      expect(disparos).toHaveLength(1)
      act(() => {
        for (const disparar of disparos) disparar()
      })
      espia.mockRestore()

      expect(screen.queryByRole("status")).toBeNull()
      // Y la página de atrás quedó utilizable: sin `inert` ni scroll bloqueado.
      expect(document.body.style.overflow).not.toBe("hidden")
      for (const hijo of Array.from(document.body.children)) {
        expect(hijo.hasAttribute("inert")).toBe(false)
      }
    })

    it("si `visible` vuelve a `true` después de ese falso disparo, el velo aparece igual", () => {
      // La guarda no puede dejar el componente inutilizable para siempre: el
      // caso de "desconectar, arrepentirse y volver a conectar" tiene que
      // seguir mostrando el velo.
      const disparos: Array<() => void> = []
      const espia = vi
        .spyOn(window, "setTimeout")
        .mockImplementation(((callback: () => void) => {
          disparos.push(callback)
          return 0 as unknown as ReturnType<typeof window.setTimeout>
        }) as unknown as typeof window.setTimeout)

      const { rerender } = render(<VeloEspera visible mensaje="Desconectando…" />)
      rerender(<VeloEspera visible={false} mensaje="Desconectando…" />)
      act(() => {
        for (const disparar of disparos) disparar()
      })
      espia.mockRestore()
      expect(screen.queryByRole("status")).toBeNull()

      rerender(<VeloEspera visible mensaje="Conectando…" />)
      act(() => {
        vi.advanceTimersByTime(450)
      })

      expect(screen.getByRole("status").textContent).toContain("Conectando…")
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
