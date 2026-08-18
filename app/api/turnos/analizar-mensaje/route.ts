/**
 * `POST /api/turnos/analizar-mensaje` — analiza con Gemini un mensaje de
 * turno pegado desde WhatsApp y devuelve una PROPUESTA para precargar
 * `/turnos/nuevo` (Sprint 16, tarea 16.4). La IA nunca guarda nada: esta
 * ruta solo lee y devuelve JSON, el `INSERT` real sigue siendo
 * `crearTurno` (`app/(app)/(con-nav)/turnos/actions.ts`), disparado por la
 * persona al revisar y tocar "Guardar turno".
 *
 * Es un Route Handler (no una Server Action) por el mismo motivo que
 * `app/api/documentos/extraer/route.ts`: `components/turnos/analizador-mensaje-turno.tsx`
 * necesita invocarlo desde un Client Component vía `fetch` y mostrar
 * `VeloEspera` mientras la llamada a Gemini está en curso (hasta 30s + 1
 * reintento).
 *
 * ## Guarda: mismo permiso que exige la propia pantalla
 *
 * `/turnos/nuevo` (`app/(app)/(con-nav)/turnos/nuevo/page.tsx`) redirige si
 * el perfil activo no tiene `canUpload`. Analizar un mensaje solo tiene
 * sentido para quien de verdad puede cargar el turno resultante -es parte del
 * mismo flujo de alta, dispara una llamada real a Gemini (consumo de cuota)-,
 * así que esta ruta revalida el mismo permiso con `requerirPermiso(perfilId,
 * "upload")` sobre el perfil activo de la cookie, nunca sobre un `perfilId`
 * que mande el cliente (mismo criterio que `app/api/ficha/generar/route.ts`).
 *
 * ## El mensaje nunca se persiste ni se loguea
 *
 * `docs/minimizacion-datos.md` §10: el texto pegado puede traer nombre y DNI
 * del paciente. Viaja a Gemini (no hay forma de analizar el mensaje sin que
 * lo vea), pero acá NUNCA se escribe en ninguna tabla ni en ningún
 * `console.*` -ni siquiera en los mensajes de error-. Lo único que persiste,
 * eventualmente, es el turno que la persona revisa y guarda a mano con los
 * campos ya existentes de `appointments`.
 */

import { NextResponse } from "next/server"

import { type ErrorGuarda, esErrorDeGuarda, requerirPermiso } from "@/lib/auth/guardas"
import {
  GeminiApiError,
  GeminiConfigError,
  GeminiParseError,
  GeminiTimeoutError,
} from "@/lib/gemini/client"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { AnalisisMensajeInvalidoError, analizarMensajeTurno } from "@/lib/turnos/analizar-mensaje"
import type { ResultadoAnalisisMensaje } from "@/lib/turnos/construir-propuestas"

export interface RespuestaAnalisisMensajeOk {
  resultado: ResultadoAnalisisMensaje
}

export interface RespuestaAnalisisMensajeError {
  error: string
}

/** Tope defensivo: un mensaje real de clínica nunca se acerca a esto — protege contra abuso/costo. */
const MAX_LARGO_MENSAJE = 8000

const MENSAJE_PERFIL_REQUERIDO = "No hay perfil activo. Elegí uno y probá de nuevo."
const MENSAJE_SIN_TEXTO = "Pegá el mensaje que te mandó la clínica antes de analizarlo."
const MENSAJE_MUY_LARGO = `El texto es demasiado largo (máx. ${MAX_LARGO_MENSAJE} caracteres) — pegá solo el mensaje del turno.`
const MENSAJE_CUOTA =
  "El servicio de análisis alcanzó su límite por hoy. Podés cargar el turno a mano mientras tanto."
const MENSAJE_TIMEOUT =
  "El análisis está tardando más de lo esperado. Probá de nuevo en un momento, o cargá el turno a mano."
const MENSAJE_RESPUESTA_INVALIDA = "No pudimos interpretar el mensaje. Podés cargar el turno a mano."
const MENSAJE_SERVICIO_NO_DISPONIBLE =
  "El servicio de análisis no está disponible en este momento. Podés cargar el turno a mano."
