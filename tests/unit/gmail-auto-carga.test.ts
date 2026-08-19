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
  evaluarPendientesGmail,
  fraseDeEvaluacionPendientes,
  LIMITE_AUTO_POR_PASADA,
  LIMITE_EVALUAR_PENDIENTES_POR_TANDA,
  RESULTADO_EVALUAR_PENDIENTES_VACIO,
  type CorreoRecienRegistrado,
  type DependenciasAutoCarga,
  type DependenciasEvaluarPendientes,
  type ResultadoEvaluarPendientes,
} from "@/lib/gmail/auto-carga"
import type { ParametrosIngestaAutomatica } from "@/lib/documentos/ingesta-automatica"
import type { TurnoAutomaticoParaIngresar } from "@/lib/gmail/auto-ingesta-admin"
import type { MensajeParaRegistrar, PendienteSinEvaluar } from "@/lib/gmail/mensajes-admin"
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
  // Sprint 19: el lector nombra el estudio. `sugerirTitulo(...).detectado` -lo
  // que mira la compuerta- es `true` solo cuando este campo viene con algo que
  // no sea la etiqueta genérica de la categoría.
  titulo: "Análisis de sangre — glucemia y perfil lipídico",
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
  duplicadoSemantico?: "mismo_numero_orden" | "datos_identicos" | null
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
    buscarDuplicadoSemantico: async () => opciones.duplicadoSemantico ?? null,
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
    // título que NOMBRÓ el lector (Sprint 19; antes era el genérico compuesto
    // "Análisis de laboratorio — Laboratorio Central") — y SIN el nombre del
    // paciente, que no tiene dónde viajar.
    expect(espia.documentosCargados).toHaveLength(1)
    expect(espia.documentosCargados[0]).toMatchObject({
      userId: USUARIO,
      correoId: "fila-m-perfecto",
      perfilId: "perfil-roberto",
      titulo: "Análisis de sangre — glucemia y perfil lipídico",
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

  it("el documento no imprime su propia fecha (Sprint 19: el lector contesta null)", async () => {
    // La regla no cambia -sin fecha, a revisión humana, JAMÁS auto-carga-; lo
    // que cambia es que ahora el lector puede DECIR que no la encontró en vez
    // de inventar una fecha plausible que pasaba la compuerta sin que nadie la
    // mirara. Las dos formas de "no la sé" tienen que terminar igual.
    const { espia } = await correrConExtraccion({ ...EXTRACCION_PERFECTA, fecha: null })
    expect(espia.documentosCargados).toHaveLength(0)
    expect(espia.motivos[0].frase).toContain("la fecha")
  })

  it("no se pudo clasificar qué tipo de estudio es", async () => {
    const { espia } = await correrConExtraccion({ ...EXTRACCION_PERFECTA, categoria: "other" })
    expect(espia.documentosCargados).toHaveLength(0)
    expect(espia.motivos[0].frase).toContain("qué tipo de estudio es")
  })

  it("el lector no le puso nombre al estudio, y tampoco hay con qué componer uno", async () => {
    // Sprint 19: la compuerta mira `sugerirTitulo(...).detectado`, que ahora es
    // `true` solo cuando el lector NOMBRÓ el estudio. Sin nombre y sin
    // institución/especialidad/médico, el título que se guardaría sería
    // "Análisis de laboratorio" a secas: no distingue nada, y eso necesita una
    // persona delante.
    const { espia } = await correrConExtraccion({
      ...EXTRACCION_PERFECTA,
      titulo: "",
      institucion: "",
      especialidad: "",
      medico: "",
    })
    expect(espia.documentosCargados).toHaveLength(0)
    expect(espia.motivos[0].frase).toContain("un nombre que lo distinga")
  })

  it("el lector no le puso nombre, aunque SÍ haya institución: el genérico no alcanza", async () => {
    // Es el defecto medido: cinco documentos distintos llamados "Estudio por
    // imágenes — SANATORIO SAN JORGE S.R.L.". Si en pantalla hace falta una
    // persona para ponerle nombre, en la casilla de correo también.
    const { espia } = await correrConExtraccion({ ...EXTRACCION_PERFECTA, titulo: "" })
    expect(espia.documentosCargados).toHaveLength(0)
    expect(espia.motivos[0].frase).toContain("un nombre que lo distinga")
  })

  it("mismo laboratorio y mismo número de orden que un estudio ya confirmado (Capa 2): NO se carga solo", async () => {
    const espia = mundoFalso({ duplicadoSemantico: "mismo_numero_orden" })
    const resultado = await cargarSolosLosQueNoTienenDudas(
      USUARIO,
      [correoRegistrado(casilla.mensajes["m1"].cuerpo, "documento")],
      "ya29.token",
      { bases: bases(), dependencias: espia.deps, hoyIso: HOY },
    )

    expect(resultado.cargados).toBe(0)
    expect(resultado.aRevision).toBe(1)
    expect(espia.documentosCargados).toHaveLength(0)
    // La lectura con Gemini SÍ corrió: el cotejo semántico necesita la
    // extracción hecha, a diferencia de la huella (que corta ANTES).
    expect(espia.lecturasDeDocumento).toBe(1)
    expect(espia.motivos[0].frase).toContain("mismo número de orden")
  })

  it("todos los datos extraídos son exactamente iguales a un estudio ya confirmado (Capa 3): NO se carga solo", async () => {
    const espia = mundoFalso({ duplicadoSemantico: "datos_identicos" })
    const resultado = await cargarSolosLosQueNoTienenDudas(
      USUARIO,
      [correoRegistrado(casilla.mensajes["m1"].cuerpo, "documento")],
      "ya29.token",
      { bases: bases(), dependencias: espia.deps, hoyIso: HOY },
    )

    expect(resultado.cargados).toBe(0)
    expect(resultado.aRevision).toBe(1)
    expect(espia.documentosCargados).toHaveLength(0)
    expect(espia.motivos[0].frase).toContain("exactamente los mismos datos")
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

/* ------------------------------------------------------------------ *
 *  4. "Evaluar pendientes" (hotfix de duplicados semánticos): pasa
 *     correos YA REGISTRADOS -no "recién registrados" por el barrido- por
 *     la MISMA compuerta. Hallazgo real: 30 correos ya importados cuando
 *     se prendió el interruptor, ninguno evaluado retroactivamente.
 * ------------------------------------------------------------------ */

describe("evaluarPendientesGmail", () => {
  /** Un `PendienteSinEvaluar` de clase documento, con un adjunto que existe en `casilla.adjuntos`. */
  function pendienteDocumento(id: string, attachmentId = "ATT_1"): PendienteSinEvaluar {
    return {
      id,
      gmailMessageId: `gm-${id}`,
      asunto: "Resultados",
      remitenteEmail: "resultados@lab.com.ar",
      remitenteNombre: "Lab",
      fechaIso: "2026-08-15T00:00:00.000Z",
      clase: "documento",
      adjuntos: [
        {
          attachmentId,
          filename: "resultado.pdf",
          mimeType: "application/pdf",
          mimeDeclarado: "application/pdf",
          size: 24000,
          apto: true,
          motivo: null,
        },
      ],
    }
  }

  function pendienteTurno(id: string): PendienteSinEvaluar {
    return {
      id,
      gmailMessageId: `gm-${id}`,
      asunto: "Turno",
      remitenteEmail: "turnos@clinica.com.ar",
      remitenteNombre: "Turnos",
      fechaIso: "2026-08-15T00:00:00.000Z",
      clase: "turno",
      adjuntos: [],
    }
  }

  /** Extiende `mundoFalso` con lo que `evaluarPendientesGmail` necesita de más. */
  function mundoParaPendientes(opciones: Parameters<typeof mundoFalso>[0] & {
    pendientes?: PendienteSinEvaluar[]
    mensajeReobtenido?: MensajeParseado | null
  } = {}) {
    const base = mundoFalso(opciones)
    const pendientes = opciones.pendientes ?? []
    let llamadasListar = 0
    const deps: Partial<DependenciasEvaluarPendientes> = {
      ...base.deps,
      listarPendientes: async (_userId, limite) => {
        llamadasListar += 1
        return pendientes.slice(0, limite)
      },
      reobtenerMensajeCompleto: async () =>
        opciones.mensajeReobtenido !== undefined ? opciones.mensajeReobtenido : null,
    }
    return { ...base, deps, llamadasListar: () => llamadasListar }
  }

  it("un documento pendiente, nunca evaluado, se carga solo — igual que si el barrido lo viera de nuevo", async () => {
    casilla.adjuntos["ATT_1"] = { estado: 200, cuerpo: { size: 8, data: b64("%PDF-1.4") } }

    const mundo = mundoParaPendientes({ pendientes: [pendienteDocumento("correo-1")] })

    const resultado = await evaluarPendientesGmail(USUARIO, "ya29.token", {
      bases: bases(),
      dependencias: mundo.deps,
      hoyIso: HOY,
    })

    expect(resultado).toEqual<ResultadoEvaluarPendientes>({
      intentados: 1,
      cargados: 1,
      documentos: 1,
      turnos: 0,
      aRevision: 0,
      errores: 0,
      hayMas: false,
    })
    expect(mundo.documentosCargados).toHaveLength(1)
    expect(mundo.motivos).toHaveLength(0)
  })

  it("un turno pendiente necesita volver a pedirle el cuerpo a Gmail (nunca se persiste)", async () => {
    const cuerpoRefetch = parsearMensajeGmail(
      correoDeTurno(
        "gm-correo-2",
        "Turno",
        "Turno confirmado\nPaciente: GOMEZ ROBERTO\nFecha: 25/08/2026 a las 14:30",
      ).cuerpo,
    ) as MensajeParseado

    const mundo = mundoParaPendientes({
      pendientes: [pendienteTurno("correo-2")],
      mensajeReobtenido: cuerpoRefetch,
    })

    const resultado = await evaluarPendientesGmail(USUARIO, "ya29.token", {
      bases: bases(),
      dependencias: mundo.deps,
      hoyIso: HOY,
    })

    expect(resultado.cargados).toBe(1)
    expect(resultado.turnos).toBe(1)
    expect(mundo.turnosCargados).toHaveLength(1)
  })

  it("Gmail ya no tiene el mensaje del turno (borrado, o movió de casilla): queda con motivo genérico, no revienta la tanda", async () => {
    const mundo = mundoParaPendientes({
      pendientes: [pendienteTurno("correo-3")],
      mensajeReobtenido: null,
    })

    const resultado = await evaluarPendientesGmail(USUARIO, "ya29.token", {
      bases: bases(),
      dependencias: mundo.deps,
      hoyIso: HOY,
    })

    expect(resultado.errores).toBe(1)
    expect(resultado.cargados).toBe(0)
    expect(mundo.motivos[0].correoId).toBe("correo-3")
  })

  it("una duda (mismo criterio que el barrido) deja el correo con su motivo, sin cargarlo", async () => {
    casilla.adjuntos["ATT_1"] = { estado: 200, cuerpo: { size: 8, data: b64("%PDF-1.4") } }

    const mundo = mundoParaPendientes({
      pendientes: [pendienteDocumento("correo-4")],
      extraccion: { ...EXTRACCION_PERFECTA, paciente: "" },
    })

    const resultado = await evaluarPendientesGmail(USUARIO, "ya29.token", {
      bases: bases(),
      dependencias: mundo.deps,
      hoyIso: HOY,
    })

    expect(resultado.cargados).toBe(0)
    expect(resultado.aRevision).toBe(1)
    expect(mundo.motivos[0].frase).toContain("no dice a nombre de quién viene")
  })

  it("interruptor apagado (sin destino): no evalúa nada, ni siquiera lista los pendientes", async () => {
    const mundo = mundoParaPendientes({ destino: null, pendientes: [pendienteDocumento("correo-5")] })

    const resultado = await evaluarPendientesGmail(USUARIO, "ya29.token", {
      bases: bases(),
      dependencias: mundo.deps,
      hoyIso: HOY,
    })

    expect(resultado).toEqual(RESULTADO_EVALUAR_PENDIENTES_VACIO)
    expect(mundo.llamadasListar()).toBe(0)
  })

  it("sin ningún pendiente por evaluar: resultado vacío", async () => {
    const mundo = mundoParaPendientes({ pendientes: [] })

    const resultado = await evaluarPendientesGmail(USUARIO, "ya29.token", {
      bases: bases(),
      dependencias: mundo.deps,
      hoyIso: HOY,
    })

    expect(resultado).toEqual(RESULTADO_EVALUAR_PENDIENTES_VACIO)
  })

  it("la tanda respeta LIMITE_EVALUAR_PENDIENTES_POR_TANDA y marca hayMas", async () => {
    casilla.adjuntos["ATT_1"] = { estado: 200, cuerpo: { size: 8, data: b64("%PDF-1.4") } }

    const muchosMasQueElLimite = Array.from(
      { length: LIMITE_EVALUAR_PENDIENTES_POR_TANDA + 5 },
      (_, i) => pendienteDocumento(`correo-${i}`),
    )
    const mundo = mundoParaPendientes({ pendientes: muchosMasQueElLimite })

    const resultado = await evaluarPendientesGmail(USUARIO, "ya29.token", {
      bases: bases(),
      dependencias: mundo.deps,
      hoyIso: HOY,
    })

    expect(resultado.intentados).toBe(LIMITE_EVALUAR_PENDIENTES_POR_TANDA)
    expect(resultado.hayMas).toBe(true)
  })
})

describe("fraseDeEvaluacionPendientes", () => {
  function resultado(parcial: Partial<ResultadoEvaluarPendientes>): ResultadoEvaluarPendientes {
    return { ...RESULTADO_EVALUAR_PENDIENTES_VACIO, ...parcial }
  }

  it("nada por evaluar", () => {
    expect(fraseDeEvaluacionPendientes(resultado({}))).toBe("No había ningún correo pendiente sin evaluar.")
  })

  it("todo cargado solo", () => {
    expect(fraseDeEvaluacionPendientes(resultado({ intentados: 3, cargados: 3, documentos: 3 }))).toBe(
      "3 cargados solos.",
    )
  })

  it("el ejemplo textual del encargo: algunos cargados, algunos a revisión", () => {
    expect(
      fraseDeEvaluacionPendientes(
        resultado({ intentados: 8, cargados: 3, documentos: 3, aRevision: 5 }),
      ),
    ).toBe("3 cargados solos, 5 quedaron para vos con su motivo.")
  })

  it("un solo cargado y un solo a revisión: singular, no plural", () => {
    expect(
      fraseDeEvaluacionPendientes(resultado({ intentados: 2, cargados: 1, documentos: 1, aRevision: 1 })),
    ).toBe("1 cargado solo, 1 quedó para vos con su motivo.")
  })

  it("con errores, además de cargados y a revisión", () => {
    expect(
      fraseDeEvaluacionPendientes(
        resultado({ intentados: 3, cargados: 1, documentos: 1, aRevision: 1, errores: 1 }),
      ),
    ).toBe("1 cargado solo, 1 quedó para vos con su motivo, 1 no se pudo leer.")
  })

  it("hayMas agrega la invitación a tocar de nuevo", () => {
    expect(
      fraseDeEvaluacionPendientes(resultado({ intentados: 3, aRevision: 3, hayMas: true })),
    ).toBe("3 quedaron para vos con su motivo. Tocá «Evaluar pendientes» de nuevo para seguir.")
  })
})
