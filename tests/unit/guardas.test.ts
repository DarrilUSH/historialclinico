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
})
