/**
 * Tests de `lib/validacion/suscripcion-push.schema.ts` (Sprint 6, tarea 6.3).
 *
 * Una Server Action es un endpoint HTTP público y lo que se guarda es la URL
 * a la que el servidor va a hacer un POST firmado en cada barrido de
 * recordatorios, para siempre. Estos casos fijan que la validación no acepte
 * nada que convierta a la aplicación en un cliente HTTP contra un host
 * elegido por quien postea.
 */

import { describe, expect, it } from "vitest"

import {
  MAX_ENDPOINT,
  validarRevocacionPush,
  validarSuscripcionPush,
} from "@/lib/validacion/suscripcion-push.schema"

/** Lo que devuelve `pushManager.subscribe()` en Chrome/Android, tal cual. */
const VALIDA = {
  endpoint:
    "https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bH0Yk3nZ8vQxLmTn7cRfGh2JkLpQwErTyUiOpAsDfGhJkL",
  p256dh:
    "BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oYhIO4475rds",
  auth: "5I2Bu2oKdyy9CwL8QVF0NQ",
  userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A536E) Chrome/131.0.0.0 Mobile Safari/537.36",
}

describe("validarSuscripcionPush", () => {
  it("acepta una suscripción real de Chrome en Android", () => {
    const resultado = validarSuscripcionPush(VALIDA)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.endpoint).toBe(VALIDA.endpoint)
      expect(resultado.datos.userAgent).toBe(VALIDA.userAgent)
      expect(resultado.datos.perfilId).toBeUndefined()
    }
  })

  it("acepta el endpoint de Mozilla autopush (Firefox)", () => {
    const resultado = validarSuscripcionPush({
      ...VALIDA,
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABn9k",
    })
    expect(resultado.ok).toBe(true)
  })

  it("rechaza un endpoint http:// — mismo CHECK que la base", () => {
    const resultado = validarSuscripcionPush({ ...VALIDA, endpoint: "http://fcm.googleapis.com/x" })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza esquemas que no son HTTP", () => {
    for (const endpoint of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/plain,hola",
      "ftp://ejemplo.com/x",
    ]) {
      expect(validarSuscripcionPush({ ...VALIDA, endpoint }).ok).toBe(false)
    }
  })

  it("rechaza credenciales embebidas en la URL", () => {
    const resultado = validarSuscripcionPush({
      ...VALIDA,
      endpoint: "https://usuario:clave@fcm.googleapis.com/fcm/send/abc",
    })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza un endpoint desmesurado", () => {
    const resultado = validarSuscripcionPush({
      ...VALIDA,
      endpoint: `https://fcm.googleapis.com/${"a".repeat(MAX_ENDPOINT)}`,
    })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza claves de cifrado ausentes o de largo imposible", () => {
    expect(validarSuscripcionPush({ ...VALIDA, p256dh: "" }).ok).toBe(false)
    expect(validarSuscripcionPush({ ...VALIDA, p256dh: "corta" }).ok).toBe(false)
    expect(validarSuscripcionPush({ ...VALIDA, auth: "" }).ok).toBe(false)
    expect(validarSuscripcionPush({ ...VALIDA, auth: "x" }).ok).toBe(false)
  })

  it("rechaza claves que no son base64url", () => {
    // `+` y `/` son base64 clásico: `atob` del navegador no los produce acá y
    // aceptarlos rompería el cifrado recién en el primer envío.
    expect(validarSuscripcionPush({ ...VALIDA, p256dh: VALIDA.p256dh.replace("-", "+") }).ok).toBe(
      false,
    )
    expect(validarSuscripcionPush({ ...VALIDA, auth: "5I2Bu2oKdyy9CwL8QVF0N=" }).ok).toBe(false)
  })

  it("rechaza cualquier cosa que no sea un objeto", () => {
    for (const basura of [null, undefined, "endpoint", 42, [], true]) {
      expect(validarSuscripcionPush(basura).ok).toBe(false)
    }
  })

  it("acepta un perfilId con forma de uuid y descarta el resto", () => {
    const conPerfil = validarSuscripcionPush({
      ...VALIDA,
      perfilId: "11111111-1111-4111-8111-111111111111",
    })
    expect(conPerfil.ok).toBe(true)
    if (conPerfil.ok) {
      expect(conPerfil.datos.perfilId).toBe("11111111-1111-4111-8111-111111111111")
    }

    expect(validarSuscripcionPush({ ...VALIDA, perfilId: "no-es-un-uuid" }).ok).toBe(false)
  })

  it("recorta un user agent enorme en vez de aceptarlo entero", () => {
    expect(validarSuscripcionPush({ ...VALIDA, userAgent: "x".repeat(600) }).ok).toBe(false)
  })

  it("devuelve un mensaje en español, no un volcado de Zod", () => {
    const resultado = validarSuscripcionPush({ ...VALIDA, endpoint: "no-es-una-url" })
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toMatch(/notificaciones/)
    }
  })
})

describe("validarRevocacionPush", () => {
  it("acepta el endpoint solo", () => {
    const resultado = validarRevocacionPush({ endpoint: VALIDA.endpoint })
    expect(resultado.ok).toBe(true)
  })

  it("aplica las mismas reglas de endpoint que el alta", () => {
    expect(validarRevocacionPush({ endpoint: "http://ejemplo.com" }).ok).toBe(false)
    expect(validarRevocacionPush({}).ok).toBe(false)
  })
})
