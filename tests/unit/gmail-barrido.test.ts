/**
 * Test del BARRIDO de la etiqueta y de todo lo que cuelga de él
 * (`lib/gmail/barrido.ts`, `lib/gmail/adjunto.ts`, `lib/gmail/filtros.ts` y
 * las funciones de la 17.2 en `lib/gmail/google-api.ts`) contra un **servidor
 * `node:http` local que hace de Gmail**.
 *
 * ## Por qué un Gmail de mentira y no `fetch` mockeado
 *
 * Mismo motivo que en `tests/unit/gmail-oauth.test.ts` (tarea 17.1): lo que
 * hay que verificar no es "se llamó a `fetch`". Es que el listado mande de
 * verdad `labelIds` y NUNCA una `q` de búsqueda libre, que el `Authorization:
 * Bearer` viaje, que la paginación se encadene bien, que un `401` a mitad de
 * la pasada se convierta en "conexión vencida" y no en una excepción suelta,
 * que un `500` en un mensaje no se lleve puestos a los demás, y que el filtro
 * duplicado se resuelva relistando. Un mock de `fetch` prueba el mock; un
 * servidor local prueba el código.
 *
 * Lo ÚNICO que se sustituye es la persistencia (Supabase) y el token (el
 * Vault), que son las dos cosas que no se pueden levantar en un test unitario.
 * El resto -HTTP, parseo, heurística, clasificación, dedup, tandas- es el
 * código real.
 *
 * ## El caso que pidió el encargo
 *
 * `describe("barrido de punta a punta")` corre UNA pasada sobre una casilla
 * con CINCO correos distintos y verifica el reparto exacto: 2 estudios
 * pendientes, 1 turno pendiente, 1 descartado solo y 1 error aislado que
 * queda para la próxima pasada.
 *
 *   npm run test
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { ingerirAdjuntoDeGmail } from "@/lib/gmail/adjunto"
import { RESULTADO_AUTO_VACIO, type CorreoRecienRegistrado } from "@/lib/gmail/auto-carga"
import {
  LIMITE_MENSAJES_POR_PASADA,
  barrerConexion,
  barrerConexiones,
  clasificarMensaje,
  fraseDeResultado,
} from "@/lib/gmail/barrido"
import { ErrorConexionGmailVencida } from "@/lib/gmail/conexiones-admin"
import {
  borrarFiltro,
  crearFiltroPorRemitente,
  descargarAdjunto,
  listarFiltros,
  listarMensajesDeEtiqueta,
} from "@/lib/gmail/google-api"
import type { MensajeParaRegistrar } from "@/lib/gmail/mensajes-admin"
import type { MensajeRegistrado } from "@/lib/gmail/mensajes-admin"

/* ------------------------------------------------------------------ *
 *  El Gmail de mentira
 * ------------------------------------------------------------------ */

interface MensajeFalso {
  /** El JSON que devuelve `messages.get`, o un estado HTTP para simular una falla. */
  respuesta: { estado: number; cuerpo: unknown }
}

interface Casilla {
  /** Páginas del listado: cada una con sus ids y el token de la siguiente. */
  paginas: { ids: string[]; siguiente: string | null }[]
  mensajes: Record<string, MensajeFalso>
  adjuntos: Record<string, { estado: number; cuerpo: unknown }>
  filtros: { id: string; criteria: { from?: string }; action: { addLabelIds?: string[] } }[]
  /** Si está, `settings.filters` POST contesta esto en vez de crear. */
  respuestaAltaFiltro: { estado: number; cuerpo: unknown } | null
}

interface Pedido {
  metodo: string
  ruta: string
  query: URLSearchParams
  autorizacion: string | undefined
  cuerpo: string
}

let servidor: Server
let base = ""
let casilla: Casilla
let pedidos: Pedido[] = []

const ETIQUETA = "Label_HM"

function b64(texto: string): string {
  return Buffer.from(texto, "utf8").toString("base64url")
}

function encabezados(pares: Record<string, string>) {
  return Object.entries(pares).map(([name, value]) => ({ name, value }))
}

/** Un correo con un PDF adjunto (el caso "estudio"). */
function correoConPdf(id: string, asunto: string, remitente: string, adjuntoId: string) {
  return {
    respuesta: {
      estado: 200,
      cuerpo: {
        id,
        internalDate: "1786000000000",
        payload: {
          mimeType: "multipart/mixed",
          headers: encabezados({ From: remitente, Subject: asunto }),
          parts: [
            { mimeType: "text/plain", body: { data: b64("Adjuntamos el resultado del estudio.") } },
            {
              mimeType: "application/pdf",
              filename: "resultado.pdf",
              body: { attachmentId: adjuntoId, size: 24000 },
            },
          ],
        },
      },
    },
  }
}

function leerCuerpo(pedido: IncomingMessage): Promise<string> {
  return new Promise((resolver) => {
    const partes: Buffer[] = []
    pedido.on("data", (parte: Buffer) => partes.push(parte))
    pedido.on("end", () => resolver(Buffer.concat(partes).toString("utf8")))
  })
}

