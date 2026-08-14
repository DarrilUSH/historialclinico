/**
 * Tests unitarios de `lib/validacion/sos.schema.ts` (Sprint 8, tarea 8.2).
 *
 *   npm run test -- sos-schema
 *
 * Los tres ejes que pide el criterio de aceptación del ROADMAP:
 * grupo sanguíneo inválido rechazado, teléfono del contacto validado, y
 * texto con tildes/ñ que sobrevive intacto el ida y vuelta.
 */

import { describe, it, expect } from "vitest"
import {
  GRUPOS_SANGUINEOS,
  MAX_ITEMS_LISTA,
  MAX_LARGO_ITEM,
  validarFichaSos,
} from "@/lib/validacion/sos.schema"

const base = {
  grupoSanguineo: "",
  alergias: [] as string[],
  condicionesCronicas: [] as string[],
  medicacionCritica: [] as string[],
  contactoNombre: "",
  contactoTelefono: "",
  contactoVinculo: "",
  notas: "",
}

describe("lib/validacion/sos.schema.ts — grupo sanguíneo", () => {
  it.each(GRUPOS_SANGUINEOS)("acepta el grupo válido %s", (grupo) => {
    const resultado = validarFichaSos({ ...base, grupoSanguineo: grupo })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.grupoSanguineo).toBe(grupo)
    }
  })

  it("cubre exactamente los 8 valores del CHECK profiles_blood_type_valido", () => {
    expect([...GRUPOS_SANGUINEOS]).toEqual(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])
  })

  it('trata "" ("No lo sé") como NULL, no como valor inválido', () => {
    const resultado = validarFichaSos({ ...base, grupoSanguineo: "" })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.grupoSanguineo).toBeUndefined()
    }
  })

  it("trata el grupo ausente como NULL", () => {
    const { grupoSanguineo: _omitido, ...sinGrupo } = base
    void _omitido
    const resultado = validarFichaSos(sinGrupo)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.grupoSanguineo).toBeUndefined()
    }
  })

  it.each(["Z+", "a+", "AB", "0+", "A +", "O–", "A positivo", "AB++"])(
    "rechaza el grupo inválido %s  [CRITERIO DE ACEPTACIÓN]",
    (grupo) => {
      const resultado = validarFichaSos({ ...base, grupoSanguineo: grupo })
      expect(resultado.ok).toBe(false)
      if (!resultado.ok) {
        expect(resultado.error).toContain("grupo sanguíneo válido")
      }
    },
  )

  it("recorta espacios alrededor de un grupo válido", () => {
    const resultado = validarFichaSos({ ...base, grupoSanguineo: "  O-  " })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.grupoSanguineo).toBe("O-")
    }
  })
})

describe("lib/validacion/sos.schema.ts — listas SOS", () => {
  it("preserva tildes y ñ intactas en las tres listas  [CRITERIO DE ACEPTACIÓN]", () => {
    const resultado = validarFichaSos({
      ...base,
      alergias: ["Alergia a penicilína, ñoquis", "Ibuprofeno"],
      condicionesCronicas: ["Hipertensión arterial", "Diabetes tipo 2"],
      medicacionCritica: ["Levotiroxina 75 µg", "Insulina NPH"],
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.alergias).toEqual(["Alergia a penicilína, ñoquis", "Ibuprofeno"])
      expect(resultado.datos.condicionesCronicas).toEqual([
        "Hipertensión arterial",
        "Diabetes tipo 2",
      ])
      expect(resultado.datos.medicacionCritica).toEqual(["Levotiroxina 75 µg", "Insulina NPH"])
    }
  })

  it("no parte un ítem por sus comas: una alergia con coma sigue siendo UNA", () => {
    const resultado = validarFichaSos({
      ...base,
      alergias: ["Alergia a penicilína, ñoquis"],
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.alergias).toHaveLength(1)
    }
  })

  it("recorta espacios y descarta ítems vacíos", () => {
    const resultado = validarFichaSos({
      ...base,
      alergias: ["  Polen  ", "", "   ", "Ácaros"],
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.alergias).toEqual(["Polen", "Ácaros"])
    }
  })

  it("deduplica sin distinguir mayúsculas y conserva la primera forma escrita", () => {
    const resultado = validarFichaSos({
      ...base,
      alergias: ["Penicilina", "penicilina", "PENICILINA"],
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.alergias).toEqual(["Penicilina"])
    }
  })

  it("NO deduplica dos entradas que solo difieren en la tilde", () => {
    const resultado = validarFichaSos({
      ...base,
      alergias: ["Penicilina", "Penicilína"],
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.alergias).toHaveLength(2)
    }
  })

  it("devuelve [] -nunca undefined- cuando la lista no viene", () => {
    const resultado = validarFichaSos({ grupoSanguineo: "" })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.alergias).toEqual([])
      expect(resultado.datos.condicionesCronicas).toEqual([])
      expect(resultado.datos.medicacionCritica).toEqual([])
    }
  })

  it(`rechaza un ítem de más de ${MAX_LARGO_ITEM} caracteres`, () => {
    const resultado = validarFichaSos({
      ...base,
      condicionesCronicas: ["á".repeat(MAX_LARGO_ITEM + 1)],
    })
    expect(resultado.ok).toBe(false)
  })

  it(`acepta un ítem de exactamente ${MAX_LARGO_ITEM} caracteres`, () => {
    const resultado = validarFichaSos({
      ...base,
      condicionesCronicas: ["á".repeat(MAX_LARGO_ITEM)],
    })
    expect(resultado.ok).toBe(true)
  })

  it(`rechaza más de ${MAX_ITEMS_LISTA} ítems en una misma lista`, () => {
    const muchos = Array.from({ length: MAX_ITEMS_LISTA + 1 }, (_, i) => `Alergia ${i}`)
    const resultado = validarFichaSos({ ...base, alergias: muchos })
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toContain("más de")
    }
  })

  it(`acepta exactamente ${MAX_ITEMS_LISTA} ítems`, () => {
    const justos = Array.from({ length: MAX_ITEMS_LISTA }, (_, i) => `Alergia ${i}`)
    const resultado = validarFichaSos({ ...base, alergias: justos })
    expect(resultado.ok).toBe(true)
  })
})

