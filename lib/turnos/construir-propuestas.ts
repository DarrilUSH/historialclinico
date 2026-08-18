/**
 * Construcción PURA de las propuestas de turno a partir de lo que Gemini
 * extrajo de un mensaje (Sprint 16, tarea 16.4). Sin React, sin
 * `server-only`, sin red: recibe un `AnalisisMensajeTurnoExtraido` YA
 * validado por Zod (`lib/validacion/analisis-turno.schema.ts`) — real o
 * SIMULADO en un test — y devuelve el resultado listo para precargar el
 * formulario. Testeada con respuestas de Gemini simuladas
 * (`tests/unit/construir-propuestas-turno.test.ts`), sin mockear la red.
 *
 * `lib/turnos/analizar-mensaje.ts` es el único llamador real: arma el
 * `AnalisisMensajeTurnoExtraido` con la llamada a Gemini y le pasa el
 * resultado a `construirResultadoAnalisis`.
 *
 * ## Las tres decisiones de diseño de esta tarea
 *
 * 1. **Dividir vs. fusionar** (`tests/fixtures/mensajes-turno/README.md`
 *    §"Varios mensajes en un solo paste"): la CLASIFICACIÓN (¿son dos turnos
 *    o un turno en dos mensajes?) la hace Gemini, porque requiere entender el
 *    texto. La CONSTRUCCIÓN del resultado en cada caso -listar por separado,
 *    o fusionar con la confirmación ganando en día/hora/profesional- es
 *    determinística y vive acá.
 * 2. **Avisos generados sobre los campos FINALES, no acumulados por mensaje**:
 *    `generarAvisos` corre una sola vez, sobre los campos ya fusionados (si
 *    correspondía fusionar). Si el mensaje base decía "no había hora" pero la
 *    confirmación sí la trae, el aviso final NO dice que falta la hora -sería
 *    un aviso mentiroso sobre el estado real de la propuesta-.
 * 3. **Límites de longitud espejo de `lib/validacion/turno.schema.ts`**: la
 *    precarga recorta defensivamente a los mismos máximos que exige guardar
 *    el turno, para que revisar y guardar nunca choque con un error de "campo
 *    demasiado largo" que la persona no generó a mano.
 *
 * ## Deuda declarada: NO se cruza `lugarNombre` contra el catálogo REFES
 *
 * El encargo de la tarea deja como BONUS (opcional, "si es simple") ofrecer
 * la precarga completa con coordenadas cuando `lugarNombre` matchea un centro
 * sincronizado del catálogo REFES (`lib/lugares/sugerencias.ts`, tarea 16.3).
 * No se implementa acá: decidir con confianza que "ANEXO DR JORGE SAGARDIA"
 * (texto libre de un mensaje de WhatsApp, sin ID de REFES) es EL MISMO centro
 * que una fila puntual del catálogo -y no una sede parecida de otra
 * institución- es un problema de fuzzy-matching real, con el riesgo real de
 * mandar a la familia a la dirección de otra clínica si se equivoca. Reusar
 * `lib/lugares/consulta.ts` para una búsqueda ademas exigiría tocar la base
 * desde este módulo (que hoy es 100% puro) o subir esa responsabilidad al
 * Route Handler. Queda declarado como mejora futura, no como olvido -el campo
 * `lugarNombre`/`lugarDireccion` que sí devuelve este módulo, tal como los
 * escribió la clínica, sigue siendo información correcta y útil sin el cruce-.
 */

import { mapearEspecialidadCatalogo } from "@/lib/especialidades/mapear-catalogo"
import { provinciaCanonica } from "@/lib/lugares/normalizar"
import type { AnalisisMensajeTurnoExtraido, TurnoExtraidoCrudo } from "@/lib/gemini/schemas"
import {
  cotejarDiaSemana,
  nombreDiaSemana,
  NOMBRE_DIA_SEMANA_LARGO,
  normalizarHora,
  normalizarNombreProfesional,
  parsearFechaArgentina,
} from "@/lib/turnos/normalizacion-mensaje"

// Mismos topes que `lib/validacion/turno.schema.ts` — ver el punto 3 del
// comentario de cabecera.
const MAX_ESPECIALIDAD = 100
const MAX_MEDICO = 150
const MAX_LUGAR_NOMBRE = 150
const MAX_LUGAR_DIRECCION = 300
const MAX_LUGAR_CIUDAD = 100
const MAX_NOTAS = 2000

function recortar(texto: string, max: number): string {
  return texto.length > max ? texto.slice(0, max) : texto
}

function formatearFechaCorta(iso: string): string {
  if (!iso) return ""
  const [anio, mes, dia] = iso.split("-")
  return `${dia}/${mes}/${anio}`
}

