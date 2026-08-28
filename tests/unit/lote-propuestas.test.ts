/**
 * Tests de `describirLoteDePropuestas` (`lib/turnos/lote-propuestas.ts`,
 * agosto 2026): cómo se describe en pantalla un lote de propuestas de turno
 * -qué datos son comunes a todas las sesiones y cuáles propios de cada una-.
 *
 * Es la lógica que evita que diez filas idénticas entierren lo único que
 * cambia (la fecha y la hora de cada sesión). Vive fuera de React justamente
 * para poder testearse así.
 */

import { describe, expect, it } from "vitest"

import type { PropuestaTurno } from "@/lib/turnos/construir-propuestas"
import { describirLoteDePropuestas } from "@/lib/turnos/lote-propuestas"

function propuesta(cambios: Partial<PropuestaTurno> = {}): PropuestaTurno {
  return {
    especialidad: "Kinesiología",
    especialidadInferida: false,
    medico: "Buet Daiana Edith",
    esEstudioNoProfesional: false,
    dudaOrdenNombre: false,
    fecha: "2026-08-25",
    anioInferido: false,
    hora: "11:00",
    discrepanciaDiaSemana: false,
    diaSemanaTexto: "",
    lugarNombre: "HB Central",
    lugarDireccion: "Av. Entre Ríos 2142",
    lugarCiudad: "",
    lugarProvincia: "",
    notasPreparacion: "",
    numeroSesion: 0,
    totalSesiones: 0,
    avisos: [],
    resumen: "",
    etiquetaSesion: "",
    ...cambios,
  }
}

describe("describirLoteDePropuestas", () => {
  it("sube arriba lo que comparten las diez sesiones y deja las filas con la fecha", () => {
    const propuestas = ["2026-08-21", "2026-08-24", "2026-08-25"].map((fecha, indice) =>
      propuesta({ fecha, etiquetaSesion: `Sesión ${indice + 1}/3`, numeroSesion: indice + 1, totalSesiones: 3 }),
    )

    const { comunes, filas } = describirLoteDePropuestas(propuestas)

    expect(comunes).toEqual({
      medico: "Buet Daiana Edith",
      especialidad: "Kinesiología",
      lugarNombre: "HB Central",
      lugarDireccion: "Av. Entre Ríos 2142",
    })
    // Nada se repite por fila: lo común ya está arriba.
    expect(filas.every((fila) => fila.propios.length === 0)).toBe(true)
    expect(filas.map((fila) => fila.titulo)).toEqual(["Sesión 1/3", "Sesión 2/3", "Sesión 3/3"])
    expect(filas.map((fila) => fila.fecha)).toEqual(["2026-08-21", "2026-08-24", "2026-08-25"])
    expect(filas.every((fila) => fila.tituloDelMensaje)).toBe(true)
  })

  it("sin numeración del mensaje, cada fila igual tiene nombre: 'Turno N' por posición", () => {
    const propuestas = [propuesta({ fecha: "2026-09-15" }), propuesta({ fecha: "2026-09-22" })]

    const { filas } = describirLoteDePropuestas(propuestas)

    expect(filas.map((fila) => fila.titulo)).toEqual(["Turno 1", "Turno 2"])
    expect(filas.every((fila) => fila.tituloDelMensaje === false)).toBe(true)
  })

  it("un campo que NO vale para todas deja de ser común y baja a las filas que lo tienen", () => {
    const propuestas = [
      propuesta({ medico: "Dra. Pérez", especialidad: "Mamografía" }),
      propuesta({ medico: "Vidales Valeria", especialidad: "Mamografía" }),
    ]

    const { comunes, filas } = describirLoteDePropuestas(propuestas)

    expect(comunes.especialidad).toBe("Mamografía")
    expect(comunes.medico).toBe("")
    expect(filas[0].propios).toEqual([{ etiqueta: "Profesional", valor: "Dra. Pérez" }])
    expect(filas[1].propios).toEqual([{ etiqueta: "Profesional", valor: "Vidales Valeria" }])
  })

  it("un campo vacío en UNA sola propuesta lo saca de comunes, y no se afirma arriba", () => {
    const propuestas = [propuesta(), propuesta({ lugarDireccion: "" })]

    const { comunes, filas } = describirLoteDePropuestas(propuestas)

    expect(comunes.lugarDireccion).toBe("")
    // La que sí la trae la muestra; la que no, no inventa nada.
    expect(filas[0].propios).toContainEqual({ etiqueta: "Dirección", valor: "Av. Entre Ríos 2142" })
    expect(filas[1].propios.some((dato) => dato.etiqueta === "Dirección")).toBe(false)
  })

  it("los avisos de cada propuesta viajan con su fila", () => {
    const propuestas = [
      propuesta({ avisos: ["El mensaje no decía la hora — completala vos."], hora: "" }),
      propuesta(),
    ]

    const { filas } = describirLoteDePropuestas(propuestas)

    expect(filas[0].avisos).toEqual(["El mensaje no decía la hora — completala vos."])
    expect(filas[0].hora).toBe("")
    expect(filas[1].avisos).toEqual([])
  })

  it("un lote vacío no rompe", () => {
    const { comunes, filas } = describirLoteDePropuestas([])

    expect(filas).toEqual([])
    expect(comunes).toEqual({ medico: "", especialidad: "", lugarNombre: "", lugarDireccion: "" })
  })

  it("el índice de cada fila es el que espera crearTurnosEnLote", () => {
    const propuestas = [propuesta(), propuesta(), propuesta()]

    expect(describirLoteDePropuestas(propuestas).filas.map((fila) => fila.indice)).toEqual([0, 1, 2])
  })
})
