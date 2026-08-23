/**
 * Tests de `abrirEstudioEnSuPerfil` (`app/(app)/(con-nav)/estudios/actions.ts`).
 *
 * Es la acción del único botón de `AvisoOtroPerfil`, la pantalla que reemplazó
 * al síntoma exacto que reportó el dueño el 2026-08-23: *"entré al perfil de
 * Emma y me muestra el estudio de ellos, pero cuando lo toco para abrir NO lo
 * abre y me muestra todo lo del perfil principal"*. Antes, abrir un estudio de
 * un perfil que la sesión puede ver pero que no es el activo caía en el mismo
 * `redirect("/estudios")` que un id inventado, y la persona terminaba mirando
 * la lista completa del perfil equivocado.
 *
 * Lo que se prueba:
 *
 * 1. Con permiso, cambia el perfil activo y aterriza EN EL ESTUDIO.
 * 2. Sin permiso -revocado entre que se pintó la pantalla y se tocó el botón-,
 *    vuelve a `/estudios` sin cambiar nada y sin decir por qué (principio 3 de
 *    `docs/modelo-permisos.md`: nunca un oráculo de ids ajenos).
 * 3. Un `documentoId` que no tiene forma de uuid corta ANTES de tocar el
 *    perfil. Una Server Action es un POST invocable a mano, y el destino se
 *    arma concatenando ese valor: sin este corte, `//otro-sitio.com` sería un
 *    redirect abierto.
 *
 * Correlo solo:
 *   npm run test -- tests/unit/estudios-abrir-en-su-perfil.test.ts
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const { fijarPerfilActivo, ErrorGuardaFalso } = vi.hoisted(() => {
  class ErrorGuardaFalso extends Error {}
  return { fijarPerfilActivo: vi.fn(), ErrorGuardaFalso }
})

vi.mock("@/lib/perfil-activo", () => ({
  fijarPerfilActivo,
  obtenerPerfilActivo: vi.fn(),
}))

vi.mock("@/lib/auth/guardas", () => ({
  esErrorDeGuarda: (error: unknown) => error instanceof ErrorGuardaFalso,
  requerirPermiso: vi.fn(),
  requerirSesion: vi.fn(),
}))

// Dependencias pesadas de la subida, ajenas a esta acción.
vi.mock("@/lib/documentos/ingesta", () => ({
  ErrorIngesta: class extends Error {},
  formatearFechaDuplicado: vi.fn(),
  ingestarDocumento: vi.fn(),
}))
vi.mock("@/lib/storage-admin", () => ({ BUCKETS: { documentos: "documentos-medicos" }, borrarObjeto: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { abrirEstudioEnSuPerfil } from "@/app/(app)/(con-nav)/estudios/actions"
import { redirect } from "next/navigation"

const PERFIL_DUENO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const DOCUMENTO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

beforeEach(() => {
  vi.clearAllMocks()
  fijarPerfilActivo.mockResolvedValue(undefined)
})

describe("abrirEstudioEnSuPerfil", () => {
  it("cambia al perfil dueño y abre el estudio", async () => {
    await expect(
      abrirEstudioEnSuPerfil(PERFIL_DUENO, DOCUMENTO, new FormData()),
    ).rejects.toThrow("[REDIRECT]")

    expect(fijarPerfilActivo).toHaveBeenCalledWith(PERFIL_DUENO)
    expect(redirect).toHaveBeenCalledWith(`/estudios/${DOCUMENTO}`)
  })

  it("si el permiso ya no está, vuelve a /estudios sin explicar por qué", async () => {
    fijarPerfilActivo.mockRejectedValue(new ErrorGuardaFalso("permiso revocado"))

    await expect(
      abrirEstudioEnSuPerfil(PERFIL_DUENO, DOCUMENTO, new FormData()),
    ).rejects.toThrow("[REDIRECT]")

    expect(redirect).toHaveBeenCalledWith("/estudios")
  })

  it("un error que NO es de guarda se propaga en vez de disfrazarse de 'sin permiso'", async () => {
    fijarPerfilActivo.mockRejectedValue(new Error("la base no respondió"))

    await expect(
      abrirEstudioEnSuPerfil(PERFIL_DUENO, DOCUMENTO, new FormData()),
    ).rejects.toThrow("la base no respondió")

    expect(redirect).not.toHaveBeenCalled()
  })

  it.each([
    ["//otro-sitio.com", "redirect abierto a otro dominio"],
    ["../../familia", "salida del segmento por path traversal"],
    ["no-es-un-uuid", "basura suelta"],
    ["", "vacío"],
  ])("rechaza el documentoId %j (%s) sin tocar el perfil activo", async (documentoId) => {
    await expect(
      abrirEstudioEnSuPerfil(PERFIL_DUENO, documentoId, new FormData()),
    ).rejects.toThrow("[REDIRECT] /estudios")

    expect(fijarPerfilActivo).not.toHaveBeenCalled()
  })
})
