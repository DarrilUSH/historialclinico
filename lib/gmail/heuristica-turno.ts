/**
 * "¿Este correo parece un aviso de turno?" — heurística BARATA y PURA
 * (Sprint 17, tarea 17.2).
 *
 * ## Por qué existe: es un filtro de privacidad antes que uno de costo
 *
 * El analizador de la tarea 16.4 (`lib/turnos/analizar-mensaje.ts`) le manda el
 * texto a Gemini, que es un servicio de un tercero. Un barrido automático que
 * le mandara TODO lo que cae en la etiqueta estaría enviando afuera el cuerpo
 * de correos que quizás no tienen nada que ver con un turno -y que la persona
 * etiquetó por otro motivo-. Esta función es la puerta: **el cuerpo sale de la
 * aplicación solo si acá dio positivo**, y eso queda declarado en
 * `docs/minimizacion-datos.md` §10.6. El ahorro de cuota es la consecuencia
 * agradable, no el objetivo.
 *
 * ## Cómo decide
 *
 * Puntaje simple sobre el texto normalizado (minúsculas, sin tildes), con dos
 * familias de señales que tienen que darse JUNTAS:
 *
 * 1. **Palabras de turno** — "turno", "cita", "consultorio", "reprogram…",
 *    "sacar hora", "atencion", "orden medica"… Son las que dicen de qué habla
 *    el correo.
 * 2. **Una fecha o una hora** — `14/7`, `14/07/2026`, `9:45`, `18.10 hs`. Son
 *    las que distinguen un aviso concreto de una publicidad de la clínica que
 *    igual habla de "turnos online".
 *
 * Da positivo si hay al menos UNA palabra de turno Y (una fecha o una hora), o
 * si hay DOS palabras de turno distintas (un "le confirmamos su turno con el
 * profesional" sin fecha legible sigue siendo un aviso de turno: el analizador
 * lo va a marcar como "faltó la fecha", que es exactamente lo que la persona
 * necesita ver).
 *
 * ## Qué NO hace
 *
 * No intenta entender el mensaje: eso es trabajo de Gemini, y para eso está el
 * flujo de revisión de la 16.4 -que además nunca guarda solo-. Un falso
 * positivo cuesta una llamada a la IA y un ítem de más en la bandeja, que la
 * persona descarta de un toque. Un falso negativo cuesta que el correo aparezca
 * en la bandeja sin propuesta de turno; el ítem SIGUE ESTANDO, con su asunto y
 * su remitente, así que nada se pierde en silencio. Con ese reparto de costos,
 * el umbral se elige generoso hacia el positivo pero nunca tanto como para
 * mandar a Gemini cualquier cosa.
 *
 * Sin React, sin `server-only`, sin red: se prueba con strings
 * (`tests/unit/gmail-heuristica-turno.test.ts`).
 */

// Bloque Unicode "Combining Diacritical Marks", escrito con escapes a
// propósito (mismo criterio que `lib/turnos/normalizacion-mensaje.ts`).
const MARCAS_COMBINANTES = /[\u0300-\u036f]/g

/** Largo mínimo del cuerpo para siquiera mirarlo. Menos que esto no alcanza para un aviso. */
const MIN_LARGO = 20

/**
 * Las palabras que hablan de un turno. Van sin tildes porque el texto se
 * normaliza antes, y como fragmentos -no palabras completas- para que
 * "reprogram" cubra "reprograma", "reprogramación" y "reprogramado" sin tres
 * entradas.
 */
const PALABRAS_TURNO = [
  // Ojo al orden y a la superposición: los fragmentos NO pueden ser
  // subcadenas unos de otros. "turno" ya cubre "turnos", y tener las dos
  // hacía que una newsletter que dijera "sacá turnos online" contara DOS
  // señales distintas por la misma palabra y diera positivo sin fecha ni hora
  // -o sea, mandaba a Gemini el cuerpo de una publicidad-. Lo encontró
  // `tests/unit/gmail-heuristica-turno.test.ts`.
  "turno",
  "cita medica",
  "su cita",
  "consultorio",
  "reprogram",
  "reservado para",
  "le confirmamos",
  "confirmacion de su",
  "asignado el dia",
  "se asigna",
  "atencion el dia",
  "orden medica",
  "estudio programado",
  "presentarse",
  "concurrir",
  "profesional:",
  "especialidad:",
  "sacar numero",
  "recordatorio de su",
] as const

/**
 * Fechas `14/7`, `14/07`, `14/07/26`, `14/07/2026` y también "14 de julio".
 * El mes en letras entra porque muchos avisos lo escriben así y es la única
 * fecha que trae el correo.
 */
const PATRON_FECHA = /\b\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?\b/
const PATRON_FECHA_EN_LETRAS =
  /\b\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/

/** Horas `9:45`, `09:45`, `18.10 hs`, `14 hs`. */
const PATRON_HORA = /\b([01]?\d|2[0-3])\s*([:.]\s*[0-5]\d|\s*hs?\b)/

/** Texto en minúsculas y sin tildes, para comparar sin sorpresas. */
export function normalizarParaHeuristica(texto: string): string {
  return texto.normalize("NFD").replace(MARCAS_COMBINANTES, "").toLowerCase()
}

export interface SeniasDeTurno {
  /** Fragmentos de `PALABRAS_TURNO` encontrados (sin repetir). */
  palabras: string[]
  tieneFecha: boolean
  tieneHora: boolean
  /** El veredicto: `true` si vale la pena mandarle el cuerpo a Gemini. */
  pareceTurno: boolean
}

/**
 * Analiza el cuerpo y devuelve QUÉ se encontró, no solo el sí o el no: el
 * detalle es lo que hace depurable una heurística ("dio negativo porque no
 * encontró ninguna fecha") y es lo que muestran los tests cuando fallan.
 */
export function analizarSeniasDeTurno(cuerpo: string): SeniasDeTurno {
  const texto = normalizarParaHeuristica(cuerpo)

  if (texto.trim().length < MIN_LARGO) {
    return { palabras: [], tieneFecha: false, tieneHora: false, pareceTurno: false }
  }

  const palabras = PALABRAS_TURNO.filter((palabra) => texto.includes(palabra))
  const tieneFecha = PATRON_FECHA.test(texto) || PATRON_FECHA_EN_LETRAS.test(texto)
  const tieneHora = PATRON_HORA.test(texto)

  const pareceTurno =
    (palabras.length >= 1 && (tieneFecha || tieneHora)) || palabras.length >= 2

  return { palabras: [...palabras], tieneFecha, tieneHora, pareceTurno }
}

/** Atajo booleano de `analizarSeniasDeTurno`. Es lo que usa el barrido. */
export function pareceAvisoDeTurno(cuerpo: string): boolean {
  return analizarSeniasDeTurno(cuerpo).pareceTurno
}
