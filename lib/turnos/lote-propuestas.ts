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
 *
 * ## Una fila que NO se puede crear no puede aparecer tildada (agosto 2026)
 *
 * Reportado por el dueño con captura, sobre el mensaje de las diez sesiones que
 * llegaron sin fecha interpretable: las diez decían *"Sin fecha — no lo podemos
 * crear"*, y aun así estaban las diez TILDADAS y el botón ofrecía *"Crear los 10
 * turnos"*. La pantalla prometía exactamente lo que ella misma acababa de
 * declarar imposible; el único desenlace posible era diez errores.
 *
 * Por eso cada fila ahora dice si es CREABLE (`FilaDelLote.creable`) y por qué
 * no lo es (`FilaDelLote.motivo`), y esa decisión vive acá, en la capa pura,
 * junto a todo lo demás que la pantalla solo pinta. Los motivos son los mismos
 * requisitos que exige guardar un turno (`lib/validacion/turno.schema.ts`, con
 * `exigirFechaFutura`), evaluados ANTES de mandar nada: falta la fecha, falta
 * la hora, falta la especialidad, o la cita ya pasó. Que el reporte de la
 * Server Action siga explicando fila por fila lo que pasó no es excusa para
 * ofrecer el intento: un error que se puede anticipar se anticipa.
 */

import { combinarFechaHoraUshuaia } from "@/lib/turnos/fecha"
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
  /** `true` si este turno se puede crear tal como está. Una fila no creable no se puede marcar ni entra en la cuenta del botón. */
  creable: boolean
  /** Por qué no se puede crear, en castellano y listo para mostrar. `""` cuando sí se puede. */
  motivo: string
  /** Qué datos obligatorios le faltan. Vacío si no le falta ninguno (puede seguir sin ser creable: ver `motivo`). */
  faltantes: DatoFaltanteDelTurno[]
}

export interface DescripcionDelLote {
  comunes: DatosComunesDelLote
  /** Avisos que TODAS las propuestas comparten, para decirlos una sola vez arriba. Ver el encabezado. */
  avisosComunes: string[]
  filas: FilaDelLote[]
}

