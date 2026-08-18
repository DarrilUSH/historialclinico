/**
 * Test del cliente REST de Google/Gmail (`lib/gmail/google-api.ts`, Sprint 17,
 * tarea 17.1) contra un **servidor `node:http` local**.
 *
 * ## Por qué un servidor de verdad y no un `fetch` mockeado
 *
 * Porque lo que hay que verificar no es "se llamó a `fetch`": es que el cuerpo
 * salga como `application/x-www-form-urlencoded` con los campos que Google
 * espera, que el `Authorization: Bearer` viaje, que un `400 invalid_grant` se
 * convierta en el error tipado correcto y que el reintento sin color y el
 * `409` de la etiqueta hagan lo que dicen. Un mock de `fetch` prueba el mock;
 * un servidor local prueba el código.
 *
 * El único límite REAL de esta tarea es el consentimiento final, que exige la
 * cuenta de Google de la persona (paso del usuario). Todo lo demás del
 * circuito —intercambio, perfil, etiqueta, refresco, revocación y sus modos de
 * falla— queda probado acá de punta a punta.
 *
 *   npm run test
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  ErrorGmail,
  NOMBRE_ETIQUETA,
  REDIRECT_URIS_REGISTRADOS,
  SCOPES_GMAIL,
  asegurarEtiqueta,
  intercambiarCodigo,
  obtenerCorreoConectado,
  origenDeLaRequest,
  redirectUriPara,
  refrescarAccessToken,
  revocarToken,
  urlDeConsentimiento,
} from "@/lib/gmail/google-api"

/* ------------------------------------------------------------------ *
 *  El Google de mentira
 * ------------------------------------------------------------------ */

interface RespuestaFalsa {
  estado: number
  cuerpo: unknown
}

interface Escenario {
  token: RespuestaFalsa
  revoke: RespuestaFalsa
  perfil: RespuestaFalsa
  /** Respuestas sucesivas de `labels.list`: la primera para el listado, la segunda para el relistado del 409. */
  listados: RespuestaFalsa[]
  /** Respuestas sucesivas de `labels.create`: la primera con color, la segunda sin. */
  altas: RespuestaFalsa[]
}

interface PedidoRegistrado {
  metodo: string
  ruta: string
  autorizacion: string | undefined
  contentType: string | undefined
  cuerpo: string
}

let servidor: Server
let base = ""
let escenario: Escenario
let pedidos: PedidoRegistrado[] = []

function escenarioFeliz(): Escenario {
  return {
    token: {
      estado: 200,
      cuerpo: {
        access_token: "ya29.access-de-prueba",
        refresh_token: "1//refresh-de-prueba",
        expires_in: 3599,
        scope: SCOPES_GMAIL.join(" "),
        token_type: "Bearer",
      },
    },
    revoke: { estado: 200, cuerpo: {} },
    perfil: { estado: 200, cuerpo: { emailAddress: "persona@gmail.com", messagesTotal: 1234 } },
    listados: [
      {
        estado: 200,
        cuerpo: {
          labels: [
            { id: "INBOX", name: "INBOX", type: "system" },
            { id: "Label_1", name: "Trabajo", type: "user" },
          ],
        },
      },
    ],
    altas: [
      { estado: 200, cuerpo: { id: "Label_77", name: NOMBRE_ETIQUETA, type: "user" } },
    ],
  }
}

function leerCuerpo(pedido: IncomingMessage): Promise<string> {
  return new Promise((resolver) => {
    const partes: Buffer[] = []
    pedido.on("data", (parte: Buffer) => partes.push(parte))
    pedido.on("end", () => resolver(Buffer.concat(partes).toString("utf8")))
  })
}

function responder(respuesta: ServerResponse, falsa: RespuestaFalsa) {
  respuesta.writeHead(falsa.estado, { "Content-Type": "application/json; charset=utf-8" })
  respuesta.end(JSON.stringify(falsa.cuerpo))
}

/** Saca de la cola la respuesta que toca; si se agotó, repite la última. */
function siguiente(cola: RespuestaFalsa[]): RespuestaFalsa {
  return cola.length > 1 ? (cola.shift() as RespuestaFalsa) : cola[0]
}

