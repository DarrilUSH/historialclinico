/**
 * Tests de `lib/push/servidor.ts` (Sprint 6, tarea 6.3).
 *
 * Lo que se prueba de verdad acá es **la política de bajas**: qué pasa con la
 * suscripción según lo que responde el Push Service. Es la decisión propia
 * del módulo -el cifrado y la firma VAPID los pone `web-push`, que tiene sus
 * propios tests- y la que más caro sale equivocar: un 410 tratado como error
 * transitorio llena la base de endpoints muertos que se reintentan para
 * siempre, y un 503 tratado como muerte desuscribe a gente que no hizo nada y
 * que se entera cuando NO le llega el recordatorio del turno.
 *
 * `web-push` y `@supabase/supabase-js` van mockeados: el objetivo es
 * verificar nuestras ramas de decisión, no salir a la red.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -------------------------------------------------------------------

// `vi.mock` se iza al tope del archivo, así que todo lo que sus fábricas usan
// tiene que existir antes que ellas: `vi.hoisted` es la única forma de
// declarar estado compartido entre el mock y los tests sin caer en un
// "Cannot access before initialization".
const { enviarNotificacion, configurarVapid, WebPushErrorFalso, actualizaciones, filtros, seleccionadas } =
  vi.hoisted(() => {
    class WebPushErrorFalso extends Error {
      statusCode: number
      constructor(mensaje: string, statusCode: number) {
        super(mensaje)
        this.name = "WebPushError"
        this.statusCode = statusCode
      }
    }

    return {
      enviarNotificacion: vi.fn(),
      configurarVapid: vi.fn(),
      WebPushErrorFalso,
      /** Encadenado `.from().update().eq().is()` del cliente de Supabase. */
      actualizaciones: [] as Array<Record<string, unknown>>,
      filtros: [] as Array<[string, unknown]>,
      seleccionadas: [] as Array<{
        id: string
        endpoint: string
        p256dh: string
        auth: string
      }>,
    }
  })

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => configurarVapid(...args),
    sendNotification: (...args: unknown[]) => enviarNotificacion(...args),
  },
  WebPushError: WebPushErrorFalso,
}))

function constructorDeUpdate() {
  const encadenable = {
    eq: (columna: string, valor: unknown) => {
      filtros.push([columna, valor])
      return encadenable
    },
    is: (columna: string, valor: unknown) => {
      filtros.push([columna, valor])
      return Promise.resolve({ error: null })
    },
  }
  return encadenable
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      update: (valores: Record<string, unknown>) => {
        actualizaciones.push(valores)
        return constructorDeUpdate()
      },
      select: () => ({
        eq: () => ({
          is: () => Promise.resolve({ data: seleccionadas, error: null }),
        }),
      }),
    }),
  }),
}))

// --- Sujeto ------------------------------------------------------------------

import {
  clasificarErrorPush,
  enviarPush,
  enviarPushAUsuario,
  MAX_PAYLOAD_BYTES,
  serializarPayload,
  URL_POR_DEFECTO,
} from "@/lib/push/servidor"

const SUSCRIPCION = {
  id: "11111111-1111-4111-8111-111111111111",
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  p256dh: "BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oYhIO4475rds",
  auth: "5I2Bu2oKdyy9CwL8QVF0NQ",
}

const PAYLOAD = { titulo: "Turno mañana", cuerpo: "Cardiología, 10:30." }

beforeEach(() => {
  vi.clearAllMocks()
  actualizaciones.length = 0
  filtros.length = 0
  seleccionadas.length = 0
  process.env.VAPID_SUBJECT = "mailto:contacto@historialmedico.com.ar"
  process.env.VAPID_PUBLIC_KEY = "clave-publica-de-prueba"
  process.env.VAPID_PRIVATE_KEY = "clave-privada-de-prueba"
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba"
})

// --- serializarPayload -------------------------------------------------------