/** Los campos "de negocio" de una propuesta, sin avisos ni resumen — lo que se fusiona en el caso `turno_mas_confirmacion`. */
export interface CamposTurno {
  especialidad: string
  especialidadInferida: boolean
  medico: string
  /** `true` cuando el campo "profesional" del mensaje en realidad nombraba un estudio/práctica, no una persona. */
  esEstudioNoProfesional: boolean
  /** `true` cuando no se pudo determinar con confianza el orden Nombre/Apellido de `medico`. */
  dudaOrdenNombre: boolean
  /** `YYYY-MM-DD`, o `""` si no se pudo determinar. */
  fecha: string
  /** `true` si el mensaje no traía el año y se infirió la próxima ocurrencia futura. */
  anioInferido: boolean
  /** `HH:mm`, o `""` si el mensaje no traía hora — NUNCA se inventa. */
  hora: string
  /** `true` si el mensaje mencionaba un día de la semana que no coincide con `fecha`. */
  discrepanciaDiaSemana: boolean
  diaSemanaTexto: string
  lugarNombre: string
  lugarDireccion: string
  lugarCiudad: string
  lugarProvincia: string
  notasPreparacion: string
}

/** Una propuesta lista para precargar el formulario: `CamposTurno` + avisos de revisión + un resumen de una línea. */
export interface PropuestaTurno extends CamposTurno {
  /** Mensajes en castellano para la franja de revisión ("No decía la hora — completala vos", etc.). */
  avisos: string[]
  /** Una línea para identificar esta propuesta en la lista de "otros turnos detectados". */
  resumen: string
}

export interface ResultadoAnalisisMensaje {
  relacion: AnalisisMensajeTurnoExtraido["relacion"]
  /** La frase de Gemini explicando la relación elegida (solo informativa cuando `relacion !== "unico"`). */
  explicacion: string
  propuestaPrincipal: PropuestaTurno
  /** Turnos adicionales detectados (`relacion === "varios_turnos"`), para que la persona los cargue por separado. Vacío en los demás casos. */
  otrasPropuestas: PropuestaTurno[]
  /** Mensaje de contradicción cuando la fusión detectó fechas distintas entre el mensaje base y la confirmación. `null` si no hubo. */
  contradiccion: string | null
}

/** Computa los campos de negocio de UN turno crudo, sin avisos — building block reusado por el caso simple y por la fusión. */
function camposDesdeTurnoCrudo(crudo: TurnoExtraidoCrudo, ahora: Date): CamposTurno {
  let fecha = ""
  let anioInferido = false
  const fechaTexto = crudo.fechaTexto.trim()
  if (fechaTexto.length > 0) {
    const parseada = parsearFechaArgentina(fechaTexto, ahora)
    if (parseada) {
      fecha = parseada.fecha
      anioInferido = parseada.anioInferido
    }
  }

  const hora = normalizarHora(crudo.horaTexto)

  let medico = ""
  let esEstudioNoProfesional = false
  let dudaOrdenNombre = false
  let especialidad = mapearEspecialidadCatalogo(crudo.especialidadTexto.trim())

  if (crudo.tipoProfesional === "persona" && crudo.profesionalTexto.trim().length > 0) {
    const normalizado = normalizarNombreProfesional(crudo.profesionalTexto)
    medico = normalizado.texto
    dudaOrdenNombre = normalizado.dudaOrden
  } else if (crudo.tipoProfesional === "estudio" && crudo.profesionalTexto.trim().length > 0) {
    esEstudioNoProfesional = true
    if (especialidad.length === 0) {
      especialidad = mapearEspecialidadCatalogo(crudo.profesionalTexto.trim())
    }
  }

  const diaSemanaTexto = crudo.diaSemanaTexto.trim()
  const discrepanciaDiaSemana =
    fecha.length > 0 && diaSemanaTexto.length > 0 && cotejarDiaSemana(fecha, diaSemanaTexto) === false

  return {
    especialidad: recortar(especialidad, MAX_ESPECIALIDAD),
    especialidadInferida: crudo.especialidadInferida,
    medico: recortar(medico, MAX_MEDICO),
    esEstudioNoProfesional,
    dudaOrdenNombre,
    fecha,
    anioInferido,
    hora,
    discrepanciaDiaSemana,
    diaSemanaTexto,
    lugarNombre: recortar(crudo.lugarNombre.trim(), MAX_LUGAR_NOMBRE),
    lugarDireccion: recortar(crudo.lugarDireccion.trim(), MAX_LUGAR_DIRECCION),
    lugarCiudad: recortar(crudo.lugarCiudad.trim(), MAX_LUGAR_CIUDAD),
    lugarProvincia: provinciaCanonica(crudo.lugarProvincia.trim()) ?? "",
    notasPreparacion: recortar(
      crudo.notas
        .map((nota) => nota.trim())
        .filter((nota) => nota.length > 0)
        .join("\n"),
      MAX_NOTAS,
    ),
  }
}

