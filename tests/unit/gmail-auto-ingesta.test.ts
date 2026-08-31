/**
 * Test de LA COMPUERTA (`lib/gmail/auto-ingesta.ts`): qué se carga solo y qué
 * no (Sprint 17).
 *
 * El archivo entero está escrito alrededor de una idea: **cada motivo tiene su
 * propio caso**. Si mañana alguien afloja uno de los chequeos "porque casi
 * nunca pasa", un test se pone rojo con el nombre de lo que se aflojó. Un solo
 * test de "camino feliz" más otro de "camino triste" no daría esa garantía: la
 * compuerta se abre solo cuando la lista de motivos está vacía, así que hay que
 * probar que CADA motivo, por sí solo, la cierra.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import {
  evaluarDocumentoParaAutoCarga,
  evaluarTurnoParaAutoCarga,
  fraseDeMotivos,
  TEXTO_MOTIVO,
  type EntradaDocumentoAutoCarga,
  type MotivoRevision,
} from "@/lib/gmail/auto-ingesta"
import type { PropuestaTurno, ResultadoAnalisisMensaje } from "@/lib/turnos/construir-propuestas"

const HOY = "2026-08-18"

/* ------------------------------------------------------------------ *
 *  Adjuntos
 * ------------------------------------------------------------------ */

/** El caso perfecto: todo leído, el nombre coincide, nada repetido. */
const DOCUMENTO_PERFECTO: EntradaDocumentoAutoCarga = {
  pacienteDetectado: "GOMEZ, ROBERTO",
  nombrePerfilDestino: "Roberto Gómez",
  fecha: "2026-08-15",
  categoria: "laboratory",
  intencion: "estudio_realizado",
  tituloDetectado: true,
  huellaDuplicada: false,
  marcadoPosibleDuplicado: false,
  duplicadoSemantico: null,
  hoyIso: HOY,
}

describe("evaluarDocumentoParaAutoCarga — el correo perfecto", () => {
  it("se carga solo, sin ningún motivo", () => {
    const veredicto = evaluarDocumentoParaAutoCarga(DOCUMENTO_PERFECTO)
    expect(veredicto.sinDudas).toBe(true)
    expect(veredicto.motivos).toEqual([])
  })

  it("una fecha de HOY también pasa (no es futura)", () => {
    const veredicto = evaluarDocumentoParaAutoCarga({ ...DOCUMENTO_PERFECTO, fecha: HOY })
    expect(veredicto.sinDudas).toBe(true)
  })
})

describe("evaluarDocumentoParaAutoCarga — cada duda, por separado", () => {
  const casos: { nombre: string; cambio: Partial<EntradaDocumentoAutoCarga>; motivo: MotivoRevision }[] =
    [
      {
        nombre: "el documento no dice a nombre de quién viene",
        cambio: { pacienteDetectado: "" },
        motivo: "sin_nombre_de_paciente",
      },
      {
        nombre: "Gemini directamente omitió el campo",
        cambio: { pacienteDetectado: undefined },
        motivo: "sin_nombre_de_paciente",
      },
      {
        nombre: "el nombre es el de OTRA persona de la familia",
        cambio: { pacienteDetectado: "GOMEZ MARIA ELENA" },
        motivo: "nombre_no_coincide",
      },
      {
        nombre: "no se pudo leer la fecha",
        cambio: { fecha: "" },
        motivo: "fecha_no_confiable",
      },
      {
        nombre: "la fecha no existe en el calendario",
        cambio: { fecha: "2026-02-30" },
        motivo: "fecha_no_confiable",
      },
      {
        nombre: "la fecha es futura (el lector leyó mal)",
        cambio: { fecha: "2026-12-01" },
        motivo: "fecha_no_confiable",
      },
      {
        nombre: "el lector no pudo clasificar el documento",
        cambio: { categoria: "other" },
        motivo: "categoria_indeterminada",
      },
      {
        nombre: "no hay institución, ni especialidad, ni médico",
        cambio: { tituloDetectado: false },
        motivo: "sin_datos_de_contexto",
      },
      {
        nombre: "el perfil ya tiene ese mismo archivo",
        cambio: { huellaDuplicada: true },
        motivo: "duplicado_exacto",
      },
      {
        nombre: "hay otro correo pendiente con el mismo adjunto",
        cambio: { marcadoPosibleDuplicado: true },
        motivo: "posible_duplicado",
      },
      {
        nombre: "mismo laboratorio y mismo número de orden que un estudio ya confirmado (Capa 2)",
        cambio: { duplicadoSemantico: "mismo_numero_orden" },
        motivo: "duplicado_numero_orden",
      },
      {
        nombre: "todos los datos extraídos son exactamente iguales a un estudio ya confirmado (Capa 3)",
        cambio: { duplicadoSemantico: "datos_identicos" },
        motivo: "duplicado_datos_identicos",
      },
    ]

  for (const caso of casos) {
    it(`va a revisión: ${caso.nombre}`, () => {
      const veredicto = evaluarDocumentoParaAutoCarga({ ...DOCUMENTO_PERFECTO, ...caso.cambio })
      expect(veredicto.sinDudas).toBe(false)
      expect(veredicto.motivos).toContain(caso.motivo)
    })
  }

  it("junta TODOS los motivos, no corta en el primero", () => {
    const veredicto = evaluarDocumentoParaAutoCarga({
      ...DOCUMENTO_PERFECTO,
      pacienteDetectado: "",
      fecha: "",
      categoria: "other",
    })
    expect(veredicto.motivos).toEqual([
      "sin_nombre_de_paciente",
      "fecha_no_confiable",
      "categoria_indeterminada",
    ])
  })
})