describe("serializarPayload", () => {
  it("arma el JSON que espera el service worker", () => {
    const json = JSON.parse(
      serializarPayload({ titulo: "Turno", cuerpo: "Mañana", url: "/turnos/1", tag: "turno-1" }),
    )
    expect(json).toEqual({ titulo: "Turno", cuerpo: "Mañana", url: "/turnos/1", tag: "turno-1" })
  })

  it("completa la url por defecto cuando no viene", () => {
    expect(JSON.parse(serializarPayload(PAYLOAD)).url).toBe(URL_POR_DEFECTO)
  })

  it("omite el tag cuando está vacío en vez de mandar una cadena vacía", () => {
    // Un `tag: ""` haría que TODAS las notificaciones sin tag se reemplacen
    // entre sí en el dispositivo: solo se vería la última.
    expect(JSON.parse(serializarPayload({ ...PAYLOAD, tag: "  " }))).not.toHaveProperty("tag")
  })

  it("rechaza una url absoluta: un push no puede abrir un origen ajeno", () => {
    expect(() => serializarPayload({ ...PAYLOAD, url: "https://ejemplo.com/phishing" })).toThrow(
      /ruta relativa/,
    )
  })

  it("rechaza un título vacío: sin título la notificación no se muestra", () => {
    expect(() => serializarPayload({ ...PAYLOAD, titulo: "   " })).toThrow(/título/)
  })

  it("rechaza un payload que no entra en un récord aes128gcm", () => {
    expect(() => serializarPayload({ ...PAYLOAD, cuerpo: "x".repeat(MAX_PAYLOAD_BYTES) })).toThrow(
      /máximo/,
    )
  })

  it("mide el tope en BYTES y no en caracteres (las tildes ocupan dos)", () => {
    // 2000 "á" = 4000 bytes en UTF-8: pasa el largo de string pero no el de
    // bytes. Es el bug clásico de un producto en español.
    expect(() => serializarPayload({ ...PAYLOAD, cuerpo: "á".repeat(2000) })).toThrow(/máximo/)
  })
})

// --- clasificarErrorPush -----------------------------------------------------

describe("clasificarErrorPush", () => {
  it("404 y 410 son bajas definitivas", () => {
    expect(clasificarErrorPush(404)).toBe("revocada")
    expect(clasificarErrorPush(410)).toBe("revocada")
  })

  it("429 y 5xx son transitorios", () => {
    expect(clasificarErrorPush(429)).toBe("reintentable")
    expect(clasificarErrorPush(500)).toBe("reintentable")
    expect(clasificarErrorPush(503)).toBe("reintentable")
  })

  it("sin código de respuesta (timeout, DNS) es transitorio: no hay evidencia de baja", () => {
    expect(clasificarErrorPush(null)).toBe("reintentable")
    expect(clasificarErrorPush(undefined)).toBe("reintentable")
  })

  it("400 y 403 son fallos nuestros, no bajas", () => {
    // 403 = la clave VAPID no coincide con la que autorizó la suscripción.
    // Marcarla revocada escondería un error de configuración detrás de una
    // baja falsa.
    expect(clasificarErrorPush(400)).toBe("fallido")
    expect(clasificarErrorPush(403)).toBe("fallido")
  })
})

// --- enviarPush --------------------------------------------------------------

