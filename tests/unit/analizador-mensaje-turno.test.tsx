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
import {
  AVISO_SIN_ESPECIALIDAD,
  type PropuestaTurno,
  type ResultadoAnalisisMensaje,
} from "@/lib/turnos/construir-propuestas"

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
    fechaTexto: "21/08/2026",
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

/**
 * "Hoy" fijo para todo el archivo: 20/08/2026, el día en que llegaría el
 * mensaje de las diez sesiones. Desde que la pantalla no ofrece crear turnos
 * que ya pasaron (`motivoNoCreable`), las fechas de las propuestas dejaron de
 * ser decorativas: sin fijar el reloj, este test empezaría a contar menos
 * casillas a medida que pasa el tiempo real.
 */
const HOY = new Date("2026-08-20T12:00:00-03:00")

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(HOY)
  empujar.mockReset()
  crearTurnosEnLoteMock.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
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

/* ═════════════════════════════════════════════════════════════════════════
 *  La lista no puede ofrecer lo que ella misma declara imposible
 *  (bug reportado con captura, agosto 2026)
 * ═════════════════════════════════════════════════════════════════════════ */

/** Un análisis de varios turnos armado con las propuestas que se le pasen. */
function analisisCon(propuestas: PropuestaTurno[]): ResultadoAnalisisMensaje {
  return {
    relacion: "varios_turnos",
    explicacion: "Varias sesiones del mismo tratamiento.",
    contradiccion: null,
    propuestaPrincipal: propuestas[0],
    otrasPropuestas: propuestas.slice(1),
  }
}

