// @vitest-environment jsdom

/**
 * Tests de regresión del hotfix **"se bloquea el celular y la extracción se
 * corta y larga error"** (reportado desde producción: *"cuando está analizando
 * un archivo y se bloquea el celular o se cambia de aplicación se corta y
 * larga error, ¿no se puede hacer que quede en segundo plano y finalice?"*).
 *
 * ## Qué se rompía
 *
 * La pantalla mantenía UN `fetch` abierto durante toda la extracción (hasta un
 * minuto y medio) y deducía el desenlace del resultado de ese `fetch`. Cuando
 * Android congela la pestaña, un `fetch` en vuelo muere; el `catch` lo leía
 * como "la lectura falló" y pintaba el error terminal encima de un trabajo que
 * el servidor había terminado bien.
 *
 * Lo que estos tests fijan es la regla nueva: **el éxito del `fetch` y el
 * desenlace de la lectura son dos cosas distintas**. Una request muerta se
 * vuelve a intentar; el error terminal sólo lo puede declarar el servidor,
 * diciendo `estado: "error"` en el cuerpo.
 *
 *   npm run test -- pantalla-procesando
 */

import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { INTERVALO_CONSULTA_MS } from "@/lib/documentos/lectura-automatica"

/**
 * El formulario de revisión real arrastra Server Actions, Base UI y el
 * dictado por voz: acá sólo importa CON QUÉ lo llaman, así que se reemplaza
 * por un doble que imprime las tres cosas que decide esta pantalla.
 */
vi.mock("@/components/documentos/formulario-revision", () => ({
  FormularioRevision: ({
    extraccion,
    mensajeError,
    duplicadoSemantico,
  }: {
    extraccion: { titulo?: string | null } | null
    mensajeError?: string | null
    duplicadoSemantico?: { titulo: string } | null
  }) => (
    <div data-testid="formulario">
      <span data-testid="titulo-extraido">{extraccion?.titulo ?? "(sin extracción)"}</span>
      <span data-testid="mensaje-error">{mensajeError ?? "(sin error)"}</span>
      <span data-testid="duplicado">{duplicadoSemantico?.titulo ?? "(sin duplicado)"}</span>
    </div>
  ),
}))

const { PantallaProcesando } = await import(
  "@/app/(app)/(con-nav)/estudios/nuevo/procesando/pantalla-procesando"
)

const DOCUMENTO_ID = "11111111-1111-4111-8111-111111111111"

const EXTRACCION = {
  titulo: "Análisis de sangre",
  categoria: "laboratory",
  fecha: "2026-03-12",
  resumen: "Todo normal.",
  institucion: "Laboratorio Central",
  especialidad: "Clínica Médica",
  medico: "Dr. Laplace Juan Pedro",
  numero_orden: "7781234",
  metricas: [],
  texto_completo: null,
}

/** Respuesta HTTP mínima, con lo único que el componente le pide. */
function respuesta(status: number, cuerpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
  } as unknown as Response
}

function lectura(
  estado: "pendiente" | "procesando" | "listo" | "error",
  extra: Record<string, unknown> = {},
) {
  return { estado, extraccion: null, duplicadoSemantico: null, error: null, ...extra }
}

const fetchFalso = vi.fn()

function montar() {
  return render(
    <PantallaProcesando
      documentoId={DOCUMENTO_ID}
      tituloProvisional="analisis.pdf"
      categoriaProvisional="other"
      fechaProvisional="2026-08-19"
      fechaMaximaIso="2026-08-19"
      medicos={[]}
      catalogoDisponible={false}
      titulosExistentes={[]}
    />,
  )
}

