/**
 * Texto de los recordatorios de turnos (Sprint 6, tarea 6.4).
 *
 * Módulo **puro**: no lee la base, no manda nada, no mira el reloj por su
 * cuenta (recibe `ahora` como parámetro, igual que
 * `lib/turnos/tiempo-relativo.ts`). Todo lo que decide es qué va a leer una
 * persona en la pantalla bloqueada del celular, que es la única salida
 * observable de esta tarea. Por eso está separado del barrido
 * (`app/api/push/procesar-recordatorios/route.ts`) y cubierto por
 * `tests/unit/recordatorios-turnos.test.ts`.
 *
 * ## Las cuatro ventanas
 *
 * El roadmap fija 7 días / 48hs / 24hs / 3hs. La ventana la elige la base
 * (`generar_recordatorios_pendientes()`), que además garantiza una invariante
 * de la que este módulo depende: **nunca se emite una ventana más ancha
 * teniendo una más próxima vencida**. Un turno cargado dos horas antes genera
 * el aviso de 3hs y descarta los otros tres como `omitido`, en vez de disparar
 * cuatro notificaciones juntas.
 *
 * ## Por qué el texto no dice la ventana, sino el tiempo real
 *
 * La tentación es mapear `'3h'` → `"en 3 horas"` y listo. Está mal: la ventana
 * es el momento en que el aviso se vuelve *debido*, y el envío ocurre en la
 * corrida siguiente del cron (hasta 15 minutos después), o mucho más tarde si
 * la máquina estuvo apagada. "En 3 horas" para un turno que es en 40 minutos no
 * es un redondeo: es una notificación que hace llegar tarde a alguien.
 *
 * Así que la frase se calcula contra `ahora` de verdad. La ventana solo decide
 * **cómo** se mide: la de 3hs habla en horas (la persona ya se está por
 * mover), las otras tres hablan en días de calendario de Ushuaia -"mañana"
 * significa el día siguiente del almanaque, no "dentro de 24 horas", que es la
 * distinción que ya documenta `tiempo-relativo.ts`-.
 *
 * ## Zona horaria
 *
 * `appointment_date` es `timestamptz`. Todo lo que sea "qué día es" o "qué hora
 * dice el reloj de la pared" se resuelve con los formateadores de
 * `lib/turnos/fecha.ts`, anclados a `America/Argentina/Ushuaia`. El servidor
 * que corre el barrido puede estar en cualquier huso (Vercel, por ejemplo,
 * corre en UTC) y el texto tiene que salir igual.
 */

import { ZONA_HORARIA_TURNOS, fechaIsoUshuaia, horaUshuaia } from "@/lib/turnos/fecha"

/**
 * Las cuatro ventanas del roadmap. El literal es el mismo que guarda la
 * columna `appointment_reminders.ventana` (CHECK en la migración
 * `20260813050000_recordatorios_turnos.sql`): si acá se agrega una, hay que
 * agregarla también allá y al `offset` de la función SQL.
 */
export const VENTANAS_RECORDATORIO = ["7d", "48h", "24h", "3h"] as const

export type VentanaRecordatorio = (typeof VENTANAS_RECORDATORIO)[number]

/** Lo que el barrido necesita del turno para escribir el aviso. */
export interface TurnoParaRecordatorio {
  id: string
  /** `appointments.specialty`. NOT NULL y no vacío por CHECK en la base. */
  especialidad: string
  /** `appointments.appointment_date` (timestamptz serializado). */
  fechaIso: string
  /** `appointments.doctor_name`. Opcional: muchos turnos se cargan sin médico. */
  medico?: string | null
  /** `appointments.location_name`. */
  lugar?: string | null
  /** `appointments.preparation_notes` (ayuno, llevar estudios previos). */
  preparacion?: string | null
  /**
   * `appointments.profile_id`: A QUIÉN pertenece el turno.
   *
   * Sprint 6.6 (docs/recordatorios.md §9): sin esto, tocar la notificación
   * abre `/turnos` mostrando el perfil ACTIVO de quien la toca, no el del
   * turno -si María tiene su propio perfil activo y el aviso es de un turno
   * de Roberto, aterriza en una lista vacía-. Con `profileId`, la url lleva
   * `?perfil={profileId}` (ver `urlDelRecordatorio` más abajo) y
   * `/turnos/enlace` (`app/(app)/(con-nav)/turnos/enlace/route.ts`) cambia
   * el perfil activo ANTES de que se muestre la lista, revalidando el
   * permiso contra la base -nunca confía en que quien generó el push tenía
   * razón sobre a quién pertenece el turno-.
   *
   * Opcional PARA EL TIPO, no para el uso real: toda fila de `appointments`
   * tiene `profile_id NOT NULL`, y `app/api/push/procesar-recordatorios/route.ts`
   * siempre lo pasa. Queda opcional acá para no romper los tests de este
   * módulo puro que arman turnos mínimos sin esa columna -y porque un
   * `RecordatorioPush` sin perfil sigue siendo válido: simplemente abre
   * `/turnos` pelado, el comportamiento de antes del Sprint 6.6-.
   */
  profileId?: string
}

