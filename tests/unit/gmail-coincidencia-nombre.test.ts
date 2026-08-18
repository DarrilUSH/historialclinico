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
  nombreApareceEnTexto,
  tokensDeNombre,
} from "@/lib/gmail/coincidencia-nombre"

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