describe("AnalizadorMensajeTurno — una fila que no se puede crear no se ofrece", () => {
  it("la sesión SIN fecha queda desmarcada, no se puede marcar, y el botón no la cuenta", async () => {
    mockearAnalisis(
      analisisCon([
        propuesta({ fecha: "2026-08-21", hora: "11:00", etiquetaSesion: "Sesión 1/3" }),
        propuesta({
          fecha: "",
          fechaTexto: "13 de Agosto",
          hora: "18:30",
          etiquetaSesion: "Sesión 2/3",
          avisos: ["El mensaje no traía una fecha que pudiéramos interpretar — completala vos."],
        }),
        propuesta({ fecha: "2026-08-25", hora: "11:00", etiquetaSesion: "Sesión 3/3" }),
      ]),
    )
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(3))
    const casillas = screen.getAllByRole("checkbox") as HTMLInputElement[]

    // La del medio no está tildada y no se puede tildar.
    expect(casillas.map((casilla) => casilla.checked)).toEqual([true, false, true])
    expect(casillas[1].disabled).toBe(true)
    expect(screen.getByText(/Falta la fecha — no lo podemos crear\./)).toBeTruthy()

    // Y el botón promete DOS, no tres.
    expect(screen.getByRole("button", { name: /Crear los 2 turnos/ })).toBeTruthy()

    // Tocarla no la marca ni cambia la cuenta.
    fireEvent.click(casillas[1])
    expect((screen.getAllByRole("checkbox")[1] as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole("button", { name: /Crear los 2 turnos/ })).toBeTruthy()
  })

  it("con las diez sin fecha, el botón queda apagado y dice qué falta (el bug de la captura)", async () => {
    mockearAnalisis(
      analisisCon(
        Array.from({ length: 10 }, () =>
          propuesta({
            fecha: "",
            fechaTexto: "13 de Agosto",
            hora: "18:30",
            numeroSesion: 0,
            totalSesiones: 0,
            etiquetaSesion: "",
          }),
        ),
      ),
    )
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(10))
    const casillas = screen.getAllByRole("checkbox") as HTMLInputElement[]

    // Ninguna tildada, ninguna marcable: antes estaban las diez tildadas.
    expect(casillas.some((casilla) => casilla.checked)).toBe(false)
    expect(casillas.every((casilla) => casilla.disabled)).toBe(true)

    // Y el botón ya no promete diez turnos imposibles.
    expect(screen.queryByRole("button", { name: /Crear los 10 turnos/ })).toBeNull()
    const boton = screen.getByRole("button", { name: /Crear los turnos/ }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    expect(screen.getByText(/Completá las fechas para poder crearlos/)).toBeTruthy()
  })

  it("una sesión que ya pasó tampoco se ofrece: se crean solo las futuras", async () => {
    mockearAnalisis(
      analisisCon([
        // "Hoy" es el 20/08/2026 al mediodía.
        propuesta({ fecha: "2026-08-13", hora: "18:30", etiquetaSesion: "Sesión 1/3" }),
        propuesta({ fecha: "2026-08-19", hora: "18:30", etiquetaSesion: "Sesión 2/3" }),
        propuesta({ fecha: "2026-08-21", hora: "17:30", etiquetaSesion: "Sesión 3/3" }),
      ]),
    )
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(3))
    const casillas = screen.getAllByRole("checkbox") as HTMLInputElement[]

    expect(casillas.map((casilla) => casilla.checked)).toEqual([false, false, true])
    expect(screen.getAllByText(/Ya pasó — no lo podemos crear\./)).toHaveLength(2)
    expect(screen.getByRole("button", { name: /Crear 1 turno/ })).toBeTruthy()
  })

  it("el mensaje que no dice la especialidad la pide UNA vez y desbloquea las diez", async () => {
    crearTurnosEnLoteMock.mockResolvedValue({
      error: null,
      resultados: [
        { indice: 0, estado: "creado", error: null },
        { indice: 1, estado: "creado", error: null },
      ],
      creados: 2,
      duplicados: 0,
      fallidos: 0,
    })
    // El mensaje real del kinesiólogo: dice "sesiones pendientes de su
    // tratamiento" y nunca nombra la práctica.
    mockearAnalisis(
      analisisCon([
        propuesta({
          especialidad: "",
          medico: "",
          fecha: "2026-08-26",
          hora: "19:30",
          etiquetaSesion: "",
          avisos: [AVISO_SIN_ESPECIALIDAD],
        }),
        propuesta({
          especialidad: "",
          medico: "",
          fecha: "2026-08-28",
          hora: "19:00",
          etiquetaSesion: "",
          avisos: [AVISO_SIN_ESPECIALIDAD],
        }),
      ]),
    )
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    // Arranca bloqueado, pero con el campo que lo destraba, no con un
    // "cargalos a mano".
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2))
    expect((screen.getByRole("button", { name: /Crear los turnos/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Completá la especialidad para poder crearlos/)).toBeTruthy()

    // Se completa una vez y valen las dos.
    fireEvent.change(screen.getByLabelText(/De qué son estas sesiones/), {
      target: { value: "Kinesiología" },
    })

    const boton = await screen.findByRole("button", { name: /Crear los 2 turnos/ })
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true)
    // Y el aviso de "no pudimos identificar la especialidad" se retira: dejarlo
    // señalaría como problema justo lo que la persona acaba de resolver.
    expect(screen.queryByText(AVISO_SIN_ESPECIALIDAD)).toBeNull()
    fireEvent.click(boton)

    await waitFor(() => expect(crearTurnosEnLoteMock).toHaveBeenCalledTimes(1))
    const payload = crearTurnosEnLoteMock.mock.calls[0][0] as { turnos: { especialidad: string }[] }
    expect(payload.turnos.map((t) => t.especialidad)).toEqual(["Kinesiología", "Kinesiología"])
  })

  it("la especialidad del lote solo rellena huecos: no pisa la que el mensaje sí traía", async () => {
    crearTurnosEnLoteMock.mockResolvedValue({
      error: null,
      resultados: [
        { indice: 0, estado: "creado", error: null },
        { indice: 1, estado: "creado", error: null },
      ],
      creados: 2,
      duplicados: 0,
      fallidos: 0,
    })
    mockearAnalisis(
      analisisCon([
        propuesta({ especialidad: "Fonoaudiología", fecha: "2026-08-26", hora: "19:30" }),
        propuesta({ especialidad: "", fecha: "2026-08-28", hora: "19:00" }),
      ]),
    )
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2))
    fireEvent.change(screen.getByLabelText(/De qué son estas sesiones/), {
      target: { value: "Kinesiología" },
    })

    fireEvent.click(await screen.findByRole("button", { name: /Crear los 2 turnos/ }))
    await waitFor(() => expect(crearTurnosEnLoteMock).toHaveBeenCalledTimes(1))

    const payload = crearTurnosEnLoteMock.mock.calls[0][0] as { turnos: { especialidad: string }[] }
    expect(payload.turnos.map((t) => t.especialidad)).toEqual(["Fonoaudiología", "Kinesiología"])
  })

  it("no pide la especialidad cuando el mensaje ya la trae en todas", async () => {
    mockearAnalisis(analisisDeDiezSesiones())
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(10))
    expect(screen.queryByLabelText(/De qué son estas sesiones/)).toBeNull()
  })

  it("la sesión sin HORA tampoco se puede crear, y lo dice", async () => {
    mockearAnalisis(
      analisisCon([
        propuesta({ fecha: "2026-08-21", hora: "11:00", etiquetaSesion: "Sesión 1/2" }),
        propuesta({ fecha: "2026-08-25", hora: "", etiquetaSesion: "Sesión 2/2" }),
      ]),
    )
    render(<AnalizadorMensajeTurno onAplicarPropuesta={vi.fn()} />)
    await analizar()

    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2))
    expect(screen.getByText(/Falta la hora — no lo podemos crear\./)).toBeTruthy()
    expect(screen.getByRole("button", { name: /Crear 1 turno/ })).toBeTruthy()
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
