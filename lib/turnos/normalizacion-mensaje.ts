/**
 * Normalización PURA de los fragmentos que Gemini extrae de un mensaje de
 * turno pegado desde WhatsApp (Sprint 16, tarea 16.4 — "pegá el mensaje de la
 * clínica"). Sin React, sin `server-only`, sin llamadas de red: se puede
 * testear con strings de ejemplo sin mockear nada
 * (`tests/unit/normalizacion-mensaje-turno.test.ts`).
 *
 * ## Por qué el cálculo de fecha/hora vive ACÁ y no se lo pedimos a Gemini
 *
 * `lib/gemini/prompt-turno.ts` le pide al modelo que copie la fecha, la hora
 * y el día de la semana TAL COMO aparecen en el texto -sin convertir, sin
 * completar el año, sin normalizar el separador de la hora-. La aritmética de
 * calendario (inferir a qué año futuro corresponde un "14/7" sin año, cotejar
 * si esa fecha realmente cae martes) se resuelve acá, con `Date` real, no
 * pidiéndole a un modelo de lenguaje que haga cuentas: un LLM puede errar un
 * cálculo de calendario con total confianza y sin avisar, y acá el resultado
 * es DETERMINÍSTICO y testeable con casos fijos. Mismo espíritu que la regla
 * del proyecto sobre `DateTimeImmutable::createFromFormat` con el bang -la
 * fecha se calcula explícitamente, nunca se asume-.
 */

const PATRON_HORA_FINAL = /^([01]\d|2[0-3]):[0-5]\d$/
const PATRON_FECHA_CON_ANIO = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
const PATRON_FECHA_SIN_ANIO = /^(\d{1,2})\/(\d{1,2})$/

/**
 * Normaliza la hora cruda que extrajo Gemini ("14:15 HS", "18.10hs", "09:45
 * hs", "15:21") a `HH:mm` de 24 horas. Devuelve `""` si el texto está vacío o
 * no se puede interpretar con confianza -nunca inventa una hora-.
 */
export function normalizarHora(horaTexto: string): string {
  let texto = horaTexto.trim()
  if (texto.length === 0) return ""

  // Saca el sufijo "hs"/"HS"/"Hs"/"hrs" (con o sin espacio antes), típico de
  // los mensajes de WhatsApp de clínicas ("14:15 HS", "09:45 hs").
  texto = texto.replace(/\s*h(s|rs)?\.?\s*$/i, "").trim()

  // Punto decimal como separador de hora/minuto ("18.10" → "18:10") — trampa
  // documentada del fixture de confirmación de Casa Salud.
  texto = texto.replace(/^(\d{1,2})\.(\d{2})$/, "$1:$2")

  // Hora de un solo dígito ("9:45" → "09:45"), defensivo: ningún fixture lo
  // trae, pero `PATRON_HORA_FINAL` lo exige.
  texto = texto.replace(/^(\d):/, "0$1:")

  return PATRON_HORA_FINAL.test(texto) ? texto : ""
}

function fechaValidaComoCalendario(anio: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false
  const fecha = new Date(anio, mes - 1, dia)
  return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia
}

function formatearIso(anio: number, mes: number, dia: number): string {
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
}

export interface FechaArgentinaParseada {
  /** `YYYY-MM-DD`. */
  fecha: string
  /** `true` si el texto original no traía año y se infirió la próxima ocurrencia futura. */
  anioInferido: boolean
}

/**
 * Parsea una fecha argentina (`DD/MM/AAAA` o `DD/MM`, día siempre antes que
 * mes) tal como la extrae Gemini. Devuelve `null` si el texto no matchea
 * ninguno de los dos formatos o no es una fecha real de calendario.
 *
 * Sin año: se infiere la PRÓXIMA ocurrencia futura (`anioInferido: true`) -si
 * el día/mes de este año todavía no pasó (incluido HOY), se usa este año; si
 * ya pasó, el que viene-. `ahora` es inyectable para que los tests fijen
 * "hoy" sin depender del reloj real.
 */
export function parsearFechaArgentina(
  fechaTexto: string,
  ahora: Date = new Date(),
): FechaArgentinaParseada | null {
  const texto = fechaTexto.trim()
  if (texto.length === 0) return null

  const conAnio = texto.match(PATRON_FECHA_CON_ANIO)
  if (conAnio) {
    const dia = Number(conAnio[1])
    const mes = Number(conAnio[2])
    const anio = Number(conAnio[3])
    if (!fechaValidaComoCalendario(anio, mes, dia)) return null
    return { fecha: formatearIso(anio, mes, dia), anioInferido: false }
  }

  const sinAnio = texto.match(PATRON_FECHA_SIN_ANIO)
  if (sinAnio) {
    const dia = Number(sinAnio[1])
    const mes = Number(sinAnio[2])

    let anio = ahora.getFullYear()
    if (!fechaValidaComoCalendario(anio, mes, dia)) return null

    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
    const candidata = new Date(anio, mes - 1, dia)
    if (candidata.getTime() < hoy.getTime()) {
      anio += 1
      // Defensivo: un 29/2 cuyo "año actual" era bisiesto pero el próximo no
      // lo es. No hay fixture que lo ejercite, pero no hay que inventar una
      // fecha inexistente.
      if (!fechaValidaComoCalendario(anio, mes, dia)) return null
    }

    return { fecha: formatearIso(anio, mes, dia), anioInferido: true }
  }

  return null
}

