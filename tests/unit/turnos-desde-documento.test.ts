/**
 * Tests de `lib/turnos/desde-documento.ts` (Sprint 20 — "una foto, el lugar
 * correcto").
 *
 * `precargaDesdeOrden` traduce una ORDEN médica (`orden_de_practica`) a lo
 * que puede recibir el formulario de turno nuevo. El punto central: una orden
 * NO dice cuándo, y quien la FIRMA no es quien va a ATENDER el turno — por
 * eso el objeto devuelto no puede tener `fecha`, `hora` ni `medico`, algo que
 * el propio tipo `PrecargaTurnoDesdeOrden` ya impide a nivel de tipos, pero
 * que acá se verifica también en runtime sobre el objeto real.
 *
 * `textoParaAnalizador` arma el texto que recibe el analizador de mensajes de
 * turno ya existente (Sprint 16): tiene que preservar `texto_completo`
 * entero, porque ahí viven los N turnos de una captura múltiple.
 */

import { describe, expect, it } from "vitest"

import { precargaDesdeOrden, textoParaAnalizador } from "@/lib/turnos/desde-documento"
import type { DocumentoMedicoExtraido } from "@/lib/gemini/schemas"

function extraccion(cambios: Partial<DocumentoMedicoExtraido> = {}): DocumentoMedicoExtraido {
  return {
    titulo: "Radiografía de tórax",
    fecha: "2026-08-20",
    especialidad: "Traumatología",
    institucion: "Hospital Británico",
    medico: "Dr. Rozanec",
    resumen: "Pedido de radiografía de tórax por control post operatorio.",
    categoria: "other",
    metricas: [],
    ...cambios,
  }
}

describe("precargaDesdeOrden", () => {
  it("pone la especialidad en su propio campo", () => {
    const precarga = precargaDesdeOrden(extraccion({ especialidad: "Traumatología" }))
    expect(precarga.especialidad).toBe("Traumatología")
  })

  it("el título, el médico solicitante, la fecha de emisión y la institución van a notasPreparacion", () => {
    const precarga = precargaDesdeOrden(extraccion())
    expect(precarga.notasPreparacion).toContain("Práctica: Radiografía de tórax")
    expect(precarga.notasPreparacion).toContain("La pidió: Dr. Rozanec")
    expect(precarga.notasPreparacion).toContain("Emitida el: 2026-08-20")
    expect(precarga.notasPreparacion).toContain("Institución: Hospital Británico")
  })

  it("el objeto devuelto NO tiene fecha, hora ni medico — una orden no dice cuándo, y quien firma no es quien atiende", () => {
    const precarga = precargaDesdeOrden(extraccion())
    expect(precarga).not.toHaveProperty("fecha")
    expect(precarga).not.toHaveProperty("hora")
    expect(precarga).not.toHaveProperty("medico")
    // El objeto tiene exactamente estos dos campos, nada más.
    expect(Object.keys(precarga).sort()).toEqual(["especialidad", "notasPreparacion"])
  })

  it("campos vacíos o ausentes en la extracción no dejan líneas colgando en notasPreparacion", () => {
    const precarga = precargaDesdeOrden(
      extraccion({ titulo: undefined, medico: "", fecha: null, institucion: "" }),
    )
    expect(precarga.notasPreparacion).toBe("Pedido de estudio que fotografiaste.")
  })
})

describe("textoParaAnalizador", () => {
  it("incluye texto_completo entero: ahí viven los turnos de una captura múltiple", () => {
    const textoCompleto =
      "Turno 1: Dra. Pérez, Cardiología, 10/09/2026 09:00\nTurno 2: Dr. Gómez, Clínica Médica, 10/09/2026 10:30"
    const texto = textoParaAnalizador(extraccion({ texto_completo: textoCompleto }))
    expect(texto).toContain(textoCompleto)
  })

  it("tolera campos vacíos sin dejar líneas colgando", () => {
    const texto = textoParaAnalizador(
      extraccion({
        institucion: "",
        medico: "",
        especialidad: "",
        fecha: null,
        texto_completo: undefined,
        resumen: "Turno confirmado.",
      }),
    )
    expect(texto).toBe("Turno confirmado.")
    expect(texto).not.toContain("Institución:")
    expect(texto).not.toContain("Profesional:")
    expect(texto).not.toContain("Especialidad:")
    expect(texto).not.toContain("Fecha:")
  })

  it("con todos los campos, cada línea trae su etiqueta y el resumen cierra el texto", () => {
    const texto = textoParaAnalizador(extraccion({ texto_completo: "captura literal de la foto" }))
    expect(texto.split("\n")).toEqual([
      "Institución: Hospital Británico",
      "Profesional: Dr. Rozanec",
      "Especialidad: Traumatología",
      "Fecha: 2026-08-20",
      "captura literal de la foto",
      "Pedido de radiografía de tórax por control post operatorio.",
    ])
  })
})
