/**
 * Tests de `lib/medicacion/desde-documento.ts` (Sprint 20 — "una foto, el
 * lugar correcto").
 *
 * Es el archivo más sensible del sprint: es seguridad clínica. La regla que
 * manda es que LA DOSIS NO SE ADIVINA — `interpretarDosis` solo traduce lo
 * INEQUÍVOCO ("1 comprimido", "medio comprimido") y ante cualquier duda
 * ("500 mg", "5/5", "según indicación") devuelve `null`, dejando el campo
 * vacío para que la persona lo complete con el papel delante. Ver el
 * encabezado del archivo fuente para el porqué de cada exclusión.
 */

import { describe, expect, it } from "vitest"

import {
  avisosDelMedicamento,
  interpretarDosis,
  notasDelPapel,
  precargaDesdeMedicamento,
  resumenMedicamento,
} from "@/lib/medicacion/desde-documento"
import type { MedicamentoExtraido } from "@/lib/gemini/schemas"

function medicamento(cambios: Partial<MedicamentoExtraido> = {}): MedicamentoExtraido {
  return {
    nombre: "COVERAM",
    droga: "perindopril/amlodipina",
    presentacion: "5/5",
    dosis_texto: "",
    frecuencia_texto: "",
    ...cambios,
  }
}

describe("interpretarDosis — lo que SÍ acepta (formas contables o de volumen, sin ambigüedad)", () => {
  it("'1 comprimido'", () => {
    expect(interpretarDosis("1 comprimido")).toEqual({ cantidad: "1", unidad: "comprimido" })
  })

  it("'2 comprimidos' — plural normalizado a singular", () => {
    expect(interpretarDosis("2 comprimidos")).toEqual({ cantidad: "2", unidad: "comprimido" })
  })

  it("'medio comprimido' — cantidad en palabras, a 0.5", () => {
    expect(interpretarDosis("medio comprimido")).toEqual({ cantidad: "0.5", unidad: "comprimido" })
  })

  it("'10 ml'", () => {
    expect(interpretarDosis("10 ml")).toEqual({ cantidad: "10", unidad: "ml" })
  })

  it("'8 gotas' — plural normalizado a singular ('gota')", () => {
    expect(interpretarDosis("8 gotas")).toEqual({ cantidad: "8", unidad: "gota" })
  })

  it("'1,5 ml' — coma decimal argentina normalizada al punto que espera <input type=number>", () => {
    expect(interpretarDosis("1,5 ml")).toEqual({ cantidad: "1.5", unidad: "ml" })
  })

  it("'1comprimido' sin espacio entre cantidad y unidad", () => {
    expect(interpretarDosis("1comprimido")).toEqual({ cantidad: "1", unidad: "comprimido" })
  })

  it("'1 cápsula' con tilde — se coteja sin depender de cómo la escribió el papel", () => {
    expect(interpretarDosis("1 cápsula")).toEqual({ cantidad: "1", unidad: "cápsula" })
  })
})

describe("interpretarDosis — lo que devuelve null (el blindaje real de esta función)", () => {
  it("cadena vacía: el papel no dice nada", () => {
    expect(interpretarDosis("")).toBeNull()
  })

  it("'500 mg' — NO se acepta: los miligramos son indistinguibles de la CONCENTRACIÓN de la pastilla", () => {
    // Confundir la dosis con la concentración impresa en la caja es exactamente
    // el error caro que este archivo existe para evitar. "500 mg" en el
    // renglón de dosis podría ser una toma de 500mg o simplemente la
    // concentración del comprimido -no hay forma de saber cuál sin adivinar-.
    expect(interpretarDosis("500 mg")).toBeNull()
  })

  it("'2 g' — gramos tampoco se aceptan, mismo motivo que los miligramos", () => {
    expect(interpretarDosis("2 g")).toBeNull()
  })

  it("'5/5' — es la concentración de COVERAM (perindopril/amlodipina), no una cantidad a tomar", () => {
    expect(interpretarDosis("5/5")).toBeNull()
  })

  it("'1-0-1' — esquema de horarios, no una dosis contable", () => {
    expect(interpretarDosis("1-0-1")).toBeNull()
  })

  it("'según indicación' — no hay cantidad que leer", () => {
    expect(interpretarDosis("según indicación")).toBeNull()
  })

  it("'0 comprimidos' — cero no es una dosis: es una lectura fallida o un renglón tachado", () => {
    expect(interpretarDosis("0 comprimidos")).toBeNull()
  })

  it("un número pelado ('2') — sin unidad no hay forma de saber a qué se refiere", () => {
    expect(interpretarDosis("2")).toBeNull()
  })
})

