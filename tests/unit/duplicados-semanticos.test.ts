/**
 * Test del detector de duplicados SEMÁNTICOS
 * (`lib/documentos/duplicados-semanticos.ts`), Capas 2 y 3 sobre la huella
 * byte-a-byte: el mismo estudio no entra dos veces aunque el PDF venga
 * regenerado por la clínica.
 *
 * Cubre las tres reglas del usuario, textuales:
 *
 *   1. Todos los datos exactamente iguales → duplicado (Capa 3).
 *   2. Fecha distinta = JAMÁS duplicado, sin importar cuántos valores
 *      coincidan (un estudio repetido es un dato válido, no un duplicado).
 *   3. Mismo laboratorio + mismo N° de orden → duplicado directo (Capa 2),
 *      evidencia real: Sanatorio San Jorge, N° ORDEN 1446188.
 *
 * Puro y sin red: literales de principio a fin.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import {
  buscarDuplicadoSemanticoEntreCandidatos,
  coincideNumeroOrden,
  coincidenTodosLosDatos,
  type CandidatoDuplicado,
  type DatosComparablesDocumento,
} from "@/lib/documentos/duplicados-semanticos"

const METRICAS_LAB_AUSTRAL = [
  { nombre: "Glucemia", valor: 95, unidad: "mg/dl" },
  { nombre: "Colesterol total", valor: 180, unidad: "mg/dl" },
]

/** Un análisis de laboratorio "base", para partir de acá con spreads. */
function documento(parcial: Partial<DatosComparablesDocumento> = {}): DatosComparablesDocumento {
  return {
    fecha: "2026-08-01",
    categoria: "laboratory",
    institucion: "Sanatorio San Jorge",
    medico: "Dra. Pérez",
    numeroOrden: "1446188",
    metricas: METRICAS_LAB_AUSTRAL,
    ...parcial,
  }
}

function candidato(parcial: Partial<CandidatoDuplicado> = {}): CandidatoDuplicado {
  return {
    documentoId: "doc-original",
    titulo: "Análisis de laboratorio — Sanatorio San Jorge",
    ...documento(),
    ...parcial,
  }
}

/* ------------------------------------------------------------------ *
 *  Capa 2 — mismo laboratorio + mismo N° de orden
 * ------------------------------------------------------------------ */

