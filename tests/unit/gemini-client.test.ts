/**
 * Test de `lib/gemini/client.ts` — reintentos y timeouts (Sprint 19).
 *
 * Medido sobre 19 documentos reales: 2 de 19 (1 de cada 9) murieron con
 * `GeminiTimeoutError` a los 30s con el único reintento que había hasta acá
 * ya gastado, y no fue por tamaño de archivo -uno pesaba 204 KB, otro 2,6
 * KB-: al reintentar A MANO (una llamada más) salió a la primera. Eso
 * significa que el fallo es TRANSITORIO y el producto lo trataba como
 * definitivo. Esta suite prueba la corrección: más reintentos con espera
 * creciente, y que un error de CONTRATO (4xx) sigue sin reintentarse -sería
 * plata y tiempo tirados contra un problema que un intento más no arregla-.
 *
 * `@google/genai` va mockeado: el objetivo es la política de reintentos, no
 * salir a la red real. Los timeouts de 30s reales se simulan con timers
 * falsos (`vi.useFakeTimers`) para que la suite corra en milisegundos.
 *
 *   npm run test -- gemini-client
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -------------------------------------------------------------------

// `vi.mock` se iza al tope del archivo: todo lo que su fábrica usa tiene que
// existir antes, de ahí `vi.hoisted` (mismo patrón que `tests/unit/push-servidor.test.ts`).
const { generateContent, ApiErrorFalso } = vi.hoisted(() => {
  class ApiErrorFalso extends Error {
    status: number
    constructor(options: { message: string; status: number }) {
      super(options.message)
      this.name = "ApiError"
      this.status = options.status
    }
  }

  return {
    generateContent: vi.fn(),
    ApiErrorFalso,
  }
})

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent }
  },
  ApiError: ApiErrorFalso,
}))

// --- Setup ---------------------------------------------------------------

/** Respuesta válida mínima que `extraerJson` puede parsear. */
function respuestaOk(cuerpo: unknown) {
  return { text: JSON.stringify(cuerpo) }
}

/**
 * Simula una llamada que se CUELGA hasta que el `AbortController` interno de
 * `llamarGenerateContent` la aborta -mismo comportamiento que el SDK real
 * (Fetch) ante un `abortSignal`-: así el timeout de 30s se puede disparar con
 * timers falsos en vez de esperar 30 segundos reales.
 */
function respuestaQueCuelgaHastaAbortar() {
  return (args: { config: { abortSignal: AbortSignal } }) =>
    new Promise((_resolve, reject) => {
      args.config.abortSignal.addEventListener("abort", () => reject(new Error("AbortError")))
    })
}

async function importarCliente() {
  // Import dinámico DESPUÉS de que cada test configuró sus mocks/env: el
  // cliente de `@google/genai` se cachea a nivel de módulo
  // (`clienteCache`), así que `vi.resetModules()` + reimport da un módulo
  // fresco por test y evita que un test contamine al siguiente.
  return await import("@/lib/gemini/client")
}