/** Deja correr el bucle: avanza el reloj falso y vacía la cola de microtareas. */
async function avanzar(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Qué método usó cada llamada, en orden. */
function metodos(): string[] {
  return fetchFalso.mock.calls.map((llamada) => (llamada[1]?.method as string) ?? "GET")
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchFalso.mockReset()
  vi.stubGlobal("fetch", fetchFalso)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("PantallaProcesando — el bloqueo de pantalla no puede matar la lectura", () => {
  it("si el POST de arranque MUERE (pestaña congelada), NO muestra error: sigue preguntando y recupera el resultado", async () => {
    fetchFalso
      // El `fetch` se cae en el aire, exactamente como cuando Android congela
      // la pestaña. El servidor, del otro lado, ya recibió la orden y sigue.
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      // La persona vuelve: se pregunta y la lectura ya está.
      .mockResolvedValueOnce(respuesta(200, lectura("listo", { extraccion: EXTRACCION })))

    montar()
    await avanzar()

    // Sigue leyendo, sin error terminal a la vista. (Que no haya formulario
    // ES el estado "leyendo": el velo de espera se pinta en un portal y con un
    // retraso propio, y tiene su propio test en `base/velo-espera.test.tsx`.)
    expect(screen.queryByTestId("formulario")).toBeNull()

    await avanzar(INTERVALO_CONSULTA_MS)

    expect(screen.getByTestId("titulo-extraido").textContent).toBe("Análisis de sangre")
    expect(screen.getByTestId("mensaje-error").textContent).toBe("(sin error)")
    // Y la recuperación NO vuelve a pedir una lectura nueva: pregunta.
    expect(metodos()).toEqual(["POST", "GET"])
  })

  it("mientras la lectura está en curso espera y consulta, hasta que el servidor dice «listo»", async () => {
    fetchFalso
      .mockResolvedValueOnce(respuesta(202, lectura("procesando")))
      .mockResolvedValueOnce(respuesta(200, lectura("procesando")))
      .mockResolvedValueOnce(
        respuesta(
          200,
          lectura("listo", {
            extraccion: EXTRACCION,
            duplicadoSemantico: { documentoId: "x", titulo: "Otro análisis", fechaTexto: "1 de marzo de 2026", motivo: "mismo_numero_orden" },
          }),
        ),
      )

    montar()
    await avanzar()
    expect(screen.queryByTestId("formulario")).toBeNull()

    await avanzar(INTERVALO_CONSULTA_MS)
    expect(screen.queryByTestId("formulario")).toBeNull()

    await avanzar(INTERVALO_CONSULTA_MS)
    expect(screen.getByTestId("titulo-extraido").textContent).toBe("Análisis de sangre")
    expect(screen.getByTestId("duplicado").textContent).toBe("Otro análisis")
    expect(metodos()).toEqual(["POST", "GET", "GET"])
  })

  it("volver a primer plano despierta la espera sin aguardar el próximo tic", async () => {
    fetchFalso
      .mockResolvedValueOnce(respuesta(202, lectura("procesando")))
      .mockResolvedValueOnce(respuesta(200, lectura("listo", { extraccion: EXTRACCION })))

    montar()
    await avanzar()
    expect(fetchFalso).toHaveBeenCalledTimes(1)

    // Apenas 10 ms después del POST -muchísimo antes del intervalo-, la
    // persona vuelve del bloqueo de pantalla.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      await vi.advanceTimersByTimeAsync(10)
    })

    expect(screen.getByTestId("titulo-extraido").textContent).toBe("Análisis de sangre")
    expect(fetchFalso).toHaveBeenCalledTimes(2)
  })

  it("el ÚNICO error terminal es el que declara el servidor en el cuerpo", async () => {
    fetchFalso.mockResolvedValueOnce(
      respuesta(
        200,
        lectura("error", {
          error: "El servicio de lectura automática alcanzó su límite por hoy; podés cargar los datos a mano.",
        }),
      ),
    )

    montar()
    await avanzar()

    expect(screen.getByTestId("titulo-extraido").textContent).toBe("(sin extracción)")
    expect(screen.getByTestId("mensaje-error").textContent).toContain("alcanzó su límite por hoy")
    // No insiste: el servidor ya dijo que no se puede.
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it("un 4xx (sesión vencida, documento inexistente) sí corta, con el mensaje del servidor", async () => {
    fetchFalso.mockResolvedValueOnce(
      respuesta(404, { error: "No encontramos ese documento. Es posible que no exista o que no tengas acceso." }),
    )

    montar()
    await avanzar()

    expect(screen.getByTestId("mensaje-error").textContent).toContain("No encontramos ese documento")
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it("un 5xx es transitorio: se vuelve a preguntar en vez de rendirse", async () => {
    fetchFalso
      .mockResolvedValueOnce(respuesta(500, { error: "boom" }))
      .mockResolvedValueOnce(respuesta(200, lectura("listo", { extraccion: EXTRACCION })))

    montar()
    await avanzar()
    expect(screen.queryByTestId("formulario")).toBeNull()

    await avanzar(INTERVALO_CONSULTA_MS)
    expect(screen.getByTestId("titulo-extraido").textContent).toBe("Análisis de sangre")
  })

  it("si el estado quedó en «pendiente» (el POST nunca llegó), vuelve a pedir el arranque", async () => {
    fetchFalso
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(respuesta(200, lectura("pendiente")))
      .mockResolvedValueOnce(respuesta(202, lectura("procesando")))
      .mockResolvedValueOnce(respuesta(200, lectura("listo", { extraccion: EXTRACCION })))

    montar()
    await avanzar()
    await avanzar(INTERVALO_CONSULTA_MS)
    await avanzar(INTERVALO_CONSULTA_MS)

    expect(screen.getByTestId("titulo-extraido").textContent).toBe("Análisis de sangre")
    expect(metodos()).toEqual(["POST", "GET", "POST", "GET"])
  })

  it("con la conexión realmente caída y la pantalla a la vista, termina ofreciendo la carga a mano", async () => {
    fetchFalso.mockRejectedValue(new TypeError("Failed to fetch"))

    montar()
    await avanzar()
    for (let i = 0; i < 8; i += 1) {
      await avanzar(INTERVALO_CONSULTA_MS)
    }

    expect(screen.getByTestId("mensaje-error").textContent).toContain("Revisá tu conexión")
    expect(screen.getByTestId("titulo-extraido").textContent).toBe("(sin extracción)")
  })
})
