import "server-only"

/**
 * Orquesta la generación de la ficha de resumen para consulta (Sprint 10,
 * tarea 10.3): arma el prompt a partir del contexto clínico (10.2), llama a
 * Gemini con `SCHEMA_FICHA_CONSULTA`, valida la respuesta con
 * `FichaGeneradaSchema` y reintenta UNA vez si la validación falla
 * (`lib/gemini/reintento.ts`).
 *
 * `app/api/ficha/generar/route.ts` es el único llamador: arma el contexto
 * con `construirContextoClinico` (10.2) y le pasa el resultado a
 * `generarFichaConsulta`. Esta función no toca `request`, cookies ni
 * permisos -esa responsabilidad es enteramente del Route Handler, mismo
 * reparto que `lib/ficha/contexto.ts` documenta para sí mismo-, así que
 * queda reutilizable si algún día otra ruta necesita generar una ficha.
 *
 * ## Qué NO se loguea acá, nunca
 *
 * Ni el `contexto` ni el `prompt` armado a partir de él aparecen en ningún
 * lado de este archivo fuera de la llamada a Gemini -el mismo criterio que
 * `docs/minimizacion-datos.md` §6 exige para `lib/ficha/contexto.ts`-. Este
 * módulo no tiene un solo `console.*`: si `generarFichaConsulta` falla,
 * lanza un error tipado y es `app/api/ficha/generar/route.ts` quien decide
 * qué loguear -y ese Route Handler solo logueá `error.message` de las
 * excepciones de `lib/gemini/client.ts` (texto sobre el ESTADO de la
 * llamada) y `FichaInvalidaError.errores` (texto sobre la ESTRUCTURA de la
 * respuesta), nunca el contenido del contexto o del prompt-.
 */

import { extraerJson } from "@/lib/gemini/client"
import { construirPromptFicha } from "@/lib/gemini/prompt-ficha"
import { conReintentoSiInvalido } from "@/lib/gemini/reintento"
import { SCHEMA_FICHA_CONSULTA, validarFichaGenerada, type FichaGenerada } from "@/lib/gemini/schemas"
import type { ContextoClinico } from "@/lib/ficha/armado"

/**
 * Dos respuestas seguidas de Gemini no pasaron `FichaGeneradaSchema`. NO
 * hereda de `GeminiError` (`lib/gemini/client.ts`) porque no es un fallo de
 * Gemini como SERVICIO -Gemini respondió las dos veces, a tiempo y sin error
 * HTTP-, es un fallo de CONTENIDO: ninguna de las dos respuestas cumplió la
 * forma exigida (típicamente, un título de sección alterado o un aviso sin
 * el descargo obligatorio).
 */
export class FichaInvalidaError extends Error {
  /** Los errores de Zod del ÚLTIMO intento. Solo describen estructura, nunca el contenido recibido. */
  readonly errores: string[]

  constructor(errores: string[]) {
    super("La ficha generada no cumple el formato esperado tras dos intentos.")
    this.name = "FichaInvalidaError"
    this.errores = errores
  }
}

/**
 * Genera la ficha de resumen para consulta a partir de un contexto clínico
 * ya armado (`construirContextoClinico`, `lib/ficha/contexto.ts`).
 *
 * @throws {import("@/lib/gemini/client").GeminiConfigError
 *   | import("@/lib/gemini/client").GeminiTimeoutError
 *   | import("@/lib/gemini/client").GeminiApiError
 *   | import("@/lib/gemini/client").GeminiParseError} si `extraerJson` falla
 *   en el PRIMER intento. No se reintenta acá un fallo de Gemini como
 *   servicio -`extraerJson` ya reintentó lo que correspondía reintentar-,
 *   solo una respuesta estructuralmente inválida.
 * @throws {FichaInvalidaError} si dos respuestas seguidas de Gemini no pasan
 *   `FichaGeneradaSchema`.
 */
export async function generarFichaConsulta(contexto: ContextoClinico): Promise<FichaGenerada> {
  const prompt = construirPromptFicha(contexto)

  const resultado = await conReintentoSiInvalido<FichaGenerada>(
    () => extraerJson<unknown>({ prompt, schema: SCHEMA_FICHA_CONSULTA }),
    validarFichaGenerada,
  )

  if (!resultado.ok) {
    throw new FichaInvalidaError(resultado.errores)
  }

  return resultado.datos
}
