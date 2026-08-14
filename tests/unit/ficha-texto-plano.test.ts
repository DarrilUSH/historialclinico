/**
 * Test de `fichaATextoPlano` (`lib/ficha/texto-plano.ts`, Sprint 10, tarea
 * 10.4): el texto plano que arma "Compartir" (`navigator.share` y su
 * fallback de portapapeles) en
 * `app/(app)/(sin-nav)/ficha/pantalla-ficha.tsx`.
 */

import { describe, expect, it } from "vitest"

import { fichaATextoPlano } from "@/lib/ficha/texto-plano"
import {
  FichaGeneradaSchema,
  TITULOS_SECCION_FICHA,
  type FichaConsultaExtraida,
} from "@/lib/gemini/schemas"

/** Misma fixture que `tests/unit/ficha-schema.test.ts`. */
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

const ficha = FichaGeneradaSchema.parse(fichaValida())
const ENCABEZADO = {
  nombreCompleto: "Roberto Gómez",
  edadAnios: 68,
  fechaGeneracion: "14 de agosto de 2026",
}

describe("lib/ficha/texto-plano.ts — fichaATextoPlano", () => {
  it("incluye el nombre, la edad y la fecha de generación en el encabezado", () => {
    const texto = fichaATextoPlano(ficha, ENCABEZADO)
    expect(texto).toContain("Roberto Gómez")
    expect(texto).toContain("(68 años)")
    expect(texto).toContain("14 de agosto de 2026")
  })

  it("sin edad registrada, no inventa un número", () => {
    const texto = fichaATextoPlano(ficha, { ...ENCABEZADO, edadAnios: null })
    expect(texto).not.toMatch(/\(\d+ años\)/)
    expect(texto).toContain("Roberto Gómez")
  })

  it("incluye las seis secciones con su título en mayúsculas y su contenido completo", () => {
    const texto = fichaATextoPlano(ficha, ENCABEZADO)

    expect(texto).toContain(TITULOS_SECCION_FICHA.motivoConsulta.toUpperCase())
    expect(texto).toContain(ficha.motivoConsulta.contenido)
    expect(texto).toContain(TITULOS_SECCION_FICHA.antecedentesRelevantes.toUpperCase())
    expect(texto).toContain(ficha.antecedentesRelevantes.contenido)
    expect(texto).toContain(TITULOS_SECCION_FICHA.medicacionActual.toUpperCase())
    expect(texto).toContain(ficha.medicacionActual.contenido)
    expect(texto).toContain(TITULOS_SECCION_FICHA.estudiosRecientes.toUpperCase())
    expect(texto).toContain(ficha.estudiosRecientes.contenido)
    expect(texto).toContain(TITULOS_SECCION_FICHA.valoresFueraDeRango.toUpperCase())
    expect(texto).toContain(ficha.valoresFueraDeRango.contenido)
  })

  it("lista cada pregunta sugerida con guion, bajo su título", () => {
    const texto = fichaATextoPlano(ficha, ENCABEZADO)
    expect(texto).toContain(TITULOS_SECCION_FICHA.preguntasSugeridas.toUpperCase())
    for (const pregunta of ficha.preguntasSugeridas.preguntas) {
      expect(texto).toContain(`- ${pregunta}`)
    }
  })

  it("incluye el aviso completo bajo la etiqueta AVISO", () => {
    const texto = fichaATextoPlano(ficha, ENCABEZADO)
    expect(texto).toContain(`AVISO: ${ficha.aviso}`)
  })

  it("las secciones aparecen en el mismo orden que las pinta la hoja impresa", () => {
    const texto = fichaATextoPlano(ficha, ENCABEZADO)
    const posiciones = [
      TITULOS_SECCION_FICHA.motivoConsulta,
      TITULOS_SECCION_FICHA.antecedentesRelevantes,
      TITULOS_SECCION_FICHA.medicacionActual,
      TITULOS_SECCION_FICHA.estudiosRecientes,
      TITULOS_SECCION_FICHA.valoresFueraDeRango,
      TITULOS_SECCION_FICHA.preguntasSugeridas,
    ].map((titulo) => texto.indexOf(titulo.toUpperCase()))

    for (let i = 1; i < posiciones.length; i += 1) {
      expect(posiciones[i]).toBeGreaterThan(posiciones[i - 1])
    }
    expect(texto.indexOf("AVISO:")).toBeGreaterThan(posiciones[posiciones.length - 1])
  })
})
