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
 * Gómez`), partículas (`de`, `del`, `la`) y -desde el Sprint 18- el
 * TRUNCAMIENTO del sistema del laboratorio (ver abajo).
 *
 * NO tolera -a propósito, porque la compuerta es "sin NINGUNA duda"-:
 * - Que al nombre del perfil le FALTE un token entero en lo detectado. Si el
 *   perfil dice "Roberto Carlos Gómez" y el documento dice "Roberto Gómez",
 *   eso va a revisión humana. Puede ser la misma persona; puede no serlo.
 * - Un nombre de perfil de UNA sola palabra. "Roberto" a secas no identifica a
 *   nadie dentro de una familia, y usarlo como llave sería fabricar
 *   coincidencias.
 * - Apodos, abreviaturas y diminutivos (`Beto` ≠ `Roberto`). Resolverlos
 *   exigiría un diccionario y produciría falsos positivos justo en el eje que
 *   más caro sale equivocarse. El truncamiento tolerado es solo por la
 *   DERECHA (`GREGORI` es principio de `GREGORIO`); `BETO` no es principio de
 *   `ROBERTO` y sigue sin coincidir.
 *
 * Sí se acepta que lo DETECTADO traiga tokens de MÁS (la clínica escribe el
 * nombre legal completo, `GOMEZ ROBERTO CARLOS`, y el perfil dice
 * `Roberto Gómez`): ese es el caso normal y no agrega ambigüedad sobre quién
 * es, solo precisión.
 *
 * ## Sprint 18: por qué el nombre decide y el DNI solo corrobora
 *
 * Los 47 documentos reales del dueño dejaron tres formas distintas en que un
 * cotejo estricto le habría negado un estudio PROPIO:
 *
 * 1. **El DNI leído mal.** En una placa de baja resolución el lector devolvió
 *    `31479089` donde el documento decía `31473089`: un dígito. Si el DNI
 *    pudiera rechazar por sí solo, ese estudio -suyo- quedaba afuera.
 * 2. **El apellido truncado.** El sistema del laboratorio imprime la etiqueta
 *    con ancho fijo y corta: `GREGORI` por `GREGORIO`. No es otra persona: es
 *    la misma con una letra menos.
 * 3. **El nombre reemplazado por un código interno.** Dos informes traen
 *    `MDAHE15061985` en el renglón del paciente. Eso no es "de otra persona":
 *    es "no dice de quién es".
 *
 * De ahí sale la regla, y está escrita entera en `evaluarTitularidad`:
 *
 * > **Decide el NOMBRE, en forma difusa. El DNI solo corrobora.** Un DNI que
 * > no calza NUNCA alcanza, por sí solo, para decir que el documento es de
 * > otra persona: baja el veredicto a "a confirmar", que es una PREGUNTA. Hace
 * > falta que fallen las DOS señales -el nombre no calza y el DNI tampoco-
 * > para decir "no coincide".
 *
 * Y hay algo que ninguna de estas ramas hace: descartar el documento. Todos
 * los veredictos que no son `"coincide"` significan lo mismo en la práctica
 * -el correo va a la bandeja de revisión, donde la persona decide- y cambian
 * solo la frase que ella lee. Nada se tira nunca por un cotejo de nombre.
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
 * Largo mínimo del token corto para aceptar un truncamiento. Con cuatro
 * letras, `GREGORI`/`GREGORIO` y `FERREYR`/`FERREYRA` calzan, y `ANA` no se
 * come a `ANABELLA`. Es el mismo criterio que usa una etiqueta de ancho fijo:
 * corta el final, nunca el principio.
 */
const MIN_LARGO_TRUNCAMIENTO = 4

/**
 * ¿Estos dos tokens son la misma palabra, admitiendo que a UNA de las dos le
 * hayan cortado el final?
 *
 * Solo por la derecha y solo con al menos `MIN_LARGO_TRUNCAMIENTO` letras en
 * común desde el principio. Un apodo (`BETO` por `ROBERTO`) no pasa: no es un
 * prefijo, es otra palabra.
 */
function mismaPalabraAunTruncada(a: string, b: string): boolean {
  if (a === b) return true
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a]
  if (corto.length < MIN_LARGO_TRUNCAMIENTO) return false
  return largo.startsWith(corto)
}

/** Cómo calzó el nombre. Es la señal FUERTE del cotejo de titularidad. */
export type SenalNombre =
  /** Todos los tokens del perfil aparecen enteros en lo detectado. */
  | "exacto"
  /** Todos aparecen, pero al menos uno vino cortado por el sistema emisor. */
  | "truncado"
  /** Falta al menos un token del perfil: no se puede afirmar que sea la misma persona. */
  | "no_calza"
  /** No vino nada, o lo que vino no alcanza para ser un nombre. */
  | "ausente"
  /** Lo que vino es un código interno de la institución, no un nombre. */
  | "codigo"

/**
 * ¿El renglón del paciente trae un CÓDIGO en vez de un nombre?
 *
 * Caso real: dos informes escriben `MDAHE15061985` donde va el nombre (las
 * iniciales pegadas a la fecha de nacimiento). Distinguirlo importa porque el
 * veredicto correcto es "no se sabe de quién es este estudio", no "es de otra
 * persona": la primera frase le pide a la persona que mire, la segunda la
 * acusa de estar cargando un estudio ajeno.
 *
 * La regla es general: si TODAS las palabras del renglón mezclan letras y
 * dígitos, no es un nombre. Ningún nombre de persona se escribe así, y ningún
 * sistema imprime un código de paciente sin dígitos.
 */
export function pareceCodigoInterno(detectado: string): boolean {
  const tokens = tokensDeNombre(detectado)
  if (tokens.length === 0) return false
  return tokens.every((token) => /[a-z]/.test(token) && /\d/.test(token))
}

/**
 * Cómo calzó el nombre detectado contra el del perfil.
 *
 * Es la versión con matices de `coincideNombreDePaciente`: distingue el calce
 * perfecto del calce con truncamiento, y la ausencia del desacuerdo. Quien
 * solo necesita un sí o un no usa `coincideNombreDePaciente`.
 */
export function evaluarNombre(detectado: string, nombrePerfil: string): SenalNombre {
  const tokensPerfil = tokensDeNombre(nombrePerfil)
  // Un perfil de una sola palabra no identifica a nadie dentro de una familia:
  // no se puede usar como llave, y eso no es culpa del documento.
  if (tokensPerfil.length < MIN_TOKENS_PERFIL) return "no_calza"

  if (pareceCodigoInterno(detectado)) return "codigo"

  const tokensDetectados = tokensDeNombre(detectado)
  if (tokensDetectados.length === 0) return "ausente"
  if (tokensDetectados.length < MIN_TOKENS_PERFIL) return "no_calza"

  let huboTruncamiento = false
  for (const token of tokensPerfil) {
    if (tokensDetectados.includes(token)) continue

    const truncado = tokensDetectados.find((candidato) =>
      mismaPalabraAunTruncada(candidato, token),
    )
    if (truncado === undefined) return "no_calza"
    huboTruncamiento = true
  }

  return huboTruncamiento ? "truncado" : "exacto"
}

/**
 * ¿El nombre `detectado` (el que Gemini leyó en el documento) es el de la
 * persona de `nombrePerfil`?
 *
 * `true` solo si el nombre del perfil tiene al menos dos palabras
 * significativas y TODAS aparecen en lo detectado, ENTERAS. El orden no
 * importa; los tokens de más en lo detectado tampoco. Un truncamiento del
 * emisor NO alcanza para el `true` -para eso está `evaluarTitularidad`, que lo
 * manda a confirmar en vez de negarlo-. Cualquier otra cosa -uno de los dos
 * vacío, un token del perfil que falta, un perfil de una sola palabra- es
 * `false`, y `false` significa "va a revisión humana", nunca "es de otro".
 */
export function coincideNombreDePaciente(detectado: string, nombrePerfil: string): boolean {
  return evaluarNombre(detectado, nombrePerfil) === "exacto"
}

/** Qué dijo el DNI. Es la señal DÉBIL: corrobora, nunca decide sola. */
export type SenalDni = "coincide" | "difiere" | "sin_dato"

/** Un DNI a solo sus dígitos: `28.114.902`, `28114902` y `DNI 28.114.902` dan lo mismo. */
function digitosDeDni(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D+/g, "")
}

/**
 * Compara los dos DNI. Sin dato de alguno de los dos lados devuelve
 * `"sin_dato"`, que es exactamente lo que corresponde: la ausencia de
 * corroboración no es una contradicción.
 */
export function evaluarDni(
  detectado: string | null | undefined,
  dniPerfil: string | null | undefined,
): SenalDni {
  const unos = digitosDeDni(detectado)
  const otros = digitosDeDni(dniPerfil)
  if (unos.length === 0 || otros.length === 0) return "sin_dato"
  return unos === otros ? "coincide" : "difiere"
}

/** El veredicto de titularidad. Ver la tabla en `evaluarTitularidad`. */
export type VeredictoTitularidad =
  /** Es de esta persona, sin dudas. Es el ÚNICO que habilita la carga automática. */
  | "coincide"
  /** Hay indicios de que es suyo y algo que confirmar. Va a revisión humana. */
  | "a_confirmar"
  /** No se puede saber de quién es (sin nombre, o un código en su lugar). */
  | "indeterminado"
  /** Las dos señales dicen que es de otra persona. */
  | "no_coincide"

/** Lo que hace falta para decidir la titularidad de un documento. */
export interface EntradaTitularidad {
  /** El nombre que el lector leyó en el documento. Vacío/ausente = no vino. */
  nombreDetectado: string | null | undefined
  /** `profiles.full_name` del perfil de destino. */
  nombrePerfil: string
  /**
   * DNI leído en el documento, si lo hubiera.
   *
   * **Hoy nadie lo pasa, y es a propósito:** el schema de extracción no
   * pregunta el DNI y no va a preguntarlo (`docs/minimizacion-datos.md`; el
   * comentario de `SCHEMA_ANALISIS_MENSAJE_TURNO`, "Por qué NO hay un campo de
   * paciente/DNI"). El parámetro existe para que la REGLA quede escrita y
   * probada: si algún día llega un DNI por otro camino, ya está definido que
   * solo puede corroborar.
   */
  dniDetectado?: string | null
  /** `profiles.dni`. Mismo comentario que `dniDetectado`. */
  dniPerfil?: string | null
}

/** El veredicto y las dos señales que lo produjeron, para poder explicarlo. */
export interface ResultadoTitularidad {
  veredicto: VeredictoTitularidad
  nombre: SenalNombre
  dni: SenalDni
}

/**
 * ¿Este documento es de la persona del perfil de destino?
 *
 * **La regla, entera:** decide el NOMBRE; el DNI solo corrobora.
 *
 * | nombre \ DNI | coincide | difiere | sin dato |
 * |---|---|---|---|
 * | **exacto**   | coincide    | a_confirmar | coincide    |
 * | **truncado** | coincide    | a_confirmar | a_confirmar |
 * | **no_calza** | a_confirmar | no_coincide | no_coincide |
 * | **ausente / código** | indeterminado | indeterminado | indeterminado |
 *
 * Lo que la tabla dice, en palabras:
 *
 * - **El DNI nunca rechaza solo.** Con el nombre exacto y el DNI distinto, el
 *   veredicto baja a `a_confirmar` -una pregunta-, jamás a `no_coincide`. Ese
 *   es el caso de la placa de baja resolución donde el lector leyó `31479089`
 *   por `31473089`.
 * - **El truncamiento tampoco rechaza solo.** `GREGORI` por `GREGORIO` sale
 *   `a_confirmar` si no hay DNI, y `coincide` si el DNI corrobora.
 * - **Hacen falta DOS señales en contra** para decir `no_coincide`: el nombre
 *   que no calza más un DNI que tampoco. Con el nombre que no calza y un DNI
 *   que SÍ corrobora, queda `a_confirmar`.
 * - **Un código no es una negativa.** `MDAHE15061985` da `indeterminado`, que
 *   se le muestra a la persona como "no dice a nombre de quién viene".
 *
 * Y una aclaración que vale para toda la tabla: **ningún veredicto descarta el
 * documento**. `coincide` es el único que habilita la carga automática; los
 * otros tres mandan el correo a la bandeja de revisión, donde la persona
 * decide. La diferencia entre ellos es la frase que ella lee.
 */
export function evaluarTitularidad(entrada: EntradaTitularidad): ResultadoTitularidad {
  const nombre = evaluarNombre(entrada.nombreDetectado ?? "", entrada.nombrePerfil)
  const dni = evaluarDni(entrada.dniDetectado, entrada.dniPerfil)

  if (nombre === "ausente" || nombre === "codigo") {
    return { veredicto: "indeterminado", nombre, dni }
  }

  if (nombre === "exacto") {
    return { veredicto: dni === "difiere" ? "a_confirmar" : "coincide", nombre, dni }
  }

  if (nombre === "truncado") {
    return { veredicto: dni === "coincide" ? "coincide" : "a_confirmar", nombre, dni }
  }

  // nombre === "no_calza"
  return { veredicto: dni === "coincide" ? "a_confirmar" : "no_coincide", nombre, dni }
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
