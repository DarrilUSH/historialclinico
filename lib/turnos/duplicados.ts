/**
 * Detección de turnos repetidos, PURA (agosto 2026 — creación en lote desde
 * un mensaje con varias sesiones).
 *
 * Sin red, sin `server-only`, sin Supabase: recibe los turnos que se están
 * por crear y los que el perfil YA tiene, y devuelve cuáles de los primeros
 * son repeticiones. `crearTurnosEnLote`
 * (`app/(app)/(con-nav)/turnos/actions.ts`) es el único llamador real; los
 * tests la ejercitan con arrays armados a mano
 * (`tests/unit/duplicados-turnos.test.ts`).
 *
 * ## Por qué hace falta
 *
 * Un mensaje de diez sesiones se pega dos veces con una facilidad enorme: la
 * persona no está segura de si el primer intento anduvo, vuelve atrás y lo
 * pega de nuevo. Sin esta guarda quedarían VEINTE turnos y cuarenta
 * recordatorios push -el ruido que hace que se apaguen las notificaciones-.
 * También cubre el doble toque del botón de confirmar, que es el mismo caso
 * visto de más cerca.
 *
 * ## El criterio: mismo dato EXACTO
 *
 * Es el mismo que ya usa la carga de estudios
 * (`lib/documentos/duplicados-semanticos.ts`) trasladado a un turno: **mismo
 * perfil + mismo instante + mismo profesional + misma especialidad = el mismo
 * turno**. Cualquier diferencia real -otra fecha, otra hora, otro
 * profesional- lo vuelve legítimo y se crea.
 *
 * Dos precisiones que importan:
 *
 * - El **instante** se compara como instante (`Date.getTime()`), no como
 *   string: `2026-08-21T14:00:00+00:00` y `2026-08-21T11:00:00-03:00` son el
 *   mismo turno escrito de dos maneras, y Postgres devuelve `timestamptz` con
 *   el formato que se le antoje.
 * - El **texto** se compara sin tildes, sin mayúsculas y con los espacios
 *   colapsados (`normalizarBusqueda`): "BUET DAIANA EDITH" y "Buet Daiana
 *   Edith" son la misma persona. Que la segunda pasada del analizador
 *   capitalice distinto no puede ser motivo para duplicar.
 *
 * La comparación NO mira el lugar ni las notas a propósito: dos filas con la
 * misma fecha, hora, profesional y especialidad son el mismo turno aunque una
 * traiga la dirección y la otra no -y ese "aunque" es justamente lo que pasa
 * cuando el mismo turno entra por dos caminos distintos-.
 *
 * ## Y las repeticiones DENTRO del mismo lote
 *
 * También se detectan: si el modelo enumeró dos veces la misma sesión, la
 * segunda se marca repetida contra la primera del lote, no contra la base.
 * Para la persona el resultado es el mismo (un turno, no dos).
 */

import { normalizarBusqueda } from "@/lib/lugares/normalizar"

/** Lo mínimo que hace falta de un turno para decidir si es el mismo que otro. */
export interface TurnoComparable {
  /** Instante del turno en ISO (`appointments.appointment_date`, o el `fechaHoraIso` recién validado). */
  fechaHoraIso: string
  especialidad: string
  /** `null`/`undefined` cuando el turno no nombra profesional — dos turnos sin profesional se siguen comparando entre sí. */
  medico?: string | null
}

/**
 * Clave de identidad de un turno. `NaN` en el instante (fecha imposible) da
 * una clave que no matchea con ninguna otra, ni siquiera consigo misma en
 * otra fila: ante un dato roto, la respuesta segura es "no es duplicado" —
 * crear un turno de más es recuperable, tragarse uno legítimo no.
 */
function claveDeTurno(turno: TurnoComparable, indiceDesempate: number): string {
  const instante = new Date(turno.fechaHoraIso).getTime()
  if (!Number.isFinite(instante)) return `invalido:${indiceDesempate}`

  return [
    instante,
    normalizarBusqueda(turno.especialidad ?? ""),
    normalizarBusqueda(turno.medico ?? ""),
  ].join("|")
}

export interface RepeticionesEnLote {
  /** Índices de `candidatos` que ya existen en `existentes`. */
  yaExistian: Set<number>
  /** Índices de `candidatos` que repiten a un candidato ANTERIOR del mismo lote. */
  repetidosEnElLote: Set<number>
}

/**
 * Marca, para cada candidato, si ya existe en la base o si repite a otro
 * candidato anterior del mismo lote. Un candidato puede caer en las dos
 * listas; quien llama solo necesita saber que no hay que insertarlo.
 */
export function detectarRepeticiones(
  candidatos: readonly TurnoComparable[],
  existentes: readonly TurnoComparable[],
): RepeticionesEnLote {
  const clavesExistentes = new Set(existentes.map((turno, indice) => claveDeTurno(turno, -1 - indice)))
  const clavesDelLote = new Set<string>()

  const yaExistian = new Set<number>()
  const repetidosEnElLote = new Set<number>()

  candidatos.forEach((candidato, indice) => {
    const clave = claveDeTurno(candidato, indice)

    if (clavesExistentes.has(clave)) yaExistian.add(indice)
    else if (clavesDelLote.has(clave)) repetidosEnElLote.add(indice)

    clavesDelLote.add(clave)
  })

  return { yaExistian, repetidosEnElLote }
}
