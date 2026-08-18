import "server-only"

/**
 * Orquesta el análisis de un mensaje de turno pegado desde WhatsApp (Sprint
 * 16, tarea 16.4): arma el prompt (`lib/gemini/prompt-turno.ts`), llama a
 * Gemini con `SCHEMA_ANALISIS_MENSAJE_TURNO`, valida la respuesta con
 * `validarAnalisisMensajeTurno` y reintenta UNA vez si la validación falla
 * (`lib/gemini/reintento.ts`) — mismo patrón que `lib/ficha/generar.ts`
 * (Sprint 10, tarea 10.3).
 *
 * `app/api/turnos/analizar-mensaje/route.ts` es el único llamador: recibe el
 * mensaje del cliente, resuelve sesión/permiso, y le pasa el texto a
 * `analizarMensajeTurno`. Este módulo no toca `request`, cookies ni permisos
 * -esa responsabilidad es enteramente del Route Handler-.
 *
 * ## El mensaje NUNCA se loguea acá
 *
 * Ni `mensaje` ni el `prompt` armado a partir de él aparecen en ningún log de
 * este archivo -mismo criterio que `lib/ficha/generar.ts` con el contexto
 * clínico, documentado en `docs/minimizacion-datos.md` §10-. Si
 * `analizarMensajeTurno` falla, lanza un error tipado y es el Route Handler
 * quien decide qué loguear -y solo logueá `error.message` de las excepciones
 * de `lib/gemini/client.ts` (texto sobre el ESTADO de la llamada) y
 * `AnalisisMensajeInvalidoError.errores` (texto sobre la ESTRUCTURA de la
 * respuesta rechazada), nunca el mensaje ni la respuesta cruda-.
 */

import { extraerJson } from "@/lib/gemini/client"
import { construirPromptAnalisisMensajeTurno } from "@/lib/gemini/prompt-turno"
import { conReintentoSiInvalido } from "@/lib/gemini/reintento"
import { SCHEMA_ANALISIS_MENSAJE_TURNO, type AnalisisMensajeTurnoExtraido } from "@/lib/gemini/schemas"
import { construirResultadoAnalisis, type ResultadoAnalisisMensaje } from "@/lib/turnos/construir-propuestas"
import { validarAnalisisMensajeTurno } from "@/lib/validacion/analisis-turno.schema"

/**
 * Dos respuestas seguidas de Gemini no pasaron `AnalisisMensajeTurnoSchema`.
 * NO hereda de `GeminiError` (`lib/gemini/client.ts`) por el mismo motivo que
 * `FichaInvalidaError` (`lib/ficha/generar.ts`): no es un fallo de Gemini
 * como SERVICIO, es un fallo de CONTENIDO.
 */
export class AnalisisMensajeInvalidoError extends Error {
  /** Los errores de Zod del ÚLTIMO intento. Solo describen estructura, nunca el contenido recibido. */
  readonly errores: string[]

  constructor(errores: string[]) {
    super("El análisis del mensaje no cumple el formato esperado tras dos intentos.")
    this.name = "AnalisisMensajeInvalidoError"
    this.errores = errores
  }
}

/**
 * Analiza `mensaje` con Gemini y devuelve el resultado ya normalizado y listo
 * para precargar el formulario.
 *
 * `ahora` es inyectable (default `new Date()`) para que la inferencia de año
 * (`lib/turnos/normalizacion-mensaje.ts#parsearFechaArgentina`) sea
 * determinística en los tests que llaman a este orquestador de punta a punta.
 *
 * @throws {import("@/lib/gemini/client").GeminiConfigError
 *   | import("@/lib/gemini/client").GeminiTimeoutError
 *   | import("@/lib/gemini/client").GeminiApiError
 *   | import("@/lib/gemini/client").GeminiParseError} si `extraerJson` falla
 *   en el PRIMER intento.
 * @throws {AnalisisMensajeInvalidoError} si dos respuestas seguidas de Gemini
 *   no pasan `AnalisisMensajeTurnoSchema`.
 */
export async function analizarMensajeTurno(
  mensaje: string,
  ahora: Date = new Date(),
): Promise<ResultadoAnalisisMensaje> {
  const prompt = construirPromptAnalisisMensajeTurno(mensaje)

  const resultado = await conReintentoSiInvalido<AnalisisMensajeTurnoExtraido>(
    () => extraerJson<unknown>({ prompt, schema: SCHEMA_ANALISIS_MENSAJE_TURNO }),
    validarAnalisisMensajeTurno,
  )

  if (!resultado.ok) {
    throw new AnalisisMensajeInvalidoError(resultado.errores)
  }

  return construirResultadoAnalisis(resultado.datos, ahora)
}
