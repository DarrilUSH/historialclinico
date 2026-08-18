import { describe, expect, it } from "vitest"

import type { AnalisisMensajeTurnoExtraido, TurnoExtraidoCrudo } from "@/lib/gemini/schemas"
import { construirResultadoAnalisis, propuestaACamposPrecargables } from "@/lib/turnos/construir-propuestas"

const AHORA = new Date(2026, 7, 17) // 17/08/2026

/** Turno crudo "vacío" para no repetir los 12 campos en cada test — cada test solo pisa lo que le importa. */
function turno(cambios: Partial<TurnoExtraidoCrudo>): TurnoExtraidoCrudo {
  return {
    fechaTexto: "",
    diaSemanaTexto: "",
    horaTexto: "",
    tipoProfesional: "ninguno",
    profesionalTexto: "",
    especialidadTexto: "",
    especialidadInferida: false,
    lugarNombre: "",
    lugarDireccion: "",
    lugarCiudad: "",
    lugarProvincia: "",
    notas: [],
    ...cambios,
  }
}

describe("construirResultadoAnalisis — caso único", () => {
  it("mapea el fixture de Clínica San Jorge (respuesta de Gemini SIMULADA)", () => {
    const crudo: AnalisisMensajeTurnoExtraido = {
      relacion: "unico",
      explicacion: "Un solo turno.",
      turnos: [
        turno({
          fechaTexto: "07/10/2024",
          horaTexto: "14:15 HS",
          tipoProfesional: "persona",
          profesionalTexto: "Dr. Juárez",
          especialidadTexto: "ECOGRAFISTA",
          especialidadInferida: false,
          lugarNombre: "Anexo Dr Jorge Sagardia",
          lugarDireccion: "De la Estancia 1955",
          notas: [
            "Coseguro: $1345, sujeto a modificación. Se puede abonar con débito, crédito o efectivo.",
            "Ecografía vesical y ginecológica por vía abdominal: ir al baño y vaciar la vejiga, tomar 750cc a 1 litro de agua sin gas y retener una hora.",
            "Asistir 15 minutos antes con orden médica en mano.",
          ],
        }),
      ],
    }

    const resultado = construirResultadoAnalisis(crudo, AHORA)

    expect(resultado.relacion).toBe("unico")
    expect(resultado.otrasPropuestas).toEqual([])
    const p = resultado.propuestaPrincipal
    expect(p.fecha).toBe("2024-10-07")
    expect(p.anioInferido).toBe(false)
    expect(p.hora).toBe("14:15")
    expect(p.medico).toBe("Dr. Juárez")
    expect(p.esEstudioNoProfesional).toBe(false)
    expect(p.especialidad).toBe("Ecografía") // mapeado al catálogo
    expect(p.lugarNombre).toBe("Anexo Dr Jorge Sagardia")
    expect(p.lugarDireccion).toBe("De la Estancia 1955")
    expect(p.notasPreparacion).toContain("Coseguro")
    expect(p.notasPreparacion).toContain("Asistir 15 minutos antes")
    // Todos los datos estaban completos: no debería haber avisos de "faltó algo".
    expect(p.avisos).toEqual([])
  })

  it("detecta que 'MAMOGRAFIA MAMOGRAFIA' es un estudio, no una persona (fixture Británico)", () => {
    const crudo: AnalisisMensajeTurnoExtraido = {
      relacion: "unico",
      explicacion: "Un solo turno.",
      turnos: [
        turno({
          fechaTexto: "14/08/2026",
          horaTexto: "11:30 hrs",
          tipoProfesional: "estudio",
          profesionalTexto: "Mamografía",
          lugarNombre: "MICROCEN",
          notas: ["Presentar DNI del paciente.", "Presentar credencial de la cobertura médica."],
        }),
      ],
    }

    const resultado = construirResultadoAnalisis(crudo, AHORA)
    const p = resultado.propuestaPrincipal

    expect(p.esEstudioNoProfesional).toBe(true)
    expect(p.medico).toBe("") // NUNCA se inventa un médico
    expect(p.especialidad).toBe("Mamografía") // el estudio pasa a especialidad
    expect(p.lugarDireccion).toBe("") // sede sin dirección: no se inventa una
  })

  it("marca duda de orden para un nombre ambiguo sin comentario adicional en el aviso de especialidad (fixture Británico profesional)", () => {
    const crudo: AnalisisMensajeTurnoExtraido = {
      relacion: "unico",
      explicacion: "Un solo turno.",
      turnos: [
        turno({
          fechaTexto: "14/08/2026",
          horaTexto: "11:55 hrs",
          tipoProfesional: "persona",
          profesionalTexto: "Vidales Valeria",
          lugarNombre: "MICROCEN",
        }),
      ],
    }

    const p = construirResultadoAnalisis(crudo, AHORA).propuestaPrincipal
    expect(p.medico).toBe("Vidales Valeria")
    expect(p.dudaOrdenNombre).toBe(true)
    expect(p.avisos.some((aviso) => aviso.includes("Vidales Valeria"))).toBe(true)
  })

  it("deja la hora vacía y marca el año inferido (fixture Casa Salud, sin confirmación)", () => {
    // "Hoy" ANTES del 14/7 a propósito: infiere el mismo año (2026) sin
    // discrepancia de día de la semana (14/7/2026 es efectivamente martes,
    // verificado en el test de más abajo) — así este test se queda enfocado
    // en hora/año/especialidad inferidos, sin un efecto colateral de
    // discrepancia que no es lo que está probando.
    const antesDelCatorce = new Date(2026, 0, 15) // 15/01/2026
    const crudo: AnalisisMensajeTurnoExtraido = {
      relacion: "unico",
      explicacion: "Un solo turno.",
      turnos: [
        turno({
          fechaTexto: "14/7",
          diaSemanaTexto: "martes",
          horaTexto: "", // el mensaje NO trae hora
          tipoProfesional: "persona",
          profesionalTexto: "Dra. Rosario Diulio",
          especialidadTexto: "Ginecología",
          especialidadInferida: true,
          notas: [
            "$6.000 de insumos descartables.",
            "$20.000 de colposcopía (se hace de manera particular).",
            "Copago en EFECTIVO.",
          ],
        }),
      ],
    }

    const p = construirResultadoAnalisis(crudo, antesDelCatorce).propuestaPrincipal

    expect(p.hora).toBe("") // NUNCA se inventa la hora
    expect(p.avisos.some((a) => a.includes("no decía la hora"))).toBe(true)
    expect(p.anioInferido).toBe(true)
    expect(p.fecha).toBe("2026-07-14")
    expect(p.discrepanciaDiaSemana).toBe(false)
    expect(p.especialidadInferida).toBe(true)
    expect(p.avisos.some((a) => a.includes("es una inferencia"))).toBe(true)
    expect(p.notasPreparacion).toContain("colposcopía")
  })

  it("no genera ningún aviso de discrepancia cuando el día de la semana SÍ coincide (14/7/2026 es martes)", () => {
    // Verificación cruzada del propio fixture: si 14/7 con año inferido a 2027
    // resultara siendo la fecha equivocada, este test lo detectaría porque
    // 14/7 EN 2026 (el año que el mensaje real habría asumido si hoy fuera
    // antes del 14/7) también cae martes.
    const antesDelCatorce = new Date(2026, 5, 1) // 01/06/2026, antes del 14/7
    const crudo: AnalisisMensajeTurnoExtraido = {
      relacion: "unico",
      explicacion: "Un solo turno.",
      turnos: [turno({ fechaTexto: "14/7", diaSemanaTexto: "martes" })],
    }

    const p = construirResultadoAnalisis(crudo, antesDelCatorce).propuestaPrincipal
    expect(p.fecha).toBe("2026-07-14")
    expect(p.discrepanciaDiaSemana).toBe(false)
  })

  it("ignora una preparación explícitamente ausente ('No requiere') — no se vuelca como nota (fixture Centro Loria)", () => {
    const crudo: AnalisisMensajeTurnoExtraido = {
      relacion: "unico",
      explicacion: "Un solo turno.",
      turnos: [
        turno({
          fechaTexto: "28/04",
          horaTexto: "09:30",
          lugarNombre: "LORIA",
          notas: ["Recordá acudir con DNI, orden médica y credencial de la prepaga u obra social."],
        }),
      ],
    }

    const p = construirResultadoAnalisis(crudo, AHORA).propuestaPrincipal
    expect(p.notasPreparacion).not.toMatch(/no requiere/i)
    expect(p.notasPreparacion).toContain("DNI")
    expect(p.lugarDireccion).toBe("") // "Centro: LORIA" a secas, sin dirección
  })

  it("resuelve el sinónimo 'Práctica' como estudio y marca duda de orden del profesional (fixture TCba Salguero)", () => {
    const crudo: AnalisisMensajeTurnoExtraido = {
      relacion: "unico",
      explicacion: "Un solo turno.",
      turnos: [
        turno({
          fechaTexto: "13/11/2025",
          horaTexto: "15:21",
          lugarNombre: "TCba - Salguero",
          lugarDireccion: "Jeronimo Salguero 554/560",
          tipoProfesional: "persona",
          profesionalTexto: "Acha Agustina",
          especialidadTexto: "Punción mamaria",
          especialidadInferida: true,
          notas: ["Teléfono del centro: 4860-1000."],
        }),
      ],
    }

    const p = construirResultadoAnalisis(crudo, AHORA).propuestaPrincipal
    expect(p.fecha).toBe("2025-11-13")
    expect(p.hora).toBe("15:21")
    expect(p.medico).toBe("Acha Agustina")
    expect(p.dudaOrdenNombre).toBe(true)
    expect(p.lugarDireccion).toBe("Jeronimo Salguero 554/560")
  })

  it("cuando Gemini no encuentra ningún turno, degrada con un único aviso y campos vacíos", () => {
    const crudo: AnalisisMensajeTurnoExtraido = { relacion: "unico", explicacion: "No parece un turno.", turnos: [] }
    const resultado = construirResultadoAnalisis(crudo, AHORA)

    expect(resultado.propuestaPrincipal.fecha).toBe("")
    expect(resultado.propuestaPrincipal.avisos).toHaveLength(1)
    expect(resultado.otrasPropuestas).toEqual([])
  })
})

