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
 * ## Series de sesiones (agosto 2026): herencia de datos comunes y etiqueta
 *
 * El mensaje real que motivó esta ampliación asigna DIEZ sesiones de
 * kinesiología en un solo texto: un encabezado con profesional, especialidad,
 * centro y dirección, y después diez líneas "Sesión N/10 · <día> <fecha> -
 * <hora>". El prompt le pide al modelo repetir los datos comunes en cada
 * elemento (`lib/gemini/prompt-turno.ts`, punto 8), pero eso es una
 * INSTRUCCIÓN, no una garantía: si en una corrida el modelo escribe el centro
 * solo en el primer elemento, nueve turnos quedarían sin lugar. Por eso la
 * herencia se vuelve a aplicar acá, determinísticamente
 * (`heredarDatosComunes`), y con una regla estrecha a propósito:
 *
 * - Solo para `relacion === "varios_turnos"`, y solo desde el PRIMER turno.
 * - Solo RELLENA campos vacíos: un turno que trae su propio profesional o su
 *   propio centro nunca se pisa. Por eso el par del Hospital Británico (dos
 *   mensajes distintos, cada uno completo) sale exactamente igual que antes.
 * - Nunca toca lo que es propio de cada cita: fecha, día de la semana, hora,
 *   número de sesión.
 *
 * Rellenar un hueco es estrictamente mejor que dejarlo vacío: en el peor caso
 * -dos mensajes pegados donde el segundo de verdad no nombraba profesional-
 * la persona ve el dato heredado en la lista de confirmación y desmarca o lo
 * corrige después; en el caso normal -la serie de sesiones- evita nueve
 * turnos mancos.
 *
 * **La etiqueta "Sesión 3/10" no necesita columna nueva.** `numeroSesion` y
 * `totalSesiones` llegan como enteros desde el schema, se formatean acá
 * (`etiquetaSesion`) y `propuestaACamposPrecargables` la antepone como primera
 * línea de `notasPreparacion`. Con eso viaja sola por TODO el camino ya
 * existente sin migrar nada: se guarda en `appointments.preparation_notes`,
 * se ve en la tarjeta de `/turnos`, se puede editar en `/turnos/[id]/editar`, y
 * -por ser la primera línea- sobrevive al recorte de 90 caracteres que hace
 * `lib/turnos/recordatorios.ts` al meter la preparación en el push. Una
 * columna `session_number` habría exigido migración, tocar RLS, arnés ×2 y
 * cuatro pantallas, para mostrar exactamente el mismo texto.
 *
 * ## La fecha de la serie se resuelve para TODA la serie, no fila por fila
 *
 * Segundo caso real (agosto 2026): "Jueves 13 de Agosto - 18:30 hs.", diez
 * veces, sin año. La lectura del mes en palabras y la elección del año por
 * congruencia con el día de la semana viven en
 * `lib/turnos/normalizacion-mensaje.ts` (ahí está la escalera completa de
 * decisión). Lo que cambia ACÁ es QUIÉN pregunta: cuando la relación es
 * `varios_turnos`, las fechas se resuelven todas juntas con
 * `resolverFechasDeSerie` en lugar de una por una, porque el año de una fecha
 * que no declara su día de la semana depende de las hermanas que sí lo
 * declaran. Fuera de una serie -un turno solo, o el par mensaje+confirmación-
 * cada fecha se sigue resolviendo por su cuenta: son textos independientes y
 * no hay nada que anclar.
 *
 * Consecuencia visible en los avisos: un año elegido por el día de la semana
 * NO genera el aviso de "asumimos el año, confirmalo". No es un descuido — es
 * que el mensaje trae su propio dígito verificador, y repetirle a la persona
 * que confirme algo ya comprobado, diez veces, entierra lo que sí tiene que
 * revisar.
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
  nombreLargoDeDiaSemanaTexto,
  NOMBRE_DIA_SEMANA_LARGO,
  normalizarHora,
  normalizarNombreProfesional,
  parsearFechaArgentina,
  resolverFechasDeSerie,
  type FechaArgentinaParseada,
} from "@/lib/turnos/normalizacion-mensaje"

// Mismos topes que `lib/validacion/turno.schema.ts` — ver el punto 3 del
// comentario de cabecera.
const MAX_ESPECIALIDAD = 100
const MAX_MEDICO = 150
const MAX_LUGAR_NOMBRE = 150
const MAX_LUGAR_DIRECCION = 300
const MAX_LUGAR_CIUDAD = 100
const MAX_NOTAS = 2000
/** No va a ninguna columna: es solo para citar en un aviso lo que decía el mensaje. */
const MAX_FECHA_TEXTO = 100

