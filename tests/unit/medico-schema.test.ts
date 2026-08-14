/**
 * Tests de `lib/validacion/medico.schema.ts` (Sprint 10, tarea 10.1).
 *
 *   npm run test -- medico-schema
 */

import { describe, it, expect } from "vitest"

import { validarMedico } from "@/lib/validacion/medico.schema"

function datosValidos(extra: Record<string, string> = {}) {
  return {
    nombre: "Dr. Carlos Rodríguez",
    especialidad: "Cardiología",
    matricula: "MN 45678",
    institucion: "Clínica Ushuaia",
    telefono: "+54 2901 234000",
    direccion: "Gob. Paz 150, Ushuaia",
    latitud: "",
    longitud: "",
    notas: "",
    ...extra,
  }
}

describe("lib/validacion/medico.schema.ts", () => {
  it("acepta un médico válido con todos los campos", () => {
    const resultado = validarMedico(datosValidos())
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.nombre).toBe("Dr. Carlos Rodríguez")
      expect(resultado.datos.especialidad).toBe("Cardiología")
      expect(resultado.datos.matricula).toBe("MN 45678")
      expect(resultado.datos.institucion).toBe("Clínica Ushuaia")
      expect(resultado.datos.telefono).toBe("+54 2901 234000")
      expect(resultado.datos.direccion).toBe("Gob. Paz 150, Ushuaia")
      expect(resultado.datos.latitud).toBeUndefined()
      expect(resultado.datos.longitud).toBeUndefined()
    }
  })

  it("acepta un médico solo con el nombre (el resto es opcional)", () => {
    const resultado = validarMedico(
      datosValidos({
        especialidad: "",
        matricula: "",
        institucion: "",
        telefono: "",
        direccion: "",
        notas: "",
      }),
    )
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.especialidad).toBeUndefined()
      expect(resultado.datos.matricula).toBeUndefined()
      expect(resultado.datos.institucion).toBeUndefined()
      expect(resultado.datos.telefono).toBeUndefined()
      expect(resultado.datos.direccion).toBeUndefined()
    }
  })

  it("rechaza el nombre vacío", () => {
    const resultado = validarMedico(datosValidos({ nombre: "   " }))
    expect(resultado.ok).toBe(false)
  })

  it("rechaza un nombre demasiado largo", () => {
    const resultado = validarMedico(datosValidos({ nombre: "a".repeat(201) }))
    expect(resultado.ok).toBe(false)
  })

  it("acepta coordenadas válidas cuando vienen las dos", () => {
    const resultado = validarMedico(datosValidos({ latitud: "-54.8083", longitud: "-68.3000" }))
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.latitud).toBeCloseTo(-54.8083)
      expect(resultado.datos.longitud).toBeCloseTo(-68.3)
    }
  })

  it("acepta coma decimal en las coordenadas", () => {
    const resultado = validarMedico(datosValidos({ latitud: "-54,8083", longitud: "-68,3000" }))
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.latitud).toBeCloseTo(-54.8083)
    }
  })

  it("rechaza latitud sin longitud (coordenadas incompletas)", () => {
    const resultado = validarMedico(datosValidos({ latitud: "-54.8083" }))
    expect(resultado.ok).toBe(false)
  })

  it("rechaza longitud sin latitud (coordenadas incompletas)", () => {
    const resultado = validarMedico(datosValidos({ longitud: "-68.3000" }))
    expect(resultado.ok).toBe(false)
  })

  it("rechaza una latitud fuera de rango (> 90)", () => {
    const resultado = validarMedico(datosValidos({ latitud: "95", longitud: "-68.3000" }))
    expect(resultado.ok).toBe(false)
  })

  it("rechaza una latitud fuera de rango (< -90)", () => {
    const resultado = validarMedico(datosValidos({ latitud: "-95", longitud: "-68.3000" }))
    expect(resultado.ok).toBe(false)
  })

  it("rechaza una longitud fuera de rango (> 180)", () => {
    const resultado = validarMedico(datosValidos({ latitud: "-54.8083", longitud: "185" }))
    expect(resultado.ok).toBe(false)
  })

  it("rechaza una longitud fuera de rango (< -180)", () => {
    const resultado = validarMedico(datosValidos({ latitud: "-54.8083", longitud: "-185" }))
    expect(resultado.ok).toBe(false)
  })

  it("acepta latitudes y longitudes positivas (hemisferio norte/este)", () => {
    const resultado = validarMedico(datosValidos({ latitud: "40.4168", longitud: "-3.7038" }))
    expect(resultado.ok).toBe(true)
  })

  it("rechaza una coordenada que no es un número válido", () => {
    const resultado = validarMedico(datosValidos({ latitud: "no-es-un-numero", longitud: "-68.3000" }))
    expect(resultado.ok).toBe(false)
  })

  it("acepta las dos coordenadas vacías (sin coordenadas cargadas)", () => {
    const resultado = validarMedico(datosValidos({ latitud: "", longitud: "" }))
    expect(resultado.ok).toBe(true)
  })
})
