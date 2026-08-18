/**
 * Tests de `AnalisisMensajeTurnoSchema` / `validarAnalisisMensajeTurno`
 * (`lib/validacion/analisis-turno.schema.ts`, Sprint 16, tarea 16.4).
 *
 * Cubre el criterio "la respuesta valida contra el schema Zod correspondiente"
 * (mismo patrón que `tests/unit/ficha-schema.test.ts` y
 * `tests/unit/documento-schema.test.ts`): estructura completa válida pasa,
 * cada tipo de desvío puntual (enum inválido, campo faltante, campo extra) se
 * rechaza con un mensaje que describe la estructura, nunca el contenido.
 */

import { describe, expect, it } from "vitest"

import type { AnalisisMensajeTurnoExtraido, TurnoExtraidoCrudo } from "@/lib/gemini/schemas"
import { validarAnalisisMensajeTurno } from "@/lib/validacion/analisis-turno.schema"

function turnoValido(): TurnoExtraidoCrudo {
  return {
    fechaTexto: "07/10/2024",
    diaSemanaTexto: "",
    horaTexto: "14:15 HS",
    tipoProfesional: "persona",
    profesionalTexto: "Dr. Juárez",
    especialidadTexto: "Ecografía",
    especialidadInferida: false,
    lugarNombre: "Anexo Dr Jorge Sagardia",
    lugarDireccion: "De la Estancia 1955",
    lugarCiudad: "",
    lugarProvincia: "",
    notas: ["Asistir 15 minutos antes con orden médica."],
  }
}

function analisisValido(): AnalisisMensajeTurnoExtraido {
  return { turnos: [turnoValido()], relacion: "unico", explicacion: "Un solo turno." }
}

describe("validarAnalisisMensajeTurno", () => {
  it("acepta una respuesta completa y válida", () => {
    const resultado = validarAnalisisMensajeTurno(analisisValido())
    expect(resultado.ok).toBe(true)
  })

  it("acepta turnos: [] (Gemini no encontró ningún turno reconocible)", () => {
    const resultado = validarAnalisisMensajeTurno({
      turnos: [],
      relacion: "unico",
      explicacion: "No parece un mensaje de turno.",
    })
    expect(resultado.ok).toBe(true)
  })

  it("acepta dos turnos con relacion 'turno_mas_confirmacion'", () => {
    const resultado = validarAnalisisMensajeTurno({
      turnos: [turnoValido(), turnoValido()],
      relacion: "turno_mas_confirmacion",
      explicacion: "El segundo es una confirmación.",
    })
    expect(resultado.ok).toBe(true)
  })

  it("rechaza un tipoProfesional fuera del enum", () => {
    const invalido = { ...analisisValido() }
    invalido.turnos = [{ ...turnoValido(), tipoProfesional: "medico" as never }]
    const resultado = validarAnalisisMensajeTurno(invalido)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes("tipoProfesional"))).toBe(true)
    }
  })

  it("rechaza una relacion fuera del enum", () => {
    const resultado = validarAnalisisMensajeTurno({ ...analisisValido(), relacion: "otra" })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza que falte un campo requerido de un turno", () => {
    const turnoIncompleto = { ...turnoValido() } as Partial<TurnoExtraidoCrudo>
    delete turnoIncompleto.notas
    const resultado = validarAnalisisMensajeTurno({
      turnos: [turnoIncompleto],
      relacion: "unico",
      explicacion: "x",
    })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza un campo extra no declarado en el schema (defiende la lista blanca)", () => {
    const conCampoExtra = { ...analisisValido(), dniPaciente: "12345678" }
    const resultado = validarAnalisisMensajeTurno(conCampoExtra)
    expect(resultado.ok).toBe(false)
  })

  it("rechaza especialidadInferida con un tipo que no sea booleano", () => {
    const invalido = {
      ...analisisValido(),
      turnos: [{ ...turnoValido(), especialidadInferida: "true" as never }],
    }
    const resultado = validarAnalisisMensajeTurno(invalido)
    expect(resultado.ok).toBe(false)
  })

  it("los errores describen estructura, nunca contenido — nunca incluyen el nombre del paciente ni datos del turno", () => {
    const resultado = validarAnalisisMensajeTurno({
      turnos: [{ ...turnoValido(), profesionalTexto: "PEREZ JUAN CARLOS ALBERTO — DNI 12345678" as never, tipoProfesional: "otra-cosa" as never }],
      relacion: "unico",
      explicacion: "x",
    })
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      const textoErrores = resultado.errores.join(" | ")
      expect(textoErrores).not.toContain("12345678")
      expect(textoErrores).not.toContain("PEREZ")
    }
  })
})
