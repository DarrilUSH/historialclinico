/**
 * Tests de `detectarRepeticiones` (`lib/turnos/duplicados.ts`, agosto 2026).
 *
 * La guarda que impide que pegar dos veces el mismo mensaje de diez sesiones
 * deje veinte turnos y cuarenta recordatorios. Módulo puro: se ejercita con
 * arrays armados a mano, sin base ni red.
 */

import { describe, expect, it } from "vitest"

import { detectarRepeticiones, type TurnoComparable } from "@/lib/turnos/duplicados"

function turno(cambios: Partial<TurnoComparable> = {}): TurnoComparable {
  return {
    fechaHoraIso: "2026-08-25T14:00:00.000Z",
    especialidad: "Kinesiología",
    medico: "Buet Daiana Edith",
    ...cambios,
  }
}

describe("detectarRepeticiones — contra los turnos que ya existen", () => {
  it("marca el turno idéntico como ya existente", () => {
    const { yaExistian, repetidosEnElLote } = detectarRepeticiones([turno()], [turno()])

    expect([...yaExistian]).toEqual([0])
    expect([...repetidosEnElLote]).toEqual([])
  })

  it("no marca nada cuando la agenda está vacía", () => {
    const { yaExistian } = detectarRepeticiones([turno(), turno({ fechaHoraIso: "2026-08-26T14:00:00.000Z" })], [])

    expect([...yaExistian]).toEqual([])
  })

  it("otra FECHA es un turno legítimo, no un duplicado", () => {
    const { yaExistian } = detectarRepeticiones(
      [turno({ fechaHoraIso: "2026-08-26T14:00:00.000Z" })],
      [turno()],
    )

    expect([...yaExistian]).toEqual([])
  })

  it("otra HORA el mismo día es un turno legítimo", () => {
    const { yaExistian } = detectarRepeticiones(
      [turno({ fechaHoraIso: "2026-08-25T15:30:00.000Z" })],
      [turno()],
    )

    expect([...yaExistian]).toEqual([])
  })

  it("otro PROFESIONAL a la misma hora es un turno legítimo", () => {
    const { yaExistian } = detectarRepeticiones([turno({ medico: "Dra. Pérez" })], [turno()])

    expect([...yaExistian]).toEqual([])
  })

  /* ------------------------------------------------------------------ *
   *  Sprint 20 (adenda): la ESPECIALIDAD salió de la identidad
   * ------------------------------------------------------------------ */

  it("EL CASO REAL — la misma profesional a la misma hora con la especialidad escrita distinto ES el mismo turno", () => {
    // Encontrado en producción, en el perfil de una usuaria real: la sesión
    // 10/10 quedó DUPLICADA. Mismo instante, misma kinesióloga; una fila con el
    // texto crudo del mensaje y la otra con la especialidad ya normalizada
    // contra el catálogo. Dos corridas de Gemini sobre el MISMO mensaje.
    const { yaExistian } = detectarRepeticiones(
      [turno({ especialidad: "SESION DE KINESIOLOGIA COMPLEJA PARA COLUMNA VERTEBRAL" })],
      [turno({ especialidad: "Kinesiología y Fisiatría" })],
    )

    expect([...yaExistian]).toEqual([0])
  })

  it("otra especialidad a la misma hora con otra profesional SÍ es un turno legítimo", () => {
    const { yaExistian } = detectarRepeticiones(
      [turno({ especialidad: "Cardiología", medico: "Dr. Rozanec" })],
      [turno()],
    )

    expect([...yaExistian]).toEqual([])
  })

  it("SIN profesional, la especialidad vuelve a ser el desempate", () => {
    // Sin nombre, "mismo minuto" es demasiado poco: una clínica grande puede
    // tener dos prácticas distintas a la misma hora.
    const sinMedico = { medico: null }

    expect([
      ...detectarRepeticiones(
        [turno({ ...sinMedico, especialidad: "Cardiología" })],
        [turno({ ...sinMedico, especialidad: "Kinesiología" })],
      ).yaExistian,
    ]).toEqual([])

    expect([
      ...detectarRepeticiones(
        [turno({ ...sinMedico, especialidad: "Kinesiología" })],
        [turno({ ...sinMedico, especialidad: "KINESIOLOGIA" })],
      ).yaExistian,
    ]).toEqual([0])
  })

  it("el mismo instante escrito en otro huso es el MISMO turno", () => {
    // 11:00 en Ushuaia (UTC-3) es 14:00Z: la comparación es por instante, no
    // por el texto que devuelva Postgres.
    const { yaExistian } = detectarRepeticiones(
      [turno({ fechaHoraIso: "2026-08-25T11:00:00-03:00" })],
      [turno({ fechaHoraIso: "2026-08-25T14:00:00+00:00" })],
    )

    expect([...yaExistian]).toEqual([0])
  })

  it("mayúsculas, tildes y espacios de más no vuelven distinto al mismo turno", () => {
    const { yaExistian } = detectarRepeticiones(
      [turno({ medico: "BUET  DAIANA   EDITH", especialidad: "KINESIOLOGIA" })],
      [turno({ medico: "Buet Daiana Edith", especialidad: "Kinesiología" })],
    )

    expect([...yaExistian]).toEqual([0])
  })

  it("dos turnos sin profesional se siguen comparando entre sí", () => {
    const sinMedico = turno({ medico: null })
    const { yaExistian } = detectarRepeticiones([sinMedico], [turno({ medico: undefined })])

    expect([...yaExistian]).toEqual([0])
  })

  it("una fecha imposible nunca se toma por duplicada (ante un dato roto, se crea)", () => {
    const roto = turno({ fechaHoraIso: "no-es-una-fecha" })
    const { yaExistian, repetidosEnElLote } = detectarRepeticiones([roto, roto], [roto])

    expect([...yaExistian]).toEqual([])
    expect([...repetidosEnElLote]).toEqual([])
  })
})

describe("detectarRepeticiones — dentro del mismo lote", () => {
  it("marca la SEGUNDA aparición, no la primera", () => {
    const { yaExistian, repetidosEnElLote } = detectarRepeticiones([turno(), turno()], [])

    expect([...yaExistian]).toEqual([])
    expect([...repetidosEnElLote]).toEqual([1])
  })

  it("pegar dos veces la misma serie de tres deja las tres marcadas como ya existentes", () => {
    const serie = [
      turno({ fechaHoraIso: "2026-08-21T14:00:00.000Z" }),
      turno({ fechaHoraIso: "2026-08-24T15:30:00.000Z" }),
      turno({ fechaHoraIso: "2026-08-25T14:00:00.000Z" }),
    ]

    // Primera pasada: nada existía, entran las tres.
    expect([...detectarRepeticiones(serie, []).yaExistian]).toEqual([])

    // Segunda pasada, con las tres ya en la agenda: ninguna se vuelve a crear.
    const segunda = detectarRepeticiones(serie, serie)
    expect([...segunda.yaExistian]).toEqual([0, 1, 2])
  })

  it("una serie legítima de sesiones distintas no se marca a sí misma", () => {
    const serie = Array.from({ length: 10 }, (_, indice) =>
      turno({ fechaHoraIso: `2026-09-${String(indice + 1).padStart(2, "0")}T14:00:00.000Z` }),
    )

    const { yaExistian, repetidosEnElLote } = detectarRepeticiones(serie, [])

    expect([...yaExistian]).toEqual([])
    expect([...repetidosEnElLote]).toEqual([])
  })
})
