/**
 * Edad en años a partir de `profiles.date_of_birth` (Sprint 8, tarea 8.3 —
 * la ficha SOS es el primer lugar de la app que necesita mostrar la edad).
 *
 * ## El equivalente TypeScript del bang pattern (regla global del usuario)
 *
 * La regla global sobre `DateTimeImmutable::createFromFormat` advierte contra
 * parsear una fecha PURA (`Y-m-d`, sin hora) y compararla contra "hoy": sin el
 * bang (`!Y-m-d`), PHP completa la hora faltante con la hora ACTUAL del
 * momento en que se llama, no con medianoche, y esa hora fantasma corre la
 * edad un año de más o de menos según a qué hora del día se abra la pantalla.
 *
 * TypeScript no tiene ese bug puntual -`new Date("1945-11-03")` (formato ISO
 * sin hora) se parsea a medianoche UTC por especificación (ECMA-262 §21.4.3.2),
 * nunca a la hora actual del proceso-, pero comparar dos `Date` para restar
 * años igual arrastra un problema del mismo origen: qué "hoy" se usa. `new
 * Date()` toma la hora del proceso, que puede estar en cualquier huso, y esta
 * app opera en `America/Argentina/Ushuaia` (UTC-3, ver `lib/turnos/fecha.ts`).
 * Restar instantes UTC en vez de comparar el CALENDARIO puede correr el
 * cumpleaños un día en cualquiera de las dos direcciones cerca de la
 * medianoche de Ushuaia.
 *
 * La forma de no tener ninguna de las dos clases de bug es no pasar nunca por
 * un instante: se parsean los tres enteros (año, mes, día) del string
 * `date_of_birth` a mano, se calcula "hoy" en Ushuaia con `Intl.DateTimeFormat`
 * (mismo criterio que `lib/turnos/fecha.ts#hoyIsoUshuaia`) y se restan como
 * enteros de calendario, nunca como milisegundos.
 */

/** Misma zona que el resto de la app (`lib/turnos/fecha.ts`, `lib/sos/frescura.ts`). */
const ZONA_HORARIA_EDAD = "America/Argentina/Ushuaia"

/** `YYYY-MM-DD` de "hoy" en la zona del proyecto. */
const FORMATO_FECHA_ISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA_EDAD,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Calcula la edad en años a partir de `profiles.date_of_birth`.
 *
 * @param fechaNacimiento Valor crudo de la columna (`date` de Postgres,
 *   `"YYYY-MM-DD"`), o `null` si nunca se cargó.
 * @param ahora Instante a usar como "hoy". Parámetro de test -en producción
 *   se omite y usa el reloj real-; se convierte a la fecha de calendario de
 *   Ushuaia antes de comparar, así que a quien llama no le hace falta pasar
 *   ya un instante corregido de huso.
 * @returns La edad en años cumplidos, o `null` si no hay fecha de nacimiento,
 *   el string no tiene forma `YYYY-MM-DD`, o la fecha cae en el futuro (dato
 *   inconsistente: se trata como ausente, nunca como una edad negativa).
 */
export function calcularEdad(
  fechaNacimiento: string | null,
  ahora: Date = new Date(),
): number | null {
  if (!fechaNacimiento || !PATRON_FECHA.test(fechaNacimiento)) {
    return null
  }

  const [anioNac, mesNac, diaNac] = fechaNacimiento.split("-").map(Number)

  const hoyIso = FORMATO_FECHA_ISO.format(ahora)
  const [anioHoy, mesHoy, diaHoy] = hoyIso.split("-").map(Number)

  if (
    anioNac > anioHoy ||
    (anioNac === anioHoy && (mesNac > mesHoy || (mesNac === mesHoy && diaNac > diaHoy)))
  ) {
    // Fecha de nacimiento en el futuro: dato inconsistente, no una edad
    // negativa. No debería poder ocurrir -el formulario que la carga no lo
    // permite-, pero la ficha SOS no puede reventar por un dato escrito por
    // fuera de la app.
    return null
  }

  let edad = anioHoy - anioNac
  const todaviaNoCumpleEsteAnio =
    mesHoy < mesNac || (mesHoy === mesNac && diaHoy < diaNac)
  if (todaviaNoCumpleEsteAnio) {
    edad -= 1
  }

  return edad
}