describe("coincideNumeroOrden (Capa 2)", () => {
  it("mismo N° de orden + misma institución → coincide (evidencia real: Sanatorio San Jorge, N° 1446188)", () => {
    expect(coincideNumeroOrden(documento(), documento())).toBe(true)
  })

  it("el PDF regenerado (bytes distintos, mismo contenido): igual coincide porque el número de orden es el mismo", () => {
    // Simula la extracción de Gemini sobre las DOS versiones del mismo PDF:
    // el texto es idéntico, solo cambian los bytes -que este módulo ni ve-.
    const version1 = documento({ institucion: "Sanatorio San Jorge" })
    const version2 = documento({ institucion: "Sanatorio San Jorge" })
    expect(coincideNumeroOrden(version1, version2)).toBe(true)
  })

  it("tolera mayúsculas, tildes y espacios repetidos en la institución", () => {
    const nuevo = documento({ institucion: "  SANATORIO   SAN JORGÉ  " })
    const existente = documento({ institucion: "sanatorio san jorge" })
    expect(coincideNumeroOrden(nuevo, existente)).toBe(true)
  })

  it("mismo número de orden pero DISTINTA institución: NO coincide (dos laboratorios pueden reciclar numeración)", () => {
    const nuevo = documento({ institucion: "Sanatorio San Jorge" })
    const existente = documento({ institucion: "Laboratorio Austral" })
    expect(coincideNumeroOrden(nuevo, existente)).toBe(false)
  })

  it("distinto número de orden: NO coincide", () => {
    const nuevo = documento({ numeroOrden: "1446188" })
    const existente = documento({ numeroOrden: "9999999" })
    expect(coincideNumeroOrden(nuevo, existente)).toBe(false)
  })

  it("sin número de orden en el nuevo: esta capa no se pronuncia", () => {
    const nuevo = documento({ numeroOrden: "" })
    expect(coincideNumeroOrden(nuevo, documento())).toBe(false)
  })

  it("sin número de orden en el existente: esta capa no se pronuncia", () => {
    const existente = documento({ numeroOrden: "" })
    expect(coincideNumeroOrden(documento(), existente)).toBe(false)
  })

  it("sin institución en cualquiera de los dos: esta capa no se pronuncia (aunque el número coincida)", () => {
    expect(coincideNumeroOrden(documento({ institucion: "" }), documento())).toBe(false)
    expect(coincideNumeroOrden(documento(), documento({ institucion: "" }))).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 *  Capa 3 — todos los datos extraídos exactamente iguales
 * ------------------------------------------------------------------ */

describe("coincidenTodosLosDatos (Capa 3)", () => {
  it("fecha, categoría, institución, médico y métricas exactamente iguales → duplicado", () => {
    expect(coincidenTodosLosDatos(documento(), documento())).toBe(true)
  })

  it("REGLA 2 DEL USUARIO — fecha distinta = JAMÁS duplicado, aunque TODOS los demás valores coincidan", () => {
    const nuevo = documento({ fecha: "2026-09-01" })
    const existente = documento({ fecha: "2026-08-01" })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(false)
  })

  it("un estudio repetido: mismo análisis, mismo resultado, OTRA fecha — NO es duplicado (dato válido para Tendencias)", () => {
    // El caso textual del usuario: "se volvió a realizar el mismo análisis y
    // obtuvo el mismo resultado" en otro momento.
    const controlDeAgosto = documento({ fecha: "2026-08-01" })
    const controlDeNoviembre = documento({ fecha: "2026-11-01" })
    expect(coincidenTodosLosDatos(controlDeAgosto, controlDeNoviembre)).toBe(false)
  })

  it("categoría distinta: no coincide", () => {
    expect(coincidenTodosLosDatos(documento({ categoria: "laboratory" }), documento({ categoria: "imaging" }))).toBe(
      false,
    )
  })

  it("institución distinta (normalizada): no coincide", () => {
    const nuevo = documento({ institucion: "Sanatorio San Jorge" })
    const existente = documento({ institucion: "Hospital Regional" })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(false)
  })

  it("médico distinto (normalizado): no coincide", () => {
    const nuevo = documento({ medico: "Dra. Pérez" })
    const existente = documento({ medico: "Dr. Gómez" })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(false)
  })

  it("NORMALIZACIÓN — tildes, mayúsculas y espacios repetidos NO cuentan como diferencia", () => {
    const nuevo = documento({
      institucion: "  SANATORIO   SAN JORGÉ  ",
      medico: "DRA PÉREZ",
    })
    const existente = documento({
      institucion: "sanatorio san jorge",
      medico: "dra perez",
    })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(true)
  })

  it("una métrica con valor distinto: no coincide", () => {
    const nuevo = documento({ metricas: [{ nombre: "Glucemia", valor: 95, unidad: "mg/dl" }] })
    const existente = documento({ metricas: [{ nombre: "Glucemia", valor: 110, unidad: "mg/dl" }] })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(false)
  })

  it("una métrica con unidad distinta: no coincide", () => {
    const nuevo = documento({ metricas: [{ nombre: "Glucemia", valor: 95, unidad: "mg/dl" }] })
    const existente = documento({ metricas: [{ nombre: "Glucemia", valor: 95, unidad: "g/l" }] })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(false)
  })

  it("distinta CANTIDAD de métricas: no coincide, aunque las comunes matcheen", () => {
    const nuevo = documento({ metricas: METRICAS_LAB_AUSTRAL })
    const existente = documento({ metricas: [METRICAS_LAB_AUSTRAL[0]] })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(false)
  })

  it("el ORDEN de las métricas no importa (se compara como conjunto)", () => {
    const nuevo = documento({ metricas: [...METRICAS_LAB_AUSTRAL].reverse() })
    const existente = documento({ metricas: METRICAS_LAB_AUSTRAL })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(true)
  })

  it("nombres de métrica SINÓNIMOS (mismo canónico del diccionario) cuentan como la misma métrica", () => {
    // "Glucemia" y "GLU" resuelven al mismo canónico ("Glucosa") en
    // lib/laboratorio/diccionario.ts.
    const nuevo = documento({ metricas: [{ nombre: "Glucemia", valor: 95, unidad: "mg/dl" }] })
    const existente = documento({ metricas: [{ nombre: "GLU", valor: 95, unidad: "mg/dl" }] })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(true)
  })

  it("dos documentos sin ninguna métrica (imágenes/recetas/consultas) igual pueden coincidir por el resto de los datos", () => {
    const nuevo = documento({ categoria: "imaging", metricas: [] })
    const existente = documento({ categoria: "imaging", metricas: [] })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(true)
  })

  it("una métrica repetida en la extracción CRUDA (sin confirmar) no infla la comparación: se deduplica antes de comparar", () => {
    const nuevo = documento({
      metricas: [
        { nombre: "Glucemia", valor: 95, unidad: "mg/dl" },
        { nombre: "Glucemia", valor: 95, unidad: "mg/dl" },
      ],
    })
    const existente = documento({ metricas: [{ nombre: "Glucemia", valor: 95, unidad: "mg/dl" }] })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 *  buscarDuplicadoSemanticoEntreCandidatos — el veredicto combinado
 * ------------------------------------------------------------------ */

describe("buscarDuplicadoSemanticoEntreCandidatos", () => {
  it("sin ningún candidato: no hay duplicado", () => {
    expect(buscarDuplicadoSemanticoEntreCandidatos(documento(), [])).toBeNull()
  })

  it("ningún candidato coincide: no hay duplicado", () => {
    const candidatos = [candidato({ documentoId: "otro", numeroOrden: "000", fecha: "2026-01-01" })]
    expect(buscarDuplicadoSemanticoEntreCandidatos(documento(), candidatos)).toBeNull()
  })

  it("coincide por número de orden: devuelve motivo mismo_numero_orden y el candidato", () => {
    const original = candidato({ documentoId: "doc-original", titulo: "Análisis — agosto" })
    const resultado = buscarDuplicadoSemanticoEntreCandidatos(documento(), [original])

    expect(resultado).not.toBeNull()
    expect(resultado?.motivo).toBe("mismo_numero_orden")
    expect(resultado?.candidato.documentoId).toBe("doc-original")
  })

  it("coincide solo por Capa 3 (sin número de orden en ninguno de los dos): devuelve datos_identicos", () => {
    const nuevo = documento({ numeroOrden: "" })
    const original = candidato({ numeroOrden: "" })
    const resultado = buscarDuplicadoSemanticoEntreCandidatos(nuevo, [original])

    expect(resultado?.motivo).toBe("datos_identicos")
  })

  it("Capa 2 se prefiere sobre Capa 3 cuando el mismo candidato coincide por las dos", () => {
    const resultado = buscarDuplicadoSemanticoEntreCandidatos(documento(), [candidato()])
    expect(resultado?.motivo).toBe("mismo_numero_orden")
  })

  it("con varios candidatos, encuentra el que corresponde y no un falso positivo de otro", () => {
    const candidatos = [
      candidato({ documentoId: "no-es-este", numeroOrden: "111", fecha: "2026-01-01" }),
      candidato({ documentoId: "es-este", numeroOrden: "1446188" }),
      candidato({ documentoId: "tampoco", numeroOrden: "222", fecha: "2026-02-02" }),
    ]
    const resultado = buscarDuplicadoSemanticoEntreCandidatos(documento(), candidatos)
    expect(resultado?.candidato.documentoId).toBe("es-este")
  })

  it("un estudio repetido en otra fecha, mismos valores, SIN número de orden: cero avisos (regla 2 del usuario)", () => {
    const nuevo = documento({ fecha: "2026-11-01", numeroOrden: "" })
    const yaCargado = candidato({ fecha: "2026-08-01", numeroOrden: "" })
    expect(buscarDuplicadoSemanticoEntreCandidatos(nuevo, [yaCargado])).toBeNull()
  })
})
