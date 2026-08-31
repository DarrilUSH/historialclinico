import { describe, expect, it } from "vitest"

import {
  cotejarDiaSemana,
  nombreDiaSemana,
  normalizarHora,
  normalizarNombreProfesional,
  parsearFechaArgentina,
  resolverFechasDeSerie,
} from "@/lib/turnos/normalizacion-mensaje"

describe("normalizarHora", () => {
  it("mantiene una hora ya en HH:mm", () => {
    expect(normalizarHora("15:21")).toBe("15:21")
    expect(normalizarHora("11:30")).toBe("11:30")
  })

  it("saca el sufijo HS en mayúscula, con espacio (fixture San Jorge)", () => {
    expect(normalizarHora("14:15 HS")).toBe("14:15")
  })

  it("saca el sufijo hs en minúscula, con espacio (fixture Instituto Médico Platense)", () => {
    expect(normalizarHora("09:45 hs")).toBe("09:45")
  })

  it("normaliza el punto decimal como separador (fixture Casa Salud confirmación)", () => {
    expect(normalizarHora("18.10hs")).toBe("18:10")
  })

  it("devuelve vacío si el texto está vacío — nunca inventa una hora", () => {
    expect(normalizarHora("")).toBe("")
    expect(normalizarHora("   ")).toBe("")
  })

  it("devuelve vacío ante un texto que no es una hora reconocible", () => {
    expect(normalizarHora("mediodía")).toBe("")
    expect(normalizarHora("25:99")).toBe("")
  })

  it("acolcha una hora de un solo dígito", () => {
    expect(normalizarHora("9:45")).toBe("09:45")
  })

  it("saca el sufijo 'hs.' con punto final (mensaje de las diez sesiones de kinesiología)", () => {
    expect(normalizarHora("18:30 hs.")).toBe("18:30")
    expect(normalizarHora("19:00 hs.")).toBe("19:00")
  })

  it("completa los minutos de una hora en punto dicha sin ellos", () => {
    expect(normalizarHora("19 hs")).toBe("19:00")
    expect(normalizarHora("9 h")).toBe("09:00")
  })

  it("sigue rechazando un número que no puede ser una hora", () => {
    expect(normalizarHora("35 hs")).toBe("")
  })
})

