/**
 * Tests de `lib/documentos/ruteo.ts` (Sprint 20 — "una foto, el lugar
 * correcto").
 *
 * El caso que motivó el sprint es el callejón sin salida: un `estudio_realizado`
 * con fecha futura ANTES rechazaba con "la fecha no puede ser futura" y no
 * ofrecía ninguna salida. Ahora el cartel pregunta si eso era un turno. Se
 * cubre acá junto con la precedencia (intención por sobre fecha futura) y la
 * seguridad de las URLs que arma `siguientePasoDeCargaDeMedicamentos`, que por
 * construcción no pueden apuntar afuera de la app.
 */

import { describe, expect, it } from "vitest"

import {
  hrefRuteo,
  ofrecerRuteo,
  parsearIndicesMedicamentos,
  siguientePasoDeCargaDeMedicamentos,
  type OfertaRuteo,
  type SenalesRuteo,
} from "@/lib/documentos/ruteo"

function senales(cambios: Partial<SenalesRuteo> = {}): SenalesRuteo {
  return {
    intencion: "estudio_realizado",
    fechaFutura: false,
    cantidadMedicamentos: 0,
    ...cambios,
  }
}

describe("ofrecerRuteo — las tres intenciones con destino propio", () => {
  it("receta_o_medicacion ofrece Medicación", () => {
    const oferta = ofrecerRuteo(senales({ intencion: "receta_o_medicacion" }))
    expect(oferta?.destino).toBe("medicacion")
    expect(oferta?.motivo).toBe("intencion")
  })

  it("turno_o_cita ofrece Turnos", () => {
    const oferta = ofrecerRuteo(senales({ intencion: "turno_o_cita" }))
    expect(oferta?.destino).toBe("turnos")
    expect(oferta?.motivo).toBe("intencion")
  })

  it("orden_de_practica también ofrece Turnos (se abre un turno nuevo para sacarle fecha)", () => {
    const oferta = ofrecerRuteo(senales({ intencion: "orden_de_practica" }))
    expect(oferta?.destino).toBe("turnos")
    expect(oferta?.motivo).toBe("intencion")
  })
})

describe("ofrecerRuteo — el rescate de la fecha futura (el arreglo del callejón sin salida)", () => {
  it("estudio_realizado sin fecha futura no ofrece nada: es el caso normal", () => {
    expect(ofrecerRuteo(senales())).toBeNull()
  })

  it("estudio_realizado CON fecha futura ofrece cargarlo como turno — el caso más importante del sprint", () => {
    const oferta = ofrecerRuteo(senales({ fechaFutura: true }))
    expect(oferta).not.toBeNull()
    expect(oferta?.destino).toBe("turnos")
    expect(oferta?.motivo).toBe("fecha_futura")
  })

  it("otro con fecha futura también ofrece el rescate", () => {
    const oferta = ofrecerRuteo(senales({ intencion: "otro", fechaFutura: true }))
    expect(oferta?.motivo).toBe("fecha_futura")
    expect(oferta?.destino).toBe("turnos")
  })

  it("otro SIN fecha futura no ofrece nada, igual que estudio_realizado", () => {
    expect(ofrecerRuteo(senales({ intencion: "otro" }))).toBeNull()
  })
})

describe("ofrecerRuteo — precedencia: la intención gana sobre la fecha futura", () => {
  it("receta_o_medicacion con fecha futura sigue ofreciendo medicación, no turnos", () => {
    // Dos carteles a la vez serían dos preguntas para una sola foto: si el
    // clasificador ya dijo "receta", eso manda aunque además la fecha sea futura.
    const oferta = ofrecerRuteo(senales({ intencion: "receta_o_medicacion", fechaFutura: true }))
    expect(oferta?.motivo).toBe("intencion")
    expect(oferta?.destino).toBe("medicacion")
  })

  it("turno_o_cita con fecha futura sigue siendo motivo intencion", () => {
    const oferta = ofrecerRuteo(senales({ intencion: "turno_o_cita", fechaFutura: true }))
    expect(oferta?.motivo).toBe("intencion")
  })
})

describe("ofrecerRuteo — el texto cambia según la cantidad de medicamentos", () => {
  it("0 medicamentos: no afirma haber leído nombres", () => {
    const oferta = ofrecerRuteo(senales({ intencion: "receta_o_medicacion", cantidadMedicamentos: 0 }))
    expect(oferta?.cuerpo).toContain("No pudimos leer los nombres")
  })

  it("1 medicamento: singular", () => {
    const oferta = ofrecerRuteo(senales({ intencion: "receta_o_medicacion", cantidadMedicamentos: 1 }))
    expect(oferta?.cuerpo).toContain("Leímos 1 medicamento.")
  })

  it("N medicamentos: plural con el número", () => {
    const oferta = ofrecerRuteo(senales({ intencion: "receta_o_medicacion", cantidadMedicamentos: 3 }))
    expect(oferta?.cuerpo).toContain("Leímos 3 medicamentos.")
  })
})