beforeAll(async () => {
  servidor = createServer((pedido, respuesta) => {
    void (async () => {
      const ruta = (pedido.url ?? "").split("?")[0]
      pedidos.push({
        metodo: pedido.method ?? "",
        ruta,
        autorizacion: pedido.headers.authorization,
        contentType: pedido.headers["content-type"],
        cuerpo: await leerCuerpo(pedido),
      })

      if (ruta === "/token") return responder(respuesta, escenario.token)
      if (ruta === "/revoke") return responder(respuesta, escenario.revoke)
      if (ruta === "/gmail/v1/users/me/profile") return responder(respuesta, escenario.perfil)
      if (ruta === "/gmail/v1/users/me/labels") {
        return responder(
          respuesta,
          pedido.method === "POST" ? siguiente(escenario.altas) : siguiente(escenario.listados),
        )
      }

      respuesta.writeHead(404, { "Content-Type": "application/json" })
      respuesta.end(JSON.stringify({ error: "ruta no simulada" }))
    })()
  })

  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver))
  const direccion = servidor.address() as AddressInfo
  base = `http://127.0.0.1:${direccion.port}`
})

afterAll(async () => {
  await new Promise<void>((resolver) => servidor.close(() => resolver()))
})

beforeEach(() => {
  escenario = escenarioFeliz()
  pedidos = []
})

/** Bases apuntadas al Google de mentira. */
function bases() {
  return { baseCuentas: base, baseOauth: base, baseGmail: base }
}

function campos(cuerpo: string): URLSearchParams {
  return new URLSearchParams(cuerpo)
}

/* ------------------------------------------------------------------ *
 *  Lo que no necesita servidor
 * ------------------------------------------------------------------ */

describe("urlDeConsentimiento", () => {
  it("pide los TRES scopes de una sola vez, con offline + consent", () => {
    const url = new URL(
      urlDeConsentimiento(
        { clientId: "cliente.apps.googleusercontent.com", redirectUri: REDIRECT_URIS_REGISTRADOS[1], state: "nonce-123" },
        bases(),
      ),
    )

    expect(url.searchParams.get("client_id")).toBe("cliente.apps.googleusercontent.com")
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/gmail/callback")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("state")).toBe("nonce-123")

    // Los tres juntos: la 17.2 no vuelve a pedir consentimiento.
    const scopes = (url.searchParams.get("scope") ?? "").split(" ")
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.readonly")
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.labels")
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.settings.basic")
    expect(scopes).toHaveLength(3)

    // Las dos que garantizan el refresh token.
    expect(url.searchParams.get("access_type")).toBe("offline")
    expect(url.searchParams.get("prompt")).toBe("consent")
  })

  it("no manda `login_hint`: si la persona tiene dos cuentas de Google tiene que poder elegir", () => {
    const url = new URL(
      urlDeConsentimiento({ clientId: "c", redirectUri: REDIRECT_URIS_REGISTRADOS[0], state: "s" }, bases()),
    )
    expect(url.searchParams.has("login_hint")).toBe(false)
  })
})

describe("redirectUriPara", () => {
  it("acepta exactamente los dos orígenes registrados en Google", () => {
    expect(redirectUriPara("http://localhost:3000")).toBe(
      "http://localhost:3000/api/gmail/callback",
    )
    expect(redirectUriPara("https://www.historialmedico.com.ar")).toBe(
      "https://www.historialmedico.com.ar/api/gmail/callback",
    )
    expect(redirectUriPara("https://www.historialmedico.com.ar/")).toBe(
      "https://www.historialmedico.com.ar/api/gmail/callback",
    )
  })

  it("rechaza cualquier otro host, incluidos los previews de Vercel y el apex sin www", () => {
    // Es la consecuencia deliberada de la lista blanca: en un preview la
    // conexión no funciona, y la app lo dice en vez de mandar a la persona a
    // un error de Google.
    expect(redirectUriPara("https://historialclinico-abc123.vercel.app")).toBeNull()
    expect(redirectUriPara("https://historialmedico.com.ar")).toBeNull()
    expect(redirectUriPara("http://www.historialmedico.com.ar")).toBeNull()
    expect(redirectUriPara("https://localhost:3000")).toBeNull()
    expect(redirectUriPara("http://localhost:3001")).toBeNull()
    // Un `Host` falsificado no sirve de nada: no está en la lista.
    expect(redirectUriPara("https://sitio-falso.ar")).toBeNull()
  })
})

