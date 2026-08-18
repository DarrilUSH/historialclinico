/**
 * Test de `lib/push/activar.ts` (tarea #14: extraída de `ActivarNotificaciones`
 * para que la comparta el consejo `notificaciones` del tutorial de
 * bienvenida). Lo que importa acá es la ORQUESTACIÓN -qué se llama, en qué
 * orden, y qué pasa cuando el guardado en la base falla-, así que las tres
 * dependencias (`pedirPermisoYSuscribir`, `guardarSuscripcion`,
 * `cancelarSuscripcion`) van mockeadas: sin eso habría que simular el
 * navegador entero (Notification, pushManager, service worker).
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const { pedirPermisoYSuscribir, cancelarSuscripcion, guardarSuscripcion } = vi.hoisted(() => ({
  pedirPermisoYSuscribir: vi.fn(),
  cancelarSuscripcion: vi.fn(),
  guardarSuscripcion: vi.fn(),
}))

vi.mock("@/lib/push/suscripcion", () => ({
  pedirPermisoYSuscribir,
  cancelarSuscripcion,
}))

vi.mock("@/app/(app)/(con-nav)/inicio/actions", () => ({
  guardarSuscripcion,
}))

// --- Sujeto ------------------------------------------------------------------

import { activarNotificacionesPush } from "@/lib/push/activar.ts"

const DATOS_SUSCRIPCION = {
  endpoint: "https://push.example.com/abc",
  p256dh: "clave-p256dh",
  auth: "clave-auth",
  userAgent: "vitest",
}

describe("lib/push/activar.ts#activarNotificacionesPush", () => {
  beforeEach(() => {
    pedirPermisoYSuscribir.mockReset()
    cancelarSuscripcion.mockReset()
    guardarSuscripcion.mockReset()
  })

  it("permiso denegado: no llega a guardar nada", async () => {
    pedirPermisoYSuscribir.mockResolvedValue({ estado: "denegado" })

    const resultado = await activarNotificacionesPush()

    expect(resultado).toEqual({ estado: "denegado" })
    expect(guardarSuscripcion).not.toHaveBeenCalled()
  })

  it("cerró el prompt sin decidir: 'sin_respuesta', sin guardar nada", async () => {
    pedirPermisoYSuscribir.mockResolvedValue({ estado: "sin_respuesta" })

    const resultado = await activarNotificacionesPush()

    expect(resultado).toEqual({ estado: "sin_respuesta" })
    expect(guardarSuscripcion).not.toHaveBeenCalled()
  })

  it("falla el navegador (sin soporte, SW inaccesible): propaga el mensaje, sin guardar nada", async () => {
    pedirPermisoYSuscribir.mockResolvedValue({ estado: "error", mensaje: "sin soporte" })

    const resultado = await activarNotificacionesPush()

    expect(resultado).toEqual({ estado: "error", mensaje: "sin soporte" })
    expect(guardarSuscripcion).not.toHaveBeenCalled()
  })

  it("suscripto y guardado OK: 'activo'", async () => {
    pedirPermisoYSuscribir.mockResolvedValue({ estado: "suscripto", datos: DATOS_SUSCRIPCION })
    guardarSuscripcion.mockResolvedValue({ ok: true, error: null })

    const resultado = await activarNotificacionesPush()

    expect(resultado).toEqual({ estado: "activo" })
    expect(guardarSuscripcion).toHaveBeenCalledWith(DATOS_SUSCRIPCION)
    expect(cancelarSuscripcion).not.toHaveBeenCalled()
  })

  it("suscripto pero el guardado en la base falla: deshace la suscripción del navegador", async () => {
    pedirPermisoYSuscribir.mockResolvedValue({ estado: "suscripto", datos: DATOS_SUSCRIPCION })
    guardarSuscripcion.mockResolvedValue({ ok: false, error: "la base no respondió" })

    const resultado = await activarNotificacionesPush()

    expect(resultado).toEqual({ estado: "error", mensaje: "la base no respondió" })
    expect(cancelarSuscripcion).toHaveBeenCalledTimes(1)
  })

  it("guardado falla sin mensaje: usa el mensaje genérico", async () => {
    pedirPermisoYSuscribir.mockResolvedValue({ estado: "suscripto", datos: DATOS_SUSCRIPCION })
    guardarSuscripcion.mockResolvedValue({ ok: false, error: null })

    const resultado = await activarNotificacionesPush()

    expect(resultado).toEqual({
      estado: "error",
      mensaje: "No pudimos activar las notificaciones.",
    })
  })
})
