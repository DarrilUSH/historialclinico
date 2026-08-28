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
 *
 * ## Los AVISOS siguen la misma regla (Sprint 20)
 *
 * Verificado en producción con las diez sesiones de kinesiología: el aviso *"No
 * pudimos confirmar si BUET DAIANA EDITH está en orden Nombre Apellido…"*
 * aparecía DIEZ VECES, una debajo de cada sesión. Y es la misma frase por
 * construcción: `heredarDatosComunes` copia el profesional a todas las sesiones
 * de la serie y `generarAvisos` corre igual sobre cada una, así que un aviso
 * sobre un dato COMPARTIDO se genera necesariamente en las diez.
 *
 * Diez veces la misma advertencia no advierte mejor: entierra las diez fechas,
 * que es lo único que la persona tiene que poder revisar de un vistazo, y hace
 * parecer que hay diez problemas distintos. Ahora un aviso que aparece en TODAS
 * las propuestas sube a `avisosComunes` y se dice una vez arriba; los que son
 * de una fila sola se quedan en su fila, que es donde sirven ("esta sesión no
 * trae hora").
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
  /** Avisos que son SOLO de esta propuesta. Los que valen para todas viven en `DescripcionDelLote.avisosComunes`. */
  avisos: string[]
}

export interface DescripcionDelLote {
  comunes: DatosComunesDelLote
  /** Avisos que TODAS las propuestas comparten, para decirlos una sola vez arriba. Ver el encabezado. */
  avisosComunes: string[]
  filas: FilaDelLote[]
}

/** Un campo es común si todas las propuestas lo traen con el mismo valor no vacío. */
function valorComun(propuestas: readonly PropuestaTurno[], leer: (p: PropuestaTurno) => string): string {
  const primero = leer(propuestas[0]).trim()
  if (primero.length === 0) return ""
  return propuestas.every((propuesta) => leer(propuesta).trim() === primero) ? primero : ""
}

/**
 * Los avisos que aparecen en TODAS las propuestas, en el orden en que los trae
 * la primera. Con una sola propuesta no hay nada "común" que separar -sería
 * mover su único aviso a un bloque aparte por nada-, así que devuelve vacío.
 */
function avisosCompartidos(propuestas: readonly PropuestaTurno[]): string[] {
  if (propuestas.length < 2) return []

  return propuestas[0].avisos.filter((aviso) =>
    propuestas.every((propuesta) => propuesta.avisos.includes(aviso)),
  )
}

