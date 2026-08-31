/**
 * Normalización PURA de los fragmentos que Gemini extrae de un mensaje de
 * turno pegado desde WhatsApp (Sprint 16, tarea 16.4 — "pegá el mensaje de la
 * clínica"). Sin React, sin `server-only`, sin llamadas de red: se puede
 * testear con strings de ejemplo sin mockear nada
 * (`tests/unit/normalizacion-mensaje-turno.test.ts`).
 *
 * ## Por qué el cálculo de fecha/hora vive ACÁ y no se lo pedimos a Gemini
 *
 * `lib/gemini/prompt-turno.ts` le pide al modelo que copie la fecha, la hora
 * y el día de la semana TAL COMO aparecen en el texto -sin convertir, sin
 * completar el año, sin normalizar el separador de la hora-. La aritmética de
 * calendario (inferir a qué año futuro corresponde un "14/7" sin año, cotejar
 * si esa fecha realmente cae martes) se resuelve acá, con `Date` real, no
 * pidiéndole a un modelo de lenguaje que haga cuentas: un LLM puede errar un
 * cálculo de calendario con total confianza y sin avisar, y acá el resultado
 * es DETERMINÍSTICO y testeable con casos fijos. Mismo espíritu que la regla
 * del proyecto sobre `DateTimeImmutable::createFromFormat` con el bang -la
 * fecha se calcula explícitamente, nunca se asume-.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  "Jueves 13 de Agosto - 18:30 hs." (agosto 2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bug real de campo: un kinesiólogo mandó por WhatsApp las diez sesiones
 * pendientes de un tratamiento, con las fechas escritas EN PALABRAS y SIN
 * AÑO. El análisis detectaba las diez citas y les sacaba hasta el piso y el
 * departamento de la dirección, pero las diez quedaban "Sin fecha": los
 * únicos formatos que este módulo sabía leer eran `DD/MM/AAAA` y `DD/MM`.
 *
 * Ahora también lee el mes en palabras -con o sin "de", con o sin mayúscula,
 * abreviado ("13 de Agosto", "3 sep", "miércoles 3 de septiembre de 2026")- y
 * tolera que el día de la semana venga PEGADO a la fecha en lugar de en su
 * campo aparte (que es lo que el prompt pide, pero no lo que siempre pasa).
 *
 * ## El año ausente se decide por el DÍA DE LA SEMANA, no por optimismo
 *
 * Un mensaje que dice "Jueves 13 de Agosto" trae su propio dígito
 * verificador: el 13 de agosto cae jueves en 2026 y en ninguno de los años
 * vecinos (en 2025 cae miércoles, en 2027 viernes). El año entonces no se
 * adivina: se COMPRUEBA. La escalera, de más a menos respaldo:
 *
 *  1. **El texto dice el año** → manda el texto y nadie más.
 *  2. **Sin año, con día de la semana** → se prueban el año actual, el
 *     siguiente y el anterior (este último como CONTROL: una serie de
 *     sesiones puede haber empezado hace dos semanas) y gana aquel donde el
 *     día de la semana coincide. Si NINGUNO coincide -típicamente un error de
 *     tipeo de quien mandó el mensaje- la fecha queda VACÍA y la completa la
 *     persona: una fecha inventada en una agenda médica se paga faltando a un
 *     turno.
 *  3. **Sin año y sin día de la semana** → la regla de siempre: la próxima
 *     ocurrencia futura, marcada como inferida y con el aviso que le pide a la
 *     persona que la confirme. No es adivinar sin respaldo: es un criterio
 *     único, documentado y declarado en pantalla, y es el que ya venían
 *     usando los mensajes que solo dicen "Fecha: 28/04".
 *
 * El año que declara el modelo (`anioProbable`, `lib/gemini/schemas.ts`) entra
 * como candidato EXTRA del paso 2, y SOLO ahí: nunca decide solo, siempre
 * tiene que pasar el cotejo del día de la semana, y solo se lo mira cuando la
 * ventana de años vecinos no dio ninguna coincidencia. Un modelo que
 * "recuerda" mal un calendario no puede mover un turno de año sin que el
 * propio mensaje lo respalde.
 *
 * ## Una serie puede abarcar dos años, y eso está contemplado
 *
 * Cada fecha valida SU año por separado, así que una serie que cruza el año
 * nuevo -"Lunes 29 de Diciembre" y "Viernes 2 de Enero"- sale con 2026 y 2027
 * sin ninguna regla especial. `resolverFechasDeSerie` agrega lo único que la
 * validación individual no puede hacer sola: cuando una fecha de la serie no
 * trae día de la semana, en vez de mandarla a la "próxima ocurrencia futura"
 * -que la despegaría un año de sus hermanas- la ancla a las que sí quedaron
 * respaldadas.
 */

