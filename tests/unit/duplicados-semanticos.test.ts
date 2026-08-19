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
  contarSustanciaCompartida,
  MIN_SUSTANCIA_CAPA_3,
  MIN_SUSTANCIA_CAPA_3_IMAGING,
  type CandidatoDuplicado,
  type DatosComparablesDocumento,
} from "@/lib/documentos/duplicados-semanticos"
import { validarExtraccion } from "@/lib/validacion/documento.schema"
import { caso } from "@/tests/fixtures/documentos-sinteticos/casos"

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
  const base = documento()
  return {
    documentoId: "doc-original",
    titulo: "Análisis de laboratorio — Sanatorio San Jorge",
    ...base,
    // Un candidato SIEMPRE tiene fecha real (documento ya confirmado, ver el
    // comentario de `CandidatoDuplicado`); acá solo se lo confirma al tipo —
    // `documento()` siempre pone una fecha literal, nunca `null`.
    fecha: base.fecha as string,
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

/* ------------------------------------------------------------------ *
 *  SPRINT 18 — la Capa 3 exige SUSTANCIA
 *
 *  Los dos falsos positivos que se corrigen son REALES (medidos sobre los
 *  47 documentos del dueño), pero se reproducen con el banco SINTÉTICO
 *  -otra provincia, otra institución ficticia, otros formatos-, así que lo
 *  que se prueba es la regla general y no un parche al formato de una
 *  clínica puntual.
 * ------------------------------------------------------------------ */

/**
 * Un caso del banco, pasado por el validador REAL y convertido a lo que el
 * detector compara. Que pase por `validarExtraccion` importa: ahí es donde el
 * número de orden se sanea, y ese saneamiento es parte de lo que hace que
 * estos pares dejen de marcarse como duplicados.
 */
function comparableDelBanco(id: string): DatosComparablesDocumento {
  // `paciente` solo existe en el schema del camino automático; el de siempre
  // es `.strict()` y lo rechazaría como campo de más.
  const extraccion = { ...caso(id).extraccion }
  delete extraccion.paciente
  const validado = validarExtraccion(extraccion)
  if (!validado.ok) {
    throw new Error(`El caso ${id} no valida: ${validado.errores.join("; ")}`)
  }
  const datos = validado.datos
  return {
    fecha: datos.fecha,
    categoria: datos.categoria,
    institucion: datos.institucion,
    medico: datos.medico,
    numeroOrden: datos.numero_orden ?? "",
    metricas: datos.metricas.map((metrica) => ({
      nombre: metrica.nombre,
      valor: metrica.valor,
      unidad: metrica.unidad,
    })),
  }
}

function candidatoDelBanco(id: string): CandidatoDuplicado {
  const datos = comparableDelBanco(id)
  // Los casos del banco sintético siempre traen fecha (ver
  // `tests/fixtures/documentos-sinteticos/casos.ts`); esto solo lo confirma
  // al tipo, igual que en `candidato()`.
  return { ...datos, fecha: datos.fecha as string, documentoId: id, titulo: id }
}

describe("Capa 3 — los dos falsos positivos reales", () => {
  it("FALSO POSITIVO 1 — dos estudios DISTINTOS del mismo día en el mismo lugar no son duplicados", () => {
    // Una radiografía de tórax y una radiografía de tobillo, el mismo día, en
    // la misma clínica. Las dos son `imaging`, ninguna trae métricas, ninguna
    // trae médico informante legible: para la Capa 3 vieja "todos los datos"
    // coincidían y una de las dos quedaba escondida detrás de un aviso de
    // duplicado. Es el mismo mecanismo que marcó una radiografía de abdomen
    // como duplicada de una ecografía en el historial real.
    const torax = comparableDelBanco("05-radiografia-accesion-dicom")
    const tobillo = comparableDelBanco("16-radiografia-dni-mal-leido")

    // Todo lo que la Capa 3 compara coincide...
    expect(torax.fecha).toBe(tobillo.fecha)
    expect(torax.categoria).toBe(tobillo.categoria)
    expect(torax.institucion).toBe(tobillo.institucion)
    expect(torax.medico).toBe(tobillo.medico)
    // ...y aun así NO son duplicados: no hay sustancia que lo sostenga.
    expect(contarSustanciaCompartida(torax, tobillo)).toBeLessThan(MIN_SUSTANCIA_CAPA_3)
    expect(coincidenTodosLosDatos(torax, tobillo)).toBe(false)
    expect(buscarDuplicadoSemanticoEntreCandidatos(torax, [candidatoDelBanco("16-radiografia-dni-mal-leido")])).toBeNull()
  })

  it("FALSO POSITIVO 2 — dos vistas del MISMO estudio son dos documentos y los dos hacen falta", () => {
    // Frente y perfil de la misma columna lumbar. Comparten hasta el número
    // de accesión que el equipo les quemó en el encabezado (`11021738`), que
    // es exactamente lo que en el historial real habría hecho que las cuatro
    // vistas se taparan entre sí.
    const frente = comparableDelBanco("06-columna-lumbar-frente")
    const perfil = comparableDelBanco("07-columna-lumbar-perfil")

    // El saneamiento ya les sacó la accesión: la Capa 2 no tiene con qué.
    expect(frente.numeroOrden).toBe("")
    expect(perfil.numeroOrden).toBe("")
    expect(coincideNumeroOrden(frente, perfil)).toBe(false)

    // Y la Capa 3 tampoco se pronuncia, por falta de sustancia.
    expect(coincidenTodosLosDatos(frente, perfil)).toBe(false)
    expect(buscarDuplicadoSemanticoEntreCandidatos(frente, [candidatoDelBanco("07-columna-lumbar-perfil")])).toBeNull()
  })

  it("las CUATRO vistas de la misma serie: ninguna tapa a ninguna", () => {
    const vistas = [
      "05-radiografia-accesion-dicom",
      "06-columna-lumbar-frente",
      "07-columna-lumbar-perfil",
      "16-radiografia-dni-mal-leido",
    ]
    for (const id of vistas) {
      const nuevo = comparableDelBanco(id)
      const otras = vistas.filter((otro) => otro !== id).map(candidatoDelBanco)
      expect(buscarDuplicadoSemanticoEntreCandidatos(nuevo, otras), `${id} no puede tener duplicado`).toBeNull()
    }
  })
})

describe("Capa 3 — lo que la exigencia de sustancia NO rompió", () => {
  it("un laboratorio duplicado de verdad se sigue detectando (banco sintético, Bioquímico del Sur)", () => {
    const original = candidatoDelBanco("01-bioquimico-del-sur-protocolo")
    const regenerado = comparableDelBanco("01-bioquimico-del-sur-protocolo")

    expect(contarSustanciaCompartida(regenerado, original)).toBeGreaterThanOrEqual(
      MIN_SUSTANCIA_CAPA_3,
    )
    const encontrado = buscarDuplicadoSemanticoEntreCandidatos(regenerado, [original])
    expect(encontrado).not.toBeNull()
  })

  it("un laboratorio SIN número de orden acreditado igual se detecta por la Capa 3 (Hospital Zonal, ficticio)", () => {
    const sinOrden = { ...comparableDelBanco("03-hospital-zonal-solicitud"), numeroOrden: "" }
    const original: CandidatoDuplicado = {
      ...sinOrden,
      fecha: sinOrden.fecha as string,
      documentoId: "ya-cargado",
      titulo: "Análisis — enero",
    }
    const encontrado = buscarDuplicadoSemanticoEntreCandidatos(sinOrden, [original])
    expect(encontrado?.motivo).toBe("datos_identicos")
  })

  it("REGLA 2 DEL USUARIO, intacta — fecha distinta sigue siendo JAMÁS duplicado", () => {
    const control = comparableDelBanco("01-bioquimico-del-sur-protocolo")
    const mismoAnalisisEnOtraFecha: CandidatoDuplicado = {
      ...control,
      fecha: "2026-09-04",
      documentoId: "control-de-septiembre",
      titulo: "Hemograma — septiembre",
    }
    expect(coincidenTodosLosDatos(control, mismoAnalisisEnOtraFecha)).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 *  SPRINT 19 — umbral adaptado para IMAGEN con médico informante
 *
 *  Caso real del dueño: una ecografía vesical regenerada (mismo contenido,
 *  bytes distintos) no se detectaba porque institución + médico solo suman 2
 *  y `MIN_SUSTANCIA_CAPA_3` pide 3 — un estudio de imágenes no tiene métricas
 *  ni casi nunca número de orden, así que institución + médico ES el techo.
 * ------------------------------------------------------------------ */

describe("Capa 3 — umbral adaptado para IMAGEN con médico informante (Sprint 19)", () => {
  /** Un estudio de imágenes con médico informante, análogo a la ecografía vesical real. */
  function estudioDeImagen(parcial: Partial<DatosComparablesDocumento> = {}): DatosComparablesDocumento {
    return documento({
      categoria: "imaging",
      institucion: "Sanatorio San Jorge",
      medico: "Dr. Ibáñez",
      numeroOrden: "",
      metricas: [],
      ...parcial,
    })
  }

  it("CASO REAL — ecografía vesical regenerada: institución + médico (2) ahora alcanza para imaging", () => {
    const nuevo = estudioDeImagen({ fecha: "2024-10-07" })
    const existente = estudioDeImagen({ fecha: "2024-10-07" })

    expect(contarSustanciaCompartida(nuevo, existente)).toBe(2)
    expect(contarSustanciaCompartida(nuevo, existente)).toBeLessThan(MIN_SUSTANCIA_CAPA_3)
    expect(contarSustanciaCompartida(nuevo, existente)).toBeGreaterThanOrEqual(MIN_SUSTANCIA_CAPA_3_IMAGING)
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(true)
  })

  it("categoría distinta de imaging: NO se relaja el umbral aunque institución+médico coincidan", () => {
    const nuevo = estudioDeImagen({ categoria: "consultation" })
    const existente = estudioDeImagen({ categoria: "consultation" })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(false)
  })

  it("imaging SIN médico informante (los dos falsos positivos del Sprint 18): sigue exigiendo el umbral general", () => {
    const torax = comparableDelBanco("05-radiografia-accesion-dicom")
    const tobillo = comparableDelBanco("16-radiografia-dni-mal-leido")
    expect(torax.medico).toBe("")
    expect(tobillo.medico).toBe("")
    expect(coincidenTodosLosDatos(torax, tobillo)).toBe(false)
  })

  it("imaging con médico informante en SOLO uno de los dos: no se relaja (la fecha/institución/médico ya deben coincidir antes de llegar acá)", () => {
    const conMedico = estudioDeImagen({ medico: "Dr. Ibáñez" })
    const sinMedico = estudioDeImagen({ medico: "" })
    // La igualdad de médico ya corta antes de la sustancia -no llegan a compararse por umbral-.
    expect(coincidenTodosLosDatos(conMedico, sinMedico)).toBe(false)
  })

  it("REGLA 2 DEL USUARIO intacta para imaging — fecha distinta sigue siendo JAMÁS duplicado (caso real: radiografía de tórax con fechas 29/10 y 31/10)", () => {
    const lectura1 = estudioDeImagen({ fecha: "2025-10-29" })
    const lectura2 = estudioDeImagen({ fecha: "2025-10-31" })
    expect(coincidenTodosLosDatos(lectura1, lectura2)).toBe(false)
  })

  it("las CUATRO vistas sintéticas del Sprint 18 siguen sin dispararse entre sí con el umbral adaptado activo", () => {
    const vistas = [
      "05-radiografia-accesion-dicom",
      "06-columna-lumbar-frente",
      "07-columna-lumbar-perfil",
      "16-radiografia-dni-mal-leido",
    ]
    for (const id of vistas) {
      const nuevo = comparableDelBanco(id)
      const otras = vistas.filter((otro) => otro !== id).map(candidatoDelBanco)
      expect(buscarDuplicadoSemanticoEntreCandidatos(nuevo, otras), `${id} no puede tener duplicado`).toBeNull()
    }
  })
})

describe("contarSustanciaCompartida", () => {
  it("cuenta una unidad por métrica compartida y una por cada dato de contexto en común", () => {
    // 2 métricas + institución + médico + número de orden.
    expect(contarSustanciaCompartida(documento(), documento())).toBe(5)
  })

  it("NO cuenta la fecha ni la categoría: dos estudios del mismo día en el mismo lugar comparten esas dos y no dicen nada", () => {
    const sinContexto = documento({ institucion: "", medico: "", numeroOrden: "", metricas: [] })
    expect(contarSustanciaCompartida(sinContexto, sinContexto)).toBe(0)
  })

  it("un dato presente en uno solo de los dos no cuenta", () => {
    const conMedico = documento({ metricas: [], numeroOrden: "" })
    const sinMedico = documento({ metricas: [], numeroOrden: "", medico: "" })
    // Solo queda la institución en común.
    expect(contarSustanciaCompartida(conMedico, sinMedico)).toBe(1)
  })

  it("solo cuentan las métricas que efectivamente coinciden", () => {
    const nuevo = documento({ institucion: "", medico: "", numeroOrden: "" })
    const existente = documento({
      institucion: "",
      medico: "",
      numeroOrden: "",
      metricas: [
        { nombre: "Glucemia", valor: 95, unidad: "mg/dl" },
        { nombre: "Colesterol total", valor: 999, unidad: "mg/dl" },
      ],
    })
    expect(contarSustanciaCompartida(nuevo, existente)).toBe(1)
  })
})

describe("Capa 3 — números de orden distintos", () => {
  it("dos números de orden DISTINTOS: la propia institución dice que son dos estudios", () => {
    const nuevo = documento({ numeroOrden: "PROT-1" })
    const existente = documento({ numeroOrden: "PROT-2" })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(false)
  })

  it("que uno lo traiga y el otro no, en cambio, no corta nada", () => {
    const nuevo = documento({ numeroOrden: "PROT-1" })
    const existente = documento({ numeroOrden: "" })
    expect(coincidenTodosLosDatos(nuevo, existente)).toBe(true)
  })
})
