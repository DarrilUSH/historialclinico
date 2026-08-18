/**
 * LA COMPUERTA: ¿este correo se puede cargar solo, sin que nadie lo mire?
 * (Sprint 17, auto-carga sin dudas.)
 *
 * **Puro, sin red, sin `server-only`, sin base de datos.** Recibe lo que ya
 * se leyó y devuelve un veredicto con sus motivos. Todo el resto del circuito
 * -bajar el adjunto, llamar a Gemini, subir a Storage, escribir en la base- se
 * apoya en estas funciones y no vuelve a decidir nada por su cuenta. Se prueba
 * con literales (`tests/unit/gmail-auto-ingesta.test.ts`), sin mockear nada.
 *
 * ## La regla, en una frase
 *
 * **La compuerta se abre solo si NO hay ni un motivo.** No hay puntajes, no
 * hay umbrales, no hay "dos de tres". Cualquier motivo -uno solo- manda el
 * correo a la bandeja de revisión, que es el comportamiento de siempre y el
 * que la persona ya conoce. Por eso las funciones devuelven la LISTA de
 * motivos y no un booleano a secas: `sinDudas` es exactamente
 * `motivos.length === 0`, y los motivos son lo que la bandeja le muestra a la
 * persona para explicarle por qué ese correo quedó esperando ("Quedó para que
 * lo mires: el mensaje no decía la hora").
 *
 * ## Por qué la duda por DEFECTO, siempre
 *
 * Los dos errores posibles no cuestan lo mismo. Un falso negativo -algo
 * clarísimo que igual queda para revisar- le cuesta a la persona dos toques,
 * exactamente los mismos que hoy. Un falso positivo -algo dudoso que entra
 * solo- le mete a alguien en su historial médico un dato equivocado, en
 * silencio, y puede no enterarse nunca. Cada vez que este archivo tuvo que
 * elegir, eligió el primero: sin nombre de paciente es duda, categoría "otro"
 * es duda, un campo que no se pudo leer es duda, un turno con un solo aviso es
 * duda.
 *
 * ## El caso del correo SIN nombre de paciente (decisión declarada)
 *
 * Un correo que no dice a nombre de quién viene **es una duda** y va a
 * revisión humana. No se auto-carga "porque no hay nada que contradiga que sea
 * tuyo". El caso real que decide esto: la casilla del usuario recibe estudios
 * de su madre. Ahí la ausencia de nombre no es información neutra —es
 * justamente la situación en la que nadie puede saber de quién es el estudio—,
 * y "sin ninguna duda" tiene que significar confirmación POSITIVA de
 * titularidad, no ausencia de contradicción. El costo de la decisión es
 * conocido y aceptado: los correos de clínicas que no imprimen el nombre del
 * paciente nunca se van a cargar solos, y se revisan a mano como hasta hoy.
 */

import type { CategoriaDocumentoExtraida } from "@/lib/gemini/schemas"
import { coincideNombreDePaciente, nombreApareceEnTexto } from "@/lib/gmail/coincidencia-nombre"
import type { ResultadoAnalisisMensaje } from "@/lib/turnos/construir-propuestas"

/**
 * Por qué un correo NO se cargó solo. Cada motivo es una frase que la persona
 * va a leer en la bandeja, así que son concretos: "no decía la hora", no
 * "validación fallida".
 */