describe("parsearFechaArgentina", () => {
  const AHORA = new Date(2026, 7, 17) // 17/08/2026 (mes 0-indexado: 7 = agosto)

  /** Los tres campos que agregó la resolución de año por día de la semana, en su valor "no aplica". */
  const SIN_DIA_SEMANA = {
    anioConfirmadoPorDiaSemana: false,
    diaSemanaTexto: "",
    diaSemanaIncongruente: false,
  }

  it("parsea DD/MM/AAAA sin inferir nada (fixture San Jorge)", () => {
    expect(parsearFechaArgentina("07/10/2024", AHORA)).toEqual({
      fecha: "2024-10-07",
      anioInferido: false,
      ...SIN_DIA_SEMANA,
    })
  })

  it("rechaza una fecha de calendario inexistente", () => {
    expect(parsearFechaArgentina("31/02/2026", AHORA)).toBeNull()
  })

  it("infiere el año cuando la fecha sin año todavía no pasó este año", () => {
    // "Hoy" es 17/08/2026: 14/12 todavía no pasó → este año.
    expect(parsearFechaArgentina("14/12", AHORA)).toEqual({
      fecha: "2026-12-14",
      anioInferido: true,
      ...SIN_DIA_SEMANA,
    })
  })

  it("infiere el PRÓXIMO año cuando la fecha sin año ya pasó este año (fixture Casa Salud, 14/7)", () => {
    // "Hoy" es 17/08/2026: 14/7 ya pasó este año → el año que viene.
    expect(parsearFechaArgentina("14/7", AHORA)).toEqual({
      fecha: "2027-07-14",
      anioInferido: true,
      ...SIN_DIA_SEMANA,
    })
  })

  it("infiere el año que viene para el fixture de confirmación de Casa Salud (26/5)", () => {
    expect(parsearFechaArgentina("26/5", AHORA)).toEqual({
      fecha: "2027-05-26",
      anioInferido: true,
      ...SIN_DIA_SEMANA,
    })
  })

  it("infiere el año que viene para el fixture de Centro Loria (28/04)", () => {
    expect(parsearFechaArgentina("28/04", AHORA)).toEqual({
      fecha: "2027-04-28",
      anioInferido: true,
      ...SIN_DIA_SEMANA,
    })
  })

  it("mantiene el mismo año cuando la fecha sin año es HOY", () => {
    expect(parsearFechaArgentina("17/8", AHORA)).toEqual({
      fecha: "2026-08-17",
      anioInferido: true,
      ...SIN_DIA_SEMANA,
    })
  })

  /* ───────────────────────────────────────────────────────────────────────
   *  Mes en palabras y año elegido por el día de la semana (agosto 2026)
   *  El caso real: "Jueves 13 de Agosto - 18:30 hs." × 10, sin año.
   * ─────────────────────────────────────────────────────────────────────── */

  it("lee el mes EN PALABRAS y usa el día de la semana para elegir el año", () => {
    // El 13 de agosto cae jueves en 2026 (en 2025 fue miércoles, en 2027 viernes).
    expect(parsearFechaArgentina("13 de Agosto", AHORA, "Jueves")).toEqual({
      fecha: "2026-08-13",
      anioInferido: true,
      anioConfirmadoPorDiaSemana: true,
      diaSemanaTexto: "Jueves",
      diaSemanaIncongruente: false,
    })
  })

  it("tolera que el día de la semana venga PEGADO a la fecha, sin campo aparte", () => {
    expect(parsearFechaArgentina("Jueves 13 de Agosto", AHORA)).toEqual({
      fecha: "2026-08-13",
      anioInferido: true,
      anioConfirmadoPorDiaSemana: true,
      diaSemanaTexto: "Jueves",
      diaSemanaIncongruente: false,
    })
  })

  it("acepta el mes en minúscula y el día con tilde ('miércoles 2 de septiembre')", () => {
    expect(parsearFechaArgentina("2 de septiembre", AHORA, "miércoles")).toMatchObject({
      fecha: "2026-09-02",
      anioConfirmadoPorDiaSemana: true,
    })
  })

  it("acepta el mes abreviado y la variante 'setiembre'", () => {
    expect(parsearFechaArgentina("2 sep", AHORA, "miércoles")).toMatchObject({ fecha: "2026-09-02" })
    expect(parsearFechaArgentina("2 de setiembre", AHORA, "miércoles")).toMatchObject({
      fecha: "2026-09-02",
    })
  })

  it("respeta el año cuando la fecha en palabras SÍ lo trae escrito", () => {
    expect(parsearFechaArgentina("29 de Diciembre de 2026", AHORA, "Martes")).toEqual({
      fecha: "2026-12-29",
      anioInferido: false,
      anioConfirmadoPorDiaSemana: false,
      diaSemanaTexto: "Martes",
      diaSemanaIncongruente: false,
    })
  })

  it("elige un año PASADO si es el que coincide — no fuerza futuro", () => {
    // "Hoy" es 17/08/2026 y el 13/08 ya pasó: se resuelve igual, con su año
    // correcto. Que la sesión ya haya ocurrido lo decide después quien crea.
    expect(parsearFechaArgentina("13 de agosto", AHORA, "jueves")?.fecha).toBe("2026-08-13")
  })

  it("deja la fecha VACÍA cuando el día de la semana no cae en ningún año candidato", () => {
    // El 13 de agosto no cae lunes ni en 2025, ni en 2026, ni en 2027: el
    // mensaje tiene un error de tipeo y lo tiene que resolver una persona.
    expect(parsearFechaArgentina("13 de Agosto", AHORA, "Lunes")).toEqual({
      fecha: "",
      anioInferido: false,
      anioConfirmadoPorDiaSemana: false,
      diaSemanaTexto: "Lunes",
      diaSemanaIncongruente: true,
    })
  })

  it("el año que declara el modelo NO le gana a la ventana de años vecinos", () => {
    expect(parsearFechaArgentina("13 de Agosto", AHORA, "Jueves", 2020)?.fecha).toBe("2026-08-13")
  })

  it("el año que declara el modelo tampoco decide solo: tiene que cerrar con el día de la semana", () => {
    // 2031 es un año del que el modelo no sabe nada útil, y el 13/08/2031 no
    // cae lunes: no hay candidato válido y la fecha queda para la persona.
    expect(parsearFechaArgentina("13 de Agosto", AHORA, "Lunes", 2031)?.fecha).toBe("")
  })

  it("sin día de la semana, una fecha en palabras cae en la regla de siempre", () => {
    // 13/08 ya pasó respecto de 17/08/2026 → la próxima ocurrencia, marcada
    // como inferida y SIN confirmar, para que la pantalla lo pregunte.
    expect(parsearFechaArgentina("13 de Agosto", AHORA)).toEqual({
      fecha: "2027-08-13",
      anioInferido: true,
      ...SIN_DIA_SEMANA,
    })
  })

  it("un mes que no existe no es una fecha", () => {
    expect(parsearFechaArgentina("13 de Brumario", AHORA, "Jueves")).toBeNull()
  })

  it("devuelve null ante texto vacío o no reconocible", () => {
    expect(parsearFechaArgentina("", AHORA)).toBeNull()
    expect(parsearFechaArgentina("no hay fecha", AHORA)).toBeNull()
  })
})