describe("enviarPush", () => {
  it("entrega y no toca la base cuando el Push Service acepta", async () => {
    enviarNotificacion.mockResolvedValueOnce({ statusCode: 201 })

    const resultado = await enviarPush(SUSCRIPCION, PAYLOAD)

    expect(resultado).toEqual({ estado: "entregado", suscripcionId: SUSCRIPCION.id })
    expect(actualizaciones).toHaveLength(0)
  })

  it("le pasa a web-push el endpoint y las dos claves de cifrado", async () => {
    enviarNotificacion.mockResolvedValueOnce({ statusCode: 201 })
    await enviarPush(SUSCRIPCION, PAYLOAD)

    const [suscripcion, cuerpo] = enviarNotificacion.mock.calls[0]
    expect(suscripcion).toEqual({
      endpoint: SUSCRIPCION.endpoint,
      keys: { p256dh: SUSCRIPCION.p256dh, auth: SUSCRIPCION.auth },
    })
    expect(JSON.parse(cuerpo as string).titulo).toBe("Turno mañana")
  })

  it("marca revoked_at ante un 410 Gone", async () => {
    enviarNotificacion.mockRejectedValueOnce(new WebPushErrorFalso("Gone", 410))

    const resultado = await enviarPush(SUSCRIPCION, PAYLOAD)

    expect(resultado).toMatchObject({ estado: "revocada", codigo: 410 })
    expect(actualizaciones).toHaveLength(1)
    expect(actualizaciones[0]).toHaveProperty("revoked_at")
    // Se filtra por el id de la fila que falló y solo si seguía activa: la
    // baja es idempotente y no pisa el momento real de una baja anterior.
    expect(filtros).toEqual([
      ["id", SUSCRIPCION.id],
      ["revoked_at", null],
    ])
  })

  it("marca revoked_at ante un 404", async () => {
    enviarNotificacion.mockRejectedValueOnce(new WebPushErrorFalso("Not Found", 404))
    await expect(enviarPush(SUSCRIPCION, PAYLOAD)).resolves.toMatchObject({ estado: "revocada" })
    expect(actualizaciones).toHaveLength(1)
  })

  it("NO da de baja ante un 503: el servicio está caído, la suscripción vive", async () => {
    enviarNotificacion.mockRejectedValueOnce(new WebPushErrorFalso("Service Unavailable", 503))

    const resultado = await enviarPush(SUSCRIPCION, PAYLOAD)

    expect(resultado).toMatchObject({ estado: "reintentable", codigo: 503 })
    expect(actualizaciones).toHaveLength(0)
  })

  it("NO da de baja ante un 429", async () => {
    enviarNotificacion.mockRejectedValueOnce(new WebPushErrorFalso("Too Many Requests", 429))
    await expect(enviarPush(SUSCRIPCION, PAYLOAD)).resolves.toMatchObject({
      estado: "reintentable",
    })
    expect(actualizaciones).toHaveLength(0)
  })

  it("NO da de baja ante un 403 (clave VAPID cambiada)", async () => {
    enviarNotificacion.mockRejectedValueOnce(new WebPushErrorFalso("Forbidden", 403))

    const resultado = await enviarPush(SUSCRIPCION, PAYLOAD)

    expect(resultado).toMatchObject({ estado: "fallido", codigo: 403 })
    expect(actualizaciones).toHaveLength(0)
  })

  it("no lanza ante un error de red sin código HTTP", async () => {
    enviarNotificacion.mockRejectedValueOnce(new Error("ECONNRESET"))

    const resultado = await enviarPush(SUSCRIPCION, PAYLOAD)

    expect(resultado).toMatchObject({ estado: "reintentable", codigo: null })
    expect(actualizaciones).toHaveLength(0)
  })

  it("sí lanza si falta una clave VAPID: es un bug de configuración, no de entrega", async () => {
    // Ojo: `configurarVapid` es perezoso y memoiza, así que este caso solo es
    // observable en un módulo recién importado. Se reimporta aislado.
    vi.resetModules()
    delete process.env.VAPID_PRIVATE_KEY
    const modulo = await import("@/lib/push/servidor")

    await expect(modulo.enviarPush(SUSCRIPCION, PAYLOAD)).rejects.toThrow(/VAPID_PRIVATE_KEY/)
  })
})

// --- enviarPushAUsuario ------------------------------------------------------

describe("enviarPushAUsuario", () => {
  it("le manda a todos los dispositivos activos de la cuenta", async () => {
    seleccionadas.push(SUSCRIPCION, { ...SUSCRIPCION, id: "22222222-2222-4222-8222-222222222222" })
    enviarNotificacion.mockResolvedValue({ statusCode: 201 })

    const resultados = await enviarPushAUsuario("usuario-1", PAYLOAD)

    expect(resultados).toHaveLength(2)
    expect(resultados.every((r) => r.estado === "entregado")).toBe(true)
  })

  it("devuelve una lista vacía si la cuenta no tiene suscripciones activas", async () => {
    await expect(enviarPushAUsuario("usuario-sin-nada", PAYLOAD)).resolves.toEqual([])
    expect(enviarNotificacion).not.toHaveBeenCalled()
  })

  it("un dispositivo muerto no impide la entrega a los demás", async () => {
    seleccionadas.push(SUSCRIPCION, { ...SUSCRIPCION, id: "33333333-3333-4333-8333-333333333333" })
    enviarNotificacion
      .mockRejectedValueOnce(new WebPushErrorFalso("Gone", 410))
      .mockResolvedValueOnce({ statusCode: 201 })

    const resultados = await enviarPushAUsuario("usuario-1", PAYLOAD)

    expect(resultados.map((r) => r.estado).sort()).toEqual(["entregado", "revocada"])
  })
})
