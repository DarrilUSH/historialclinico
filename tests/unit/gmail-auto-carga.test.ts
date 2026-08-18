/**
 * Test DE PUNTA A PUNTA de la carga automática (Sprint 17), contra el mismo
 * **Gmail de mentira** (`node:http` local) que usa `gmail-barrido.test.ts`.
 *
 * ## Qué se prueba de verdad acá
 *
 * No la compuerta -eso está en `gmail-auto-ingesta.test.ts`, sobre funciones
 * puras- sino el CIRCUITO: que el barrido junte los correos que acaba de
 * registrar, que la pasada automática baje el adjunto por HTTP real, que
 * coteje la huella antes de gastar una llamada al modelo, que le pregunte a la
 * compuerta, que llame a la RPC solo cuando no hay dudas y que, cuando las
 * hay, deje el motivo escrito en el correo.
 *
 * Lo único sustituido es lo que no se puede levantar en un test unitario: la
 * base (las RPC y las consultas de dedup), Storage y Gemini. **El HTTP contra
 * Gmail es real**, igual que en la 17.1 y la 17.2.
 *
 * ## Los cinco casos que pidió el encargo
 *
 * 1. Correo perfecto → se carga solo.
 * 2. Cada tipo de duda → queda a revisión, con su motivo.
 * 3. Duplicado → queda a revisión, y NI SIQUIERA se llama a Gemini.
 * 4. Interruptor apagado → no pasa absolutamente nada.
 * 5. Deshacer → cubierto en `scripts/test-rls.sql` BLOQUE 25, porque es
 *    borrado con la sesión de la persona y políticas de RLS: acá se prueba la
 *    mitad que sí vive en TypeScript (que la reversión limpie el registro).
 *
 *   npm run test
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { barrerConexion } from "@/lib/gmail/barrido"
import {
  cargarSolosLosQueNoTienenDudas,
  LIMITE_AUTO_POR_PASADA,
  type CorreoRecienRegistrado,
  type DependenciasAutoCarga,
} from "@/lib/gmail/auto-carga"
import type { ParametrosIngestaAutomatica } from "@/lib/documentos/ingesta-automatica"
import type { TurnoAutomaticoParaIngresar } from "@/lib/gmail/auto-ingesta-admin"
import type { MensajeParaRegistrar } from "@/lib/gmail/mensajes-admin"
import { parsearMensajeGmail, type MensajeParseado } from "@/lib/gmail/mensaje"
import type { DocumentoMedicoConPacienteExtraido } from "@/lib/gemini/schemas"
import type { ResultadoAnalisisMensaje } from "@/lib/turnos/construir-propuestas"

/* ------------------------------------------------------------------ *
 *  El Gmail de mentira
 * ------------------------------------------------------------------ */

interface Casilla {
  paginas: { ids: string[]; siguiente: string | null }[]
  mensajes: Record<string, { estado: number; cuerpo: unknown }>
  adjuntos: Record<string, { estado: number; cuerpo: unknown }>
}

let servidor: Server
let base = ""
let casilla: Casilla

const ETIQUETA = "Label_HM"
const USUARIO = "usuario-1"
const CONEXION = { userId: USUARIO, email: "maria@gmail.com", labelId: ETIQUETA }
const HOY = "2026-08-18"

function b64(texto: string): string {
  return Buffer.from(texto, "utf8").toString("base64url")
}

function encabezados(pares: Record<string, string>) {
  return Object.entries(pares).map(([name, value]) => ({ name, value }))
}

function responder(respuesta: ServerResponse, estado: number, cuerpo: unknown) {
  respuesta.writeHead(estado, { "Content-Type": "application/json; charset=utf-8" })
  respuesta.end(JSON.stringify(cuerpo))
}

/** Un correo con un PDF adjunto. */
function correoConPdf(id: string, asunto: string, adjuntoId: string) {
  return {
    estado: 200,
    cuerpo: {
      id,
      internalDate: "1786000000000",
      payload: {
        mimeType: "multipart/mixed",
        headers: encabezados({ From: "Lab <resultados@lab.com.ar>", Subject: asunto }),
        parts: [
          { mimeType: "text/plain", body: { data: b64("Adjuntamos el resultado.") } },
          {
            mimeType: "application/pdf",
            filename: "resultado.pdf",
            body: { attachmentId: adjuntoId, size: 24000 },
          },
        ],
      },
    },
  }
}

