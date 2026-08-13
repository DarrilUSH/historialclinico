/**
 * "Cuánto falta" en lenguaje natural para un turno, en español y anclado a
 * `America/Argentina/Ushuaia` (Sprint 6, tarea 6.1 — ROADMAP_SPRINTS.md).
 *
 * Pensado para adultos mayores: la pregunta no es "¿cuántas horas exactas
 * faltan?" sino "¿es hoy, es mañana, o falta bastante?" -por eso la
 * clasificación es por DÍA DE CALENDARIO en Ushuaia, no por una resta de
 * milisegundos entre dos instantes. Ejemplo concreto: si son las 23:50 de
 * hoy y el turno es a las 00:10 de mañana, faltan 20 minutos de reloj pero la
 * respuesta correcta para esta pantalla es "mañana", no "en unos minutos" -es
 * el turno de otro día-.
 *
 * Función pura y testeable (`tests/unit/tiempo-relativo.test.ts`): recibe
 * `ahora` como parámetro en vez de leer `new Date()` internamente, mismo
 * patrón que el resto de los helpers puros del proyecto que dependen del
 * momento actual.
 */

import { fechaIsoUshuaia, horaUshuaia } from "@/lib/turnos/fecha"

/**
 * Diferencia en días de calendario (Ushuaia) entre dos instantes: positiva
 * si `fecha` es posterior a `ahora`, negativa si es anterior. Se calcula
 * sobre las dos fechas YA reducidas a `YYYY-MM-DD` en la zona del proyecto
 * -por eso `Date.UTC` acá adentro es seguro y no reintroduce el bug de huso
 * horario: no queda ninguna hora de por medio, son dos calendarios enteros-.
 */
function diferenciaEnDias(fecha: Date, ahora: Date): number {
  const isoFecha = fechaIsoUshuaia(fecha)
  const isoAhora = fechaIsoUshuaia(ahora)

  const [anioF, mesF, diaF] = isoFecha.split("-").map(Number)
  const [anioA, mesA, diaA] = isoAhora.split("-").map(Number)

  const utcFecha = Date.UTC(anioF, mesF - 1, diaF)
  const utcAhora = Date.UTC(anioA, mesA - 1, diaA)

  return Math.round((utcFecha - utcAhora) / (24 * 60 * 60 * 1000))
}

/**
 * `fechaIso`: `appointment_date` tal como viene de la base (timestamptz,
 * cualquier formato que `Date` sepa parsear). `ahora`: el "hoy" contra el que
 * se compara, default `new Date()` -se puede fijar en los tests para no
 * depender del reloj real-.
 */
export function tiempoRelativo(fechaIso: string, ahora: Date = new Date()): string {
  const fecha = new Date(fechaIso)
  const diasDeDiferencia = diferenciaEnDias(fecha, ahora)

  if (diasDeDiferencia === 0) {
    return `hoy a las ${horaUshuaia(fecha)}`
  }
  if (diasDeDiferencia === 1) {
    return "mañana"
  }
  if (diasDeDiferencia > 1) {
    return `en ${diasDeDiferencia} días`
  }
  if (diasDeDiferencia === -1) {
    return "ayer"
  }
  return `hace ${Math.abs(diasDeDiferencia)} días`
}