/* ------------------------------------------------------------------ *
 *  Turnos
 * ------------------------------------------------------------------ */

const PROPUESTA_LIMPIA: PropuestaTurno = {
  especialidad: "Cardiología",
  especialidadInferida: false,
  medico: "Dra. Pérez",
  esEstudioNoProfesional: false,
  dudaOrdenNombre: false,
  fecha: "2026-08-25",
  fechaTexto: "25/08/2026",
  anioInferido: false,
  anioConfirmadoPorDiaSemana: false,
  diaSemanaIncongruente: false,
  hora: "14:30",
  discrepanciaDiaSemana: false,
  diaSemanaTexto: "martes",
  lugarNombre: "Sanatorio San Jorge",
  lugarDireccion: "San Martín 123",
  lugarCiudad: "Ushuaia",
  lugarProvincia: "Tierra del Fuego",
  notasPreparacion: "",
  numeroSesion: 0,
  totalSesiones: 0,
  etiquetaSesion: "",
  avisos: [],
  resumen: "25/08/2026 14:30 — Dra. Pérez",
}

const ANALISIS_LIMPIO: ResultadoAnalisisMensaje = {
  relacion: "unico",
  explicacion: "Un solo turno",
  propuestaPrincipal: PROPUESTA_LIMPIA,
  otrasPropuestas: [],
  contradiccion: null,
}

const TEXTO_CON_NOMBRE = "Turno confirmado\nPaciente: GOMEZ ROBERTO\nFecha: 25/08/2026 14:30"

describe("evaluarTurnoParaAutoCarga — el aviso perfecto", () => {
  it("se carga solo, sin ningún motivo", () => {
    const veredicto = evaluarTurnoParaAutoCarga({
      analisis: ANALISIS_LIMPIO,
      textoDelCorreo: TEXTO_CON_NOMBRE,
      nombrePerfilDestino: "Roberto Gómez",
      hoyIso: HOY,
    })
    expect(veredicto.sinDudas).toBe(true)
    expect(veredicto.motivos).toEqual([])
  })
})