/** Un correo que es un aviso de turno (sin adjuntos). */
function correoDeTurno(id: string, asunto: string, cuerpo: string) {
  return {
    estado: 200,
    cuerpo: {
      id,
      internalDate: "1786000000000",
      payload: {
        mimeType: "text/plain",
        headers: encabezados({ From: "Turnos <turnos@clinica.com.ar>", Subject: asunto }),
        body: { data: b64(cuerpo) },
      },
    },
  }
}

beforeAll(async () => {
  servidor = createServer((pedido: IncomingMessage, respuesta: ServerResponse) => {
    const url = new URL(pedido.url ?? "/", "http://interno")
    const ruta = url.pathname

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

    const adjunto = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(ruta)
    if (adjunto) {
      const guardado = casilla.adjuntos[adjunto[2]]
      if (!guardado) return responder(respuesta, 404, { error: { message: "Not Found" } })
      return responder(respuesta, guardado.estado, guardado.cuerpo)
    }

    const mensaje = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(ruta)
    if (mensaje) {
      const guardado = casilla.mensajes[mensaje[1]]
      if (!guardado) return responder(respuesta, 404, { error: { message: "Not Found" } })
      return responder(respuesta, guardado.estado, guardado.cuerpo)
    }

    responder(respuesta, 404, { error: "ruta no simulada" })
  })

  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver))
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolver) => servidor.close(() => resolver()))
})

beforeEach(() => {
  casilla = { paginas: [], mensajes: {}, adjuntos: {} }
})

function bases() {
  return { baseGmail: base, baseOauth: base, baseCuentas: base }
}

/* ------------------------------------------------------------------ *
 *  La base, Storage y Gemini de mentira
 * ------------------------------------------------------------------ */

/** La extracción que devuelve Gemini para el caso perfecto. */
const EXTRACCION_PERFECTA: DocumentoMedicoConPacienteExtraido = {
  paciente: "GOMEZ, ROBERTO",
  fecha: "2026-08-15",
  especialidad: "Bioquímica",
  institucion: "Laboratorio Central",
  medico: "Dra. Pérez",
  resumen: "Análisis de sangre con la glucemia levemente elevada.",
  categoria: "laboratory",
  metricas: [],
}

const ANALISIS_TURNO_PERFECTO: ResultadoAnalisisMensaje = {
  relacion: "unico",
  explicacion: "Un solo turno",
  contradiccion: null,
  otrasPropuestas: [],
  propuestaPrincipal: {
    especialidad: "Cardiología",
    especialidadInferida: false,
    medico: "Dra. Pérez",
    esEstudioNoProfesional: false,
    dudaOrdenNombre: false,
    fecha: "2026-08-25",
    anioInferido: false,
    hora: "14:30",
    discrepanciaDiaSemana: false,
    diaSemanaTexto: "martes",
    lugarNombre: "Sanatorio San Jorge",
    lugarDireccion: "San Martín 123",
    lugarCiudad: "Ushuaia",
    lugarProvincia: "Tierra del Fuego",
    notasPreparacion: "",
    avisos: [],
    resumen: "25/08/2026 14:30 — Dra. Pérez",
  },
}

interface Espia {
  documentosCargados: ParametrosIngestaAutomatica[]
  turnosCargados: TurnoAutomaticoParaIngresar[]
  motivos: { correoId: string; frase: string }[]
  lecturasDeDocumento: number
  lecturasDeTurno: number
  deps: Partial<DependenciasAutoCarga>
}

/**
 * El mundo exterior, de mentira.
 *
 * `destino: null` simula el interruptor APAGADO. Cualquier otra cosa lo simula
 * encendido apuntando a ese perfil.
 */
