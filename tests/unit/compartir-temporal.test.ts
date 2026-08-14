/**
 * Tests unitarios de `lib/documentos/compartir-temporal.ts` (Sprint 11, tarea
 * 11.2): los helpers puros del Web Share Target — path del objeto temporal,
 * validación del token de `/compartir?archivo=`, cálculo de vencimiento y
 * mensajes de error por código.
 *
 *   npm run test -- compartir-temporal
 */

import { describe, it, expect } from "vitest"

import {
  CODIGOS_ERROR_COMPARTIDO,
  TTL_COMPARTIDO_MINUTOS,
  construirPathCompartido,
  esCodigoErrorCompartido,
  esImagen,
  esTokenCompartidoValido,
  etiquetaMime,
  mensajeErrorCompartido,
  yaVencio,
} from "@/lib/documentos/compartir-temporal"

const USER_ID = "11111111-1111-4111-8111-111111111111"
const UUID_FIJO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

describe("lib/documentos/compartir-temporal.ts", () => {
  describe("construirPathCompartido", () => {
    it("arma {user_id}/{uuid}.{ext} con la extensión correcta por MIME", () => {
      expect(construirPathCompartido(USER_ID, "application/pdf", UUID_FIJO)).toBe(
        `${USER_ID}/${UUID_FIJO}.pdf`,
      )
      expect(construirPathCompartido(USER_ID, "image/jpeg", UUID_FIJO)).toBe(
        `${USER_ID}/${UUID_FIJO}.jpg`,
      )
      expect(construirPathCompartido(USER_ID, "image/png", UUID_FIJO)).toBe(
        `${USER_ID}/${UUID_FIJO}.png`,
      )
      expect(construirPathCompartido(USER_ID, "image/webp", UUID_FIJO)).toBe(
        `${USER_ID}/${UUID_FIJO}.webp`,
      )
    })

    it("genera un uuid propio cuando no se pasa uno", () => {
      const path = construirPathCompartido(USER_ID, "application/pdf")
      expect(path.startsWith(`${USER_ID}/`)).toBe(true)
      expect(path.endsWith(".pdf")).toBe(true)
      // Dos llamadas seguidas no colisionan.
      const otroPath = construirPathCompartido(USER_ID, "application/pdf")
      expect(path).not.toBe(otroPath)
    })

    it("nunca mete el profile_id: el primer segmento es siempre el user_id recibido", () => {
      const path = construirPathCompartido(USER_ID, "image/png", UUID_FIJO)
      expect(path.split("/")[0]).toBe(USER_ID)
    })
  })

  describe("etiquetaMime", () => {
    it("devuelve una etiqueta en español por cada MIME soportado", () => {
      expect(etiquetaMime("application/pdf")).toBe("PDF")
      expect(etiquetaMime("image/jpeg")).toBe("Foto JPG")
      expect(etiquetaMime("image/png")).toBe("Foto PNG")
      expect(etiquetaMime("image/webp")).toBe("Foto WebP")
    })

    it("cae a una etiqueta genérica para un MIME desconocido", () => {
      expect(etiquetaMime("application/octet-stream")).toBe("Archivo")
    })
  })

  describe("esImagen", () => {
    it("reconoce los tres MIME de imagen soportados", () => {
      expect(esImagen("image/jpeg")).toBe(true)
      expect(esImagen("image/png")).toBe(true)
      expect(esImagen("image/webp")).toBe(true)
    })

    it("un PDF no es una imagen", () => {
      expect(esImagen("application/pdf")).toBe(false)
    })
  })

  describe("esTokenCompartidoValido", () => {
    it("acepta un uuid con forma válida", () => {
      expect(esTokenCompartidoValido(UUID_FIJO)).toBe(true)
    })

    it("rechaza undefined, vacío y texto sin forma de uuid", () => {
      expect(esTokenCompartidoValido(undefined)).toBe(false)
      expect(esTokenCompartidoValido(null)).toBe(false)
      expect(esTokenCompartidoValido("")).toBe(false)
      expect(esTokenCompartidoValido("no-es-un-uuid")).toBe(false)
      expect(esTokenCompartidoValido("11111111-1111-1111-1111-11111111111")).toBe(false) // corto
    })
  })

  describe("yaVencio", () => {
    it("una fecha en el pasado ya venció", () => {
      const ahora = new Date("2026-08-14T12:00:00.000Z")
      expect(yaVencio("2026-08-14T11:00:00.000Z", ahora)).toBe(true)
    })

    it("una fecha en el futuro todavía no venció", () => {
      const ahora = new Date("2026-08-14T12:00:00.000Z")
      expect(yaVencio("2026-08-14T12:30:00.000Z", ahora)).toBe(false)
    })

    it("el instante exacto de vencimiento cuenta como vencido (borde inclusivo)", () => {
      const ahora = new Date("2026-08-14T12:00:00.000Z")
      expect(yaVencio("2026-08-14T12:00:00.000Z", ahora)).toBe(true)
    })

    it("TTL_COMPARTIDO_MINUTOS produce el mismo instante que yaVencio considera vencido", () => {
      const creado = new Date("2026-08-14T12:00:00.000Z")
      const expira = new Date(creado.getTime() + TTL_COMPARTIDO_MINUTOS * 60_000)
      expect(yaVencio(expira.toISOString(), expira)).toBe(true)
      const unMinutoAntes = new Date(expira.getTime() - 60_000)
      expect(yaVencio(expira.toISOString(), unMinutoAntes)).toBe(false)
    })
  })

  describe("esCodigoErrorCompartido / mensajeErrorCompartido", () => {
    it("reconoce cada código declarado y le da un mensaje propio en español", () => {
      for (const codigo of CODIGOS_ERROR_COMPARTIDO) {
        expect(esCodigoErrorCompartido(codigo)).toBe(true)
        expect(mensajeErrorCompartido(codigo).length).toBeGreaterThan(0)
      }
    })

    it("un código desconocido no es válido y cae al mensaje genérico", () => {
      expect(esCodigoErrorCompartido("cualquier_otra_cosa")).toBe(false)
      expect(mensajeErrorCompartido("cualquier_otra_cosa")).toBe(mensajeErrorCompartido("inesperado"))
    })

    it("los mensajes no se repiten entre sí (cada código dice algo distinto)", () => {
      const mensajes = CODIGOS_ERROR_COMPARTIDO.map((codigo) => mensajeErrorCompartido(codigo))
      expect(new Set(mensajes).size).toBe(mensajes.length)
    })
  })
})
