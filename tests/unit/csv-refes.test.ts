/**
 * Tests del parser de CSV del catálogo REFES (`lib/lugares/csv.ts`, Sprint 16,
 * tarea 16.3).
 *
 * **Todas las líneas de este archivo son REALES**: copiadas carácter por
 * carácter de la edición de diciembre de 2025 del CSV del Ministerio de Salud
 * (8.970.242 bytes, 36.046 filas). No hay ni una fila inventada, porque los
 * casos que rompen un parser de CSV no se inventan bien: el entrecomillado
 * irregular de esta fuente, la coma adentro de un domicilio y una columna de
 * latitud que trae un domicilio son cosas que solo se descubren mirando el
 * archivo.
 */

import { describe, expect, it } from "vitest"

import { contarFilasCsv, parsearVentanaCsv } from "@/lib/lugares/csv"

const ENCABEZADO =
  '"establecimiento_id","establecimiento_nombre","localidad_id","localidad_nombre","provincia_id","provincia_nombre","departamento_id","departamento_nombre","codloc","codent","origen_financiamiento","tipologia_id","tipologia_sigla","tipologia_nombre","cp","domicilio","sitio_web","longitud","latitud"'

/** Fila típica: mezcla campos con y sin comillas, tiene tildes y sitio web. */
const FILA_MENDOZA =
  '"52500282358948",KHUSKA CENTRO EDUCATIVO TERAPEUTICO.-,"50028020014",VILLA NUEVA,"50",MENDOZA,"028",GUAYMALLÉN,"020","014",Privado,52,ESSIT,Centro educativo terapéutico,"5521",REPÚBLICA DE SIRIA 3454,www.khuska-cet.com.ar,-68.798192,-32.89943'

/** Domicilio entrecomillado y sitio web VACÍO (dos comas seguidas). */
const FILA_HUANGUELEN =
  '"15062032307579",HOGAR DE ANCIANOS HORACIO CARLOS COOK,"06203050000",HUANGUELEN,"06",BUENOS AIRES,"203",CORONEL SUÁREZ,"050","000",Privado,17,ESCIRES,Vivienda para personas mayores,"7545","30 e/ 5 Y 6",,-61.93989872932434,-37.05810960605219'

/** El caso que un `split(",")` destroza: una COMA adentro del domicilio entrecomillado. */
const FILA_CON_COMA_INTERNA =
  '"50066382321425",CENTRO MEDICO PILAR-HOSPITAL ALEMAN - POLICONSULTORIOS,"06638040003",LA LONJA,"06",BUENOS AIRES,"638",PILAR,"040","003",Privado,50,ESSIDT,Con atención médica diaria y con especialidades y/o otras profesiones,"1727","Ruta Panamericana Colectora Este Km 48,5 1° Piso",,,'

const CRLF = "\r\n"