const MENSAJE_ANALISIS_FALLIDO = "No pudimos analizar el mensaje. Podés cargar el turno a mano."
const MENSAJE_INESPERADO =
  "Ocurrió un problema y no pudimos analizar el mensaje. Podés cargar el turno a mano."

function json(cuerpo: RespuestaAnalisisMensajeOk | RespuestaAnalisisMensajeError, status: number): Response {
  return NextResponse.json(cuerpo, {
    status,
    headers: { "Cache-Control": "private, no-cache" },
  })
}

/** Mapeo de estado HTTP para errores de guarda. Mismo patrón que el resto de `app/api/`. */
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

/**
 * Traduce las excepciones de `lib/gemini/client.ts` y
 * `lib/turnos/analizar-mensaje.ts` a `{ status, mensaje }`. Mismo criterio
 * que `app/api/ficha/generar/route.ts` y `app/api/documentos/extraer/route.ts`:
 * mensajes en español, nunca sugieren pagar por más cuota, y siempre
 * recuerdan que la carga manual sigue disponible.
 */
function respuestaDeErrorGemini(error: unknown): { status: number; mensaje: string } {
  if (error instanceof GeminiApiError && error.status === 429) {
    return { status: 429, mensaje: MENSAJE_CUOTA }
  }
  if (error instanceof GeminiTimeoutError) {
    console.error("[analizar-mensaje] Timeout llamando a Gemini:", error.message)
    return { status: 504, mensaje: MENSAJE_TIMEOUT }
  }
  if (error instanceof GeminiParseError) {
    console.error("[analizar-mensaje] Respuesta de Gemini no parseable:", error.message)
    return { status: 502, mensaje: MENSAJE_RESPUESTA_INVALIDA }
  }
  if (error instanceof GeminiConfigError) {
    console.error("[analizar-mensaje] Gemini mal configurado:", error.message)
    return { status: 500, mensaje: MENSAJE_SERVICIO_NO_DISPONIBLE }
  }
  if (error instanceof AnalisisMensajeInvalidoError) {
    console.error(
      "[analizar-mensaje] La respuesta no pasó la validación tras dos intentos:",
      error.errores.join(" | "),
    )
    return { status: 502, mensaje: MENSAJE_ANALISIS_FALLIDO }
  }
  if (error instanceof GeminiApiError) {
    console.error(`[analizar-mensaje] Gemini devolvió un error HTTP ${error.status ?? "?"}:`, error.message)
    return { status: 502, mensaje: MENSAJE_ANALISIS_FALLIDO }
  }
  console.error("[analizar-mensaje] Error inesperado al analizar el mensaje:", error)
  return { status: 500, mensaje: MENSAJE_INESPERADO }
}

export async function POST(request: Request): Promise<Response> {
  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return json({ error: MENSAJE_SIN_TEXTO }, 400)
  }

  const mensaje =
    cuerpo && typeof cuerpo === "object" && "mensaje" in cuerpo
      ? (cuerpo as { mensaje: unknown }).mensaje
      : undefined

  if (typeof mensaje !== "string" || mensaje.trim().length === 0) {
    return json({ error: MENSAJE_SIN_TEXTO }, 400)
  }
  if (mensaje.length > MAX_LARGO_MENSAJE) {
    return json({ error: MENSAJE_MUY_LARGO }, 413)
  }

  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return json({ error: MENSAJE_PERFIL_REQUERIDO }, 403)
    }

    // Mismo permiso que exige `/turnos/nuevo` — ver el encabezado del archivo.
    await requerirPermiso(activo.perfil.id, "upload", { siNoHaySesion: "lanzar" })

    let resultado: RespuestaAnalisisMensajeOk["resultado"]
    try {
      resultado = await analizarMensajeTurno(mensaje)
    } catch (error) {
      const { status, mensaje: mensajeError } = respuestaDeErrorGemini(error)
      return json({ error: mensajeError }, status)
    }

    return json({ resultado }, 200)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return json({ error: error.message }, estadoDeErrorGuarda(error))
    }
    console.error("[analizar-mensaje] Fallo inesperado en el Route Handler:", error)
    return json({ error: MENSAJE_INESPERADO }, 500)
  }
}