describe("evaluarTurnoParaAutoCarga — cada flag del analizador 16.4 cierra la compuerta", () => {
  /**
   * Los cinco flags que el encargo enumera se manifiestan todos como AVISOS de
   * `generarAvisos` (`lib/turnos/construir-propuestas.ts`), así que se prueban
   * a través de ellos: es la garantía de que la compuerta no tiene su propia
   * definición paralela de "dudoso" que pueda separarse de la del analizador.
   */
  const avisos: { nombre: string; aviso: string }[] = [
    { nombre: "año inferido", aviso: "El mensaje no decía el año — asumimos 2026. Confirmalo." },
    { nombre: "hora vacía", aviso: "El mensaje no decía la hora — completala vos." },
    { nombre: "discrepancia de día", aviso: 'El mensaje decía "lunes" pero el 25/08/2026 cae martes.' },
    { nombre: "orden de nombre dudoso", aviso: "No pudimos confirmar si está en orden Nombre Apellido." },
    { nombre: "especialidad inferida", aviso: '"Cardiología" es una inferencia nuestra.' },
  ]

  for (const caso of avisos) {
    it(`va a revisión: ${caso.nombre}`, () => {
      const veredicto = evaluarTurnoParaAutoCarga({
        analisis: {
          ...ANALISIS_LIMPIO,
          propuestaPrincipal: { ...PROPUESTA_LIMPIA, avisos: [caso.aviso] },
        },
        textoDelCorreo: TEXTO_CON_NOMBRE,
        nombrePerfilDestino: "Roberto Gómez",
        hoyIso: HOY,
      })
      expect(veredicto.sinDudas).toBe(false)
      expect(veredicto.motivos).toContain("aviso_del_analizador")
    })
  }

  it("va a revisión: el correo traía dos turnos", () => {
    const veredicto = evaluarTurnoParaAutoCarga({
      analisis: {
        ...ANALISIS_LIMPIO,
        relacion: "varios_turnos",
        otrasPropuestas: [PROPUESTA_LIMPIA],
      },
      textoDelCorreo: TEXTO_CON_NOMBRE,
      nombrePerfilDestino: "Roberto Gómez",
      hoyIso: HOY,
    })
    expect(veredicto.motivos).toContain("varios_mensajes")
  })

  it("va a revisión: la fusión encontró una contradicción", () => {
    const veredicto = evaluarTurnoParaAutoCarga({
      analisis: {
        ...ANALISIS_LIMPIO,
        relacion: "turno_mas_confirmacion",
        contradiccion: "El primer mensaje decía el 20/08 y la confirmación dice 25/08.",
      },
      textoDelCorreo: TEXTO_CON_NOMBRE,
      nombrePerfilDestino: "Roberto Gómez",
      hoyIso: HOY,
    })
    expect(veredicto.motivos).toContain("contradiccion")
    expect(veredicto.motivos).toContain("varios_mensajes")
  })

  it("va a revisión: el turno ya pasó", () => {
    const veredicto = evaluarTurnoParaAutoCarga({
      analisis: {
        ...ANALISIS_LIMPIO,
        propuestaPrincipal: { ...PROPUESTA_LIMPIA, fecha: "2026-07-01" },
      },
      textoDelCorreo: TEXTO_CON_NOMBRE,
      nombrePerfilDestino: "Roberto Gómez",
      hoyIso: HOY,
    })
    expect(veredicto.motivos).toContain("turno_vencido")
  })

  it("va a revisión: el aviso es de otra persona de la familia", () => {
    const veredicto = evaluarTurnoParaAutoCarga({
      analisis: ANALISIS_LIMPIO,
      textoDelCorreo: "Turno confirmado\nPaciente: GOMEZ MARIA ELENA\nAcompaña: Roberto",
      nombrePerfilDestino: "Roberto Gómez",
      hoyIso: HOY,
    })
    expect(veredicto.motivos).toContain("nombre_no_coincide")
  })

  it("va a revisión: el correo no menciona a nadie", () => {
    const veredicto = evaluarTurnoParaAutoCarga({
      analisis: ANALISIS_LIMPIO,
      textoDelCorreo: "Le recordamos su turno del 25/08 a las 14:30.",
      nombrePerfilDestino: "Roberto Gómez",
      hoyIso: HOY,
    })
    expect(veredicto.motivos).toContain("nombre_no_coincide")
  })
})

/* ------------------------------------------------------------------ *
 *  Lo que la persona lee
 * ------------------------------------------------------------------ */