function mundoFalso(opciones: {
  destino?: { perfilId: string; perfilNombre: string } | null
  huellaDuplicada?: boolean
  extraccion?: DocumentoMedicoConPacienteExtraido
  analisis?: ResultadoAnalisisMensaje
  resultadoCarga?: "creado" | "duplicado" | "ya_resuelto"
} = {}): Espia {
  const espia: Espia = {
    documentosCargados: [],
    turnosCargados: [],
    motivos: [],
    lecturasDeDocumento: 0,
    lecturasDeTurno: 0,
    deps: {},
  }

  const destino =
    opciones.destino === undefined
      ? { perfilId: "perfil-roberto", perfilNombre: "Roberto Gómez" }
      : opciones.destino

  const estado = opciones.resultadoCarga ?? "creado"

  espia.deps = {
    obtenerDestino: async () => destino,
    huellaYaCargada: async () => opciones.huellaDuplicada === true,
    otrosPendientes: async () => [],
    leerDocumento: async () => {
      espia.lecturasDeDocumento += 1
      return opciones.extraccion ?? EXTRACCION_PERFECTA
    },
    leerTurno: async () => {
      espia.lecturasDeTurno += 1
      return opciones.analisis ?? ANALISIS_TURNO_PERFECTO
    },
    cargarDocumento: async (datos) => {
      espia.documentosCargados.push(datos)
      return estado === "creado" ? { estado: "creado", id: "doc-nuevo" } : { estado }
    },
    cargarTurno: async (datos) => {
      espia.turnosCargados.push(datos)
      return estado === "creado" ? { estado: "creado", id: "turno-nuevo" } : { estado }
    },
    anotarMotivo: async (_userId, correoId, frase) => {
      espia.motivos.push({ correoId, frase })
    },
  }

  return espia
}

/** Persistencia del barrido. NO sustituye `autoCargar`: acá corre la de verdad. */
function persistenciaFalsa() {
  const registrados = new Map<string, MensajeParaRegistrar>()
  return {
    registrados,
    dependencias: {
      obtenerAccessToken: async () => "ya29.token-de-prueba",
      yaProcesados: async (_userId: string, ids: string[]) =>
        new Set(ids.filter((id) => registrados.has(id))),
      registrar: async (datos: MensajeParaRegistrar) => {
        const nuevo = !registrados.has(datos.gmailMessageId)
        registrados.set(datos.gmailMessageId, datos)
        return nuevo ? `fila-${datos.gmailMessageId}` : null
      },
      marcarVencida: async () => {},
    },
  }
}

/** Arma la entrada de la pasada automática sin pasar por el barrido entero. */
function correoRegistrado(crudo: unknown, clase: "documento" | "turno"): CorreoRecienRegistrado {
  const mensaje = parsearMensajeGmail(crudo) as MensajeParseado
  return { correoId: `fila-${mensaje.id}`, mensaje, clase }
}

/* ------------------------------------------------------------------ *
 *  1. El correo perfecto entra solo
 * ------------------------------------------------------------------ */

describe("el correo que se lee sin ninguna duda", () => {
  beforeEach(() => {
    casilla.paginas = [{ ids: ["m-perfecto"], siguiente: null }]
    casilla.mensajes["m-perfecto"] = correoConPdf("m-perfecto", "Resultados de laboratorio", "ATT_1")
    casilla.adjuntos["ATT_1"] = { estado: 200, cuerpo: { size: 8, data: b64("%PDF-1.4") } }
  })

  it("se carga solo, de punta a punta, en la misma pasada del barrido", async () => {
    const espia = mundoFalso()
    const persistencia = persistenciaFalsa()

    const resultado = await barrerConexion(CONEXION, {
      bases: bases(),
      dependencias: persistencia.dependencias,
      auto: { dependencias: espia.deps, hoyIso: HOY },
    })

    expect(resultado.nuevos).toBe(1)
    expect(resultado.auto).toEqual({
      intentados: 1,
      cargados: 1,
      documentos: 1,
      turnos: 0,
      aRevision: 0,
      errores: 0,
    })

    // Lo que se le pidió cargar a la base es lo que la extracción dijo, con el
    // título compuesto por `sugerirTitulo` — y SIN el nombre del paciente, que
    // no tiene dónde viajar.
    expect(espia.documentosCargados).toHaveLength(1)
    expect(espia.documentosCargados[0]).toMatchObject({
      userId: USUARIO,
      correoId: "fila-m-perfecto",
      perfilId: "perfil-roberto",
      titulo: "Análisis de laboratorio — Laboratorio Central",
      categoria: "laboratory",
      fecha: "2026-08-15",
    })
    expect(JSON.stringify(espia.documentosCargados[0])).not.toContain("GOMEZ")

    // Y no quedó ningún motivo escrito: no había nada que explicar.
    expect(espia.motivos).toHaveLength(0)
  })

  it("los bytes que se cargan son los que bajó de Gmail, no otros", async () => {
    const espia = mundoFalso()
    await cargarSolosLosQueNoTienenDudas(
      USUARIO,
      [correoRegistrado(casilla.mensajes["m-perfecto"].cuerpo, "documento")],
      "ya29.token",
      { bases: bases(), dependencias: espia.deps, hoyIso: HOY },
    )

    expect(Buffer.from(espia.documentosCargados[0].bytes).toString("utf8")).toBe("%PDF-1.4")
    expect(espia.documentosCargados[0].mimeDeclarado).toBe("application/pdf")
  })
})