describe("lib/validacion/sos.schema.ts — contacto de emergencia", () => {
  const conNombre = { ...base, contactoNombre: "María Gómez" }

  it.each([
    "+54 9 2901 612345",
    "2901612345",
    "(02901) 612345",
    "+542901612345",
    "02901 15-612345",
  ])("acepta el teléfono argentino real %s", (telefono) => {
    const resultado = validarFichaSos({ ...conNombre, contactoTelefono: telefono })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.contactoTelefono).toBe(telefono)
    }
  })

  it.each(["12345", "hola", "2901-ABC-123", "+54 9 2901 612345 interno 4", "------"])(
    "rechaza el teléfono inválido %s",
    (telefono) => {
      const resultado = validarFichaSos({ ...conNombre, contactoTelefono: telefono })
      expect(resultado.ok).toBe(false)
    },
  )

  it("rechaza un teléfono de más de 20 caracteres", () => {
    const resultado = validarFichaSos({
      ...conNombre,
      contactoTelefono: "+54 9 2901 612345 999",
    })
    expect(resultado.ok).toBe(false)
  })

  it("acepta el contacto vacío entero (la ficha SOS puede no tener contacto)", () => {
    const resultado = validarFichaSos(base)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.contactoNombre).toBeUndefined()
      expect(resultado.datos.contactoTelefono).toBeUndefined()
      expect(resultado.datos.contactoVinculo).toBeUndefined()
    }
  })

  it("acepta el nombre solo, sin teléfono ni vínculo", () => {
    const resultado = validarFichaSos(conNombre)
    expect(resultado.ok).toBe(true)
  })

  it("rechaza un teléfono sin nombre de contacto", () => {
    const resultado = validarFichaSos({ ...base, contactoTelefono: "2901612345" })
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.error).toContain("nombre del contacto")
    }
  })

  it("rechaza un vínculo sin nombre de contacto", () => {
    const resultado = validarFichaSos({ ...base, contactoVinculo: "hija" })
    expect(resultado.ok).toBe(false)
  })

  it("preserva tildes y ñ en nombre y vínculo", () => {
    const resultado = validarFichaSos({
      ...base,
      contactoNombre: "Begoña Muñoz Ibáñez",
      contactoTelefono: "+54 9 2901 612345",
      contactoVinculo: "sobrina política",
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.contactoNombre).toBe("Begoña Muñoz Ibáñez")
      expect(resultado.datos.contactoVinculo).toBe("sobrina política")
    }
  })

  it("recorta espacios del nombre y del vínculo", () => {
    const resultado = validarFichaSos({
      ...base,
      contactoNombre: "  Ana  ",
      contactoVinculo: "  hija  ",
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.contactoNombre).toBe("Ana")
      expect(resultado.datos.contactoVinculo).toBe("hija")
    }
  })

  it("rechaza un vínculo de más de 60 caracteres", () => {
    const resultado = validarFichaSos({
      ...base,
      contactoNombre: "Ana",
      contactoVinculo: "x".repeat(61),
    })
    expect(resultado.ok).toBe(false)
  })
})

describe("lib/validacion/sos.schema.ts — observaciones", () => {
  it("preserva tildes, ñ y signos de apertura en las notas", () => {
    const notas = "Marcapasos desde 2019. ¿Alergia a látex? Prótesis de cadera — lado izquierdo."
    const resultado = validarFichaSos({ ...base, notas })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.notas).toBe(notas)
    }
  })

  it("rechaza notas de más de 2000 caracteres", () => {
    const resultado = validarFichaSos({ ...base, notas: "a".repeat(2001) })
    expect(resultado.ok).toBe(false)
  })

  it("trata las notas vacías como ausentes", () => {
    const resultado = validarFichaSos({ ...base, notas: "   " })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.notas).toBeUndefined()
    }
  })
})

describe("lib/validacion/sos.schema.ts — ficha completa", () => {
  it("valida una ficha entera con todos los campos poblados", () => {
    const resultado = validarFichaSos({
      grupoSanguineo: "O+",
      alergias: ["Penicilina", "Ácaros"],
      condicionesCronicas: ["Hipertensión", "Diabetes tipo 2"],
      medicacionCritica: ["Metformina 850 mg"],
      contactoNombre: "María Gómez",
      contactoTelefono: "+54 9 2901 612345",
      contactoVinculo: "hija",
      notas: "Usa audífono en el oído derecho.",
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos).toEqual({
        grupoSanguineo: "O+",
        alergias: ["Penicilina", "Ácaros"],
        condicionesCronicas: ["Hipertensión", "Diabetes tipo 2"],
        medicacionCritica: ["Metformina 850 mg"],
        contactoNombre: "María Gómez",
        contactoTelefono: "+54 9 2901 612345",
        contactoVinculo: "hija",
        notas: "Usa audífono en el oído derecho.",
      })
    }
  })

  it("valida una ficha totalmente vacía: borrar la ficha es una operación legítima", () => {
    const resultado = validarFichaSos(base)
    expect(resultado.ok).toBe(true)
  })
})
