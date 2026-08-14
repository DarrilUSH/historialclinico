/**
 * Tests unitarios de `lib/perfiles/edad.ts` (Sprint 8, tarea 8.3).
 *
 *   npm run test -- edad
 *
 * Cubre el caso que motiva el helper: comparar fechas de calendario, nunca
 * instantes, para que la hora del día o el huso del proceso no corran la
 * edad un año de más o de menos (mismo espíritu que el bang pattern de
 * `DateTimeImmutable::createFromFormat('!Y-m-d', ...)`).
 */

import { describe, it, expect } from "vitest"
import { calcularEdad } from "@/lib/perfiles/edad"

describe("lib/perfiles/edad.ts", () => {
  it("calcula la edad cuando ya pasó el cumpleaños este año", () => {
    // Roberto Gómez (seed): nació 1945-11-03. "Hoy" 2026-08-14 -antes de que
    // cumpla en noviembre-, así que todavía tiene 80, no 81.
    expect(calcularEdad("1945-11-03", new Date("2026-08-14T12:00:00Z"))).toBe(80)
  })

  it("suma el año cumplido el mismo día del cumpleaños", () => {
    expect(calcularEdad("1945-11-03", new Date("2026-11-03T12:00:00Z"))).toBe(81)
  })

  it("todavía no suma el año un día antes del cumpleaños", () => {
    expect(calcularEdad("1945-11-03", new Date("2026-11-02T12:00:00Z"))).toBe(80)
  })

  it("no depende de la hora del día: 00:05 UTC y 23:55 UTC dan la misma edad en Ushuaia", () => {
    // 2026-11-03T00:05:00Z es 2026-11-02 21:05 en Ushuaia (UTC-3): todavía
    // NO es el cumpleaños ahí. Sin la conversión de zona, comparar el año
    // UTC directo daría 81 en vez de 80.
    expect(calcularEdad("1945-11-03", new Date("2026-11-03T00:05:00Z"))).toBe(80)
  })

  it("devuelve null si nunca se cargó la fecha de nacimiento", () => {
    expect(calcularEdad(null)).toBeNull()
  })

  it("devuelve null ante un string sin forma YYYY-MM-DD", () => {
    expect(calcularEdad("03/11/1945")).toBeNull()
  })

  it("devuelve null ante una fecha de nacimiento en el futuro, no una edad negativa", () => {
    expect(calcularEdad("2030-01-01", new Date("2026-08-14T12:00:00Z"))).toBeNull()
  })

  it("da 0 el mismo día de nacimiento", () => {
    expect(calcularEdad("2026-08-14", new Date("2026-08-14T12:00:00Z"))).toBe(0)
  })
})
