/**
 * Test del saneamiento del número de orden (`lib/documentos/numero-orden.ts`),
 * Sprint 18.
 *
 * El campo `numero_orden` es la IDENTIDAD del estudio para la Capa 2 del
 * detector de duplicados. En los 47 documentos reales del dueño, el lector
 * puso ahí 15 números que no eran números de orden -accesiones DICOM, un N° de
 * internado- y el daño está medido: las cuatro vistas de una columna lumbar
 * comparten la accesión `11021738`, así que el sistema las habría marcado como
 * duplicadas entre sí.
 *
 * Este test corre contra el **banco sintético**
 * (`tests/fixtures/documentos-sinteticos/`), no contra los documentos del
 * dueño: son instituciones ficticias de otras provincias, con otros rótulos y
 * otros formatos, y ese es justamente el punto — si las reglas fueran un
 * ajuste al formato de San Jorge, acá se caerían.
 *
 *   npm run test -- numero-orden
 */

import { describe, expect, it } from "vitest"

import { sanearNumeroOrden } from "@/lib/documentos/numero-orden"
import { CASOS_SINTETICOS, caso } from "@/tests/fixtures/documentos-sinteticos/casos"

/** Sanea el número de orden de un caso del banco, con su categoría y su texto. */
function sanearDelCaso(id: string): string | null {
  const { extraccion } = caso(id)
  return sanearNumeroOrden(extraccion.numero_orden as string | undefined, {
    categoria: extraccion.categoria as "laboratory" | "imaging" | "consultation",
    textoDelDocumento: `${(extraccion.texto_completo as string) ?? ""} ${extraccion.resumen as string}`,
  })
}

/* ------------------------------------------------------------------ *
 *  Los números que SÍ son números de orden
 * ------------------------------------------------------------------ */

describe("números ACREDITADOS — sobreviven al saneamiento", () => {
  it('rótulo "Protocolo N°" impreso en el texto: el número se acredita (Bioquímico del Sur, ficticio)', () => {
    expect(sanearDelCaso("01-bioquimico-del-sur-protocolo")).toBe("24601")
  })

  it("orden alfanumérica con guion: se acredita por FORMA, sin necesidad de rótulo (Centro Vega, ficticio)", () => {
    // Ningún DNI, historia clínica ni accesión se imprime con guion entre
    // grupos. La forma sola ya descarta que sea un identificador de persona.
    expect(sanearDelCaso("02-centro-vega-orden-alfanumerica")).toBe("887-2026")
  })

  it("código con prefijo de letras: se acredita por FORMA (Hospital Zonal de Trelew, ficticio)", () => {
    expect(sanearDelCaso("03-hospital-zonal-solicitud")).toBe("OP-3391")
  })

  it('en IMÁGENES, un "N° de registro" rotulado en el texto SÍ se acredita (Imágenes del Litoral, ficticio)', () => {
    expect(sanearDelCaso("04-imagenes-vega-registro-dos-medicos")).toBe("R-2026-0447")
  })

  it("acepta el rótulo pegado al propio valor, y lo saca", () => {
    const contexto = { categoria: "laboratory" as const }
    expect(sanearNumeroOrden("N° de Orden: 1446188", contexto)).toBe("1446188")
    expect(sanearNumeroOrden("Protocolo 24601", contexto)).toBe("24601")
    expect(sanearNumeroOrden("Nro. de Solicitud 90210", contexto)).toBe("90210")
    expect(sanearNumeroOrden("REGISTRO N 4471", contexto)).toBe("4471")
  })

  it("el rótulo se reconoce sin tildes, sin mayúsculas y con puntuación de por medio", () => {
    const contexto = { categoria: "laboratory" as const }
    expect(sanearNumeroOrden("protocolo nro 24601", contexto)).toBe("24601")
    expect(sanearNumeroOrden("PROTOCOLO N°: 24601", contexto)).toBe("24601")
  })
})

/* ------------------------------------------------------------------ *
 *  Los 15 falsos del historial real, reproducidos con datos ficticios
 * ------------------------------------------------------------------ */

