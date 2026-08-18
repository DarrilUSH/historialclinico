/**
 * Tests de `lib/lugares/refes.ts` (Sprint 16, tarea 16.3): la traducción de
 * una fila del CSV oficial a una fila de `health_centers`.
 *
 * Las filas de prueba salen del archivo real, incluidas **las rotas**: el
 * REFES trae 29 latitudes y 34 longitudes fuera de rango (un punto decimal
 * perdido en la carga original) y al menos una fila donde la columna
 * `latitud` contiene un domicilio. Esos casos no son hipótesis defensivas:
 * si llegaran al `upsert`, el CHECK de la tabla abortaría el LOTE ENTERO de
 * 2.000 filas y la sincronización no podría avanzar nunca.
 */

import { describe, expect, it } from "vitest"

import { parsearVentanaCsv } from "@/lib/lugares/csv"
import {
  COLUMNAS_REFES,
  ErrorFormatoRefes,
  filaAcentro,
  verificarEncabezado,
} from "@/lib/lugares/refes"

const CRLF = "\r\n"

function unaFila(linea: string): string[] {
  const { filas } = parsearVentanaCsv(`${linea}${CRLF}`)
  return filas[0]
}

const CLINICA_SAN_JORGE =
  '"10940142395005",CLINICA SAN JORGE,"94014020000",USHUAIA,"94",TIERRA DEL FUEGO,"014",USHUAIA,"020","000",Privado,10,ESCIG,Alto riesgo con terapia intensiva,"9410",ONACHAGA 184,www.sanatoriosanjorge.com.ar,-68.3260344,-54.8153261'

/** Latitud y longitud sin punto decimal: -6832151 / -5480592. Fila real de Ushuaia. */
const COORDENADAS_ROTAS =
  '"50940142395535",CONSULTORIO DE ESTETICA DENTAL,"94014020000",USHUAIA,"94",TIERRA DEL FUEGO,"014",USHUAIA,"020","000",Privado,50,ESSIDT,Con atención médica general por lo menos 3 días de la semana,"9410",Monseñor Fagnano Nº 343,,-6832151,-5480592'

/** La columna `latitud` trae un DOMICILIO. Fila real de General Alvear, Mendoza. */
const LATITUD_CON_TEXTO =
  '"51500142361402",CALELLA BIOQUIMICA.-,"50014030000",GENERAL ALVEAR,"50",MENDOZA,"014",GENERAL ALVEAR,"030","000",Privado,51,ESSID,Laboratorio de Análisis Clínicos,"5620",INDEPENDENCIA 151,,,INDEPENDENCIA 151'

/** Sin ninguna coordenada. Fila real de Río Grande. */
const SIN_COORDENADAS =
  '"52940072395807",GABINETE DE KINESIOLOGIA  ANA ANDREA VESTIDELLI,"94007010000",RIO GRANDE,"94",TIERRA DEL FUEGO,"007",RÍO GRANDE,"010","000",Privado,52,ESSIT,Centro Rehabilitación motora,"9420",JORGE LUIS BORGES Nº35,,,'

const ENCABEZADO_REAL =
  '"establecimiento_id","establecimiento_nombre","localidad_id","localidad_nombre","provincia_id","provincia_nombre","departamento_id","departamento_nombre","codloc","codent","origen_financiamiento","tipologia_id","tipologia_sigla","tipologia_nombre","cp","domicilio","sitio_web","longitud","latitud"'

describe("verificarEncabezado", () => {
  it("acepta el encabezado real del CSV vigente", () => {
    expect(() => verificarEncabezado(unaFila(ENCABEZADO_REAL))).not.toThrow()
  })

  it("acepta el encabezado con otras mayúsculas o espacios de borde", () => {
    expect(() =>
      verificarEncabezado(COLUMNAS_REFES.map((columna) => ` ${columna.toUpperCase()} `)),
    ).not.toThrow()
  })

  it("rechaza un encabezado con distinta cantidad de columnas", () => {
    expect(() => verificarEncabezado(COLUMNAS_REFES.slice(0, 18))).toThrow(ErrorFormatoRefes)
  })

  it("rechaza un encabezado con las columnas REORDENADAS", () => {
    // El caso peligroso de verdad: mismo número de columnas, otro orden. Sin
    // esta verificación se cargarían 36.000 filas con la longitud en el campo
    // de latitud y el domicilio en el de sitio web, en silencio.
    const invertidas = [...COLUMNAS_REFES]
    ;[invertidas[17], invertidas[18]] = [invertidas[18], invertidas[17]]

    expect(() => verificarEncabezado(invertidas)).toThrow(/columna 18/)
  })

  it("el mensaje de error nombra la columna esperada y la recibida", () => {
    const cambiada: string[] = [...COLUMNAS_REFES]
    cambiada[1] = "nombre_establecimiento"

    expect(() => verificarEncabezado(cambiada)).toThrow(/establecimiento_nombre/)
  })
})