const PATRON_HORA_FINAL = /^([01]\d|2[0-3]):[0-5]\d$/
const PATRON_FECHA_CON_ANIO = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
const PATRON_FECHA_SIN_ANIO = /^(\d{1,2})\/(\d{1,2})$/
/** `13 de Agosto`, `13 agosto`, `3 de septiembre de 2026`, `3 sep. 2026`. */
const PATRON_FECHA_EN_PALABRAS = /^(\d{1,2})\s*(?:de\s+)?([a-z]+)\.?(?:\s*(?:del?\s+)?(\d{4}))?$/

/**
 * Normaliza la hora cruda que extrajo Gemini ("14:15 HS", "18.10hs", "09:45
 * hs", "18:30 hs.", "15:21", "19 hs") a `HH:mm` de 24 horas. Devuelve `""` si
 * el texto está vacío o no se puede interpretar con confianza -nunca inventa
 * una hora-.
 */
export function normalizarHora(horaTexto: string): string {
  let texto = horaTexto.trim()
  if (texto.length === 0) return ""

  // Saca el sufijo "hs"/"HS"/"Hs"/"hrs"/"h" (con o sin espacio antes y con o
  // sin punto final), típico de los mensajes de WhatsApp de clínicas
  // ("14:15 HS", "09:45 hs", "18:30 hs.").
  texto = texto.replace(/\s*h(s|rs)?\.?\s*$/i, "").trim()

  // Punto decimal como separador de hora/minuto ("18.10" → "18:10") — trampa
  // documentada del fixture de confirmación de Casa Salud.
  texto = texto.replace(/^(\d{1,2})\.(\d{2})$/, "$1:$2")

  // Hora en punto dicha sin minutos ("19 hs" → "19:00"). Solo después de
  // haber sacado el sufijo: un número suelto que llegó acá ya era una hora.
  texto = texto.replace(/^(\d{1,2})$/, "$1:00")

  // Hora de un solo dígito ("9:45" → "09:45").
  texto = texto.replace(/^(\d):/, "0$1:")

  return PATRON_HORA_FINAL.test(texto) ? texto : ""
}

function fechaValidaComoCalendario(anio: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false
  const fecha = new Date(anio, mes - 1, dia)
  return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia
}

function formatearIso(anio: number, mes: number, dia: number): string {
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
}

export interface FechaArgentinaParseada {
  /**
   * `YYYY-MM-DD`, o `""` cuando el texto traía una fecha legible pero no se
   * pudo determinar su año con respaldo (ver `diaSemanaIncongruente`).
   */
  fecha: string
  /** `true` si el texto original no traía año y se dedujo acá. */
  anioInferido: boolean
  /**
   * `true` si el año deducido lo CONFIRMÓ el día de la semana que declaraba el
   * mensaje. Es lo que separa "sabemos que es 2026 porque el 13 de agosto cae
   * jueves" de "asumimos el próximo 28 de abril" — solo lo segundo necesita
   * que la persona confirme.
   */
  anioConfirmadoPorDiaSemana: boolean
  /**
   * El día de la semana que se usó para validar, tal como lo escribió el
   * mensaje (del campo aparte, o del que venía pegado a la fecha). `""` si el
   * mensaje no decía ninguno.
   */
  diaSemanaTexto: string
  /**
   * `true` cuando el texto SÍ traía una fecha legible y un día de la semana,
   * pero esa fecha no cae ese día en NINGÚN año candidato. `fecha` queda
   * vacía a propósito: la completa la persona.
   */
  diaSemanaIncongruente: boolean
}

const DIAS_SEMANA_ES = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] as const

