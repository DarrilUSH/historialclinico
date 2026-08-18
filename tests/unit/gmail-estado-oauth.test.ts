/**
 * Test del `state` anti-CSRF del flujo OAuth de Gmail
 * (`lib/gmail/estado-oauth.ts`, Sprint 17, tarea 17.1).
 *
 * Lógica pura sobre `node:crypto`: no levanta servidor, no toca la red, no
 * necesita cookies del framework. Lo que se prueba acá es exactamente el
 * ataque que este módulo existe para frenar —que alguien haga pasar un intento
 * ajeno por propio— y cada una de las cuatro puertas que tiene que cruzar un
 * sobre para ser aceptado: firma, vencimiento, nonce y cuenta.
 *
 *   npm run test
 */

import { describe, it, expect } from "vitest"

import {
  COOKIE_ESTADO_GMAIL,
  VIDA_ESTADO_MS,
  crearEstadoOauth,
  verificarEstadoOauth,
} from "@/lib/gmail/estado-oauth"

const SECRETO = "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eal"
const OTRO_SECRETO = "GOCSPX-otro-secreto-distinto"
const USUARIO = "11111111-1111-4111-8111-111111111111"
const OTRO_USUARIO = "22222222-2222-4222-8222-222222222222"
const REDIRECT = "http://localhost:3000/api/gmail/callback"
const AHORA = 1_770_000_000_000

function crear(opciones: Partial<Parameters<typeof crearEstadoOauth>[0]> = {}) {
  return crearEstadoOauth({
    userId: USUARIO,
    redirectUri: REDIRECT,
    secreto: SECRETO,
    ahoraMs: AHORA,
    ...opciones,
  })
}

describe("lib/gmail/estado-oauth.ts", () => {
  it("el ida y vuelta feliz devuelve la cuenta y el redirect_uri del sobre", () => {
    const estado = crear()

    const resultado = verificarEstadoOauth({
      cookie: estado.cookie,
      nonceRecibido: estado.nonce,
      secreto: SECRETO,
      ahoraMs: AHORA + 1000,
    })

    expect(resultado.valido).toBe(true)
    if (resultado.valido) {
      expect(resultado.userId).toBe(USUARIO)
      expect(resultado.redirectUri).toBe(REDIRECT)
    }
  })

  it("el `state` que va a Google es un nonce opaco: no lleva el user_id ni el redirect_uri", () => {
    // Importa de verdad: el `state` queda en la barra de direcciones, en el
    // historial, en el `Referer` y en los logs de Google.
    const estado = crear()

    expect(estado.nonce).not.toContain(USUARIO)
    expect(estado.nonce).not.toContain("localhost")
    expect(estado.nonce).not.toContain("callback")
    // 32 bytes en base64url, sin relleno.
    expect(estado.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("el sobre y el nonce cambian en cada intento", () => {
    const uno = crear()
    const dos = crear()

    expect(uno.nonce).not.toBe(dos.nonce)
    expect(uno.cookie).not.toBe(dos.cookie)
  })

  it("sin cookie no se valida nada: es el callback visitado a mano", () => {
    const estado = crear()

    for (const cookie of [null, undefined, ""]) {
      const resultado = verificarEstadoOauth({
        cookie,
        nonceRecibido: estado.nonce,
        secreto: SECRETO,
        ahoraMs: AHORA,
      })
      expect(resultado).toEqual({ valido: false, motivo: "sin_cookie" })
    }
  })

  it("un sobre con la carga alterada se rechaza por firma (el ataque real)", () => {
    // Alguien que quiere que su casilla quede colgada de la cuenta de otro:
    // toma un sobre válido y le cambia el `u` por el uuid de la víctima.
    const estado = crear()
    const [cargaCodificada, firma] = estado.cookie.split(".")

    const cargaOriginal = JSON.parse(
      Buffer.from(cargaCodificada.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as Record<string, unknown>
    expect(cargaOriginal.u).toBe(USUARIO)

    const cargaAlterada = Buffer.from(
      JSON.stringify({ ...cargaOriginal, u: OTRO_USUARIO }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")

    const resultado = verificarEstadoOauth({
      cookie: `${cargaAlterada}.${firma}`,
      nonceRecibido: estado.nonce,
      secreto: SECRETO,
      ahoraMs: AHORA,
    })

    expect(resultado).toEqual({ valido: false, motivo: "firma_invalida" })
  })

  it("un sobre firmado con otra clave se rechaza", () => {
    const estado = crearEstadoOauth({
      userId: USUARIO,
      redirectUri: REDIRECT,
      secreto: OTRO_SECRETO,
      ahoraMs: AHORA,
    })

    const resultado = verificarEstadoOauth({
      cookie: estado.cookie,
      nonceRecibido: estado.nonce,
      secreto: SECRETO,
      ahoraMs: AHORA,
    })

    expect(resultado).toEqual({ valido: false, motivo: "firma_invalida" })
  })

  it("un sobre sin punto separador, o con la firma vacía, se rechaza por formato", () => {
    for (const cookie of ["sin-punto", ".", "solo-carga.", "aGVsbG8"]) {
      const resultado = verificarEstadoOauth({
        cookie,
        nonceRecibido: "lo-que-sea",
        secreto: SECRETO,
        ahoraMs: AHORA,
      })
      expect(resultado.valido).toBe(false)
      if (!resultado.valido) {
        expect(["formato_invalido", "firma_invalida"]).toContain(resultado.motivo)
      }
    }
  })

  it("pasada la vida del intento el sobre no sirve más", () => {
    const estado = crear()

    // Un milisegundo antes del vencimiento todavía vale.
    expect(
      verificarEstadoOauth({
        cookie: estado.cookie,
        nonceRecibido: estado.nonce,
        secreto: SECRETO,
        ahoraMs: AHORA + VIDA_ESTADO_MS,
      }).valido,
    ).toBe(true)

    expect(
      verificarEstadoOauth({
        cookie: estado.cookie,
        nonceRecibido: estado.nonce,
        secreto: SECRETO,
        ahoraMs: AHORA + VIDA_ESTADO_MS + 1,
      }),
    ).toEqual({ valido: false, motivo: "vencido" })
  })

  it("el nonce de OTRO intento no abre este sobre", () => {
    // Es el caso de dos pestañas: la cookie es la del segundo intento y el
    // `state` que vuelve de Google es el del primero.
    const primero = crear()
    const segundo = crear()

    expect(
      verificarEstadoOauth({
        cookie: segundo.cookie,
        nonceRecibido: primero.nonce,
        secreto: SECRETO,
        ahoraMs: AHORA,
      }),
    ).toEqual({ valido: false, motivo: "nonce_no_coincide" })
  })

  it("sin `state` en la vuelta tampoco se valida", () => {
    const estado = crear()

    for (const nonce of [null, undefined, ""]) {
      expect(
        verificarEstadoOauth({
          cookie: estado.cookie,
          nonceRecibido: nonce,
          secreto: SECRETO,
          ahoraMs: AHORA,
        }),
      ).toEqual({ valido: false, motivo: "nonce_no_coincide" })
    }
  })

  it("el vencimiento declarado coincide con la vida del intento", () => {
    const estado = crear()
    expect(estado.venceEn).toBe(AHORA + VIDA_ESTADO_MS)
  })

  it("el nombre de la cookie es estable (lo escribe /conectar y lo borra /callback)", () => {
    // Si estos dos dejaran de coincidir, el borrado crearía una cookie vacía
    // distinta y el sobre original quedaría vivo.
    expect(COOKIE_ESTADO_GMAIL).toBe("gmail_oauth_estado")
  })
})