function responder(respuesta: ServerResponse, estado: number, cuerpo: unknown) {
  respuesta.writeHead(estado, { "Content-Type": "application/json; charset=utf-8" })
  respuesta.end(JSON.stringify(cuerpo))
}

beforeAll(async () => {
  servidor = createServer((pedido, respuesta) => {
    void (async () => {
      const url = new URL(pedido.url ?? "/", "http://interno")
      const ruta = url.pathname
      pedidos.push({
        metodo: pedido.method ?? "",
        ruta,
        query: url.searchParams,
        autorizacion: pedido.headers.authorization,
        cuerpo: await leerCuerpo(pedido),
      })

      // Listado de la etiqueta
      if (ruta === "/gmail/v1/users/me/messages" && pedido.method === "GET") {
        const token = url.searchParams.get("pageToken")
        const indice = token === null ? 0 : Number(token)
        const pagina = casilla.paginas[indice]
        if (!pagina) return responder(respuesta, 200, { messages: [] })
        return responder(respuesta, 200, {
          messages: pagina.ids.map((id) => ({ id, threadId: id })),
          ...(pagina.siguiente === null ? {} : { nextPageToken: pagina.siguiente }),
        })
      }

      // Un adjunto
      const adjunto = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(ruta)
      if (adjunto) {
        const guardado = casilla.adjuntos[adjunto[2]]
        if (!guardado) return responder(respuesta, 404, { error: { message: "Not Found" } })
        return responder(respuesta, guardado.estado, guardado.cuerpo)
      }

      // Un mensaje
      const mensaje = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(ruta)
      if (mensaje) {
        const guardado = casilla.mensajes[mensaje[1]]
        if (!guardado) return responder(respuesta, 404, { error: { message: "Not Found" } })
        return responder(respuesta, guardado.respuesta.estado, guardado.respuesta.cuerpo)
      }

      // Filtros
      if (ruta === "/gmail/v1/users/me/settings/filters") {
        if (pedido.method === "GET") {
          return responder(respuesta, 200, { filter: casilla.filtros })
        }
        if (pedido.method === "POST") {
          if (casilla.respuestaAltaFiltro) {
            return responder(
              respuesta,
              casilla.respuestaAltaFiltro.estado,
              casilla.respuestaAltaFiltro.cuerpo,
            )
          }
          const cuerpo = JSON.parse(pedidos[pedidos.length - 1].cuerpo || "{}") as Omit<
            Casilla["filtros"][number],
            "id"
          >
          const creado = { ...cuerpo, id: `filtro_${casilla.filtros.length + 1}` }
          casilla.filtros.push(creado)
          return responder(respuesta, 200, creado)
        }
      }

      const borrado = /^\/gmail\/v1\/users\/me\/settings\/filters\/([^/]+)$/.exec(ruta)
      if (borrado && pedido.method === "DELETE") {
        const antes = casilla.filtros.length
        casilla.filtros = casilla.filtros.filter((filtro) => filtro.id !== borrado[1])
        return responder(respuesta, casilla.filtros.length === antes ? 404 : 204, {})
      }

      responder(respuesta, 404, { error: "ruta no simulada" })
    })()
  })

  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver))
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolver) => servidor.close(() => resolver()))
})

beforeEach(() => {
  casilla = { paginas: [], mensajes: {}, adjuntos: {}, filtros: [], respuestaAltaFiltro: null }
  pedidos = []
})

function bases() {
  return { baseGmail: base, baseOauth: base, baseCuentas: base }
}

/* ------------------------------------------------------------------ *
 *  La persistencia de mentira (lo único que se sustituye)
 * ------------------------------------------------------------------ */

function persistenciaFalsa(yaRegistrados: string[] = []) {
  const registrados = new Map<string, MensajeParaRegistrar>()
  const vencidas: string[] = []
  /** Los correos que la pasada le pasó a la carga automática (Sprint 17). */
  const ofrecidosAAutoCarga: CorreoRecienRegistrado[] = []
  for (const id of yaRegistrados) {
    registrados.set(id, { gmailMessageId: id } as MensajeParaRegistrar)
  }

  return {
    registrados,
    vencidas,
    ofrecidosAAutoCarga,
    dependencias: {
      obtenerAccessToken: async () => "ya29.token-de-prueba",
      yaProcesados: async (_userId: string, ids: string[]) =>
        new Set(ids.filter((id) => registrados.has(id))),
      registrar: async (datos: MensajeParaRegistrar) => {
        const nuevo = !registrados.has(datos.gmailMessageId)
        registrados.set(datos.gmailMessageId, datos)
        // Espeja el `ignoreDuplicates` real: si el correo ya estaba, el upsert
        // no devuelve ninguna fila y quien llama recibe `null`.
        return nuevo ? `fila-${datos.gmailMessageId}` : null
      },
      marcarVencida: async (userId: string) => {
        vencidas.push(userId)
      },
      // Interruptor APAGADO: el default del producto y el de todos los tests
      // de la 17.2, que tienen que seguir describiendo el mismo circuito.
      autoCargar: async (_userId: string, correos: readonly CorreoRecienRegistrado[]) => {
        ofrecidosAAutoCarga.push(...correos)
        return { ...RESULTADO_AUTO_VACIO }
      },
    },
  }
}