function recortar(texto: string, max: number): string {
  return texto.length > max ? texto.slice(0, max) : texto
}

/**
 * Reconoce una línea que dice SOLO el número de sesión ("Sesión 3/10",
 * "sesion 3 / 10", "Sesión 3."). El prompt le pide al modelo que NO ponga eso
 * en `notas` -tiene sus propios campos-, pero si igual lo hace, la línea se
 * descarta antes de anteponer la etiqueta canónica: sin esto la nota quedaría
 * "Sesión 3/10\nSesión 3/10".
 */
const LINEA_SOLO_SESION = /^sesi[oó]n\s*\d+\s*(?:\/\s*\d+)?\s*\.?$/i

/** `"Sesión 3/10"`, `"Sesión 3"`, o `""`. Un total menor que el número (ej. "Sesión 11/10") se descarta como incoherente y queda solo el número. */
function formatearEtiquetaSesion(numeroSesion: number, totalSesiones: number): string {
  if (numeroSesion <= 0) return ""
  return totalSesiones >= numeroSesion ? `Sesión ${numeroSesion}/${totalSesiones}` : `Sesión ${numeroSesion}`
}

/** Entero no negativo y finito, o `0` — red contra un `numeroSesion` fraccionario o absurdo que se le escape al schema. */
function enteroNoNegativo(valor: number): number {
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 0
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
  /** La fecha TAL COMO la escribió el mensaje ("Jueves 13 de Agosto"), para poder decir qué fue lo que no se pudo interpretar. */
  fechaTexto: string
  /** `true` si el mensaje no traía el año y se dedujo acá (por el día de la semana o por la próxima ocurrencia futura). */
  anioInferido: boolean
  /** `true` si ese año inferido lo CONFIRMÓ el día de la semana que declaraba el mensaje — el único caso en que no hace falta que la persona lo confirme. */
  anioConfirmadoPorDiaSemana: boolean
  /** `true` cuando el mensaje traía una fecha legible pero su día de la semana no cae en ningún año candidato: `fecha` quedó vacía a propósito. */
  diaSemanaIncongruente: boolean
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
  /** Número de esta cita dentro de una serie ("Sesión 3/10" → 3). `0` cuando el mensaje no la numera. */
  numeroSesion: number
  /** Total de la serie ("Sesión 3/10" → 10). `0` cuando el mensaje no lo dice. */
  totalSesiones: number
}

/** Una propuesta lista para precargar el formulario: `CamposTurno` + avisos de revisión + un resumen de una línea. */
export interface PropuestaTurno extends CamposTurno {
  /** Mensajes en castellano para la franja de revisión ("No decía la hora — completala vos", etc.). */
  avisos: string[]
  /** Una línea para identificar esta propuesta en la lista de "otros turnos detectados". */
  resumen: string
  /** `"Sesión 3/10"`, `"Sesión 3"`, o `""` si el mensaje no numeraba la cita. Se antepone a las notas al precargar. */
  etiquetaSesion: string
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

/**
 * Computa los campos de negocio de UN turno crudo, sin avisos — building block
 * reusado por el caso simple y por la fusión.
 *
 * La fecha llega YA RESUELTA (`fechaResuelta`) en vez de parsearse acá: en una
 * serie de sesiones el año de una fecha puede depender de las demás
 * (`resolverFechasDeSerie`), así que la resolución es una decisión de todo el
 * lote y se toma una sola vez, arriba, en `construirResultadoAnalisis`.
 */
function camposDesdeTurnoCrudo(
  crudo: TurnoExtraidoCrudo,
  fechaResuelta: FechaArgentinaParseada | null,
): CamposTurno {
  const fecha = fechaResuelta?.fecha ?? ""
  const anioInferido = fechaResuelta?.anioInferido ?? false
  const anioConfirmadoPorDiaSemana = fechaResuelta?.anioConfirmadoPorDiaSemana ?? false
  const diaSemanaIncongruente = fechaResuelta?.diaSemanaIncongruente ?? false

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

  // El día de la semana puede venir en su campo o pegado a la fecha ("Jueves
  // 13 de Agosto"): `fechaResuelta` devuelve el que efectivamente se usó, así
  // que el aviso de discrepancia y el cotejo hablan siempre del mismo dato.
  const diaSemanaTexto = crudo.diaSemanaTexto.trim() || (fechaResuelta?.diaSemanaTexto ?? "")
  const discrepanciaDiaSemana =
    fecha.length > 0 && diaSemanaTexto.length > 0 && cotejarDiaSemana(fecha, diaSemanaTexto) === false

  return {
    especialidad: recortar(especialidad, MAX_ESPECIALIDAD),
    especialidadInferida: crudo.especialidadInferida,
    medico: recortar(medico, MAX_MEDICO),
    esEstudioNoProfesional,
    dudaOrdenNombre,
    fecha,
    fechaTexto: recortar(crudo.fechaTexto.trim(), MAX_FECHA_TEXTO),
    anioInferido,
    anioConfirmadoPorDiaSemana,
    diaSemanaIncongruente,
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
        .filter((nota) => nota.length > 0 && !LINEA_SOLO_SESION.test(nota))
        .join("\n"),
      MAX_NOTAS,
    ),
    numeroSesion: enteroNoNegativo(crudo.numeroSesion),
    totalSesiones: enteroNoNegativo(crudo.totalSesiones),
  }
}

