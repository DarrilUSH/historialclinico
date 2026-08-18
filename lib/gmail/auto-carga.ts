import "server-only"

/**
 * LA PASADA AUTOMÁTICA: lo que el barrido hace de más cuando el interruptor
 * está encendido (Sprint 17, auto-carga sin dudas).
 *
 * ## Qué cambia respecto de la 17.2, y qué no
 *
 * Con el interruptor **APAGADO** —que es el default, y el estado de toda
 * conexión que ya existía— este módulo no se ejecuta ni una línea. El barrido
 * es exactamente el de la 17.2: lista la etiqueta, registra metadatos, no baja
 * ni un byte, no llama a Gemini, y espera a una persona.
 *
 * Con el interruptor **ENCENDIDO**, y solo para esa conexión, el barrido hace
 * además esto, por cada correo nuevo que acaba de registrar:
 *
 *   1. Baja el adjunto (o toma el cuerpo que ya tiene en memoria).
 *   2. Se lo manda a Gemini —**este es el cambio de contrato de privacidad**,
 *      pedido explícitamente por el usuario y declarado en
 *      `docs/minimizacion-datos.md` §10.7—.
 *   3. Le pregunta a la compuerta (`lib/gmail/auto-ingesta.ts`) si hay alguna
 *      duda.
 *   4. Si no hay NINGUNA, lo carga por la RPC del camino automático. Si hay
 *      aunque sea una, deja el correo pendiente **con el motivo escrito**, que
 *      es lo que la bandeja le muestra a la persona.
 *
 * ## Las tres razones por las que una pasada automática no puede ser larga
 *
 * Corre dentro de la misma función serverless del plan gratuito que ya corría
 * el barrido, y ahora cada correo cuesta una descarga (hasta 25 MB), una
 * llamada a Gemini (hasta 30 s más un reintento) y una subida. Por eso
 * `LIMITE_AUTO_POR_PASADA` es chico y deliberadamente MUCHO menor que
 * `LIMITE_MENSAJES_POR_PASADA`: el registro de metadatos de los 15 sigue
 * ocurriendo -eso es barato y es lo que impide que un correo se pierda-, pero
 * solo los primeros se intentan cargar solos. Los demás quedan en la bandeja,
 * exactamente como antes de esta función, y la persona los resuelve de un
 * toque. Preferir eso a una corrida que se corta a la mitad no es una
 * concesión: una pasada que muere por timeout deja correos a medio procesar,
 * y este circuito escribe en el historial médico de alguien.
 *
 * ## Un correo que explota no arrastra a los demás
 *
 * Misma regla de robustez que `barrerConexion`: cada correo va en su propio
 * `try`. Si Gemini falla, si el adjunto no se puede bajar, si la RPC rechaza,
 * el correo simplemente **queda pendiente en la bandeja** —que es el
 * comportamiento de siempre— y la pasada sigue. La auto-carga es una mejora
 * sobre el circuito manual, nunca un reemplazo que pueda dejarlo sin funcionar.
 *
 * ## Inyección de dependencias
 *
 * Las llamadas HTTP a GMAIL son las reales (los tests las apuntan a un servidor
 * `node:http` local con `bases`, patrón 17.1/17.2). Lo que se sustituye es lo
 * que no se puede levantar en un test unitario: la base, Storage y Gemini.
 */