describe("construirResultadoAnalisis — dividir (varios_turnos)", () => {
  it("divide el par del Hospital Británico en dos propuestas independientes, sin fusionar nada", () => {
    const crudo: AnalisisMensajeTurnoExtraido = {
      relacion: "varios_turnos",
      explicacion: "Dos turnos con horarios distintos el mismo día.",
      turnos: [
        turno({
          fechaTexto: "14/08/2026",
          horaTexto: "11:30 hrs",
          tipoProfesional: "estudio",
          profesionalTexto: "Mamografía",
          lugarNombre: "MICROCEN",
        }),
        turno({
          fechaTexto: "14/08/2026",
          horaTexto: "11:55 hrs",
          tipoProfesional: "persona",
          profesionalTexto: "Vidales Valeria",
          lugarNombre: "MICROCEN",
        }),
      ],
    }

    const resultado = construirResultadoAnalisis(crudo, AHORA)

    expect(resultado.relacion).toBe("varios_turnos")
    expect(resultado.otrasPropuestas).toHaveLength(1)

    expect(resultado.propuestaPrincipal.hora).toBe("11:30")
    expect(resultado.propuestaPrincipal.esEstudioNoProfesional).toBe(true)

    expect(resultado.otrasPropuestas[0].hora).toBe("11:55")
    expect(resultado.otrasPropuestas[0].medico).toBe("Vidales Valeria")
  })
})

