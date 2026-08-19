// @vitest-environment jsdom

/**
 * Tests de `TarjetaPerfil` (`components/perfiles/tarjeta-perfil.tsx`), la
 * tarjeta del selector "estilo Netflix" que se separó a Client Component
 * (P0 de rendimiento percibido, 2026-08-18) para poder mostrar estado
 * pendiente y blindarse contra el doble toque.
 *
 * Cubre las dos piezas nuevas:
 *
 * 1. **Feedback de espera** (`useFormStatus`): mientras `elegirPerfil` está
 *    en vuelo, la tarjeta queda `aria-busy`, deshabilitada y cambia su
 *    contenido visible (avatar → spinner, badge → "Entrando…").
 * 2. **Guardia anti doble-envío**: dos `submit` sincrónicos -la reproducción
 *    de un doble toque humano, antes de que React llegue a deshabilitar el
 *    botón- solo disparan la Server Action UNA vez (mismo patrón, y mismo
 *    motivo, que `formulario-crear-gestionado.tsx`: sin `useActionState`,
 *    React no encola el segundo `submit` para descartarlo solo).
 *
 *   npm run test -- tarjeta-perfil
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Perfil } from "@/types/dominio"

const elegirPerfil = vi.fn()

vi.mock("@/app/(app)/(sin-nav)/perfiles/actions", () => ({
  elegirPerfil: (...args: unknown[]) => elegirPerfil(...args),
}))

const { TarjetaPerfil } = await import("@/components/perfiles/tarjeta-perfil")

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
  elegirPerfil.mockReset()
})

afterEach(() => {
  cleanup()
})

describe("TarjetaPerfil — estado en reposo", () => {
  it("muestra el nombre y el badge de relación, sin spinner ni aria-busy", () => {
    render(<TarjetaPerfil perfil={perfilFalso()} esPropio canUpload canManage />)

    const boton = screen.getByRole("button", { name: /Juana Pérez/i }) as HTMLButtonElement
    expect(boton.getAttribute("aria-busy")).not.toBe("true")
    expect(boton.disabled).toBe(false)
    expect(screen.getByText("Tu perfil")).toBeTruthy()
  })

  it('un perfil sin cuenta propia agrega el subtítulo "Sin cuenta propia"', () => {
    render(
      <TarjetaPerfil
        perfil={perfilFalso({ user_id: null, full_name: "Roberto Gómez" })}
        esPropio={false}
        canUpload
        canManage
      />,
    )

    expect(screen.getByText("Sin cuenta propia")).toBeTruthy()
  })
})

describe("TarjetaPerfil — estado pendiente (feedback de espera)", () => {
  it("al tocarla, queda aria-busy, deshabilitada y con spinner mientras la acción no resuelve", async () => {
    let resolver: () => void = () => {}
    elegirPerfil.mockReturnValue(
      new Promise<void>((resolve) => {
        resolver = resolve
      }),
    )

    render(<TarjetaPerfil perfil={perfilFalso()} esPropio canUpload canManage />)

    const boton = screen.getByRole("button", { name: /Juana Pérez/i }) as HTMLButtonElement
    fireEvent.click(boton)

    await waitFor(() => expect(boton.disabled).toBe(true))
    expect(boton.getAttribute("aria-busy")).toBe("true")
    expect(screen.getByText("Entrando…")).toBeTruthy()
    // El badge de relación se reemplaza por el estado pendiente -no
    // conviven los dos-, mismo criterio visual que el resto de la app.
    expect(screen.queryByText("Tu perfil")).toBeNull()

    resolver()
    await waitFor(() => expect(boton.disabled).toBe(false))
  })
})

describe("TarjetaPerfil — guardia anti doble-envío", () => {
  it("dos toques sincrónicos disparan elegirPerfil UNA sola vez (mismo patrón que crear-gestionado)", async () => {
    let resolver: () => void = () => {}
    elegirPerfil.mockReturnValue(
      new Promise<void>((resolve) => {
        resolver = resolve
      }),
    )

    render(<TarjetaPerfil perfil={perfilFalso()} esPropio canUpload canManage />)

    const boton = screen.getByRole("button", { name: /Juana Pérez/i }) as HTMLButtonElement

    // Dos toques en la MISMA pasada, antes de cualquier re-render -la
    // ventana real donde `disabled` todavía no llegó- mismo criterio que
    // `formulario-cobertura.test.tsx`.
    fireEvent.click(boton)
    fireEvent.click(boton)

    expect(elegirPerfil).toHaveBeenCalledTimes(1)
    expect(elegirPerfil).toHaveBeenCalledWith(perfilFalso().id, expect.anything())

    resolver()
    await waitFor(() => expect(boton.disabled).toBe(false))
  })
})