const CONEXION = { userId: "usuario-1", email: "maria@gmail.com", labelId: ETIQUETA }

/* ------------------------------------------------------------------ *
 *  El listado: la promesa de leer SOLO la etiqueta
 * ------------------------------------------------------------------ */

describe("listarMensajesDeEtiqueta", () => {
  beforeEach(() => {
    casilla.paginas = [{ ids: ["m1", "m2"], siguiente: null }]
  })

  it("manda labelIds y el Bearer, y NUNCA una búsqueda libre", async () => {
    const pagina = await listarMensajesDeEtiqueta(
      "ya29.access",
      { labelId: ETIQUETA, maxResults: 10 },
      bases(),
    )

    expect(pagina.ids).toEqual(["m1", "m2"])

    const pedido = pedidos.find((p) => p.ruta === "/gmail/v1/users/me/messages")
    expect(pedido?.autorizacion).toBe("Bearer ya29.access")
    expect(pedido?.query.get("labelIds")).toBe(ETIQUETA)
    // El compromiso de docs/minimizacion-datos.md §10.3, verificado:
    expect(pedido?.query.has("q")).toBe(false)
  })

  it("un 401 se traduce a permiso vencido, no a un error genérico", async () => {
    casilla.paginas = []
    // Sin páginas el handler devuelve 200 vacío; para el 401 se fuerza otra ruta.
    await expect(
      listarMensajesDeEtiqueta("ya29.access", { labelId: ETIQUETA }, { baseGmail: "http://127.0.0.1:1" }),
    ).rejects.toMatchObject({ codigo: "sin_conexion" })
  })
})

/* ------------------------------------------------------------------ *
 *  El barrido de punta a punta — el caso del encargo
 * ------------------------------------------------------------------ */