describe("resolverFechasDeSerie", () => {
  /** Atajo: una entrada de serie con su fecha, su día de la semana y sin año declarado. */
  function entrada(fechaTexto: string, diaSemanaTexto = "") {
    return { fechaTexto, diaSemanaTexto, anioProbable: 0 }
  }

  it("resuelve las diez sesiones del mensaje real, todas en 2026", () => {
    // El mensaje se pegó el 28/08/2026, con la serie ya empezada.
    const ahora = new Date(2026, 7, 28)
    const serie = [
      entrada("13 de Agosto", "Jueves"),
      entrada("19 de Agosto", "Miércoles"),
      entrada("21 de Agosto", "Viernes"),
      entrada("26 de Agosto", "Miércoles"),
      entrada("28 de Agosto", "Viernes"),
      entrada("31 de Agosto", "Lunes"),
      entrada("2 de Septiembre", "Miércoles"),
      entrada("4 de Septiembre", "Viernes"),
      entrada("7 de Septiembre", "Lunes"),
      entrada("9 de Septiembre", "Miércoles"),
    ]

    expect(resolverFechasDeSerie(serie, ahora).map((fecha) => fecha?.fecha)).toEqual([
      "2026-08-13",
      "2026-08-19",
      "2026-08-21",
      "2026-08-26",
      "2026-08-28",
      "2026-08-31",
      "2026-09-02",
      "2026-09-04",
      "2026-09-07",
      "2026-09-09",
    ])
  })

  it("una serie puede cruzar el año nuevo: cada fecha valida el SUYO", () => {
    const ahora = new Date(2026, 11, 20) // 20/12/2026
    const serie = [
      entrada("29 de Diciembre", "Martes"),
      entrada("31 de Diciembre", "Jueves"),
      entrada("2 de Enero", "Sábado"),
      entrada("5 de Enero", "Martes"),
    ]

    expect(resolverFechasDeSerie(serie, ahora).map((fecha) => fecha?.fecha)).toEqual([
      "2026-12-29",
      "2026-12-31",
      "2027-01-02",
      "2027-01-05",
    ])
  })

  it("ancla al año de sus hermanas la fecha que no trae día de la semana", () => {
    // Suelto, "19 de Agosto" leído el 28/08/2026 se iría a 2027 (la próxima
    // ocurrencia futura) y se despegaría un año del resto de la serie.
    const ahora = new Date(2026, 7, 28)
    const serie = [entrada("13 de Agosto", "Jueves"), entrada("19 de Agosto"), entrada("21 de Agosto", "Viernes")]

    expect(resolverFechasDeSerie(serie, ahora).map((fecha) => fecha?.fecha)).toEqual([
      "2026-08-13",
      "2026-08-19",
      "2026-08-21",
    ])
  })

  it("el anclaje también cruza el año nuevo: el 2 de enero se va con diciembre", () => {
    const ahora = new Date(2026, 11, 20)
    const serie = [entrada("29 de Diciembre", "Martes"), entrada("2 de Enero")]

    expect(resolverFechasDeSerie(serie, ahora).map((fecha) => fecha?.fecha)).toEqual([
      "2026-12-29",
      "2027-01-02",
    ])
  })

  it("una fecha incongruente de la serie queda vacía y no arrastra a las demás", () => {
    const ahora = new Date(2026, 7, 28)
    const serie = [
      entrada("13 de Agosto", "Jueves"),
      entrada("14 de Agosto", "Lunes"), // el 14/08 no cae lunes en ningún año candidato
      entrada("21 de Agosto", "Viernes"),
    ]

    const resueltas = resolverFechasDeSerie(serie, ahora)
    expect(resueltas.map((fecha) => fecha?.fecha)).toEqual(["2026-08-13", "", "2026-08-21"])
    expect(resueltas[1]?.diaSemanaIncongruente).toBe(true)
  })

  it("sin ninguna fecha respaldada no hay a qué anclar: cada una queda con su resolución individual", () => {
    const ahora = new Date(2026, 7, 17)
    const serie = [entrada("28/04"), entrada("26/5")]

    expect(resolverFechasDeSerie(serie, ahora).map((fecha) => fecha?.fecha)).toEqual([
      "2027-04-28",
      "2027-05-26",
    ])
  })
})

