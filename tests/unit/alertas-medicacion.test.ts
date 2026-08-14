/**
 * Tests unitarios de `lib/medicacion/alertas.ts` (Sprint 7, tarea 7.4).
 *
 * El texto de la alerta es la única salida OBSERVABLE de la tarea: lo que una
 * persona lee en la pantalla bloqueada del celular. La lógica de cuándo avisar
 * y a quién vive en SQL y la cubre `scripts/test-rls.sql` BLOQUE 12; acá se
 * cubre qué dice.
 *
 *   npm run test -- alertas-medicacion
 */

import { describe, it, expect } from "vitest"

import {
  RUTA_ALERTA_RENOVACION,
  construirAlertaRenovacion,
  cuerpoAlertaRenovacion,
  fraseDeStockRestante,
  tituloAlertaRenovacion,
  type MedicacionParaAlerta,
} from "@/lib/medicacion/alertas"

const PERFIL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const MEDICACION = "880e8400-e29b-41d4-a716-446655440002"

function medicacion(cambios: Partial<MedicacionParaAlerta> = {}): MedicacionParaAlerta {
  return {
    medicationId: MEDICACION,
    profileId: PERFIL,
    nombrePerfil: "Roberto Gómez",
    nombre: "Enalapril",
    diasRestantes: 4,
    stockUnits: 4,
    doseUnit: "comprimido",
    ...cambios,
  }
}

describe("lib/medicacion/alertas.ts", () => {
  describe("tituloAlertaRenovacion", () => {
    it("es el ejemplo del ROADMAP: quién, cuánto y de qué", () => {
      expect(tituloAlertaRenovacion(medicacion())).toBe(
        "A Roberto le quedan 4 días de Enalapril",
      )
    })

    it("usa el primer nombre y no el completo", () => {
      // Android corta el título en una línea: con el apellido se pierde
      // justamente el final, que es el nombre del remedio.
      expect(tituloAlertaRenovacion(medicacion())).not.toContain("Gómez")
    })

    it("concuerda el verbo con 1 día", () => {
      expect(tituloAlertaRenovacion(medicacion({ diasRestantes: 1 }))).toBe(
        "A Roberto le queda 1 día de Enalapril",
      )
    })

    it("0 días no es «se acabó», es «no alcanza para hoy»", () => {
      // `dias_restantes = 0` significa "no alcanza ni para el día de hoy"
      // (docs/modelo-medicacion.md §2.2): puede quedar un comprimido suelto
      // con una dosis de dos.
      expect(tituloAlertaRenovacion(medicacion({ diasRestantes: 0, stockUnits: 1 }))).toBe(
        "A Roberto no le queda Enalapril para hoy",
      )
    })

    it("un nombre de perfil vacío degrada a una frase igual de correcta", () => {
      // `profiles.full_name` es NOT NULL con CHECK de no vacío: esta rama es
      // defensiva, pero no puede producir "A  le quedan...".
      expect(tituloAlertaRenovacion(medicacion({ nombrePerfil: "   " }))).toBe(
        "Quedan 4 días de Enalapril",
      )
      expect(
        tituloAlertaRenovacion(medicacion({ nombrePerfil: "", diasRestantes: 1 })),
      ).toBe("Queda 1 día de Enalapril")
      expect(
        tituloAlertaRenovacion(medicacion({ nombrePerfil: "", diasRestantes: 0 })),
      ).toBe("No queda Enalapril para hoy")
    })

    it("recorta los espacios sobrantes del nombre del remedio", () => {
      expect(tituloAlertaRenovacion(medicacion({ nombre: "  Enalapril  " }))).toBe(
        "A Roberto le quedan 4 días de Enalapril",
      )
    })
  })

  describe("cuerpoAlertaRenovacion", () => {
    it("dice el stock concreto, pluralizado, y qué conviene hacer", () => {
      expect(cuerpoAlertaRenovacion(medicacion())).toBe(
        "Quedan 4 comprimidos · Conviene pedir la renovación de la receta.",
      )
    })

    it("mantiene el singular con una sola unidad", () => {
      expect(cuerpoAlertaRenovacion(medicacion({ diasRestantes: 0, stockUnits: 1 }))).toBe(
        "Queda 1 comprimido · Conviene pedir la renovación de la receta.",
      )
    })

    it("con stock 0 lo dice sin inventar un número", () => {
      expect(cuerpoAlertaRenovacion(medicacion({ diasRestantes: 0, stockUnits: 0 }))).toBe(
        "Ya no quedan comprimidos · Conviene pedir la renovación de la receta.",
      )
    })

    it("respeta las unidades invariables", () => {
      expect(
        cuerpoAlertaRenovacion(medicacion({ stockUnits: 30, doseUnit: "ml" })),
      ).toBe("Quedan 30 ml · Conviene pedir la renovación de la receta.")
    })

    it("sin stock cargado no imprime «null unidades»", () => {
      // No se puede llegar acá desde el job (necesita_renovacion es false sin
      // stock), pero una llamada a mano no debe producir basura.
      expect(cuerpoAlertaRenovacion(medicacion({ stockUnits: null }))).toBe(
        "Conviene pedir la renovación de la receta.",
      )
    })

    it("no es alarmista: no grita ni usa signos de admiración", () => {
      const cuerpo = cuerpoAlertaRenovacion(medicacion())
      expect(cuerpo).not.toMatch(/[!¡]/)
      expect(cuerpo).not.toMatch(/URGENTE|ATENCIÓN/i)
    })
  })

  describe("fraseDeStockRestante", () => {
    it("cuenta igual que el título del push, para que no se contradigan", () => {
      expect(fraseDeStockRestante(4)).toBe("quedan 4 días")
      expect(fraseDeStockRestante(1)).toBe("queda 1 día")
      expect(fraseDeStockRestante(0)).toBe("no alcanza para hoy")
    })

    it("un negativo imposible no produce «quedan -1 días»", () => {
      expect(fraseDeStockRestante(-3)).toBe("no alcanza para hoy")
    })
  })

  describe("construirAlertaRenovacion", () => {
    it("arma el payload completo", () => {
      expect(construirAlertaRenovacion(medicacion())).toEqual({
        titulo: "A Roberto le quedan 4 días de Enalapril",
        cuerpo: "Quedan 4 comprimidos · Conviene pedir la renovación de la receta.",
        url: `${RUTA_ALERTA_RENOVACION}?perfil=${PERFIL}`,
        tag: `medicacion-${MEDICACION}`,
      })
    })

    it("la url lleva el perfil de la MEDICACIÓN (deep link del Sprint 6.6)", () => {
      // Sin esto, María tocando el aviso de un remedio de Roberto aterriza en
      // su propia medicación. `/medicacion/enlace` revalida el permiso antes
      // de cambiar el perfil activo.
      const payload = construirAlertaRenovacion(medicacion())
      expect(payload.url).toBe("/medicacion?perfil=cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    })

    it("la url es siempre una ruta relativa (lo exige serializarPayload)", () => {
      expect(construirAlertaRenovacion(medicacion()).url.startsWith("/")).toBe(true)
    })

    it("el tag sigue la convención medicacion-{id} de docs/push.md", () => {
      // Es la antiduplicación del lado del dispositivo: dos avisos del mismo
      // remedio se reemplazan en pantalla en vez de apilarse.
      expect(construirAlertaRenovacion(medicacion()).tag).toBe(`medicacion-${MEDICACION}`)
    })
  })
})
