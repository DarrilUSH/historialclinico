/**
 * Frescura de la ficha SOS: cómo se muestra `profiles.sos_updated_at`
 * (Sprint 8, tarea 8.2). Contrato completo en `docs/modelo-sos.md` §6.
 *
 * Vive en su propio módulo -y no dentro de la página de edición- porque hay
 * TRES consumidores del mismo dato y tienen que decir exactamente lo mismo:
 * la pantalla de edición (8.2), la ficha SOS (8.3) y el indicador de
 * conexión / última sincronización (8.5). Que cada uno arme su propio
 * `Intl.DateTimeFormat` es la forma segura de que en tres pantallas se lea
 * la misma revisión con tres formatos distintos.
 *
 * **`null` significa "nunca se cargó ningún dato SOS", no "hoy".** El trigger
 * `set_sos_updated_at` solo escribe la columna cuando alguna columna SOS
 * cambia de verdad, así que un perfil recién creado la tiene en `NULL` y hay
 * que decirlo con esas palabras: mostrar la fecha de creación del perfil, o
 * peor, la de hoy, le haría creer a quien lee la ficha que los datos fueron
 * revisados cuando nunca existieron.
 */

/** Toda la app opera en la hora de Ushuaia (mismo criterio que `lib/medicacion/formato-toma.ts`). */
const ZONA_HORARIA_SOS = "America/Argentina/Ushuaia"

/** "12/08/2026 14:30". Numérico y corto: es un sello de frescura, no una fecha para leer en voz alta. */
const FORMATO_REVISION = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA_SOS,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** Espacios que ICU intercala y que hay que normalizar: NO-BREAK SPACE y NARROW NO-BREAK SPACE. */
const ESPACIOS_INVISIBLES = /[  ]/g

/**
 * Formatea `profiles.sos_updated_at` para mostrarlo.
 *
 * @param sosUpdatedAt Valor crudo de la columna (timestamptz en ISO), o
 *   `null` si nunca se cargó ningún dato SOS.
 * @returns La fecha y hora de la última revisión, o `null` si no hubo
 *   ninguna. Quien llama decide la frase que la envuelve ("Revisada el ...",
 *   "Datos actualizados el ..."): el texto cambia según la pantalla, el
 *   formato no.
 */
export function formatearRevisionSos(sosUpdatedAt: string | null): string | null {
  if (!sosUpdatedAt) return null

  const fecha = new Date(sosUpdatedAt)
  if (Number.isNaN(fecha.getTime())) return null

  // Dos normalizaciones para que el string sea idéntico en el servidor y en
  // el cliente, y para que un test no falle por un carácter invisible: ICU
  // separa con NBSP o NNBSP según la versión, y `es-AR` mete una coma entre
  // fecha y hora que acá no agrega nada.
  return FORMATO_REVISION.format(fecha)
    .replace(ESPACIOS_INVISIBLES, " ")
    .replace(/,\s+/, " ")
}
