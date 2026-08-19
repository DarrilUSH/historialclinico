// @vitest-environment jsdom

/**
 * Tests de `TarjetaDestino` (`components/compartir/tarjeta-destino.tsx`),
 * hermana de `components/perfiles/tarjeta-perfil.tsx` -mismo split a Client
 * Component, mismo motivo (P0 de rendimiento percibido, 2026-08-18)-, así
 * que cubre exactamente las mismas dos piezas: ver el encabezado de
 * `tests/unit/tarjeta-perfil.test.tsx` para el porqué de cada una.
 *
 *   npm run test -- tarjeta-destino
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Perfil } from "@/types/dominio"

const elegirPerfilParaCompartido = vi.fn()

vi.mock("@/app/(app)/(sin-nav)/compartir/actions", () => ({
  elegirPerfilParaCompartido: (...args: unknown[]) => elegirPerfilParaCompartido(...args),
}))

const { TarjetaDestino } = await import("@/components/compartir/tarjeta-destino")

const ARCHIVO_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

function perfilFalso(sobrescribir: Partial<Perfil> = {}): Perfil {
  return {
    allergies: [],
    avatar_storage_path: null,
    blood_type: null,
    chronic_conditions: [],
    created_at: "2026-08-01T00:00:00Z",
    created_by_profile_id: null,
    critical_medication: [],
    date_of_birth: null,
    display_density: "chica",
    emergency_contact: null,
    emergency_contact_phone: null,
    emergency_contact_relationship: null,
    full_name: "Juana Pérez",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    national_id: null,
    phone: null,
    role: "admin",
    sos_notes: null,
    sos_updated_at: null,
    updated_at: "2026-08-01T00:00:00Z",
    user_id: "11111111-1111-4111-8111-111111111111",
    ...sobrescribir,
  }
}

beforeEach(() => {
  elegirPerfilParaCompartido.mockReset()
})

afterEach(() => {
  cleanup()
})

describe("TarjetaDestino — estado en reposo", () => {
  it("muestra el nombre y el badge de relación, sin spinner ni aria-busy", () => {
    render(
      <TarjetaDestino archivoId={ARCHIVO_ID} perfil={perfilFalso()} esPropio canManage forzar={false} />,
    )

    const boton = screen.getByRole("button", { name: /Juana Pérez/i }) as HTMLButtonElement
    expect(boton.getAttribute("aria-busy")).not.toBe("true")
    expect(boton.disabled).toBe(false)
    expect(screen.getByText("Tu perfil")).toBeTruthy()
  })

  it('con forzar=true agrega el campo oculto "forzar=1" (reintento de "Cargar igual")', () => {
    const { container } = render(
      <TarjetaDestino archivoId={ARCHIVO_ID} perfil={perfilFalso()} esPropio canManage forzar />,
    )

    const oculto = container.querySelector('input[type="hidden"][name="forzar"]')
    expect(oculto).not.toBeNull()
    expect((oculto as HTMLInputElement).value).toBe("1")
  })
})

describe("TarjetaDestino — estado pendiente (feedback de espera)", () => {
  it("al tocarla, queda aria-busy, deshabilitada y con spinner mientras la acción no resuelve", async () => {
    let resolver: () => void = () => {}
    elegirPerfilParaCompartido.mockReturnValue(
      new Promise<void>((resolve) => {
        resolver = resolve
      }),
    )

    render(
      <TarjetaDestino archivoId={ARCHIVO_ID} perfil={perfilFalso()} esPropio canManage forzar={false} />,
    )

    const boton = screen.getByRole("button", { name: /Juana Pérez/i }) as HTMLButtonElement
    fireEvent.click(boton)

    await waitFor(() => expect(boton.disabled).toBe(true))
    expect(boton.getAttribute("aria-busy")).toBe("true")
    expect(screen.getByText("Cargando…")).toBeTruthy()
    expect(screen.queryByText("Tu perfil")).toBeNull()

    resolver()
    await waitFor(() => expect(boton.disabled).toBe(false))
  })
})

describe("TarjetaDestino — guardia anti doble-envío", () => {
  it("dos toques sincrónicos disparan elegirPerfilParaCompartido UNA sola vez", async () => {
    let resolver: () => void = () => {}
    elegirPerfilParaCompartido.mockReturnValue(
      new Promise<void>((resolve) => {
        resolver = resolve
      }),
    )

    render(
      <TarjetaDestino archivoId={ARCHIVO_ID} perfil={perfilFalso()} esPropio canManage forzar={false} />,
    )

    const boton = screen.getByRole("button", { name: /Juana Pérez/i }) as HTMLButtonElement

    fireEvent.click(boton)
    fireEvent.click(boton)

    expect(elegirPerfilParaCompartido).toHaveBeenCalledTimes(1)
    expect(elegirPerfilParaCompartido).toHaveBeenCalledWith(
      ARCHIVO_ID,
      perfilFalso().id,
      expect.anything(),
    )

    resolver()
    await waitFor(() => expect(boton.disabled).toBe(false))
  })
})