/** Nombres largos (con tilde) de cada clave de `DIAS_SEMANA_ES`, para armar avisos legibles. */
export const NOMBRE_DIA_SEMANA_LARGO: Record<(typeof DIAS_SEMANA_ES)[number], string> = {
  domingo: "domingo",
  lunes: "lunes",
  martes: "martes",
  miercoles: "miércoles",
  jueves: "jueves",
  viernes: "viernes",
  sabado: "sábado",
}

/**
 * Meses en castellano, incluyendo la variante rioplatense "setiembre". La
 * búsqueda es por PREFIJO de al menos tres letras, así que las abreviaturas
 * habituales ("ene", "abr", "sep", "set", "dic") entran sin listarlas aparte;
 * tres letras es el mínimo que desambigua "mar(zo)" de "may(o)" y
 * "jun(io)" de "jul(io)".
 */
const MESES_ES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
}

// Bloque Unicode "Combining Diacritical Marks" (los acentos que NFD deja
// sueltos), escrito con escapes \uXXXX a propósito -mismo criterio que
// `MARCAS_COMBINANTES` en `lib/lugares/normalizar.ts`-: un carácter
// combinante literal en el código fuente se pega visualmente al vecino y
// vuelve ilegible el diff.
const MARCAS_COMBINANTES = /[\u0300-\u036f]/g

function normalizarPalabra(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(MARCAS_COMBINANTES, "")
    .toLowerCase()
    .trim()
}

/**
 * Busca `palabra` (ya normalizada) entre las claves de un diccionario por
 * prefijo, exigiendo al menos tres letras y que el prefijo apunte a UN solo
 * valor. Devuelve `null` ante una palabra corta, desconocida o ambigua.
 */
function porPrefijo(palabra: string, valores: Record<string, number>): number | null {
  const limpia = palabra.replace(/\.$/, "")
  if (limpia.length < 3) return null

  const exacto = valores[limpia]
  if (exacto !== undefined) return exacto

  const encontrados = new Set(
    Object.keys(valores)
      .filter((clave) => clave.startsWith(limpia))
      .map((clave) => valores[clave]),
  )
  return encontrados.size === 1 ? [...encontrados][0] : null
}

/** Número de mes (1..12) de una palabra en castellano, o `null` si no lo es. */
function numeroDeMes(palabra: string): number | null {
  return porPrefijo(normalizarPalabra(palabra), MESES_ES)
}

const INDICE_DIA_SEMANA: Record<string, number> = Object.fromEntries(
  DIAS_SEMANA_ES.map((dia, indice) => [dia, indice]),
)

/** Índice `0..6` (domingo..sábado) del día de la semana que nombra `texto`, o `null`. */
function indiceDiaSemana(texto: string): number | null {
  return porPrefijo(normalizarPalabra(texto), INDICE_DIA_SEMANA)
}

/** Nombre largo con tilde ("miércoles") del día que nombra `texto`, o `""` si no se reconoce. */
export function nombreLargoDeDiaSemanaTexto(texto: string): string {
  const indice = indiceDiaSemana(texto)
  return indice === null ? "" : NOMBRE_DIA_SEMANA_LARGO[DIAS_SEMANA_ES[indice]]
}

interface FechaCruda {
  dia: number
  mes: number
  /** El año que ESCRIBE el texto, o `null` si no lo trae. */
  anio: number | null
  /** El día de la semana que venía pegado a la fecha ("Jueves 13 de Agosto"), tal cual, o `""`. */
  diaSemanaPegado: string
}

/**
 * Parte una fecha escrita por una clínica en día / mes / año, aceptando los
 * tres formatos que aparecen en los mensajes reales: `DD/MM/AAAA`, `DD/MM` y
 * el mes en palabras. Si delante viene el día de la semana ("Jueves 13 de
 * Agosto"), lo separa en vez de tropezarse con él.
 *
 * Devuelve `null` si el texto no es ninguna de esas formas. La validación de
 * que la fecha EXISTA en el calendario la hace quien resuelve el año -acá
 * todavía puede faltar-.
 */