describe("nombreDiaSemana / cotejarDiaSemana", () => {
  it("calcula el día de la semana real de una fecha ISO", () => {
    // 07/10/2024 es lunes.
    expect(nombreDiaSemana("2024-10-07")).toBe("lunes")
  })

  it("coincide con el día completo, insensible a mayúsculas y tildes", () => {
    expect(cotejarDiaSemana("2024-10-07", "Lunes")).toBe(true)
  })

  it("coincide con una abreviatura del día real (fixture Instituto Médico Platense, 'Mie' 08/10/2025)", () => {
    // 08/10/2025 es miércoles.
    expect(nombreDiaSemana("2025-10-08")).toBe("miercoles")
    expect(cotejarDiaSemana("2025-10-08", "Mie")).toBe(true)
  })

  it("detecta una discrepancia real entre el día declarado y el real", () => {
    // 07/10/2024 es lunes, no martes.
    expect(cotejarDiaSemana("2024-10-07", "martes")).toBe(false)
  })

  it("devuelve null cuando no hay texto de día para cotejar", () => {
    expect(cotejarDiaSemana("2024-10-07", "")).toBeNull()
  })

  it("devuelve null ante un texto demasiado corto para identificar un día con confianza", () => {
    expect(cotejarDiaSemana("2024-10-07", "lu")).toBeNull()
  })
})

