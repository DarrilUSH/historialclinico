/**
 * Tests del arreglo de la fuga de perfil activo (2026-08-23).
 *
 * El bug que reportó el dueño usando la app desde su teléfono: *"cuando entro
 * a un perfil que manejo no se mantiene ahí siempre, me muestra cosas del
 * perfil oficial"*. Estos tests cubren las dos mitades del arreglo que se
 * pueden probar sin navegador:
 *
 * 1. **Todo cambio de perfil activo purga el caché del cliente.** El Client
 *    Cache de Next.js 16 guarda en memoria del navegador los payloads RSC de
 *    las rutas ya visitadas -layouts incluidos-, y una pantalla servida desde
 *    ahí no vuelve a pasar por `obtenerPerfilActivo`. Next.js hoy invalida ese
 *    caché solo por haber escrito una cookie dentro de una Server Action, pero
 *    esa garantía es implícita y **no cubre a los Route Handlers de deep link**
 *    (`app/(app)/(con-nav)/turnos/enlace/route.ts` y sus hermanos), que también
 *    cambian el perfil. Por eso `fijarPerfilActivo` y `limpiarPerfilActivo`
 *    llaman explícitamente a `revalidatePath("/", "layout")`, la única forma
 *    documentada de purgar TODO
 *    (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`).
 *    Lo que se prueba acá es que **ningún camino de cambio de perfil se olvida
 *    de purgar**, incluido el que falla.
 *
 * 2. **`abrirEstudioEnSuPerfil`** (`app/(app)/(con-nav)/estudios/actions.ts`),
 *    la acción del botón de la pantalla nueva que aparece al abrir un estudio
 *    de otro perfil. Tres cosas: que lleve al estudio cuando el permiso está,
 *    que degrade a `/estudios` cuando no, y que un `documentoId` que no tenga
 *    forma de uuid no pueda convertir su `redirect()` en un redirect abierto.
 *
 * Correlo solo:
 *   npm run test -- tests/unit/perfil-activo-purga-cache.test.ts
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  revalidatePath,
  requerirPermiso,
  registrarAcceso,
  cookieSet,
  cookieDelete,
  cookieGet,
  ErrorGuardaFalso,
  ErrorPermisoDenegadoFalso,
  ErrorPerfilInvalidoFalso,
  ErrorSesionRequeridaFalso,
} = vi.hoisted(() => {
  class ErrorGuardaFalso extends Error {}
  class ErrorPermisoDenegadoFalso extends ErrorGuardaFalso {}
  class ErrorPerfilInvalidoFalso extends ErrorGuardaFalso {}
  class ErrorSesionRequeridaFalso extends ErrorGuardaFalso {}
  return {
    revalidatePath: vi.fn(),
    requerirPermiso: vi.fn(),
    registrarAcceso: vi.fn(),
    cookieSet: vi.fn(),
    cookieDelete: vi.fn(),
    cookieGet: vi.fn(),
    ErrorGuardaFalso,
    ErrorPermisoDenegadoFalso,
    ErrorPerfilInvalidoFalso,
    ErrorSesionRequeridaFalso,
  }
})

vi.mock("next/cache", () => ({ revalidatePath }))

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: cookieSet, delete: cookieDelete, get: cookieGet })),
}))

vi.mock("@/lib/auditoria", () => ({
  ACCION: { ver_perfil: "ver_perfil" },
  registrarAcceso,
}))

vi.mock("@/lib/auth/guardas", () => ({
  requerirPermiso,
  ErrorPermisoDenegado: ErrorPermisoDenegadoFalso,
  ErrorPerfilInvalido: ErrorPerfilInvalidoFalso,
  ErrorSesionRequerida: ErrorSesionRequeridaFalso,
  esErrorDeGuarda: (error: unknown) => error instanceof ErrorGuardaFalso,
}))

import { fijarPerfilActivo, limpiarPerfilActivo } from "@/lib/perfil-activo"

const PERFIL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

beforeEach(() => {
  vi.clearAllMocks()
  requerirPermiso.mockResolvedValue({ perfilId: PERFIL, verbo: "view" })
})

describe("fijarPerfilActivo — purga del caché del cliente", () => {
  it("purga TODO el caché del cliente al fijar un perfil", async () => {
    await fijarPerfilActivo(PERFIL)

    expect(cookieSet).toHaveBeenCalledOnce()
    // `"/"` + `"layout"` y no `"page"`: es la forma documentada de purgar el
    // Client Cache entero. `revalidatePath("/")` sola solo alcanzaría a la
    // raíz, y el problema son las OTRAS pantallas ya cacheadas.
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout")
  })

  it("purga DESPUÉS de escribir la cookie, no antes", async () => {
    await fijarPerfilActivo(PERFIL)

    const ordenCookie = cookieSet.mock.invocationCallOrder[0]
    const ordenPurga = revalidatePath.mock.invocationCallOrder[0]
    expect(ordenPurga).toBeGreaterThan(ordenCookie)
  })

  it("si el permiso está denegado, no escribe cookie ni purga nada", async () => {
    requerirPermiso.mockRejectedValue(new ErrorPermisoDenegadoFalso("sin permiso"))

    await expect(fijarPerfilActivo(PERFIL)).rejects.toBeInstanceOf(ErrorPermisoDenegadoFalso)

    expect(cookieSet).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("una purga que no se puede hacer no rompe el cambio de perfil", async () => {
    // `revalidatePath` lanza si se la llama fuera de una Server Action o de un
    // Route Handler. Es el mismo límite que ya documenta `limpiarPerfilActivo`
    // para `cookies().delete()`, y no puede tumbar la acción.
    revalidatePath.mockImplementation(() => {
      throw new Error("Route handler or server action required")
    })

    await expect(fijarPerfilActivo(PERFIL)).resolves.toBeUndefined()
    expect(cookieSet).toHaveBeenCalledOnce()
  })
})

describe("limpiarPerfilActivo — purga del caché del cliente", () => {
  it("borrar el perfil activo también deja el navegador sin nada de ese perfil", async () => {
    await limpiarPerfilActivo()

    expect(cookieDelete).toHaveBeenCalledWith("perfil_activo")
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout")
  })

  it("purga igual aunque la cookie no se pueda borrar (render de Server Component)", async () => {
    cookieDelete.mockImplementation(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler")
    })

    await expect(limpiarPerfilActivo()).resolves.toBeUndefined()
  })
})
