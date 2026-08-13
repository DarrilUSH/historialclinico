/**
 * Tests de `lib/turnos/recordatorios.ts` (Sprint 6, tarea 6.4).
 *
 *   npm run test -- recordatorios-turnos
 *
 * Estos casos son la única forma de verificar el texto SIN un teléfono: el
 * resto del circuito (ventanas en SQL, cola, entrega) se prueba contra la base
 * y contra un Android real, pero "qué dice el aviso" es una función pura y
 * tiene que estar clavada acá.
 *
 * Igual que el resto de los helpers temporales del proyecto, `ahora` se pasa
 * explícito y las fechas se escriben con el offset de Ushuaia (`-03:00`), para
 * que el resultado no dependa de la zona horaria del proceso que corre Vitest.
 */

import { describe, it, expect } from "vitest"

import {
  RUTA_RECORDATORIO,
  VENTANAS_RECORDATORIO,
  construirRecordatorio,
  cuerpoDeRecordatorio,
  fraseDeAnticipacion,
  type TurnoParaRecordatorio,
} from "@/lib/turnos/recordatorios"

/** "Ahora" de referencia: miércoles 12/08/2026, 09:00 en Ushuaia. */
const AHORA = new Date("2026-08-12T09:00:00-03:00")

/** El turno completo: especialidad, médico, lugar y preparación. */
const TURNO: TurnoParaRecordatorio = {
  id: "11621eda-50a4-4b11-99a5-66c3f13d34a4",
  especialidad: "Cardiología",
  fechaIso: "2026-08-13T10:30:00-03:00", // jueves, el día siguiente
  medico: "Dr. Carlos Rodríguez",
  lugar: "Clínica Ushuaia",
  preparacion: "Venir en ayunas de 8 horas",
}

describe("fraseDeAnticipacion", () => {
  it('la ventana de 7 días dice "en una semana" y no "en 7 días"', () => {
    expect(fraseDeAnticipacion("7d", "2026-08-19T10:30:00-03:00", AHORA)).toBe("en una semana")
  })

  it('la ventana de 48hs dice "pasado mañana"', () => {
    expect(fraseDeAnticipacion("48h", "2026-08-14T10:30:00-03:00", AHORA)).toBe("pasado mañana")
  })

  it('la ventana de 24hs dice "mañana"', () => {
    expect(fraseDeAnticipacion("24h", "2026-08-13T10:30:00-03:00", AHORA)).toBe("mañana")
  })

  it('la ventana de 3hs dice las horas que faltan de verdad, redondeadas', () => {
    // El caso del criterio de aceptación: turno a 2h50m del barrido.
    expect(fraseDeAnticipacion("3h", "2026-08-12T11:50:00-03:00", AHORA)).toBe("en 3 horas")
    expect(fraseDeAnticipacion("3h", "2026-08-12T12:00:00-03:00", AHORA)).toBe("en 3 horas")
    expect(fraseDeAnticipacion("3h", "2026-08-12T11:00:00-03:00", AHORA)).toBe("en 2 horas")
  })

  it('singular: a una hora dice "en 1 hora", no "en 1 horas"', () => {
    expect(fraseDeAnticipacion("3h", "2026-08-12T10:05:00-03:00", AHORA)).toBe("en 1 hora")
  })

  it('a menos de 45 minutos deja de dar un número: "en menos de una hora"', () => {
    // El barrido puede correr tarde (máquina apagada, cron demorado). Decir
    // "en 1 hora" cuando faltan 20 minutos es lo que hace llegar tarde.
    expect(fraseDeAnticipacion("3h", "2026-08-12T09:20:00-03:00", AHORA)).toBe(
      "en menos de una hora",
    )
  })

  it("la ventana de 3hs mide horas de reloj, no días de calendario", () => {
    // 23:40 de hoy, turno a las 01:00 de mañana: faltan 80 minutos. Decir
    // "mañana" sería técnicamente cierto y prácticamente inútil.
    const casiMedianoche = new Date("2026-08-12T23:40:00-03:00")
    expect(fraseDeAnticipacion("3h", "2026-08-13T01:00:00-03:00", casiMedianoche)).toBe(
      "en 1 hora",
    )
  })

  it('las ventanas largas miden días de calendario, no múltiplos de 24hs', () => {
    // 20 minutos de reloj, pero es el turno de otro día: "mañana".
    const casiMedianoche = new Date("2026-08-12T23:50:00-03:00")
    expect(fraseDeAnticipacion("24h", "2026-08-13T00:10:00-03:00", casiMedianoche)).toBe("mañana")
  })

  it("si el barrido se atrasó tanto que el turno ya empezó, no dice un número negativo", () => {
    expect(fraseDeAnticipacion("3h", "2026-08-12T08:30:00-03:00", AHORA)).toBe("ahora")
    expect(fraseDeAnticipacion("24h", "2026-08-11T10:00:00-03:00", AHORA)).toBe("hoy")
  })
})

