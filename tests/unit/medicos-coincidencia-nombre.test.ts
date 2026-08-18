/**
 * Test del cotejo tolerante de nombres de médico
 * (`lib/medicos/coincidencia-nombre.ts`) — cruces inteligentes, agosto 2026.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import { medicoParecidoEnDirectorio, tokensDeNombreMedico } from "@/lib/medicos/coincidencia-nombre"

describe("tokensDeNombreMedico", () => {
  it("descarta el tratamiento médico", () => {
    expect(tokensDeNombreMedico("Dr. Carlos Rodríguez")).toEqual(["carlos", "rodriguez"])
    expect(tokensDeNombreMedico("Dra. Marcela Torres")).toEqual(["marcela", "torres"])
  })

  it("plancha tildes y mayúsculas", () => {
    expect(tokensDeNombreMedico("JUAREZ")).toEqual(["juarez"])
    expect(tokensDeNombreMedico("Juárez")).toEqual(["juarez"])
  })

  it("descarta partículas de apellido compuesto", () => {
    expect(tokensDeNombreMedico("Dr. Juan de la Cruz")).toEqual(["juan", "cruz"])
  })

  it("un solo apellido sigue siendo un token válido (mensajes reales solo lo traen)", () => {
    expect(tokensDeNombreMedico("Ardans")).toEqual(["ardans"])
    expect(tokensDeNombreMedico("Dr. Juárez")).toEqual(["juarez"])
  })

  it("no explota con basura", () => {
    expect(tokensDeNombreMedico("")).toEqual([])
    expect(tokensDeNombreMedico("   ")).toEqual([])
    expect(tokensDeNombreMedico("Dr.")).toEqual([])
  })
})

describe("medicoParecidoEnDirectorio", () => {
  const directorio = [
    { id: "1", full_name: "Dr. Carlos Rodríguez" },
    { id: "2", full_name: "Dra. Marcela Torres" },
  ]

  it("reconoce un apellido pelado contra un nombre completo del directorio", () => {
    // Caso real del fixture San Jorge: "SERV. DE ECOGRAFIA - DR. JUAREZ" se
    // normaliza a "Dr. Juárez" — sin nadie parecido en este directorio.
    expect(medicoParecidoEnDirectorio("Dr. Juárez", directorio)).toBeNull()
    expect(medicoParecidoEnDirectorio("Dr. Rodríguez", directorio)?.id).toBe("1")
  })

  it("reconoce el nombre completo aunque el directorio tenga un nombre de más", () => {
    const conNombreLargo = [{ id: "9", full_name: "Dra. Valeria Andrea Vidales" }]
    expect(medicoParecidoEnDirectorio("VIDALES VALERIA", conNombreLargo)?.id).toBe("9")
  })

  it("reconoce el mismo médico con y sin tratamiento, en cualquier orden", () => {
    expect(medicoParecidoEnDirectorio("TORRES MARCELA", directorio)?.id).toBe("2")
    expect(medicoParecidoEnDirectorio("Marcela Torres", directorio)?.id).toBe("2")
  })

  it("devuelve null cuando no hay ningún token en común", () => {
    expect(medicoParecidoEnDirectorio("Dra. Valeria Vidales", directorio)).toBeNull()
  })

  it("devuelve null con nombre extraído vacío o sin tokens significativos", () => {
    expect(medicoParecidoEnDirectorio("", directorio)).toBeNull()
    expect(medicoParecidoEnDirectorio("Dr.", directorio)).toBeNull()
  })

  it("con directorio vacío siempre es null (nada que vincular: corresponde 'Agregar')", () => {
    expect(medicoParecidoEnDirectorio("Dr. Juárez", [])).toBeNull()
  })

  it("con dos candidatos que comparten un apellido, gana la coincidencia más cerrada", () => {
    const conHomonimos = [
      { id: "a", full_name: "Dr. Juan Pérez" },
      { id: "b", full_name: "Dr. Juan Carlos Pérez" },
    ]
    // "Juan Carlos Pérez" comparte los TRES tokens con el candidato "b" (3
    // en común) y solo dos con "a" — gana "b".
    expect(medicoParecidoEnDirectorio("Juan Carlos Pérez", conHomonimos)?.id).toBe("b")
  })

  it("en empate exacto, gana el primero del directorio (orden estable)", () => {
    const empatados = [
      { id: "primero", full_name: "Dr. Ardans" },
      { id: "segundo", full_name: "Dr. Ardans" },
    ]
    expect(medicoParecidoEnDirectorio("Ardans", empatados)?.id).toBe("primero")
  })
})
