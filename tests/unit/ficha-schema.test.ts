/**
 * Tests de `FichaGeneradaSchema` / `validarFichaGenerada`
 * (`lib/gemini/schemas.ts`, Sprint 10, tarea 10.3).
 *
 * Cubre el criterio de aceptación del roadmap tal cual está escrito
 * (ROADMAP_SPRINTS.md, líneas 634-640): "la respuesta valida contra el
 * schema Zod correspondiente" (estructura completa válida) y "el aviso de
 * 'resumen asistido por IA, no sustituye criterio médico' aparece en la
 * salida" (sin aviso, o con un aviso que no menciona el descargo, es
 * inválido). También cubre secciones faltantes/con título alterado, porque
 * son la otra mitad de "secciones equivalentes en estructura" entre dos
 * generaciones.
 */

import { describe, expect, it } from "vitest"

import {
  FichaGeneradaSchema,
  TITULOS_SECCION_FICHA,
  validarFichaGenerada,
  type FichaConsultaExtraida,
} from "@/lib/gemini/schemas"

/** Ficha completa y válida: base para mutar en cada test de rechazo. */
function fichaValida(): FichaConsultaExtraida {
  return {
    motivoConsulta: {
      titulo: TITULOS_SECCION_FICHA.motivoConsulta,
      contenido: "Consulta de control, sin motivo urgente detectado en los datos cargados.",
    },
    antecedentesRelevantes: {
      titulo: TITULOS_SECCION_FICHA.antecedentesRelevantes,
      contenido: "- Hipertensión\n- Alergia a la penicilina",
    },
    medicacionActual: {
      titulo: TITULOS_SECCION_FICHA.medicacionActual,
      contenido: "- Metformina 850 mg, 1 comprimido cada 12 horas",
    },
    estudiosRecientes: {
      titulo: TITULOS_SECCION_FICHA.estudiosRecientes,
      contenido: "- 10/08/2026, Laboratorio: glucemia dentro de lo esperado",
    },
    valoresFueraDeRango: {
      titulo: TITULOS_SECCION_FICHA.valoresFueraDeRango,
      contenido: "Sin valores fuera de rango en los últimos registros.",
    },
    preguntasSugeridas: {
      titulo: TITULOS_SECCION_FICHA.preguntasSugeridas,
      preguntas: [
        "¿Conviene ajustar el horario de la Metformina?",
        "¿Hace falta repetir el laboratorio antes de la próxima consulta?",
        "¿La presión registrada en casa está dentro de lo esperado?",
      ],
    },
    aviso:
      "Este resumen fue generado con inteligencia artificial a partir de tus datos cargados en " +
      "la aplicación: no sustituye el criterio médico ni reemplaza una evaluación profesional.",
  }
}

describe("lib/gemini/schemas.ts — FichaGeneradaSchema / validarFichaGenerada", () => {
  it("acepta una ficha con la estructura completa válida", () => {
    const resultado = validarFichaGenerada(fichaValida())
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.motivoConsulta.titulo).toBe(TITULOS_SECCION_FICHA.motivoConsulta)
      expect(resultado.datos.preguntasSugeridas.preguntas).toHaveLength(3)
    }
  })

  it("acepta el máximo de 5 preguntas sugeridas", () => {
    const ficha = fichaValida()
    ficha.preguntasSugeridas.preguntas = [
      "¿Pregunta 1?",
      "¿Pregunta 2?",
      "¿Pregunta 3?",
      "¿Pregunta 4?",
      "¿Pregunta 5?",
    ]
    expect(validarFichaGenerada(ficha).ok).toBe(true)
  })

  describe("el aviso — criterio de aceptación del roadmap", () => {
    it("rechaza una ficha SIN el campo aviso", () => {
      const ficha = fichaValida() as unknown as Record<string, unknown>
      delete ficha.aviso

      const resultado = validarFichaGenerada(ficha)
      expect(resultado.ok).toBe(false)
      if (!resultado.ok) {
        expect(resultado.errores.some((e) => e.includes("aviso"))).toBe(true)
      }
    })

    it("rechaza un aviso vacío", () => {
      const ficha = fichaValida()
      ficha.aviso = ""
      expect(validarFichaGenerada(ficha).ok).toBe(false)
    })

    it("rechaza un aviso que NO menciona el descargo exigido", () => {
      const ficha = fichaValida()
      ficha.aviso = "Este resumen fue generado con inteligencia artificial."
      const resultado = validarFichaGenerada(ficha)
      expect(resultado.ok).toBe(false)
      if (!resultado.ok) {
        expect(resultado.errores.some((e) => e.toLowerCase().includes("criterio médico"))).toBe(true)
      }
    })

    it('acepta un aviso con la frase "no reemplaza el criterio médico" en vez de "no sustituye"', () => {
      const ficha = fichaValida()
      ficha.aviso =
        "Resumen generado con IA a partir de tus datos: no reemplaza el criterio médico de un profesional."
      expect(validarFichaGenerada(ficha).ok).toBe(true)
    })

    it("acepta la frase del descargo sin tildes (Gemini a veces las omite)", () => {
      const ficha = fichaValida()
      ficha.aviso = "Resumen generado con IA: no reemplaza el criterio medico de un profesional."
      expect(validarFichaGenerada(ficha).ok).toBe(true)
    })
  })

  describe("secciones faltantes o con título alterado", () => {
    it("rechaza una ficha sin la sección de medicación actual", () => {
      const ficha = fichaValida() as unknown as Record<string, unknown>
      delete ficha.medicacionActual
      expect(validarFichaGenerada(ficha).ok).toBe(false)
    })

    it("rechaza una ficha sin la sección de preguntas sugeridas", () => {
      const ficha = fichaValida() as unknown as Record<string, unknown>
      delete ficha.preguntasSugeridas
      expect(validarFichaGenerada(ficha).ok).toBe(false)
    })

    it("rechaza un título de sección que no coincide EXACTAMENTE con el fijo", () => {
      const ficha = fichaValida()
      ficha.antecedentesRelevantes.titulo = "Antecedentes"
      expect(validarFichaGenerada(ficha).ok).toBe(false)
    })

    it("rechaza contenido vacío en una sección", () => {
      const ficha = fichaValida()
      ficha.estudiosRecientes.contenido = "   "
      expect(validarFichaGenerada(ficha).ok).toBe(false)
    })
  })

  describe("preguntas sugeridas — cantidad", () => {
    it("rechaza menos de 3 preguntas", () => {
      const ficha = fichaValida()
      ficha.preguntasSugeridas.preguntas = ["¿Una sola pregunta?", "¿Otra más?"]
      expect(validarFichaGenerada(ficha).ok).toBe(false)
    })

    it("rechaza más de 5 preguntas", () => {
      const ficha = fichaValida()
      ficha.preguntasSugeridas.preguntas = [
        "¿1?",
        "¿2?",
        "¿3?",
        "¿4?",
        "¿5?",
        "¿6?",
      ]
      expect(validarFichaGenerada(ficha).ok).toBe(false)
    })
  })

  it("rechaza propiedades extra no declaradas en el schema (.strict())", () => {
    const ficha = fichaValida() as FichaConsultaExtraida & { extra?: string }
    ficha.extra = "esto no debería estar acá"
    expect(validarFichaGenerada(ficha).ok).toBe(false)
  })

  it("FichaGeneradaSchema.safeParse acepta la misma ficha válida directamente", () => {
    expect(FichaGeneradaSchema.safeParse(fichaValida()).success).toBe(true)
  })
})
