/**
 * Tests de `lib/turnos/tiempo-relativo.ts` (Sprint 6, tarea 6.1).
 *
 *   npm run test -- tiempo-relativo
 *
 * Todos los casos fijan `ahora` explícitamente -la función es pura y no lee
 * `new Date()` sola- para no depender del reloj de la máquina que corre los
 * tests. Los horarios de referencia se escriben en el offset de Ushuaia
 * (`-03:00`) explícito, así el test no depende de la zona horaria del
 * proceso que ejecuta Vitest.
 */

import { describe, it, expect } from "vitest"

import { tiempoRelativo } from "@/lib/turnos/tiempo-relativo"

// "Ahora" de referencia: miércoles 12/08/2026, 09:00 hora de Ushuaia.
const AHORA = new Date("2026-08-12T09:00:00-03:00")

describe("lib/turnos/tiempo-relativo.ts", () => {
  it('un turno más tarde el mismo día da "hoy a las HH:MM"', () => {
    expect(tiempoRelativo("2026-08-12T13:30:00-03:00", AHORA)).toBe("hoy a las 13:30")
  })

  it('un turno más temprano el mismo día también es "hoy" (ya pasó, pero es del mismo calendario)', () => {
    expect(tiempoRelativo("2026-08-12T07:00:00-03:00", AHORA)).toBe("hoy a las 07:00")
  })

  it('el día calendario siguiente da "mañana", sin importar la hora exacta', () => {
    expect(tiempoRelativo("2026-08-13T09:00:00-03:00", AHORA)).toBe("mañana")
    expect(tiempoRelativo("2026-08-13T23:55:00-03:00", AHORA)).toBe("mañana")
    expect(tiempoRelativo("2026-08-13T00:05:00-03:00", AHORA)).toBe("mañana")
  })

  it('un turno dentro de 3 días da "en 3 días"', () => {
    expect(tiempoRelativo("2026-08-15T10:00:00-03:00", AHORA)).toBe("en 3 días")
  })

  it('un turno dentro de 7 días da "en 7 días"', () => {
    expect(tiempoRelativo("2026-08-19T10:00:00-03:00", AHORA)).toBe("en 7 días")
  })

  it('cruza el límite de mes correctamente hacia el futuro', () => {
    // 20 días desde el 12/08 caen el 01/09.
    expect(tiempoRelativo("2026-09-01T10:00:00-03:00", AHORA)).toBe("en 20 días")
  })

  it('el día calendario anterior da "ayer"', () => {
    expect(tiempoRelativo("2026-08-11T10:00:00-03:00", AHORA)).toBe("ayer")
  })

  it('un turno de hace 20 días da "hace 20 días" (el turno completado del seed)', () => {
    expect(tiempoRelativo("2026-07-23T09:00:00-03:00", AHORA)).toBe("hace 20 días")
  })

  it('cruza el límite de mes correctamente hacia el pasado', () => {
    // 12 días antes del 12/08 caen el 31/07.
    expect(tiempoRelativo("2026-07-31T09:00:00-03:00", AHORA)).toBe("hace 12 días")
  })

  it('el borde de "hoy": 23:59 sigue siendo hoy, no "mañana"', () => {
    expect(tiempoRelativo("2026-08-12T23:59:00-03:00", AHORA)).toBe("hoy a las 23:59")
  })

  it('20 minutos antes de medianoche hoy y 20 minutos después son días de calendario distintos ("hoy" vs "mañana"), aunque estén a 40 minutos de reloj', () => {
    const ahoraCercaDeMedianoche = new Date("2026-08-12T23:50:00-03:00")
    expect(tiempoRelativo("2026-08-12T23:55:00-03:00", ahoraCercaDeMedianoche)).toBe(
      "hoy a las 23:55",
    )
    expect(tiempoRelativo("2026-08-13T00:10:00-03:00", ahoraCercaDeMedianoche)).toBe("mañana")
  })

  it("respeta el offset de Ushuaia (UTC-3) al formatear la hora, no la hora UTC cruda", () => {
    // 13:30 UTC == 10:30 en Ushuaia.
    expect(tiempoRelativo("2026-08-12T13:30:00Z", AHORA)).toBe("hoy a las 10:30")
  })
})
