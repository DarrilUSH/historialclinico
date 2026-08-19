/**
 * Test del cotejo de titularidad (`lib/gmail/coincidencia-nombre.ts`).
 *
 * De todos los criterios de la compuerta de auto-carga, este es el único cuyo
 * fallo produce un daño que la persona podría no notar nunca: un estudio de
 * otra persona metido en su historial médico, en silencio. Por eso el archivo
 * se prueba en los dos sentidos —lo que TIENE que coincidir y, sobre todo, lo
 * que NO puede coincidir— y el caso real del encargo (la casilla que recibe los
 * estudios de la madre) tiene su propio `describe`.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import {
  coincideNombreDePaciente,
  evaluarDni,
  evaluarNombre,
  evaluarTitularidad,
  nombreApareceEnTexto,
  pareceCodigoInterno,
  tokensDeNombre,
} from "@/lib/gmail/coincidencia-nombre"
import { caso } from "@/tests/fixtures/documentos-sinteticos/casos"

describe("tokensDeNombre", () => {
  it("plancha tildes, eñes y mayúsculas", () => {
    expect(tokensDeNombre("Núñez Muñoz")).toEqual(["nunez", "munoz"])
    expect(tokensDeNombre("HERNÁNDEZ")).toEqual(["hernandez"])
  })

  it("saca la puntuación de «Apellido, Nombre»", () => {
    expect(tokensDeNombre("GOMEZ, ROBERTO")).toEqual(["gomez", "roberto"])
  })

  it("descarta tratamientos y rótulos de formulario", () => {
    expect(tokensDeNombre("Paciente: Sra. María Gómez")).toEqual(["maria", "gomez"])
  })

  it("descarta partículas de apellido compuesto", () => {
    expect(tokensDeNombre("Juan de la Cruz")).toEqual(["juan", "cruz"])
    expect(tokensDeNombre("DE LA CRUZ, JUAN")).toEqual(["cruz", "juan"])
  })

  it("descarta iniciales sueltas y números pegados", () => {
    expect(tokensDeNombre("Roberto C. Gómez 28123456")).toEqual(["roberto", "gomez"])
  })

  it("no explota con basura", () => {
    expect(tokensDeNombre("")).toEqual([])
    expect(tokensDeNombre("   ")).toEqual([])
    expect(tokensDeNombre("...")).toEqual([])
  })
})

describe("coincideNombreDePaciente — lo que SÍ es la misma persona", () => {
  it("acepta el orden invertido", () => {
    expect(coincideNombreDePaciente("GOMEZ ROBERTO", "Roberto Gómez")).toBe(true)
  })

  it("acepta «Apellido, Nombre» con coma", () => {
    expect(coincideNombreDePaciente("GOMEZ, ROBERTO", "Roberto Gómez")).toBe(true)
  })

  it("acepta que la clínica escriba el nombre legal completo", () => {
    expect(coincideNombreDePaciente("GOMEZ ROBERTO CARLOS", "Roberto Gómez")).toBe(true)
  })

  it("acepta tildes de un lado y no del otro", () => {
    expect(coincideNombreDePaciente("MARIA HERNANDEZ", "María Hernández")).toBe(true)
  })

  it("acepta el rótulo del formulario pegado adelante", () => {
    expect(coincideNombreDePaciente("Paciente: Sra. María Hernández", "María Hernández")).toBe(true)
  })

  it("acepta el DNI pegado al nombre", () => {
    expect(coincideNombreDePaciente("HERNANDEZ MARIA - DNI 28123456", "María Hernández")).toBe(true)
  })
})

describe("coincideNombreDePaciente — lo que NO puede pasar", () => {
  it("rechaza a otra persona de la misma familia", () => {
    expect(coincideNombreDePaciente("MARIA ELENA GOMEZ", "Roberto Gómez")).toBe(false)
  })

  it("rechaza cuando solo coincide el apellido", () => {
    expect(coincideNombreDePaciente("GOMEZ", "Roberto Gómez")).toBe(false)
  })

  it("rechaza cuando solo coincide el nombre de pila", () => {
    expect(coincideNombreDePaciente("ROBERTO PEREZ", "Roberto Gómez")).toBe(false)
  })

  it("rechaza si al perfil le falta un token en lo detectado", () => {
    // El perfil dice tres palabras y el documento dos: puede ser la misma
    // persona o no, y "puede" no alcanza.
    expect(coincideNombreDePaciente("Roberto Gómez", "Roberto Carlos Gómez")).toBe(false)
  })

  it("rechaza apodos y diminutivos", () => {
    expect(coincideNombreDePaciente("BETO GOMEZ", "Roberto Gómez")).toBe(false)
  })

  it("rechaza un nombre de perfil de una sola palabra, aunque coincida", () => {
    expect(coincideNombreDePaciente("Roberto", "Roberto")).toBe(false)
    expect(coincideNombreDePaciente("ROBERTO GOMEZ", "Roberto")).toBe(false)
  })

  it("rechaza el vacío por los dos lados", () => {
    expect(coincideNombreDePaciente("", "Roberto Gómez")).toBe(false)
    expect(coincideNombreDePaciente("ROBERTO GOMEZ", "")).toBe(false)
  })
})

describe("nombreApareceEnTexto — el nombre tiene que estar JUNTO", () => {
  const AVISO = `
    Estimado/a, le recordamos su turno.
    Paciente: GOMEZ ROBERTO
    Fecha: 25/08/2026 - 14:30 hs
    Profesional: Dra. Pérez
  `

  it("lo encuentra en el cuerpo de un aviso real", () => {
    expect(nombreApareceEnTexto(AVISO, "Roberto Gómez")).toBe(true)
  })

  it("lo encuentra con un segundo nombre en el medio", () => {
    expect(nombreApareceEnTexto("Paciente: GOMEZ ROBERTO CARLOS\nFecha: 25/08", "Roberto Gómez")).toBe(
      true,
    )
  })

  it("lo encuentra en el asunto", () => {
    expect(nombreApareceEnTexto("Turno confirmado - GOMEZ ROBERTO", "Roberto Gómez")).toBe(true)
  })

  /**
   * EL CASO QUE JUSTIFICA LA CONTIGÜIDAD. El aviso es de la madre; el apellido
   * es el mismo, y el nombre del hijo aparece más abajo porque es quien la
   * acompaña. Sin exigir que los tokens estén juntos, esto daría positivo y el
   * turno de la madre se cargaría en el historial del hijo.
   */
  it("NO da positivo cuando los tokens están desperdigados", () => {
    const avisoDeLaMadre = `
      Paciente: GOMEZ MARIA ELENA
      Fecha: 25/08/2026 - 14:30 hs
      Acompañante autorizado: Roberto
      Consultorio 4, planta baja.
    `
    expect(nombreApareceEnTexto(avisoDeLaMadre, "Roberto Gómez")).toBe(false)
  })

  it("NO da positivo si el nombre no está", () => {
    expect(nombreApareceEnTexto("Le recordamos su turno del 25/08 a las 14:30.", "Roberto Gómez")).toBe(
      false,
    )
  })

  it("NO usa un nombre de perfil de una sola palabra", () => {
    expect(nombreApareceEnTexto("Paciente: ROBERTO GOMEZ", "Roberto")).toBe(false)
  })

  it("no explota con un texto vacío", () => {
    expect(nombreApareceEnTexto("", "Roberto Gómez")).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 *  SPRINT 18 — la titularidad la decide el NOMBRE; el DNI corrobora
 *
 *  Las tres formas en que un cotejo estricto le habría negado al dueño un
 *  estudio PROPIO, reproducidas con el banco SINTÉTICO: paciente ficticia
 *  "María Luján Gregorio", instituciones inventadas de otras provincias.
 * ------------------------------------------------------------------ */

const PERFIL = "María Luján Gregorio"
const DNI_PERFIL = "28.114.902"

/** El nombre que el lector leyó en un caso del banco. */
function pacienteDelCaso(id: string): string {
  return caso(id).extraccion.paciente as string
}

describe("evaluarNombre — cómo calzó", () => {
  it("calce perfecto, en cualquier orden y con o sin tildes", () => {
    expect(evaluarNombre("GREGORIO, MARIA LUJAN", PERFIL)).toBe("exacto")
    expect(evaluarNombre("María Luján Gregorio", PERFIL)).toBe("exacto")
    expect(evaluarNombre("Paciente: Sra. GREGORIO MARIA LUJAN - DNI 28114902", PERFIL)).toBe("exacto")
  })

  it("EL CASO REAL DEL APELLIDO TRUNCADO — el laboratorio corta la etiqueta y sale GREGORI", () => {
    expect(pacienteDelCaso("14-laboratorio-apellido-truncado")).toBe("GREGORI, MARIA LUJAN")
    expect(evaluarNombre(pacienteDelCaso("14-laboratorio-apellido-truncado"), PERFIL)).toBe(
      "truncado",
    )
  })

  it("el truncamiento es solo por la DERECHA: un apodo no pasa", () => {
    expect(evaluarNombre("BETO GOMEZ", "Roberto Gómez")).toBe("no_calza")
    expect(evaluarNombre("LUJA GREGORIO", PERFIL)).toBe("no_calza") // falta "maria"
  })

  it("un truncamiento demasiado corto no alcanza: ANA no se come a ANABELLA", () => {
    expect(evaluarNombre("ANA PEREZ", "Anabella Pérez")).toBe("no_calza")
  })

  it("EL CASO REAL DEL CÓDIGO INTERNO — MDAHE15061985 no es un nombre, es un código", () => {
    expect(pacienteDelCaso("15-informe-paciente-codigo-interno")).toBe("MDAHE15061985")
    expect(pareceCodigoInterno("MDAHE15061985")).toBe(true)
    expect(evaluarNombre("MDAHE15061985", PERFIL)).toBe("codigo")
  })

  it("un nombre normal NO se confunde con un código, ni con el DNI pegado al lado", () => {
    expect(pareceCodigoInterno("GREGORIO, MARIA LUJAN")).toBe(false)
    expect(pareceCodigoInterno("GREGORIO MARIA LUJAN - DNI 28114902")).toBe(false)
    expect(pareceCodigoInterno("")).toBe(false)
  })

  it("sin nada legible: ausente", () => {
    expect(evaluarNombre("", PERFIL)).toBe("ausente")
    expect(evaluarNombre("   ...   ", PERFIL)).toBe("ausente")
  })
})

describe("evaluarDni — la señal DÉBIL", () => {
  it("compara solo los dígitos: puntos y rótulos no cuentan", () => {
    expect(evaluarDni("28114902", DNI_PERFIL)).toBe("coincide")
    expect(evaluarDni("DNI 28.114.902", DNI_PERFIL)).toBe("coincide")
  })

  it("un dígito distinto es una diferencia", () => {
    expect(evaluarDni("28174902", DNI_PERFIL)).toBe("difiere")
  })

  it("sin dato de cualquiera de los dos lados NO es una contradicción", () => {
    expect(evaluarDni("", DNI_PERFIL)).toBe("sin_dato")
    expect(evaluarDni("28114902", "")).toBe("sin_dato")
    expect(evaluarDni(undefined, undefined)).toBe("sin_dato")
  })
})

describe("evaluarTitularidad — el DNI NUNCA rechaza solo", () => {
  it("EL CASO REAL DEL DNI MAL LEÍDO — nombre correcto, DNI con un dígito cambiado: a confirmar, JAMÁS un rechazo", () => {
    // La placa de baja resolución del historial real: el lector devolvió
    // 31479089 donde el documento decía 31473089. Con el DNI decidiendo, ese
    // estudio -que era suyo- quedaba afuera.
    const resultado = evaluarTitularidad({
      nombreDetectado: pacienteDelCaso("16-radiografia-dni-mal-leido"),
      nombrePerfil: PERFIL,
      dniDetectado: "28174902",
      dniPerfil: DNI_PERFIL,
    })
    expect(resultado.nombre).toBe("exacto")
    expect(resultado.dni).toBe("difiere")
    expect(resultado.veredicto).toBe("a_confirmar")
    expect(resultado.veredicto).not.toBe("no_coincide")
  })

  it("nombre exacto y sin DNI: coincide (es el caso normal, y no cambió)", () => {
    expect(
      evaluarTitularidad({ nombreDetectado: "GREGORIO, MARIA LUJAN", nombrePerfil: PERFIL })
        .veredicto,
    ).toBe("coincide")
  })

  it("nombre exacto y DNI que corrobora: coincide", () => {
    expect(
      evaluarTitularidad({
        nombreDetectado: "GREGORIO, MARIA LUJAN",
        nombrePerfil: PERFIL,
        dniDetectado: "28114902",
        dniPerfil: DNI_PERFIL,
      }).veredicto,
    ).toBe("coincide")
  })

  it("apellido truncado y sin DNI: a confirmar (una pregunta, no una negativa)", () => {
    expect(
      evaluarTitularidad({
        nombreDetectado: pacienteDelCaso("14-laboratorio-apellido-truncado"),
        nombrePerfil: PERFIL,
      }).veredicto,
    ).toBe("a_confirmar")
  })

  it("apellido truncado PERO el DNI corrobora: coincide", () => {
    expect(
      evaluarTitularidad({
        nombreDetectado: pacienteDelCaso("14-laboratorio-apellido-truncado"),
        nombrePerfil: PERFIL,
        dniDetectado: "28.114.902",
        dniPerfil: DNI_PERFIL,
      }).veredicto,
    ).toBe("coincide")
  })

  it("UNA SOLA discrepancia no alcanza: nombre que no calza pero DNI que corrobora queda a confirmar", () => {
    expect(
      evaluarTitularidad({
        nombreDetectado: "GREGORIO MARIA",
        nombrePerfil: PERFIL,
        dniDetectado: "28114902",
        dniPerfil: DNI_PERFIL,
      }).veredicto,
    ).toBe("a_confirmar")
  })

  it("hacen falta DOS señales en contra para decir no_coincide", () => {
    const resultado = evaluarTitularidad({
      nombreDetectado: "FERREYRA, ROBERTO CARLOS",
      nombrePerfil: PERFIL,
      dniDetectado: "22907318",
      dniPerfil: DNI_PERFIL,
    })
    expect(resultado.veredicto).toBe("no_coincide")
  })

  it("el estudio de otra persona SIN ningún DNI sigue dando no_coincide (el caso de la madre)", () => {
    expect(
      evaluarTitularidad({ nombreDetectado: "GREGORIO ELENA BEATRIZ", nombrePerfil: PERFIL })
        .veredicto,
    ).toBe("no_coincide")
  })

  it("un código interno da INDETERMINADO, no una acusación", () => {
    const resultado = evaluarTitularidad({
      nombreDetectado: pacienteDelCaso("15-informe-paciente-codigo-interno"),
      nombrePerfil: PERFIL,
    })
    expect(resultado.veredicto).toBe("indeterminado")
    expect(resultado.veredicto).not.toBe("no_coincide")
  })

  it("sin nombre: indeterminado, aunque el DNI difiera", () => {
    expect(
      evaluarTitularidad({
        nombreDetectado: "",
        nombrePerfil: PERFIL,
        dniDetectado: "99999999",
        dniPerfil: DNI_PERFIL,
      }).veredicto,
    ).toBe("indeterminado")
  })

  it("un perfil de una sola palabra nunca alcanza para afirmar titularidad", () => {
    expect(
      evaluarTitularidad({ nombreDetectado: "GREGORIO MARIA LUJAN", nombrePerfil: "María" })
        .veredicto,
    ).toBe("no_coincide")
  })

  it("coincideNombreDePaciente sigue siendo el sí/no ESTRICTO: el truncamiento no le alcanza", () => {
    expect(coincideNombreDePaciente("GREGORIO, MARIA LUJAN", PERFIL)).toBe(true)
    expect(coincideNombreDePaciente("GREGORI, MARIA LUJAN", PERFIL)).toBe(false)
  })
})