/* ------------------------------------------------------------------ *
 *  2. Cada tipo de duda manda el correo a revisión
 * ------------------------------------------------------------------ */

describe("cada tipo de duda deja el correo a revisión, con su motivo", () => {
  beforeEach(() => {
    casilla.mensajes["m1"] = correoConPdf("m1", "Resultados", "ATT_1")
    casilla.adjuntos["ATT_1"] = { estado: 200, cuerpo: { size: 8, data: b64("%PDF-1.4") } }
  })

  async function correrConExtraccion(extraccion: DocumentoMedicoConPacienteExtraido) {
    const espia = mundoFalso({ extraccion })
    const resultado = await cargarSolosLosQueNoTienenDudas(
      USUARIO,
      [correoRegistrado(casilla.mensajes["m1"].cuerpo, "documento")],
      "ya29.token",
      { bases: bases(), dependencias: espia.deps, hoyIso: HOY },
    )
    return { espia, resultado }
  }

  it("el estudio es de otra persona de la familia", async () => {
    const { espia, resultado } = await correrConExtraccion({
      ...EXTRACCION_PERFECTA,
      paciente: "GOMEZ MARIA ELENA",
    })

    expect(resultado.cargados).toBe(0)
    expect(resultado.aRevision).toBe(1)
    expect(espia.documentosCargados).toHaveLength(0)
    expect(espia.motivos[0].frase).toContain("el nombre que figura no es el del perfil elegido")
  })

  it("el documento no dice a nombre de quién viene", async () => {
    const { espia } = await correrConExtraccion({ ...EXTRACCION_PERFECTA, paciente: "" })
    expect(espia.documentosCargados).toHaveLength(0)
    expect(espia.motivos[0].frase).toContain("no dice a nombre de quién viene")
  })

  it("no se pudo leer la fecha", async () => {
    const { espia } = await correrConExtraccion({ ...EXTRACCION_PERFECTA, fecha: "" })
    expect(espia.documentosCargados).toHaveLength(0)
    expect(espia.motivos[0].frase).toContain("la fecha")
  })

  it("no se pudo clasificar qué tipo de estudio es", async () => {
    const { espia } = await correrConExtraccion({ ...EXTRACCION_PERFECTA, categoria: "other" })
    expect(espia.documentosCargados).toHaveLength(0)
    expect(espia.motivos[0].frase).toContain("qué tipo de estudio es")
  })

  it("no hay institución, ni especialidad, ni médico", async () => {
    const { espia } = await correrConExtraccion({
      ...EXTRACCION_PERFECTA,
      institucion: "",
      especialidad: "",
      medico: "",
    })
    expect(espia.documentosCargados).toHaveLength(0)
    expect(espia.motivos[0].frase).toContain("de qué institución")
  })

  it("el correo trae DOS archivos importables: cuál es una decisión humana", async () => {
    const dosAdjuntos = {
      estado: 200,
      cuerpo: {
        id: "m-dos",
        internalDate: "1786000000000",
        payload: {
          mimeType: "multipart/mixed",
          headers: encabezados({ From: "Lab <lab@x.com>", Subject: "Dos estudios" }),
          parts: [
            { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "ATT_1", size: 100 } },
            { mimeType: "application/pdf", filename: "b.pdf", body: { attachmentId: "ATT_2", size: 200 } },
          ],
        },
      },
    }
    const espia = mundoFalso()
    await cargarSolosLosQueNoTienenDudas(
      USUARIO,
      [correoRegistrado(dosAdjuntos.cuerpo, "documento")],
      "ya29.token",
      { bases: bases(), dependencias: espia.deps, hoyIso: HOY },
    )

    expect(espia.documentosCargados).toHaveLength(0)
    expect(espia.lecturasDeDocumento).toBe(0)
    expect(espia.motivos[0].frase).toContain("más de un archivo")
  })

  it("el aviso de turno tenía un dato supuesto", async () => {
    const cuerpo = "Turno confirmado\nPaciente: GOMEZ ROBERTO\nFecha: 25/08 a las 14:30"
    casilla.mensajes["m-turno"] = correoDeTurno("m-turno", "Turno", cuerpo)

    const espia = mundoFalso({
      analisis: {
        ...ANALISIS_TURNO_PERFECTO,
        propuestaPrincipal: {
          ...ANALISIS_TURNO_PERFECTO.propuestaPrincipal,
          anioInferido: true,
          avisos: ["El mensaje no decía el año — asumimos 2026. Confirmalo."],
        },
      },
    })

    await cargarSolosLosQueNoTienenDudas(
      USUARIO,
      [correoRegistrado(casilla.mensajes["m-turno"].cuerpo, "turno")],
      "ya29.token",
      { bases: bases(), dependencias: espia.deps, hoyIso: HOY },
    )

    expect(espia.turnosCargados).toHaveLength(0)
    expect(espia.motivos[0].frase).toContain("faltaban datos del turno")
  })
})