export function describirLoteDePropuestas(propuestas: readonly PropuestaTurno[]): DescripcionDelLote {
  if (propuestas.length === 0) {
    return {
      comunes: { medico: "", especialidad: "", lugarNombre: "", lugarDireccion: "" },
      avisosComunes: [],
      filas: [],
    }
  }

  const comunes: DatosComunesDelLote = {
    medico: valorComun(propuestas, (p) => p.medico),
    especialidad: valorComun(propuestas, (p) => p.especialidad),
    lugarNombre: valorComun(propuestas, (p) => p.lugarNombre),
    lugarDireccion: valorComun(propuestas, (p) => p.lugarDireccion),
  }

  const avisosComunes = avisosCompartidos(propuestas)
  const esComun = new Set(avisosComunes)

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
      // Solo lo que es de ESTA fila: lo que comparten todas ya se dijo arriba.
      avisos: propuesta.avisos.filter((aviso) => !esComun.has(aviso)),
    }
  })

  return { comunes, avisosComunes, filas }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  CÓMO TERMINA EL LOTE (Sprint 20, adenda)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reporte de una usuaria real que usó la creación en lote en producción:
 * *"cuando cargás los turnos y ponés aceptar, no te envía ni a la página de
 * inicio ni te borra los datos, como que sigue ahí, entonces no entendés bien
 * si ya pusiste el turno, si ya se guardó o qué"*.
 *
 * No es una molestia estética: **le costó un turno duplicado**. Volvió a
 * intentar porque la pantalla no le dijo que había terminado, y su perfil quedó
 * con la sesión 10/10 dos veces. Un final ambiguo en una pantalla que escribe en
 * la agenda médica de alguien se paga con datos repetidos, no con una mala
 * impresión.
 *
 * Antes, la pantalla solo navegaba a `/turnos` cuando TODO salía perfecto
 * (`fallidos === 0 && duplicados === 0`). Con un solo turno saltado -y saltar
 * los que ya pasaron es el caso NORMAL de un mensaje de diez sesiones que llega
 * tarde- se quedaba en el formulario, con la lista puesta y el botón "Crear los
 * N turnos" todavía disponible, invitando exactamente al segundo toque que
 * generó el duplicado.
 *
 * Ahora el lote SIEMPRE termina en un resumen explícito, y estas dos funciones
 * son lo que ese resumen dice. Son puras y se prueban aparte
 * (`tests/unit/lote-propuestas.test.ts`) por el mismo motivo que todo lo demás
 * de este archivo: el texto que lee una persona sobre lo que pasó con su agenda
 * merece un test, no una plantilla armada en el JSX.
 *
 * ## Lo que NO se toca: el reporte fila por fila
 *
 * La misma usuaria celebró lo otro: *"los turnos que ya pasaron me los corrigió
 * y me dijo: no te los pongo porque ya pasaron"*. Ese detalle por fila es lo
 * mejor que tiene esta pantalla y el resumen NUEVO no lo reemplaza: lo
 * encabeza. Por eso `frasesDelResultadoDelLote` cuenta los saltados y remite al
 * detalle, en vez de resumirlo en un "listo" que taparía el motivo.
 */

/** Lo que devolvió `crearTurnosEnLote`, contado. */
export interface ConteoDelLote {
  creados: number
  /** Los que ya existían en la agenda: no se repitieron. */
  duplicados: number
  /** Los que no se pudieron crear (típicamente, sesiones cuya fecha ya pasó). */
  fallidos: number
}

/** El encabezado del resumen. Dice el desenlace en una frase, sin eufemismos. */
export function tituloDelResultadoDelLote(conteo: ConteoDelLote): string {
  if (conteo.creados === 0) {
    if (conteo.duplicados > 0 && conteo.fallidos === 0) return "Ya los tenías cargados"
    return "No creamos ningún turno"
  }
  if (conteo.fallidos > 0 || conteo.duplicados > 0) return "Listo — entraron algunos, no todos"
  return conteo.creados === 1 ? "Listo, el turno quedó cargado" : "Listo, los turnos quedaron cargados"
}

/**
 * El cuerpo del resumen, una frase por desenlace. Se dicen TODOS los que
 * ocurrieron, no solo el principal: que entraran cuatro no vuelve irrelevante
 * que se saltaran seis, y es justamente lo que la persona necesita entender
 * para no volver a intentarlo.
 */
export function frasesDelResultadoDelLote(conteo: ConteoDelLote): string[] {
  const frases: string[] = []

  if (conteo.creados > 0) {
    frases.push(conteo.creados === 1 ? "Creamos 1 turno." : `Creamos ${conteo.creados} turnos.`)
  }
  if (conteo.duplicados > 0) {
    frases.push(
      conteo.duplicados === 1
        ? "1 ya estaba cargado, así que no lo repetimos."
        : `${conteo.duplicados} ya estaban cargados, así que no los repetimos.`,
    )
  }
  if (conteo.fallidos > 0) {
    frases.push(
      conteo.fallidos === 1
        ? "1 no lo pudimos cargar — abajo está el motivo."
        : `${conteo.fallidos} no los pudimos cargar — abajo está el motivo de cada uno.`,
    )
  }

  if (frases.length === 0) {
    frases.push("No quedó ningún turno nuevo cargado.")
  }

  return frases
}
