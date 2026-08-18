/**
 * Tests de `lib/turnos/autocompletar-medico.ts` (Sprint 10, tarea 10.1;
 * ciudad/provincia sumadas en el Sprint 16, tarea 16.1).
 *
 *   npm run test -- autocompletar-medico
 */

import { describe, it, expect } from "vitest"

import {
  camposAutocompletadosDesdeMedico,
  type CamposAutocompletablesTurno,
  type MedicoParaAutocompletar,
} from "@/lib/turnos/autocompletar-medico"

const DOCTOR: MedicoParaAutocompletar = {
  id: "990e8400-e29b-41d4-a716-446655440001",
  full_name: "Dr. Carlos Rodríguez",
  specialty: "Cardiología",
  institution: "Clínica Ushuaia",
  address: "Gob. Paz 150",
  city: "Ushuaia",
  province: "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
  latitude: -54.8083,
  longitude: -68.3,
}

function camposVacios(extra: Partial<CamposAutocompletablesTurno> = {}): CamposAutocompletablesTurno {
  return {
    medico: "",
    especialidad: "",
    lugarNombre: "",
    lugarDireccion: "",
    lugarCiudad: "",
    lugarProvincia: "",
    latitud: "",
    longitud: "",
    ...extra,
  }
}

describe("lib/turnos/autocompletar-medico.ts", () => {
  it("completa todos los campos cuando están todos vacíos", () => {
    const cambios = camposAutocompletadosDesdeMedico(DOCTOR, camposVacios())

    expect(cambios).toEqual({
      medico: "Dr. Carlos Rodríguez",
      especialidad: "Cardiología",
      lugarNombre: "Clínica Ushuaia",
      lugarDireccion: "Gob. Paz 150",
      lugarCiudad: "Ushuaia",
      lugarProvincia: "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
      latitud: "-54.8083",
      longitud: "-68.3",
    })
  })

  it("no pisa el nombre del médico si ya está escrito", () => {
    const cambios = camposAutocompletadosDesdeMedico(
      DOCTOR,
      camposVacios({ medico: "Dr. Rodríguez (reemplazo esta semana)" }),
    )

    expect(cambios.medico).toBeUndefined()
  })

  it("no pisa la especialidad si ya está escrita", () => {
    const cambios = camposAutocompletadosDesdeMedico(DOCTOR, camposVacios({ especialidad: "Clínica médica" }))

    expect(cambios.especialidad).toBeUndefined()
  })

  it("no completa la especialidad si el médico no la tiene cargada", () => {
    const doctorSinEspecialidad: MedicoParaAutocompletar = { ...DOCTOR, specialty: null }
    const cambios = camposAutocompletadosDesdeMedico(doctorSinEspecialidad, camposVacios())

    expect(cambios.especialidad).toBeUndefined()
  })

  it("no pisa el lugar si ya está escrito", () => {
    const cambios = camposAutocompletadosDesdeMedico(DOCTOR, camposVacios({ lugarNombre: "Hospital Regional" }))

    expect(cambios.lugarNombre).toBeUndefined()
  })

  it("no pisa la dirección si ya está escrita", () => {
    const cambios = camposAutocompletadosDesdeMedico(
      DOCTOR,
      camposVacios({ lugarDireccion: "Otra calle 123" }),
    )

    expect(cambios.lugarDireccion).toBeUndefined()
  })

  it("no pisa la ciudad si ya está escrita", () => {
    const cambios = camposAutocompletadosDesdeMedico(DOCTOR, camposVacios({ lugarCiudad: "La Plata" }))

    expect(cambios.lugarCiudad).toBeUndefined()
  })

  it("no completa la ciudad si el médico no la tiene cargada", () => {
    const doctorSinCiudad: MedicoParaAutocompletar = { ...DOCTOR, city: null }
    const cambios = camposAutocompletadosDesdeMedico(doctorSinCiudad, camposVacios())

    expect(cambios.lugarCiudad).toBeUndefined()
  })

  it("no pisa la provincia si ya está escrita", () => {
    const cambios = camposAutocompletadosDesdeMedico(DOCTOR, camposVacios({ lugarProvincia: "Buenos Aires" }))

    expect(cambios.lugarProvincia).toBeUndefined()
  })

  it("no completa la provincia si el médico no la tiene cargada", () => {
    const doctorSinProvincia: MedicoParaAutocompletar = { ...DOCTOR, province: null }
    const cambios = camposAutocompletadosDesdeMedico(doctorSinProvincia, camposVacios())

    expect(cambios.lugarProvincia).toBeUndefined()
  })

  it("completa latitud y longitud juntas cuando las dos están vacías", () => {
    const cambios = camposAutocompletadosDesdeMedico(DOCTOR, camposVacios())

    expect(cambios.latitud).toBe("-54.8083")
    expect(cambios.longitud).toBe("-68.3")
  })

  it("no toca ninguna coordenada si ya hay una latitud cargada", () => {
    const cambios = camposAutocompletadosDesdeMedico(DOCTOR, camposVacios({ latitud: "-10" }))

    expect(cambios.latitud).toBeUndefined()
    expect(cambios.longitud).toBeUndefined()
  })

  it("no toca ninguna coordenada si ya hay una longitud cargada", () => {
    const cambios = camposAutocompletadosDesdeMedico(DOCTOR, camposVacios({ longitud: "-10" }))

    expect(cambios.latitud).toBeUndefined()
    expect(cambios.longitud).toBeUndefined()
  })

  it("no completa coordenadas si el médico no las tiene cargadas", () => {
    const doctorSinCoords: MedicoParaAutocompletar = { ...DOCTOR, latitude: null, longitude: null }
    const cambios = camposAutocompletadosDesdeMedico(doctorSinCoords, camposVacios())

    expect(cambios.latitud).toBeUndefined()
    expect(cambios.longitud).toBeUndefined()
  })

  it("un médico sin institución, dirección, ciudad ni provincia no completa esos campos", () => {
    const doctorMinimo: MedicoParaAutocompletar = {
      id: DOCTOR.id,
      full_name: "Dra. Marcela Torres",
      specialty: null,
      institution: null,
      address: null,
      city: null,
      province: null,
      latitude: null,
      longitude: null,
    }

    const cambios = camposAutocompletadosDesdeMedico(doctorMinimo, camposVacios())

    expect(cambios).toEqual({ medico: "Dra. Marcela Torres" })
  })

  it("un campo con solo espacios cuenta como vacío", () => {
    const cambios = camposAutocompletadosDesdeMedico(DOCTOR, camposVacios({ medico: "   " }))

    expect(cambios.medico).toBe("Dr. Carlos Rodríguez")
  })

  it("no devuelve ningún cambio si todos los campos ya están completos", () => {
    const cambios = camposAutocompletadosDesdeMedico(
      DOCTOR,
      camposVacios({
        medico: "Otro nombre",
        especialidad: "Otra especialidad",
        lugarNombre: "Otro lugar",
        lugarDireccion: "Otra dirección",
        lugarCiudad: "Otra ciudad",
        lugarProvincia: "Buenos Aires",
        latitud: "1",
        longitud: "2",
      }),
    )

    expect(cambios).toEqual({})
  })
})
