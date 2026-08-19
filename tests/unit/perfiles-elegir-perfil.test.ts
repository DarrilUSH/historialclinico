/**
 * Test de `elegirPerfil` (`app/(app)/(sin-nav)/perfiles/actions.ts`), enfocado
 * en las dos decisiones del fix de rendimiento percibido (P0, 2026-08-18):
 *
 * 1. Siembra la cookie `tamano` (vía `obtenerTamano()`, que nunca pisa una
 *    cookie ya puesta -docs/densidad.md §1- y nunca lanza) siempre que hay
 *    consentimiento vigente, sin importar si el permiso sobre el perfil
 *    elegido termina siendo válido o no: es una preferencia de la CUENTA, no
 *    del perfil elegido.
 * 2. Nunca se siembra ANTES del gate de consentimiento (Sprint 15, tarea
 *    15.2): sin sesión/consentimiento válido, la acción corta con
 *    `redirect()` antes de tocar `obtenerTamano()`.
 *
 * El resto del contrato de la acción (redirect a /inicio o /perfiles según el
 * permiso) ya estaba en producción; estos tests lo re-confirman de paso para
 * que la nueva llamada no lo haya movido de lugar.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const { fijarPerfilActivo, cuentaAceptoLegalesDeAlta, obtenerTamano, esErrorDeGuarda, ErrorGuardaFalso } =
  vi.hoisted(() => {
    class ErrorGuardaFalso extends Error {}
    return {
      fijarPerfilActivo: vi.fn(),
      cuentaAceptoLegalesDeAlta: vi.fn(),
      obtenerTamano: vi.fn(),
      esErrorDeGuarda: vi.fn((error: unknown) => error instanceof ErrorGuardaFalso),
      ErrorGuardaFalso,
    }
  })

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`[REDIRECT] ${url}`)
  }),
}))

vi.mock("@/lib/legales", () => ({
  cuentaAceptoLegalesDeAlta,
}))

vi.mock("@/lib/densidad/servidor", () => ({
  obtenerTamano,
}))

vi.mock("@/lib/perfil-activo", () => ({
  fijarPerfilActivo,
  esErrorDeGuarda,
}))

import { elegirPerfil } from "@/app/(app)/(sin-nav)/perfiles/actions"
import { redirect } from "next/navigation"

const PERFIL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

beforeEach(() => {
  vi.clearAllMocks()
  cuentaAceptoLegalesDeAlta.mockResolvedValue(true)
  fijarPerfilActivo.mockResolvedValue(undefined)
  obtenerTamano.mockResolvedValue("chica")
})

describe("elegirPerfil — siembra de la cookie tamano", () => {
  it("con consentimiento vigente y permiso válido, siembra tamano y navega a /inicio", async () => {
    await expect(elegirPerfil(PERFIL_ID, new FormData())).rejects.toThrow("[REDIRECT]")

    expect(obtenerTamano).toHaveBeenCalledOnce()
    expect(fijarPerfilActivo).toHaveBeenCalledWith(PERFIL_ID)
    expect(redirect).toHaveBeenCalledWith("/inicio")
  })

  it("aunque el permiso se haya perdido justo en esa ventana, igual siembra tamano y vuelve a /perfiles", async () => {
    fijarPerfilActivo.mockRejectedValue(new ErrorGuardaFalso("permiso perdido"))

    await expect(elegirPerfil(PERFIL_ID, new FormData())).rejects.toThrow("[REDIRECT]")

    expect(obtenerTamano).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledWith("/perfiles")
  })

  it("sin consentimiento de alta, NO siembra tamano -corta antes, en el gate-", async () => {
    cuentaAceptoLegalesDeAlta.mockResolvedValue(false)

    await expect(elegirPerfil(PERFIL_ID, new FormData())).rejects.toThrow("[REDIRECT]")

    expect(obtenerTamano).not.toHaveBeenCalled()
    expect(fijarPerfilActivo).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/aceptar-terminos")
  })

  it("un error inesperado (no ErrorGuarda) igual siembra tamano antes de propagarse, y no redirige", async () => {
    fijarPerfilActivo.mockRejectedValue(new Error("bug real, no es de permisos"))

    await expect(elegirPerfil(PERFIL_ID, new FormData())).rejects.toThrow("bug real")

    expect(obtenerTamano).toHaveBeenCalledOnce()
    expect(redirect).not.toHaveBeenCalled()
  })
})