function descomponerFecha(fechaTexto: string): FechaCruda | null {
  let texto = fechaTexto.trim().replace(/\s+/g, " ")
  if (texto.length === 0) return null

  // El día de la semana tiene su propio campo en el schema, pero el modelo
  // puede dejarlo pegado a la fecha: en vez de perder la fecha entera por eso,
  // se separa acá y se usa igual para validar el año.
  let diaSemanaPegado = ""
  const conDiaSemana = texto.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\.?[\s,]+(.+)$/)
  if (conDiaSemana && indiceDiaSemana(conDiaSemana[1]) !== null) {
    diaSemanaPegado = conDiaSemana[1]
    texto = conDiaSemana[2].trim()
  }

  const conAnio = texto.match(PATRON_FECHA_CON_ANIO)
  if (conAnio) {
    return { dia: Number(conAnio[1]), mes: Number(conAnio[2]), anio: Number(conAnio[3]), diaSemanaPegado }
  }

  const sinAnio = texto.match(PATRON_FECHA_SIN_ANIO)
  if (sinAnio) {
    return { dia: Number(sinAnio[1]), mes: Number(sinAnio[2]), anio: null, diaSemanaPegado }
  }

  const enPalabras = normalizarPalabra(texto).match(PATRON_FECHA_EN_PALABRAS)
  if (enPalabras) {
    const mes = numeroDeMes(enPalabras[2])
    if (mes !== null) {
      return {
        dia: Number(enPalabras[1]),
        mes,
        anio: enPalabras[3] ? Number(enPalabras[3]) : null,
        diaSemanaPegado,
      }
    }
  }

  return null
}

/** Día de la semana (0..6) que le toca a una fecha de calendario. */
function diaSemanaDe(anio: number, mes: number, dia: number): number {
  return new Date(anio, mes - 1, dia).getDay()
}

/**
 * Años a probar para una fecha sin año, EN ORDEN DE PRIORIDAD: el actual, el
 * siguiente, y el anterior como control -un mensaje de "sesiones pendientes"
 * puede enumerar fechas que ya pasaron, como la serie real que empezó dos
 * semanas antes de que la persona pegara el mensaje-.
 */
const DESPLAZAMIENTOS_DE_ANIO = [0, 1, -1] as const

/**
 * El año en el que `dia`/`mes` cae en el día de la semana declarado, o `null`
 * si no cae en ninguno de los candidatos.
 *
 * `anioProbable` (el que declaró el modelo) es el ÚLTIMO candidato y solo se
 * mira si la ventana de años vecinos no dio ninguna coincidencia: el modelo
 * puede ampliar el alcance de la búsqueda, nunca ganarle a un año que el
 * propio mensaje respalda.
 */
function anioSegunDiaSemana(
  dia: number,
  mes: number,
  indiceEsperado: number,
  ahora: Date,
  anioProbable: number,
): number | null {
  const base = ahora.getFullYear()
  const candidatos = DESPLAZAMIENTOS_DE_ANIO.map((desplazamiento) => base + desplazamiento)
  if (anioProbable > 0 && !candidatos.includes(anioProbable)) candidatos.push(anioProbable)

  for (const anio of candidatos) {
    if (!fechaValidaComoCalendario(anio, mes, dia)) continue
    if (diaSemanaDe(anio, mes, dia) === indiceEsperado) return anio
  }
  return null
}

/**
 * Parsea una fecha de un mensaje de turno (`DD/MM/AAAA`, `DD/MM`, o con el mes
 * en palabras, con o sin el día de la semana adelante) y resuelve el año.
 *
 * Devuelve `null` si el texto no es una fecha reconocible. Si SÍ lo es pero su
 * día de la semana no cierra con ningún año candidato, devuelve la fecha
 * VACÍA con `diaSemanaIncongruente: true` -para que la pantalla pueda decir
 * qué pasó en vez de un genérico "no se entendió"-.
 *
 * La escalera completa de cómo se decide el año está en el encabezado del
 * archivo. `ahora` es inyectable para que los tests fijen "hoy" sin depender
 * del reloj real.
 */
