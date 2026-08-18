/**
 * Tests de `lib/lugares/normalizar.ts` (Sprint 16, tarea 16.3): la
 * normalización que se usa en LAS DOS puntas de la búsqueda -al ingerir el
 * catálogo y al buscar- y la traducción de las jurisdicciones del REFES a los
 * 24 nombres canónicos de `lib/ubicacion/provincias.ts`.
 */

import { describe, expect, it } from "vitest"

import { normalizarBusqueda, provinciaCanonica } from "@/lib/lugares/normalizar"
import { PROVINCIAS_ARGENTINAS } from "@/lib/ubicacion/provincias"

describe("normalizarBusqueda", () => {
  it("pasa a minúsculas y saca las tildes", () => {
    expect(normalizarBusqueda("CÓRDOBA")).toBe("cordoba")
    expect(normalizarBusqueda("ENTRE RÍOS")).toBe("entre rios")
    expect(normalizarBusqueda("GUAYMALLÉN")).toBe("guaymallen")
    expect(normalizarBusqueda("Diagnóstico por Imágenes")).toBe("diagnostico por imagenes")
  })

  it("CONSERVA la ñ: en castellano no es una n con acento", () => {
    // "cañada" y "canada" no son la misma palabra, y el REFES está lleno de
    // topónimos con ñ (LOS ÑIRES, PEÑA). Quien teclea "ñires" espera
    // encontrarlos y quien teclea "nires" no debería.
    expect(normalizarBusqueda("LOS ÑIRES")).toBe("los ñires")
    expect(normalizarBusqueda("Cañada de Gómez")).toBe("cañada de gomez")
    expect(normalizarBusqueda("PEÑALOZA")).toBe("peñaloza")
  })

  it("colapsa los espacios repetidos y recorta los de los bordes", () => {
    // El REFES trae nombres con doble espacio: "CENTRO MEDICO  TCBA SALGUERO".
    expect(normalizarBusqueda("  CENTRO MEDICO  TCBA   SALGUERO ")).toBe(
      "centro medico tcba salguero",
    )
  })

  it("es idempotente: normalizar dos veces da lo mismo", () => {
    const una = normalizarBusqueda("HOSPITAL BRITÁNICO  DE BUENOS AIRES")
    expect(normalizarBusqueda(una)).toBe(una)
  })

  it("una cadena vacía o solo espacios queda vacía", () => {
    expect(normalizarBusqueda("")).toBe("")
    expect(normalizarBusqueda("   ")).toBe("")
  })

  it("deja pasar los signos que el REFES usa en las razones sociales", () => {
    // No es un slugifier: los puntos, guiones y paréntesis se conservan
    // porque forman parte del nombre y no molestan a un `like %...%`.
    expect(normalizarBusqueda("O.S.E.C.A.C. - BIOQUIMICA - CAPITAL.-")).toBe(
      "o.s.e.c.a.c. - bioquimica - capital.-",
    )
    expect(normalizarBusqueda("CEMIC (Sede Saavedra)")).toBe("cemic (sede saavedra)")
  })
})

describe("provinciaCanonica", () => {
  it("traduce las dos jurisdicciones que el REFES escribe distinto", () => {
    expect(provinciaCanonica("CABA")).toBe("Ciudad Autónoma de Buenos Aires")
    expect(provinciaCanonica("TIERRA DEL FUEGO")).toBe(
      "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
    )
  })

  it("reconoce las 22 restantes por su nombre en mayúsculas y con tildes", () => {
    const delRefes = [
      "BUENOS AIRES",
      "CATAMARCA",
      "CHACO",
      "CHUBUT",
      "CÓRDOBA",
      "CORRIENTES",
      "ENTRE RÍOS",
      "FORMOSA",
      "JUJUY",
      "LA PAMPA",
      "LA RIOJA",
      "MENDOZA",
      "MISIONES",
      "NEUQUÉN",
      "RÍO NEGRO",
      "SALTA",
      "SAN JUAN",
      "SAN LUIS",
      "SANTA CRUZ",
      "SANTA FE",
      "SANTIAGO DEL ESTERO",
      "TUCUMÁN",
    ]

    for (const nombre of delRefes) {
      const canonica = provinciaCanonica(nombre)
      expect(canonica, `no se reconoció "${nombre}"`).not.toBeNull()
      expect(PROVINCIAS_ARGENTINAS).toContain(canonica)
    }
  })

  it("cubre las 24 jurisdicciones que publica el REFES, sin faltar ninguna", () => {
    // Las 24 exactas de la edición de diciembre de 2025 (verificado sobre el
    // archivo: `select distinct provincia_nombre` da 24 valores).
    const veinticuatro = [
      "BUENOS AIRES",
      "CABA",
      "CATAMARCA",
      "CHACO",
      "CHUBUT",
      "CÓRDOBA",
      "CORRIENTES",
      "ENTRE RÍOS",
      "FORMOSA",
      "JUJUY",
      "LA PAMPA",
      "LA RIOJA",
      "MENDOZA",
      "MISIONES",
      "NEUQUÉN",
      "RÍO NEGRO",
      "SALTA",
      "SAN JUAN",
      "SAN LUIS",
      "SANTA CRUZ",
      "SANTA FE",
      "SANTIAGO DEL ESTERO",
      "TIERRA DEL FUEGO",
      "TUCUMÁN",
    ]

    const traducidas = veinticuatro.map((nombre) => provinciaCanonica(nombre))
    expect(traducidas.filter((valor) => valor === null)).toHaveLength(0)
    expect(new Set(traducidas).size).toBe(24)
  })

  it("es insensible a mayúsculas y tildes al mapear", () => {
    expect(provinciaCanonica("cordoba")).toBe("Córdoba")
    expect(provinciaCanonica("Caba")).toBe("Ciudad Autónoma de Buenos Aires")
  })

  it("devuelve null -no inventa- ante una jurisdicción desconocida o vacía", () => {
    // El centro se guarda igual y solo pierde la precarga de provincia en el
    // formulario de turno; guardar un valor inventado haría fallar el CHECK
    // `appointments_location_province_valida` recién al guardar el turno.
    expect(provinciaCanonica("PROVINCIA NUEVA")).toBeNull()
    expect(provinciaCanonica("")).toBeNull()
    expect(provinciaCanonica(null)).toBeNull()
    expect(provinciaCanonica(undefined)).toBeNull()
  })
})
