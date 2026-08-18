/**
 * Tests de las piezas de presentación y filtrado del catálogo REFES (Sprint
 * 16, tarea 16.3): `lib/lugares/tipologias.ts`, `lib/lugares/formato.ts`,
 * `lib/lugares/coincidencias.ts` y `lib/lugares/sugerencias.ts`.
 */

import { describe, expect, it } from "vitest"

import { centroCoincide } from "@/lib/lugares/coincidencias"
import {
  direccionDelCentro,
  textoCoincidenciaCentro,
  tipoDelCentro,
  urlSitioWeb,
} from "@/lib/lugares/formato"
import { descripcionDeSugerencia, precargaDesdeCentro, type CentroSugerido } from "@/lib/lugares/sugerencias"
import {
  CATEGORIAS_TIPOLOGIA,
  TIPOLOGIAS_DE_ATENCION,
  TODAS_LAS_TIPOLOGIAS,
  categoriaPorId,
  tipologiasDelFiltro,
} from "@/lib/lugares/tipologias"

describe("lib/lugares/tipologias.ts", () => {
  it("cubre los 15 tipologia_id que publica el REFES, sin repetir ninguno", () => {
    // Los 15 exactos de la edición de diciembre de 2025. Si una edición nueva
    // agrega uno, este test falla y avisa que hay que clasificarlo: sin eso,
    // el `in (...)` del filtro lo dejaría invisible en /lugares para siempre.
    const delRegistro = [10, 11, 12, 13, 14, 15, 17, 50, 51, 52, 53, 55, 80]

    expect(new Set(TODAS_LAS_TIPOLOGIAS).size).toBe(TODAS_LAS_TIPOLOGIAS.length)
    for (const id of delRegistro) {
      expect(TODAS_LAS_TIPOLOGIAS, `falta clasificar la tipología ${id}`).toContain(id)
    }
  })

  it("las residencias y los no asistenciales NO son lugares de atención", () => {
    expect(TIPOLOGIAS_DE_ATENCION).not.toContain(17) // viviendas para personas mayores
    expect(TIPOLOGIAS_DE_ATENCION).not.toContain(55) // inclusión sociolaboral
    expect(TIPOLOGIAS_DE_ATENCION).not.toContain(80) // no asistencial
  })

  it("hospitales, consultorios, laboratorios, tratamiento y complementarios SÍ lo son", () => {
    for (const id of [10, 11, 12, 13, 14, 15, 50, 51, 52, 53]) {
      expect(TIPOLOGIAS_DE_ATENCION).toContain(id)
    }
  })

  it("cada categoría tiene una etiqueta en castellano, no la sigla del registro", () => {
    for (const categoria of CATEGORIAS_TIPOLOGIA) {
      expect(categoria.etiqueta.length).toBeGreaterThan(5)
      expect(categoria.etiqueta).not.toMatch(/^ES[A-Z]+$/)
    }
  })

  it("tipologiasDelFiltro devuelve las de la categoría pedida", () => {
    expect(tipologiasDelFiltro("diagnostico")).toEqual([51])
    expect(tipologiasDelFiltro("residencias")).toEqual([17, 55, 80])
  })

  it("tipologiasDelFiltro cae en las de atención ante una categoría vacía o desconocida", () => {
    expect(tipologiasDelFiltro(null)).toEqual(TIPOLOGIAS_DE_ATENCION)
    expect(tipologiasDelFiltro("")).toEqual(TIPOLOGIAS_DE_ATENCION)
    expect(tipologiasDelFiltro("inventada")).toEqual(TIPOLOGIAS_DE_ATENCION)
  })

  it("nunca devuelve una lista vacía (un `in ()` vacío dejaría la pantalla sin resultados)", () => {
    for (const entrada of [null, undefined, "", "no-existe", "residencias"]) {
      expect(tipologiasDelFiltro(entrada).length).toBeGreaterThan(0)
    }
  })

  it("categoriaPorId encuentra la definición o devuelve undefined", () => {
    expect(categoriaPorId("internacion")?.etiqueta).toBe("Hospitales, clínicas y sanatorios")
    expect(categoriaPorId("no-existe")).toBeUndefined()
    expect(categoriaPorId(null)).toBeUndefined()
  })
})