export function parsearFechaArgentina(
  fechaTexto: string,
  ahora: Date = new Date(),
  diaSemanaTexto = "",
  anioProbable = 0,
): FechaArgentinaParseada | null {
  const cruda = descomponerFecha(fechaTexto)
  if (!cruda) return null

  const diaSemana = diaSemanaTexto.trim().length > 0 ? diaSemanaTexto.trim() : cruda.diaSemanaPegado

  // 1. El texto trae el año: manda el texto. Si además declara un día de la
  //    semana que no coincide, eso NO cambia la fecha -lo denuncia
  //    `cotejarDiaSemana` como discrepancia y decide la persona-.
  if (cruda.anio !== null) {
    if (!fechaValidaComoCalendario(cruda.anio, cruda.mes, cruda.dia)) return null
    return {
      fecha: formatearIso(cruda.anio, cruda.mes, cruda.dia),
      anioInferido: false,
      anioConfirmadoPorDiaSemana: false,
      diaSemanaTexto: diaSemana,
      diaSemanaIncongruente: false,
    }
  }

  // 2. Sin año, pero con día de la semana: el día de la semana ELIGE el año.
  const indiceEsperado = indiceDiaSemana(diaSemana)
  if (indiceEsperado !== null) {
    const anio = anioSegunDiaSemana(cruda.dia, cruda.mes, indiceEsperado, ahora, anioProbable)
    if (anio === null) {
      return {
        fecha: "",
        anioInferido: false,
        anioConfirmadoPorDiaSemana: false,
        diaSemanaTexto: diaSemana,
        diaSemanaIncongruente: true,
      }
    }
    return {
      fecha: formatearIso(anio, cruda.mes, cruda.dia),
      anioInferido: true,
      anioConfirmadoPorDiaSemana: true,
      diaSemanaTexto: diaSemana,
      diaSemanaIncongruente: false,
    }
  }

  // 3. Sin año y sin día de la semana: la próxima ocurrencia futura, la regla
  //    de siempre. Se marca como inferida y la pantalla pide confirmarla.
  return fechaPorProximaOcurrencia(cruda.dia, cruda.mes, ahora)
}

/** Paso 3 de la escalera: la próxima vez que cae ese día y mes, contando HOY como futuro. */
function fechaPorProximaOcurrencia(dia: number, mes: number, ahora: Date): FechaArgentinaParseada | null {
  let anio = ahora.getFullYear()
  if (!fechaValidaComoCalendario(anio, mes, dia)) return null

  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  if (new Date(anio, mes - 1, dia).getTime() < hoy.getTime()) {
    anio += 1
    // Defensivo: un 29/2 cuyo "año actual" era bisiesto pero el próximo no lo
    // es. No hay fixture que lo ejercite, pero no hay que inventar una fecha
    // inexistente.
    if (!fechaValidaComoCalendario(anio, mes, dia)) return null
  }

  return {
    fecha: formatearIso(anio, mes, dia),
    anioInferido: true,
    anioConfirmadoPorDiaSemana: false,
    diaSemanaTexto: "",
    diaSemanaIncongruente: false,
  }
}

/** Una fecha de la serie, tal como la extrajo el modelo. */
export interface EntradaFechaDeSerie {
  fechaTexto: string
  diaSemanaTexto: string
  /** El año que declaró el modelo, o `0` si no lo declaró. Ver el encabezado: es un candidato, nunca una decisión. */
  anioProbable: number
}

/** `true` cuando el año de esa fecha lo respalda el texto (lo escribía) o su día de la semana. */
function tieneAnioRespaldado(fecha: FechaArgentinaParseada | null): boolean {
  if (!fecha || fecha.fecha.length === 0) return false
  return !fecha.anioInferido || fecha.anioConfirmadoPorDiaSemana
}

/** Días enteros entre dos fechas `YYYY-MM-DD` (solo se usa para comparar distancias). */
function distanciaEnDias(unaIso: string, otraIso: string): number {
  const [a1, m1, d1] = unaIso.split("-").map(Number)
  const [a2, m2, d2] = otraIso.split("-").map(Number)
  return Math.abs(Date.UTC(a1, m1 - 1, d1) - Date.UTC(a2, m2 - 1, d2)) / 86_400_000
}