/* ------------------------------------------------------------------ *
 *  3. El duplicado ni siquiera llega a Gemini
 * ------------------------------------------------------------------ */

describe("el duplicado", () => {
  beforeEach(() => {
    casilla.mensajes["m1"] = correoConPdf("m1", "Resultados (reenvío)", "ATT_1")
    casilla.adjuntos["ATT_1"] = { estado: 200, cuerpo: { size: 8, data: b64("%PDF-1.4") } }
  })

  it("va a revisión SIN gastar una llamada al modelo", async () => {
    const espia = mundoFalso({ huellaDuplicada: true })

    const resultado = await cargarSolosLosQueNoTienenDudas(
      USUARIO,
      [correoRegistrado(casilla.mensajes["m1"].cuerpo, "documento")],
      "ya29.token",
      { bases: bases(), dependencias: espia.deps, hoyIso: HOY },
    )

    expect(resultado.cargados).toBe(0)
    expect(resultado.aRevision).toBe(1)
    expect(espia.documentosCargados).toHaveLength(0)
    // El cotejo de huella corre ANTES que Gemini: no tiene sentido leer un
    // archivo que ya sabemos que está cargado.
    expect(espia.lecturasDeDocumento).toBe(0)
    expect(espia.motivos[0].frase).toContain("ya tenías cargado un archivo idéntico")
  })

  it("si la RPC lo rechaza por duplicado en la carrera, tampoco se cuenta como cargado", async () => {
    const espia = mundoFalso({ resultadoCarga: "duplicado" })

    const resultado = await cargarSolosLosQueNoTienenDudas(
      USUARIO,
      [correoRegistrado(casilla.mensajes["m1"].cuerpo, "documento")],
      "ya29.token",
      { bases: bases(), dependencias: espia.deps, hoyIso: HOY },
    )

    expect(resultado.cargados).toBe(0)
    expect(resultado.aRevision).toBe(1)
    expect(espia.motivos[0].frase).toContain("ya tenías cargado un archivo idéntico")
  })
})

/* ------------------------------------------------------------------ *
 *  4. Interruptor apagado: no pasa NADA
 * ------------------------------------------------------------------ */

