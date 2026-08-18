import { describe, expect, it } from "vitest"

import { mapearEspecialidadCatalogo } from "@/lib/especialidades/mapear-catalogo"

describe("mapearEspecialidadCatalogo", () => {
  it("devuelve la forma canónica ante un match exacto insensible a mayúsculas/tildes", () => {
    expect(mapearEspecialidadCatalogo("cardiologia")).toBe("Cardiología")
    expect(mapearEspecialidadCatalogo("GINECOLOGIA")).toBe("Ginecología")
  })

  it("matchea 'ECOGRAFISTA' con 'Ecografía' por raíz común (fixture San Jorge)", () => {
    expect(mapearEspecialidadCatalogo("ECOGRAFISTA")).toBe("Ecografía")
  })

  it("matchea 'TRAUMATOLOGIA' con 'Traumatología y Ortopedia' (fixture Instituto Médico Platense)", () => {
    expect(mapearEspecialidadCatalogo("TRAUMATOLOGIA")).toBe("Traumatología y Ortopedia")
  })

  it("deja el texto tal cual si no matchea ninguna entrada del catálogo con confianza", () => {
    expect(mapearEspecialidadCatalogo("Mamografía")).toBe("Mamografía")
  })

  it("no confunde una especialidad con otra que solo comparte un prefijo corto", () => {
    // "Cirugía" solo (7 letras) no debería alcanzar el umbral de confianza
    // para elegir arbitrariamente una de las 6 sub-especialidades quirúrgicas.
    const resultado = mapearEspecialidadCatalogo("Cirugía")
    expect(resultado).toBe("Cirugía")
  })

  it("devuelve vacío ante texto vacío", () => {
    expect(mapearEspecialidadCatalogo("")).toBe("")
    expect(mapearEspecialidadCatalogo("   ")).toBe("")
  })
})
