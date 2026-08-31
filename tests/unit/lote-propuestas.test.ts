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
import {
  describirLoteDePropuestas,
  faltaParaCrearElLote,
  frasesDelResultadoDelLote,
  motivoNoCreable,
  tituloDelResultadoDelLote,
  type ConteoDelLote,
} from "@/lib/turnos/lote-propuestas"

function propuesta(cambios: Partial<PropuestaTurno> = {}): PropuestaTurno {
  return {
    especialidad: "Kinesiología",
    especialidadInferida: false,
    medico: "Buet Daiana Edith",
    esEstudioNoProfesional: false,
    dudaOrdenNombre: false,
    fecha: "2026-08-25",
    fechaTexto: "25/08/2026",
    anioInferido: false,
    anioConfirmadoPorDiaSemana: false,
    diaSemanaIncongruente: false,
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

/* ═══════════════════════════════════════════════════════════════════════════
 *  avisosComunes (Sprint 20) — un aviso compartido se dice UNA vez, no diez
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("describirLoteDePropuestas — avisosComunes", () => {
  it("EL CASO REAL — el aviso de las diez sesiones de kinesiología aparece 1 vez arriba y 0 veces en las filas", () => {
    // Verificado en producción: heredarDatosComunes copia el profesional a
    // las diez sesiones de la serie, y generarAvisos corre igual sobre cada
    // una, así que el mismo aviso salía diez veces, una debajo de cada fila.
    const avisoCompartido =
      "No pudimos confirmar si BUET DAIANA EDITH está en orden Nombre Apellido…"
    const propuestas = Array.from({ length: 10 }, (_, indice) =>
      propuesta({
        etiquetaSesion: `Sesión ${indice + 1}/10`,
        fecha: `2026-08-${String(21 + indice).padStart(2, "0")}`,
        avisos: [avisoCompartido],
      }),
    )

    const { avisosComunes, filas } = describirLoteDePropuestas(propuestas)

    expect(avisosComunes).toEqual([avisoCompartido])
    expect(filas.every((fila) => fila.avisos.length === 0)).toBe(true)
  })

  it("un aviso presente en TODAS las propuestas sube a avisosComunes y desaparece de las filas", () => {
    const comun = "El mensaje no traía el nombre del centro — completalo vos."
    const propuestas = [propuesta({ avisos: [comun] }), propuesta({ avisos: [comun] })]

    const { avisosComunes, filas } = describirLoteDePropuestas(propuestas)

    expect(avisosComunes).toEqual([comun])
    expect(filas[0].avisos).toEqual([])
    expect(filas[1].avisos).toEqual([])
  })

  it("un aviso de UNA sola fila se queda en su fila y no sube a avisosComunes", () => {
    const soloDeLaPrimera = "El mensaje no decía la hora — completala vos."
    const propuestas = [propuesta({ avisos: [soloDeLaPrimera] }), propuesta({ avisos: [] })]

    const { avisosComunes, filas } = describirLoteDePropuestas(propuestas)

    expect(avisosComunes).toEqual([])
    expect(filas[0].avisos).toEqual([soloDeLaPrimera])
    expect(filas[1].avisos).toEqual([])
  })

  it("mezcla: el aviso compartido por todas sube, el que trae una sola fila se queda abajo", () => {
    const compartido = "No pudimos confirmar si BUET DAIANA EDITH está en orden Nombre Apellido…"
    const soloDeLaSegunda = "El mensaje no decía la hora — completala vos."
    const propuestas = [
      propuesta({ avisos: [compartido] }),
      propuesta({ avisos: [compartido, soloDeLaSegunda] }),
    ]

    const { avisosComunes, filas } = describirLoteDePropuestas(propuestas)

    expect(avisosComunes).toEqual([compartido])
    expect(filas[0].avisos).toEqual([])
    expect(filas[1].avisos).toEqual([soloDeLaSegunda])
  })

  it("con UNA sola propuesta, avisosComunes es siempre [] — no tiene sentido separar el único aviso que hay", () => {
    const propuestas = [propuesta({ avisos: ["Un aviso cualquiera."] })]

    const { avisosComunes, filas } = describirLoteDePropuestas(propuestas)

    expect(avisosComunes).toEqual([])
    expect(filas[0].avisos).toEqual(["Un aviso cualquiera."])
  })

  it("lote vacío: avisosComunes es []", () => {
    expect(describirLoteDePropuestas([]).avisosComunes).toEqual([])
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 *  Cómo termina el lote (Sprint 20, adenda) — el resumen que evita el turno
 *  duplicado por reintento en una pantalla que no decía si ya había terminado
 * ═══════════════════════════════════════════════════════════════════════════ */

function conteo(cambios: Partial<ConteoDelLote> = {}): ConteoDelLote {
  return { creados: 0, duplicados: 0, fallidos: 0, ...cambios }
}

describe("tituloDelResultadoDelLote", () => {
  it("todo creado, singular", () => {
    expect(tituloDelResultadoDelLote(conteo({ creados: 1 }))).toBe("Listo, el turno quedó cargado")
  })

  it("todo creado, plural", () => {
    expect(tituloDelResultadoDelLote(conteo({ creados: 10 }))).toBe("Listo, los turnos quedaron cargados")
  })

  it("parcial — algunos creados, otros fallidos", () => {
    expect(tituloDelResultadoDelLote(conteo({ creados: 4, fallidos: 6 }))).toBe(
      "Listo — entraron algunos, no todos",
    )
  })

  it("parcial — algunos creados, otros duplicados", () => {
    expect(tituloDelResultadoDelLote(conteo({ creados: 4, duplicados: 6 }))).toBe(
      "Listo — entraron algunos, no todos",
    )
  })

  it("todo duplicado (nada creado, nada fallido): 'ya los tenías cargados', no un genérico 'no creamos nada'", () => {
    expect(tituloDelResultadoDelLote(conteo({ duplicados: 10 }))).toBe("Ya los tenías cargados")
  })

  it("nada creado y también hubo fallidos: no es el caso de 'ya los tenías', es fracaso llano", () => {
    expect(tituloDelResultadoDelLote(conteo({ duplicados: 3, fallidos: 2 }))).toBe("No creamos ningún turno")
  })

  it("nada creado, nada duplicado, nada fallido: tampoco hay nada que decir de bueno", () => {
    expect(tituloDelResultadoDelLote(conteo())).toBe("No creamos ningún turno")
  })
})

describe("frasesDelResultadoDelLote", () => {
  it("todo creado — una sola frase, singular con 1", () => {
    expect(frasesDelResultadoDelLote(conteo({ creados: 1 }))).toEqual(["Creamos 1 turno."])
  })

  it("todo creado — plural con N", () => {
    expect(frasesDelResultadoDelLote(conteo({ creados: 10 }))).toEqual(["Creamos 10 turnos."])
  })

  it("parcial: se dicen TODOS los desenlaces que ocurrieron, no solo el principal", () => {
    const frases = frasesDelResultadoDelLote(conteo({ creados: 4, duplicados: 2, fallidos: 4 }))
    expect(frases).toEqual([
      "Creamos 4 turnos.",
      "2 ya estaban cargados, así que no los repetimos.",
      "4 no los pudimos cargar — abajo está el motivo de cada uno.",
    ])
  })

  it("duplicados en singular (1) vs plural (N)", () => {
    expect(frasesDelResultadoDelLote(conteo({ duplicados: 1 }))).toEqual([
      "1 ya estaba cargado, así que no lo repetimos.",
    ])
    expect(frasesDelResultadoDelLote(conteo({ duplicados: 5 }))).toEqual([
      "5 ya estaban cargados, así que no los repetimos.",
    ])
  })

  it("fallidos en singular (1) vs plural (N)", () => {
    expect(frasesDelResultadoDelLote(conteo({ fallidos: 1 }))).toEqual([
      "1 no lo pudimos cargar — abajo está el motivo.",
    ])
    expect(frasesDelResultadoDelLote(conteo({ fallidos: 5 }))).toEqual([
      "5 no los pudimos cargar — abajo está el motivo de cada uno.",
    ])
  })

  it("nada de nada: una frase que dice explícitamente que no quedó nada nuevo", () => {
    expect(frasesDelResultadoDelLote(conteo())).toEqual(["No quedó ningún turno nuevo cargado."])
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 *  Qué se puede crear y qué no (bug reportado con captura, agosto 2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Las diez sesiones sin fecha aparecían TILDADAS bajo un botón que ofrecía
 * "Crear los 10 turnos". El veredicto de creable/no creable es lo que impide
 * que la pantalla vuelva a prometer lo que ella misma declara imposible, y
 * espeja los requisitos reales de `crearTurnosEnLote`.
 */
describe("motivoNoCreable", () => {
  /** 20/08/2026 al mediodía de Ushuaia. */
  const AHORA = new Date("2026-08-20T12:00:00-03:00")

  it("un turno futuro con fecha, hora y especialidad se puede crear", () => {
    expect(motivoNoCreable(propuesta({ fecha: "2026-08-25", hora: "11:00" }), AHORA)).toBe("")
  })

  it("nombra el dato que falta, uno o varios", () => {
    expect(motivoNoCreable(propuesta({ fecha: "" }), AHORA)).toBe("Falta la fecha — no lo podemos crear.")
    expect(motivoNoCreable(propuesta({ hora: "" }), AHORA)).toBe("Falta la hora — no lo podemos crear.")
    expect(motivoNoCreable(propuesta({ especialidad: "" }), AHORA)).toBe(
      "Falta la especialidad — no lo podemos crear.",
    )
    expect(motivoNoCreable(propuesta({ fecha: "", hora: "" }), AHORA)).toBe(
      "Faltan la fecha y la hora — no lo podemos crear.",
    )
    expect(motivoNoCreable(propuesta({ fecha: "", hora: "", especialidad: "" }), AHORA)).toBe(
      "Faltan la fecha, la hora y la especialidad — no lo podemos crear.",
    )
  })

  it("una cita que ya pasó no se puede crear (la Server Action la rechazaría)", () => {
    expect(motivoNoCreable(propuesta({ fecha: "2026-08-13", hora: "18:30" }), AHORA)).toBe(
      "Ya pasó — no lo podemos crear.",
    )
    // Y el borde: hoy mismo, más tarde, sí se puede.
    expect(motivoNoCreable(propuesta({ fecha: "2026-08-20", hora: "19:00" }), AHORA)).toBe("")
    expect(motivoNoCreable(propuesta({ fecha: "2026-08-20", hora: "09:00" }), AHORA)).toBe(
      "Ya pasó — no lo podemos crear.",
    )
  })
})

describe("describirLoteDePropuestas — creable y motivo por fila", () => {
  const AHORA = new Date("2026-08-20T12:00:00-03:00")

  it("marca creable solo lo que se puede crear, con su motivo al lado", () => {
    const { filas } = describirLoteDePropuestas(
      [
        propuesta({ fecha: "2026-08-25", hora: "11:00" }),
        propuesta({ fecha: "", hora: "18:30" }),
        propuesta({ fecha: "2026-08-13", hora: "18:30" }),
      ],
      AHORA,
    )

    expect(filas.map((fila) => fila.creable)).toEqual([true, false, false])
    expect(filas.map((fila) => fila.motivo)).toEqual([
      "",
      "Falta la fecha — no lo podemos crear.",
      "Ya pasó — no lo podemos crear.",
    ])
  })
})

describe("faltaParaCrearElLote", () => {
  const AHORA = new Date("2026-08-20T12:00:00-03:00")

  function filasDe(propuestas: PropuestaTurno[]) {
    return describirLoteDePropuestas(propuestas, AHORA).filas
  }

  it("calla mientras quede algo que crear", () => {
    expect(
      faltaParaCrearElLote(filasDe([propuesta({ fecha: "2026-08-25" }), propuesta({ fecha: "" })])),
    ).toBe("")
  })

  it("con todas sin fecha, dice exactamente qué falta y la salida que queda", () => {
    const texto = faltaParaCrearElLote(filasDe([propuesta({ fecha: "" }), propuesta({ fecha: "" })]))
    expect(texto).toContain("Completá las fechas para poder crearlos")
    expect(texto).toContain("formulario de abajo")
  })

  it("con motivos distintos remite al motivo de cada fila", () => {
    const texto = faltaParaCrearElLote(
      filasDe([propuesta({ fecha: "" }), propuesta({ fecha: "2026-08-13", hora: "18:30" })]),
    )
    expect(texto).toContain("al lado de cada uno está el motivo")
  })

  it("sin filas no dice nada", () => {
    expect(faltaParaCrearElLote([])).toBe("")
  })
})
