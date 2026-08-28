/**
 * Tests de `lib/documentos/intencion.ts` (Sprint 20 — "una foto, el lugar
 * correcto").
 *
 * El eje: `intencionDeExtraccion` nunca puede dejar a quien la llama sin una
 * intención con la que trabajar. Sin extracción, con el campo ausente (una
 * extracción de antes del sprint) o con un valor que no reconocemos, la
 * respuesta es SIEMPRE `"estudio_realizado"` — exactamente el comportamiento
 * que la app tenía antes de que el clasificador existiera. Ver el encabezado
 * del archivo fuente para el porqué.
 */

import { describe, expect, it } from "vitest"

import {
  INTENCIONES_DOCUMENTO,
  INTENCION_POR_DEFECTO,
  intencionDeExtraccion,
  medicamentosDeExtraccion,
  tieneDestinoPropio,
} from "@/lib/documentos/intencion"
import type { IntencionDocumentoExtraida, MedicamentoExtraido } from "@/lib/gemini/schemas"

describe("intencionDeExtraccion", () => {
  it("devuelve la intención cuando viene y es una de las conocidas", () => {
    for (const intencion of INTENCIONES_DOCUMENTO) {
      expect(intencionDeExtraccion({ intencion })).toBe(intencion)
    }
  })

  it("el campo AUSENTE (extracción de antes del Sprint 20) cae al default, no rompe", () => {
    // Documentos subidos y sin confirmar antes del deploy del sprint: su
    // `ai_extraction` ya está escrito por el contrato viejo y no trae `intencion`.
    expect(intencionDeExtraccion({})).toBe(INTENCION_POR_DEFECTO)
  })

  it("un valor desconocido (defensivo: Zod ya lo rechazaría, pero esto también lee jsonb viejo sin Zod de por medio) cae al default", () => {
    expect(intencionDeExtraccion({ intencion: "algo_que_no_existe" as IntencionDocumentoExtraida })).toBe(
      INTENCION_POR_DEFECTO,
    )
  })

  it("null y undefined como extracción entera también caen al default", () => {
    expect(intencionDeExtraccion(null)).toBe(INTENCION_POR_DEFECTO)
    expect(intencionDeExtraccion(undefined)).toBe(INTENCION_POR_DEFECTO)
  })

  it("el default es estudio_realizado, el camino de siempre que pasa por revisión humana", () => {
    expect(INTENCION_POR_DEFECTO).toBe("estudio_realizado")
  })
})

describe("medicamentosDeExtraccion", () => {
  function medicamento(cambios: Partial<MedicamentoExtraido> = {}): MedicamentoExtraido {
    return {
      nombre: "COVERAM",
      droga: "perindopril/amlodipina",
      presentacion: "5/5",
      dosis_texto: "",
      frecuencia_texto: "",
      ...cambios,
    }
  }

  it("devuelve la lista cuando viene", () => {
    const lista = [medicamento(), medicamento({ nombre: "LIPOMAX" })]
    expect(medicamentosDeExtraccion({ medicamentos: lista })).toEqual(lista)
  })

  it("ausente (extracción vieja, o documento que no es receta) da lista vacía, no undefined", () => {
    expect(medicamentosDeExtraccion({})).toEqual([])
    expect(medicamentosDeExtraccion(null)).toEqual([])
    expect(medicamentosDeExtraccion(undefined)).toEqual([])
  })
})

describe("tieneDestinoPropio", () => {
  it("receta_o_medicacion, turno_o_cita y orden_de_practica tienen destino propio", () => {
    expect(tieneDestinoPropio("receta_o_medicacion")).toBe(true)
    expect(tieneDestinoPropio("turno_o_cita")).toBe(true)
    expect(tieneDestinoPropio("orden_de_practica")).toBe(true)
  })

  it("estudio_realizado y otro NO tienen destino propio (otro se comporta como no clasificado)", () => {
    // "otro" cuenta como que no se pudo clasificar: separa "esto tiene otro
    // destino" de "esto no es un estudio", y a los fines del ruteo se
    // comporta igual que estudio_realizado.
    expect(tieneDestinoPropio("estudio_realizado")).toBe(false)
    expect(tieneDestinoPropio("otro")).toBe(false)
  })
})