describe("hrefRuteo", () => {
  const ofertaMedicacion: OfertaRuteo = {
    destino: "medicacion",
    motivo: "intencion",
    titulo: "t",
    cuerpo: "c",
    textoBoton: "b",
  }
  const ofertaTurnos: OfertaRuteo = { ...ofertaMedicacion, destino: "turnos" }

  it("destino medicación sin índices no agrega &med=", () => {
    expect(hrefRuteo(ofertaMedicacion, "doc-1")).toBe("/medicacion/nuevo?doc=doc-1")
  })

  it("destino medicación con índices los agrega separados por coma", () => {
    expect(hrefRuteo(ofertaMedicacion, "doc-1", [0, 2])).toBe("/medicacion/nuevo?doc=doc-1&med=0,2")
  })

  it("destino turnos ignora los índices (no aplican)", () => {
    expect(hrefRuteo(ofertaTurnos, "doc-1", [0, 1])).toBe("/turnos/nuevo?doc=doc-1")
  })

  it("el documentoId se codifica en la URL", () => {
    const href = hrefRuteo(ofertaMedicacion, "doc con espacios/raros?")
    expect(href).toBe(`/medicacion/nuevo?doc=${encodeURIComponent("doc con espacios/raros?")}`)
    expect(href).not.toContain(" ")
  })
})

describe("siguientePasoDeCargaDeMedicamentos", () => {
  it("con pendientes, va al siguiente medicamento de la cola", () => {
    const url = siguientePasoDeCargaDeMedicamentos({
      documentoId: "doc-1",
      pendientes: [1, 2],
      hechos: 1,
    })
    expect(url).toBe("/medicacion/nuevo?doc=doc-1&med=1,2&hechos=1")
  })

  it("sin pendientes, va a la pantalla de revisión del documento con el contador final", () => {
    const url = siguientePasoDeCargaDeMedicamentos({
      documentoId: "doc-1",
      pendientes: [],
      hechos: 3,
    })
    expect(url).toBe("/estudios/nuevo/procesando?doc=doc-1&medicamentos=3")
  })

  it("SEGURIDAD: con un documentoId hostil tipo URL absoluta, la URL resultante sigue siendo interna", () => {
    // La función arma la URL a partir de un uuid + una lista de números: no hay
    // ningún campo de redirección libre que un atacante pueda controlar.
    const hostil = "http://malicioso.example"
    const conPendientes = siguientePasoDeCargaDeMedicamentos({
      documentoId: hostil,
      pendientes: [0],
      hechos: 0,
    })
    const sinPendientes = siguientePasoDeCargaDeMedicamentos({
      documentoId: hostil,
      pendientes: [],
      hechos: 1,
    })

    for (const url of [conPendientes, sinPendientes]) {
      expect(url.startsWith("/")).toBe(true)
      expect(url.startsWith("//")).toBe(false)
      // El host hostil queda codificado dentro del query string, no se cuela crudo.
      expect(url).not.toContain("http://malicioso.example")
    }
  })

  it("SEGURIDAD: con un documentoId de path traversal, la URL sigue empezando con / y el payload va codificado", () => {
    const hostil = "a/../../otro"
    const url = siguientePasoDeCargaDeMedicamentos({
      documentoId: hostil,
      pendientes: [],
      hechos: 0,
    })

    expect(url.startsWith("/")).toBe(true)
    expect(url.startsWith("/estudios/nuevo/procesando?doc=")).toBe(true)
    expect(url).not.toContain("a/../../otro")
  })
})

describe("parsearIndicesMedicamentos", () => {
  it("una lista normal se parsea completa", () => {
    expect(parsearIndicesMedicamentos("0,1,2", 5)).toEqual([0, 1, 2])
  })

  it("repetidos se deduplican", () => {
    expect(parsearIndicesMedicamentos("0,0,1,1", 5)).toEqual([0, 1])
  })

  it("índices fuera de rango se descartan", () => {
    expect(parsearIndicesMedicamentos("0,5,10", 3)).toEqual([0])
  })

  it("índices negativos se descartan (el regex de dígitos ya los excluye)", () => {
    expect(parsearIndicesMedicamentos("-1,0,1", 3)).toEqual([0, 1])
  })

  it("basura no numérica se descarta sin romper el parseo del resto", () => {
    expect(parsearIndicesMedicamentos("abc,1", 3)).toEqual([1])
    expect(parsearIndicesMedicamentos("1,,2", 3)).toEqual([1, 2])
  })

  it("undefined da lista vacía", () => {
    expect(parsearIndicesMedicamentos(undefined, 5)).toEqual([])
  })

  it("el orden de salida es siempre ascendente, sin importar el orden de entrada", () => {
    expect(parsearIndicesMedicamentos("3,1,2,0", 5)).toEqual([0, 1, 2, 3])
  })

  it("cantidadDisponible 0 da lista vacía aunque el crudo tenga números", () => {
    expect(parsearIndicesMedicamentos("0,1,2", 0)).toEqual([])
  })
})
