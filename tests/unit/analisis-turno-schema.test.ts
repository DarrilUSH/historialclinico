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
    numeroSesion: 0,
    totalSesiones: 0,
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

/* ══════════════════════════════════════════════════════════════════════════ *
 *  Series largas y número de sesión (agosto 2026)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("AnalisisMensajeTurnoSchema — series de sesiones", () => {
  /** Un análisis con `cantidad` turnos, todos válidos. */
  function analisisConTurnos(cantidad: number): AnalisisMensajeTurnoExtraido {
    return {
      relacion: "varios_turnos",
      explicacion: `${cantidad} sesiones.`,
      turnos: Array.from({ length: cantidad }, (_, indice) => ({
        ...turnoValido(),
        numeroSesion: indice + 1,
        totalSesiones: cantidad,
      })),
    }
  }

  it("acepta las DIEZ sesiones del mensaje real de kinesiología", () => {
    expect(validarAnalisisMensajeTurno(analisisConTurnos(10)).ok).toBe(true)
  })

  it("acepta una serie larga de 40 — el tope viejo de 10 habría tirado abajo el análisis entero", () => {
    expect(validarAnalisisMensajeTurno(analisisConTurnos(20)).ok).toBe(true)
    expect(validarAnalisisMensajeTurno(analisisConTurnos(40)).ok).toBe(true)
  })

  it("rechaza una cantidad de turnos absurda (red contra una respuesta corrupta)", () => {
    expect(validarAnalisisMensajeTurno(analisisConTurnos(41)).ok).toBe(false)
  })

  it("rechaza numeroSesion que no sea un entero no negativo", () => {
    for (const valor of [-1, 1.5, "3", null]) {
      const invalido = {
        ...analisisValido(),
        turnos: [{ ...turnoValido(), numeroSesion: valor as never }],
      }
      expect(validarAnalisisMensajeTurno(invalido).ok).toBe(false)
    }
  })

  it("rechaza el análisis si falta numeroSesion o totalSesiones", () => {
    for (const campo of ["numeroSesion", "totalSesiones"]) {
      const incompleto: Record<string, unknown> = { ...turnoValido() }
      delete incompleto[campo]
      expect(validarAnalisisMensajeTurno({ ...analisisValido(), turnos: [incompleto] }).ok).toBe(false)
    }
  })

  it("0/0 es válido: es como se dice 'este mensaje no numera la cita'", () => {
    const sinNumerar = {
      ...analisisValido(),
      turnos: [{ ...turnoValido(), numeroSesion: 0, totalSesiones: 0 }],
    }
    expect(validarAnalisisMensajeTurno(sinNumerar).ok).toBe(true)
  })
})
