/**
 * Utilidades de fecha/hora de `appointments`, todas ancladas a la zona
 * horaria `America/Argentina/Ushuaia` (Sprint 6, tarea 6.1).
 *
 * `appointment_date` es `timestamptz` (comentario de la columna en
 * `supabase/migrations/20260812200000_schema_inicial.sql`): "la app trabaja
 * con la zona America/Argentina/Ushuaia y convierte en el borde, nunca guarda
 * hora local sin zona". Acá vive ESE borde: el formulario junta una fecha
 * (`<input type="date">`) y una hora (`<input type="time">`) -dos strings de
 * reloj de pared sin zona-, y este módulo es el único lugar que las combina
 * en un instante UTC real antes de que la Server Action las inserte.
 *
 * Igual que `lib/documentos/ingesta.ts` y `familia/accesos/page.tsx`, el
 * servidor puede estar corriendo en cualquier huso: fijar la zona acá,
 * explícitamente, es lo que evita que un turno cargado a las 23:30 de Ushuaia
 * termine con la fecha del día siguiente por asumir la zona del proceso.
 */

export const ZONA_HORARIA_TURNOS = "America/Argentina/Ushuaia"

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/
const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/** `YYYY-MM-DD` en la zona del proyecto. `en-CA` da directamente ese orden. */
const FORMATO_FECHA_ISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA_TURNOS,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** `HH:mm` de 24 horas en la zona del proyecto. */
const FORMATO_HORA = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONA_HORARIA_TURNOS,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/**
 * Offset UTC vigente de Ushuaia en el instante `fecha`, como `"-03:00"`.
 *
 * Argentina no tiene horario de verano desde 2009: el offset es fijo todo el
 * año. Igual se calcula con `Intl` en vez de escribir el literal `-03:00` a
 * mano -mismo espíritu que la regla del proyecto sobre `createFromFormat`
 * con fechas puras: que el cálculo sea explícito y verificable en vez de una
 * constante que alguien puede olvidar si el dato de entrada cambia-. Si el
 * runtime no soporta `timeZoneName: "longOffset"` (ningún target del
 * proyecto, pero por las dudas), cae al literal fijo.
 */
function offsetUshuaia(fecha: Date): string {
  try {
    const formateador = new Intl.DateTimeFormat("en-US", {
      timeZone: ZONA_HORARIA_TURNOS,
      timeZoneName: "longOffset",
    })
    const parte = formateador.formatToParts(fecha).find((p) => p.type === "timeZoneName")?.value
    const coincidencia = parte?.match(/GMT([+-]\d{2}:\d{2})/)
    return coincidencia?.[1] ?? "-03:00"
  } catch {
    return "-03:00"
  }
}

/**
 * Combina una fecha (`YYYY-MM-DD`) y una hora (`HH:mm`), ambas hora de pared
 * de Ushuaia, en el instante UTC real que representan.
 *
 * Devuelve `null` si el formato no es válido o si la fecha no existe como
 * calendario (por ejemplo "2026-02-30") -mismo criterio de
 * `lib/validacion/confirmacion-documento.schema.ts#validarFechaEstudio`-.
 */
export function combinarFechaHoraUshuaia(fecha: string, hora: string): Date | null {
  if (!PATRON_FECHA.test(fecha) || !PATRON_HORA.test(hora)) {
    return null
  }

  const [anio, mes, dia] = fecha.split("-").map(Number)
  const [horas, minutos] = hora.split(":").map(Number)

  // Primera aproximación tratando el reloj de pared como si fuera UTC, solo
  // para preguntarle a `Intl` qué offset corresponde a esa fecha del año.
  const aproximada = new Date(Date.UTC(anio, mes - 1, dia, horas, minutos))
  if (Number.isNaN(aproximada.getTime())) return null

  const offset = offsetUshuaia(aproximada)
  const real = new Date(
    `${fecha}T${hora}:00${offset}`,
  )
  if (Number.isNaN(real.getTime())) return null

  // Rechaza fechas inexistentes ("2026-02-30" se normaliza a marzo si no se
  // valida el roundtrip): se reconstruye la fecha en la MISMA zona y se
  // compara contra lo pedido.
  const anioReal = Number(FORMATO_FECHA_ISO.format(real).slice(0, 4))
  const mesReal = Number(FORMATO_FECHA_ISO.format(real).slice(5, 7))
  const diaReal = Number(FORMATO_FECHA_ISO.format(real).slice(8, 10))
  if (anioReal !== anio || mesReal !== mes || diaReal !== dia) return null

  return real
}

/** `YYYY-MM-DD` de `fecha` en la zona del proyecto. */
export function fechaIsoUshuaia(fecha: Date): string {
  return FORMATO_FECHA_ISO.format(fecha)
}

/** `HH:mm` de `fecha` en la zona del proyecto. */
export function horaUshuaia(fecha: Date): string {
  return FORMATO_HORA.format(fecha)
}

/** Atajo de `fechaIsoUshuaia(new Date())`, para precargar/acotar inputs `date`. */
export function hoyIsoUshuaia(ahora: Date = new Date()): string {
  return fechaIsoUshuaia(ahora)
}