/**
 * Cómo lo dijo el mensaje, para poder citarlo en un aviso: la fecha tal cual
 * la escribió, con el día de la semana adelante si venía en su campo aparte y
 * no estaba ya incluido en la fecha.
 */
function citaDeLaFechaDelMensaje(campos: CamposTurno): string {
  const fecha = campos.fechaTexto.trim()
  const dia = campos.diaSemanaTexto.trim()
  if (dia.length === 0) return fecha
  if (fecha.toLowerCase().includes(dia.toLowerCase())) return fecha
  return `${dia} ${fecha}`.trim()
}

/**
 * Aviso de que el mensaje no permitió determinar la especialidad.
 *
 * Es el único aviso EXPORTADO, y por un motivo puntual: la pantalla del lote
 * (`components/turnos/analizador-mensaje-turno.tsx`) deja completar la
 * especialidad para toda la serie, y en cuanto la persona la escribe este
 * aviso pasa a ser mentira. Al retirarlo hay que nombrarlo, y nombrarlo por
 * la constante -y no repitiendo el string- es lo que evita que se despeguen.
 */
export const AVISO_SIN_ESPECIALIDAD = "No pudimos identificar la especialidad ni el estudio — completalo vos."

/** Avisos de revisión a partir de los campos FINALES (ya fusionados si correspondía). */
function generarAvisos(campos: CamposTurno): string[] {
  const avisos: string[] = []

  if (campos.fecha.length === 0) {
    if (campos.diaSemanaIncongruente) {
      // El mensaje SÍ traía una fecha; lo que no cierra es su año. Decirle a
      // la persona "no la pudimos interpretar" la mandaría a buscar un error
      // de lectura que no existe: el dato que no coincide es el del mensaje.
      const nombreDia = nombreLargoDeDiaSemanaTexto(campos.diaSemanaTexto)
      avisos.push(
        `El mensaje decía "${citaDeLaFechaDelMensaje(campos)}", pero esa fecha no cae ` +
          `${nombreDia.length > 0 ? nombreDia : "ese día"} en ninguno de los años posibles — completala vos.`,
      )
    } else {
      avisos.push("El mensaje no traía una fecha que pudiéramos interpretar — completala vos.")
    }
  } else if (campos.anioInferido && !campos.anioConfirmadoPorDiaSemana) {
    // Con el año confirmado por el día de la semana NO se avisa nada: el
    // mensaje trae su propio dígito verificador y pedir que confirmen algo ya
    // comprobado es ruido — y en una serie de diez sesiones, ruido diez veces.
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
    avisos.push(AVISO_SIN_ESPECIALIDAD)
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
  const etiqueta = formatearEtiquetaSesion(campos.numeroSesion, campos.totalSesiones)
  return etiqueta.length > 0 ? `${etiqueta} — ${fechaHora} — ${quien}` : `${fechaHora} — ${quien}`
}

function normalizarTurnoCrudo(
  crudo: TurnoExtraidoCrudo,
  fechaResuelta: FechaArgentinaParseada | null,
): PropuestaTurno {
  const campos = camposDesdeTurnoCrudo(crudo, fechaResuelta)
  return {
    ...campos,
    avisos: generarAvisos(campos),
    resumen: resumenTurno(campos),
    etiquetaSesion: formatearEtiquetaSesion(campos.numeroSesion, campos.totalSesiones),
  }
}

const CAMPOS_VACIOS: CamposTurno = {
  especialidad: "",
  especialidadInferida: false,
  medico: "",
  esEstudioNoProfesional: false,
  dudaOrdenNombre: false,
  fecha: "",
  fechaTexto: "",
  anioInferido: false,
  anioConfirmadoPorDiaSemana: false,
  diaSemanaIncongruente: false,
  hora: "",
  discrepanciaDiaSemana: false,
  diaSemanaTexto: "",
  lugarNombre: "",
  lugarDireccion: "",
  lugarCiudad: "",
  lugarProvincia: "",
  notasPreparacion: "",
  numeroSesion: 0,
  totalSesiones: 0,
}

/**
 * Caso `turno_mas_confirmacion`: fusiona el mensaje base (`turnos[0]`) con el
 * de confirmación (`turnos[1]`). La confirmación GANA en fecha/hora/médico
 * cuando trae un valor no vacío para ese campo; el resto (lugar, especialidad,
 * notas) viene del mensaje base, completado por la confirmación si el base
 * estaba vacío. Las notas de los dos mensajes se suman.
 */
function construirFusion(crudo: AnalisisMensajeTurnoExtraido, ahora: Date): ResultadoAnalisisMensaje {
  // Las dos lecturas se resuelven POR SEPARADO, no como una serie: son dos
  // mensajes distintos pegados uno atrás del otro, sin ninguna garantía de
  // compartir contexto de calendario. El anclaje entre fechas es una regla de
  // series enumeradas dentro de un mismo mensaje —ver
  // `construirResultadoAnalisis`.
  const base = camposDesdeTurnoCrudo(crudo.turnos[0], resolverFechaSuelta(crudo.turnos[0], ahora))
  const confirmacion = camposDesdeTurnoCrudo(crudo.turnos[1], resolverFechaSuelta(crudo.turnos[1], ahora))

  const confirmacionTraeFecha = confirmacion.fecha.length > 0
  const fecha = confirmacionTraeFecha ? confirmacion.fecha : base.fecha
  const fechaTexto = confirmacionTraeFecha ? confirmacion.fechaTexto : base.fechaTexto
  const anioInferido = confirmacionTraeFecha ? confirmacion.anioInferido : base.anioInferido
  const anioConfirmadoPorDiaSemana = confirmacionTraeFecha
    ? confirmacion.anioConfirmadoPorDiaSemana
    : base.anioConfirmadoPorDiaSemana
  // Solo tiene sentido cuando la fusión quedó SIN fecha: entonces la
  // incongruencia de cualquiera de las dos lecturas es lo que la explica, y
  // sin esto el aviso caería al genérico "no la pudimos interpretar",
  // escondiendo que el mensaje decía un día de la semana que no cierra con
  // ningún año.
  const diaSemanaIncongruente =
    fecha.length === 0 && (base.diaSemanaIncongruente || confirmacion.diaSemanaIncongruente)
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
    fechaTexto,
    anioInferido,
    anioConfirmadoPorDiaSemana,
    diaSemanaIncongruente,
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
    // El número de sesión es un dato del turno, no de la confirmación: gana
    // el que exista, con prioridad de la confirmación si los dos lo traen.
    numeroSesion: confirmacion.numeroSesion || base.numeroSesion,
    totalSesiones: confirmacion.totalSesiones || base.totalSesiones,
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
    propuestaPrincipal: {
      ...campos,
      avisos,
      resumen: resumenTurno(campos),
      etiquetaSesion: formatearEtiquetaSesion(campos.numeroSesion, campos.totalSesiones),
    },
  }
}