export type MotivoRevision =
  /* --- Comunes a los dos caminos --- */
  /** El nombre del perfil de destino y el del documento/correo no son el mismo. */
  | "nombre_no_coincide"
  /** No se pudo determinar a nombre de quién viene. Ver el encabezado: es duda. */
  | "sin_nombre_de_paciente"
  /* --- Adjuntos --- */
  /** El archivo no se pudo leer (Gemini no contestó, o contestó algo que no valida). */
  | "lectura_fallida"
  /** El documento no traía una fecha que se pudiera interpretar, o la fecha es imposible. */
  | "fecha_no_confiable"
  /** El lector no pudo clasificar el documento: quedó en "otro". */
  | "categoria_indeterminada"
  /** No se detectó institución, ni especialidad, ni médico: el título saldría genérico. */
  | "sin_datos_de_contexto"
  /** El perfil ya tiene un documento con la misma huella. */
  | "duplicado_exacto"
  /** Otro correo pendiente trae un adjunto con el mismo nombre y tamaño. */
  | "posible_duplicado"
  /** El perfil ya tiene un documento CONFIRMADO del mismo laboratorio con el mismo N° de orden (Capa 2). */
  | "duplicado_numero_orden"
  /** El perfil ya tiene un documento CONFIRMADO con exactamente los mismos datos extraídos (Capa 3). */
  | "duplicado_datos_identicos"
  /** El correo trae más de un archivo importable: cuál (o cuáles) es una decisión. */
  | "varios_adjuntos"
  /* --- Turnos --- */
  /** El analizador 16.4 dejó al menos un aviso sobre la propuesta. */
  | "aviso_del_analizador"
  /** El texto traía más de un turno, o un turno más su confirmación. */
  | "varios_mensajes"
  /** La fusión detectó datos contradictorios entre los mensajes. */
  | "contradiccion"
  /** La fecha del turno ya pasó. */
  | "turno_vencido"

/**
 * Qué le dice cada motivo a la persona, en la bandeja. Frases cortas, en
 * castellano, sin jerga y sin culpar a nadie: describen qué faltó, no qué
 * salió mal.
 */
export const TEXTO_MOTIVO: Record<MotivoRevision, string> = {
  nombre_no_coincide: "el nombre que figura no es el del perfil elegido",
  sin_nombre_de_paciente: "no dice a nombre de quién viene",
  lectura_fallida: "no pudimos leer el archivo automáticamente",
  fecha_no_confiable: "no pudimos leer con seguridad la fecha",
  categoria_indeterminada: "no pudimos identificar qué tipo de estudio es",
  sin_datos_de_contexto: "no dice de qué institución ni de qué especialidad es",
  duplicado_exacto: "ya tenías cargado un archivo idéntico",
  posible_duplicado: "puede estar repetido con otro correo",
  duplicado_numero_orden: "ya tenías cargado un estudio del mismo laboratorio con el mismo número de orden",
  duplicado_datos_identicos: "ya tenías cargado un estudio con exactamente los mismos datos",
  varios_adjuntos: "traía más de un archivo y hay que elegir cuál",
  aviso_del_analizador: "faltaban datos del turno",
  varios_mensajes: "el correo traía más de un turno",
  contradiccion: "los datos del correo se contradicen entre sí",
  turno_vencido: "la fecha del turno ya pasó",
}

/** El resultado de la compuerta: se abre, o no, y por qué no. */
export interface VeredictoAutoCarga {
  /** `true` si y solo si `motivos` está vacío. */
  sinDudas: boolean
  motivos: MotivoRevision[]
}

function veredicto(motivos: MotivoRevision[]): VeredictoAutoCarga {
  return { sinDudas: motivos.length === 0, motivos }
}

/**
 * Los motivos, en una frase para la bandeja. `null` si no hubo ninguno.
 *
 * Se listan TODOS y no solo el primero: si un correo quedó afuera por tres
 * cosas, decir solo una haría que la persona creyera que arreglando eso se
 * carga solo la próxima vez.
 */
export function fraseDeMotivos(motivos: readonly MotivoRevision[]): string | null {
  if (motivos.length === 0) return null

  const textos = motivos.map((motivo) => TEXTO_MOTIVO[motivo])
  const listado =
    textos.length === 1
      ? textos[0]
      : `${textos.slice(0, -1).join(", ")} y ${textos[textos.length - 1]}`

  return `Quedó para que lo mires vos: ${listado}.`
}

