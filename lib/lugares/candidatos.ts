/**
 * Cruce "¿es este lugar del catálogo REFES?" (cruces inteligentes, agosto
 * 2026): dado el nombre/dirección/ciudad/provincia que la IA extrajo de un
 * mensaje de turno o de un documento, decide si hay un centro del catálogo
 * (`health_centers`, `lib/lugares/consulta.ts`) que corresponde con
 * confianza suficiente como para OFRECERLO -nunca para completarlo solo-.
 *
 * Lógica 100% pura: sin React, sin `server-only`, sin red. Recibe un puñado
 * de candidatos YA TRAÍDOS de la base (`app/(app)/(con-nav)/lugares/actions.ts#candidatosLugarAction`
 * arma esa consulta) y decide. Testeada en
 * `tests/unit/lugares-candidatos.test.ts`.
 *
 * ## El problema real: el texto extraído casi nunca es el nombre oficial
 *
 * `lib/turnos/construir-propuestas.ts` ya documentaba esta deuda desde la
 * tarea 16.4: "ANEXO DR JORGE SAGARDIA" (texto libre de un mensaje de
 * WhatsApp) es, en la práctica, el mismo establecimiento que "CENTRO MEDICO
 * CLINICA SAN JORGE" del Registro Federal -pero ningún substring de uno
 * aparece en el otro-. `lib/lugares/coincidencias.ts#centroCoincide` (el
 * matcher del autocompletar de "Lugar", tarea 16.3) exige que TODAS las
 * palabras de la consulta aparezcan: perfecto para una persona tecleando a
 * propósito, inútil acá, donde el texto trae basura ("ANEXO", "DR") mezclada
 * con la pista real ("JORGE").
 *
 * ## El algoritmo
 *
 * 1. **Tokenizar** nombre + dirección extraídos (`normalizarBusqueda`,
 *    insensible a tildes/mayúsculas, separado en palabras de 3+ caracteres:
 *    descarta "de", "la", "dr" solos, que no aportan nada y sobran en
 *    cualquier institución del país).
 * 2. **Puntuar cada candidato** por CUÁNTOS de esos tokens aparecen -como
 *    subcadena- en su nombre+localidad+departamento o en su dirección. Un
 *    candidato sin NINGÚN token en común no es candidato: se descarta antes
 *    de cualquier otra cosa.
 * 3. **Desambiguación geográfica**: si el mensaje traía ciudad y/o
 *    provincia, los candidatos cuya provincia/localidad coincide suman
 *    puntaje extra -lo bastante como para que "San Jorge" de Ushuaia le gane
 *    a los homónimos de Buenos Aires o Entre Ríos con el mismo puntaje de
 *    nombre, pero SIN inventar un candidato que no tenía ningún token en
 *    común-.
 * 4. **Umbral de ambigüedad**: se toman los candidatos con el puntaje más
 *    alto (empate incluido).
 *    - Exactamente uno → `"uno"`, la franja ofrece "¿Es este?".
 *    - Sin geografía extraída y más de uno empatado → `"ninguno"` (silencio):
 *      sin ciudad/provincia no hay forma razonable de elegir entre dos
 *      lugares con el mismo nombre en dos puntas del país, y una lista de
 *      candidatos lejanos confundiría más de lo que ayuda.
 *    - Con geografía extraída, entre 2 y 3 empatados → `"varios"`, listita
 *      para elegir.
 *    - Cualquier otro caso (0 candidatos, o más de 3 empatados incluso con
 *      geografía) → `"ninguno"`.
 */

import { normalizarBusqueda, provinciaCanonica } from "@/lib/lugares/normalizar"
import type { CentroSugerido } from "@/lib/lugares/sugerencias"

/** Lo que la IA extrajo de un mensaje/documento para cotejar contra el catálogo. */
export interface LugarExtraidoParaCotejo {
  nombre: string
  direccion?: string | null
  ciudad?: string | null
  provincia?: string | null
}

export type ResultadoCandidatosLugar =
  | { tipo: "uno"; centro: CentroSugerido }
  | { tipo: "varios"; centros: CentroSugerido[] }
  | { tipo: "ninguno" }

