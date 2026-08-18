/**
 * Cotejo TOLERANTE de nombres de médico contra el directorio del perfil
 * (cruces inteligentes, agosto 2026): "¿el médico que trajo la orden ya está
 * cargado, con otro nombre parecido?".
 *
 * Lógica pura, sin React ni red -testeada en
 * `tests/unit/medicos-coincidencia-nombre.test.ts`-.
 *
 * ## Por qué NO se reusa `lib/gmail/coincidencia-nombre.ts` tal cual
 *
 * Esa función resuelve una pregunta mucho más estricta, para un público
 * distinto: "¿el texto nombra, SIN LA MÁS MÍNIMA DUDA, a la persona dueña de
 * este perfil?" -la compuerta de auto-ingesta, donde equivocarse mete un
 * estudio ajeno en el historial de otra persona EN SILENCIO, sin que nadie
 * lo revise-. Acá el riesgo es de otro orden: un falso positivo es, como
 * mucho, una franja con un botón "Vincular" que la persona puede no tocar
 * -siempre hay un "No" al lado, y "Agregar" nunca reemplaza nada, solo crea-,
 * así que el criterio puede (y debe) ser más generoso:
 *
 * - No exige dos o más tokens: un mensaje real trae seguido SOLO el apellido
 *   ("Profesional: Ardans", fixture `casa-salud-confirmacion.txt`), y un
 *   directorio de una app familiar bien puede tener un único "Dr. Ardans"
 *   cargado.
 * - Descarta tratamientos médicos ("Dr.", "Dra.", "Lic.") que
 *   `tokensDeNombre` NO descarta -ahí no hace falta: un paciente nunca
 *   figura como "Dr. Fulano" en el campo paciente de un documento-, y acá sí,
 *   todo el tiempo: el directorio casi siempre guarda el nombre CON
 *   tratamiento (`supabase/seed.sql`: "Dr. Carlos Rodríguez"), el mensaje de
 *   la clínica a veces lo trae y a veces no.
 * - Compara por SUBCONJUNTO en cualquier dirección, no por igualdad de
 *   conjuntos ni por "todos los del perfil adentro del detectado": un
 *   directorio con "Dra. Valeria Andrea Vidales" tiene que reconocer a
 *   "VIDALES VALERIA" (extraído, sin el segundo nombre) tanto como un
 *   directorio con solo "Dr. Juárez" (apellido pelado) tiene que reconocer
 *   "SERV. DE ECOGRAFIA - DR. JUAREZ" ya limpio a "Dr. Juárez".
 *
 * Se reutiliza el mismo ESQUELETO de normalización (NFD, minúsculas, separar
 * por no-alfanumérico, descartar tokens de una letra) que
 * `lib/gmail/coincidencia-nombre.ts#tokensDeNombre`, con su propia lista de
 * tratamientos -mismo criterio documentado en `lib/lugares/normalizar.ts`
 * sobre por qué `normalizarBusqueda` no reusa el normalizador de nombres de
 * paciente: cada comparación tiene su propio público y su propia lista de
 * palabras a ignorar-.
 */

const TRATAMIENTOS_MEDICO = new Set(["dr", "dra", "lic", "prof", "med"])

/** Partículas de apellidos compuestos: mismo criterio que `lib/gmail/coincidencia-nombre.ts`. */
const PARTICULAS = new Set(["de", "del", "la", "las", "los", "el", "y", "da", "do", "di", "van", "von"])

/**
 * Bloque Unicode "Combining Diacritical Marks" (los acentos que NFD deja
 * sueltos), escrito con escapes `\uXXXX` a propósito -mismo criterio que
 * `MARCAS_COMBINANTES` en `lib/lugares/normalizar.ts`-: un carácter
 * combinante literal en el código fuente se pega visualmente a la letra
 * anterior y vuelve ilegible el diff.
 */
const DIACRITICOS = /[\u0300-\u036f]/g

/** Todo lo que no sea letra latina básica o dígito pasa a ser separador. */
const NO_ALFANUMERICO = /[^a-z0-9]+/g

/**
 * Un nombre de médico → sus palabras significativas, normalizadas. Descarta
 * tratamientos, partículas, iniciales sueltas y tokens puramente numéricos.
 */
export function tokensDeNombreMedico(texto: string): string[] {
  if (typeof texto !== "string") return []

  return texto
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .toLowerCase()
    .replace(NO_ALFANUMERICO, " ")
    .trim()
    .split(" ")
    .filter((token) => {
      if (token.length < 2) return false
      if (TRATAMIENTOS_MEDICO.has(token)) return false
      if (PARTICULAS.has(token)) return false
      if (/^\d+$/.test(token)) return false
      return true
    })
}

export interface MedicoDelDirectorioParaCotejo {
  id: string
  full_name: string
}

/**
 * Busca, dentro de `directorio`, el médico cuyo nombre es más parecido a
 * `nombreExtraido`. Dos nombres se consideran EL MISMO médico cuando,
 * después de normalizar, el conjunto de tokens más chico de los dos es
 * subconjunto del más grande -en cualquier dirección-. Con más de un
 * candidato empatado en la coincidencia más cerrada, gana el primero del
 * directorio (orden estable: no hay forma razonable de desempatar mejor sin
 * más datos).
 *
 * Devuelve `null` si `nombreExtraido` no tiene ningún token significativo, o
 * si ningún médico del directorio comparte tokens con él en ninguna
 * dirección -el caso más común, y la señal de que corresponde ofrecer
 * "Agregar" en vez de "Vincular"-.
 */
export function medicoParecidoEnDirectorio<T extends MedicoDelDirectorioParaCotejo>(
  nombreExtraido: string,
  directorio: readonly T[],
): T | null {
  const tokensExtraidos = new Set(tokensDeNombreMedico(nombreExtraido))
  if (tokensExtraidos.size === 0) return null

  let mejor: T | null = null
  let mejorPuntaje = 0

  for (const medico of directorio) {
    const tokensDirectorio = new Set(tokensDeNombreMedico(medico.full_name))
    if (tokensDirectorio.size === 0) continue

    const [menor, mayor] =
      tokensExtraidos.size <= tokensDirectorio.size
        ? [tokensExtraidos, tokensDirectorio]
        : [tokensDirectorio, tokensExtraidos]

    const esSubconjunto = [...menor].every((token) => mayor.has(token))
    if (!esSubconjunto) continue

    if (menor.size > mejorPuntaje) {
      mejor = medico
      mejorPuntaje = menor.size
    }
  }

  return mejor
}
