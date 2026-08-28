// @vitest-environment jsdom

/**
 * Test de render de `components/turnos/analizador-mensaje-turno.tsx` — la
 * pantalla de confirmación de un mensaje con VARIAS sesiones (agosto 2026).
 *
 * Es la verificación de la parte del arreglo que no se puede ver desde la
 * capa pura: que las diez propuestas que ya devolvía el analizador lleguen a
 * ser diez FILAS marcables y UN botón que las crea todas. El bug original no
 * estaba en el análisis -que devolvía las diez- sino exactamente acá: la
 * pantalla solo sabía volcar una en el formulario.
 *
 * Mismo criterio que `tests/unit/gmail-detalle-correo.test.tsx`:
 * `@vitest-environment jsdom` en la primera línea, sin
 * `@testing-library/jest-dom`, afirmando con la API del DOM directamente.
 *
 * `fetch` (el análisis) y la Server Action (la creación) van mockeados: acá
 * se prueba la PANTALLA, no la red ni la base.
 *
 *   npm run test
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AnalizadorMensajeTurno } from "@/components/turnos/analizador-mensaje-turno"
import type { PropuestaTurno, ResultadoAnalisisMensaje } from "@/lib/turnos/construir-propuestas"

const empujar = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: empujar }),
}))

const crearTurnosEnLoteMock = vi.fn()
vi.mock("@/app/(app)/(con-nav)/turnos/actions", () => ({
  crearTurnosEnLote: (datos: unknown) => crearTurnosEnLoteMock(datos),
}))

function propuesta(cambios: Partial<PropuestaTurno> = {}): PropuestaTurno {
  return {
    especialidad: "Kinesiología",
    especialidadInferida: false,
    medico: "Buet Daiana Edith",
    esEstudioNoProfesional: false,
    dudaOrdenNombre: false,
    fecha: "2026-08-21",
    anioInferido: false,
    hora: "11:00",
    discrepanciaDiaSemana: false,
    diaSemanaTexto: "",
    lugarNombre: "HB Central",
    lugarDireccion: "Av. Entre Ríos 2142",
    lugarCiudad: "",
    lugarProvincia: "",
    notasPreparacion: "",
    numeroSesion: 1,
    totalSesiones: 10,
    avisos: [],
    resumen: "",
    etiquetaSesion: "Sesión 1/10",
    ...cambios,
  }
}

/** Las diez sesiones del mensaje real, con su fecha, su hora y su número. */
function analisisDeDiezSesiones(): ResultadoAnalisisMensaje {
  const sesiones: [string, string][] = [
    ["2026-08-21", "11:00"],
    ["2026-08-24", "12:30"],
    ["2026-08-25", "11:00"],
    ["2026-08-26", "12:30"],
    ["2026-08-27", "11:00"],
    ["2026-08-28", "09:30"],
    ["2026-08-31", "11:00"],
    ["2026-09-01", "11:00"],
    ["2026-09-02", "08:30"],
    ["2026-09-03", "08:30"],
  ]

  const propuestas = sesiones.map(([fecha, hora], indice) =>
    propuesta({ fecha, hora, numeroSesion: indice + 1, etiquetaSesion: `Sesión ${indice + 1}/10` }),
  )

  return {
    relacion: "varios_turnos",
    explicacion: "Diez sesiones de kinesiología con el mismo profesional y distinta fecha.",
    contradiccion: null,
    propuestaPrincipal: propuestas[0],
    otrasPropuestas: propuestas.slice(1),
  }
}

function analisisDeUnTurno(): ResultadoAnalisisMensaje {
  return {
    relacion: "unico",
    explicacion: "Un solo turno.",
    contradiccion: null,
    propuestaPrincipal: propuesta({ numeroSesion: 0, totalSesiones: 0, etiquetaSesion: "" }),
    otrasPropuestas: [],
  }
}

/** Mockea la respuesta de `POST /api/turnos/analizar-mensaje`. */
function mockearAnalisis(resultado: ResultadoAnalisisMensaje) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ resultado }) }),
  )
}