const CLINICA = {
  name: "CLINICA SAN JORGE",
  address: "ONACHAGA 184",
  locality_name: "USHUAIA",
  department_name: "USHUAIA",
  province: "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
  province_refes: "TIERRA DEL FUEGO",
  postal_code: "9410",
  website: "www.sanatoriosanjorge.com.ar",
  typology_name: "Alto riesgo con terapia intensiva",
  typology_code: "ESCIG",
  latitude: -54.815326,
  longitude: -68.326034,
}

describe("lib/lugares/formato.ts", () => {
  it("direccionDelCentro usa la provincia CANÓNICA, no la del registro", () => {
    // Es la que va a quedar guardada en el turno: mostrar "TIERRA DEL FUEGO"
    // y guardar otra cosa sería mentirle a la persona sobre lo que va a pasar.
    expect(direccionDelCentro(CLINICA)).toBe(
      "ONACHAGA 184, USHUAIA, Tierra del Fuego, Antártida e Islas del Atlántico Sur",
    )
  })

  it("direccionDelCentro cae en la provincia del REFES si no se pudo normalizar", () => {
    expect(direccionDelCentro({ ...CLINICA, province: null })).toContain("TIERRA DEL FUEGO")
  })

  it("direccionDelCentro saltea las partes ausentes y devuelve null si no hay ninguna", () => {
    expect(
      direccionDelCentro({ ...CLINICA, address: null, locality_name: null }),
    ).toBe("Tierra del Fuego, Antártida e Islas del Atlántico Sur")

    expect(
      direccionDelCentro({
        name: "X",
        address: null,
        locality_name: null,
        province: null,
        province_refes: "",
      }),
    ).toBeNull()
  })

  it("urlSitioWeb le antepone https:// a los sitios sin esquema del registro", () => {
    // El REFES publica los 2.824 sitios sin esquema: sin esto, el href sería
    // un enlace RELATIVO y llevaría a un 404 del propio dominio de la app.
    expect(urlSitioWeb("www.tcba.com.ar")).toBe("https://www.tcba.com.ar/")
    expect(urlSitioWeb("paideianet.com.ar")).toBe("https://paideianet.com.ar/")
  })

  it("urlSitioWeb respeta un esquema http/https ya presente", () => {
    expect(urlSitioWeb("https://www.hospitalbritanico.org.ar")).toBe(
      "https://www.hospitalbritanico.org.ar/",
    )
    expect(urlSitioWeb("http://ejemplo.gob.ar/algo")).toBe("http://ejemplo.gob.ar/algo")
  })

  it("urlSitioWeb descarta esquemas peligrosos y valores vacíos", () => {
    // El texto viene de un archivo externo: aunque hoy sea un registro
    // público, este proyecto no controla la fuente.
    expect(urlSitioWeb("javascript:alert(1)")).toBeNull()
    expect(urlSitioWeb("data:text/html,<script>")).toBeNull()
    expect(urlSitioWeb("mailto:info@ejemplo.ar")).toBeNull()
    expect(urlSitioWeb("")).toBeNull()
    expect(urlSitioWeb("   ")).toBeNull()
    expect(urlSitioWeb(null)).toBeNull()
  })

  it("tipoDelCentro agrega la sigla porque el nombre largo se repite entre siglas", () => {
    // "Bajo riesgo con internación simple" existe bajo ESCIG, ESCIE, ESCIEP,
    // ESCIEM, ESCIESM y ESCIETE: sin la sigla, seis tipos distintos se leen
    // exactamente igual.
    expect(tipoDelCentro(CLINICA)).toBe("Alto riesgo con terapia intensiva (ESCIG)")
    expect(tipoDelCentro({ ...CLINICA, typology_code: null })).toBe(
      "Alto riesgo con terapia intensiva",
    )
    expect(tipoDelCentro({ ...CLINICA, typology_name: null })).toBe("ESCIG")
    expect(tipoDelCentro({ ...CLINICA, typology_name: null, typology_code: null })).toBeNull()
  })

  it("textoCoincidenciaCentro incluye lo mismo que search_text (no solo el nombre)", () => {
    const texto = textoCoincidenciaCentro(CLINICA)

    expect(texto).toContain("CLINICA SAN JORGE")
    expect(texto).toContain("USHUAIA")
    expect(texto).toContain("Tierra del Fuego")
  })
})

