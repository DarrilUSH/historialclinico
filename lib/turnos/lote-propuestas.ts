/**
 * Cómo se DESCRIBE en pantalla un lote de propuestas de turno (agosto 2026 —
 * "un mensaje con diez sesiones"). Lógica pura, sin React: la usa
 * `components/turnos/analizador-mensaje-turno.tsx` para pintar la lista de
 * confirmación y la ejercita `tests/unit/lote-propuestas.test.ts`.
 *
 * ## El problema que resuelve: diez filas idénticas no se leen
 *
 * Las diez sesiones de una serie comparten profesional, especialidad y centro
 * — repetir "BUET DAIANA EDITH · Kinesiología · HB Central · Av. Entre Ríos
 * 2142" diez veces llena la pantalla del teléfono de ruido y ENTIERRA lo
 * único que cambia, que es la fecha y la hora de cada una. Eso importa más
 * acá que en cualquier otra lista: la persona está por crear diez turnos de
 * una vez y lo que tiene que poder revisar de un vistazo son las diez fechas.
 *
 * Entonces: los campos que valen lo mismo en TODAS las propuestas se muestran
 * una sola vez arriba (`comunes`), y cada fila queda con la etiqueta de
 * sesión, su fecha/hora, y SOLO los campos que se apartan de lo común
 * (`propios`). Cuando el lote son dos turnos de especialidades distintas
 * -el par del Hospital Británico- no hay nada común y cada fila se describe
 * entera, que es exactamente lo que corresponde ahí.
 *
 * Un campo entra en `comunes` solo si TODAS las propuestas lo tienen con el
 * MISMO valor no vacío. Si una sola lo trae distinto o vacío, el campo deja de
 * ser común y aparece en las filas que lo tienen: nunca se afirma arriba algo
 * que no valga para todas las filas de abajo.
 */

import type { PropuestaTurno } from "@/lib/turnos/construir-propuestas"

/** Los campos que se muestran una sola vez cuando valen para todo el lote. Cadena vacía = no es común, va por fila. */
export interface DatosComunesDelLote {
  medico: string
  especialidad: string
  lugarNombre: string
  lugarDireccion: string
}

/** Un campo propio de una fila: rótulo para el lector de pantalla + valor. */
export interface DatoPropio {
  etiqueta: string
  valor: string
}

export interface FilaDelLote {
  /** Posición en el array de propuestas — la misma que espera `crearTurnosEnLote`. */
  indice: number
  /** `"Sesión 3/10"` si el mensaje numeraba la serie; si no, `"Turno 3"` por posición, para que la fila SIEMPRE tenga un nombre. */
  titulo: string
  /** `true` cuando el título vino del mensaje (`etiquetaSesion`) y no de la posición — la pantalla lo puede marcar distinto. */
  tituloDelMensaje: boolean
  /** `YYYY-MM-DD`, o `""` si no se pudo determinar la fecha. */
  fecha: string
  /** `HH:mm`, o `""` si el mensaje no traía hora. */
  hora: string
  /** Campos de esta fila que NO valen para todo el lote. */
  propios: DatoPropio[]
  /** Avisos de revisión de esta propuesta (`PropuestaTurno.avisos`). */
  avisos: string[]
}

export interface DescripcionDelLote {
  comunes: DatosComunesDelLote
  filas: FilaDelLote[]
}

/** Un campo es común si todas las propuestas lo traen con el mismo valor no vacío. */
function valorComun(propuestas: readonly PropuestaTurno[], leer: (p: PropuestaTurno) => string): string {
  const primero = leer(propuestas[0]).trim()
  if (primero.length === 0) return ""
  return propuestas.every((propuesta) => leer(propuesta).trim() === primero) ? primero : ""
}

export function describirLoteDePropuestas(propuestas: readonly PropuestaTurno[]): DescripcionDelLote {
  if (propuestas.length === 0) {
    return { comunes: { medico: "", especialidad: "", lugarNombre: "", lugarDireccion: "" }, filas: [] }
  }

  const comunes: DatosComunesDelLote = {
    medico: valorComun(propuestas, (p) => p.medico),
    especialidad: valorComun(propuestas, (p) => p.especialidad),
    lugarNombre: valorComun(propuestas, (p) => p.lugarNombre),
    lugarDireccion: valorComun(propuestas, (p) => p.lugarDireccion),
  }

  const filas = propuestas.map((propuesta, indice): FilaDelLote => {
    const propios: DatoPropio[] = []
    const sumarSiEsPropio = (etiqueta: string, valor: string, comun: string) => {
      const limpio = valor.trim()
      if (limpio.length > 0 && limpio !== comun) propios.push({ etiqueta, valor: limpio })
    }

    sumarSiEsPropio("Especialidad", propuesta.especialidad, comunes.especialidad)
    sumarSiEsPropio("Profesional", propuesta.medico, comunes.medico)
    sumarSiEsPropio("Lugar", propuesta.lugarNombre, comunes.lugarNombre)
    sumarSiEsPropio("Dirección", propuesta.lugarDireccion, comunes.lugarDireccion)

    return {
      indice,
      titulo: propuesta.etiquetaSesion.length > 0 ? propuesta.etiquetaSesion : `Turno ${indice + 1}`,
      tituloDelMensaje: propuesta.etiquetaSesion.length > 0,
      fecha: propuesta.fecha,
      hora: propuesta.hora,
      propios,
      avisos: propuesta.avisos,
    }
  })

  return { comunes, filas }
}
