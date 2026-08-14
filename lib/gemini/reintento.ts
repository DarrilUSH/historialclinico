/**
 * Reintento genérico ante una respuesta ESTRUCTURALMENTE inválida — no ante
 * un error transitorio de red: eso ya lo resuelve `extraerJson`
 * (`lib/gemini/client.ts`) con su propio único reintento sobre 5xx/timeout.
 *
 * Este archivo cubre un caso DISTINTO: Gemini respondió con JSON bien
 * formado que cumple `responseSchema` del lado de Google, pero no pasa la
 * validación Zod de este proyecto (por ejemplo, el `aviso` de la ficha no
 * menciona el descargo que exige el roadmap —
 * `lib/gemini/schemas.ts#FichaGeneradaSchema`). En ese caso vale la pena
 * pedirle a Gemini una segunda respuesta antes de rendirse: el modelo no es
 * determinista, así que una nueva llamada con el mismo prompt tiene una
 * chance real de cumplir la validación la segunda vez.
 *
 * Deliberadamente PURO respecto del control de reintento: `generar` y
 * `validar` se reciben por parámetro, así que este archivo no importa nada de
 * `@google/genai` ni de Zod y se puede testear con dobles de prueba
 * simples, sin mockear la red (`tests/unit/reintento.test.ts`).
 *
 * `generar` solo se vuelve a llamar si `validar` RECHAZA la primera
 * respuesta. Un error que `generar` LANZA (timeout, 4xx, 5xx ya reintentado
 * adentro de `extraerJson`) se propaga tal cual y NO cuenta como "inválido":
 * esos ya tomaron su propia decisión de reintento más abajo en la pila, y
 * duplicarla acá multiplicaría el costo y la latencia sin necesidad.
 */

/** Resultado de `validar`: mismo contrato que `validarFichaGenerada` y `validarExtraccion`. */
export type ResultadoValidacion<T> = { ok: true; datos: T } | { ok: false; errores: string[] }

export interface ExitoConReintento<T> {
  ok: true
  datos: T
  /** Cuántas veces se llamó a `generar` hasta obtener una respuesta válida. */
  intentos: 1 | 2
}

export interface FalloConReintento {
  ok: false
  /** Los errores del ÚLTIMO intento (el segundo), no de los dos acumulados. */
  errores: string[]
}

/**
 * Llama a `generar`, valida el resultado con `validar`, y si es inválido
 * llama a `generar` una ÚNICA vez más. Devuelve el primer resultado válido,
 * o los errores del último intento si ninguno de los dos lo fue.
 *
 * ```ts
 * const resultado = await conReintentoSiInvalido(
 *   () => extraerJson({ prompt, schema: SCHEMA_FICHA_CONSULTA }),
 *   validarFichaGenerada,
 * )
 * ```
 */
export async function conReintentoSiInvalido<T>(
  generar: () => Promise<unknown>,
  validar: (crudo: unknown) => ResultadoValidacion<T>,
): Promise<ExitoConReintento<T> | FalloConReintento> {
  const primerIntento = validar(await generar())
  if (primerIntento.ok) {
    return { ok: true, datos: primerIntento.datos, intentos: 1 }
  }

  const segundoIntento = validar(await generar())
  if (segundoIntento.ok) {
    return { ok: true, datos: segundoIntento.datos, intentos: 2 }
  }

  return { ok: false, errores: segundoIntento.errores }
}
