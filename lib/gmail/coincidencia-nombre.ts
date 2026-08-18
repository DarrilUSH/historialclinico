/**
 * ¿Este estudio / este turno es de la persona del perfil de destino?
 * (Sprint 17, auto-carga sin dudas — punto 2c del encargo.)
 *
 * **Puro, sin red, sin `server-only`.** Recibe texto y devuelve booleanos.
 * Se prueba con literales (`tests/unit/gmail-coincidencia-nombre.test.ts`).
 *
 * ## Por qué esto existe, contado con el caso real
 *
 * La casilla que el usuario conectó es SUYA, pero a ella le llegan los
 * estudios de su madre. El dedup por mensaje no ve la diferencia, la huella
 * del archivo tampoco, y la clasificación "documento/turno" menos todavía: los
 * tres dicen que sí. Lo único que separa "este análisis es tuyo" de "este
 * análisis es de tu mamá" es **el nombre que figura adentro**. Sin este
 * cotejo, la auto-carga no sería "traer solo lo que está clarísimo": sería
 * meterle a una persona en su historial médico estudios de otra, en silencio y
 * mientras duerme. De todos los criterios de la compuerta, este es el único
 * cuyo fallo produce un daño que la persona podría no notar nunca.
 *
 * ## Las dos preguntas, que NO son la misma
 *
 * 1. `coincideNombreDePaciente(detectado, nombrePerfil)` — para los ADJUNTOS.
 *    Gemini extrae a nombre de quién está el documento (`paciente`) y acá se
 *    coteja ese nombre contra `profiles.full_name`. Es una comparación entre
 *    DOS NOMBRES.
 * 2. `nombreApareceEnTexto(texto, nombrePerfil)` — para los AVISOS DE TURNO.
 *    Ahí no hay un campo "paciente" que extraer (y no se agrega uno: ver
 *    `docs/minimizacion-datos.md` §9 y el comentario de
 *    `SCHEMA_ANALISIS_MENSAJE_TURNO`, "Por qué NO hay un campo de
 *    paciente/DNI"). Lo que se hace es buscar el nombre DEL PERFIL dentro del
 *    texto del correo, sin extraer ni guardar ningún nombre de nadie. Es una
 *    búsqueda de UN NOMBRE CONOCIDO dentro de un texto.
 *
 * La segunda es más delicada, y por eso exige **contigüidad**: los tokens del
 * nombre del perfil tienen que aparecer JUNTOS, como aparece un nombre de
 * verdad ("GOMEZ ROBERTO", "Roberto Gómez"), no desperdigados por 8000
 * caracteres de correo. Sin esa exigencia, un aviso de turno de la madre
 * -que comparte apellido, y que puede mencionar de paso el nombre del hijo que
 * la acompaña- daría positivo, que es exactamente el error que este módulo
 * existe para impedir.
 *
 * ## Qué tolera la normalización, y qué NO
 *
 * Tolera: tildes y diéresis (`Núñez` = `Nunez`), la eñe (`Muñoz` = `Munoz`,
 * porque la gente la escribe de las dos formas), mayúsculas, comas y puntos
 * (`GOMEZ, ROBERTO` = `Roberto Gómez`), el ORDEN (se compara por conjuntos),
 * tratamientos (`Sr.`, `Sra.`, `Paciente:`), iniciales sueltas (`Roberto C.
 * Gómez`) y partículas (`de`, `del`, `la`).
 *
 * NO tolera -a propósito, porque la compuerta es "sin NINGUNA duda"-:
 * - Que al nombre del perfil le FALTE un token en lo detectado. Si el perfil
 *   dice "Roberto Carlos Gómez" y el documento dice "Roberto Gómez", eso va a
 *   revisión humana. Puede ser la misma persona; puede no serlo.
 * - Un nombre de perfil de UNA sola palabra. "Roberto" a secas no identifica a
 *   nadie dentro de una familia, y usarlo como llave sería fabricar
 *   coincidencias.
 * - Apodos, abreviaturas y diminutivos (`Beto` ≠ `Roberto`). Resolverlos
 *   exigiría un diccionario y produciría falsos positivos justo en el eje que
 *   más caro sale equivocarse.
 *
 * Sí se acepta que lo DETECTADO traiga tokens de MÁS (la clínica escribe el
 * nombre legal completo, `GOMEZ ROBERTO CARLOS`, y el perfil dice
 * `Roberto Gómez`): ese es el caso normal y no agrega ambigüedad sobre quién
 * es, solo precisión.
 */

/** Mínimo de palabras significativas que tiene que tener el nombre del perfil para poder usarse como llave. */
const MIN_TOKENS_PERFIL = 2