const DIAS_SEMANA_ES = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] as const

/** Nombres largos (con tilde) de cada clave de `DIAS_SEMANA_ES`, para armar avisos legibles. */
export const NOMBRE_DIA_SEMANA_LARGO: Record<(typeof DIAS_SEMANA_ES)[number], string> = {
  domingo: "domingo",
  lunes: "lunes",
  martes: "martes",
  miercoles: "miércoles",
  jueves: "jueves",
  viernes: "viernes",
  sabado: "sábado",
}

// Bloque Unicode "Combining Diacritical Marks" (los acentos que NFD deja
// sueltos), escrito con escapes \uXXXX a propósito -mismo criterio que
// `MARCAS_COMBINANTES` en `lib/lugares/normalizar.ts`-: un carácter
// combinante literal en el código fuente se pega visualmente al vecino y
// vuelve ilegible el diff.
const MARCAS_COMBINANTES = /[\u0300-\u036f]/g

function normalizarPalabra(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(MARCAS_COMBINANTES, "")
    .toLowerCase()
    .trim()
}

/** Día de la semana (sin tilde, minúscula) de una fecha `YYYY-MM-DD`. */
export function nombreDiaSemana(fechaIso: string): (typeof DIAS_SEMANA_ES)[number] {
  const [anio, mes, dia] = fechaIso.split("-").map(Number)
  const fecha = new Date(anio, mes - 1, dia)
  return DIAS_SEMANA_ES[fecha.getDay()]
}

/**
 * Coteja el día de la semana que dice el mensaje ("martes", "Mie", con o sin
 * tilde) contra el que realmente le corresponde a `fechaIso`.
 *
 * - `true`: coincide (o `diaSemanaTexto` es una abreviatura válida del real).
 * - `false`: discrepancia real -el mensaje se equivocó de día, o la fecha se
 *   interpretó mal-.
 * - `null`: no hay nada que cotejar (texto vacío o demasiado corto para
 *   identificar un día con confianza).
 */
export function cotejarDiaSemana(fechaIso: string, diaSemanaTexto: string): boolean | null {
  const normalizado = normalizarPalabra(diaSemanaTexto)
  if (normalizado.length < 3) return null

  const real = nombreDiaSemana(fechaIso)
  return real.startsWith(normalizado)
}

const SUFIJO_ADMINISTRATIVO = /\s*\(\s*[A-Za-zÁÉÍÓÚÑáéíóúñ]{1,4}\s*\)\s*$/
const PATRON_TITULO = /^(dr|dra|lic|prof)\.?\s+/i

export interface NombreProfesionalNormalizado {
  /** Nombre listo para mostrar: reordenado si el mensaje traía "Apellido, Nombre", sin sufijos administrativos. */
  texto: string
  /**
   * `true` cuando el texto NO trae coma ni tratamiento (Dr./Dra./etc.) y
   * tiene dos o más palabras sueltas: el orden Apellido/Nombre es
   * genuinamente ambiguo para un programa -y muchas veces también para una
   * persona sin contexto-, así que se deja tal cual en vez de arriesgar un
   * reordenamiento incorrecto, y se marca la duda para que la persona lo
   * confirme.
   */
  dudaOrden: boolean
}

/**
 * Normaliza el nombre de un profesional (o su forma "Apellido, Nombre") tal
 * como lo devuelve Gemini -que ya limpia mayúsculas/tildes y separa el rótulo
 * del campo, pero preserva la coma y el orden originales, ver
 * `lib/gemini/prompt-turno.ts`-.
 *
 * Reglas, en orden:
 * 1. Saca sufijos administrativos finales entre paréntesis (ej. "(C)").
 * 2. "Apellido, Nombre" (con o sin espacios irregulares alrededor de la
 *    coma): se reordena a "Nombre Apellido", sin duda.
 * 3. Con tratamiento al principio (Dr./Dra./Lic./Prof.): el resto ya está en
 *    orden natural, sin duda.
 * 4. Una sola palabra (solo apellido, ej. "Ardans"): nada que reordenar.
 * 5. Dos o más palabras sueltas sin coma ni tratamiento: orden ambiguo,
 *    `dudaOrden: true`.
 */
export function normalizarNombreProfesional(crudo: string): NombreProfesionalNormalizado {
  let texto = crudo.trim().replace(/\s+/g, " ")
  texto = texto.replace(SUFIJO_ADMINISTRATIVO, "").trim()

  if (texto.length === 0) {
    return { texto: "", dudaOrden: false }
  }

  const partesPorComa = texto.split(",")
  if (partesPorComa.length === 2) {
    const apellido = partesPorComa[0].trim()
    const nombre = partesPorComa[1].trim()
    if (apellido.length > 0 && nombre.length > 0) {
      return { texto: `${nombre} ${apellido}`, dudaOrden: false }
    }
  }

  if (PATRON_TITULO.test(texto)) {
    return { texto, dudaOrden: false }
  }

  const palabras = texto.split(" ").filter(Boolean)
  if (palabras.length <= 1) {
    return { texto, dudaOrden: false }
  }

  return { texto, dudaOrden: true }
}
