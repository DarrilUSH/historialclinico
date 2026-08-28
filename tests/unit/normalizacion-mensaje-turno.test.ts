import { describe, expect, it } from "vitest"

import {
  cotejarDiaSemana,
  nombreDiaSemana,
  normalizarHora,
  normalizarNombreProfesional,
  parsearFechaArgentina,
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
})

describe("parsearFechaArgentina", () => {
  const AHORA = new Date(2026, 7, 17) // 17/08/2026 (mes 0-indexado: 7 = agosto)

  it("parsea DD/MM/AAAA sin inferir nada (fixture San Jorge)", () => {
    expect(parsearFechaArgentina("07/10/2024", AHORA)).toEqual({
      fecha: "2024-10-07",
      anioInferido: false,
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
    })
  })

  it("infiere el PRÓXIMO año cuando la fecha sin año ya pasó este año (fixture Casa Salud, 14/7)", () => {
    // "Hoy" es 17/08/2026: 14/7 ya pasó este año → el año que viene.
    expect(parsearFechaArgentina("14/7", AHORA)).toEqual({
      fecha: "2027-07-14",
      anioInferido: true,
    })
  })

  it("infiere el año que viene para el fixture de confirmación de Casa Salud (26/5)", () => {
    expect(parsearFechaArgentina("26/5", AHORA)).toEqual({
      fecha: "2027-05-26",
      anioInferido: true,
    })
  })

  it("infiere el año que viene para el fixture de Centro Loria (28/04)", () => {
    expect(parsearFechaArgentina("28/04", AHORA)).toEqual({
      fecha: "2027-04-28",
      anioInferido: true,
    })
  })

  it("mantiene el mismo año cuando la fecha sin año es HOY", () => {
    expect(parsearFechaArgentina("17/8", AHORA)).toEqual({
      fecha: "2026-08-17",
      anioInferido: true,
    })
  })

  it("devuelve null ante texto vacío o no reconocible", () => {
    expect(parsearFechaArgentina("", AHORA)).toBeNull()
    expect(parsearFechaArgentina("no hay fecha", AHORA)).toBeNull()
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
