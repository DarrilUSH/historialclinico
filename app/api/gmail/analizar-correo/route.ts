/**
 * `POST /api/gmail/analizar-correo` — toma un correo de la bandeja de Gmail y
 * devuelve la PROPUESTA de turno para precargar `/turnos/nuevo` (Sprint 17,
 * tarea 17.2).
 *
 * Es la misma función de la tarea 16.4 ("pegá el mensaje que te mandó la
 * clínica"), con una sola diferencia: el texto no lo pega la persona, lo trae
 * la app desde el correo. Todo lo demás se REUSA tal cual —
 * `analizarMensajeTurno` (prompt, Gemini, validación Zod y reintento),
 * `ResultadoAnalisisMensaje`, la franja de avisos y el formulario que se
 * precarga—. La IA sigue sin guardar nada: esta ruta solo lee y devuelve JSON,
 * y el `INSERT` real lo hace `crearTurno` cuando la persona revisa y toca
 * "Guardar turno".
 *
 * ## El cuerpo del correo se busca EN EL MOMENTO, y no se guarda nunca
 *
 * `gmail_messages` no tiene el texto del correo: guarda metadatos (ver el
 * encabezado de `20260818140000_gmail_mensajes.sql`). Así que este handler
 * vuelve a pedirle el mensaje a Gmail, saca el texto, se lo manda a Gemini y
 * lo deja ir. El texto no toca ninguna tabla, ningún log y ningún archivo —
 * exactamente el mismo compromiso que ya rige para el mensaje pegado a mano
 * (`docs/minimizacion-datos.md` §9), extendido en §10.6.
 *
 * ## Guardas, en orden
 *
 * 1. **Sesión** — sin cookie válida, 401 (esta ruta la llama un `fetch`, así
 *    que el 401 en JSON es la respuesta correcta; por eso NO está en
 *    `RUTAS_PUBLICAS`).
 * 2. **El correo es de esta cuenta** — `obtenerMensajeRegistrado(usuario.id, …)`
 *    filtra por `user_id`; un id ajeno devuelve `null` y se contesta 404, sin
 *    distinguir "no existe" de "no es tuyo" (principio 3 de
 *    `docs/modelo-permisos.md`).
 * 3. **`upload` sobre el perfil ACTIVO** — igual que en
 *    `/api/turnos/analizar-mensaje`: analizar solo tiene sentido para quien
 *    puede cargar el turno resultante, y dispara una llamada real a Gemini
 *    (consumo de cuota).
 */

import { NextResponse } from "next/server"

import { type ErrorGuarda, esErrorDeGuarda, requerirPermiso, requerirSesion } from "@/lib/auth/guardas"
import {
  GeminiApiError,
  GeminiConfigError,
  GeminiParseError,
  GeminiTimeoutError,
} from "@/lib/gemini/client"
import {
  ErrorConexionGmailVencida,
  ErrorGmailSinConfigurar,
  ErrorSinConexionGmail,
  obtenerAccessTokenGmail,
} from "@/lib/gmail/conexiones-admin"
import { ErrorGmail, obtenerMensajeCompleto } from "@/lib/gmail/google-api"
import { parsearMensajeGmail } from "@/lib/gmail/mensaje"
import { obtenerMensajeRegistrado } from "@/lib/gmail/mensajes-admin"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { AnalisisMensajeInvalidoError, analizarMensajeTurno } from "@/lib/turnos/analizar-mensaje"
import type { ResultadoAnalisisMensaje } from "@/lib/turnos/construir-propuestas"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export interface RespuestaAnalisisCorreoOk {
  resultado: ResultadoAnalisisMensaje
  /** El remitente, para que la pantalla pueda ofrecer el filtro aprendido ahí mismo. */
  remitente: string
}

export interface RespuestaAnalisisCorreoError {
  error: string
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MENSAJE_SIN_ID = "Falta indicar qué correo analizar."
const MENSAJE_NO_ENCONTRADO = "No encontramos ese correo."
const MENSAJE_PERFIL_REQUERIDO = "No hay perfil activo. Elegí uno y probá de nuevo."
const MENSAJE_SIN_TEXTO =
  "Ese correo no tiene texto que podamos leer. Podés cargar el turno a mano."
const MENSAJE_GMAIL = "No pudimos traer el correo desde Gmail. Probá de nuevo en un rato."
const MENSAJE_VENCIDA =
  "Se venció el permiso para leer tu Gmail. Volvé a conectarlo y probá de nuevo."
const MENSAJE_CUOTA =
  "El servicio de análisis alcanzó su límite por hoy. Podés cargar el turno a mano mientras tanto."
const MENSAJE_TIMEOUT =
  "El análisis está tardando más de lo esperado. Probá de nuevo en un momento, o cargá el turno a mano."
const MENSAJE_RESPUESTA_INVALIDA = "No pudimos interpretar el correo. Podés cargar el turno a mano."
const MENSAJE_SERVICIO_NO_DISPONIBLE =
  "El servicio de análisis no está disponible en este momento. Podés cargar el turno a mano."
const MENSAJE_ANALISIS_FALLIDO = "No pudimos analizar el correo. Podés cargar el turno a mano."
const MENSAJE_INESPERADO =
  "Ocurrió un problema y no pudimos analizar el correo. Podés cargar el turno a mano."

function json(
  cuerpo: RespuestaAnalisisCorreoOk | RespuestaAnalisisCorreoError,
  status: number,
): Response {
  return NextResponse.json(cuerpo, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  })
}

