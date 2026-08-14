/**
 * Tests unitarios de `lib/sos/frescura.ts` (Sprint 8, tarea 8.2).
 *
 *   npm run test -- sos-frescura
 *
 * El contrato que consumen la ficha SOS (8.3) y el indicador de última
 * sincronización (8.5): el formato exacto, y que `null` sea "nunca se
 * revisó" y no una fecha inventada.
 */

import { describe, it, expect } from "vitest"
import { formatearRevisionSos } from "@/lib/sos/frescura"

describe("lib/sos/frescura.ts", () => {
  it("formatea la revisión como DD/MM/AAAA HH:MM en hora de Ushuaia", () => {
    // 2026-08-12T17:30:00Z = 14:30 en America/Argentina/Ushuaia (UTC-3).
    expect(formatearRevisionSos("2026-08-12T17:30:00Z")).toBe("12/08/2026 14:30")
  })

  it("usa 24 horas, sin a.m./p.m.", () => {
    expect(formatearRevisionSos("2026-08-12T23:05:00Z")).toBe("12/08/2026 20:05")
  })

  it("no deja espacios invisibles ni comas entre la fecha y la hora", () => {
    const texto = formatearRevisionSos("2026-08-12T17:30:00Z")
    expect(texto).not.toMatch(/[  ,]/)
  })

  it("devuelve null cuando nunca se cargó ningún dato SOS", () => {
    expect(formatearRevisionSos(null)).toBeNull()
  })

  it("devuelve null ante un timestamp ilegible en vez de 'Invalid Date'", () => {
    expect(formatearRevisionSos("no es una fecha")).toBeNull()
  })

  it("acepta el formato timestamptz que devuelve Postgres con offset", () => {
    expect(formatearRevisionSos("2026-08-12T14:30:00-03:00")).toBe("12/08/2026 14:30")
  })
})
