/**
 * Test de `registrarse` (`app/(auth)/actions.ts`) enfocado en el criterio de
 * aceptación de la tarea 12.1 (Ley 25.326, ROADMAP_SPRINTS.md línea 745): no
 * se puede completar el registro sin aceptar explícitamente Privacidad y
 * Términos, y el consentimiento aceptado queda registrado.
 *
 * Todo lo externo va mockeado -Supabase, `next/headers`, `next/navigation`,
 * `lib/legales`- para probar únicamente las ramas de decisión de
 * `registrarse`, sin salir a la red. El caso SQL (que la fila realmente
 * quede en `consents` con versión y timestamp, bajo RLS real) lo cubre
 * `scripts/test-rls.sql` BLOQUE 18.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockClient, mockSignUp, mockInsertProfiles, mockRegistrarConsentimientosDeAlta } =
  vi.hoisted(() => {
    const mockSignUp = vi.fn()
    const mockInsertProfiles = vi.fn()
    const mockRegistrarConsentimientosDeAlta = vi.fn()

    const mockClient = {
      auth: { signUp: mockSignUp },
      from: (tabla: string) => {
        if (tabla !== "profiles") {
          throw new Error(`Tabla inesperada en el mock: ${tabla}`)
        }
        return { insert: mockInsertProfiles }
      },
    }

    return { mockClient, mockSignUp, mockInsertProfiles, mockRegistrarConsentimientosDeAlta }
  })

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map()),
}))

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`[REDIRECT] ${url}`)
  }),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => mockClient),
}))

vi.mock("@/lib/auditoria", () => ({
  ACCION: { login: "login" },
  registrarAcceso: vi.fn(),
}))

vi.mock("@/lib/densidad/servidor", () => ({
  limpiarCookieTamano: vi.fn(),
  sincronizarCookieTamano: vi.fn(),
}))

vi.mock("@/lib/legales", () => ({
  registrarConsentimientosDeAlta: mockRegistrarConsentimientosDeAlta,
}))

vi.mock("@/lib/perfil-activo", () => ({
  limpiarPerfilActivo: vi.fn(),
}))

import { registrarse } from "@/app/(auth)/actions"
import { redirect } from "next/navigation"

const USUARIO_FALSO = { id: "usuario-nuevo-123" }

function formularioValido(camposExtra: Record<string, string> = {}): FormData {
  const formData = new FormData()
  formData.set("fullName", "Juana Pérez")
  formData.set("email", "juana@ejemplo.com.ar")
  formData.set("password", "contrasena-larga")
  formData.set("confirmarPassword", "contrasena-larga")
  for (const [clave, valor] of Object.entries(camposExtra)) {
    formData.set(clave, valor)
  }
  return formData
}

describe("registrarse — consentimiento (Sprint 12, tarea 12.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("[CRITERIO DE ACEPTACIÓN] sin el checkbox marcado, rechaza el registro sin tocar Supabase", async () => {
    // Un checkbox HTML sin marcar NI SIQUIERA manda su campo: se simula
    // omitiendo "aceptaLegales" del FormData, no mandándolo en "off".
    const formData = formularioValido()

    const resultado = await registrarse({ error: null }, formData)

    expect(resultado.error).toMatch(/Política de Privacidad|Términos/i)
    expect(mockSignUp).not.toHaveBeenCalled()
    expect(mockInsertProfiles).not.toHaveBeenCalled()
    expect(mockRegistrarConsentimientosDeAlta).not.toHaveBeenCalled()
  })

  it('rechaza igual con aceptaLegales="off" (valor real de un checkbox HTML sin marcar cuando SÍ viaja)', async () => {
    const formData = formularioValido({ aceptaLegales: "off" })

    const resultado = await registrarse({ error: null }, formData)

    expect(resultado.error).toMatch(/Política de Privacidad|Términos/i)
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it("con el checkbox marcado, completa el alta y registra el consentimiento del usuario recién creado", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: USUARIO_FALSO, session: { access_token: "token" } },
      error: null,
    })
    mockInsertProfiles.mockResolvedValue({ error: null })
    mockRegistrarConsentimientosDeAlta.mockResolvedValue({ error: null })

    const formData = formularioValido({ aceptaLegales: "on" })

    await expect(registrarse({ error: null }, formData)).rejects.toThrow("[REDIRECT]")

    expect(mockSignUp).toHaveBeenCalledOnce()
    expect(mockInsertProfiles).toHaveBeenCalledOnce()
    // El consentimiento se registra DESPUÉS de crear el perfil, con el id de
    // la cuenta recién creada -no un id inventado ni el de otra sesión-.
    expect(mockRegistrarConsentimientosDeAlta).toHaveBeenCalledWith(
      mockClient,
      USUARIO_FALSO.id,
    )
    expect(redirect).toHaveBeenCalledWith("/perfiles")
  })

  it("si falla el registro del consentimiento, avisa y NO redirige (no se pierde en silencio)", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: USUARIO_FALSO, session: { access_token: "token" } },
      error: null,
    })
    mockInsertProfiles.mockResolvedValue({ error: null })
    mockRegistrarConsentimientosDeAlta.mockResolvedValue({
      error: "la base no respondió",
    })

    const formData = formularioValido({ aceptaLegales: "on" })

    const resultado = await registrarse({ error: null }, formData)

    expect(resultado.error).toMatch(/consentimiento/i)
    expect(redirect).not.toHaveBeenCalled()
  })
})