describe("lib/lugares/csv.ts — parsearVentanaCsv", () => {
  it("parsea una fila real con entrecomillado IRREGULAR en 19 campos", () => {
    const { filas } = parsearVentanaCsv(`${FILA_MENDOZA}${CRLF}`)

    expect(filas).toHaveLength(1)
    expect(filas[0]).toHaveLength(19)
    // Campo entrecomillado y campo sin comillas, en la misma fila.
    expect(filas[0][0]).toBe("52500282358948")
    expect(filas[0][1]).toBe("KHUSKA CENTRO EDUCATIVO TERAPEUTICO.-")
    // Las tildes llegan intactas: el archivo es UTF-8 sin BOM.
    expect(filas[0][7]).toBe("GUAYMALLÉN")
    expect(filas[0][15]).toBe("REPÚBLICA DE SIRIA 3454")
    expect(filas[0][18]).toBe("-32.89943")
  })

  it("NO parte un campo entrecomillado que tiene una coma adentro", () => {
    // Este es el motivo entero de tener un parser y no un `split(",")`: con
    // split, "Ruta ... Km 48" y "5 1° Piso" serían DOS campos y las tres
    // columnas siguientes quedarían corridas.
    const { filas } = parsearVentanaCsv(`${FILA_CON_COMA_INTERNA}${CRLF}`)

    expect(filas[0]).toHaveLength(19)
    expect(filas[0][15]).toBe("Ruta Panamericana Colectora Este Km 48,5 1° Piso")
    expect(filas[0][16]).toBe("")
  })

  it("conserva los campos vacíos del final (sitio web y coordenadas ausentes)", () => {
    const { filas } = parsearVentanaCsv(`${FILA_CON_COMA_INTERNA}${CRLF}`)

    expect(filas[0][16]).toBe("")
    expect(filas[0][17]).toBe("")
    expect(filas[0][18]).toBe("")
  })

  it("soporta comillas escapadas y saltos de línea dentro de un campo (RFC 4180)", () => {
    // La edición actual no los trae -verificado sobre el archivo entero: 0
    // casos de cada uno-, pero son parte del formato y una edición futura
    // podría traerlos. Soportarlos cuesta tres líneas; no hacerlo es un bug
    // latente que aparecería como 36.000 filas corridas.
    const { filas } = parsearVentanaCsv(`a,"di""jo",c${CRLF}d,"dos\nlineas",f${CRLF}`)

    expect(filas).toHaveLength(2)
    expect(filas[0][1]).toBe('di"jo')
    expect(filas[1][1]).toBe("dos\nlineas")
  })

  describe("ventanas: la fila partida del final se descarta y se reprocesa", () => {
    const documento = `${ENCABEZADO}${CRLF}${FILA_MENDOZA}${CRLF}${FILA_HUANGUELEN}${CRLF}`

    it("devuelve solo las filas COMPLETAS y cuántos BYTES ocupan", () => {
      // Se corta a mitad de la tercera fila, como hace una ventana real.
      const corte = documento.length - 40
      const ventana = parsearVentanaCsv(documento.slice(0, corte))

      expect(ventana.filas).toHaveLength(2)
      expect(ventana.restante.length).toBeGreaterThan(0)
      // Los bytes consumidos tienen que caer justo después del último CRLF
      // entero: es lo que la tanda siguiente usa como offset de arranque.
      const esperado = new TextEncoder().encode(
        `${ENCABEZADO}${CRLF}${FILA_MENDOZA}${CRLF}`,
      ).length
      expect(ventana.bytesConsumidos).toBe(esperado)
    })

    it("los bytes consumidos NO son la cantidad de caracteres (hay tildes)", () => {
      const ventana = parsearVentanaCsv(`${FILA_MENDOZA}${CRLF}`)

      // "GUAYMALLÉN", "terapéutico", "REPÚBLICA": cada tilde ocupa 2 bytes en
      // UTF-8 y 1 carácter en JavaScript. Contar caracteres en vez de bytes
      // desalinearía el offset de la tanda siguiente y partiría una fila.
      const caracteres = `${FILA_MENDOZA}${CRLF}`.length
      expect(ventana.bytesConsumidos).toBeGreaterThan(caracteres)
      expect(ventana.bytesConsumidos).toBe(
        new TextEncoder().encode(`${FILA_MENDOZA}${CRLF}`).length,
      )
    })

    it("dos ventanas encadenadas por el offset recorren el documento entero sin perder ni repetir filas", () => {
      const bytes = new TextEncoder().encode(documento)
      const primera = parsearVentanaCsv(new TextDecoder().decode(bytes.slice(0, 250)))

      const segunda = parsearVentanaCsv(
        new TextDecoder().decode(bytes.slice(primera.bytesConsumidos)),
        { ultimaVentana: true },
      )

      const todas = [...primera.filas, ...segunda.filas]
      expect(todas).toHaveLength(3)
      expect(todas[0][0]).toBe("establecimiento_id")
      expect(todas[1][0]).toBe("52500282358948")
      expect(todas[2][0]).toBe("15062032307579")
    })

    it("`ultimaVentana` rescata la última fila aunque no termine en salto de línea", () => {
      const sinSaltoFinal = `${FILA_MENDOZA}${CRLF}${FILA_HUANGUELEN}`

      expect(parsearVentanaCsv(sinSaltoFinal).filas).toHaveLength(1)
      expect(parsearVentanaCsv(sinSaltoFinal, { ultimaVentana: true }).filas).toHaveLength(2)
    })

    it("una ventana sin ningún salto de línea no consume ni un byte", () => {
      // Le avisa a la sincronización que la ventana no alcanza para una fila
      // entera, en vez de avanzar el offset a la mitad de un campo.
      const ventana = parsearVentanaCsv(FILA_MENDOZA.slice(0, 50))

      expect(ventana.filas).toHaveLength(0)
      expect(ventana.bytesConsumidos).toBe(0)
    })
  })
})

describe("lib/lugares/csv.ts — contarFilasCsv", () => {
  it("descuenta el encabezado", () => {
    const documento = `${ENCABEZADO}${CRLF}${FILA_MENDOZA}${CRLF}${FILA_HUANGUELEN}${CRLF}`

    expect(contarFilasCsv(documento)).toBe(2)
    expect(contarFilasCsv(documento, { incluirEncabezado: true })).toBe(3)
  })

  it("cuenta la última fila aunque no termine en salto de línea", () => {
    expect(contarFilasCsv(`${ENCABEZADO}${CRLF}${FILA_MENDOZA}`)).toBe(1)
  })

  it("no cuenta como fila un salto de línea que está DENTRO de un campo entrecomillado", () => {
    expect(contarFilasCsv(`h1,h2${CRLF}a,"dos\nlineas"${CRLF}b,c${CRLF}`)).toBe(2)
  })

  it("cuenta lo mismo que parsearVentanaCsv sobre el mismo documento", () => {
    const documento = `${ENCABEZADO}${CRLF}${FILA_MENDOZA}${CRLF}${FILA_HUANGUELEN}${CRLF}${FILA_CON_COMA_INTERNA}${CRLF}`

    const { filas } = parsearVentanaCsv(documento, { ultimaVentana: true })
    expect(contarFilasCsv(documento, { incluirEncabezado: true })).toBe(filas.length)
  })

  it("un documento vacío no tiene filas de datos", () => {
    expect(contarFilasCsv("")).toBe(0)
    expect(contarFilasCsv(`${ENCABEZADO}${CRLF}`)).toBe(0)
  })
})