/**
 * `YYYY-MM-DD` bien formada Y existente (rechaza 2026-02-30).
 *
 * Se compara como TEXTO contra la fecha de hoy en el resto de la compuerta, y
 * nunca como `Date`: son fechas sin hora, y convertirlas a `Date` para
 * compararlas es el camino directo al bug de "un día antes" según la zona
 * horaria del servidor.
 */
function esFechaIsoValida(valor: string): boolean {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor)
  if (!coincidencia) return false

  const anio = Number(coincidencia[1])
  const mes = Number(coincidencia[2])
  const dia = Number(coincidencia[3])

  if (anio < 1901 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return false

  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 12, 0, 0))
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  )
}

/** Lo que la compuerta necesita saber de un adjunto ya leído. */
export interface EntradaDocumentoAutoCarga {
  /** Nombre del paciente que devolvió Gemini. `undefined`/vacío = no vino. */
  pacienteDetectado: string | undefined
  /** `profiles.full_name` del perfil de destino elegido en el interruptor. */
  nombrePerfilDestino: string
  /** `YYYY-MM-DD` que devolvió Gemini. Vacío si no la pudo leer. */
  fecha: string
  categoria: CategoriaDocumentoExtraida
  /** `sugerirTitulo(...).detectado`: hubo institución, especialidad o médico. */
  tituloDetectado: boolean
  /** El perfil ya tiene un documento con esta misma huella. */
  huellaDuplicada: boolean
  /** Otro correo PENDIENTE trae un adjunto con el mismo nombre y tamaño. */
  marcadoPosibleDuplicado: boolean
  /**
   * Resultado del cotejo de duplicados SEMÁNTICOS (Capas 2 y 3,
   * `lib/gmail/duplicados-semanticos-admin.ts`): `null` si no coincide con
   * ningún documento confirmado del perfil, o el motivo de la capa que sí
   * coincidió. A diferencia de `huellaDuplicada` (Capa 1, cotejo por bytes
   * ANTES de gastar la llamada a Gemini), este cotejo necesita la extracción
   * ya hecha, así que corre DESPUÉS -mismo orden que el camino humano-.
   */
  duplicadoSemantico: "mismo_numero_orden" | "datos_identicos" | null
  /** Hoy en `YYYY-MM-DD`, hora de pared de Ushuaia. Inyectable para los tests. */
  hoyIso: string
}

/**
 * ¿Este adjunto entra solo al historial?
 *
 * El orden de los chequeos no cambia el resultado -se juntan todos los
 * motivos, no se corta en el primero-, pero sí el orden en que la persona los
 * lee: primero de quién es, después qué se pudo leer, al final si está
 * repetido.
 */
export function evaluarDocumentoParaAutoCarga(
  entrada: EntradaDocumentoAutoCarga,
): VeredictoAutoCarga {
  const motivos: MotivoRevision[] = []

  const paciente = (entrada.pacienteDetectado ?? "").trim()
  if (paciente.length === 0) {
    motivos.push("sin_nombre_de_paciente")
  } else if (!coincideNombreDePaciente(paciente, entrada.nombrePerfilDestino)) {
    motivos.push("nombre_no_coincide")
  }

  // Fecha: tiene que existir, ser una fecha de verdad y no ser del futuro. Un
  // estudio con fecha futura significa que el lector se equivocó leyendo, no
  // que el estudio sea de mañana — es la misma guarda que ya aplica
  // `confirmar_documento_recien_subido` cuando la confirma una persona.
  const fecha = entrada.fecha.trim()
  if (fecha.length === 0 || !esFechaIsoValida(fecha) || fecha > entrada.hoyIso) {
    motivos.push("fecha_no_confiable")
  }

  // "other" es la categoría de reserva del schema ("cualquier otro caso,
  // incluido un documento ilegible"). Que el lector caiga ahí es justamente la
  // señal de que no entendió qué tenía delante.
  if (entrada.categoria === "other") {
    motivos.push("categoria_indeterminada")
  }

  // Sin institución, ni especialidad, ni médico, el título que se guardaría
  // sería la etiqueta genérica de la categoría. La pantalla de revisión ya
  // marca ese caso con "No se detectó — completalo vos"
  // (`lib/documentos/sugerir-titulo.ts`): si ahí hace falta una persona, acá
  // también.
  if (!entrada.tituloDetectado) {
    motivos.push("sin_datos_de_contexto")
  }

  if (entrada.huellaDuplicada) {
    motivos.push("duplicado_exacto")
  }
  if (entrada.marcadoPosibleDuplicado) {
    motivos.push("posible_duplicado")
  }
  if (entrada.duplicadoSemantico === "mismo_numero_orden") {
    motivos.push("duplicado_numero_orden")
  } else if (entrada.duplicadoSemantico === "datos_identicos") {
    motivos.push("duplicado_datos_identicos")
  }

  return veredicto(motivos)
}