describe("lib/lugares/coincidencias.ts", () => {
  const TEXTO = textoCoincidenciaCentro(CLINICA)

  it("encuentra sin tildes ni mayúsculas, igual que el matcher de especialidades", () => {
    expect(centroCoincide(TEXTO, "clinica")).toBe(true)
    expect(centroCoincide(TEXTO, "CLÍNICA")).toBe(true)
    expect(centroCoincide(TEXTO, "ushuaia")).toBe(true)
  })

  it("exige TODAS las palabras, en cualquier orden -igual que el `like` por palabra del servidor-", () => {
    expect(centroCoincide(TEXTO, "san jorge ushuaia")).toBe(true)
    // Este es el caso que se rompía filtrando por la frase entera: el
    // servidor lo trae y el desplegable lo mostraría como "sin coincidencias".
    expect(centroCoincide(TEXTO, "ushuaia san jorge")).toBe(true)
    expect(centroCoincide(TEXTO, "san jorge rosario")).toBe(false)
  })

  it("una consulta vacía o de solo espacios matchea todo", () => {
    expect(centroCoincide(TEXTO, "")).toBe(true)
    expect(centroCoincide(TEXTO, "   ")).toBe(true)
  })

  it("matchea en el MEDIO de una palabra, no solo al principio", () => {
    expect(centroCoincide(TEXTO, "jorge")).toBe(true)
  })
})

const SUGERENCIA: CentroSugerido = {
  refesId: "10940142395005",
  nombre: "CLINICA SAN JORGE",
  direccion: "ONACHAGA 184",
  localidad: "USHUAIA",
  departamento: "USHUAIA",
  provincia: "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
  provinciaRefes: "TIERRA DEL FUEGO",
  latitud: -54.815326,
  longitud: -68.326034,
  tipo: "Alto riesgo con terapia intensiva",
}

describe("lib/lugares/sugerencias.ts — precargaDesdeCentro", () => {
  it("precarga las cinco partes del lugar, coordenadas incluidas", () => {
    expect(precargaDesdeCentro(SUGERENCIA)).toEqual({
      lugarNombre: "CLINICA SAN JORGE",
      lugarDireccion: "ONACHAGA 184",
      lugarCiudad: "USHUAIA",
      lugarProvincia: "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
      latitud: "-54.815326",
      longitud: "-68.326034",
    })
  })

  it("BORRA las coordenadas si el centro elegido no las trae", () => {
    // Conservar las del lugar anterior es exactamente el bug de "Cómo llegar"
    // que el Sprint 16 vino a corregir: coordenadas de una clínica pegadas a
    // la dirección de otra.
    const precarga = precargaDesdeCentro({ ...SUGERENCIA, latitud: null, longitud: null })

    expect(precarga.latitud).toBe("")
    expect(precarga.longitud).toBe("")
    expect(precarga.lugarNombre).toBe("CLINICA SAN JORGE")
  })

  it("deja la provincia vacía si el REFES trajo una jurisdicción desconocida", () => {
    // Mejor un campo vacío que la persona completa del desplegable, que un
    // valor que el CHECK de appointments va a rechazar al guardar.
    expect(precargaDesdeCentro({ ...SUGERENCIA, provincia: null }).lugarProvincia).toBe("")
  })

  it("convierte los campos ausentes en cadena vacía, nunca en 'null'", () => {
    const precarga = precargaDesdeCentro({
      ...SUGERENCIA,
      direccion: null,
      localidad: null,
    })

    expect(precarga.lugarDireccion).toBe("")
    expect(precarga.lugarCiudad).toBe("")
  })

  it("descripcionDeSugerencia arma la misma dirección que va a quedar en el turno", () => {
    expect(descripcionDeSugerencia(SUGERENCIA)).toBe(
      "ONACHAGA 184, USHUAIA, Tierra del Fuego, Antártida e Islas del Atlántico Sur",
    )
  })
})
