/**
 * Tests de `lib/validacion/medico.schema.ts` (Sprint 10, tarea 10.1; varias
 * especialidades sumadas en el Sprint 16, tarea 16.2).
 *
 *   npm run test -- medico-schema
 */

import { describe, it, expect } from "vitest"

import { MAX_ESPECIALIDADES_POR_MEDICO, MAX_LARGO_ESPECIALIDAD } from "@/lib/especialidades/catalogo"
import { validarMedico } from "@/lib/validacion/medico.schema"

function datosValidos(extra: Record<string, unknown> = {}) {
  return {
    nombre: "Dr. Carlos Rodríguez",
    especialidades: ["Cardiología"],
    matricula: "MN 45678",
    institucion: "Clínica Ushuaia",
    telefono: "+54 2901 234000",
    direccion: "Gob. Paz 150",
    ciudad: "Ushuaia",
    provincia: "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
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
      expect(resultado.datos.especialidades).toEqual(["Cardiología"])
      expect(resultado.datos.matricula).toBe("MN 45678")
      expect(resultado.datos.institucion).toBe("Clínica Ushuaia")
      expect(resultado.datos.telefono).toBe("+54 2901 234000")
      expect(resultado.datos.direccion).toBe("Gob. Paz 150")
      expect(resultado.datos.ciudad).toBe("Ushuaia")
      expect(resultado.datos.provincia).toBe("Tierra del Fuego, Antártida e Islas del Atlántico Sur")
      expect(resultado.datos.latitud).toBeUndefined()
      expect(resultado.datos.longitud).toBeUndefined()
    }
  })

  it("acepta un médico solo con el nombre (el resto es opcional)", () => {
    const resultado = validarMedico(
      datosValidos({
        especialidades: [],
        matricula: "",
        institucion: "",
        telefono: "",
        direccion: "",
        ciudad: "",
        provincia: "",
        notas: "",
      }),
    )
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.especialidades).toEqual([])
      expect(resultado.datos.matricula).toBeUndefined()
      expect(resultado.datos.institucion).toBeUndefined()
      expect(resultado.datos.telefono).toBeUndefined()
      expect(resultado.datos.direccion).toBeUndefined()
      expect(resultado.datos.ciudad).toBeUndefined()
      expect(resultado.datos.provincia).toBeUndefined()
    }
  })

  // Sprint 16, tarea 16.2: varias especialidades.
  it("acepta varias especialidades y conserva el orden (la primera queda como principal)", () => {
    const resultado = validarMedico(datosValidos({ especialidades: ["Clínica Médica", "Cardiología"] }))
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.especialidades).toEqual(["Clínica Médica", "Cardiología"])
    }
  })

  it("trimea cada especialidad", () => {
    const resultado = validarMedico(datosValidos({ especialidades: ["  Cardiología  "] }))
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.especialidades).toEqual(["Cardiología"])
    }
  })

  it("descarta especialidades en blanco", () => {
    const resultado = validarMedico(datosValidos({ especialidades: ["Cardiología", "   ", ""] }))
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.especialidades).toEqual(["Cardiología"])
    }
  })

  it("deduplica especialidades sin distinguir mayúsculas/tildes de capitalización, quedándose con la primera aparición", () => {
    const resultado = validarMedico(datosValidos({ especialidades: ["Cardiología", "cardiología", "CARDIOLOGÍA"] }))
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.especialidades).toEqual(["Cardiología"])
    }
  })

  it(`rechaza una especialidad de más de ${MAX_LARGO_ESPECIALIDAD} caracteres`, () => {
    const resultado = validarMedico(datosValidos({ especialidades: ["a".repeat(MAX_LARGO_ESPECIALIDAD + 1)] }))
    expect(resultado.ok).toBe(false)
  })

  it(`rechaza más de ${MAX_ESPECIALIDADES_POR_MEDICO} especialidades`, () => {
    const muchas = Array.from({ length: MAX_ESPECIALIDADES_POR_MEDICO + 1 }, (_, i) => `Especialidad ${i}`)
    const resultado = validarMedico(datosValidos({ especialidades: muchas }))
    expect(resultado.ok).toBe(false)
  })

  it(`acepta exactamente ${MAX_ESPECIALIDADES_POR_MEDICO} especialidades`, () => {
    const justas = Array.from({ length: MAX_ESPECIALIDADES_POR_MEDICO }, (_, i) => `Especialidad ${i}`)
    const resultado = validarMedico(datosValidos({ especialidades: justas }))
    expect(resultado.ok).toBe(true)
  })

  // Sprint 16, tarea 16.1: ciudad y provincia.
  it("acepta CABA con su nombre completo", () => {
    const resultado = validarMedico(
      datosValidos({ ciudad: "CABA", provincia: "Ciudad Autónoma de Buenos Aires" }),
    )
    expect(resultado.ok).toBe(true)
  })

  it("rechaza una provincia que no está en la lista de las 24 jurisdicciones", () => {
    const resultado = validarMedico(datosValidos({ provincia: "Ushuaia" }))
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toMatch(/provincia/i)
    }
  })

  it("rechaza una ciudad demasiado larga", () => {
    const resultado = validarMedico(datosValidos({ ciudad: "a".repeat(101) }))
    expect(resultado.ok).toBe(false)
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