/**
 * Los campos del encabezado que, en una serie de sesiones, el mensaje escribe
 * UNA sola vez y valen para todas las citas. Lo que NO está acá es lo propio
 * de cada cita: `fechaTexto`, `diaSemanaTexto`, `horaTexto`, `numeroSesion`,
 * `totalSesiones`.
 *
 * `tipoProfesional`+`profesionalTexto` y `especialidadTexto`+
 * `especialidadInferida` se heredan como PAR, nunca sueltos: heredar el
 * nombre sin su tipo dejaría un "estudio" clasificado como persona (o al
 * revés), y heredar la especialidad sin su bandera de inferencia diría que un
 * dato inferido fue explícito.
 */
function heredarDatosComunes(primero: TurnoExtraidoCrudo, turno: TurnoExtraidoCrudo): TurnoExtraidoCrudo {
  const vacio = (texto: string) => texto.trim().length === 0

  const heredaProfesional = turno.tipoProfesional === "ninguno" || vacio(turno.profesionalTexto)
  const heredaEspecialidad = vacio(turno.especialidadTexto)

  return {
    ...turno,
    tipoProfesional: heredaProfesional ? primero.tipoProfesional : turno.tipoProfesional,
    profesionalTexto: heredaProfesional ? primero.profesionalTexto : turno.profesionalTexto,
    especialidadTexto: heredaEspecialidad ? primero.especialidadTexto : turno.especialidadTexto,
    especialidadInferida: heredaEspecialidad ? primero.especialidadInferida : turno.especialidadInferida,
    lugarNombre: vacio(turno.lugarNombre) ? primero.lugarNombre : turno.lugarNombre,
    lugarDireccion: vacio(turno.lugarDireccion) ? primero.lugarDireccion : turno.lugarDireccion,
    lugarCiudad: vacio(turno.lugarCiudad) ? primero.lugarCiudad : turno.lugarCiudad,
    lugarProvincia: vacio(turno.lugarProvincia) ? primero.lugarProvincia : turno.lugarProvincia,
    notas: turno.notas.some((nota) => nota.trim().length > 0) ? turno.notas : primero.notas,
  }
}