describe("origenDeLaRequest", () => {
  it("usa los headers x-forwarded-* cuando existen (detrás de Vercel)", () => {
    // Sin esto, en producción el origen se leería `http://` -la request llega
    // al proceso por HTTP- y el redirect_uri no coincidiría con el registrado.
    const pedido = new Request("http://interno.vercel.local/api/gmail/conectar", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "www.historialmedico.com.ar",
        host: "interno.vercel.local",
      },
    })
    expect(origenDeLaRequest(pedido)).toBe("https://www.historialmedico.com.ar")
    expect(redirectUriPara(origenDeLaRequest(pedido))).toBe(
      "https://www.historialmedico.com.ar/api/gmail/callback",
    )
  })

  it("cae al Host cuando no hay proxy (local, y el celular por adb reverse)", () => {
    const pedido = new Request("http://localhost:3000/api/gmail/conectar", {
      headers: { host: "localhost:3000" },
    })
    expect(origenDeLaRequest(pedido)).toBe("http://localhost:3000")
  })

  it("con una cadena de proxies toma el primer protocolo declarado", () => {
    const pedido = new Request("http://interno/api/gmail/conectar", {
      headers: { "x-forwarded-proto": "https, http", "x-forwarded-host": "www.historialmedico.com.ar" },
    })
    expect(origenDeLaRequest(pedido)).toBe("https://www.historialmedico.com.ar")
  })
})

/* ------------------------------------------------------------------ *
 *  Intercambio del `code`
 * ------------------------------------------------------------------ */

describe("intercambiarCodigo", () => {
  it("manda el formulario que Google espera y devuelve los tokens", async () => {
    const tokens = await intercambiarCodigo(
      {
        code: "4/codigo-de-prueba",
        clientId: "cliente.apps.googleusercontent.com",
        clientSecret: "GOCSPX-secreto",
        redirectUri: REDIRECT_URIS_REGISTRADOS[1],
      },
      bases(),
    )

    expect(tokens.accessToken).toBe("ya29.access-de-prueba")
    expect(tokens.refreshToken).toBe("1//refresh-de-prueba")
    expect(tokens.expiraEn).toBe(3599)
    expect(tokens.scopes).toBe(SCOPES_GMAIL.join(" "))

    const pedido = pedidos.find((p) => p.ruta === "/token")
    expect(pedido?.metodo).toBe("POST")
    expect(pedido?.contentType).toBe("application/x-www-form-urlencoded")

    const enviado = campos(pedido?.cuerpo ?? "")
    expect(enviado.get("grant_type")).toBe("authorization_code")
    expect(enviado.get("code")).toBe("4/codigo-de-prueba")
    expect(enviado.get("redirect_uri")).toBe("http://localhost:3000/api/gmail/callback")
    // El secreto viaja de servidor a servidor y nunca por el navegador.
    expect(enviado.get("client_secret")).toBe("GOCSPX-secreto")
  })

  it("un `invalid_grant` en el intercambio es un código quemado, no un permiso vencido", async () => {
    escenario.token = {
      estado: 400,
      cuerpo: { error: "invalid_grant", error_description: "Bad Request" },
    }

    await expect(
      intercambiarCodigo(
        { code: "usado", clientId: "c", clientSecret: "s", redirectUri: REDIRECT_URIS_REGISTRADOS[1] },
        bases(),
      ),
    ).rejects.toMatchObject({ codigo: "codigo_invalido" })
  })

  it("cualquier otro error de Google cae en `respuesta_de_google`", async () => {
    escenario.token = { estado: 401, cuerpo: { error: "invalid_client" } }

    const fallo = await intercambiarCodigo(
      { code: "x", clientId: "c", clientSecret: "s", redirectUri: REDIRECT_URIS_REGISTRADOS[1] },
      bases(),
    ).catch((error: unknown) => error)

    expect(fallo).toBeInstanceOf(ErrorGmail)
    expect((fallo as ErrorGmail).codigo).toBe("respuesta_de_google")
    expect((fallo as ErrorGmail).detalle).toContain("invalid_client")
    // El mensaje que se le muestra a la persona no tiene jerga.
    expect((fallo as ErrorGmail).message).toBe(
      "Google no pudo completar la conexión. Probá de nuevo en un rato.",
    )
  })

  it("un 200 sin access_token también se considera fallo", async () => {
    escenario.token = { estado: 200, cuerpo: { token_type: "Bearer" } }

    await expect(
      intercambiarCodigo(
        { code: "x", clientId: "c", clientSecret: "s", redirectUri: REDIRECT_URIS_REGISTRADOS[1] },
        bases(),
      ),
    ).rejects.toBeInstanceOf(ErrorGmail)
  })

  it("si Google no manda refresh_token, quien llama lo ve como `null` y decide", async () => {
    escenario.token = {
      estado: 200,
      cuerpo: { access_token: "ya29.solo-access", expires_in: 3599 },
    }

    const tokens = await intercambiarCodigo(
      { code: "x", clientId: "c", clientSecret: "s", redirectUri: REDIRECT_URIS_REGISTRADOS[1] },
      bases(),
    )

    expect(tokens.refreshToken).toBeNull()
  })

  it("si no se llega a Google, el error es de conexión y no de respuesta", async () => {
    // Puerto cerrado a propósito.
    await expect(
      intercambiarCodigo(
        { code: "x", clientId: "c", clientSecret: "s", redirectUri: REDIRECT_URIS_REGISTRADOS[1] },
        { baseOauth: "http://127.0.0.1:1" },
      ),
    ).rejects.toMatchObject({ codigo: "sin_conexion" })
  })
})

