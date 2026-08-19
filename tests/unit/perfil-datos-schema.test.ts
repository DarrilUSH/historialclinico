/**
 * Tests unitarios de `lib/validacion/perfil-datos.schema.ts` (pantalla
 * "Mis datos", `/perfil/datos`).
 *
 *   npm run test -- perfil-datos-schema
 *
 * Ejes cubiertos: nombre obligatorio (espeja `profiles_full_name_no_vacio`),
 * fecha de nacimiento opcional pero no futura ni absurdamente antigua (mismo
 * criterio de fechas puras que `crearPerfilGestionado`), DNI opcional con
 * formato flexible (7-8 dígitos, tolera puntos, se normaliza sin ellos), y
 * teléfono opcional con el mismo criterio pragmático que `sos.schema.ts`.
 */

import { describe, it, expect } from "vitest"

import { validarDatosPerfil } from "@/lib/validacion/perfil-datos.schema"

const base = {
  fullName: "María Gómez",
  dateOfBirth: "",
  nationalId: "",
  phone: "",
}

/** `YYYY-MM-DD` de mañana, en UTC (alcanza para "es futura" sin depender del huso exacto de Ushuaia). */
function mananaIso(): string {
  const manana = new Date()
  manana.setUTCDate(manana.getUTCDate() + 2) // +2 para no rozar el borde de huso horario
  return manana.toISOString().slice(0, 10)
}

describe("lib/validacion/perfil-datos.schema.ts — nombre completo", () => {
  it("acepta un nombre válido, trimeado", () => {
    const resultado = validarDatosPerfil({ ...base, fullName: "  Roberto Gómez  " })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.fullName).toBe("Roberto Gómez")
    }
  })

  it("rechaza el nombre vacío (espeja profiles_full_name_no_vacio)", () => {
    const resultado = validarDatosPerfil({ ...base, fullName: "" })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza el nombre compuesto solo de espacios", () => {
    const resultado = validarDatosPerfil({ ...base, fullName: "   " })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza un nombre más largo que el máximo", () => {
    const resultado = validarDatosPerfil({ ...base, fullName: "A".repeat(151) })
    expect(resultado.ok).toBe(false)
  })

  it("conserva tildes y ñ intactas", () => {
    const resultado = validarDatosPerfil({ ...base, fullName: "Iñaki Núñez Zañartu" })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.fullName).toBe("Iñaki Núñez Zañartu")
    }
  })
})

describe("lib/validacion/perfil-datos.schema.ts — fecha de nacimiento", () => {
  it("es opcional: ausente no es un error", () => {
    const resultado = validarDatosPerfil(base)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.dateOfBirth).toBeUndefined()
    }
  })

  it("acepta una fecha pasada válida", () => {
    const resultado = validarDatosPerfil({ ...base, dateOfBirth: "1980-05-15" })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.dateOfBirth).toBe("1980-05-15")
    }
  })

  it("rechaza una fecha futura", () => {
    const resultado = validarDatosPerfil({ ...base, dateOfBirth: mananaIso() })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza una fecha con más de 130 años de antigüedad", () => {
    const resultado = validarDatosPerfil({ ...base, dateOfBirth: "1850-01-01" })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza un formato que no es YYYY-MM-DD", () => {
    const resultado = validarDatosPerfil({ ...base, dateOfBirth: "15/05/1980" })
    expect(resultado.ok).toBe(false)
  })
})

describe("lib/validacion/perfil-datos.schema.ts — DNI", () => {
  it("es opcional: ausente no es un error", () => {
    const resultado = validarDatosPerfil(base)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.nationalId).toBeUndefined()
    }
  })

  it("acepta 8 dígitos sin puntos", () => {
    const resultado = validarDatosPerfil({ ...base, nationalId: "30123456" })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.nationalId).toBe("30123456")
    }
  })

  it("acepta 7 dígitos (DNI viejo)", () => {
    const resultado = validarDatosPerfil({ ...base, nationalId: "4123456" })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.nationalId).toBe("4123456")
    }
  })

  it("tolera puntos como separador de miles y los normaliza al guardar", () => {
    const resultado = validarDatosPerfil({ ...base, nationalId: "30.123.456" })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.nationalId).toBe("30123456")
    }
  })

  it("rechaza menos de 7 dígitos", () => {
    const resultado = validarDatosPerfil({ ...base, nationalId: "123456" })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza más de 8 dígitos", () => {
    const resultado = validarDatosPerfil({ ...base, nationalId: "123456789" })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza letras", () => {
    const resultado = validarDatosPerfil({ ...base, nationalId: "30123ABC" })
    expect(resultado.ok).toBe(false)
  })
})

describe("lib/validacion/perfil-datos.schema.ts — teléfono", () => {
  it("es opcional: ausente no es un error", () => {
    const resultado = validarDatosPerfil(base)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.phone).toBeUndefined()
    }
  })

  it("acepta un teléfono con separadores visuales y + al inicio", () => {
    const resultado = validarDatosPerfil({ ...base, phone: "+54 9 2901 123456" })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.phone).toBe("+54 9 2901 123456")
    }
  })

  it("rechaza un teléfono con muy pocos dígitos", () => {
    const resultado = validarDatosPerfil({ ...base, phone: "123" })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza letras en el teléfono", () => {
    const resultado = validarDatosPerfil({ ...base, phone: "llamar-al-doctor" })
    expect(resultado.ok).toBe(false)
  })
})

describe("lib/validacion/perfil-datos.schema.ts — combinación completa", () => {
  it("acepta los cuatro campos cargados a la vez", () => {
    const resultado = validarDatosPerfil({
      fullName: "Roberto Gómez",
      dateOfBirth: "1948-11-03",
      nationalId: "10.987.654",
      phone: "02901 15-123456",
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos).toEqual({
        fullName: "Roberto Gómez",
        dateOfBirth: "1948-11-03",
        nationalId: "10987654",
        phone: "02901 15-123456",
      })
    }
  })
})