describe("filaAcentro", () => {
  it("traduce una fila real completa, con provincia normalizada", () => {
    const centro = filaAcentro(unaFila(CLINICA_SAN_JORGE))

    expect(centro).not.toBeNull()
    expect(centro!.refes_id).toBe("10940142395005")
    expect(centro!.name).toBe("CLINICA SAN JORGE")
    expect(centro!.typology_id).toBe(10)
    expect(centro!.typology_code).toBe("ESCIG")
    expect(centro!.typology_name).toBe("Alto riesgo con terapia intensiva")
    expect(centro!.funding_origin).toBe("Privado")
    expect(centro!.locality_name).toBe("USHUAIA")
    expect(centro!.department_name).toBe("USHUAIA")
    expect(centro!.postal_code).toBe("9410")
    expect(centro!.address).toBe("ONACHAGA 184")
    expect(centro!.website).toBe("www.sanatoriosanjorge.com.ar")
    // El REFES dice "TIERRA DEL FUEGO"; la base exige el nombre completo.
    expect(centro!.province_refes).toBe("TIERRA DEL FUEGO")
    expect(centro!.province).toBe("Tierra del Fuego, Antártida e Islas del Atlántico Sur")
  })

  it("recorta las coordenadas a 6 decimales, que es la escala de numeric(9,6)", () => {
    const centro = filaAcentro(unaFila(CLINICA_SAN_JORGE))!

    expect(centro.longitude).toBe(-68.326034)
    expect(centro.latitude).toBe(-54.815326)
  })

  it("descarta las coordenadas fuera de rango en vez de romper el lote entero", () => {
    const centro = filaAcentro(unaFila(COORDENADAS_ROTAS))!

    expect(centro.refes_id).toBe("50940142395535")
    expect(centro.latitude).toBeNull()
    expect(centro.longitude).toBeNull()
    // El resto de la fila se guarda igual: el centro existe, lo que no
    // existe es su ubicación en el mapa.
    expect(centro.name).toBe("CONSULTORIO DE ESTETICA DENTAL")
    expect(centro.address).toBe("Monseñor Fagnano Nº 343")
  })

  it("descarta una coordenada que no es un número (la fuente trae un domicilio en `latitud`)", () => {
    const centro = filaAcentro(unaFila(LATITUD_CON_TEXTO))!

    expect(centro.latitude).toBeNull()
    expect(centro.longitude).toBeNull()
    expect(centro.name).toBe("CALELLA BIOQUIMICA.-")
  })

  it("anula LAS DOS coordenadas si falta una sola (CHECK health_centers_coordenadas_completas)", () => {
    const centro = filaAcentro(unaFila(SIN_COORDENADAS))!

    expect(centro.latitude).toBeNull()
    expect(centro.longitude).toBeNull()
  })

  it("convierte en null los campos vacíos, no en cadena vacía", () => {
    const centro = filaAcentro(unaFila(SIN_COORDENADAS))!

    expect(centro.website).toBeNull()
  })

  it("arma search_text con nombre + localidad + departamento + provincia, normalizado", () => {
    const centro = filaAcentro(unaFila(CLINICA_SAN_JORGE))!

    expect(centro.search_text).toBe("clinica san jorge ushuaia ushuaia tierra del fuego")
    // El DOMICILIO queda fuera a propósito: "51" o "san martín" son nombres
    // de calle en media Argentina y convertirían la búsqueda en ruido.
    expect(centro.search_text).not.toContain("onachaga")
  })

  it("arma locality_search solo con la localidad", () => {
    const centro = filaAcentro(unaFila(CLINICA_SAN_JORGE))!

    expect(centro.locality_search).toBe("ushuaia")
  })

  it("devuelve null ante una fila sin id o sin nombre, sin lanzar", () => {
    // Una fila rota de la fuente no puede hacer fracasar las otras 36.045.
    const sinId = [...unaFila(CLINICA_SAN_JORGE)]
    sinId[0] = ""
    expect(filaAcentro(sinId)).toBeNull()

    const sinNombre = [...unaFila(CLINICA_SAN_JORGE)]
    sinNombre[1] = "   "
    expect(filaAcentro(sinNombre)).toBeNull()
  })

  it("devuelve null ante una fila con la cantidad de columnas equivocada", () => {
    expect(filaAcentro(["solo", "tres", "campos"])).toBeNull()
  })

  it("deja typology_id en null si no es un número entero", () => {
    const rara = [...unaFila(CLINICA_SAN_JORGE)]
    rara[11] = "ESCIG"

    expect(filaAcentro(rara)!.typology_id).toBeNull()
  })
})
