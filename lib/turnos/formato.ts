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

export function formatearFechaLargaTurno(fechaIso: string): string {
  return FORMATO_FECHA_LARGA.format(new Date(fechaIso))
}

export function formatearFechaCortaTurno(fechaIso: string): string {
  return FORMATO_FECHA_CORTA.format(new Date(fechaIso))
}

export function formatearHoraTurno(fechaIso: string): string {
  return FORMATO_HORA.format(new Date(fechaIso))
}