/** Resuelve la fecha de UN turno que no forma parte de una serie enumerada. */
function resolverFechaSuelta(crudo: TurnoExtraidoCrudo, ahora: Date): FechaArgentinaParseada | null {
  return parsearFechaArgentina(
    crudo.fechaTexto.trim(),
    ahora,
    crudo.diaSemanaTexto,
    crudo.anioProbable ?? 0,
  )
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
        etiquetaSesion: "",
      },
    }
  }

  if (crudo.relacion === "turno_mas_confirmacion" && crudo.turnos.length >= 2) {
    return construirFusion(crudo, ahora)
  }

  // Serie de sesiones: los datos del encabezado que el modelo haya escrito
  // solo en el primer elemento se rellenan en los demás ANTES de normalizar
  // -ver "Series de sesiones" en la cabecera del archivo-. Solo rellena
  // huecos, nunca pisa un dato propio.
  const esSerie = crudo.relacion === "varios_turnos" && crudo.turnos.length > 1

  const crudos = esSerie
    ? crudo.turnos.map((turno, indice) =>
        indice === 0 ? turno : heredarDatosComunes(crudo.turnos[0], turno),
      )
    : crudo.turnos

  // Las fechas de una SERIE se resuelven juntas: el año de una fecha que no
  // trae día de la semana se ancla al de sus hermanas ya confirmadas, en vez
  // de irse sola a "la próxima ocurrencia futura" y despegarse un año del
  // resto (ver `resolverFechasDeSerie`). Fuera de una serie cada fecha se
  // resuelve por su cuenta: no hay hermanas que la respalden.
  const fechas = esSerie
    ? resolverFechasDeSerie(
        crudos.map((turno) => ({
          fechaTexto: turno.fechaTexto.trim(),
          diaSemanaTexto: turno.diaSemanaTexto,
          anioProbable: turno.anioProbable ?? 0,
        })),
        ahora,
      )
    : crudos.map((turno) => resolverFechaSuelta(turno, ahora))

  const normalizados = crudos.map((turno, indice) => normalizarTurnoCrudo(turno, fechas[indice]))

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

/**
 * Recorta una `PropuestaTurno` a los campos que `aplicarPrecarga`
 * (`lib/turnos/aplicar-precarga.ts`) sabe volcar al formulario.
 *
 * La etiqueta de sesión entra acá como PRIMERA LÍNEA de `notasPreparacion`:
 * es el único punto por el que "Sesión 3/10" cruza de la propuesta al turno
 * guardado, y por eso lo hacen igual el camino de un turno (precarga del
 * formulario) y el de la creación en lote — ver "Series de sesiones" en la
 * cabecera del archivo para por qué va en las notas y no en una columna nueva.
 */
export function propuestaACamposPrecargables(propuesta: PropuestaTurno): CamposPrecargablesTurno {
  const notasPreparacion =
    propuesta.etiquetaSesion.length > 0
      ? recortar(
          [propuesta.etiquetaSesion, propuesta.notasPreparacion].filter((parte) => parte.length > 0).join("\n"),
          MAX_NOTAS,
        )
      : propuesta.notasPreparacion

  return {
    especialidad: propuesta.especialidad,
    medico: propuesta.medico,
    fecha: propuesta.fecha,
    hora: propuesta.hora,
    lugarNombre: propuesta.lugarNombre,
    lugarDireccion: propuesta.lugarDireccion,
    lugarCiudad: propuesta.lugarCiudad,
    lugarProvincia: propuesta.lugarProvincia,
    notasPreparacion,
  }
}
