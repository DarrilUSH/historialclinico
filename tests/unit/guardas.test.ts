/**
 * Tests unitarios de las guardas de permisos (`lib/auth/guardas.ts`).
 *
 * Cubre la lógica de requerirSesion y requerirPermiso sin tocar la red:
 * todo contacto con Supabase está mockeado.
 *
 *   npm run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { User } from "@supabase/supabase-js"

// Hoisted mocks que se aplican antes de cualquier import
const { mockRpc, mockClient } = vi.hoisted(() => {
  const mockRpc = vi.fn()
  const mockClient = {
    auth: {
      getUser: vi.fn(),
      // Solo lo usa el diagnóstico de `adelantoDelTokenEnSegundos` cuando el
      // fallo se clasifica como desfasaje de reloj. Devuelve "sin sesión" por
      // defecto: la función tiene que tolerarlo sin romper nada.
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
    rpc: mockRpc,
  }
  return { mockRpc, mockClient }
})

vi.mock("server-only")

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`[REDIRECT] ${url}`)
  }),
}))

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({})),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => mockClient),
  mockRpc,
  mockClient,
}))

import {
  requerirSesion,
  requerirPermiso,
  motivoTransitorio,
  ErrorSesionRequerida,
  ErrorPerfilInvalido,
  ErrorPermisoDenegado,
  ErrorVerificacionPermiso,
} from "@/lib/auth/guardas"

import { redirect } from "next/navigation"

describe("lib/auth/guardas.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("requerirSesion", () => {
    it("con sesión válida devuelve usuario y cliente Supabase", async () => {
      const usuario: User = {
        id: "usuario-123",
        email: "maria@example.com",
        email_confirmed_at: new Date().toISOString(),
        phone: undefined,
        confirmed_at: new Date().toISOString(),
        last_sign_in_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      mockClient.auth.getUser.mockResolvedValue({
        data: { user: usuario },
        error: null,
      })

      const resultado = await requerirSesion()

      expect(resultado.usuario).toEqual(usuario)
      expect(resultado.supabase).toBeDefined()
      expect(mockClient.auth.getUser).toHaveBeenCalledOnce()
    })

    it("sin sesión + estrategia 'redirigir' redirige a /login", async () => {
      mockClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      })

      await expect(
        requerirSesion({ siNoHaySesion: "redirigir" }),
      ).rejects.toThrow("[REDIRECT] /login")
      expect(redirect).toHaveBeenCalledWith("/login")
    })

    it("sin sesión + estrategia 'redirigir' + parámetro 'desde' incluye el destino", async () => {
      mockClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      })

      await expect(
        requerirSesion({ siNoHaySesion: "redirigir", desde: "/perfiles" }),
      ).rejects.toThrow("[REDIRECT]")

      expect(redirect).toHaveBeenCalledWith(expect.stringContaining("/login"))
      expect(redirect).toHaveBeenCalledWith(expect.stringContaining("desde="))
    })

    it("sin sesión + estrategia 'lanzar' lanza ErrorSesionRequerida", async () => {
      mockClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      })

      await expect(
        requerirSesion({ siNoHaySesion: "lanzar" }),
      ).rejects.toThrow(ErrorSesionRequerida)
    })
  })

  describe("requerirPermiso", () => {
    const usuarioId = "usuario-456"
    const usuario: User = {
      id: usuarioId,
      email: "cuidador@example.com",
      email_confirmed_at: new Date().toISOString(),
      phone: undefined,
      confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const perfilIdValido = "550e8400-e29b-41d4-a716-446655440000"

    beforeEach(() => {
      // Setup por defecto: hay sesión
      mockClient.auth.getUser.mockResolvedValue({
        data: { user: usuario },
        error: null,
      })
    })

    it("uuid inválido lanza ErrorPerfilInvalido sin tocar la red", async () => {
      const uuidInvalido = "no-es-uuid"

      await expect(
        requerirPermiso(uuidInvalido, "view", { siNoHaySesion: "lanzar" }),
      ).rejects.toThrow(ErrorPerfilInvalido)

      // El rpc no fue llamado porque validamos el formato primero
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it("dueño del perfil (rpc devuelve true) tiene permiso", async () => {
      mockRpc.mockResolvedValue({
        data: true,
        error: null,
      })

      const resultado = await requerirPermiso(perfilIdValido, "view", {
        siNoHaySesion: "lanzar",
      })

      expect(resultado.perfilId).toBe(perfilIdValido)
      expect(resultado.verbo).toBe("view")
      expect(resultado.usuario).toEqual(usuario)
    })

    it("permiso 'view' concedido pasa", async () => {
      mockRpc.mockResolvedValue({
        data: true,
        error: null,
      })

      const resultado = await requerirPermiso(perfilIdValido, "view", {
        siNoHaySesion: "lanzar",
      })

      expect(resultado.verbo).toBe("view")
      expect(mockRpc).toHaveBeenCalledWith("puede_ver_perfil", {
        perfil: perfilIdValido,
      })
    })

    it("permiso 'upload' denegado lanza ErrorPermisoDenegado", async () => {
      mockRpc.mockResolvedValue({
        data: false,
        error: null,
      })

      await expect(
        requerirPermiso(perfilIdValido, "upload", { siNoHaySesion: "lanzar" }),
      ).rejects.toThrow(ErrorPermisoDenegado)
    })

    it("permiso 'manage' denegado lanza ErrorPermisoDenegado", async () => {
      mockRpc.mockResolvedValue({
        data: false,
        error: null,
      })

      await expect(
        requerirPermiso(perfilIdValido, "manage", { siNoHaySesion: "lanzar" }),
      ).rejects.toThrow(ErrorPermisoDenegado)
    })

    it("error de red del rpc lanza ErrorVerificacionPermiso", async () => {
      const errorDeRed = new Error("Database connection failed")
      mockRpc.mockResolvedValue({
        data: null,
        error: errorDeRed,
      })

      await expect(
        requerirPermiso(perfilIdValido, "view", { siNoHaySesion: "lanzar" }),
      ).rejects.toThrow(ErrorVerificacionPermiso)
    })

    it("perfil inexistente se trata como permiso denegado (no distingue)", async () => {
      mockRpc.mockResolvedValue({
        data: false,
        error: null,
      })

      await expect(
        requerirPermiso(perfilIdValido, "view", { siNoHaySesion: "lanzar" }),
      ).rejects.toThrow(ErrorPermisoDenegado)
    })

    it("reutilización de sesión evita doble getUser", async () => {
      mockRpc.mockResolvedValue({
        data: true,
        error: null,
      })

      // Primera llamada a requerirSesion
      const sesion = await requerirSesion({ siNoHaySesion: "lanzar" })
      expect(mockClient.auth.getUser).toHaveBeenCalledTimes(1)

      // Pasar la sesión a requerirPermiso evita otra llamada
      await requerirPermiso(perfilIdValido, "view", {
        siNoHaySesion: "lanzar",
        sesion,
      })

      expect(mockClient.auth.getUser).toHaveBeenCalledTimes(1)
    })

    it("los tres verbos de permiso usan la función correcta del rpc", async () => {
      mockRpc.mockResolvedValue({
        data: true,
        error: null,
      })

      const verbos = ["view", "upload", "manage"] as const
      const funcionesEsperadas = [
        "puede_ver_perfil",
        "puede_cargar_en_perfil",
        "puede_administrar_perfil",
      ]

      for (let i = 0; i < verbos.length; i++) {
        vi.clearAllMocks()
        mockClient.auth.getUser.mockResolvedValue({
          data: { user: usuario },
          error: null,
        })

        await requerirPermiso(perfilIdValido, verbos[i], {
          siNoHaySesion: "lanzar",
        })

        expect(mockRpc).toHaveBeenCalledWith(funcionesEsperadas[i], {
          perfil: perfilIdValido,
        })
      }
    })
  })

  /**
   * Fallo transitorio de verificación — P0 del 2026-08-19.
   *
   * Producción devolvió un 500 en `/estudios` con `causa: 'JWT issued at
   * future'`. El mecanismo está documentado y medido en `lib/auth/guardas.ts`:
   * lo rechaza PostgREST (código `PGRST303`) cuando el `iat` del token le
   * queda más de 30 s adelante de SU reloj. Estos tests fijan las dos
   * conductas que se agregaron: clasificar bien el fallo y reintentar UNA vez.
   *
   * Los mensajes son los literales que devuelve PostgREST v16.1, verificados
   * contra el stack local firmando tokens con el `iat` desplazado.
   */
  describe("fallos transitorios de verificación", () => {
    const perfilIdValido = "550e8400-e29b-41d4-a716-446655440000"

    const usuario: User = {
      id: "usuario-789",
      email: "titular@example.com",
      email_confirmed_at: new Date().toISOString(),
      phone: undefined,
      confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const errorDeReloj = {
      code: "PGRST303",
      message: "JWT issued at future",
      details: null,
      hint: null,
    }

    beforeEach(() => {
      mockClient.auth.getUser.mockResolvedValue({
        data: { user: usuario },
        error: null,
      })
      mockClient.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      })
      // La guarda registra el fallo en `console.error` con el diagnóstico.
      // Acá se silencia para que la salida de la suite no parezca rota.
      vi.spyOn(console, "error").mockImplementation(() => {})
    })

    describe("motivoTransitorio", () => {
      it("PGRST303 'JWT issued at future' es un desfasaje de reloj", () => {
        expect(motivoTransitorio(errorDeReloj, 401)).toBe("reloj")
      })

      it("PGRST303 'JWT not yet valid' (nbf) también lo es", () => {
        expect(
          motivoTransitorio({ code: "PGRST303", message: "JWT not yet valid" }, 401),
        ).toBe("reloj")
      })

      it("PGRST303 'JWT expired' NO se reintenta: esperar solo lo empeora", () => {
        expect(motivoTransitorio({ code: "PGRST303", message: "JWT expired" }, 401)).toBeNull()
      })

      it("PGRST301 (firma que no valida) no es transitorio", () => {
        expect(
          motivoTransitorio(
            { code: "PGRST301", message: "No suitable key or wrong key type" },
            401,
          ),
        ).toBeNull()
      })

      it("status 0 es la red que ni llegó a tener respuesta", () => {
        expect(motivoTransitorio({ code: "", message: "TypeError: fetch failed" }, 0)).toBe(
          "red",
        )
      })

      it("un 5xx es transitorio", () => {
        expect(motivoTransitorio({ code: "", message: "Bad Gateway" }, 503)).toBe("servidor")
      })

      it("un 4xx que no es de claims temporales no lo es", () => {
        expect(motivoTransitorio({ code: "42883", message: "function does not exist" }, 404))
          .toBeNull()
      })

      it("sin error no hay nada que clasificar", () => {
        expect(motivoTransitorio(null, 200)).toBeNull()
      })
    })

    it("si el primer intento falla por reloj y el segundo anda, la pantalla se recupera", async () => {
      mockRpc
        .mockResolvedValueOnce({ data: null, error: errorDeReloj, status: 401 })
        .mockResolvedValueOnce({ data: true, error: null, status: 200 })

      const resultado = await requerirPermiso(perfilIdValido, "view", {
        siNoHaySesion: "lanzar",
      })

      expect(resultado.perfilId).toBe(perfilIdValido)
      expect(mockRpc).toHaveBeenCalledTimes(2)
    })

    it("el reintento es UNO solo: si falla siempre, se rinde con ErrorVerificacionPermiso", async () => {
      mockRpc.mockResolvedValue({ data: null, error: errorDeReloj, status: 401 })

      await expect(
        requerirPermiso(perfilIdValido, "view", { siNoHaySesion: "lanzar" }),
      ).rejects.toThrow(ErrorVerificacionPermiso)

      expect(mockRpc).toHaveBeenCalledTimes(2)
    })

    it("el error de rendición queda marcado como transitorio y con la causa de PostgREST", async () => {
      mockRpc.mockResolvedValue({ data: null, error: errorDeReloj, status: 401 })

      const error = await requerirPermiso(perfilIdValido, "view", {
        siNoHaySesion: "lanzar",
      }).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ErrorVerificacionPermiso)
      const fallo = error as ErrorVerificacionPermiso
      expect(fallo.transitorio).toBe(true)
      expect(fallo.causa).toBe("JWT issued at future")
      // El mensaje que ve la persona nunca menciona JWT ni relojes.
      expect(fallo.message).toBe("No pudimos verificar tus permisos. Probá de nuevo en unos minutos.")
    })

    it("un fallo que NO es transitorio no gasta un reintento", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { code: "PGRST301", message: "No suitable key or wrong key type" },
        status: 401,
      })

      const error = await requerirPermiso(perfilIdValido, "view", {
        siNoHaySesion: "lanzar",
      }).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ErrorVerificacionPermiso)
      expect((error as ErrorVerificacionPermiso).transitorio).toBe(false)
      expect(mockRpc).toHaveBeenCalledTimes(1)
    })

    it("el camino feliz no paga ni un reintento ni una espera", async () => {
      mockRpc.mockResolvedValue({ data: true, error: null, status: 200 })

      const empezo = Date.now()
      await requerirPermiso(perfilIdValido, "view", { siNoHaySesion: "lanzar" })

      expect(mockRpc).toHaveBeenCalledTimes(1)
      expect(Date.now() - empezo).toBeLessThan(100)
    })
  })
})