/**
 * Tratamientos y rótulos que las clínicas anteponen al nombre. Se descartan de
 * los dos lados: no aportan identidad y su presencia o ausencia no puede
 * decidir si dos nombres son el mismo.
 */
const TRATAMIENTOS = new Set([
  "sr",
  "sra",
  "srta",
  "señor",
  "señora",
  "senor",
  "senora",
  "don",
  "dona",
  "doña",
  "paciente",
  "pac",
  "afiliado",
  "afiliada",
  "titular",
  "nombre",
  "apellido",
])

/**
 * Partículas de los apellidos compuestos castellanos. Se descartan de los dos
 * lados para que "Juan de la Cruz" y "DE LA CRUZ, JUAN" den lo mismo sin que
 * el conteo de tokens dependa de cuántas partículas escribió cada quien.
 */
const PARTICULAS = new Set(["de", "del", "la", "las", "los", "el", "y", "da", "do", "di", "van", "von"])

/** Marcas diacríticas combinantes que deja el `normalize("NFD")`. */
const DIACRITICOS = /[̀-ͯ]/g

/** Todo lo que no sea letra latina básica o dígito pasa a ser separador. */
const NO_ALFANUMERICO = /[^a-z0-9]+/g

/**
 * Un nombre → sus palabras significativas, normalizadas.
 *
 * La eñe se plancha a `n` (a diferencia de `lib/lugares/normalizar.ts`, que la
 * conserva porque ahí se comparan nombres de instituciones escritos por una
 * sola fuente). Acá los dos lados los escriben personas distintas -la clínica
 * y quien cargó el perfil- y "Muñoz"/"Munoz" tiene que ser la misma persona.
 *
 * Descarta: tratamientos, partículas, tokens de una sola letra (iniciales) y
 * tokens puramente numéricos (un DNI pegado al nombre no es parte del nombre).
 */
export function tokensDeNombre(texto: string): string[] {
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
      if (TRATAMIENTOS.has(token)) return false
      if (PARTICULAS.has(token)) return false
      if (/^\d+$/.test(token)) return false
      return true
    })
}

/**
 * ¿El nombre `detectado` (el que Gemini leyó en el documento) es el de la
 * persona de `nombrePerfil`?
 *
 * `true` solo si el nombre del perfil tiene al menos dos palabras
 * significativas y TODAS aparecen en lo detectado. El orden no importa; los
 * tokens de más en lo detectado tampoco. Cualquier otra cosa -uno de los dos
 * vacío, un token del perfil que falta, un perfil de una sola palabra- es
 * `false`, y `false` significa "va a revisión humana", nunca "es de otro".
 */
export function coincideNombreDePaciente(detectado: string, nombrePerfil: string): boolean {
  const tokensPerfil = tokensDeNombre(nombrePerfil)
  if (tokensPerfil.length < MIN_TOKENS_PERFIL) return false

  const tokensDetectados = new Set(tokensDeNombre(detectado))
  if (tokensDetectados.size < MIN_TOKENS_PERFIL) return false

  return tokensPerfil.every((token) => tokensDetectados.has(token))
}

/**
 * ¿El nombre de `nombrePerfil` aparece, COMO NOMBRE, dentro de `texto`?
 *
 * Se recorre el texto ya tokenizado con una ventana del largo del nombre del
 * perfil (y una de un token más, para tolerar el segundo nombre que la clínica
 * escribe en el medio: "GOMEZ ROBERTO CARLOS" para un perfil "Roberto
 * Gómez"). Da `true` si en alguna de esas ventanas están TODOS los tokens del
 * perfil.
 *
 * La contigüidad es la parte importante: sin ella, un aviso de turno de otra
 * persona de la misma familia -mismo apellido en el encabezado, el nombre de
 * pila de quien acompaña más abajo- daría positivo. Ver el encabezado del
 * archivo.
 */
export function nombreApareceEnTexto(texto: string, nombrePerfil: string): boolean {
  const tokensPerfil = tokensDeNombre(nombrePerfil)
  if (tokensPerfil.length < MIN_TOKENS_PERFIL) return false

  const tokensTexto = tokensDeNombre(texto)
  if (tokensTexto.length < tokensPerfil.length) return false

  const requeridos = new Set(tokensPerfil)

  for (const largo of [tokensPerfil.length, tokensPerfil.length + 1]) {
    if (tokensTexto.length < largo) continue
    for (let inicio = 0; inicio + largo <= tokensTexto.length; inicio += 1) {
      const ventana = new Set(tokensTexto.slice(inicio, inicio + largo))
      let completa = true
      for (const token of requeridos) {
        if (!ventana.has(token)) {
          completa = false
          break
        }
      }
      if (completa) return true
    }
  }

  return false
}