/** `["la fecha", "la hora"]` → `"la fecha y la hora"`. */
function enumerarEnCastellano(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? ""
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`
}

/** Los tres datos que `validarTurno` exige sí o sí para poder guardar un turno. */
export type DatoFaltanteDelTurno = "fecha" | "hora" | "especialidad"

const ARTICULO_SINGULAR: Record<DatoFaltanteDelTurno, string> = {
  fecha: "la fecha",
  hora: "la hora",
  especialidad: "la especialidad",
}

/** En plural, para hablar de todo el lote a la vez ("Completá las fechas…"). */
const ARTICULO_PLURAL: Record<DatoFaltanteDelTurno, string> = {
  fecha: "las fechas",
  hora: "los horarios",
  especialidad: "la especialidad",
}

/**
 * La especialidad es el único faltante que la pantalla del lote SÍ puede
 * arreglar sin salir de ahí: es un dato común a toda la serie y se completa
 * con un solo campo. Las fechas y los horarios son propios de cada cita y no
 * se editan en esta lista.
 */
export const FALTANTE_COMPLETABLE_EN_EL_LOTE: DatoFaltanteDelTurno = "especialidad"

/** Frase final de un motivo, para que las cuatro suenen igual. */
const NO_LO_PODEMOS_CREAR = "no lo podemos crear."

/** Texto exacto del motivo de una cita que ya ocurrió, para poder reconocerlo sin repetir el string. */
export const MOTIVO_YA_PASO = `Ya pasó — ${NO_LO_PODEMOS_CREAR}`

/**
 * Qué datos obligatorios le faltan a una propuesta. Lista vacía no significa
 * que se pueda crear: puede estar completa y haber pasado (`motivoNoCreable`).
 */
export function datosFaltantes(propuesta: PropuestaTurno): DatoFaltanteDelTurno[] {
  const faltantes: DatoFaltanteDelTurno[] = []
  if (propuesta.fecha.trim().length === 0) faltantes.push("fecha")
  if (propuesta.hora.trim().length === 0) faltantes.push("hora")
  if (propuesta.especialidad.trim().length === 0) faltantes.push("especialidad")
  return faltantes
}

/**
 * Por qué esta propuesta NO se puede crear, o `""` si se puede.
 *
 * Espeja los requisitos de `validarTurno` con `exigirFechaFutura: true`
 * (`lib/validacion/turno.schema.ts`), que es exactamente lo que va a correr
 * `crearTurnosEnLote` del otro lado. Adelantar acá el mismo veredicto es lo
 * que permite que la pantalla no ofrezca un botón que ya sabe que va a
 * fallar; el reporte de la Server Action sigue siendo la última palabra -y la
 * que cubre lo que puede cambiar entre que se dibuja la lista y se toca el
 * botón, como una cita que pasa a ser pasada mientras la pantalla está
 * abierta-.
 *
 * `ahora` es inyectable para que los tests fijen "hoy" sin depender del reloj.
 */
export function motivoNoCreable(propuesta: PropuestaTurno, ahora: Date = new Date()): string {
  const faltantes = datosFaltantes(propuesta)

  if (faltantes.length > 0) {
    const verbo = faltantes.length === 1 ? "Falta" : "Faltan"
    const lista = enumerarEnCastellano(faltantes.map((dato) => ARTICULO_SINGULAR[dato]))
    return `${verbo} ${lista} — ${NO_LO_PODEMOS_CREAR}`
  }

  const instante = combinarFechaHoraUshuaia(propuesta.fecha, propuesta.hora)
  if (!instante) return `Esa fecha y hora no existen en el calendario — ${NO_LO_PODEMOS_CREAR}`
  if (instante.getTime() <= ahora.getTime()) return MOTIVO_YA_PASO

  return ""
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

export function describirLoteDePropuestas(
  propuestas: readonly PropuestaTurno[],
  ahora: Date = new Date(),
): DescripcionDelLote {
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

    const motivo = motivoNoCreable(propuesta, ahora)

    return {
      indice,
      titulo: propuesta.etiquetaSesion.length > 0 ? propuesta.etiquetaSesion : `Turno ${indice + 1}`,
      tituloDelMensaje: propuesta.etiquetaSesion.length > 0,
      fecha: propuesta.fecha,
      hora: propuesta.hora,
      propios,
      // Solo lo que es de ESTA fila: lo que comparten todas ya se dijo arriba.
      avisos: propuesta.avisos.filter((aviso) => !esComun.has(aviso)),
      creable: motivo.length === 0,
      motivo,
      faltantes: datosFaltantes(propuesta),
    }
  })

  return { comunes, avisosComunes, filas }
}

/**
 * Qué falta para poder crear ALGO, cuando no hay ninguna fila creable. `""`
 * mientras quede al menos una: ahí el botón tiene trabajo y no hace falta
 * explicar nada.
 *
 * Existe para que el botón deshabilitado no sea un callejón sin salida: un
 * botón apagado y mudo se lee como que la app se rompió. El texto dice qué
 * falta y, cuando la pantalla no puede arreglarlo, adónde ir -el formulario de
 * abajo-. La única excepción es la especialidad, que sí se completa acá mismo
 * con un campo para toda la serie (`FALTANTE_COMPLETABLE_EN_EL_LOTE`): mandar
 * a cargar diez turnos a mano por un dato compartido sería absurdo.
 */
export function faltaParaCrearElLote(filas: readonly FilaDelLote[]): string {
  if (filas.length === 0 || filas.some((fila) => fila.creable)) return ""

  const faltantes = [...new Set(filas.flatMap((fila) => fila.faltantes))]

  if (faltantes.length > 0 && filas.every((fila) => fila.faltantes.length > 0)) {
    const lista = enumerarEnCastellano(faltantes.map((dato) => ARTICULO_PLURAL[dato]))
    const seArreglaAca = faltantes.every((dato) => dato === FALTANTE_COMPLETABLE_EN_EL_LOTE)
    return seArreglaAca
      ? `Completá ${lista} para poder crearlos.`
      : `Completá ${lista} para poder crearlos. Podés cargarlos a mano en el formulario de abajo.`
  }

  if (filas.every((fila) => fila.motivo === MOTIVO_YA_PASO)) {
    return "Todas estas sesiones ya pasaron: no hay ninguna nueva para cargar."
  }

  return "No podemos crear ninguno de estos turnos — al lado de cada uno está el motivo. Podés cargarlos a mano en el formulario de abajo."
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
