/**
 * Tests de `lib/validacion/turno.schema.ts` (Sprint 6, tarea 6.1).
 *
 *   npm run test -- turno-schema
 */

import { describe, it, expect } from "vitest"

import { validarTurno } from "@/lib/validacion/turno.schema"

// "Ahora" de referencia para los casos que fijan `exigirFechaFutura`.
const AHORA = new Date("2026-08-12T09:00:00-03:00")

function datosValidos(extra: Record<string, string> = {}) {
  return {
    especialidad: "Cardiología",
    medico: "Dr. Carlos Rodríguez",
    fecha: "2026-08-20",
    hora: "10:30",
    lugarNombre: "Clínica Ushuaia",
    lugarDireccion: "Gob. Paz 150",
    lugarCiudad: "",
    lugarProvincia: "",
    latitud: "",
    longitud: "",
    notasPreparacion: "",
    ...extra,
  }
}

describe("lib/validacion/turno.schema.ts", () => {
  it("acepta un turno válido con fecha futura", () => {
    const resultado = validarTurno(datosValidos(), { exigirFechaFutura: true, ahora: AHORA })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.especialidad).toBe("Cardiología")
      expect(resultado.datos.fechaHoraIso).toBe(new Date("2026-08-20T10:30:00-03:00").toISOString())
      expect(resultado.datos.latitud).toBeUndefined()
      expect(resultado.datos.longitud).toBeUndefined()
    }
  })

  it("rechaza la especialidad vacía", () => {
    const resultado = validarTurno(datosValidos({ especialidad: "   " }), {
      exigirFechaFutura: true,
      ahora: AHORA,
    })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza fecha pasada cuando exigirFechaFutura es true (alta)", () => {
    const resultado = validarTurno(datosValidos({ fecha: "2026-08-01" }), {
      exigirFechaFutura: true,
      ahora: AHORA,
    })
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toMatch(/futuras/)
    }
  })

  it("acepta fecha pasada cuando exigirFechaFutura es false (edición)", () => {
    const resultado = validarTurno(datosValidos({ fecha: "2026-07-23", hora: "09:00" }), {
      exigirFechaFutura: false,
      ahora: AHORA,
    })
    expect(resultado.ok).toBe(true)
  })

  it("rechaza una fecha con formato inválido", () => {
    const resultado = validarTurno(datosValidos({ fecha: "20-08-2026" }), {
      exigirFechaFutura: false,
      ahora: AHORA,
    })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza una fecha que no existe en el calendario", () => {
    const resultado = validarTurno(datosValidos({ fecha: "2026-02-30" }), {
      exigirFechaFutura: false,
      ahora: AHORA,
    })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza una hora con formato inválido", () => {
    const resultado = validarTurno(datosValidos({ hora: "25:00" }), {
      exigirFechaFutura: false,
      ahora: AHORA,
    })
    expect(resultado.ok).toBe(false)
  })

  it("acepta coordenadas válidas cuando vienen las dos", () => {
    const resultado = validarTurno(
      datosValidos({ latitud: "-54.8083", longitud: "-68.3000" }),
      { exigirFechaFutura: true, ahora: AHORA },
    )
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.latitud).toBeCloseTo(-54.8083)
      expect(resultado.datos.longitud).toBeCloseTo(-68.3)
    }
  })

  it("acepta coma decimal en las coordenadas", () => {
    const resultado = validarTurno(
      datosValidos({ latitud: "-54,8083", longitud: "-68,3000" }),
      { exigirFechaFutura: true, ahora: AHORA },
    )
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.latitud).toBeCloseTo(-54.8083)
    }
  })

  it("rechaza latitud sin longitud (coordenadas incompletas)", () => {
    const resultado = validarTurno(datosValidos({ latitud: "-54.8083" }), {
      exigirFechaFutura: true,
      ahora: AHORA,
    })
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toMatch(/las dos/)
    }
  })

  it("rechaza latitud fuera de rango", () => {
    const resultado = validarTurno(
      datosValidos({ latitud: "-95", longitud: "-68.3000" }),
      { exigirFechaFutura: true, ahora: AHORA },
    )
    expect(resultado.ok).toBe(false)
  })

  it("rechaza longitud fuera de rango", () => {
    const resultado = validarTurno(
      datosValidos({ latitud: "-54.8083", longitud: "-200" }),
      { exigirFechaFutura: true, ahora: AHORA },
    )
    expect(resultado.ok).toBe(false)
  })

  it("médico, lugar y notas son opcionales", () => {
    const resultado = validarTurno(
      datosValidos({ medico: "", lugarNombre: "", lugarDireccion: "", notasPreparacion: "" }),
      { exigirFechaFutura: true, ahora: AHORA },
    )
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.medico).toBeUndefined()
      expect(resultado.datos.lugarNombre).toBeUndefined()
    }
  })

  it("rechaza una especialidad demasiado larga", () => {
    const resultado = validarTurno(datosValidos({ especialidad: "a".repeat(101) }), {
      exigirFechaFutura: false,
      ahora: AHORA,
    })
    expect(resultado.ok).toBe(false)
  })

  // Sprint 16, tarea 16.1: ciudad y provincia.
  it("acepta ciudad y provincia válidas", () => {
    const resultado = validarTurno(
      datosValidos({ lugarCiudad: "La Plata", lugarProvincia: "Buenos Aires" }),
      { exigirFechaFutura: true, ahora: AHORA },
    )
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.lugarCiudad).toBe("La Plata")
      expect(resultado.datos.lugarProvincia).toBe("Buenos Aires")
    }
  })

  it("ciudad y provincia son opcionales", () => {
    const resultado = validarTurno(datosValidos({ lugarCiudad: "", lugarProvincia: "" }), {
      exigirFechaFutura: true,
      ahora: AHORA,
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.lugarCiudad).toBeUndefined()
      expect(resultado.datos.lugarProvincia).toBeUndefined()
    }
  })

  it("acepta CABA con su nombre completo", () => {
    const resultado = validarTurno(
      datosValidos({ lugarCiudad: "CABA", lugarProvincia: "Ciudad Autónoma de Buenos Aires" }),
      { exigirFechaFutura: true, ahora: AHORA },
    )
    expect(resultado.ok).toBe(true)
  })

  it("rechaza una provincia que no está en la lista de las 24 jurisdicciones", () => {
    const resultado = validarTurno(datosValidos({ lugarProvincia: "Ushuaia" }), {
      exigirFechaFutura: true,
      ahora: AHORA,
    })
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toMatch(/provincia/i)
    }
  })

  it("rechaza una ciudad demasiado larga", () => {
    const resultado = validarTurno(datosValidos({ lugarCiudad: "a".repeat(101) }), {
      exigirFechaFutura: true,
      ahora: AHORA,
    })
    expect(resultado.ok).toBe(false)
  })
})
