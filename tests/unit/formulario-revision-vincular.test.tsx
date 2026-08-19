// @vitest-environment jsdom

/**
 * Tests de regresión del hotfix **"Vincular no hace absolutamente nada"**
 * (reportado desde producción con captura: en el formulario de revisión, bajo
 * el campo Médico, aparecía "¿Es Dr. Laplace Juan Pedro que ya tenés cargado?
 * [Vincular] [× No]" y tocar "Vincular" no producía ningún cambio visible).
 *
 * ## Qué se rompió y por qué estos tests
 *
 * `usarMedicoDelDirectorio` hacía UNA sola cosa: `setMedico(doctor.full_name)`.
 * Y la franja se escondía sola SÓLO cuando el campo dejaba de coincidir con lo
 * que había detectado la IA (`medico === medicoInicial`). Pero el cotejo de
 * `lib/medicos/coincidencia-nombre.ts` es por subconjunto de tokens, y el caso
 * más común -el de la captura- es que el nombre extraído sea EXACTAMENTE el
 * que está en el directorio: entonces ese `setMedico` escribía el mismo valor
 * que ya había, el estado no cambiaba, y no pasaba nada visible.
 *
 * El caso "el nombre del directorio es distinto" (p. ej. la IA leyó
 * "VIDALES VALERIA" y el directorio dice "Dra. Valeria Andrea Vidales") SÍ
 * funcionaba antes, porque ahí el texto cambiaba de verdad. Por eso los tests
 * cubren los dos: el que estaba roto y el que ya andaba, para que el arreglo
 * no cambie el segundo.
 *
 * Además de la señal visible, ahora el vínculo se PERSISTE: el id del médico
 * viaja en el campo oculto `doctorId` y termina en `documents.doctor_id`.
 *
 *   npm run test -- formulario-revision-vincular
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DocumentoMedicoExtraido } from "@/lib/gemini/schemas"
import type { MedicoParaAutocompletar } from "@/lib/turnos/autocompletar-medico"

const confirmarDocumento = vi.fn()
const descartarDocumento = vi.fn()
const crearMedicoDesdeCruce = vi.fn()

vi.mock("@/app/(app)/(con-nav)/estudios/actions", () => ({
  confirmarDocumento: (...args: unknown[]) => confirmarDocumento(...args),
  descartarDocumento: (...args: unknown[]) => descartarDocumento(...args),
}))

vi.mock("@/app/(app)/(con-nav)/medicos/actions", () => ({
  crearMedicoDesdeCruce: (...args: unknown[]) => crearMedicoDesdeCruce(...args),
}))

// La franja de institución consulta el catálogo REFES con una Server Action:
// nada de eso hace falta acá y arrastraría red que jsdom no tiene.
vi.mock("@/components/lugares/franja-candidato-lugar", () => ({
  FranjaCandidatoLugar: () => null,
}))

const { FormularioRevision } = await import("@/components/documentos/formulario-revision")

const DOCUMENTO_ID = "11111111-1111-4111-8111-111111111111"
const MEDICO_ID = "990e8400-e29b-41d4-a716-4466554400aa"

const MEDICO_DEL_DIRECTORIO: MedicoParaAutocompletar = {
  id: MEDICO_ID,
  full_name: "Dr. Laplace Juan Pedro",
  specialties: ["Clínica Médica"],
  institution: "Centro Médico del Sur",
  address: null,
  city: null,
  province: null,
  latitude: null,
  longitude: null,
}

function extraccionCon(medico: string): DocumentoMedicoExtraido {
  return {
    titulo: "Análisis de sangre",
    categoria: "laboratory",
    fecha: "2026-03-12",
    resumen: "Todo dentro de los parámetros normales.",
    institucion: "Laboratorio Centro Médico del Sur",
    especialidad: "Clínica Médica",
    medico,
    numero_orden: "7781234",
    metricas: [],
    texto_completo: undefined,
  }
}

function montar(medicoExtraido: string, directorio: MedicoParaAutocompletar[] = [MEDICO_DEL_DIRECTORIO]) {
  return render(
    <FormularioRevision
      documentoId={DOCUMENTO_ID}
      extraccion={extraccionCon(medicoExtraido)}
      tituloProvisional="analisis.pdf"
      categoriaProvisional="other"
      fechaProvisional="2026-08-19"
      fechaMaximaIso="2026-08-19"
      medicos={directorio}
      catalogoDisponible={false}
      titulosExistentes={[]}
    />,
  )
}

function campoOcultoDoctorId(contenedor: HTMLElement): HTMLInputElement {
  const campo = contenedor.querySelector<HTMLInputElement>('input[name="doctorId"]')
  if (!campo) throw new Error("El formulario no tiene el campo oculto doctorId")
  return campo
}

beforeEach(() => {
  confirmarDocumento.mockReset()
  descartarDocumento.mockReset()
  crearMedicoDesdeCruce.mockReset()
})

afterEach(() => {
  cleanup()
})

describe("FormularioRevision — «Vincular» tiene que hacer algo visible", () => {
  it("con el nombre extraído IDÉNTICO al del directorio (el caso roto), vincular reemplaza la franja por la confirmación", () => {
    const { container } = montar("Dr. Laplace Juan Pedro")

    // El punto de partida del reporte: la franja ofrece vincular.
    expect(screen.getByText(/que ya tenés cargado/)).toBeTruthy()
    expect(campoOcultoDoctorId(container).value).toBe("")

    fireEvent.click(screen.getByRole("button", { name: "Vincular" }))

    // Antes del arreglo, esto seguía en pantalla y no pasaba nada más.
    expect(screen.queryByText(/que ya tenés cargado/)).toBeNull()
    expect(screen.getByText(/Vinculado a/)).toBeTruthy()
    expect(screen.getByText("Dr. Laplace Juan Pedro")).toBeTruthy()
    expect(campoOcultoDoctorId(container).value).toBe(MEDICO_ID)
  })

  it("con un nombre extraído DISTINTO (el caso que ya andaba), además normaliza el texto del campo", () => {
    const { container } = montar("LAPLACE JUAN")

    fireEvent.click(screen.getByRole("button", { name: "Vincular" }))

    expect(screen.getByText(/Vinculado a/)).toBeTruthy()
    expect(screen.getByLabelText("Médico")).toHaveProperty("value", "Dr. Laplace Juan Pedro")
    expect(campoOcultoDoctorId(container).value).toBe(MEDICO_ID)
  })

  it("la confirmación es una región viva, para que un lector de pantalla la anuncie", () => {
    const { container } = montar("Dr. Laplace Juan Pedro")
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }))

    const region = container.querySelector('[role="status"]')
    expect(region).toBeTruthy()
    expect(region?.textContent).toContain("Vinculado a")
  })

  it("«Quitar» deshace el vínculo y vacía el campo oculto", () => {
    const { container } = montar("Dr. Laplace Juan Pedro")
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }))
    fireEvent.click(screen.getByRole("button", { name: /Quitar/ }))

    expect(screen.queryByText(/Vinculado a/)).toBeNull()
    expect(campoOcultoDoctorId(container).value).toBe("")
  })

  it("editar el campo «Médico» a mano corta el vínculo: doctor_id y doctor_name no pueden contradecirse", () => {
    const { container } = montar("Dr. Laplace Juan Pedro")
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }))
    expect(campoOcultoDoctorId(container).value).toBe(MEDICO_ID)

    fireEvent.change(screen.getByLabelText("Médico"), { target: { value: "Dra. Otra Persona" } })

    expect(campoOcultoDoctorId(container).value).toBe("")
    expect(screen.queryByText(/Vinculado a/)).toBeNull()
  })

  it("«No» esconde la franja SIN vincular: se guarda el nombre tal como vino", () => {
    const { container } = montar("Dr. Laplace Juan Pedro")

    fireEvent.click(screen.getByRole("button", { name: /No/ }))

    expect(screen.queryByText(/que ya tenés cargado/)).toBeNull()
    expect(screen.queryByText(/Vinculado a/)).toBeNull()
    expect(campoOcultoDoctorId(container).value).toBe("")
    expect(screen.getByLabelText("Médico")).toHaveProperty("value", "Dr. Laplace Juan Pedro")
  })

  it("vincular NUNCA da de alta un médico: «Agregar» es el único camino que crea", () => {
    montar("Dr. Laplace Juan Pedro")
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }))
    expect(crearMedicoDesdeCruce).not.toHaveBeenCalled()
  })

  it("sin ningún médico parecido en el directorio, la franja ofrece «Agregar» y no hay vínculo", () => {
    const { container } = montar("Dra. Nadie Conocida", [MEDICO_DEL_DIRECTORIO])

    expect(screen.getByRole("button", { name: /Agregar/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Vincular" })).toBeNull()
    expect(campoOcultoDoctorId(container).value).toBe("")
  })
})