describe("cuerpoDeRecordatorio", () => {
  it("pone la fecha con día de la semana, la hora, el médico y el lugar", () => {
    expect(cuerpoDeRecordatorio(TURNO, "24h", AHORA)).toBe(
      "Jueves 13 de agosto a las 10:30 · Dr. Carlos Rodríguez · Clínica Ushuaia · Venir en ayunas de 8 horas",
    )
  })

  it('si el turno es hoy dice "Hoy a las HH:MM" y se ahorra el almanaque', () => {
    const hoy = { ...TURNO, fechaIso: "2026-08-12T11:50:00-03:00" }
    expect(cuerpoDeRecordatorio(hoy, "3h", AHORA)).toBe(
      "Hoy a las 11:50 · Dr. Carlos Rodríguez · Clínica Ushuaia · Venir en ayunas de 8 horas",
    )
  })

  it("un turno sin médico y sin lugar no deja separadores colgando", () => {
    const pelado: TurnoParaRecordatorio = {
      id: TURNO.id,
      especialidad: "Kinesiología",
      fechaIso: TURNO.fechaIso,
    }
    expect(cuerpoDeRecordatorio(pelado, "24h", AHORA)).toBe("Jueves 13 de agosto a las 10:30")
  })

  it("los campos vacíos o en blanco cuentan como ausentes, no como un ' · ' de más", () => {
    const conBlancos: TurnoParaRecordatorio = {
      ...TURNO,
      medico: "   ",
      lugar: null,
      preparacion: "",
    }
    expect(cuerpoDeRecordatorio(conBlancos, "24h", AHORA)).toBe("Jueves 13 de agosto a las 10:30")
  })

  it("la preparación entra en las ventanas cortas y NO en las largas", () => {
    // A 7 días "venir en ayunas" no le sirve a nadie y ocupa el renglón que se
    // lee de un vistazo; a 24hs es la razón de ser del aviso.
    expect(cuerpoDeRecordatorio(TURNO, "7d", AHORA)).not.toContain("ayunas")
    expect(cuerpoDeRecordatorio(TURNO, "48h", AHORA)).not.toContain("ayunas")
    expect(cuerpoDeRecordatorio(TURNO, "24h", AHORA)).toContain("Venir en ayunas de 8 horas")
    expect(cuerpoDeRecordatorio(TURNO, "3h", AHORA)).toContain("Venir en ayunas de 8 horas")
  })

  it("una preparación larguísima se recorta con puntos suspensivos", () => {
    const larga = { ...TURNO, preparacion: "Traer estudios previos. ".repeat(20) }
    const cuerpo = cuerpoDeRecordatorio(larga, "3h", AHORA)

    expect(cuerpo).toContain("…")
    expect(cuerpo.length).toBeLessThan(220)
  })

  it("normaliza los saltos de línea de la preparación: una notificación es un renglón", () => {
    const multilinea = { ...TURNO, preparacion: "Ayuno de 8 horas\n\nTraer la orden médica" }
    expect(cuerpoDeRecordatorio(multilinea, "3h", AHORA)).toContain(
      "Ayuno de 8 horas Traer la orden médica",
    )
  })

  it("usa la hora de Ushuaia y no la del proceso, aunque la fecha venga en UTC", () => {
    // 13:30 UTC == 10:30 en Ushuaia. `appointment_date` llega así desde la base.
    const enUtc = { ...TURNO, fechaIso: "2026-08-13T13:30:00Z" }
    expect(cuerpoDeRecordatorio(enUtc, "24h", AHORA)).toContain("Jueves 13 de agosto a las 10:30")
  })
})