/**
 * Resuelve TODAS las fechas de una serie enumerada en un mismo mensaje.
 *
 * Cada fecha se resuelve primero por su cuenta (`parsearFechaArgentina`), que
 * es lo que permite que una serie cruce el año nuevo sin ninguna regla
 * especial: "Lunes 29 de Diciembre" y "Viernes 2 de Enero" caen cada una en su
 * año porque cada una valida el suyo.
 *
 * Lo que agrega esta función es el ANCLAJE de las fechas SIN día de la semana.
 * Sueltas, esas caen en el paso 3 ("la próxima ocurrencia futura") y pueden
 * despegarse un año de sus hermanas: en una serie de agosto de 2026 leída el
 * 28 de agosto, un "19 de Agosto" sin día de la semana se iría a 2027 mientras
 * las demás se quedan en 2026. Con anclaje se elige, entre los años vecinos de
 * las fechas YA respaldadas (por su año escrito o por su día de la semana), el
 * que deja esta fecha más cerca de alguna de ellas — que es exactamente el
 * criterio que hace que un "2 de Enero" se vaya al año siguiente cuando sus
 * hermanas son de diciembre, y se quede si son de enero.
 *
 * Si NINGUNA fecha de la serie quedó respaldada no hay a qué anclar, y todas
 * conservan su resolución individual.
 */
export function resolverFechasDeSerie(
  entradas: readonly EntradaFechaDeSerie[],
  ahora: Date = new Date(),
): (FechaArgentinaParseada | null)[] {
  const resueltas = entradas.map((entrada) =>
    parsearFechaArgentina(entrada.fechaTexto, ahora, entrada.diaSemanaTexto, entrada.anioProbable),
  )

  const anclas = resueltas.filter(tieneAnioRespaldado).map((fecha) => fecha!.fecha)
  if (anclas.length === 0) return resueltas

  const aniosCandidatos = [
    ...new Set(
      anclas.flatMap((ancla) => {
        const anio = Number(ancla.slice(0, 4))
        return [anio - 1, anio, anio + 1]
      }),
    ),
  ]

  return resueltas.map((fecha, indice) => {
    if (!fecha || fecha.fecha.length === 0 || tieneAnioRespaldado(fecha)) return fecha

    const cruda = descomponerFecha(entradas[indice].fechaTexto)
    if (!cruda) return fecha

    let elegida: string | null = null
    let mejorDistancia = Number.POSITIVE_INFINITY
    for (const anio of aniosCandidatos) {
      if (!fechaValidaComoCalendario(anio, cruda.mes, cruda.dia)) continue
      const iso = formatearIso(anio, cruda.mes, cruda.dia)
      const distancia = Math.min(...anclas.map((ancla) => distanciaEnDias(iso, ancla)))
      if (distancia < mejorDistancia) {
        mejorDistancia = distancia
        elegida = iso
      }
    }

    return elegida === null ? fecha : { ...fecha, fecha: elegida }
  })
}

/** Día de la semana (sin tilde, minúscula) de una fecha `YYYY-MM-DD`. */
export function nombreDiaSemana(fechaIso: string): (typeof DIAS_SEMANA_ES)[number] {
  const [anio, mes, dia] = fechaIso.split("-").map(Number)
  return DIAS_SEMANA_ES[diaSemanaDe(anio, mes, dia)]
}

/**
 * Coteja el día de la semana que dice el mensaje ("martes", "Mie", con o sin
 * tilde) contra el que realmente le corresponde a `fechaIso`.
 *
 * - `true`: coincide (o `diaSemanaTexto` es una abreviatura válida del real).
 * - `false`: discrepancia real -el mensaje se equivocó de día, o la fecha se
 *   interpretó mal-.
 * - `null`: no hay nada que cotejar (texto vacío o demasiado corto para
 *   identificar un día con confianza).
 */
export function cotejarDiaSemana(fechaIso: string, diaSemanaTexto: string): boolean | null {
  const normalizado = normalizarPalabra(diaSemanaTexto)
  if (normalizado.length < 3) return null

  const real = nombreDiaSemana(fechaIso)
  return real.startsWith(normalizado)
}