describe("barrido de punta a punta contra el Gmail de mentira", () => {
  beforeEach(() => {
    casilla.paginas = [{ ids: ["m-pdf", "m-imagen", "m-turno", "m-nada", "m-roto"], siguiente: null }]

    // 1) Estudio con PDF.
    casilla.mensajes["m-pdf"] = correoConPdf(
      "m-pdf",
      "Resultado de laboratorio",
      '"Laboratorio Austral" <resultados@lab-austral.com.ar>',
      "ATT_PDF",
    )

    // 2) Estudio con una foto (y un logo incrustado que NO cuenta).
    casilla.mensajes["m-imagen"] = {
      respuesta: {
        estado: 200,
        cuerpo: {
          id: "m-imagen",
          internalDate: "1786100000000",
          payload: {
            mimeType: "multipart/mixed",
            headers: encabezados({
              From: "Centro de Imágenes <imagenes@centro.com.ar>",
              Subject: "Su radiografía",
            }),
            parts: [
              { mimeType: "text/html", body: { data: b64("<p>Adjuntamos la placa.</p>") } },
              {
                mimeType: "image/png",
                filename: "logo.png",
                headers: encabezados({
                  "Content-ID": "<logo>",
                  "Content-Disposition": "inline",
                }),
                body: { attachmentId: "ATT_LOGO", size: 3000 },
              },
              {
                mimeType: "image/jpeg",
                filename: "radiografia.jpg",
                body: { attachmentId: "ATT_RX", size: 850000 },
              },
            ],
          },
        },
      },
    }

    // 3) Aviso de turno, sin adjuntos.
    casilla.mensajes["m-turno"] = {
      respuesta: {
        estado: 200,
        cuerpo: {
          id: "m-turno",
          internalDate: "1786200000000",
          payload: {
            mimeType: "text/plain",
            headers: encabezados({
              From: '"Clínica San Jorge" <turnos@sanjorge.com.ar>',
              Subject: "Turno asignado",
            }),
            body: {
              data: b64(
                "CLINICA SAN JORGE: Se asigna turno para ECOGRAFIA VESICAL el 14/07/2026 a las 09:45 hs.",
              ),
            },
          },
        },
      },
    }

    // 4) Nada aprovechable: una factura.
    casilla.mensajes["m-nada"] = {
      respuesta: {
        estado: 200,
        cuerpo: {
          id: "m-nada",
          internalDate: "1786300000000",
          payload: {
            mimeType: "text/plain",
            headers: encabezados({
              From: "facturacion@obrasocial.com.ar",
              Subject: "Su factura de julio",
            }),
            body: { data: b64("Su factura del mes ya está disponible en la web. Importe: $ 45.300.") },
          },
        },
      },
    }

    // 5) El que rompe: Google contesta 500 para ese mensaje.
    casilla.mensajes["m-roto"] = {
      respuesta: { estado: 500, cuerpo: { error: { message: "Backend Error" } } },
    }
  })

  it("una pasada deja 2 estudios, 1 turno, 1 descartado y 1 error aislado", async () => {
    const falsa = persistenciaFalsa()

    const resultado = await barrerConexion(CONEXION, {
      bases: bases(),
      dependencias: falsa.dependencias,
    })

    expect(resultado).toEqual({
      nuevos: 4,
      documentos: 2,
      turnos: 1,
      descartados: 1,
      errores: 1,
      vencida: false,
      hayMas: false,
      auto: RESULTADO_AUTO_VACIO,
    })

    // Con el interruptor apagado, la pasada automática no cargó nada — pero
    // igual se le ofrecieron los tres correos aprovechables (2 estudios + 1
    // turno). El descartado y el que falló NO: no hay nada que cargar de
    // ellos.
    expect(falsa.ofrecidosAAutoCarga).toHaveLength(3)
    expect(falsa.ofrecidosAAutoCarga.map((correo) => correo.clase).sort()).toEqual([
      "documento",
      "documento",
      "turno",
    ])

    // El que falló NO quedó registrado: la próxima pasada lo reintenta.
    expect(falsa.registrados.has("m-roto")).toBe(false)
    expect([...falsa.registrados.keys()].sort()).toEqual(["m-imagen", "m-nada", "m-pdf", "m-turno"])

    // Y cada uno quedó clasificado como corresponde.
    expect(falsa.registrados.get("m-pdf")?.clase).toBe("documento")
    expect(falsa.registrados.get("m-imagen")?.clase).toBe("documento")
    expect(falsa.registrados.get("m-turno")?.clase).toBe("turno")
    expect(falsa.registrados.get("m-turno")?.pareceTurno).toBe(true)
    expect(falsa.registrados.get("m-nada")?.clase).toBe("nada")
  })

  it("guarda METADATOS y ni una línea de cuerpo", async () => {
    const falsa = persistenciaFalsa()
    await barrerConexion(CONEXION, { bases: bases(), dependencias: falsa.dependencias })

    const turno = falsa.registrados.get("m-turno")
    expect(turno?.remitenteEmail).toBe("turnos@sanjorge.com.ar")
    expect(turno?.remitenteNombre).toBe("Clínica San Jorge")
    expect(turno?.asunto).toBe("Turno asignado")
    expect(turno?.fechaIso).toBe(new Date(1786200000000).toISOString())

    // Lo que NO está: el texto del correo, por ningún lado del objeto guardado.
    expect(JSON.stringify(turno)).not.toContain("ECOGRAFIA")
    expect(JSON.stringify(turno)).not.toContain("09:45")
  })

  it("del logo incrustado no queda ni el descriptor; de la foto sí", async () => {
    const falsa = persistenciaFalsa()
    await barrerConexion(CONEXION, { bases: bases(), dependencias: falsa.dependencias })

    const adjuntos = falsa.registrados.get("m-imagen")?.adjuntos ?? []
    expect(adjuntos.map((adjunto) => adjunto.filename)).toEqual(["radiografia.jpg"])
    expect(adjuntos[0].apto).toBe(true)
  })

  it("el dedup evita volver a bajar lo ya registrado", async () => {
    const falsa = persistenciaFalsa(["m-pdf", "m-imagen", "m-turno", "m-nada", "m-roto"])

    const resultado = await barrerConexion(CONEXION, {
      bases: bases(),
      dependencias: falsa.dependencias,
    })

    expect(resultado.nuevos).toBe(0)
    // Ni un `messages.get`: solo se listó.
    expect(pedidos.filter((p) => p.ruta.startsWith("/gmail/v1/users/me/messages/"))).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 *  Paginación, tandas y adjunto gigante
 * ------------------------------------------------------------------ */

describe("paginación y tandas", () => {
  it("encadena las páginas del listado hasta juntar lo que falta", async () => {
    casilla.paginas = [
      { ids: ["a1", "a2"], siguiente: "1" },
      { ids: ["a3"], siguiente: null },
    ]
    for (const id of ["a1", "a2", "a3"]) {
      casilla.mensajes[id] = correoConPdf(id, `Estudio ${id}`, "lab@x.com.ar", `ATT_${id}`)
    }

    const falsa = persistenciaFalsa()
    const resultado = await barrerConexion(CONEXION, {
      bases: bases(),
      dependencias: falsa.dependencias,
    })

    expect(resultado.nuevos).toBe(3)
    expect(resultado.hayMas).toBe(false)
    expect(pedidos.filter((p) => p.ruta === "/gmail/v1/users/me/messages")).toHaveLength(2)
  })

  it("corta en la tanda y avisa que quedó más para la próxima pasada", async () => {
    const ids = Array.from({ length: 6 }, (_, indice) => `t${indice}`)
    casilla.paginas = [{ ids, siguiente: null }]
    for (const id of ids) {
      casilla.mensajes[id] = correoConPdf(id, `Estudio ${id}`, "lab@x.com.ar", `ATT_${id}`)
    }

    const falsa = persistenciaFalsa()
    const resultado = await barrerConexion(CONEXION, {
      bases: bases(),
      limite: 2,
      dependencias: falsa.dependencias,
    })

    expect(resultado.nuevos).toBe(2)
    expect(resultado.hayMas).toBe(true)
    expect(falsa.registrados.size).toBe(2)
  })

  it("el tope por defecto es el declarado, no un número suelto", () => {
    expect(LIMITE_MENSAJES_POR_PASADA).toBe(15)
  })

  it("un adjunto de 40 MB se registra como no apto, con su motivo", async () => {
    casilla.paginas = [{ ids: ["m-grande"], siguiente: null }]
    casilla.mensajes["m-grande"] = {
      respuesta: {
        estado: 200,
        cuerpo: {
          id: "m-grande",
          internalDate: "1786000000000",
          payload: {
            headers: encabezados({ From: "imagenes@centro.com.ar", Subject: "Resonancia" }),
            parts: [
              {
                mimeType: "application/pdf",
                filename: "resonancia.pdf",
                body: { attachmentId: "ATT_BIG", size: 40 * 1024 * 1024 },
              },
            ],
          },
        },
      },
    }

    const falsa = persistenciaFalsa()
    const resultado = await barrerConexion(CONEXION, {
      bases: bases(),
      dependencias: falsa.dependencias,
    })

    // No hay adjunto APTO y el cuerpo está vacío: queda descartado solo, pero
    // el descriptor se guarda para poder explicarlo en pantalla.
    expect(resultado.documentos).toBe(0)
    expect(resultado.descartados).toBe(1)
    const adjuntos = falsa.registrados.get("m-grande")?.adjuntos ?? []
    expect(adjuntos[0]).toMatchObject({ apto: false, motivo: "demasiado_grande" })
  })

  it("una conexión sin etiqueta no barre NADA (no se cae a leer la casilla entera)", async () => {
    const falsa = persistenciaFalsa()
    const resultado = await barrerConexion(
      { ...CONEXION, labelId: "" },
      { bases: bases(), dependencias: falsa.dependencias },
    )

    expect(resultado.nuevos).toBe(0)
    expect(pedidos).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 *  El permiso que se muere a mitad de camino
 * ------------------------------------------------------------------ */

describe("invalid_grant y 401", () => {
  beforeEach(() => {
    casilla.paginas = [{ ids: ["v1", "v2", "v3"], siguiente: null }]
    casilla.mensajes["v1"] = correoConPdf("v1", "Primero", "lab@x.com.ar", "ATT_v1")
    // El segundo mata la sesión: Google contesta 401.
    casilla.mensajes["v2"] = {
      respuesta: { estado: 401, cuerpo: { error: { message: "Invalid Credentials" } } },
    }
    casilla.mensajes["v3"] = correoConPdf("v3", "Tercero", "lab@x.com.ar", "ATT_v3")
  })

  it("corta la pasada, marca la conexión vencida y conserva lo ya registrado", async () => {
    const falsa = persistenciaFalsa()

    const resultado = await barrerConexion(CONEXION, {
      bases: bases(),
      dependencias: falsa.dependencias,
    })

    expect(resultado.vencida).toBe(true)
    expect(resultado.nuevos).toBe(1)
    expect(resultado.hayMas).toBe(true)
    expect(falsa.vencidas).toEqual(["usuario-1"])
    // El primero quedó guardado; el tercero ni se intentó.
    expect([...falsa.registrados.keys()]).toEqual(["v1"])
  })

  it("si el token ya venía vencido, la pasada no llama a Gmail ni una vez", async () => {
    const falsa = persistenciaFalsa()
    const resultado = await barrerConexion(CONEXION, {
      bases: bases(),
      dependencias: {
        ...falsa.dependencias,
        obtenerAccessToken: async () => {
          throw new ErrorConexionGmailVencida()
        },
      },
    })

    expect(resultado.vencida).toBe(true)
    expect(pedidos).toHaveLength(0)
  })

  it("una conexión vencida NO deja sin barrido a las demás de la corrida", async () => {
    // Casilla limpia: el único correo es bueno. Lo que se está aislando acá es
    // el efecto de UNA conexión rota sobre las otras, no el 401 a mitad de
    // pasada (que es el caso de arriba).
    casilla.paginas = [{ ids: ["v1"], siguiente: null }]

    const falsa = persistenciaFalsa()

    const resumen = await barrerConexiones(
      [
        { userId: "usuario-vencido", email: "a@gmail.com", labelId: ETIQUETA },
        { userId: "usuario-sano", email: "b@gmail.com", labelId: ETIQUETA },
      ],
      {
        bases: bases(),
        dependencias: {
          ...falsa.dependencias,
          obtenerAccessToken: async (userId: string) => {
            if (userId === "usuario-vencido") throw new ErrorConexionGmailVencida()
            return "ya29.token"
          },
        },
      },
    )

    expect(resumen.conexiones).toBe(2)
    expect(resumen.vencidas).toBe(1)
    // Y la sana barrió de verdad, después de la que falló.
    expect(resumen.nuevos).toBe(1)
    expect(resumen.documentos).toBe(1)
    expect(resumen.conexionesConFallo).toBe(0)
  })
})

/* ------------------------------------------------------------------ *
 *  Del adjunto al pipeline de documentos
 * ------------------------------------------------------------------ */

describe("ingerirAdjuntoDeGmail — el puente al pipeline de siempre", () => {
  /** Un PDF de verdad: `ingestarDocumento` valida los magic bytes, no la extensión. */
  const PDF_REAL = Buffer.concat([
    Buffer.from("%PDF-1.4\n", "latin1"),
    Buffer.from("1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n", "latin1"),
  ])

  const correoRegistrado: MensajeRegistrado = {
    id: "11111111-1111-4111-8111-111111111111",
    gmailMessageId: "m-pdf",
    remitenteEmail: "resultados@lab-austral.com.ar",
    remitenteNombre: "Laboratorio Austral",
    asunto: "Resultado de laboratorio",
    clase: "documento",
    estado: "pendiente_revision",
    pareceTurno: false,
    adjuntos: [
      {
        attachmentId: "ATT_PDF",
        filename: "resultado.pdf",
        mimeType: "application/pdf",
        mimeDeclarado: "application/pdf",
        size: PDF_REAL.length,
        apto: true,
        motivo: null,
      },
    ],
    documentId: null,
    appointmentId: null,
  }

  /** Cliente de Supabase mínimo: registra lo que se subió y lo que se insertó. */
  function supabaseFalso() {
    const subidas: { bucket: string; path: string; tipo: string; bytes: number }[] = []
    const filas: Record<string, unknown>[] = []

    const cliente = {
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string, archivo: File, opciones: { contentType: string }) => {
            subidas.push({
              bucket,
              path,
              tipo: opciones.contentType,
              bytes: (await archivo.arrayBuffer()).byteLength,
            })
            return { error: null }
          },
        }),
      },
      // El `select(...).eq(...).eq(...).order(...).limit(...).maybeSingle()`
      // es el cotejo de huella de `lib/documentos/huella.ts` (hotfix, Sprint
      // 17 en vivo): este cliente falso siempre contesta "sin duplicado" -no
      // es lo que prueba este test, que es el PUENTE al pipeline- para que
      // `ingestarDocumento` siga de largo hasta el `insert` de siempre.
      from: () => ({
        select: () => {
          const encadenable = {
            eq: () => encadenable,
            order: () => encadenable,
            limit: () => encadenable,
            maybeSingle: async () => ({ data: null, error: null }),
          }
          return encadenable
        },
        insert: (fila: Record<string, unknown>) => {
          filas.push(fila)
          return {
            select: () => ({
              single: async () => ({
                data: { id: "22222222-2222-4222-8222-222222222222" },
                error: null,
              }),
            }),
          }
        },
      }),
    }

    return { cliente, subidas, filas }
  }

  beforeEach(() => {
    casilla.adjuntos["ATT_PDF"] = {
      estado: 200,
      cuerpo: { size: PDF_REAL.length, data: PDF_REAL.toString("base64url") },
    }
  })

  it("baja el adjunto y lo mete por `ingestarDocumento`, dejando el correo ingresado", async () => {
    const falso = supabaseFalso()
    const marcados: { correo: string; estado: string; documentId?: string }[] = []

    const resultado = await ingerirAdjuntoDeGmail({
      // El cliente falso implementa lo que `ingestarDocumento` usa de verdad.
      supabase: falso.cliente as never,
      userId: "usuario-1",
      perfilId: "660e8400-e29b-41d4-a716-446655440003",
      correoId: correoRegistrado.id,
      adjuntoId: "ATT_PDF",
      bases: bases(),
      dependencias: {
        obtenerAccessToken: async () => "ya29.token",
        obtenerCorreo: async () => correoRegistrado,
        marcarResuelto: async (_userId, correoId, resultado) => {
          marcados.push({ correo: correoId, ...resultado })
        },
      },
    })

    if (resultado.duplicado) throw new Error("No se esperaba un duplicado en este test")
    const { documento } = resultado

    // El documento quedó creado por el pipeline REAL, con su path
    // determinístico `{perfil}/{año}/{uuid}.pdf`.
    expect(documento.documentoId).toBe("22222222-2222-4222-8222-222222222222")
    expect(documento.mimeType).toBe("application/pdf")
    expect(falso.subidas).toHaveLength(1)
    expect(falso.subidas[0].path).toMatch(
      /^660e8400-e29b-41d4-a716-446655440003\/\d{4}\/[0-9a-f-]{36}\.pdf$/,
    )
    expect(falso.subidas[0].bytes).toBe(PDF_REAL.length)

    // Y la fila de `documents` entró como PENDIENTE de confirmar: sin
    // `confirmed_at`, con la categoría provisional, igual que una subida a mano,
    // y con su huella SHA-256 (hotfix de huella digital, Sprint 17 en vivo).
    expect(falso.filas[0]).toMatchObject({
      profile_id: "660e8400-e29b-41d4-a716-446655440003",
      title: "resultado",
      category: "other",
      mime_type: "application/pdf",
    })
    expect(falso.filas[0].content_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(falso.filas[0]).not.toHaveProperty("confirmed_at")

    expect(marcados).toEqual([
      {
        correo: correoRegistrado.id,
        estado: "ingresado",
        documentId: "22222222-2222-4222-8222-222222222222",
      },
    ])
  })

  it("un adjunto que no está en el correo no se baja", async () => {
    await expect(
      ingerirAdjuntoDeGmail({
        supabase: supabaseFalso().cliente as never,
        userId: "usuario-1",
        perfilId: "660e8400-e29b-41d4-a716-446655440003",
        correoId: correoRegistrado.id,
        adjuntoId: "ATT_INVENTADO",
        bases: bases(),
        dependencias: {
          obtenerAccessToken: async () => "ya29.token",
          obtenerCorreo: async () => correoRegistrado,
          marcarResuelto: async () => {},
        },
      }),
    ).rejects.toMatchObject({ codigo: "adjunto_no_disponible" })
  })

  it("un correo de otra cuenta no existe para esta acción", async () => {
    await expect(
      ingerirAdjuntoDeGmail({
        supabase: supabaseFalso().cliente as never,
        userId: "usuario-1",
        perfilId: "660e8400-e29b-41d4-a716-446655440003",
        correoId: "33333333-3333-4333-8333-333333333333",
        adjuntoId: "ATT_PDF",
        bases: bases(),
        dependencias: {
          obtenerAccessToken: async () => "ya29.token",
          obtenerCorreo: async () => null,
          marcarResuelto: async () => {},
        },
      }),
    ).rejects.toMatchObject({ codigo: "correo_no_encontrado" })
  })

  it("descargarAdjunto devuelve los bytes tal cual (base64url de ida y vuelta)", async () => {
    const bytes = await descargarAdjunto(
      "ya29.token",
      { mensajeId: "m-pdf", adjuntoId: "ATT_PDF" },
      bases(),
    )
    expect(Buffer.compare(bytes, PDF_REAL)).toBe(0)
  })
})

/* ------------------------------------------------------------------ *
 *  Filtros aprendidos
 * ------------------------------------------------------------------ */

describe("filtros por remitente", () => {
  it("crea la regla con addLabelIds y NADA más (no archiva ni borra)", async () => {
    const { filtro, yaExistia } = await crearFiltroPorRemitente(
      "ya29.token",
      { remitente: "Turnos@SanJorge.com.ar", labelId: ETIQUETA },
      bases(),
    )

    expect(yaExistia).toBe(false)
    expect(filtro.from).toBe("turnos@sanjorge.com.ar")
    expect(filtro.etiquetas).toEqual([ETIQUETA])

    const alta = pedidos.find(
      (p) => p.metodo === "POST" && p.ruta === "/gmail/v1/users/me/settings/filters",
    )
    const cuerpo = JSON.parse(alta?.cuerpo ?? "{}") as {
      criteria: Record<string, unknown>
      action: Record<string, unknown>
    }
    expect(cuerpo.criteria).toEqual({ from: "turnos@sanjorge.com.ar" })
    expect(cuerpo.action).toEqual({ addLabelIds: [ETIQUETA] })
    // Lo que NO puede aparecer nunca: nada que le esconda un correo a nadie.
    expect(cuerpo.action).not.toHaveProperty("removeLabelIds")
    expect(cuerpo.action).not.toHaveProperty("shouldTrash")
    expect(cuerpo.action).not.toHaveProperty("shouldMarkAsRead")
  })

  it("el filtro DUPLICADO no es un error: se relista y se reconoce el que ya estaba", async () => {
    casilla.filtros = [
      { id: "filtro_existente", criteria: { from: "turnos@sanjorge.com.ar" }, action: { addLabelIds: [ETIQUETA] } },
    ]
    casilla.respuestaAltaFiltro = {
      estado: 400,
      cuerpo: { error: { message: "Filter already exists" } },
    }

    const { filtro, yaExistia } = await crearFiltroPorRemitente(
      "ya29.token",
      { remitente: "turnos@sanjorge.com.ar", labelId: ETIQUETA },
      bases(),
    )

    expect(yaExistia).toBe(true)
    expect(filtro.id).toBe("filtro_existente")
  })

  it("un duplicado sin gemelo que lo explique SÍ es un error", async () => {
    casilla.respuestaAltaFiltro = { estado: 400, cuerpo: { error: { message: "Bad Request" } } }

    await expect(
      crearFiltroPorRemitente("ya29.token", { remitente: "x@y.com", labelId: ETIQUETA }, bases()),
    ).rejects.toMatchObject({ codigo: "respuesta_de_google" })
  })

  it("listar y borrar: el borrado de algo que ya no está no falla", async () => {
    casilla.filtros = [
      { id: "f1", criteria: { from: "a@b.com" }, action: { addLabelIds: [ETIQUETA] } },
    ]

    expect((await listarFiltros("ya29.token", bases())).map((f) => f.id)).toEqual(["f1"])

    await borrarFiltro("ya29.token", "f1", bases())
    expect(casilla.filtros).toHaveLength(0)

    // Segunda vez: Gmail contesta 404 y no pasa nada (la persona pudo haberlo
    // sacado desde su propio Gmail).
    await expect(borrarFiltro("ya29.token", "f1", bases())).resolves.toBeUndefined()
  })
})

/* ------------------------------------------------------------------ *
 *  Clasificación y la frase que ve la persona
 * ------------------------------------------------------------------ */

describe("clasificarMensaje", () => {
  it("el adjunto gana sobre el texto", () => {
    expect(clasificarMensaje(true, true)).toBe("documento")
    expect(clasificarMensaje(true, false)).toBe("documento")
  })

  it("sin adjunto, decide la heurística", () => {
    expect(clasificarMensaje(false, true)).toBe("turno")
    expect(clasificarMensaje(false, false)).toBe("nada")
  })
})

describe("fraseDeResultado", () => {
  const vacio = {
    nuevos: 0,
    documentos: 0,
    turnos: 0,
    descartados: 0,
    errores: 0,
    vencida: false,
    hayMas: false,
    auto: RESULTADO_AUTO_VACIO,
  }

  it("el caso del encargo, con el plural bien puesto", () => {
    expect(fraseDeResultado({ ...vacio, nuevos: 3, documentos: 2, turnos: 1 })).toBe(
      "3 correos nuevos: 2 estudios y 1 turno para revisar.",
    )
  })

  it("un solo estudio no dice «1 estudios»", () => {
    expect(fraseDeResultado({ ...vacio, nuevos: 1, documentos: 1 })).toBe(
      "1 correo nuevo: 1 estudio para revisar.",
    )
  })

  it("no cuenta los descartados como hallazgos", () => {
    expect(fraseDeResultado({ ...vacio, nuevos: 2, descartados: 2 })).toBe(
      "Miramos 2 correos nuevos y no había nada para sumar al historial.",
    )
  })

  it("sin nada nuevo, lo dice sin alarmar", () => {
    expect(fraseDeResultado(vacio)).toBe("No llegó nada nuevo a la etiqueta. Ya estabas al día.")
  })

  it("avisa que quedó más para la próxima tanda", () => {
    expect(fraseDeResultado({ ...vacio, nuevos: 2, documentos: 2, hayMas: true })).toContain(
      "Todavía quedan más",
    )
  })

  it("el permiso vencido tiene su propia frase, con la salida", () => {
    expect(fraseDeResultado({ ...vacio, vencida: true })).toContain("Volvé a conectarlo")
  })

  it("si todo falló, no finge que no llegó nada", () => {
    expect(fraseDeResultado({ ...vacio, errores: 2 })).toBe(
      "No pudimos leer los correos nuevos. Probá de nuevo en un rato.",
    )
  })

  /* --- Auto-carga (Sprint 17) --- */

  it("lo que entró solo se dice PRIMERO y con la palabra «solo»", () => {
    expect(
      fraseDeResultado({
        ...vacio,
        nuevos: 1,
        documentos: 1,
        auto: { ...RESULTADO_AUTO_VACIO, intentados: 1, cargados: 1, documentos: 1 },
      }),
    ).toBe("Cargamos 1 estudio solo. Ya está todo en el historial.")
  })

  it("no cuenta dos veces: lo cargado solo no queda además «para revisar»", () => {
    expect(
      fraseDeResultado({
        ...vacio,
        nuevos: 3,
        documentos: 2,
        turnos: 1,
        auto: { ...RESULTADO_AUTO_VACIO, intentados: 3, cargados: 1, documentos: 1, aRevision: 2 },
      }),
    ).toBe("Cargamos 1 estudio solo. 2 correos nuevos: 1 estudio y 1 turno para revisar.")
  })

  it("varios cargados solos van en plural", () => {
    expect(
      fraseDeResultado({
        ...vacio,
        nuevos: 2,
        documentos: 1,
        turnos: 1,
        auto: {
          ...RESULTADO_AUTO_VACIO,
          intentados: 2,
          cargados: 2,
          documentos: 1,
          turnos: 1,
        },
      }),
    ).toBe("Cargamos 1 estudio y 1 turno solos. Ya está todo en el historial.")
  })
})