/** Avisos de revisión a partir de los campos FINALES (ya fusionados si correspondía). */
function generarAvisos(campos: CamposTurno): string[] {
  const avisos: string[] = []

  if (campos.fecha.length === 0) {
    avisos.push("El mensaje no traía una fecha que pudiéramos interpretar — completala vos.")
  } else if (campos.anioInferido) {
    avisos.push(
      `El mensaje no decía el año — asumimos ${campos.fecha.slice(0, 4)} (la próxima vez que cae esa fecha). Confirmalo.`,
    )
  }

  if (campos.discrepanciaDiaSemana) {
    avisos.push(
      `El mensaje decía "${campos.diaSemanaTexto}" pero el ${formatearFechaCorta(campos.fecha)} cae ` +
        `${NOMBRE_DIA_SEMANA_LARGO[nombreDiaSemana(campos.fecha)]} — revisá la fecha.`,
    )
  }

  if (campos.hora.length === 0) {
    avisos.push("El mensaje no decía la hora — completala vos.")
  }

  if (campos.medico.length > 0 && campos.dudaOrdenNombre) {
    avisos.push(
      `No pudimos confirmar si "${campos.medico}" está en orden Nombre Apellido o Apellido Nombre — revisalo.`,
    )
  }

  if (campos.especialidad.length === 0) {
    avisos.push("No pudimos identificar la especialidad ni el estudio — completalo vos.")
  } else if (campos.especialidadInferida) {
    avisos.push(`"${campos.especialidad}" es una inferencia nuestra a partir del mensaje — confirmala.`)
  }

  return avisos
}

function resumenTurno(campos: CamposTurno): string {
  const fechaHora = [campos.fecha ? formatearFechaCorta(campos.fecha) : "sin fecha", campos.hora]
    .filter((parte) => parte.length > 0)
    .join(" ")
  const quien = campos.medico || campos.especialidad || "sin especialidad"
  return `${fechaHora} — ${quien}`
}

function normalizarTurnoCrudo(crudo: TurnoExtraidoCrudo, ahora: Date): PropuestaTurno {
  const campos = camposDesdeTurnoCrudo(crudo, ahora)
  return { ...campos, avisos: generarAvisos(campos), resumen: resumenTurno(campos) }
}

const CAMPOS_VACIOS: CamposTurno = {
  especialidad: "",
  especialidadInferida: false,
  medico: "",
  esEstudioNoProfesional: false,
  dudaOrdenNombre: false,
  fecha: "",
  anioInferido: false,
  hora: "",
  discrepanciaDiaSemana: false,
  diaSemanaTexto: "",
  lugarNombre: "",
  lugarDireccion: "",
  lugarCiudad: "",
  lugarProvincia: "",
  notasPreparacion: "",
}

/**
 * Caso `turno_mas_confirmacion`: fusiona el mensaje base (`turnos[0]`) con el
 * de confirmación (`turnos[1]`). La confirmación GANA en fecha/hora/médico
 * cuando trae un valor no vacío para ese campo; el resto (lugar, especialidad,
 * notas) viene del mensaje base, completado por la confirmación si el base
 * estaba vacío. Las notas de los dos mensajes se suman.
 */