describe("fraseDeMotivos", () => {
  it("sin motivos no hay frase", () => {
    expect(fraseDeMotivos([])).toBeNull()
  })

  it("un motivo solo, sin coma ni «y»", () => {
    expect(fraseDeMotivos(["sin_nombre_de_paciente"])).toBe(
      "Quedó para que lo mires vos: no dice a nombre de quién viene.",
    )
  })

  it("dos motivos van unidos con «y»", () => {
    expect(fraseDeMotivos(["fecha_no_confiable", "categoria_indeterminada"])).toBe(
      "Quedó para que lo mires vos: no pudimos leer con seguridad la fecha y no pudimos identificar qué tipo de estudio es.",
    )
  })

  it("tres o más: comas y un «y» al final", () => {
    const frase = fraseDeMotivos([
      "sin_nombre_de_paciente",
      "fecha_no_confiable",
      "categoria_indeterminada",
    ])
    expect(frase).toContain(", ")
    expect(frase).toContain(" y ")
  })

  it("todos los motivos tienen texto en castellano, sin jerga técnica", () => {
    for (const [motivo, texto] of Object.entries(TEXTO_MOTIVO)) {
      expect(texto.length, motivo).toBeGreaterThan(10)
      // Ninguna frase puede sonar a mensaje de error de programador.
      expect(texto.toLowerCase(), motivo).not.toContain("error")
      expect(texto.toLowerCase(), motivo).not.toContain("null")
      expect(texto.toLowerCase(), motivo).not.toContain("inválid")
    }
  })
})

/* ------------------------------------------------------------------ *
 *  SPRINT 18 — la titularidad en la compuerta
 * ------------------------------------------------------------------ */

describe("evaluarDocumentoParaAutoCarga — titularidad (Sprint 18)", () => {
  it("el apellido truncado por el laboratorio ya NO se lee como «es de otra persona»", () => {
    const veredicto = evaluarDocumentoParaAutoCarga({
      ...DOCUMENTO_PERFECTO,
      pacienteDetectado: "GOME, ROBERTO",
      nombrePerfilDestino: "Roberto Gómez",
    })
    // Sigue yendo a revisión -la compuerta no se ablandó-, pero con la frase
    // correcta: es una pregunta, no una acusación.
    expect(veredicto.sinDudas).toBe(false)
    expect(veredicto.motivos).toContain("titularidad_a_confirmar")
    expect(veredicto.motivos).not.toContain("nombre_no_coincide")
  })

  it("un código interno donde va el nombre se lee como «no dice de quién es»", () => {
    const veredicto = evaluarDocumentoParaAutoCarga({
      ...DOCUMENTO_PERFECTO,
      pacienteDetectado: "MDAHE15061985",
    })
    expect(veredicto.motivos).toContain("sin_nombre_de_paciente")
    expect(veredicto.motivos).not.toContain("nombre_no_coincide")
  })

  it("un DNI que no corrobora NO cierra la compuerta con un rechazo: la manda a confirmar", () => {
    const veredicto = evaluarDocumentoParaAutoCarga({
      ...DOCUMENTO_PERFECTO,
      dniDetectado: "31479089",
      dniPerfil: "31473089",
    })
    expect(veredicto.motivos).toEqual(["titularidad_a_confirmar"])
  })

  it("el DNI que SÍ corrobora deja la compuerta abierta", () => {
    const veredicto = evaluarDocumentoParaAutoCarga({
      ...DOCUMENTO_PERFECTO,
      dniDetectado: "31.473.089",
      dniPerfil: "31473089",
    })
    expect(veredicto.sinDudas).toBe(true)
  })

  it("el estudio de otra persona sigue cerrando la compuerta con nombre_no_coincide", () => {
    const veredicto = evaluarDocumentoParaAutoCarga({
      ...DOCUMENTO_PERFECTO,
      pacienteDetectado: "GOMEZ MARIA ELENA",
    })
    expect(veredicto.motivos).toContain("nombre_no_coincide")
  })

  it("el motivo nuevo tiene su frase para la bandeja", () => {
    expect(TEXTO_MOTIVO.titularidad_a_confirmar).toBe(
      "hay que confirmar que el estudio es de esta persona",
    )
  })
})
