/**
 * Test de la heurística "¿esto parece un aviso de turno?"
 * (`lib/gmail/heuristica-turno.ts`, Sprint 17, tarea 17.2).
 *
 * **Lo que se está probando no es una optimización: es una puerta de
 * privacidad.** El cuerpo de un correo sale de la aplicación hacia Gemini
 * SOLO si esta función dice que sí (`docs/minimizacion-datos.md` §10.6). Por
 * eso los casos negativos importan tanto como los positivos: cada falso
 * positivo es texto de la casilla de alguien viajando a un tercero sin
 * necesidad.
 *
 * Los textos positivos están calcados de la forma en que escriben las clínicas
 * argentinas -los mismos que ya alimentan los fixtures de la tarea 16.4-.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import { analizarSeniasDeTurno, pareceAvisoDeTurno } from "@/lib/gmail/heuristica-turno"

describe("pareceAvisoDeTurno — los que SÍ", () => {
  it("el aviso clásico de asignación", () => {
    expect(
      pareceAvisoDeTurno(
        "CLINICA SAN JORGE: Se asigna turno para ECOGRAFIA VESICAL el 14/07/2026 a las 09:45 hs. " +
          "Concurrir con 1 litro de agua.",
      ),
    ).toBe(true)
  })

  it("la confirmación corta, sin la palabra 'turno' repetida", () => {
    expect(
      pareceAvisoDeTurno(
        "Le confirmamos su cita medica con el Dr. Ardans para el 3/9 a las 18.10 hs en consultorio 4.",
      ),
    ).toBe(true)
  })

  it("la reprogramación", () => {
    expect(
      pareceAvisoDeTurno(
        "Estimado paciente: se reprograma su turno de Cardiología para el 22 de septiembre a las 11:30.",
      ),
    ).toBe(true)
  })

  it("un aviso sin fecha legible pero con dos señales de turno", () => {
    // No tiene fecha ni hora reconocibles: igual pasa, porque dos palabras de
    // turno alcanzan. El analizador de la 16.4 va a avisar "faltó la fecha",
    // que es justo lo que la persona necesita ver.
    expect(
      pareceAvisoDeTurno(
        "Recordatorio de su turno. Debe presentarse en el consultorio con la orden medica y su credencial.",
      ),
    ).toBe(true)
  })

  it("el correo con los campos rotulados que mandan los sistemas de gestión", () => {
    expect(
      pareceAvisoDeTurno(
        "Profesional: GONZALEZ, MARIA\nEspecialidad: TRAUMATOLOGIA\nFecha: 05/11/2026\nHora: 08:20",
      ),
    ).toBe(true)
  })

  it("no le molestan las tildes ni las mayúsculas", () => {
    expect(
      pareceAvisoDeTurno("SU TURNO DE CARDIOLOGÍA ES EL 14/7 A LAS 9:45. NO FALTE."),
    ).toBe(true)
  })
})

describe("pareceAvisoDeTurno — los que NO (y no salen de la app)", () => {
  it("una newsletter de la clínica que igual habla de turnos online", () => {
    const senias = analizarSeniasDeTurno(
      "Ahora podés sacar turnos online desde nuestra web. Conocé nuestro nuevo servicio de guardia.",
    )
    // Tiene UNA palabra de turno pero ninguna fecha ni hora: no alcanza.
    expect(senias.palabras.length).toBeGreaterThan(0)
    expect(senias.tieneFecha).toBe(false)
    expect(senias.pareceTurno).toBe(false)
  })

  it("el correo que solo dice 'adjuntamos el resultado'", () => {
    expect(
      pareceAvisoDeTurno("Estimado paciente, adjuntamos el resultado de su estudio. Saludos."),
    ).toBe(false)
  })

  it("una factura de la obra social", () => {
    expect(
      pareceAvisoDeTurno(
        "Su factura del mes de julio ya está disponible. Vencimiento 20/07/2026. Importe: $ 45.300.",
      ),
    ).toBe(false)
  })

  it("un texto vacío o demasiado corto", () => {
    expect(pareceAvisoDeTurno("")).toBe(false)
    expect(pareceAvisoDeTurno("Turno 14/7")).toBe(false)
  })

  it("publicidad pura", () => {
    expect(
      pareceAvisoDeTurno("¡Aprovechá el 30% de descuento en el plan familiar hasta el 31/12/2026!"),
    ).toBe(false)
  })
})

describe("analizarSeniasDeTurno — el detalle que hace depurable la decisión", () => {
  it("dice qué encontró y qué no", () => {
    const senias = analizarSeniasDeTurno(
      "Se asigna turno para ECOGRAFIA el 14/07/2026 a las 09:45 hs.",
    )
    expect(senias.pareceTurno).toBe(true)
    expect(senias.tieneFecha).toBe(true)
    expect(senias.tieneHora).toBe(true)
    expect(senias.palabras).toContain("turno")
  })

  it("reconoce la fecha escrita en letras", () => {
    const senias = analizarSeniasDeTurno(
      "Su turno quedó agendado para el 22 de septiembre en el consultorio de planta baja.",
    )
    expect(senias.tieneFecha).toBe(true)
    expect(senias.pareceTurno).toBe(true)
  })

  it("no cuenta dos veces la misma palabra", () => {
    const senias = analizarSeniasDeTurno(
      "turno turno turno turno turno turno turno turno turno turno",
    )
    expect(senias.palabras).toEqual(["turno"])
    // Una sola palabra repetida, sin fecha ni hora: no alcanza.
    expect(senias.pareceTurno).toBe(false)
  })
})
