/**
 * Tests de `lib/gemini/reintento.ts` — el helper PURO de reintento ante una
 * respuesta estructuralmente inválida (Sprint 10, tarea 10.3).
 *
 * `generar` y `validar` se pasan como dobles de prueba: no hay red, no hay
 * Gemini real, no hay Zod real. Lo que se prueba es el CONTROL de reintento
 * -cuántas veces se llama a `generar`, qué se devuelve en cada combinación-,
 * no la validación en sí (eso lo cubre `tests/unit/ficha-schema.test.ts`).
 */

import { describe, expect, it, vi } from "vitest"

import { conReintentoSiInvalido, type ResultadoValidacion } from "@/lib/gemini/reintento"

const OK = (datos: string): ResultadoValidacion<string> => ({ ok: true, datos })
const INVALIDO = (errores: string[]): ResultadoValidacion<string> => ({ ok: false, errores })

describe("lib/gemini/reintento.ts — conReintentoSiInvalido", () => {
  it("no reintenta si el primer intento ya es válido", async () => {
    const generar = vi.fn().mockResolvedValue({ crudo: 1 })
    const validar = vi.fn().mockReturnValue(OK("ficha-1"))

    const resultado = await conReintentoSiInvalido(generar, validar)

    expect(resultado).toEqual({ ok: true, datos: "ficha-1", intentos: 1 })
    expect(generar).toHaveBeenCalledTimes(1)
    expect(validar).toHaveBeenCalledTimes(1)
  })

  it("reintenta UNA vez si el primer intento es inválido, y devuelve el segundo si es válido", async () => {
    const generar = vi.fn().mockResolvedValueOnce({ crudo: 1 }).mockResolvedValueOnce({ crudo: 2 })
    const validar = vi
      .fn()
      .mockReturnValueOnce(INVALIDO(["falta el aviso"]))
      .mockReturnValueOnce(OK("ficha-2"))

    const resultado = await conReintentoSiInvalido(generar, validar)

    expect(resultado).toEqual({ ok: true, datos: "ficha-2", intentos: 2 })
    expect(generar).toHaveBeenCalledTimes(2)
    expect(validar).toHaveBeenCalledTimes(2)
  })

  it("si los DOS intentos son inválidos, devuelve ok:false con los errores del SEGUNDO", async () => {
    const generar = vi.fn().mockResolvedValueOnce({ crudo: 1 }).mockResolvedValueOnce({ crudo: 2 })
    const validar = vi
      .fn()
      .mockReturnValueOnce(INVALIDO(["error del primer intento"]))
      .mockReturnValueOnce(INVALIDO(["error del segundo intento"]))

    const resultado = await conReintentoSiInvalido(generar, validar)

    expect(resultado).toEqual({ ok: false, errores: ["error del segundo intento"] })
    expect(generar).toHaveBeenCalledTimes(2)
  })

  it("nunca llama a `generar` una TERCERA vez", async () => {
    const generar = vi.fn().mockResolvedValue({ crudo: 1 })
    const validar = vi.fn().mockReturnValue(INVALIDO(["siempre inválido"]))

    await conReintentoSiInvalido(generar, validar)

    expect(generar).toHaveBeenCalledTimes(2)
  })

  it("si `generar` LANZA en el primer intento, el error se propaga y NO se reintenta", async () => {
    const error = new Error("Gemini devolvió 500")
    const generar = vi.fn().mockRejectedValueOnce(error)
    const validar = vi.fn()

    await expect(conReintentoSiInvalido(generar, validar)).rejects.toThrow("Gemini devolvió 500")

    expect(generar).toHaveBeenCalledTimes(1)
    expect(validar).not.toHaveBeenCalled()
  })

  it("si `generar` LANZA en el segundo intento (tras un primer inválido), el error se propaga", async () => {
    const error = new Error("Timeout en el reintento")
    const generar = vi.fn().mockResolvedValueOnce({ crudo: 1 }).mockRejectedValueOnce(error)
    const validar = vi.fn().mockReturnValueOnce(INVALIDO(["primer intento inválido"]))

    await expect(conReintentoSiInvalido(generar, validar)).rejects.toThrow("Timeout en el reintento")

    expect(generar).toHaveBeenCalledTimes(2)
    expect(validar).toHaveBeenCalledTimes(1)
  })
})
