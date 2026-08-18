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

import { readdirSync, readFileSync } from "node:fs"
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
  const carpetaMigraciones = path.resolve(__dirname, "../../supabase/migrations")

  /**
   * TODAS las migraciones que declaran el espejo, no solo la que lo introdujo.
   *
   * Importa desde el Sprint 15: `20260817230000_graduacion.sql` volvió a
   * escribir `completar_alta_de_cuenta` con `CREATE OR REPLACE` para sumarle
   * la rama de graduación, así que hoy la constante vive en DOS archivos y la
   * que la base termina usando es la de la migración MÁS NUEVA. Un test que
   * mirara solo la primera pasaría en verde mientras la función viva usa un
   * valor distinto —exactamente el modo de falla que este archivo existe para
   * impedir—. Por eso se buscan todas y se exige que coincidan todas.
   */
  const espejos = readdirSync(carpetaMigraciones)
    .filter((archivo) => archivo.endsWith(".sql"))
    .sort()
    .map((archivo) => ({
      archivo,
      sql: readFileSync(path.join(carpetaMigraciones, archivo), "utf8"),
    }))
    .filter(({ sql }) => sql.includes("k_version_legales"))

  it("hay al menos una migración con el espejo (si no, este test no prueba nada)", () => {
    expect(espejos.length).toBeGreaterThan(0)
  })

  it.each(espejos.map(({ archivo }) => archivo))(
    "%s declara la misma versión que lib/legales.ts",
    (archivo) => {
      // La base no puede importar TypeScript, así que la migración repite el
      // valor como fallback para las cuentas que no nacen del formulario. Si
      // las dos se separan, una cuenta invitada desde el panel de Supabase
      // quedaría con un consentimiento fechado en una versión que no existe.
      const sql = espejos.find((espejo) => espejo.archivo === archivo)!.sql
      const encontrado = sql.match(/k_version_legales\s+constant\s+text\s*:=\s*'([^']+)'/)

      expect(encontrado, `no se encontró la constante k_version_legales en ${archivo}`)
        .not.toBeNull()
      expect(encontrado?.[1]).toBe(VERSION_LEGALES)
    },
  )

  it("la última migración que la declara registra los dos documentos del alta", () => {
    // La última es la que define la función viva. Es donde tiene que estar el
    // INSERT de los dos consentimientos.
    expect(espejos[espejos.length - 1].sql).toContain("values ('privacidad'), ('terminos')")
  })
})