import { ingestarDocumentoAutomatico, ErrorIngestaAutomatica } from "@/lib/documentos/ingesta-automatica"
import { calcularHuellaSha256 } from "@/lib/documentos/huella"
import { sugerirTitulo } from "@/lib/documentos/sugerir-titulo"
import { extraerJson } from "@/lib/gemini/client"
import { PROMPT_DOCUMENTO_MEDICO_CON_PACIENTE } from "@/lib/gemini/prompt-documento"
import {
  SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE,
  type DocumentoMedicoConPacienteExtraido,
} from "@/lib/gemini/schemas"
import {
  evaluarDocumentoParaAutoCarga,
  evaluarTurnoParaAutoCarga,
  fraseDeMotivos,
  type MotivoRevision,
} from "@/lib/gmail/auto-ingesta"
import {
  anotarMotivoDeRevision,
  ingresarTurnoAutomatico,
  obtenerDestinoAutoIngesta,
  type DestinoAutoIngesta,
  type ResultadoIngresoAutomatico,
} from "@/lib/gmail/auto-ingesta-admin"
import { emparejarPorNombreYTamano, type CorreoParaDeteccion } from "@/lib/gmail/deteccion-duplicados"
import { descargarAdjunto, type OpcionesBases } from "@/lib/gmail/google-api"
import type { MensajeParseado } from "@/lib/gmail/mensaje"
import { huellaYaCargadaEnPerfil, otrosPendientesConAdjuntos } from "@/lib/gmail/pendientes-admin"
import { analizarMensajeTurno } from "@/lib/turnos/analizar-mensaje"
import { combinarFechaHoraUshuaia, hoyIsoUshuaia } from "@/lib/turnos/fecha"
import { validarExtraccionConPaciente } from "@/lib/validacion/documento.schema"

const PREFIJO = "[gmail-auto]"

/**
 * Cuántos correos por pasada y por conexión se intentan cargar solos.
 *
 * Tres. Cada uno puede costar una descarga de 25 MB, una llamada a Gemini de
 * hasta 30 s con un reintento, y una subida a Storage: tres es lo que entra con
 * holgura en el presupuesto de una función serverless del plan gratuito, y
 * cubre de sobra un día normal —una familia no recibe tres estudios por media
 * hora—. Lo que sobre queda en la bandeja para revisar a mano, como hasta hoy,
 * y la pantalla lo dice.
 */
export const LIMITE_AUTO_POR_PASADA = 3

/** Lo que hizo la pasada automática de UNA conexión. */
export interface ResultadoAutoCarga {
  /** Correos que se intentaron cargar solos. */
  intentados: number
  /** De esos, cuántos entraron. */
  cargados: number
  /** De los cargados, cuántos eran estudios. */
  documentos: number
  /** De los cargados, cuántos eran turnos. */
  turnos: number
  /** Correos que la compuerta mandó a revisión humana (con su motivo anotado). */
  aRevision: number
  /** Correos donde algo falló (Gemini, la descarga, la RPC): quedan pendientes. */
  errores: number
}

export const RESULTADO_AUTO_VACIO: ResultadoAutoCarga = {
  intentados: 0,
  cargados: 0,
  documentos: 0,
  turnos: 0,
  aRevision: 0,
  errores: 0,
}

/** Todo lo que la pasada automática necesita del mundo exterior. */
export interface DependenciasAutoCarga {
  obtenerDestino: (userId: string) => Promise<DestinoAutoIngesta | null>
  /** ¿El perfil ya tiene un documento con esta huella? */
  huellaYaCargada: (perfilId: string, huella: string) => Promise<boolean>
  /** Los OTROS correos pendientes de la cuenta, con sus adjuntos, para la marca de "posible duplicado". */
  otrosPendientes: (userId: string, exceptoCorreoId: string) => Promise<CorreoParaDeteccion[]>
  /** Lee un documento con Gemini, pidiéndole además a nombre de quién está. */
  leerDocumento: (
    bytes: Uint8Array,
    mimeType: string,
  ) => Promise<DocumentoMedicoConPacienteExtraido>
  /** Analiza un aviso de turno con Gemini (el analizador de la tarea 16.4). */
  leerTurno: typeof analizarMensajeTurno
  /** Sube el archivo y crea el documento, atómicamente. */
  cargarDocumento: typeof ingestarDocumentoAutomatico
  /** Crea el turno, atómicamente. */
  cargarTurno: typeof ingresarTurnoAutomatico
  /** Deja escrito por qué un correo quedó para revisar. */
  anotarMotivo: (userId: string, correoId: string, frase: string) => Promise<void>
}