function estadoDeErrorGuarda(error: ErrorGuarda): number {
  switch (error.codigo) {
    case "sesion_requerida":
      return 401
    case "perfil_invalido":
      return 400
    case "permiso_denegado":
      return 403
    case "fallo_de_verificacion":
      return 503
  }
}

/** Mismo mapeo que `/api/turnos/analizar-mensaje`, con los errores de Gmail sumados adelante. */
function respuestaDeError(error: unknown): { status: number; mensaje: string } {
  if (error instanceof ErrorSinConexionGmail) {
    return { status: 409, mensaje: "Todavía no conectaste tu Gmail." }
  }
  if (error instanceof ErrorConexionGmailVencida) {
    return { status: 409, mensaje: MENSAJE_VENCIDA }
  }
  if (error instanceof ErrorGmailSinConfigurar) {
    return { status: 503, mensaje: MENSAJE_SERVICIO_NO_DISPONIBLE }
  }
  if (error instanceof ErrorGmail) {
    console.error("[gmail-analizar] Gmail no entregó el mensaje:", error.detalle ?? error.message)
    return {
      status: error.codigo === "permiso_vencido" ? 409 : 502,
      mensaje: error.codigo === "permiso_vencido" ? MENSAJE_VENCIDA : MENSAJE_GMAIL,
    }
  }
  if (error instanceof GeminiApiError && error.status === 429) {
    return { status: 429, mensaje: MENSAJE_CUOTA }
  }
  if (error instanceof GeminiTimeoutError) {
    console.error("[gmail-analizar] Timeout llamando a Gemini:", error.message)
    return { status: 504, mensaje: MENSAJE_TIMEOUT }
  }
  if (error instanceof GeminiParseError) {
    console.error("[gmail-analizar] Respuesta de Gemini no parseable:", error.message)
    return { status: 502, mensaje: MENSAJE_RESPUESTA_INVALIDA }
  }
  if (error instanceof GeminiConfigError) {
    console.error("[gmail-analizar] Gemini mal configurado:", error.message)
    return { status: 500, mensaje: MENSAJE_SERVICIO_NO_DISPONIBLE }
  }
  if (error instanceof AnalisisMensajeInvalidoError) {
    console.error(
      "[gmail-analizar] La respuesta no pasó la validación tras dos intentos:",
      error.errores.join(" | "),
    )
    return { status: 502, mensaje: MENSAJE_ANALISIS_FALLIDO }
  }
  if (error instanceof GeminiApiError) {
    console.error(`[gmail-analizar] Gemini devolvió HTTP ${error.status ?? "?"}:`, error.message)
    return { status: 502, mensaje: MENSAJE_ANALISIS_FALLIDO }
  }
  console.error("[gmail-analizar] Error inesperado:", error)
  return { status: 500, mensaje: MENSAJE_INESPERADO }
}

export async function POST(request: Request): Promise<Response> {
  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return json({ error: MENSAJE_SIN_ID }, 400)
  }

  const correoId =
    cuerpo && typeof cuerpo === "object" && "correoId" in cuerpo
      ? (cuerpo as { correoId: unknown }).correoId
      : undefined

  if (typeof correoId !== "string" || !PATRON_UUID.test(correoId)) {
    return json({ error: MENSAJE_SIN_ID }, 400)
  }

  try {
    const { usuario } = await requerirSesion({ siNoHaySesion: "lanzar" })

    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return json({ error: MENSAJE_PERFIL_REQUERIDO }, 403)
    }
    await requerirPermiso(activo.perfil.id, "upload", { siNoHaySesion: "lanzar" })

    const correo = await obtenerMensajeRegistrado(usuario.id, correoId)
    if (!correo) {
      return json({ error: MENSAJE_NO_ENCONTRADO }, 404)
    }

    let resultado: ResultadoAnalisisMensaje
    try {
      const accessToken = await obtenerAccessTokenGmail(usuario.id)
      const crudo = await obtenerMensajeCompleto(accessToken, correo.gmailMessageId)
      const mensaje = parsearMensajeGmail(crudo)

      const texto = mensaje?.cuerpoTexto.trim() ?? ""
      if (texto.length === 0) {
        return json({ error: MENSAJE_SIN_TEXTO }, 422)
      }

      resultado = await analizarMensajeTurno(texto)
    } catch (error) {
      const { status, mensaje } = respuestaDeError(error)
      return json({ error: mensaje }, status)
    }

    return json({ resultado, remitente: correo.remitenteEmail }, 200)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return json({ error: error.message }, estadoDeErrorGuarda(error))
    }
    const { status, mensaje } = respuestaDeError(error)
    return json({ error: mensaje }, status)
  }
}
