/**
 * Tests unitarios de `lib/validacion/cobertura.schema.ts`.
 *
 *   npm run test -- cobertura-schema
 */

import { describe, it, expect } from "vitest"
import { validarCobertura } from "@/lib/validacion/cobertura.schema"

const base = {
  proveedor: "OSDE",
  plan: "210",
  numeroAfiliado: "123456789",
  esPrincipal: false,
}

describe("lib/validacion/cobertura.schema.ts", () => {
  it("acepta el ejemplo completo: proveedor, plan y número de afiliado", () => {
    const resultado = validarCobertura(base)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.proveedor).toBe("OSDE")
      expect(resultado.datos.plan).toBe("210")
      expect(resultado.datos.numeroAfiliado).toBe("123456789")
      expect(resultado.datos.esPrincipal).toBe(false)
    }
  })

  it("acepta solo el proveedor, sin plan ni número de afiliado", () => {
    const resultado = validarCobertura({
      proveedor: "PAMI",
      plan: "",
      numeroAfiliado: "",
      esPrincipal: false,
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.plan).toBeUndefined()
      expect(resultado.datos.numeroAfiliado).toBeUndefined()
    }
  })

  it("acepta esPrincipal en true", () => {
    const resultado = validarCobertura({ ...base, esPrincipal: true })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.esPrincipal).toBe(true)
    }
  })

  it("recorta espacios del proveedor", () => {
    const resultado = validarCobertura({ ...base, proveedor: "  IOMA  " })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.proveedor).toBe("IOMA")
    }
  })

  it("rechaza un proveedor vacío", () => {
    const resultado = validarCobertura({ ...base, proveedor: "" })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza un proveedor formado solo por espacios", () => {
    const resultado = validarCobertura({ ...base, proveedor: "   " })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza un proveedor de más de 200 caracteres", () => {
    const resultado = validarCobertura({ ...base, proveedor: "A".repeat(201) })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza un plan de más de 150 caracteres", () => {
    const resultado = validarCobertura({ ...base, plan: "A".repeat(151) })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza un número de afiliado de más de 100 caracteres", () => {
    const resultado = validarCobertura({ ...base, numeroAfiliado: "1".repeat(101) })
    expect(resultado.ok).toBe(false)
  })

  it("rechaza esPrincipal si no es un booleano", () => {
    const resultado = validarCobertura({ ...base, esPrincipal: "true" })
    expect(resultado.ok).toBe(false)
  })
})