/* ------------------------------------------------------------------ *
 *  Refresco y revocación
 * ------------------------------------------------------------------ */

describe("refrescarAccessToken", () => {
  it("cambia el refresh token por un access token nuevo", async () => {
    const fresco = await refrescarAccessToken(
      { refreshToken: "1//refresh-de-prueba", clientId: "c", clientSecret: "s" },
      bases(),
    )

    expect(fresco.accessToken).toBe("ya29.access-de-prueba")
    expect(fresco.expiraEn).toBe(3599)

    const enviado = campos(pedidos.find((p) => p.ruta === "/token")?.cuerpo ?? "")
    expect(enviado.get("grant_type")).toBe("refresh_token")
    expect(enviado.get("refresh_token")).toBe("1//refresh-de-prueba")
  })

  it("`invalid_grant` al refrescar ES el permiso vencido (los 7 días del modo prueba)", async () => {
    escenario.token = {
      estado: 400,
      cuerpo: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
    }

    const fallo = await refrescarAccessToken(
      { refreshToken: "1//viejo", clientId: "c", clientSecret: "s" },
      bases(),
    ).catch((error: unknown) => error)

    expect(fallo).toBeInstanceOf(ErrorGmail)
    expect((fallo as ErrorGmail).codigo).toBe("permiso_vencido")
    expect((fallo as ErrorGmail).message).toBe(
      "Se venció el permiso para leer tu Gmail. Volvé a conectarlo cuando quieras.",
    )
  })
})