describe("números RECHAZADOS — la evidencia real de los 47 documentos", () => {
  it("accesión DICOM con sufijo de serie (`15570342.01`): se rechaza SIEMPRE", () => {
    expect(sanearDelCaso("05-radiografia-accesion-dicom")).toBeNull()
  })

  it("una accesión rotulada como orden SIGUE rechazándose: la forma manda sobre el rótulo", () => {
    // Si el documento la rotula mal, creerle sería importar el error tal cual.
    expect(
      sanearNumeroOrden("N° de Orden: 15570342.01", { categoria: "imaging" }),
    ).toBeNull()
    expect(
      sanearNumeroOrden("Protocolo 15569667.01", { categoria: "laboratory" }),
    ).toBeNull()
  })

  it("accesión sin sufijo y sin rótulo en un estudio de imágenes (`11021738`): se rechaza", () => {
    expect(sanearDelCaso("06-columna-lumbar-frente")).toBeNull()
    expect(sanearDelCaso("07-columna-lumbar-perfil")).toBeNull()
  })

  it("EL DAÑO MEDIDO — dos vistas del mismo estudio comparten la accesión y ninguna la conserva", () => {
    // Las cuatro vistas de la columna lumbar del historial real comparten
    // `11021738`. Si ese número sobreviviera, la Capa 2 las marcaría como
    // duplicadas entre sí y tres de las cuatro placas quedarían escondidas.
    const frente = sanearDelCaso("06-columna-lumbar-frente")
    const perfil = sanearDelCaso("07-columna-lumbar-perfil")
    expect(frente).toBeNull()
    expect(perfil).toBeNull()
  })

  it("N° de internación con relleno de ceros (`00176828`): se rechaza", () => {
    expect(sanearDelCaso("08-guardia-numero-de-internacion")).toBeNull()
  })

  it("número de serie del equipo (`88234512`): se rechaza", () => {
    expect(sanearDelCaso("09-ecografia-codigo-de-equipo")).toBeNull()
  })

  it("un rótulo AJENO en el texto tumba el número aunque la forma pase", () => {
    const contexto = { categoria: "consultation" as const }
    expect(
      sanearNumeroOrden("HC-88231", { ...contexto, textoDelDocumento: "Historia clínica HC 88231" }),
    ).toBeNull()
    expect(
      sanearNumeroOrden("A-1234", { ...contexto, textoDelDocumento: "N° de afiliado A 1234" }),
    ).toBeNull()
  })

  it("un rótulo AJENO pegado al valor tumba el número", () => {
    const contexto = { categoria: "consultation" as const }
    expect(sanearNumeroOrden("DNI: 28114902", contexto)).toBeNull()
    expect(sanearNumeroOrden("N° de Internación: 00176828", contexto)).toBeNull()
    expect(sanearNumeroOrden("ACC 11021738", contexto)).toBeNull()
    expect(sanearNumeroOrden("Equipo S/N 88234512", contexto)).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 *  La regla general: dígitos corridos sin rótulo, nunca
 * ------------------------------------------------------------------ */

describe("dígitos corridos sin rótulo — la regla general que no depende de ningún laboratorio", () => {
  it("una tira de dígitos sin rótulo se rechaza, tenga los dígitos que tenga", () => {
    const contexto = { categoria: "laboratory" as const }
    // 7 dígitos son exactamente la forma de un DNI argentino; 8 también, y
    // además la de una accesión. No hay manera honesta de distinguirlos.
    expect(sanearNumeroOrden("1446188", contexto)).toBeNull()
    expect(sanearNumeroOrden("28114902", contexto)).toBeNull()
    expect(sanearNumeroOrden("11021738", contexto)).toBeNull()
    expect(sanearNumeroOrden("24601", contexto)).toBeNull()
  })

  it("EL RIESGO QUE ESTO EVITA — un DNI tomado como orden haría que TODO el historial de esa persona en ese laboratorio se marcara como duplicado", () => {
    expect(sanearNumeroOrden("28114902", { categoria: "laboratory" })).toBeNull()
  })

  it("pero con el rótulo impreso, el mismo número sí se acredita", () => {
    expect(
      sanearNumeroOrden("1446188", {
        categoria: "laboratory",
        textoDelDocumento: "N° ORDEN 1446188 - Muestra recibida el 01/08/2026.",
      }),
    ).toBe("1446188")
  })

  it("en IMÁGENES ni la forma alcanza: sin rótulo explícito, nada pasa", () => {
    // El único número sin rótulo que hay a mano en una placa es el que el
    // equipo le quemó en el encabezado.
    expect(sanearNumeroOrden("AB-3391", { categoria: "imaging" })).toBeNull()
    expect(sanearNumeroOrden("R-2026-0447", { categoria: "imaging" })).toBeNull()
    expect(
      sanearNumeroOrden("R-2026-0447", {
        categoria: "imaging",
        textoDelDocumento: "N° de registro: R-2026-0447",
      }),
    ).toBe("R-2026-0447")
  })
})

/* ------------------------------------------------------------------ *
 *  Formas prohibidas y basura
 * ------------------------------------------------------------------ */

describe("formas que nunca son un número de orden", () => {
  const contexto = { categoria: "laboratory" as const }

  it("fechas", () => {
    expect(sanearNumeroOrden("02/05/2026", contexto)).toBeNull()
    expect(sanearNumeroOrden("2-5-26", contexto)).toBeNull()
    expect(sanearNumeroOrden("20260502", contexto)).toBeNull()
    expect(sanearNumeroOrden("Orden N° 02/05/2026", contexto)).toBeNull()
  })

  it("CUIT/CUIL, con y sin guiones", () => {
    expect(sanearNumeroOrden("20-28114902-3", contexto)).toBeNull()
    expect(sanearNumeroOrden("20281149023", contexto)).toBeNull()
  })

  it("un UID de estudio DICOM (dígitos y puntos)", () => {
    expect(sanearNumeroOrden("1.2.840.113619.2.55", contexto)).toBeNull()
  })

  it("texto sin ningún dígito", () => {
    expect(sanearNumeroOrden("SIN ORDEN", contexto)).toBeNull()
    expect(sanearNumeroOrden("---", contexto)).toBeNull()
  })

  it("vacío, espacios y ausencia", () => {
    expect(sanearNumeroOrden("", contexto)).toBeNull()
    expect(sanearNumeroOrden("   ", contexto)).toBeNull()
    expect(sanearNumeroOrden(undefined, contexto)).toBeNull()
    expect(sanearNumeroOrden(null, contexto)).toBeNull()
  })

  it("un valor más largo que el tope de la columna: se DESCARTA, no se recorta", () => {
    // Recortar un identificador lo convierte en OTRO identificador, y este
    // campo decide identidad. Es la excepción a la regla de "recortar y
    // seguir" del Sprint 18, y está declarada como tal.
    expect(sanearNumeroOrden("A".repeat(61), contexto)).toBeNull()
    expect(sanearNumeroOrden(`OP-${"9".repeat(70)}`, contexto)).toBeNull()
  })

  it("el documento que no trae ningún número: queda en null y no pasa nada", () => {
    expect(sanearDelCaso("10-informe-sin-numero-de-orden")).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 *  Cobertura del banco entero
 * ------------------------------------------------------------------ */

describe("el banco sintético completo", () => {
  it("ningún caso del banco produce un número que sea una accesión, una fecha o dígitos corridos sin rótulo", () => {
    for (const { id, extraccion } of CASOS_SINTETICOS) {
      const acreditado = sanearNumeroOrden(extraccion.numero_orden as string | undefined, {
        categoria: extraccion.categoria as "laboratory",
        textoDelDocumento: `${(extraccion.texto_completo as string) ?? ""} ${extraccion.resumen as string}`,
      })
      if (acreditado === null) continue

      expect(acreditado, `${id}: no puede ser una accesión DICOM`).not.toMatch(/^\d{6,}\.\d{1,2}$/)
      expect(acreditado, `${id}: no puede ser un CUIT`).not.toMatch(/^\d{2}-?\d{8}-?\d$/)
      expect(acreditado, `${id}: no puede ser un contador con ceros a la izquierda`).not.toMatch(
        /^0\d{5,}$/,
      )
      expect(acreditado.length, `${id}: entra en la columna`).toBeLessThanOrEqual(60)
    }
  })
})