/** Tokens de menos de este largo se descartan: "de", "la", "el", "dr" no discriminan nada. */
const LARGO_MINIMO_TOKEN = 3
/** Tope de tokens que se usan para puntuar (y que arma la consulta candidata): los más largos primero. */
const MAX_TOKENS = 6
/** Con geografía, hasta esta cantidad de empatados en el tope se ofrecen como lista. Más que esto: silencio. */
const MAX_CANDIDATOS_LISTA = 3
/** Bonus por provincia/localidad coincidente: alcanza para desempatar entre homónimos de nombre igual. */
const BONUS_PROVINCIA = 5
const BONUS_LOCALIDAD = 3

function tokenizar(texto: string): string[] {
  return normalizarBusqueda(texto)
    .split(/[^a-z0-9ñ]+/)
    .filter((token) => token.length >= LARGO_MINIMO_TOKEN)
}

/**
 * Tokens de búsqueda de `extraido`: nombre + dirección, sin duplicados, los
 * más largos (más distintivos) primero, acotados a `MAX_TOKENS`. Los usa
 * tanto esta función como quien arma la consulta candidata del lado del
 * servidor (`candidatosLugarAction`), así las dos puntas hablan de los
 * MISMOS tokens.
 */
export function tokensDeBusquedaLugar(extraido: LugarExtraidoParaCotejo): string[] {
  const tokens = [...tokenizar(extraido.nombre), ...tokenizar(extraido.direccion ?? "")]
  const unicos = [...new Set(tokens)]
  return unicos.sort((a, b) => b.length - a.length).slice(0, MAX_TOKENS)
}

function textoDelCentro(centro: CentroSugerido): { nombre: string; direccion: string } {
  return {
    nombre: normalizarBusqueda(
      [centro.nombre, centro.localidad, centro.departamento].filter(Boolean).join(" "),
    ),
    direccion: normalizarBusqueda(centro.direccion ?? ""),
  }
}

function puntajeDeNombre(tokens: string[], centro: CentroSugerido): number {
  const texto = textoDelCentro(centro)
  let puntaje = 0
  for (const token of tokens) {
    if (texto.nombre.includes(token) || texto.direccion.includes(token)) puntaje += 1
  }
  return puntaje
}

function bonusGeografico(
  centro: CentroSugerido,
  ciudad: string,
  provinciaCanon: ReturnType<typeof provinciaCanonica>,
): number {
  let bonus = 0
  if (provinciaCanon && centro.provincia === provinciaCanon) bonus += BONUS_PROVINCIA

  const ciudadNormalizada = normalizarBusqueda(ciudad)
  if (ciudadNormalizada.length > 0) {
    const localidad = normalizarBusqueda(centro.localidad ?? "")
    if (
      localidad.length > 0 &&
      (localidad.includes(ciudadNormalizada) || ciudadNormalizada.includes(localidad))
    ) {
      bonus += BONUS_LOCALIDAD
    }
  }

  return bonus
}

/**
 * Decide, entre `centros` (candidatos YA acotados por la consulta del
 * servidor), cuáles ofrecer para `extraido`. Ver el comentario de cabecera
 * del archivo para el algoritmo completo.
 */
export function elegirCandidatosLugar(
  extraido: LugarExtraidoParaCotejo,
  centros: CentroSugerido[],
): ResultadoCandidatosLugar {
  const tokens = tokensDeBusquedaLugar(extraido)
  if (tokens.length === 0) return { tipo: "ninguno" }

  const ciudad = extraido.ciudad ?? ""
  const provinciaCanon = provinciaCanonica(extraido.provincia)
  const hayGeografia = ciudad.trim().length > 0 || Boolean(extraido.provincia?.trim())

  const puntuados = centros
    .map((centro) => {
      const base = puntajeDeNombre(tokens, centro)
      if (base === 0) return null
      return { centro, puntaje: base + bonusGeografico(centro, ciudad, provinciaCanon) }
    })
    .filter((item): item is { centro: CentroSugerido; puntaje: number } => item !== null)
    .sort((a, b) => b.puntaje - a.puntaje)

  if (puntuados.length === 0) return { tipo: "ninguno" }

  const mejorPuntaje = puntuados[0].puntaje
  const top = puntuados.filter((item) => item.puntaje === mejorPuntaje)

  if (top.length === 1) return { tipo: "uno", centro: top[0].centro }
  if (!hayGeografia) return { tipo: "ninguno" }
  if (top.length <= MAX_CANDIDATOS_LISTA) return { tipo: "varios", centros: top.map((item) => item.centro) }
  return { tipo: "ninguno" }
}
