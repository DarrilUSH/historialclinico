/**
 * Test del HOTFIX de producción del alta de cuenta
 * (`supabase/migrations/20260814140000_alta_de_cuenta.sql`).
 *
 * ## Qué se rompió
 *
 * `registrarse` (`app/(auth)/actions.ts`) creaba `profiles` y `consents`
 * después del `signUp`, con la sesión que ese `signUp` devuelve. En
 * producción la confirmación por correo está encendida y esa sesión NO
 * existe: la cuenta quedaba en `auth.users` sin perfil y sin prueba de
 * consentimiento, y `/perfiles` mostraba "Todavía no hay perfiles
 * disponibles para tu cuenta".
 *
 * ## Qué prueba este archivo
 *
 * El contrato que quedó entre la aplicación y la base: la aplicación NO
 * escribe esas filas —las escribe un trigger `AFTER INSERT ON auth.users`—,
 * y lo único que tiene que hacer es mandar por `options.data` los dos datos
 * que el trigger no puede adivinar. Si alguien "arregla" `registrarse`
 * volviendo a insertar el perfil a mano, o se olvida de mandar la versión
 * legal, estos casos fallan.
 *
 * El comportamiento del trigger EN SÍ (que la fila realmente aparezca, con
 * los fallbacks correctos y sin duplicar en la segunda pasada) no se puede
 * probar acá: vive en la base y lo cubre `scripts/test-rls.sql` BLOQUE 19,
 * que simula el flujo de producción insertando directo en `auth.users`.
 */

import { readFileSync } from "node:fs"
import path from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockClient, mockSignUp, mockFrom } = vi.hoisted(() => {
  const mockSignUp = vi.fn()
  // `from` no debería llamarse NUNCA en el alta: si vuelve a aparecer un
  // insert post-signUp, este mock lo delata en vez de dejarlo pasar.
  const mockFrom = vi.fn((tabla: string) => {
    throw new Error(
      `registrarse no debe escribir en "${tabla}": eso lo hace el trigger auth_users_crear_perfil_de_cuenta.`,
    )
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
import { VERSION_LEGALES } from "@/lib/legales"

const USUARIO_FALSO = { id: "usuario-nuevo-123" }

function formularioValido(): FormData {
  const formData = new FormData()
  formData.set("fullName", "Juana Pérez")
  formData.set("email", "juana@ejemplo.com.ar")
  formData.set("password", "contrasena-larga")
  formData.set("confirmarPassword", "contrasena-larga")
  formData.set("aceptaLegales", "on")
  return formData
}

describe("registrarse — lo que viaja al trigger del alta", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("manda full_name y legales_version en options.data del signUp", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: USUARIO_FALSO, session: { access_token: "token" } },
      error: null,
    })

    await expect(registrarse({ error: null }, formularioValido())).rejects.toThrow(
      "[REDIRECT]",
    )

    expect(mockSignUp).toHaveBeenCalledWith({
      email: "juana@ejemplo.com.ar",
      password: "contrasena-larga",
      options: {
        data: { full_name: "Juana Pérez", legales_version: VERSION_LEGALES },
      },
    })
  })

  it("NO escribe profiles ni consents desde la aplicación (lo hace el trigger)", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: USUARIO_FALSO, session: { access_token: "token" } },
      error: null,
    })

    await expect(registrarse({ error: null }, formularioValido())).rejects.toThrow(
      "[REDIRECT]",
    )

    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("[EL BUG] sin sesión (confirmación por correo, o sea producción) el alta se completa igual", async () => {
    // Esta es la rama exacta que rompía: `signUp` devuelve `session: null` y
    // antes del hotfix el flujo terminaba sin crear nada. Ahora sigue sin
    // crear nada DESDE ACÁ -y está bien-, porque el perfil y el
    // consentimiento ya quedaron escritos en la misma transacción del alta.
    mockSignUp.mockResolvedValue({
      data: { user: USUARIO_FALSO, session: null },
      error: null,
    })

    const resultado = await registrarse({ error: null }, formularioValido())

    expect(resultado.error).toBeNull()
    expect(resultado.mensaje).toMatch(/confirmar tu cuenta/i)
    expect(mockFrom).not.toHaveBeenCalled()
    // La versión legal viajó igual: es lo que hace que el consentimiento se
    // registre con la que la persona tenía a la vista, aunque la fila se
    // escriba sin que haya sesión.
    expect(mockSignUp.mock.calls[0][0].options.data.legales_version).toBe(
      VERSION_LEGALES,
    )
  })
})

describe("VERSION_LEGALES y su espejo en SQL", () => {
  const migracion = readFileSync(
    path.resolve(
      __dirname,
      "../../supabase/migrations/20260814140000_alta_de_cuenta.sql",
    ),
    "utf8",
  )

  it("la constante de la migración es la misma que la de lib/legales.ts", () => {
    // La base no puede importar TypeScript, así que la migración repite el
    // valor como fallback para las cuentas que no nacen del formulario. Si
    // las dos se separan, una cuenta invitada desde el panel de Supabase
    // quedaría con un consentimiento fechado en una versión que no existe.
    const espejo = migracion.match(
      /k_version_legales\s+constant\s+text\s*:=\s*'([^']+)'/,
    )

    expect(espejo, "no se encontró la constante k_version_legales en la migración")
      .not.toBeNull()
    expect(espejo?.[1]).toBe(VERSION_LEGALES)
  })

  it("la migración registra los dos documentos que se firman al registrarse", () => {
    expect(migracion).toContain("values ('privacidad'), ('terminos')")
  })
})
