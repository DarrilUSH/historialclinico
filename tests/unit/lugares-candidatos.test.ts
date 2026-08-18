/**
 * Test del cruce "¿es este lugar del catálogo REFES?" (`lib/lugares/candidatos.ts`)
 * — cruces inteligentes, agosto 2026.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import { elegirCandidatosLugar, tokensDeBusquedaLugar } from "@/lib/lugares/candidatos"
import type { CentroSugerido } from "@/lib/lugares/sugerencias"

const TDF = "Tierra del Fuego, Antártida e Islas del Atlántico Sur"

function centro(datos: Partial<CentroSugerido> & { refesId: string; nombre: string }): CentroSugerido {
  return {
    direccion: null,
    localidad: null,
    departamento: null,
    provincia: null,
    provinciaRefes: "",
    latitud: null,
    longitud: null,
    tipo: null,
    ...datos,
  }
}

describe("tokensDeBusquedaLugar", () => {
  it("descarta palabras de menos de 3 caracteres (no discriminan nada)", () => {
    expect(tokensDeBusquedaLugar({ nombre: "ANEXO DR JORGE SAGARDIA" })).toEqual(
      expect.arrayContaining(["anexo", "jorge", "sagardia"]),
    )
    expect(tokensDeBusquedaLugar({ nombre: "ANEXO DR JORGE SAGARDIA" })).not.toContain("dr")
  })

  it("suma tokens de la dirección y descarta 'de'/'la'", () => {
    const tokens = tokensDeBusquedaLugar({ nombre: "", direccion: "DE LA ESTANCIA 1955" })
    expect(tokens).toEqual(expect.arrayContaining(["estancia", "1955"]))
    expect(tokens).not.toContain("de")
    expect(tokens).not.toContain("la")
  })

  it("sin ningún token válido, devuelve lista vacía", () => {
    expect(tokensDeBusquedaLugar({ nombre: "de la y el" })).toEqual([])
  })
})

describe("elegirCandidatosLugar — caso real: mensaje de la Clínica San Jorge (fixture 16.4)", () => {
  // Mismos cinco establecimientos "San Jorge" del seed real
  // (`supabase/seed.sql`), recortados a lo que importa acá.
  const centroUshuaiaSinDireccionUtil = centro({
    refesId: "clinica-san-jorge",
    nombre: "CLINICA SAN JORGE",
    direccion: "ONACHAGA 184",
    localidad: "USHUAIA",
    departamento: "USHUAIA",
    provincia: TDF,
  })
  const centroConDireccionExacta = centro({
    refesId: "centro-medico-clinica-san-jorge",
    nombre: "CENTRO MEDICO CLINICA SAN JORGE",
    direccion: "DE LA ESTANCIA Nº 1955",
    localidad: "USHUAIA",
    departamento: "USHUAIA",
    provincia: TDF,
  })
  const centroAnexoHomonimoParcial = centro({
    refesId: "consultorios-anexos-san-jorge",
    nombre: "CONSULTORIOS EXTERNOS ANEXOS SANATORIO SAN JORGE",
    direccion: "Jainen N° 133",
    localidad: "USHUAIA",
    departamento: "USHUAIA",
    provincia: TDF,
  })
  const centroLaPlataHomonimo = centro({
    refesId: "san-jorge-la-plata",
    nombre: "CLINICA SAN JORGE NEUROPSIQUIATRICA S.A.",
    direccion: "Avenida 7 124",
    localidad: "LA PLATA",
    departamento: "LA PLATA",
    provincia: "Buenos Aires",
  })
  const centroParanaHomonimo = centro({
    refesId: "geriatrico-san-jorge-parana",
    nombre: "GERIATRICO SAN JORGE II",
    direccion: "PRESIDENTE PERON 670",
    localidad: "PARANA",
    departamento: "PARANA",
    provincia: "Entre Ríos",
  })

  const candidatos = [
    centroUshuaiaSinDireccionUtil,
    centroConDireccionExacta,
    centroAnexoHomonimoParcial,
    centroLaPlataHomonimo,
    centroParanaHomonimo,
  ]

  it("sin ciudad/provincia extraída, la DIRECCIÓN alcanza para desambiguar sin dudas", () => {
    // El mensaje no menciona la ciudad en ningún campo estructurado: la única
    // pista fuerte es "DE LA ESTANCIA 1955", que coincide casi literal con
    // UN SOLO establecimiento entre los cinco homónimos de "San Jorge".
    const resultado = elegirCandidatosLugar(
      { nombre: "ANEXO DR JORGE SAGARDIA", direccion: "DE LA ESTANCIA 1955", ciudad: "", provincia: "" },
      candidatos,
    )

    expect(resultado.tipo).toBe("uno")
    expect(resultado.tipo === "uno" && resultado.centro.refesId).toBe("centro-medico-clinica-san-jorge")
  })
})

describe("elegirCandidatosLugar — umbral de ambigüedad", () => {
  const sanJorgeUshuaia = centro({
    refesId: "ushuaia",
    nombre: "Clínica San Jorge",
    direccion: "Onachaga 184",
    localidad: "Ushuaia",
    departamento: "Ushuaia",
    provincia: TDF,
  })
  const sanJorgeRosario = centro({
    refesId: "rosario",
    nombre: "Clínica San Jorge",
    direccion: "Av. Pellegrini 100",
    localidad: "Rosario",
    departamento: "Rosario",
    provincia: "Santa Fe",
  })

  it("matcher geográfico: 'San Jorge' + Ushuaia gana sobre homónimos de otra provincia", () => {
    const resultado = elegirCandidatosLugar(
      { nombre: "Clínica San Jorge", direccion: "", ciudad: "Ushuaia", provincia: TDF },
      [sanJorgeUshuaia, sanJorgeRosario],
    )

    expect(resultado.tipo).toBe("uno")
    expect(resultado.tipo === "uno" && resultado.centro.refesId).toBe("ushuaia")
  })

  it("sin geografía y 2 candidatos empatados en nombre → silencio", () => {
    const resultado = elegirCandidatosLugar(
      { nombre: "Clínica San Jorge", direccion: "", ciudad: "", provincia: "" },
      [sanJorgeUshuaia, sanJorgeRosario],
    )

    expect(resultado).toEqual({ tipo: "ninguno" })
  })

  it("con provincia extraída y 2-3 candidatos empatados en esa provincia → lista para elegir", () => {
    const sanJorgeRioGrande = centro({
      refesId: "rio-grande",
      nombre: "Clínica San Jorge",
      direccion: "otra calle",
      localidad: "Río Grande",
      departamento: "Río Grande",
      provincia: TDF,
    })

    const resultado = elegirCandidatosLugar(
      { nombre: "Clínica San Jorge", direccion: "", ciudad: "", provincia: TDF },
      [sanJorgeUshuaia, sanJorgeRosario, sanJorgeRioGrande],
    )

    expect(resultado.tipo).toBe("varios")
    if (resultado.tipo === "varios") {
      const ids = resultado.centros.map((c) => c.refesId).sort()
      expect(ids).toEqual(["rio-grande", "ushuaia"])
    }
  })

  it("más de 3 candidatos empatados, incluso con geografía, es demasiado ambiguo → silencio", () => {
    const provinciaCompartida = TDF
    const candidatos = ["a", "b", "c", "d"].map((letra) =>
      centro({
        refesId: letra,
        nombre: "Clínica San Jorge",
        localidad: `Localidad ${letra}`,
        provincia: provinciaCompartida,
      }),
    )

    const resultado = elegirCandidatosLugar(
      { nombre: "Clínica San Jorge", ciudad: "", provincia: provinciaCompartida },
      candidatos,
    )

    expect(resultado).toEqual({ tipo: "ninguno" })
  })

  it("sin ningún candidato con algún token en común, silencio", () => {
    const resultado = elegirCandidatosLugar(
      { nombre: "Hospital Regional de Ushuaia", ciudad: "", provincia: "" },
      [sanJorgeRosario],
    )

    expect(resultado).toEqual({ tipo: "ninguno" })
  })

  it("nombre extraído sin tokens significativos (solo texto corto/stopwords), silencio sin ni siquiera puntuar", () => {
    const resultado = elegirCandidatosLugar({ nombre: "de la", ciudad: "", provincia: "" }, [sanJorgeUshuaia])
    expect(resultado).toEqual({ tipo: "ninguno" })
  })
})
