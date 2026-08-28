/**
 * Formato ABSOLUTO de fecha/hora de un turno (complementa a
 * `lib/turnos/tiempo-relativo.ts`, que da el "cuánto falta"). Se usa donde la
 * fecha/hora tiene que verse GRANDE y sin ambigüedad -`tarjeta-turno.tsx`
 * ("los mayores necesitan verla grande", tarea 6.1 del roadmap) y el
 * encabezado de `/turnos/[id]/editar`-, siempre en
 * `America/Argentina/Ushuaia`.
 */

import { ZONA_HORARIA_TURNOS } from "@/lib/turnos/fecha"

/** "13 de agosto de 2026". Sin día de la semana: la tarjeta ya lo puede inferir del propio calendario del dispositivo si hace falta, y agregarlo acá alargaría el renglón grande. */
const FORMATO_FECHA_LARGA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA_TURNOS,
  day: "numeric",
  month: "long",
  year: "numeric",
})

/** "10:30", 24 horas. */
const FORMATO_HORA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA_TURNOS,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** "13 ago" (Sprint 14, tanda A): la versión corta para la fila densa de `tarjeta-turno.tsx` en modo chica -combinada con la hora en un solo renglón, ver el comentario de cabecera de ese componente-. Sin año: el mismo criterio que ya regía en `FORMATO_FECHA_LARGA` (un turno de `/turnos` nunca es de otro año, y si lo fuera, `tiempoRelativo` ya lo deja claro en lenguaje natural). */
const FORMATO_FECHA_CORTA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA_TURNOS,
  day: "numeric",
  month: "short",
})

/**
 * "martes 25 de agosto de 2026". CON día de la semana, a diferencia de
 * `FORMATO_FECHA_LARGA`: se usa en la lista de confirmación de un mensaje con
 * varias sesiones (`components/turnos/analizador-mensaje-turno.tsx`), donde
 * diez fechas seguidas del mismo mes se distinguen mucho mejor por el día de
 * la semana que por el número, y donde además es la señal que deja detectar
 * de un vistazo que una sesión cayó en un día raro.
 */
const FORMATO_FECHA_CON_DIA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA_TURNOS,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
})

export function formatearFechaLargaTurno(fechaIso: string): string {
  return FORMATO_FECHA_LARGA.format(new Date(fechaIso))
}

/** "martes 25 de agosto de 2026", sin la coma que `es-AR` mete después del día de la semana. */
export function formatearFechaConDiaTurno(fechaIso: string): string {
  return FORMATO_FECHA_CON_DIA.format(new Date(fechaIso)).replace(",", "")
}

export function formatearFechaCortaTurno(fechaIso: string): string {
  return FORMATO_FECHA_CORTA.format(new Date(fechaIso))
}

export function formatearHoraTurno(fechaIso: string): string {
  return FORMATO_HORA.format(new Date(fechaIso))
}
