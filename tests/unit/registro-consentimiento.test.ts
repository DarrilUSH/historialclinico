/**
 * Test de `registrarse` (`app/(auth)/actions.ts`) enfocado en el criterio de
 * aceptación de la tarea 12.1 (Ley 25.326, ROADMAP_SPRINTS.md línea 745): no
 * se puede completar el registro sin aceptar explícitamente Privacidad y
 * Términos, y el consentimiento aceptado queda registrado.
 *
 * Todo lo externo va mockeado -Supabase, `next/headers`, `next/navigation`-
 * para probar únicamente las ramas de decisión de `registrarse`, sin salir a
 * la red.
 *
 * ## Dónde quedó cada mitad del criterio después del hotfix
 *
 * - **"No se puede completar el registro sin aceptar"** — sigue acá: es la
 *   revalidación server-side de `aceptaLegales`, la única que de verdad
 *   importa (un `formData` se puede alterar; el `required` del checkbox es
 *   conveniencia del navegador). Nada de esto cambió con el hotfix.
 * - **"El consentimiento queda registrado"** — se mudó a la base
 *   (`supabase/migrations/20260814140000_alta_de_cuenta.sql`), porque en
 *   producción `signUp` no devuelve sesión y la aplicación no podía escribir
 *   la fila bajo RLS. Que la versión aceptada VIAJE hasta allá lo prueba
 *   `tests/unit/alta-de-cuenta.test.ts`; que la fila realmente aparezca, con
 *   versión y timestamp, lo prueba `scripts/test-rls.sql` BLOQUE 19.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockClient, mockSignUp, mockFrom } = vi.hoisted(() => {
  const mockSignUp = vi.fn()
  const mockFrom = vi.fn((tabla: string) => {
    throw new Error(`Tabla inesperada en el mock: ${tabla}`)
  })

  return {
    mockClient: { auth: { signUp: mockSignUp }, from: mockFrom },
    mockSignUp,
    mockFrom,
  }
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

vi.mock("@/lib/perfil-activo", () => ({
  limpiarPerfilActivo: vi.fn(),
}))

import { registrarse } from "@/app/(auth)/actions"
import { redirect } from "next/navigation"
import { VERSION_LEGALES } from "@/lib/legales"

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
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rechaza igual con aceptaLegales="off" (valor real de un checkbox HTML sin marcar cuando SÍ viaja)', async () => {
    const formData = formularioValido({ aceptaLegales: "off" })

    const resultado = await registrarse({ error: null }, formData)

    expect(resultado.error).toMatch(/Política de Privacidad|Términos/i)
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it("[CRITERIO DE ACEPTACIÓN] con el checkbox marcado, el alta lleva la versión legal aceptada", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: USUARIO_FALSO, session: { access_token: "token" } },
      error: null,
    })

    const formData = formularioValido({ aceptaLegales: "on" })

    await expect(registrarse({ error: null }, formData)).rejects.toThrow("[REDIRECT]")

    expect(mockSignUp).toHaveBeenCalledOnce()
    // La versión que se registra es la que esta persona tenía a la vista al
    // marcar el checkbox, no la que esté vigente cuando la base procese el
    // alta: con confirmación por correo esos dos momentos pueden ser
    // distintos. Por eso viaja en el metadata en vez de deducirse allá.
    expect(mockSignUp.mock.calls[0][0].options.data.legales_version).toBe(
      VERSION_LEGALES,
    )
    expect(redirect).toHaveBeenCalledWith("/perfiles")
  })

  it("si el alta falla en Supabase, no redirige y avisa en castellano", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    })

    const formData = formularioValido({ aceptaLegales: "on" })

    const resultado = await registrarse({ error: null }, formData)

    expect(resultado.error).toMatch(/No pudimos crear la cuenta/i)
    expect(redirect).not.toHaveBeenCalled()
  })
})
