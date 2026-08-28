/**
 * Tests de `validarLoteTurnos` (`lib/validacion/turnos-lote.schema.ts`,
 * agosto 2026): la validación de FORMA del payload que manda la pantalla de
 * confirmación a `crearTurnosEnLote`.
 *
 * El payload viene de un Client Component como objeto JSON, así que este
 * schema es lo primero que lo toca — nunca se confía en que el cliente mandó
 * lo que dice mandar. Las reglas de negocio de cada turno (fecha futura,
 * largos reales, provincia del dominio cerrado) las sigue haciendo
 * `lib/validacion/turno.schema.ts`, que tiene sus propios tests.
 */

import { describe, expect, it } from "vitest"

import { MAX_TURNOS_POR_LOTE, validarLoteTurnos, type TurnoDelLote } from "@/lib/validacion/turnos-lote.schema"

function turnoDelLote(cambios: Partial<TurnoDelLote> = {}): TurnoDelLote {
  return {
    especialidad: "Kinesiología",
    medico: "Buet Daiana Edith",
    fecha: "2026-08-25",
    hora: "11:00",
    lugarNombre: "HB Central",
    lugarDireccion: "Av. Entre Ríos 2142",
    lugarCiudad: "",
    lugarProvincia: "",
    notasPreparacion: "Sesión 3/10",
    ...cambios,
  }
}

describe("validarLoteTurnos", () => {
  it("acepta un lote de diez sesiones", () => {
    const resultado = validarLoteTurnos({
      turnos: Array.from({ length: 10 }, () => turnoDelLote()),
    })

    expect(resultado.ok).toBe(true)
    if (resultado.ok) expect(resultado.turnos).toHaveLength(10)
  })

  it("acepta un lote de uno", () => {
    expect(validarLoteTurnos({ turnos: [turnoDelLote()] }).ok).toBe(true)
  })

  it("rechaza un lote vacío con un mensaje que la persona puede entender", () => {
    const resultado = validarLoteTurnos({ turnos: [] })

    expect(resultado.ok).toBe(false)
    if (!resultado.ok) expect(resultado.error).toBe("Marcá al menos un turno antes de confirmar.")
  })

  it("rechaza un lote más grande que el tope del analizador", () => {
    const resultado = validarLoteTurnos({
      turnos: Array.from({ length: MAX_TURNOS_POR_LOTE + 1 }, () => turnoDelLote()),
    })

    expect(resultado.ok).toBe(false)
    if (!resultado.ok) expect(resultado.error).toContain(String(MAX_TURNOS_POR_LOTE))
  })

  it("el tope del lote es el MISMO que el del analizador (no pueden divergir)", () => {
    expect(MAX_TURNOS_POR_LOTE).toBe(40)
  })

  it("rechaza payloads que no son un lote de turnos", () => {
    for (const basura of [null, undefined, 42, "turnos", [], {}, { turnos: 3 }, { turnos: [null] }]) {
      expect(validarLoteTurnos(basura).ok).toBe(false)
    }
  })

  it("rechaza un turno con un campo de más (nada de contrabando en el payload)", () => {
    const conExtra = { turnos: [{ ...turnoDelLote(), perfilId: "otro-perfil" }] }

    expect(validarLoteTurnos(conExtra).ok).toBe(false)
  })

  it("rechaza una clave de más en la raíz", () => {
    expect(validarLoteTurnos({ turnos: [turnoDelLote()], perfilId: "otro" }).ok).toBe(false)
  })

  it("rechaza un turno al que le falta un campo", () => {
    const sinHora: Record<string, unknown> = { ...turnoDelLote() }
    delete sinHora.hora

    expect(validarLoteTurnos({ turnos: [sinHora] }).ok).toBe(false)
  })

  it("rechaza un campo de texto desproporcionado", () => {
    const resultado = validarLoteTurnos({
      turnos: [turnoDelLote({ notasPreparacion: "x".repeat(5001) })],
    })

    expect(resultado.ok).toBe(false)
  })
})