beforeEach(() => {
  vi.resetModules()
  generateContent.mockReset()
  process.env.GEMINI_API_KEY = "clave-de-prueba"
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("lib/gemini/client.ts — reintentos ante error transitorio", () => {
  it("CASO REAL — un timeout aislado se recupera en el reintento (antes: 1 de cada 9 subidas moría acá)", async () => {
    const { extraerJson } = await importarCliente()

    generateContent
      .mockImplementationOnce(respuestaQueCuelgaHastaAbortar())
      .mockResolvedValueOnce(respuestaOk({ ok: true }))

    const promesa = extraerJson<{ ok: boolean }>({
      prompt: "extraé esto",
      schema: {} as never,
    })

    // Intento 1: timeout a los 30s.
    await vi.advanceTimersByTimeAsync(30_000)
    // Backoff antes del reintento 1 (creciente: el primero es más corto).
    await vi.advanceTimersByTimeAsync(1_000)

    const resultado = await promesa
    expect(resultado).toEqual({ ok: true })
    expect(generateContent).toHaveBeenCalledTimes(2)
  })

  it("agota los reintentos ante timeouts PERSISTENTES y termina en GeminiTimeoutError (nunca cuelga la pantalla para siempre)", async () => {
    const { extraerJson, GeminiTimeoutError } = await importarCliente()

    generateContent.mockImplementation(respuestaQueCuelgaHastaAbortar())

    const promesa = extraerJson({ prompt: "extraé esto", schema: {} as never })
    // Adjuntamos el rechazo esperado ANTES de terminar de avanzar los
    // timers: si no, un rechazo sin handler entre medio puede marcarse como
    // no manejado.
    const expectativa = expect(promesa).rejects.toBeInstanceOf(GeminiTimeoutError)

    // Intento 1 (30s) + espera 1 (1s) + intento 2 (30s) + espera 2 (3s) + intento 3, último (30s).
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await expectativa
    // Tres intentos en total: el inicial + los dos de `MAX_REINTENTOS`.
    expect(generateContent).toHaveBeenCalledTimes(3)
  })

  it("la espera entre reintentos es CRECIENTE: el primer backoff no alcanza para el segundo intento", async () => {
    const { extraerJson } = await importarCliente()

    generateContent
      .mockImplementationOnce(respuestaQueCuelgaHastaAbortar())
      .mockImplementationOnce(respuestaQueCuelgaHastaAbortar())
      .mockResolvedValueOnce(respuestaOk({ ok: true }))

    const promesa = extraerJson<{ ok: boolean }>({ prompt: "x", schema: {} as never })

    await vi.advanceTimersByTimeAsync(30_000) // intento 1 (timeout)
    await vi.advanceTimersByTimeAsync(1_000) // backoff 1: dispara el intento 2
    expect(generateContent).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(30_000) // intento 2 (timeout)
    // Con el backoff CORTO (1s) todavía no alcanzaría: recién a los 3s
    // (backoff 2) se dispara el intento 3. Probamos que 1s NO alcanza y que
    // completar hasta 3s sí.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(generateContent).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2_000) // completa los 3s del backoff 2
    expect(generateContent).toHaveBeenCalledTimes(3)

    const resultado = await promesa
    expect(resultado).toEqual({ ok: true })
  })

  it("reintenta ante HTTP 5xx (transitorio) y se recupera", async () => {
    const { extraerJson } = await importarCliente()

    generateContent
      .mockRejectedValueOnce(new ApiErrorFalso({ message: "Internal error", status: 503 }))
      .mockResolvedValueOnce(respuestaOk({ ok: true }))

    const promesa = extraerJson<{ ok: boolean }>({ prompt: "x", schema: {} as never })
    await vi.advanceTimersByTimeAsync(1_000) // backoff antes del reintento 1

    const resultado = await promesa
    expect(resultado).toEqual({ ok: true })
    expect(generateContent).toHaveBeenCalledTimes(2)
  })

  it("NO reintenta ante error de CONTRATO (HTTP 4xx): un solo intento, falla de inmediato", async () => {
    const { extraerJson, GeminiApiError } = await importarCliente()

    generateContent.mockRejectedValueOnce(new ApiErrorFalso({ message: "API key inválida", status: 401 }))

    await expect(extraerJson({ prompt: "x", schema: {} as never })).rejects.toBeInstanceOf(GeminiApiError)
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it("un ÉXITO al primer intento no espera nada ni reintenta", async () => {
    const { extraerJson } = await importarCliente()
    generateContent.mockResolvedValueOnce(respuestaOk({ ok: true }))

    const resultado = await extraerJson<{ ok: boolean }>({ prompt: "x", schema: {} as never })
    expect(resultado).toEqual({ ok: true })
    expect(generateContent).toHaveBeenCalledTimes(1)
  })
})