/** Lo que la compuerta necesita saber de un aviso de turno ya analizado. */
export interface EntradaTurnoAutoCarga {
  /** Lo que devolvió `analizarMensajeTurno` (Sprint 16, tarea 16.4). */
  analisis: ResultadoAnalisisMensaje
  /** Asunto + cuerpo del correo, tal como el barrido los tiene en memoria. */
  textoDelCorreo: string
  /** `profiles.full_name` del perfil de destino elegido en el interruptor. */
  nombrePerfilDestino: string
  /** Hoy en `YYYY-MM-DD`, hora de pared de Ushuaia. Inyectable para los tests. */
  hoyIso: string
}

/**
 * ¿Este aviso de turno se carga solo?
 *
 * **Los avisos del analizador 16.4 SON los flags.** No se reimplementa acá la
 * lista del encargo (año inferido, hora vacía, discrepancia de día, orden de
 * nombre dudoso, especialidad inferida): `generarAvisos`
 * (`lib/turnos/construir-propuestas.ts`) ya produce exactamente uno por cada
 * una de esas situaciones, sobre los campos FINALES y ya fusionados, y esa
 * función está probada caso por caso. Reescribir la lista acá sería tener dos
 * definiciones de "dudoso" que se van a separar el día que se agregue un aviso
 * nuevo — y se separarían en silencio, hacia el lado peligroso. Entonces la
 * regla es de una línea: **un aviso, cualquiera, y va a revisión.**
 */
export function evaluarTurnoParaAutoCarga(entrada: EntradaTurnoAutoCarga): VeredictoAutoCarga {
  const motivos: MotivoRevision[] = []
  const { analisis } = entrada
  const propuesta = analisis.propuestaPrincipal

  if (!nombreApareceEnTexto(entrada.textoDelCorreo, entrada.nombrePerfilDestino)) {
    // Acá no se puede distinguir "el correo no trae ningún nombre" de "trae
    // el de otra persona": en los dos casos el nombre del perfil no aparece, y
    // en los dos casos la respuesta correcta es la misma.
    motivos.push("nombre_no_coincide")
  }

  if (propuesta.avisos.length > 0) {
    motivos.push("aviso_del_analizador")
  }

  if (analisis.relacion !== "unico" || analisis.otrasPropuestas.length > 0) {
    motivos.push("varios_mensajes")
  }

  if (analisis.contradiccion !== null) {
    motivos.push("contradiccion")
  }

  // Un turno con fecha pasada no se crea solo: o el aviso es viejo (el barrido
  // alcanzó un correo de hace meses) o la fecha se leyó mal. En los dos casos
  // la persona tiene que verlo. `fecha` vacía ya vino con su aviso, así que no
  // se cuenta dos veces.
  if (propuesta.fecha.length > 0 && propuesta.fecha < entrada.hoyIso) {
    motivos.push("turno_vencido")
  }

  return veredicto(motivos)
}
