/**
 * Tests de `lib/ubicacion/geocodificacion.ts` (Sprint 16, tarea 16.1).
 * `fetch` global mockeado -no se llama a Nominatim de verdad-: cubre el
 * armado de la consulta estructurada (calle+ciudad+provincia+país), el
 * `User-Agent` exigido por la política de uso de Nominatim, el parseo de la
 * respuesta y el criterio de "mejor esfuerzo" (nunca lanza).
 *
 *   npm run test -- geocodificacion
 */

import { describe, it, expect, vi, afterEach } from "vitest"

import { geocodificarDireccion } from "@/lib/ubicacion/geocodificacion"

function respuestaOk(cuerpo: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => cuerpo,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("lib/ubicacion/geocodificacion.ts#geocodificarDireccion", () => {
  it("devuelve null sin llamar a la red si no hay calle", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const resultado = await geocodificarDireccion({ ciudad: "La Plata", provincia: "Buenos Aires" })

    expect(resultado).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("arma la consulta estructurada con calle, ciudad, provincia y país", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respuestaOk([{ lat: "-34.9214", lon: "-57.9544" }]),
    )
    vi.stubGlobal("fetch", fetchMock)

    const resultado = await geocodificarDireccion({
      calle: "Avenida 51 Nº 315",
      ciudad: "La Plata",
      provincia: "Buenos Aires",
    })

    expect(resultado).toEqual({ latitud: -34.9214, longitud: -57.9544 })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain("https://nominatim.openstreetmap.org/search")
    expect(url).toContain("street=Avenida+51+N%C2%BA+315")
    expect(url).toContain("city=La+Plata")
    expect(url).toContain("state=Buenos+Aires")
    expect(url).toContain("country=Argentina")
    expect(url).toContain("countrycodes=ar")
    // NUNCA una ciudad fija tipo Ushuaia agregada de oficio.
    expect(url).not.toContain("Ushuaia")
  })

  it("identifica la app con un User-Agent real, como exige la política de uso de Nominatim", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaOk([{ lat: "-54.8", lon: "-68.3" }]))
    vi.stubGlobal("fetch", fetchMock)

    await geocodificarDireccion({ calle: "Gob. Paz 150" })

    const [, opciones] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = opciones.headers as Record<string, string>
    expect(headers["User-Agent"]).toMatch(/HistorialMedicoApp/)
    expect(headers["User-Agent"]).not.toBe("")
  })

  it("no manda city/state si no se cargaron -sin inventar una localidad-", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaOk([{ lat: "-54.8", lon: "-68.3" }]))
    vi.stubGlobal("fetch", fetchMock)

    await geocodificarDireccion({ calle: "Gob. Paz 150" })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).not.toContain("city=")
    expect(url).not.toContain("state=")
  })

  it("devuelve null si Nominatim no encuentra resultados", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaOk([]))
    vi.stubGlobal("fetch", fetchMock)

    const resultado = await geocodificarDireccion({ calle: "Calle inexistente 99999" })

    expect(resultado).toBeNull()
  })

  it("devuelve null ante un HTTP de error (mejor esfuerzo, nunca lanza)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => [] } as Response)
    vi.stubGlobal("fetch", fetchMock)

    const resultado = await geocodificarDireccion({ calle: "Gob. Paz 150" })

    expect(resultado).toBeNull()
  })

  it("devuelve null si la red falla (mejor esfuerzo, nunca lanza)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"))
    vi.stubGlobal("fetch", fetchMock)

    await expect(geocodificarDireccion({ calle: "Gob. Paz 150" })).resolves.toBeNull()
  })

  it("devuelve null si lat/lon no son numéricos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaOk([{ lat: "no-es-numero", lon: "-68.3" }]))
    vi.stubGlobal("fetch", fetchMock)

    const resultado = await geocodificarDireccion({ calle: "Gob. Paz 150" })

    expect(resultado).toBeNull()
  })
})