describe("revocarToken", () => {
  it("devuelve true cuando Google confirma", async () => {
    expect(await revocarToken("1//refresh-de-prueba", bases())).toBe(true)
    expect(campos(pedidos.find((p) => p.ruta === "/revoke")?.cuerpo ?? "").get("token")).toBe(
      "1//refresh-de-prueba",
    )
  })

  it("nunca lanza: un token ya revocado (400) devuelve false y la desconexión sigue", async () => {
    escenario.revoke = { estado: 400, cuerpo: { error: "invalid_token" } }
    expect(await revocarToken("1//ya-revocado", bases())).toBe(false)
  })

  it("nunca lanza tampoco si Google no responde", async () => {
    expect(await revocarToken("1//x", { baseOauth: "http://127.0.0.1:1" })).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 *  Perfil y etiqueta
 * ------------------------------------------------------------------ */

describe("obtenerCorreoConectado", () => {
  it("pregunta al perfil de Gmail con el Bearer y devuelve la casilla", async () => {
    expect(await obtenerCorreoConectado("ya29.access", bases())).toBe("persona@gmail.com")

    const pedido = pedidos.find((p) => p.ruta === "/gmail/v1/users/me/profile")
    expect(pedido?.autorizacion).toBe("Bearer ya29.access")
  })

  it("un perfil sin emailAddress es un fallo, no un correo vacío", async () => {
    escenario.perfil = { estado: 200, cuerpo: { messagesTotal: 3 } }
    await expect(obtenerCorreoConectado("ya29.access", bases())).rejects.toBeInstanceOf(ErrorGmail)
  })

  it("un 403 del perfil se reporta con el detalle en el log, no en la pantalla", async () => {
    escenario.perfil = { estado: 403, cuerpo: { error: { message: "Insufficient Permission" } } }

    const fallo = await obtenerCorreoConectado("ya29.access", bases()).catch(
      (error: unknown) => error,
    )
    expect((fallo as ErrorGmail).codigo).toBe("respuesta_de_google")
    expect((fallo as ErrorGmail).detalle).toContain("403")
    expect((fallo as ErrorGmail).message).not.toContain("403")
  })
})

describe("asegurarEtiqueta", () => {
  it("la crea cuando no existe, con color y visible en las dos listas", async () => {
    const etiqueta = await asegurarEtiqueta("ya29.access", bases())

    expect(etiqueta).toEqual({ id: "Label_77", nombre: NOMBRE_ETIQUETA, creada: true })

    const alta = pedidos.find((p) => p.metodo === "POST" && p.ruta === "/gmail/v1/users/me/labels")
    const cuerpo = JSON.parse(alta?.cuerpo ?? "{}") as Record<string, unknown>
    expect(cuerpo.name).toBe("historialmedico")
    expect(cuerpo.labelListVisibility).toBe("labelShow")
    expect(cuerpo.messageListVisibility).toBe("show")
    expect(cuerpo.color).toEqual({ backgroundColor: "#b6cff5", textColor: "#0d3472" })
  })

  it("si la persona ya la tenía, usa la suya y NO crea ninguna", async () => {
    escenario.listados = [
      {
        estado: 200,
        cuerpo: {
          labels: [
            { id: "INBOX", name: "INBOX", type: "system" },
            { id: "Label_42", name: "historialmedico", type: "user" },
          ],
        },
      },
    ]

    const etiqueta = await asegurarEtiqueta("ya29.access", bases())

    expect(etiqueta).toEqual({ id: "Label_42", nombre: "historialmedico", creada: false })
    expect(pedidos.filter((p) => p.metodo === "POST")).toHaveLength(0)
  })

  it("reconoce la etiqueta aunque esté escrita con otras mayúsculas", async () => {
    // Gmail no admite dos etiquetas que difieran solo en mayúsculas: crear
    // otra fallaría con 409, así que la que hay ES la etiqueta.
    escenario.listados = [
      { estado: 200, cuerpo: { labels: [{ id: "Label_9", name: "HistorialMedico", type: "user" }] } },
    ]

    const etiqueta = await asegurarEtiqueta("ya29.access", bases())

    expect(etiqueta).toEqual({ id: "Label_9", nombre: "HistorialMedico", creada: false })
    expect(pedidos.filter((p) => p.metodo === "POST")).toHaveLength(0)
  })

  it("si Google rechaza el color, reintenta sin color: la etiqueta importa, el color no", async () => {
    escenario.altas = [
      { estado: 400, cuerpo: { error: { message: "Invalid label color" } } },
      { estado: 200, cuerpo: { id: "Label_78", name: NOMBRE_ETIQUETA } },
    ]

    const etiqueta = await asegurarEtiqueta("ya29.access", bases())

    expect(etiqueta).toEqual({ id: "Label_78", nombre: NOMBRE_ETIQUETA, creada: true })

    const altas = pedidos.filter((p) => p.metodo === "POST")
    expect(altas).toHaveLength(2)
    expect(JSON.parse(altas[0].cuerpo) as Record<string, unknown>).toHaveProperty("color")
    expect(JSON.parse(altas[1].cuerpo) as Record<string, unknown>).not.toHaveProperty("color")
  })

  it("un 409 (otra pestaña la creó en el medio) se resuelve relistando", async () => {
    escenario.altas = [{ estado: 409, cuerpo: { error: { message: "Label name exists or conflicts" } } }]
    escenario.listados = [
      { estado: 200, cuerpo: { labels: [{ id: "INBOX", name: "INBOX" }] } },
      { estado: 200, cuerpo: { labels: [{ id: "Label_55", name: NOMBRE_ETIQUETA }] } },
    ]

    const etiqueta = await asegurarEtiqueta("ya29.access", bases())

    expect(etiqueta).toEqual({ id: "Label_55", nombre: NOMBRE_ETIQUETA, creada: false })
  })

  it("un 500 al crear sí es un fallo, con el nombre de la etiqueta en el mensaje", async () => {
    escenario.altas = [{ estado: 500, cuerpo: { error: { message: "Backend Error" } } }]

    const fallo = await asegurarEtiqueta("ya29.access", bases()).catch((error: unknown) => error)

    expect(fallo).toBeInstanceOf(ErrorGmail)
    expect((fallo as ErrorGmail).message).toContain("historialmedico")
    expect((fallo as ErrorGmail).detalle).toContain("500")
  })

  it("si no se puede ni listar, no se intenta crear nada", async () => {
    escenario.listados = [{ estado: 401, cuerpo: { error: { message: "Invalid Credentials" } } }]

    await expect(asegurarEtiqueta("ya29.access", bases())).rejects.toBeInstanceOf(ErrorGmail)
    expect(pedidos.filter((p) => p.metodo === "POST")).toHaveLength(0)
  })
})