/**
 * La lectura REAL de un documento con Gemini, para el camino automático.
 *
 * Usa el prompt y el schema DERIVADOS (`…_CON_PACIENTE`), que son los del
 * camino de siempre más la pregunta de a nombre de quién está el documento.
 * Ni el nombre ni la respuesta cruda se loguean nunca: si la validación falla,
 * lo que se registra son los mensajes de Zod, que describen la estructura y no
 * el contenido (`docs/minimizacion-datos.md` §6).
 */
async function leerDocumentoConGemini(
  bytes: Uint8Array,
  mimeType: string,
): Promise<DocumentoMedicoConPacienteExtraido> {
  const crudo = await extraerJson<unknown>({
    prompt: PROMPT_DOCUMENTO_MEDICO_CON_PACIENTE,
    media: { mimeType, data: Buffer.from(bytes).toString("base64") },
    schema: SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE,
  })

  const validacion = validarExtraccionConPaciente(crudo)
  if (!validacion.ok) {
    throw new Error(`La lectura automática no cumple el formato: ${validacion.errores.join(" | ")}`)
  }

  return validacion.datos
}

const DEPENDENCIAS_REALES: DependenciasAutoCarga = {
  obtenerDestino: obtenerDestinoAutoIngesta,
  huellaYaCargada: huellaYaCargadaEnPerfil,
  otrosPendientes: otrosPendientesConAdjuntos,
  leerDocumento: leerDocumentoConGemini,
  leerTurno: analizarMensajeTurno,
  cargarDocumento: ingestarDocumentoAutomatico,
  cargarTurno: ingresarTurnoAutomatico,
  anotarMotivo: anotarMotivoDeRevision,
}

export interface OpcionesAutoCarga {
  bases?: OpcionesBases
  dependencias?: Partial<DependenciasAutoCarga>
  /** Hoy en `YYYY-MM-DD`, hora de Ushuaia. Inyectable para tests deterministas. */
  hoyIso?: string
}

/** Un correo recién registrado, listo para que la pasada automática lo mire. */
export interface CorreoRecienRegistrado {
  /** `gmail_messages.id` — la fila, no el id de Gmail. */
  correoId: string
  mensaje: MensajeParseado
  /** `documento` o `turno`. Los de clase `nada` no llegan acá. */
  clase: "documento" | "turno"
}

/**
 * Intenta cargar solo UN correo. Devuelve los motivos por los que no se pudo
 * (vacío = se cargó), o lanza si algo falló de verdad.
 */
async function intentarUno(
  userId: string,
  destino: DestinoAutoIngesta,
  entrada: CorreoRecienRegistrado,
  deps: DependenciasAutoCarga,
  opciones: OpcionesAutoCarga,
  accessToken: string,
  hoyIso: string,
): Promise<{ cargado: boolean; tipo: "documento" | "turno"; motivos: MotivoRevision[] }> {
  if (entrada.clase === "turno") {
    return intentarTurno(userId, destino, entrada, deps, hoyIso)
  }
  return intentarDocumento(userId, destino, entrada, deps, opciones, accessToken, hoyIso)
}