const SUFIJO_ADMINISTRATIVO = /\s*\(\s*[A-Za-zÁÉÍÓÚÑáéíóúñ]{1,4}\s*\)\s*$/
// Tratamientos reconocidos, con o sin punto final ("Lic." / "Lic ") y en
// cualquier mayúscula/minúscula. El `\.?\s+` obligatorio después de la
// palabra es lo que evita falsos positivos con apellidos que arrancan igual
// -"Licciardi" o "Drago" no tienen ni punto ni espacio pegado a "lic"/"dr",
// así que no matchean-.
const PATRON_TITULO =
  /^(dr|dra|lic|prof|bioq|klgo|klga|od|obst|farm|t[eé]c)\.?\s+/i

export interface NombreProfesionalNormalizado {
  /** Nombre listo para mostrar: reordenado si el mensaje traía "Apellido, Nombre", sin sufijos administrativos. */
  texto: string
  /**
   * `true` cuando el texto NO trae coma ni tratamiento (Dr./Dra./etc.) y
   * tiene dos o más palabras sueltas: el orden Apellido/Nombre es
   * genuinamente ambiguo para un programa -y muchas veces también para una
   * persona sin contexto-, así que se deja tal cual en vez de arriesgar un
   * reordenamiento incorrecto, y se marca la duda para que la persona lo
   * confirme.
   */
  dudaOrden: boolean
}

/**
 * Normaliza el nombre de un profesional (o su forma "Apellido, Nombre") tal
 * como lo devuelve Gemini -que ya limpia mayúsculas/tildes y separa el rótulo
 * del campo, pero preserva la coma y el orden originales, ver
 * `lib/gemini/prompt-turno.ts`-.
 *
 * Reglas, en orden:
 * 1. Saca sufijos administrativos finales entre paréntesis (ej. "(C)").
 * 2. "Apellido, Nombre" (con o sin espacios irregulares alrededor de la
 *    coma): se reordena a "Nombre Apellido", sin duda. Si el tratamiento
 *    quedó pegado adelante del apellido ("Lic. Ruiz Diaz, Gabriela") se
 *    extrae ANTES de reordenar y se re-antepone al resultado ("Lic. Gabriela
 *    Ruiz Diaz") -si no, queda pegado en el medio ("Gabriela Lic. Ruiz
 *    Diaz")-.
 * 3. Con tratamiento al principio y sin coma (Dr./Dra./Lic./Prof./etc.): el
 *    resto ya está en orden natural, sin duda.
 * 4. Una sola palabra (solo apellido, ej. "Ardans"): nada que reordenar.
 * 5. Dos o más palabras sueltas sin coma ni tratamiento: orden ambiguo,
 *    `dudaOrden: true`.
 */
export function normalizarNombreProfesional(crudo: string): NombreProfesionalNormalizado {
  let texto = crudo.trim().replace(/\s+/g, " ")
  texto = texto.replace(SUFIJO_ADMINISTRATIVO, "").trim()

  if (texto.length === 0) {
    return { texto: "", dudaOrden: false }
  }

  const partesPorComa = texto.split(",")
  if (partesPorComa.length === 2) {
    const apellido = partesPorComa[0].trim()
    const nombre = partesPorComa[1].trim()
    if (apellido.length > 0 && nombre.length > 0) {
      // El tratamiento puede venir pegado adelante del apellido
      // ("LIC. RUIZ DIAZ, GABRIELA"): si no se saca ANTES de reordenar,
      // termina en el medio del nombre reordenado ("GABRIELA LIC. RUIZ
      // DIAZ"). Se extrae, se reordena el resto, y se re-antepone al final.
      const matchTratamiento = apellido.match(PATRON_TITULO)
      const tratamiento = matchTratamiento?.[0].trim() ?? ""
      const apellidoSinTratamiento = tratamiento
        ? apellido.slice(matchTratamiento![0].length).trim()
        : apellido

      if (tratamiento && apellidoSinTratamiento.length > 0) {
        return { texto: `${tratamiento} ${nombre} ${apellidoSinTratamiento}`, dudaOrden: false }
      }
      return { texto: `${nombre} ${apellido}`, dudaOrden: false }
    }
  }

  if (PATRON_TITULO.test(texto)) {
    return { texto, dudaOrden: false }
  }

  const palabras = texto.split(" ").filter(Boolean)
  if (palabras.length <= 1) {
    return { texto, dudaOrden: false }
  }

  return { texto, dudaOrden: true }
}