function construirFusion(crudo: AnalisisMensajeTurnoExtraido, ahora: Date): ResultadoAnalisisMensaje {
  const base = camposDesdeTurnoCrudo(crudo.turnos[0], ahora)
  const confirmacion = camposDesdeTurnoCrudo(crudo.turnos[1], ahora)

  const confirmacionTraeFecha = confirmacion.fecha.length > 0
  const fecha = confirmacionTraeFecha ? confirmacion.fecha : base.fecha
  const anioInferido = confirmacionTraeFecha ? confirmacion.anioInferido : base.anioInferido
  const diaSemanaTexto = confirmacionTraeFecha ? confirmacion.diaSemanaTexto : base.diaSemanaTexto
  const discrepanciaDiaSemana =
    fecha.length > 0 && diaSemanaTexto.length > 0 && cotejarDiaSemana(fecha, diaSemanaTexto) === false

  const hora = confirmacion.hora || base.hora

  const confirmacionTraeMedico = confirmacion.medico.length > 0
  const medico = confirmacionTraeMedico ? confirmacion.medico : base.medico
  const esEstudioNoProfesional = confirmacionTraeMedico
    ? confirmacion.esEstudioNoProfesional
    : base.esEstudioNoProfesional
  const dudaOrdenNombre = confirmacionTraeMedico ? confirmacion.dudaOrdenNombre : base.dudaOrdenNombre

  const especialidad = base.especialidad || confirmacion.especialidad
  const especialidadInferida = base.especialidad.length > 0 ? base.especialidadInferida : confirmacion.especialidadInferida

  const campos: CamposTurno = {
    especialidad,
    especialidadInferida,
    medico,
    esEstudioNoProfesional,
    dudaOrdenNombre,
    fecha,
    anioInferido,
    hora,
    discrepanciaDiaSemana,
    diaSemanaTexto,
    lugarNombre: base.lugarNombre || confirmacion.lugarNombre,
    lugarDireccion: base.lugarDireccion || confirmacion.lugarDireccion,
    lugarCiudad: base.lugarCiudad || confirmacion.lugarCiudad,
    lugarProvincia: base.lugarProvincia || confirmacion.lugarProvincia,
    notasPreparacion: [base.notasPreparacion, confirmacion.notasPreparacion]
      .filter((nota) => nota.length > 0)
      .join("\n"),
  }

  const avisos = generarAvisos(campos)

  let contradiccion: string | null = null
  if (base.fecha.length > 0 && confirmacion.fecha.length > 0 && base.fecha !== confirmacion.fecha) {
    contradiccion =
      `El primer mensaje mencionaba el ${formatearFechaCorta(base.fecha)} y la confirmación dice ` +
      `${formatearFechaCorta(confirmacion.fecha)} — se cargó la de la confirmación, pero revisá cuál es la correcta.`
    avisos.push(contradiccion)
  }

  return {
    relacion: "turno_mas_confirmacion",
    explicacion: crudo.explicacion,
    contradiccion,
    otrasPropuestas: [],
    propuestaPrincipal: { ...campos, avisos, resumen: resumenTurno(campos) },
  }
}

/**
 * Construye el resultado final a partir de lo que Gemini extrajo, ya validado
 * por Zod. Punto de entrada único de este módulo.
 */
export function construirResultadoAnalisis(
  crudo: AnalisisMensajeTurnoExtraido,
  ahora: Date = new Date(),
): ResultadoAnalisisMensaje {
  if (crudo.turnos.length === 0) {
    return {
      relacion: "unico",
      explicacion: crudo.explicacion,
      otrasPropuestas: [],
      contradiccion: null,
      propuestaPrincipal: {
        ...CAMPOS_VACIOS,
        avisos: ["No pudimos identificar ningún turno en el mensaje pegado — completá el formulario a mano."],
        resumen: "Sin datos reconocidos",
      },
    }
  }

  if (crudo.relacion === "turno_mas_confirmacion" && crudo.turnos.length >= 2) {
    return construirFusion(crudo, ahora)
  }

  const normalizados = crudo.turnos.map((turno) => normalizarTurnoCrudo(turno, ahora))

  if (crudo.relacion === "varios_turnos" && normalizados.length > 1) {
    return {
      relacion: "varios_turnos",
      explicacion: crudo.explicacion,
      contradiccion: null,
      propuestaPrincipal: normalizados[0],
      otrasPropuestas: normalizados.slice(1),
    }
  }

  return {
    relacion: "unico",
    explicacion: crudo.explicacion,
    contradiccion: null,
    propuestaPrincipal: normalizados[0],
    otrasPropuestas: [],
  }
}

/** Los campos de `PropuestaTurno` que efectivamente se vuelcan al formulario -sin avisos ni resumen, esos son solo para la franja de revisión. */
export interface CamposPrecargablesTurno {
  especialidad: string
  medico: string
  fecha: string
  hora: string
  lugarNombre: string
  lugarDireccion: string
  lugarCiudad: string
  lugarProvincia: string
  notasPreparacion: string
}

/** Recorta una `PropuestaTurno` a los campos que `aplicarPrecarga` (`lib/turnos/aplicar-precarga.ts`) sabe volcar al formulario. */
export function propuestaACamposPrecargables(propuesta: PropuestaTurno): CamposPrecargablesTurno {
  return {
    especialidad: propuesta.especialidad,
    medico: propuesta.medico,
    fecha: propuesta.fecha,
    hora: propuesta.hora,
    lugarNombre: propuesta.lugarNombre,
    lugarDireccion: propuesta.lugarDireccion,
    lugarCiudad: propuesta.lugarCiudad,
    lugarProvincia: propuesta.lugarProvincia,
    notasPreparacion: propuesta.notasPreparacion,
  }
}