async function intentarDocumento(
  userId: string,
  destino: DestinoAutoIngesta,
  entrada: CorreoRecienRegistrado,
  deps: DependenciasAutoCarga,
  opciones: OpcionesAutoCarga,
  accessToken: string,
  hoyIso: string,
): Promise<{ cargado: boolean; tipo: "documento"; motivos: MotivoRevision[] }> {
  const aptos = entrada.mensaje.adjuntos.filter((adjunto) => adjunto.apto && adjunto.mimeType)

  // Más de un adjunto apto es una DECISIÓN (¿cuál de los dos es el estudio?, ¿o
  // son dos?), y `gmail_messages` solo puede apuntar a un documento. Decidir
  // por la persona acá sería inventar; se manda a revisión, donde ella ve los
  // dos y elige.
  if (aptos.length !== 1) {
    return { cargado: false, tipo: "documento", motivos: ["varios_adjuntos"] }
  }

  const adjunto = aptos[0]

  const bytes = new Uint8Array(
    await descargarAdjunto(
      accessToken,
      { mensajeId: entrada.mensaje.id, adjuntoId: adjunto.attachmentId },
      opciones.bases,
    ),
  )

  // El cotejo de huella va ANTES de Gemini: si el archivo ya está cargado, no
  // tiene sentido gastar una llamada al modelo para después descartarlo.
  const huella = calcularHuellaSha256(bytes)
  const huellaDuplicada = await deps.huellaYaCargada(destino.perfilId, huella)

  const otros = await deps.otrosPendientes(userId, entrada.correoId)
  const emparejados = emparejarPorNombreYTamano([
    {
      id: entrada.correoId,
      adjuntos: entrada.mensaje.adjuntos.map((a) => ({
        attachmentId: a.attachmentId,
        filename: a.filename,
        size: a.size,
        apto: a.apto,
      })),
    },
    ...otros,
  ])
  const marcadoPosibleDuplicado = emparejados.has(`${entrada.correoId}:${adjunto.attachmentId}`)

  if (huellaDuplicada || marcadoPosibleDuplicado) {
    // Se corta acá, sin llamar a Gemini: los motivos ya alcanzan para que el
    // correo vaya a revisión, y el resto de la compuerta no puede cambiarlo.
    const motivos: MotivoRevision[] = []
    if (huellaDuplicada) motivos.push("duplicado_exacto")
    if (marcadoPosibleDuplicado) motivos.push("posible_duplicado")
    return { cargado: false, tipo: "documento", motivos }
  }

  const extraccion = await deps.leerDocumento(bytes, adjunto.mimeType as string)
  const titulo = sugerirTitulo(extraccion)

  const veredicto = evaluarDocumentoParaAutoCarga({
    pacienteDetectado: extraccion.paciente,
    nombrePerfilDestino: destino.perfilNombre,
    fecha: extraccion.fecha,
    categoria: extraccion.categoria,
    tituloDetectado: titulo.detectado,
    huellaDuplicada: false,
    marcadoPosibleDuplicado: false,
    hoyIso,
  })

  if (!veredicto.sinDudas) {
    return { cargado: false, tipo: "documento", motivos: veredicto.motivos }
  }

  const resultado = await deps.cargarDocumento({
    userId,
    correoId: entrada.correoId,
    perfilId: destino.perfilId,
    bytes,
    mimeDeclarado: adjunto.mimeType as string,
    titulo: titulo.titulo,
    categoria: extraccion.categoria,
    fecha: extraccion.fecha,
    resumen: extraccion.resumen,
    textoOcr: extraccion.texto_completo ?? "",
  })

  return {
    cargado: resultado.estado === "creado",
    tipo: "documento",
    motivos: motivosDeResultado(resultado),
  }
}