/** Payload listo para `enviarPushAUsuario()` (`lib/push/servidor.ts`). */
export interface RecordatorioPush {
  titulo: string
  cuerpo: string
  url: string
  tag: string
}

/**
 * Ruta que abre la notificación.
 *
 * Es la LISTA, no el turno: el proyecto todavía no tiene una pantalla de
 * detalle (`app/(app)/(con-nav)/turnos/` tiene `page.tsx`, `nuevo/` y
 * `[id]/editar/`). Mandar a `/turnos/{id}` daría un 404 justo cuando la
 * persona más confía en el aviso. Cuando exista el detalle, se cambia acá y en
 * ningún otro lado.
 */
export const RUTA_RECORDATORIO = "/turnos"

/**
 * Arma la url final del payload: `RUTA_RECORDATORIO`, y si el turno trae
 * `profileId`, con `?perfil={profileId}` (Sprint 6.6). `encodeURIComponent`
 * es defensivo -un uuid no tiene caracteres que escapar-, no una validación:
 * la validación de verdad (¿es un uuid?, ¿hay permiso `view`?) la hace
 * `requerirPermiso` del lado de `/turnos/enlace`, nunca acá. Este módulo es
 * puro y no tiene forma de preguntarle nada a la base.
 */
function urlDelRecordatorio(profileId: string | undefined): string {
  return profileId
    ? `${RUTA_RECORDATORIO}?perfil=${encodeURIComponent(profileId)}`
    : RUTA_RECORDATORIO
}

/**
 * Tope del texto de preparación dentro del cuerpo. Una notificación es un
 * titular: si la indicación no entra, la persona abre la app y la lee completa.
 */
const MAX_PREPARACION = 90

/** Umbral por debajo del cual no se dice un número de horas, sino "menos de una hora". */
const MINUTOS_MENOS_DE_UNA_HORA = 45

/** "jueves 21 de agosto" — sin año: ninguna ventana mira más allá de 7 días. */
const FORMATO_DIA_Y_FECHA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA_TURNOS,
  weekday: "long",
  day: "numeric",
  month: "long",
})

/**
 * Diferencia en DÍAS DE CALENDARIO de Ushuaia (no una resta de milisegundos).
 * Mismo cálculo que `lib/turnos/tiempo-relativo.ts`: reduce los dos instantes
 * a `YYYY-MM-DD` en la zona del proyecto y recién ahí resta, de modo que
 * `Date.UTC` no reintroduce el problema de huso que se está evitando.
 */
function diferenciaEnDias(fecha: Date, ahora: Date): number {
  const [anioF, mesF, diaF] = fechaIsoUshuaia(fecha).split("-").map(Number)
  const [anioA, mesA, diaA] = fechaIsoUshuaia(ahora).split("-").map(Number)

  return Math.round(
    (Date.UTC(anioF, mesF - 1, diaF) - Date.UTC(anioA, mesA - 1, diaA)) / (24 * 60 * 60 * 1000),
  )
}

/** "jueves 21 de agosto", sin la coma que `es-AR` mete después del día. */
function diaYFecha(fecha: Date): string {
  return FORMATO_DIA_Y_FECHA.format(fecha).replace(",", "")
}

function conMayusculaInicial(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase("es-AR") + texto.slice(1)
}

/**
 * "cuánto falta" para el TÍTULO, calculado contra `ahora` real.
 *
 * - Ventana de 3hs → horas, redondeadas al entero más cercano ("en 3 horas"
 *   para 2h50m, que es como lo diría una persona), con piso en "en 1 hora" y
 *   un caso aparte para menos de 45 minutos.
 * - Las otras tres → días de calendario. Exactamente 7 días se dice "en una
 *   semana", que es más natural que "en 7 días" y es el caso normal de esa
 *   ventana.
 *
 * El caso `<= 0` (el turno ya pasó) no debería llegar nunca: la generación
 * solo mira turnos futuros. Si llegara -reloj corrido, barrido demorado
 * horas-, decir "ahora" es preferible a "en 0 horas" o a un número negativo.
 */
