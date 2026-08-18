/**
 * Matcher del autocompletar de "Lugar" (Sprint 16, tarea 16.3). Lógica pura,
 * testeada en `tests/unit/lugares-coincidencias.test.ts`.
 *
 * ## Reusa el matcher de la tarea 16.2, no lo reimplementa
 *
 * La comparación de UNA palabra contra el texto de un centro es exactamente
 * la misma que la del autocompletar de especialidades:
 * `lib/especialidades/coincidencias.ts#especialidadCoincide`, subcadena en
 * cualquier posición con `Intl.Collator` en `sensitivity: "base"` (insensible
 * a tildes y a mayúsculas). Este archivo solo agrega la parte que un catálogo
 * de 36 mil lugares necesita y una lista de 80 especialidades no: **cada
 * palabra de la consulta se exige por separado**.
 *
 * ## Por qué por palabra y no por la frase entera
 *
 * Porque tiene que decir lo MISMO que la consulta SQL. `buscarCentros`
 * (`lib/lugares/consulta.ts`) arma un `like` por cada palabra contra
 * `search_text`, así que "san jorge ushuaia" y "ushuaia san jorge" traen lo
 * mismo del servidor. Si el filtro del cliente exigiera la frase entera y en
 * orden, el segundo caso traería resultados del servidor y el desplegable los
 * mostraría como "sin coincidencias" — el peor de los mundos: la base
 * encontró lo que la persona buscaba y la pantalla se lo escondió.
 */

import { especialidadCoincide } from "@/lib/especialidades/coincidencias"

/**
 * `true` si TODAS las palabras de `consulta` aparecen (como subcadena, sin
 * distinguir tildes ni mayúsculas) en `textoDelCentro`, en cualquier orden.
 * Una consulta vacía matchea todo, igual que `especialidadCoincide`.
 */
export function centroCoincide(textoDelCentro: string, consulta: string): boolean {
  const palabras = consulta.trim().split(/\s+/).filter((palabra) => palabra.length > 0)
  if (palabras.length === 0) return true

  return palabras.every((palabra) => especialidadCoincide(textoDelCentro, palabra))
}