describe("construirResultadoAnalisis — fusionar (turno_mas_confirmacion)", () => {
  it("fusiona el par de Casa Salud: la confirmación gana en fecha/hora/profesional, el resto son notas", () => {
    const crudo: AnalisisMensajeTurnoExtraido = {
      relacion: "turno_mas_confirmacion",
      explicacion: "El segundo mensaje es una confirmación con día y hora definitivos.",
      turnos: [
        turno({
          fechaTexto: "14/7",
          diaSemanaTexto: "martes",
          horaTexto: "",
          tipoProfesional: "persona",
          profesionalTexto: "Dra. Rosario Diulio",
          especialidadTexto: "Ginecología",
          especialidadInferida: true,
          notas: ["$6.000 de insumos descartables.", "Copago en EFECTIVO."],
        }),
        turno({
          fechaTexto: "26/5",
          horaTexto: "18.10hs",
          tipoProfesional: "persona",
          profesionalTexto: "Ardans",
        }),
      ],
    }

    const resultado = construirResultadoAnalisis(crudo, AHORA)

    expect(resultado.relacion).toBe("turno_mas_confirmacion")
    expect(resultado.otrasPropuestas).toEqual([])

    const p = resultado.propuestaPrincipal
    // La confirmación gana en fecha, hora y profesional:
    expect(p.fecha).toBe("2027-05-26")
    expect(p.hora).toBe("18:10")
    expect(p.medico).toBe("Ardans")
    // La especialidad (solo en el mensaje base) se conserva:
    expect(p.especialidad).toBe("Ginecología")
    // Las notas del mensaje base se conservan:
    expect(p.notasPreparacion).toContain("insumos descartables")

    // Contradicción real: 14/7 vs 26/5 son fechas distintas.
    expect(resultado.contradiccion).not.toBeNull()
    expect(resultado.contradiccion).toContain("14/07")
    expect(resultado.contradiccion).toContain("26/05")
  })

  it("no marca contradicción cuando el mensaje base no traía fecha propia", () => {
    const crudo: AnalisisMensajeTurnoExtraido = {
      relacion: "turno_mas_confirmacion",
      explicacion: "Confirmación de datos finales.",
      turnos: [
        turno({ tipoProfesional: "persona", profesionalTexto: "Dr. Alguien", especialidadTexto: "Cardiología" }),
        turno({ fechaTexto: "26/5", horaTexto: "18:10" }),
      ],
    }

    const resultado = construirResultadoAnalisis(crudo, AHORA)
    expect(resultado.contradiccion).toBeNull()
    expect(resultado.propuestaPrincipal.fecha).toBe("2027-05-26")
  })

  it("si turnos trae menos de 2 elementos, no intenta fusionar (degrada a único)", () => {
    const crudo: AnalisisMensajeTurnoExtraido = {
      relacion: "turno_mas_confirmacion",
      explicacion: "Inconsistente: solo vino un turno.",
      turnos: [turno({ fechaTexto: "01/01/2027" })],
    }

    const resultado = construirResultadoAnalisis(crudo, AHORA)
    expect(resultado.relacion).toBe("unico")
    expect(resultado.propuestaPrincipal.fecha).toBe("2027-01-01")
  })
})

describe("propuestaACamposPrecargables", () => {
  it("recorta la propuesta a solo los campos que se vuelcan al formulario", () => {
    const crudo: AnalisisMensajeTurnoExtraido = {
      relacion: "unico",
      explicacion: "",
      turnos: [turno({ fechaTexto: "01/01/2027", especialidadTexto: "Cardiología" })],
    }
    const propuesta = construirResultadoAnalisis(crudo, AHORA).propuestaPrincipal
    const campos = propuestaACamposPrecargables(propuesta)

    expect(Object.keys(campos).sort()).toEqual(
      [
        "especialidad",
        "fecha",
        "hora",
        "lugarCiudad",
        "lugarDireccion",
        "lugarNombre",
        "lugarProvincia",
        "medico",
        "notasPreparacion",
      ].sort(),
    )
  })
})