/** Abre el bloque, pega un texto cualquiera y toca "Analizar". */
async function analizar() {
  fireEvent.click(screen.getByRole("button", { name: /Pegalo acá/ }))
  fireEvent.change(screen.getByLabelText(/Mensaje de la clínica/), {
    target: { value: "mensaje de la clínica" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Analizar" }))
}

beforeEach(() => {
  empujar.mockReset()
  crearTurnosEnLoteMock.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("AnalizadorMensajeTurno — mensaje con varias sesiones", () => {
  it("muestra las DIEZ sesiones como filas marcables, no una sola", async () => {
    mockearAnalisis(analisisDeDiezSesiones())
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    await waitFor(() => {
      expect(screen.getByText(/Encontramos 10 turnos en el mensaje/)).toBeTruthy()
    })

    // Diez casillas, todas marcadas por defecto: se desmarca lo que sobre.
    const casillas = screen.getAllByRole("checkbox") as HTMLInputElement[]
    expect(casillas).toHaveLength(10)
    expect(casillas.every((casilla) => casilla.checked)).toBe(true)

    // Cada fila dice cuál sesión es y CUÁNDO.
    expect(screen.getByText("Sesión 1/10")).toBeTruthy()
    expect(screen.getByText("Sesión 10/10")).toBeTruthy()
    expect(screen.getByText(/viernes 21 de agosto de 2026 · 11:00/)).toBeTruthy()
    expect(screen.getByText(/jueves 3 de septiembre de 2026 · 08:30/)).toBeTruthy()
  })

  it("los datos que comparten las diez se muestran UNA vez, no diez", async () => {
    mockearAnalisis(analisisDeDiezSesiones())
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    await waitFor(() => expect(screen.getByText("Todos comparten:")).toBeTruthy())
    expect(screen.getAllByText("Buet Daiana Edith")).toHaveLength(1)
    expect(screen.getAllByText("HB Central")).toHaveLength(1)
  })

  it("NO precarga el formulario en el camino de varios turnos", async () => {
    const aplicar = vi.fn()
    mockearAnalisis(analisisDeDiezSesiones())
    render(<AnalizadorMensajeTurno onAplicarPropuesta={aplicar} />)
    await analizar()

    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(10))
    // Precargarlo dejaría la sesión 1 en el formulario y "Guardar turno"
    // agregaría una fila repetida además del lote.
    expect(aplicar).not.toHaveBeenCalled()
  })

  it("UN botón crea todas las marcadas, y desmarcar una baja la cuenta", async () => {
    crearTurnosEnLoteMock.mockResolvedValue({
      error: null,
      resultados: Array.from({ length: 9 }, (_, indice) => ({
        indice,
        estado: "creado",
        error: null,
      })),
      creados: 9,
      duplicados: 0,
      fallidos: 0,
    })
    mockearAnalisis(analisisDeDiezSesiones())
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    await waitFor(() => expect(screen.getByRole("button", { name: /Crear los 10 turnos/ })).toBeTruthy())

    // Se desmarca la tercera sesión: el botón lo refleja.
    fireEvent.click(screen.getAllByRole("checkbox")[2])
    const boton = await screen.findByRole("button", { name: /Crear los 9 turnos/ })

    fireEvent.click(boton)

    await waitFor(() => expect(crearTurnosEnLoteMock).toHaveBeenCalledTimes(1))
    const payload = crearTurnosEnLoteMock.mock.calls[0][0] as { turnos: { fecha: string; notasPreparacion: string }[] }

    // Van las nueve marcadas, sin la que se desmarcó (25/08).
    expect(payload.turnos).toHaveLength(9)
    expect(payload.turnos.map((t) => t.fecha)).not.toContain("2026-08-25")
    // Y cada una lleva su número de sesión encabezando las notas.
    expect(payload.turnos[0].notasPreparacion).toBe("Sesión 1/10")
    expect(payload.turnos[2].notasPreparacion).toBe("Sesión 4/10")

    // Sprint 20 (adenda): el lote SIEMPRE termina en un resumen explícito, y el
    // formulario desaparece. Antes se navegaba solo cuando todo salía perfecto,
    // y con un turno saltado la persona quedaba mirando la lista con el botón
    // de crear todavía puesto — le costó un duplicado real a una usuaria.
    await waitFor(() => expect(screen.getByText(/Listo, los turnos quedaron cargados/)).toBeTruthy())
    expect(screen.getByText(/Creamos 9 turnos\./)).toBeTruthy()

    // Ya no queda NINGÚN control que pueda volver a escribir en la agenda.
    expect(screen.queryByRole("button", { name: /Crear los 9 turnos/ })).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()

    // Y hay una sola salida obvia, con el toast de la lista. (`Boton` con
    // `render={<Link/>}` produce un `<a role="button">`, el mismo patrón que ya
    // usa `components/documentos/formulario-revision.tsx`.)
    const verMisTurnos = screen.getByRole("button", { name: /Ver mis turnos/ })
    expect(verMisTurnos.getAttribute("href")).toBe("/turnos?creados=9")
  })

  it("«Cargar otro mensaje» vuelve al campo vacío, sin arrastrar el lote anterior", async () => {
    crearTurnosEnLoteMock.mockResolvedValue({
      error: null,
      resultados: Array.from({ length: 10 }, (_, indice) => ({
        indice,
        estado: "creado",
        error: null,
      })),
      creados: 10,
      duplicados: 0,
      fallidos: 0,
    })
    mockearAnalisis(analisisDeDiezSesiones())
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    fireEvent.click(await screen.findByRole("button", { name: /Crear los 10 turnos/ }))
    await waitFor(() => expect(screen.getByText(/Creamos 10 turnos\./)).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /Cargar otro mensaje/ }))

    // Vuelve el punto de partida: sin resumen y sin las diez propuestas.
    await waitFor(() => expect(screen.queryByText(/Creamos 10 turnos\./)).toBeNull())
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("un resultado parcial se cuenta honestamente y dice CUÁL falló", async () => {
    crearTurnosEnLoteMock.mockResolvedValue({
      error: null,
      resultados: [
        ...Array.from({ length: 6 }, (_, indice) => ({ indice, estado: "creado", error: null })),
        { indice: 6, estado: "error", error: "La fecha y la hora del turno tienen que ser futuras." },
        ...Array.from({ length: 3 }, (_, indice) => ({ indice: indice + 7, estado: "creado", error: null })),
      ],
      creados: 9,
      duplicados: 0,
      fallidos: 1,
    })
    mockearAnalisis(analisisDeDiezSesiones())
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    await waitFor(() => expect(screen.getByRole("button", { name: /Crear los 10 turnos/ })).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /Crear los 10 turnos/ }))

    await waitFor(() => expect(screen.getByText(/Listo — entraron algunos, no todos/)).toBeTruthy())
    expect(screen.getByText(/Creamos 9 turnos\./)).toBeTruthy()
    expect(screen.getByText(/1 no lo pudimos cargar/)).toBeTruthy()
    // Lo que la usuaria celebró se conserva entero: el motivo va pegado a la
    // fila que falló, no solo contado en el resumen.
    expect(
      screen.getByText(/No lo cargamos: La fecha y la hora del turno tienen que ser futuras./),
    ).toBeTruthy()
    // Con una falla tampoco se navega sola: la persona tiene que poder leer el
    // reporte. Pero el formulario ya no está, así que no puede volver a enviar.
    expect(empujar).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: /Crear los 10 turnos/ })).toBeNull()
  })

  it("pegar dos veces el mismo mensaje no duplica: los diez salen como ya cargados", async () => {
    crearTurnosEnLoteMock.mockResolvedValue({
      error: null,
      resultados: Array.from({ length: 10 }, (_, indice) => ({
        indice,
        estado: "duplicado",
        error: null,
      })),
      creados: 0,
      duplicados: 10,
      fallidos: 0,
    })
    mockearAnalisis(analisisDeDiezSesiones())
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    await waitFor(() => expect(screen.getByRole("button", { name: /Crear los 10 turnos/ })).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /Crear los 10 turnos/ }))

    await waitFor(() => expect(screen.getByText(/10 ya estaban cargados/)).toBeTruthy())
    expect(screen.getAllByText(/Ya estaba cargado/)).toHaveLength(10)
    expect(empujar).not.toHaveBeenCalled()
  })
})

describe("AnalizadorMensajeTurno — el camino de UN turno sigue intacto", () => {
  it("precarga el formulario y no muestra ninguna lista de confirmación", async () => {
    const aplicar = vi.fn()
    mockearAnalisis(analisisDeUnTurno())
    render(<AnalizadorMensajeTurno onAplicarPropuesta={aplicar} />)
    await analizar()

    await waitFor(() => expect(aplicar).toHaveBeenCalledTimes(1))
    expect(screen.getByText(/El formulario de abajo quedó precargado/)).toBeTruthy()
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
    expect(screen.queryByRole("button", { name: /Crear los/ })).toBeNull()
  })
})
