/**
 * Tests unitarios de `lib/signos/notificar.ts` (Sprint 9, tarea 9.3).
 *
 * Se prueba únicamente `armarTextoAlertaSignos` y `construirAlertaSignos`: la
 * única lógica de este módulo que no es red (destinatarios + envío, ya
 * cubierta por `lib/push/servidor.ts` y verificada contra el dispositivo real
 * en `docs/capturas/dispositivo-real/README.md`). Es el texto que una persona
 * lee en la pantalla bloqueada del celular -la salida observable de la
 * tarea-, mismo criterio que `tests/unit/alertas-medicacion.test.ts`.
 *
 *   npm run test -- notificar-signos
 */

import { describe, it, expect } from "vitest"

import { DESCARGO_CLINICO } from "@/lib/signos/evaluar"
import {
  armarTextoAlertaSignos,
  construirAlertaSignos,
  type AlertaParaNotificar,
} from "@/lib/signos/notificar"

function alerta(cambios: Partial<AlertaParaNotificar> & Pick<AlertaParaNotificar, "regla">): AlertaParaNotificar {
  return {
    valor: 0,
    umbral: 0,
    referencia: null,
    ...cambios,
  }
}

describe("lib/signos/notificar.ts", () => {
  describe("armarTextoAlertaSignos — tensión", () => {
    it("agrupa sistólica y diastólica altas en UN SOLO mensaje (el ejemplo del ROADMAP)", () => {
      const resultado = armarTextoAlertaSignos("Roberto Gómez", [
        alerta({ regla: "sistolica_alta", valor: 170, umbral: 160 }),
        alerta({ regla: "diastolica_alta", valor: 110, umbral: 100 }),
      ])

      expect(resultado.titulo).toBe("Tensión alta registrada para Roberto")
      expect(resultado.cuerpo).toBe(
        `170/110 (umbral 160/100). ${DESCARGO_CLINICO}`,
      )
    })

    it("el orden de las alertas de entrada no cambia el orden sistólica/diastólica del texto", () => {
      const resultado = armarTextoAlertaSignos("Roberto", [
        alerta({ regla: "diastolica_alta", valor: 108, umbral: 100 }),
        alerta({ regla: "sistolica_alta", valor: 172, umbral: 160 }),
      ])

      expect(resultado.cuerpo.startsWith("172/108")).toBe(true)
    })

    it("solo sistólica alta: nombra la regla, no arma un par con un valor inventado", () => {
      const resultado = armarTextoAlertaSignos("Roberto", [
        alerta({ regla: "sistolica_alta", valor: 165, umbral: 160 }),
      ])

      expect(resultado.titulo).toBe("Presión sistólica alta registrada para Roberto")
      expect(resultado.cuerpo).toBe(`165 mmHg (umbral 160). ${DESCARGO_CLINICO}`)
    })

    it("solo diastólica alta", () => {
      const resultado = armarTextoAlertaSignos("Roberto", [
        alerta({ regla: "diastolica_alta", valor: 104, umbral: 100 }),
      ])

      expect(resultado.titulo).toBe("Presión diastólica alta registrada para Roberto")
      expect(resultado.cuerpo).toBe(`104 mmHg (umbral 100). ${DESCARGO_CLINICO}`)
    })
  })

  describe("armarTextoAlertaSignos — glucemia", () => {
    it("glucemia baja", () => {
      const resultado = armarTextoAlertaSignos("Roberto", [
        alerta({ regla: "glucemia_baja", valor: 65, umbral: 70 }),
      ])

      expect(resultado.titulo).toBe("Glucemia baja registrada para Roberto")
      expect(resultado.cuerpo).toBe(`65 mg/dL (umbral 70). ${DESCARGO_CLINICO}`)
    })

    it("glucemia alta", () => {
      const resultado = armarTextoAlertaSignos("Roberto", [
        alerta({ regla: "glucemia_alta", valor: 260, umbral: 250 }),
      ])

      expect(resultado.titulo).toBe("Glucemia alta registrada para Roberto")
      expect(resultado.cuerpo).toBe(`260 mg/dL (umbral 250). ${DESCARGO_CLINICO}`)
    })
  })

  describe("armarTextoAlertaSignos — peso", () => {
    it("variación de peso hacia arriba", () => {
      const resultado = armarTextoAlertaSignos("Roberto", [
        alerta({ regla: "peso_variacion", valor: 84, umbral: 2, referencia: 81.5 }),
      ])

      expect(resultado.titulo).toBe("Variación de peso registrada para Roberto")
      expect(resultado.cuerpo).toBe(
        `84 kg: 2,5 kg más que la referencia (81,5 kg; umbral 2 kg). ${DESCARGO_CLINICO}`,
      )
    })

    it("variación de peso hacia abajo", () => {
      const resultado = armarTextoAlertaSignos("Roberto", [
        alerta({ regla: "peso_variacion", valor: 78, umbral: 2, referencia: 81 }),
      ])

      expect(resultado.cuerpo).toContain("3 kg menos que la referencia")
    })
  })

  it("un nombre de perfil vacío degrada a una frase igual de correcta, sin 'para'", () => {
    const resultado = armarTextoAlertaSignos("   ", [
      alerta({ regla: "glucemia_baja", valor: 65, umbral: 70 }),
    ])

    expect(resultado.titulo).toBe("Glucemia baja registrada")
  })

  it("usa el primer nombre y no el completo (mismo motivo que lib/medicacion/alertas.ts)", () => {
    const resultado = armarTextoAlertaSignos("Roberto Gómez", [
      alerta({ regla: "glucemia_baja", valor: 65, umbral: 70 }),
    ])

    expect(resultado.titulo).not.toContain("Gómez")
  })

  it("todo mensaje trae el descargo clínico (constraint de la base, reflejada acá)", () => {
    const casos: AlertaParaNotificar[][] = [
      [alerta({ regla: "sistolica_alta", valor: 170, umbral: 160 })],
      [alerta({ regla: "glucemia_alta", valor: 260, umbral: 250 })],
      [alerta({ regla: "peso_variacion", valor: 84, umbral: 2, referencia: 81.5 })],
    ]

    for (const alertas of casos) {
      expect(armarTextoAlertaSignos("Roberto", alertas).cuerpo).toContain(
        "no reemplaza el criterio médico",
      )
    }
  })

  it("lanza si se llama sin ninguna alerta — es un bug de quien invoca, no un caso de negocio", () => {
    expect(() => armarTextoAlertaSignos("Roberto", [])).toThrow()
  })

  describe("construirAlertaSignos", () => {
    it("arma el deep link a /signos/enlace con el perfil, y el tag por vital_sign_id", () => {
      const payload = construirAlertaSignos({
        nombrePerfil: "Roberto Gómez",
        profileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        vitalSignId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        alertas: [alerta({ regla: "sistolica_alta", valor: 170, umbral: 160 })],
      })

      expect(payload.url).toBe(
        "/signos/enlace?perfil=cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      )
      expect(payload.tag).toBe("signo-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    })

    it("un solo push aunque la carga haya violado dos reglas — el tag es el mismo vital_sign_id para las dos", () => {
      const payload = construirAlertaSignos({
        nombrePerfil: "Roberto",
        profileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        vitalSignId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        alertas: [
          alerta({ regla: "sistolica_alta", valor: 170, umbral: 160 }),
          alerta({ regla: "diastolica_alta", valor: 110, umbral: 100 }),
        ],
      })

      expect(payload.titulo).toBe("Tensión alta registrada para Roberto")
      expect(payload.tag).toBe("signo-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    })
  })
})