describe("con la carga automática apagada", () => {
  beforeEach(() => {
    casilla.paginas = [{ ids: ["m-perfecto"], siguiente: null }]
    casilla.mensajes["m-perfecto"] = correoConPdf("m-perfecto", "Resultados", "ATT_1")
    casilla.adjuntos["ATT_1"] = { estado: 200, cuerpo: { size: 8, data: b64("%PDF-1.4") } }
  })

  it("el barrido se comporta EXACTAMENTE como la 17.2", async () => {
    const espia = mundoFalso({ destino: null })
    const persistencia = persistenciaFalsa()

    const resultado = await barrerConexion(CONEXION, {
      bases: bases(),
      dependencias: persistencia.dependencias,
      auto: { dependencias: espia.deps, hoyIso: HOY },
    })

    // El correo se registró igual: eso es lo que impide que se pierda.
    expect(resultado.nuevos).toBe(1)
    expect(resultado.documentos).toBe(1)
    expect(persistencia.registrados.has("m-perfecto")).toBe(true)

    // Pero no se bajó ningún byte, no se llamó al modelo, no se cargó nada y
    // no se escribió ningún motivo.
    expect(resultado.auto).toEqual({
      intentados: 0,
      cargados: 0,
      documentos: 0,
      turnos: 0,
      aRevision: 0,
      errores: 0,
    })
    expect(espia.lecturasDeDocumento).toBe(0)
    expect(espia.documentosCargados).toHaveLength(0)
    expect(espia.motivos).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 *  5. Robustez
 * ------------------------------------------------------------------ */

describe("robustez de la pasada automática", () => {
  it("un correo que explota no arrastra a los demás, y queda con su motivo", async () => {
    casilla.mensajes["m-ok"] = correoConPdf("m-ok", "Bueno", "ATT_OK")
    casilla.mensajes["m-roto"] = correoConPdf("m-roto", "Roto", "ATT_QUE_NO_EXISTE")
    casilla.adjuntos["ATT_OK"] = { estado: 200, cuerpo: { size: 8, data: b64("%PDF-1.4") } }

    const espia = mundoFalso()
    const resultado = await cargarSolosLosQueNoTienenDudas(
      USUARIO,
      [
        correoRegistrado(casilla.mensajes["m-roto"].cuerpo, "documento"),
        correoRegistrado(casilla.mensajes["m-ok"].cuerpo, "documento"),
      ],
      "ya29.token",
      { bases: bases(), dependencias: espia.deps, hoyIso: HOY },
    )

    expect(resultado.errores).toBe(1)
    expect(resultado.cargados).toBe(1)
    expect(espia.documentosCargados).toHaveLength(1)
    expect(espia.motivos[0].frase).toContain("no pudimos leerlo automáticamente")
  })

  it("una pasada no intenta más de LIMITE_AUTO_POR_PASADA correos", async () => {
    casilla.adjuntos["ATT_1"] = { estado: 200, cuerpo: { size: 8, data: b64("%PDF-1.4") } }
    const correos: CorreoRecienRegistrado[] = []
    for (let i = 0; i < LIMITE_AUTO_POR_PASADA + 2; i += 1) {
      casilla.mensajes[`m${i}`] = correoConPdf(`m${i}`, `Estudio ${i}`, "ATT_1")
      correos.push(correoRegistrado(casilla.mensajes[`m${i}`].cuerpo, "documento"))
    }

    const espia = mundoFalso()
    const resultado = await cargarSolosLosQueNoTienenDudas(USUARIO, correos, "ya29.token", {
      bases: bases(),
      dependencias: espia.deps,
      hoyIso: HOY,
    })

    expect(resultado.intentados).toBe(LIMITE_AUTO_POR_PASADA)
    expect(espia.documentosCargados).toHaveLength(LIMITE_AUTO_POR_PASADA)
  })

  it("un correo que otra pasada ya registró no se intenta cargar (replay)", async () => {
    casilla.paginas = [{ ids: ["m-perfecto"], siguiente: null }]
    casilla.mensajes["m-perfecto"] = correoConPdf("m-perfecto", "Resultados", "ATT_1")
    casilla.adjuntos["ATT_1"] = { estado: 200, cuerpo: { size: 8, data: b64("%PDF-1.4") } }

    const espia = mundoFalso()
    const persistencia = persistenciaFalsa()

    // Primera pasada: lo registra y lo carga.
    await barrerConexion(CONEXION, {
      bases: bases(),
      dependencias: persistencia.dependencias,
      auto: { dependencias: espia.deps, hoyIso: HOY },
    })
    expect(espia.documentosCargados).toHaveLength(1)

    // Segunda pasada sobre la MISMA casilla: el dedup lo saltea antes incluso
    // de bajar el mensaje, así que la carga automática no lo vuelve a ver.
    const segunda = await barrerConexion(CONEXION, {
      bases: bases(),
      dependencias: persistencia.dependencias,
      auto: { dependencias: espia.deps, hoyIso: HOY },
    })

    expect(segunda.nuevos).toBe(0)
    expect(segunda.auto.intentados).toBe(0)
    expect(espia.documentosCargados).toHaveLength(1)
  })
})