export function fraseDeAnticipacion(
  ventana: VentanaRecordatorio,
  fechaIso: string,
  ahora: Date = new Date(),
): string {
  const fecha = new Date(fechaIso)

  if (ventana === "3h") {
    const minutos = Math.round((fecha.getTime() - ahora.getTime()) / 60_000)
    if (minutos <= 0) return "ahora"
    if (minutos < MINUTOS_MENOS_DE_UNA_HORA) return "en menos de una hora"

    const horas = Math.max(1, Math.round(minutos / 60))
    return horas === 1 ? "en 1 hora" : `en ${horas} horas`
  }

  const dias = diferenciaEnDias(fecha, ahora)
  if (dias <= 0) return "hoy"
  if (dias === 1) return "mañana"
  if (dias === 2) return "pasado mañana"
  if (dias === 7) return "en una semana"
  return `en ${dias} días`
}

/**
 * Cuerpo de la notificación: la fecha y hora exactas primero, y después el
 * contexto que evita una llamada telefónica ("¿con quién era?", "¿dónde?").
 *
 * El día se omite cuando el turno es hoy -"Hoy a las 10:30" en vez de "Jueves
 * 21 de agosto a las 10:30", que obliga a mirar el almanaque para entender que
 * es en un rato-.
 *
 * La preparación (`ayuno`, `llevar estudios previos`) entra **solo en las
 * ventanas cortas**: a 7 días no sirve de nada y ocupa el renglón que se lee
 * de un vistazo, mientras que a 24hs es la razón por la que el aviso existe
 * (el ayuno empieza la noche anterior).
 */
export function cuerpoDeRecordatorio(
  turno: TurnoParaRecordatorio,
  ventana: VentanaRecordatorio,
  ahora: Date = new Date(),
): string {
  const fecha = new Date(turno.fechaIso)
  const hora = horaUshuaia(fecha)
  const esHoy = diferenciaEnDias(fecha, ahora) === 0

  const partes: string[] = [
    esHoy ? `Hoy a las ${hora}` : `${conMayusculaInicial(diaYFecha(fecha))} a las ${hora}`,
  ]

  const medico = turno.medico?.trim()
  if (medico) partes.push(medico)

  const lugar = turno.lugar?.trim()
  if (lugar) partes.push(lugar)

  if (ventana === "24h" || ventana === "3h") {
    const preparacion = turno.preparacion?.trim().replace(/\s+/g, " ")
    if (preparacion) {
      partes.push(
        preparacion.length > MAX_PREPARACION
          ? `${preparacion.slice(0, MAX_PREPARACION - 1).trimEnd()}…`
          : preparacion,
      )
    }
  }

  return partes.join(" · ")
}

/**
 * Arma el aviso completo.
 *
 * `tag` sigue la convención de `docs/push.md` §7 (`turno-{id}-{ventana}`): es
 * la antiduplicación **del lado del dispositivo**, la última red de seguridad
 * si el barrido llegara a repetir un envío. La antiduplicación real -no volver
 * a mandar lo ya mandado- la garantiza el `UNIQUE (appointment_id, ventana)`
 * de la base.
 *
 * `url` lleva `?perfil={turno.profileId}` cuando el turno trae ese dato (ver
 * `urlDelRecordatorio` y el comentario de `profileId` en
 * `TurnoParaRecordatorio`, Sprint 6.6). Sin `profileId` -los tests de este
 * módulo que arman turnos mínimos- la url es `RUTA_RECORDATORIO` pelada,
 * igual que antes del Sprint 6.6.
 */
export function construirRecordatorio(
  turno: TurnoParaRecordatorio,
  ventana: VentanaRecordatorio,
  ahora: Date = new Date(),
): RecordatorioPush {
  const especialidad = turno.especialidad.trim()

  return {
    titulo: `Turno de ${especialidad} ${fraseDeAnticipacion(ventana, turno.fechaIso, ahora)}`,
    cuerpo: cuerpoDeRecordatorio(turno, ventana, ahora),
    url: urlDelRecordatorio(turno.profileId),
    tag: `turno-${turno.id}-${ventana}`,
  }
}