async function intentarTurno(
  userId: string,
  destino: DestinoAutoIngesta,
  entrada: CorreoRecienRegistrado,
  deps: DependenciasAutoCarga,
  hoyIso: string,
): Promise<{ cargado: boolean; tipo: "turno"; motivos: MotivoRevision[] }> {
  const analisis = await deps.leerTurno(entrada.mensaje.cuerpoTexto)

  // El asunto entra en el cotejo del nombre además del cuerpo: muchas clínicas
  // ponen el nombre del paciente ahí ("Turno confirmado - GOMEZ ROBERTO").
  const textoDelCorreo = `${entrada.mensaje.asunto ?? ""}\n${entrada.mensaje.cuerpoTexto}`

  const veredicto = evaluarTurnoParaAutoCarga({
    analisis,
    textoDelCorreo,
    nombrePerfilDestino: destino.perfilNombre,
    hoyIso,
  })

  if (!veredicto.sinDudas) {
    return { cargado: false, tipo: "turno", motivos: veredicto.motivos }
  }

  const propuesta = analisis.propuestaPrincipal
  const instante = combinarFechaHoraUshuaia(propuesta.fecha, propuesta.hora)
  if (!instante) {
    // La compuerta ya exigió fecha y hora sin avisos, así que llegar acá
    // significa que el par no forma un instante real. Es una duda más.
    return { cargado: false, tipo: "turno", motivos: ["aviso_del_analizador"] }
  }

  const resultado = await deps.cargarTurno({
    userId,
    correoId: entrada.correoId,
    especialidad: propuesta.especialidad,
    medico: propuesta.medico,
    fechaHoraIso: instante.toISOString(),
    lugarNombre: propuesta.lugarNombre,
    lugarDireccion: propuesta.lugarDireccion,
    lugarCiudad: propuesta.lugarCiudad,
    lugarProvincia: propuesta.lugarProvincia,
    notas: propuesta.notasPreparacion,
  })

  return { cargado: resultado.estado === "creado", tipo: "turno", motivos: motivosDeResultado(resultado) }
}

/** Traduce el rechazo de la RPC a un motivo mostrable. */
function motivosDeResultado(resultado: ResultadoIngresoAutomatico): MotivoRevision[] {
  if (resultado.estado === "duplicado") return ["duplicado_exacto"]
  return []
}

/**
 * La pasada automática de UNA conexión, sobre los correos que el barrido
 * acaba de registrar.
 *
 * Si la cuenta no tiene la auto-carga encendida devuelve el resultado vacío sin
 * tocar nada —ni una consulta de más—, que es el caso de la enorme mayoría de
 * las conexiones.
 */
export async function cargarSolosLosQueNoTienenDudas(
  userId: string,
  correos: readonly CorreoRecienRegistrado[],
  accessToken: string,
  opciones: OpcionesAutoCarga = {},
): Promise<ResultadoAutoCarga> {
  const deps: DependenciasAutoCarga = { ...DEPENDENCIAS_REALES, ...opciones.dependencias }
  const resultado: ResultadoAutoCarga = { ...RESULTADO_AUTO_VACIO }

  if (correos.length === 0) return resultado

  const destino = await deps.obtenerDestino(userId)
  if (!destino) return resultado

  const hoyIso = opciones.hoyIso ?? hoyIsoUshuaia()
  const tanda = correos.slice(0, LIMITE_AUTO_POR_PASADA)

  for (const entrada of tanda) {
    resultado.intentados += 1

    try {
      const intento = await intentarUno(
        userId,
        destino,
        entrada,
        deps,
        opciones,
        accessToken,
        hoyIso,
      )

      if (intento.cargado) {
        resultado.cargados += 1
        if (intento.tipo === "documento") resultado.documentos += 1
        else resultado.turnos += 1
        continue
      }

      resultado.aRevision += 1
      const frase = fraseDeMotivos(intento.motivos)
      if (frase) {
        await deps.anotarMotivo(userId, entrada.correoId, frase)
      }
    } catch (error) {
      resultado.errores += 1
      // El correo queda pendiente, que es el comportamiento de siempre. Se
      // anota un motivo genérico para que la persona no vea un correo sin
      // explicación al lado de otros que sí la tienen.
      await deps
        .anotarMotivo(
          userId,
          entrada.correoId,
          "Quedó para que lo mires vos: no pudimos leerlo automáticamente.",
        )
        .catch(() => undefined)

      // El id de Gmail no es un dato de salud; el contenido NUNCA se loguea.
      console.error(
        `${PREFIJO} no se pudo cargar solo el correo ${entrada.mensaje.id} (queda para revisar):`,
        error instanceof ErrorIngestaAutomatica || error instanceof Error ? error.message : error,
      )
    }
  }

  return resultado
}
