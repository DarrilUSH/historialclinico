/**
 * Normalización de la especialidad extraída de un mensaje de turno contra
 * `CATALOGO_ESPECIALIDADES` (Sprint 16, tarea 16.4). Lógica pura, sin React,
 * sin red -testeada en `tests/unit/mapear-especialidad-catalogo.test.ts`-.
 *
 * ## Por qué no alcanza con `especialidadCoincide` (16.2)
 *
 * `lib/especialidades/coincidencias.ts#especialidadCoincide` resuelve "¿el
 * texto que la persona está TIPEANDO es sustring de esta opción del
 * catálogo?" -filtro de autocompletar, con la persona escribiendo letra por
 * letra-. Acá el problema es distinto: Gemini ya devolvió una palabra
 * COMPLETA ("ECOGRAFISTA") que hay que emparejar contra el nombre canónico
 * del catálogo ("Ecografía") aunque NINGUNO sea sustring del otro -difieren
 * en el sufijo, "-ista" contra "-ía"-. Por eso acá se compara por PREFIJO
 * COMÚN normalizado: cuánto coinciden las dos palabras empezando por el
 * principio, que es donde vive la raíz de una especialidad médica en
 * castellano.
 *
 * ## Por qué es "mejor esfuerzo", nunca bloqueante
 *
 * El campo "Especialidad" del turno sigue siendo texto libre
 * (`lib/especialidades/catalogo.ts`, comentario de cabecera: "el catálogo
 * mejora la carga pero nunca la restringe"). Si nada matchea con confianza,
 * se devuelve el texto extraído TAL CUAL -nunca se inventa una especialidad
 * del catálogo que no corresponde, y nunca se bloquea la precarga por falta
 * de match-.
 */

import { CATALOGO_ESPECIALIDADES } from "@/lib/especialidades/catalogo"

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function longitudPrefijoComun(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a[i] === b[i]) i += 1
  return i
}

/** Umbral mínimo, en caracteres, para considerar que dos palabras comparten raíz. */
const UMBRAL_MINIMO_CARACTERES = 6
/** El prefijo común tiene que cubrir al menos esta proporción de la palabra más corta. */
const UMBRAL_PROPORCION = 0.6

/**
 * Busca en `CATALOGO_ESPECIALIDADES` la entrada que mejor matchea
 * `textoExtraido` (insensible a tildes/mayúsculas). Si hay un match exacto
 * (normalizado), lo devuelve de una. Si no, busca la entrada con el prefijo
 * común más largo que supere el umbral mínimo; si ninguna lo supera, si el
 * texto de entrada está vacío, o si DOS O MÁS entradas quedan EMPATADAS en el
 * mejor puntaje -ej: "Cirugía" solo comparte la misma raíz con las seis
 * "Cirugía X" del catálogo, y elegir cualquiera de ellas al azar sería
 * inventar una sub-especialidad que el mensaje no dijo-, devuelve
 * `textoExtraido` sin tocar: un empate real es, por definición, ambiguo.
 */
export function mapearEspecialidadCatalogo(textoExtraido: string): string {
  const texto = textoExtraido.trim()
  if (texto.length === 0) return ""

  const normalizado = normalizar(texto)
  let mejorEntrada: string | null = null
  let mejorPuntaje = -1
  let empatados = 0

  for (const entrada of CATALOGO_ESPECIALIDADES) {
    const normalizadoEntrada = normalizar(entrada)
    if (normalizadoEntrada === normalizado) return entrada

    const prefijo = longitudPrefijoComun(normalizado, normalizadoEntrada)
    if (prefijo < UMBRAL_MINIMO_CARACTERES) continue

    const menor = Math.min(normalizado.length, normalizadoEntrada.length)
    if (prefijo / menor < UMBRAL_PROPORCION) continue

    if (prefijo > mejorPuntaje) {
      mejorPuntaje = prefijo
      mejorEntrada = entrada
      empatados = 1
    } else if (prefijo === mejorPuntaje) {
      empatados += 1
    }
  }

  return mejorEntrada && empatados === 1 ? mejorEntrada : texto
}