describe("normalizarNombreProfesional", () => {
  it("reordena 'Apellido, Nombre' a 'Nombre Apellido' y saca el sufijo administrativo (fixture Instituto Médico Platense)", () => {
    expect(normalizarNombreProfesional("Demarchi, Edgardo (C)")).toEqual({
      texto: "Edgardo Demarchi",
      dudaOrden: false,
    })
  })

  it("tolera espacios irregulares alrededor de la coma (fixture TCba, paciente — mismo formato que un profesional)", () => {
    expect(normalizarNombreProfesional("Sosa , Carla Maria Ines")).toEqual({
      texto: "Carla Maria Ines Sosa",
      dudaOrden: false,
    })
  })

  it("con tratamiento (Dr./Dra.) al principio, el orden ya es natural — sin duda (fixture San Jorge)", () => {
    expect(normalizarNombreProfesional("Dr. Juárez")).toEqual({ texto: "Dr. Juárez", dudaOrden: false })
  })

  it("con tratamiento Dra. (fixture Casa Salud)", () => {
    expect(normalizarNombreProfesional("Dra. Rosario Diulio")).toEqual({
      texto: "Dra. Rosario Diulio",
      dudaOrden: false,
    })
  })

  it("una sola palabra (solo apellido) no tiene nada que reordenar (fixture confirmación Casa Salud)", () => {
    expect(normalizarNombreProfesional("Ardans")).toEqual({ texto: "Ardans", dudaOrden: false })
  })

  it("dos palabras sueltas sin coma ni título quedan marcadas como orden ambiguo (fixture Británico profesional)", () => {
    expect(normalizarNombreProfesional("Vidales Valeria")).toEqual({
      texto: "Vidales Valeria",
      dudaOrden: true,
    })
  })

  it("mismo caso ambiguo con el fixture de TCba Salguero ('Acha Agustina')", () => {
    expect(normalizarNombreProfesional("Acha Agustina")).toEqual({
      texto: "Acha Agustina",
      dudaOrden: true,
    })
  })

  it("devuelve vacío sin duda si el texto de entrada está vacío", () => {
    expect(normalizarNombreProfesional("")).toEqual({ texto: "", dudaOrden: false })
  })

  it("con tratamiento pegado adelante del apellido y coma, lo saca antes de reordenar y lo re-antepone (caso reportado)", () => {
    expect(normalizarNombreProfesional("LIC. RUIZ DIAZ, GABRIELA")).toEqual({
      texto: "LIC. GABRIELA RUIZ DIAZ",
      dudaOrden: false,
    })
  })

  it("mismo caso con Dr. y Dra. con coma", () => {
    expect(normalizarNombreProfesional("Dr. Fernandez, Carlos")).toEqual({
      texto: "Dr. Carlos Fernandez",
      dudaOrden: false,
    })
    expect(normalizarNombreProfesional("Dra. Gomez, Ana")).toEqual({
      texto: "Dra. Ana Gomez",
      dudaOrden: false,
    })
  })

  it("tratamiento sin punto, estilo 'DRA ' con coma", () => {
    expect(normalizarNombreProfesional("DRA RUIZ DIAZ, GABRIELA")).toEqual({
      texto: "DRA GABRIELA RUIZ DIAZ",
      dudaOrden: false,
    })
  })

  it("sin tratamiento, el reordenamiento por coma no cambia (fixture ya cubierto, chequeo directo)", () => {
    expect(normalizarNombreProfesional("Fernandez, Carlos")).toEqual({
      texto: "Carlos Fernandez",
      dudaOrden: false,
    })
  })

  it("apellidos-trampa: 'Licciardi' y 'Drago' no son tratamientos aunque empiecen igual que 'Lic'/'Dr'", () => {
    expect(normalizarNombreProfesional("Licciardi, Maria")).toEqual({
      texto: "Maria Licciardi",
      dudaOrden: false,
    })
    expect(normalizarNombreProfesional("Drago, Juan")).toEqual({
      texto: "Juan Drago",
      dudaOrden: false,
    })
  })

  it("nombre ya en orden natural con tratamiento sin punto, sin coma, no cambia", () => {
    expect(normalizarNombreProfesional("Dra Diulio")).toEqual({
      texto: "Dra Diulio",
      dudaOrden: false,
    })
  })

  it("cubre los demás tratamientos del listado (Bioq./Klgo./Klga./Od./Obst./Farm./Téc.) con coma", () => {
    expect(normalizarNombreProfesional("Bioq. Ruiz Diaz, Gabriela")).toEqual({
      texto: "Bioq. Gabriela Ruiz Diaz",
      dudaOrden: false,
    })
    expect(normalizarNombreProfesional("Klgo. Ruiz Diaz, Gabriela")).toEqual({
      texto: "Klgo. Gabriela Ruiz Diaz",
      dudaOrden: false,
    })
    expect(normalizarNombreProfesional("Klga. Ruiz Diaz, Gabriela")).toEqual({
      texto: "Klga. Gabriela Ruiz Diaz",
      dudaOrden: false,
    })
    expect(normalizarNombreProfesional("Od. Ruiz Diaz, Gabriela")).toEqual({
      texto: "Od. Gabriela Ruiz Diaz",
      dudaOrden: false,
    })
    expect(normalizarNombreProfesional("Obst. Ruiz Diaz, Gabriela")).toEqual({
      texto: "Obst. Gabriela Ruiz Diaz",
      dudaOrden: false,
    })
    expect(normalizarNombreProfesional("Farm. Ruiz Diaz, Gabriela")).toEqual({
      texto: "Farm. Gabriela Ruiz Diaz",
      dudaOrden: false,
    })
    expect(normalizarNombreProfesional("Téc. Ruiz Diaz, Gabriela")).toEqual({
      texto: "Téc. Gabriela Ruiz Diaz",
      dudaOrden: false,
    })
  })
})
