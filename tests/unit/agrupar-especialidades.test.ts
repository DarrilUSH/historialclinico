/**
 * Tests de `lib/especialidades/agrupar.ts` (Sprint 16, tarea 16.3): el
 * agrupamiento de los médicos del perfil por especialidad que arma
 * `/especialidades`.
 */

import { describe, expect, it } from "vitest"

import { agruparPorEspecialidad, type MedicoAgrupable } from "@/lib/especialidades/agrupar"

function medico(id: string, nombre: string, especialidades: string[]): MedicoAgrupable {
  return { id, full_name: nombre, specialties: especialidades }
}

describe("agruparPorEspecialidad", () => {
  it("un médico con VARIAS especialidades aparece en todas (tarea 16.2)", () => {
    // El caso real que motivó la 16.2: la médica de cabecera del usuario es
    // clínica Y cardióloga. Esconderla bajo la primera sería contestar mal la
    // pregunta que esta pantalla hace ("¿a quién tengo para cardiología?").
    const grupos = agruparPorEspecialidad([
      medico("1", "Torres, Ana", ["Clínica Médica", "Cardiología"]),
    ])

    expect(grupos.map((grupo) => grupo.etiqueta)).toEqual(["Cardiología", "Clínica Médica"])
    expect(grupos[0].medicos[0].id).toBe("1")
    expect(grupos[1].medicos[0].id).toBe("1")
  })

  it("junta las escrituras distintas de la misma especialidad en UN grupo", () => {
    // El campo es texto libre a propósito: el catálogo sugiere, no obliga.
    const grupos = agruparPorEspecialidad([
      medico("1", "Ana", ["Cardiología"]),
      medico("2", "Beto", ["cardiologia"]),
      medico("3", "Carla", ["CARDIOLOGÍA"]),
    ])

    expect(grupos).toHaveLength(1)
    expect(grupos[0].medicos).toHaveLength(3)
    // La etiqueta es la primera forma encontrada: determinística.
    expect(grupos[0].etiqueta).toBe("Cardiología")
  })

  it("ordena los grupos alfabéticamente sin que las tildes los manden al final", () => {
    const grupos = agruparPorEspecialidad([
      medico("1", "Ana", ["Traumatología"]),
      medico("2", "Beto", ["Cardiología"]),
      medico("3", "Carla", ["Ñandú (especialidad inventada)"]),
      medico("4", "Dina", ["Oftalmología"]),
    ])

    expect(grupos.map((grupo) => grupo.etiqueta)).toEqual([
      "Cardiología",
      "Ñandú (especialidad inventada)",
      "Oftalmología",
      "Traumatología",
    ])
  })

  it("respeta el orden de llegada de los médicos dentro de cada grupo", () => {
    // La página los pide ordenados por nombre; acá no se vuelve a ordenar.
    const grupos = agruparPorEspecialidad([
      medico("1", "Álvarez", ["Clínica Médica"]),
      medico("2", "Benítez", ["Clínica Médica"]),
      medico("3", "Zapata", ["Clínica Médica"]),
    ])

    expect(grupos[0].medicos.map((m) => m.full_name)).toEqual(["Álvarez", "Benítez", "Zapata"])
  })

  it("manda el grupo 'sin especialidad cargada' SIEMPRE al final", () => {
    const grupos = agruparPorEspecialidad([
      medico("1", "Ana", []),
      medico("2", "Beto", ["Cardiología"]),
      medico("3", "Carla", ["Zoonosis"]),
    ])

    expect(grupos.map((grupo) => grupo.etiqueta)).toEqual([
      "Cardiología",
      "Zoonosis",
      "Sin especialidad cargada",
    ])
    expect(grupos[2].clave).toBe("")
  })

  it("trata como 'sin especialidad' las entradas en blanco", () => {
    const grupos = agruparPorEspecialidad([medico("1", "Ana", ["   ", ""])])

    expect(grupos).toHaveLength(1)
    expect(grupos[0].clave).toBe("")
  })

  it("no repite al mismo médico dentro de un grupo aunque cargue dos veces lo mismo", () => {
    const grupos = agruparPorEspecialidad([medico("1", "Ana", ["Cardiología", "cardiologia"])])

    expect(grupos).toHaveLength(1)
    expect(grupos[0].medicos).toHaveLength(1)
  })

  it("sin médicos devuelve una lista vacía, no un grupo vacío", () => {
    expect(agruparPorEspecialidad([])).toEqual([])
  })

  it("no muta el arreglo que recibe", () => {
    const medicos = [medico("1", "Ana", ["Cardiología"])]
    const copia = JSON.parse(JSON.stringify(medicos))

    agruparPorEspecialidad(medicos)

    expect(medicos).toEqual(copia)
  })
})
