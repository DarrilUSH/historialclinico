import { describe, expect, it } from "vitest"

import { aplicarPrecarga, type CamposPrecargables } from "@/lib/turnos/aplicar-precarga"

const VACIO: CamposPrecargables = {
  especialidad: "",
  medico: "",
  fecha: "",
  hora: "",
  lugarNombre: "",
  lugarDireccion: "",
  lugarCiudad: "",
  lugarProvincia: "",
  notasPreparacion: "",
}

function conCampos(base: CamposPrecargables, cambios: Partial<CamposPrecargables>): CamposPrecargables {
  return { ...base, ...cambios }
}

describe("aplicarPrecarga", () => {
  it("en un formulario vacío, la primera precarga completa todo lo que trae la propuesta", () => {
    const propuesta = conCampos(VACIO, { especialidad: "Ecografía", medico: "Dr. Juárez", fecha: "2026-10-07" })

    const { siguientes, ultimaPrecarga } = aplicarPrecarga(VACIO, propuesta, {})

    expect(siguientes.especialidad).toBe("Ecografía")
    expect(siguientes.medico).toBe("Dr. Juárez")
    expect(siguientes.fecha).toBe("2026-10-07")
    expect(ultimaPrecarga).toEqual({ especialidad: "Ecografía", medico: "Dr. Juárez", fecha: "2026-10-07" })
  })

  it("re-analizar con un mensaje distinto PISA lo que dejó la precarga anterior (intacto)", () => {
    const primera = conCampos(VACIO, { especialidad: "Ecografía", fecha: "2026-10-07" })
    const paso1 = aplicarPrecarga(VACIO, primera, {})

    // La persona no tocó nada — vuelve a analizar con otro mensaje.
    const segunda = conCampos(VACIO, { especialidad: "Traumatología y Ortopedia", fecha: "2026-11-20" })
    const paso2 = aplicarPrecarga(paso1.siguientes, segunda, paso1.ultimaPrecarga)

    expect(paso2.siguientes.especialidad).toBe("Traumatología y Ortopedia")
    expect(paso2.siguientes.fecha).toBe("2026-11-20")
  })

  it("re-analizar NO pisa un campo que la persona editó a mano después de la primera precarga", () => {
    const primera = conCampos(VACIO, { especialidad: "Ecografía", medico: "Dr. Juárez" })
    const paso1 = aplicarPrecarga(VACIO, primera, {})

    // La persona corrige "medico" a mano, sin tocar "especialidad".
    const actualesTrasEdicion = conCampos(paso1.siguientes, { medico: "Dra. Pérez (corregido a mano)" })

    const segunda = conCampos(VACIO, { especialidad: "Traumatología y Ortopedia", medico: "Otro Doctor" })
    const paso2 = aplicarPrecarga(actualesTrasEdicion, segunda, paso1.ultimaPrecarga)

    // "especialidad" no fue tocada a mano: la nueva precarga la pisa.
    expect(paso2.siguientes.especialidad).toBe("Traumatología y Ortopedia")
    // "medico" SÍ fue tocada a mano: se conserva la edición de la persona.
    expect(paso2.siguientes.medico).toBe("Dra. Pérez (corregido a mano)")
  })

  it("una edición manual queda protegida incluso en la precarga N+2 (no solo la siguiente)", () => {
    const paso1 = aplicarPrecarga(VACIO, conCampos(VACIO, { lugarNombre: "Clínica A" }), {})
    const editado = conCampos(paso1.siguientes, { lugarNombre: "Mi clínica de confianza" })
    const paso2 = aplicarPrecarga(editado, conCampos(VACIO, { lugarNombre: "Clínica B" }), paso1.ultimaPrecarga)
    const paso3 = aplicarPrecarga(paso2.siguientes, conCampos(VACIO, { lugarNombre: "Clínica C" }), paso2.ultimaPrecarga)

    expect(paso3.siguientes.lugarNombre).toBe("Mi clínica de confianza")
  })

  it("completa un campo vacío aunque la última precarga nunca lo haya tocado", () => {
    const primera = conCampos(VACIO, { especialidad: "Ecografía" }) // sin lugarNombre
    const paso1 = aplicarPrecarga(VACIO, primera, {})
    expect(paso1.siguientes.lugarNombre).toBe("")

    const segunda = conCampos(VACIO, { especialidad: "Ecografía", lugarNombre: "Clínica San Jorge" })
    const paso2 = aplicarPrecarga(paso1.siguientes, segunda, paso1.ultimaPrecarga)

    expect(paso2.siguientes.lugarNombre).toBe("Clínica San Jorge")
  })

  it("una propuesta que no trae nada para un campo no lo vacía", () => {
    const primera = conCampos(VACIO, { notasPreparacion: "Ayuno de 8 horas" })
    const paso1 = aplicarPrecarga(VACIO, primera, {})

    // La segunda propuesta no menciona preparación (mensaje de confirmación corto).
    const segunda = conCampos(VACIO, { fecha: "2026-05-26" })
    const paso2 = aplicarPrecarga(paso1.siguientes, segunda, paso1.ultimaPrecarga)

    expect(paso2.siguientes.notasPreparacion).toBe("Ayuno de 8 horas")
  })
})