describe("construirRecordatorio", () => {
  it("arma el aviso completo de la ventana de 24hs", () => {
    expect(construirRecordatorio(TURNO, "24h", AHORA)).toEqual({
      titulo: "Turno de Cardiología mañana",
      cuerpo:
        "Jueves 13 de agosto a las 10:30 · Dr. Carlos Rodríguez · Clínica Ushuaia · Venir en ayunas de 8 horas",
      url: "/turnos",
      tag: `turno-${TURNO.id}-24h`,
    })
  })

  it("arma el aviso de la ventana de 3hs para el turno cargado a último momento", () => {
    // El caso del roadmap: turno a 2h50m, se manda solo el aviso de 3hs.
    const hoy = { ...TURNO, fechaIso: "2026-08-12T11:50:00-03:00", preparacion: null }
    expect(construirRecordatorio(hoy, "3h", AHORA)).toEqual({
      titulo: "Turno de Cardiología en 3 horas",
      cuerpo: "Hoy a las 11:50 · Dr. Carlos Rodríguez · Clínica Ushuaia",
      url: "/turnos",
      tag: `turno-${TURNO.id}-3h`,
    })
  })

  it("el aviso de 7 días es el único que dice una semana", () => {
    const lejano = { ...TURNO, fechaIso: "2026-08-19T10:30:00-03:00" }
    expect(construirRecordatorio(lejano, "7d", AHORA).titulo).toBe(
      "Turno de Cardiología en una semana",
    )
  })

  it("el tag sigue la convención de docs/push.md §7 y es distinto por ventana", () => {
    const tags = VENTANAS_RECORDATORIO.map((v) => construirRecordatorio(TURNO, v, AHORA).tag)

    expect(new Set(tags).size).toBe(VENTANAS_RECORDATORIO.length)
    for (const tag of tags) {
      expect(tag.startsWith(`turno-${TURNO.id}-`)).toBe(true)
    }
  })

  it("todas las ventanas abren la lista de turnos, que es una ruta que existe", () => {
    // `serializarPayload` (lib/push/servidor.ts) rechaza cualquier url que no
    // sea relativa: un push no puede abrir un origen ajeno.
    for (const ventana of VENTANAS_RECORDATORIO) {
      const url = construirRecordatorio(TURNO, ventana, AHORA).url
      expect(url).toBe(RUTA_RECORDATORIO)
      expect(url.startsWith("/")).toBe(true)
    }
  })

  it("ninguna ventana genera un título ni un cuerpo vacío, ni siquiera con el turno mínimo", () => {
    // `serializarPayload` lanza si el título viene vacío: hay que garantizar
    // que ninguna combinación llegue a ese estado.
    const minimo: TurnoParaRecordatorio = {
      id: "sin-datos",
      especialidad: "  Clínica Médica  ",
      fechaIso: "2026-08-13T10:30:00-03:00",
    }

    for (const ventana of VENTANAS_RECORDATORIO) {
      const aviso = construirRecordatorio(minimo, ventana, AHORA)
      expect(aviso.titulo.trim().length).toBeGreaterThan(0)
      expect(aviso.titulo).toContain("Clínica Médica")
      expect(aviso.titulo).not.toContain("  ")
      expect(aviso.cuerpo.trim().length).toBeGreaterThan(0)
    }
  })

  it("el payload entra holgado en el tope de 3500 bytes de aes128gcm", () => {
    const exagerado: TurnoParaRecordatorio = {
      ...TURNO,
      especialidad: "Otorrinolaringología y cirugía de cabeza y cuello",
      medico: "Dra. María de los Ángeles Fernández Etchegaray",
      lugar: "Hospital Regional Ushuaia — Consultorios externos, segundo piso",
      preparacion: "Traer estudios previos y la orden médica. ".repeat(10),
    }

    const aviso = construirRecordatorio(exagerado, "3h", AHORA)
    expect(Buffer.byteLength(JSON.stringify(aviso), "utf8")).toBeLessThan(3500)
  })
})