describe("precargaDesdeMedicamento", () => {
  const hoyIso = "2026-08-28"

  it("con dosis legible, llena dosisCantidad y dosisUnidad", () => {
    const precarga = precargaDesdeMedicamento(medicamento({ dosis_texto: "1 comprimido" }), { hoyIso })
    expect(precarga.dosisCantidad).toBe("1")
    expect(precarga.dosisUnidad).toBe("comprimido")
  })

  it("SIN dosis legible, dosisCantidad queda '' y dosisUnidad queda undefined (no cadena vacía)", () => {
    // El formulario tiene su propio default ("comprimido") aplicado con
    // `?? "comprimido"`: una cadena vacía lo pisaría y dejaría un campo
    // `required` en blanco. Llegar desde un documento no puede ser PEOR que
    // el alta a mano.
    const precarga = precargaDesdeMedicamento(medicamento({ dosis_texto: "500 mg" }), { hoyIso })
    expect(precarga.dosisCantidad).toBe("")
    expect(precarga.dosisUnidad).toBeUndefined()
  })

  it("fechaInicio es el hoyIso que se le pasa, no una fecha leída del papel", () => {
    const precarga = precargaDesdeMedicamento(medicamento(), { hoyIso: "2026-01-15" })
    expect(precarga.fechaInicio).toBe("2026-01-15")
  })

  it("notas SIEMPRE trae el texto literal del papel, incluso cuando la dosis sí se interpretó", () => {
    const precarga = precargaDesdeMedicamento(
      medicamento({ dosis_texto: "1 comprimido", frecuencia_texto: "cada 12 horas" }),
      { hoyIso },
    )
    expect(precarga.notas).toContain("dosis «1 comprimido»")
    expect(precarga.notas).toContain("frecuencia «cada 12 horas»")
  })

  describe("EL CASO REAL del sprint — tres renglones manuscritos sin ninguna dosis legible", () => {
    // El papelito real: COVERAM (perindopril/amlodipina, 5/5), LIPOMAX 105
    // (ácido fenofíbrico) y ROSUVASTATINA 10, ninguno con dosis_texto que se
    // pueda leer sin suponer. Los tres tienen que precargar dosisCantidad ""
    // — nunca un número inventado a partir de la presentación.
    const renglones: MedicamentoExtraido[] = [
      {
        nombre: "COVERAM",
        droga: "perindopril/amlodipina",
        presentacion: "5/5",
        dosis_texto: "",
        frecuencia_texto: "",
      },
      {
        nombre: "LIPOMAX 105",
        droga: "ácido fenofíbrico",
        presentacion: "",
        dosis_texto: "",
        frecuencia_texto: "",
      },
      {
        nombre: "ROSUVASTATINA",
        droga: "",
        presentacion: "10",
        dosis_texto: "",
        frecuencia_texto: "",
      },
    ]

    it.each(renglones)("$nombre sale con dosisCantidad vacío", (renglon) => {
      const precarga = precargaDesdeMedicamento(renglon, { hoyIso })
      expect(precarga.dosisCantidad).toBe("")
      expect(precarga.dosisUnidad).toBeUndefined()
    })
  })
})

describe("notasDelPapel", () => {
  it("dosis y frecuencia presentes: las dos aparecen unidas con 'y'", () => {
    const texto = notasDelPapel(medicamento({ dosis_texto: "1 comprimido", frecuencia_texto: "cada 8 horas" }))
    expect(texto).toBe(
      "Cargado desde un documento que fotografiaste. El papel decía: dosis «1 comprimido» y frecuencia «cada 8 horas».",
    )
  })

  it("solo dosis: no menciona una frecuencia que no vino", () => {
    const texto = notasDelPapel(medicamento({ dosis_texto: "1 comprimido" }))
    expect(texto).toBe("Cargado desde un documento que fotografiaste. El papel decía: dosis «1 comprimido».")
  })

  it("solo frecuencia: no menciona una dosis que no vino", () => {
    const texto = notasDelPapel(medicamento({ frecuencia_texto: "cada 8 horas" }))
    expect(texto).toBe("Cargado desde un documento que fotografiaste. El papel decía: frecuencia «cada 8 horas».")
  })

  it("ninguna de las dos: el mensaje dice explícitamente que hay que completarlo", () => {
    const texto = notasDelPapel(medicamento())
    expect(texto).toBe(
      "Cargado desde un documento que fotografiaste. El papel no decía la dosis ni cada cuánto tomarlo: completalo vos.",
    )
  })
})

describe("avisosDelMedicamento", () => {
  it("dosis no interpretable (vacía o ambigua) avisa que hay que completarla", () => {
    expect(avisosDelMedicamento(medicamento({ dosis_texto: "" }))).toContain(
      "El papel no dice cuánto tomar — lo completás vos.",
    )
    expect(avisosDelMedicamento(medicamento({ dosis_texto: "500 mg" }))).toContain(
      "El papel no dice cuánto tomar — lo completás vos.",
    )
  })

  it("frecuencia vacía avisa que hay que completarla", () => {
    expect(avisosDelMedicamento(medicamento({ frecuencia_texto: "" }))).toContain(
      "El papel no dice cada cuánto — lo completás vos.",
    )
  })

  it("con dosis legible y frecuencia presente, no hay avisos", () => {
    const avisos = avisosDelMedicamento(
      medicamento({ dosis_texto: "1 comprimido", frecuencia_texto: "cada 8 horas" }),
    )
    expect(avisos).toEqual([])
  })

  it("el caso real (dosis y frecuencia ausentes) trae los dos avisos", () => {
    expect(avisosDelMedicamento(medicamento())).toEqual([
      "El papel no dice cuánto tomar — lo completás vos.",
      "El papel no dice cada cuánto — lo completás vos.",
    ])
  })
})

describe("resumenMedicamento", () => {
  it("nombre + presentación — droga, como en el ejemplo del encabezado del archivo", () => {
    expect(resumenMedicamento(medicamento())).toBe("COVERAM 5/5 — perindopril/amlodipina")
  })

  it("sin droga, no agrega el separador '—'", () => {
    expect(resumenMedicamento(medicamento({ droga: "" }))).toBe("COVERAM 5/5")
  })

  it("sin presentación, la cabeza queda solo con el nombre", () => {
    expect(resumenMedicamento(medicamento({ presentacion: "" }))).toBe("COVERAM — perindopril/amlodipina")
  })
})
