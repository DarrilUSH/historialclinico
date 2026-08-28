/**
 * Test de `lib/consejos/contenido.ts#hrefCta` (tarea #14): la única pieza
 * con lógica de verdad en ese módulo -el resto es copy estático-. Sin DOM:
 * `environment: "node"`.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import { CONTENIDO_CONSEJOS, cuerpoInstalarApp, hrefCta } from "@/lib/consejos/contenido.ts"
import { CONSEJO_IDS } from "@/lib/consejos/tipos.ts"

describe("lib/consejos/contenido.ts", () => {
  it("CONTENIDO_CONSEJOS tiene una entrada por cada uno de los seis ids", () => {
    for (const id of CONSEJO_IDS) {
      expect(CONTENIDO_CONSEJOS[id]).toBeDefined()
      expect(CONTENIDO_CONSEJOS[id].titulo.length).toBeGreaterThan(0)
      expect(CONTENIDO_CONSEJOS[id].cuerpo.length).toBeGreaterThan(0)
    }
  })

  it("instalar_app lleva el CTA de instalar (dispara prompt(), no navega)", () => {
    expect(CONTENIDO_CONSEJOS.instalar_app.cta).toEqual({ tipo: "instalar_app", texto: "Instalar" })
  })

  it("notificaciones lleva el CTA de activación, no un enlace", () => {
    expect(CONTENIDO_CONSEJOS.notificaciones.cta?.tipo).toBe("activar_notificaciones")
  })

  describe("hrefCta", () => {
    it("null no tiene href", () => {
      expect(hrefCta(null, "perfil-1")).toBeNull()
    })

    it("activar_notificaciones no tiene href (no navega)", () => {
      expect(hrefCta({ tipo: "activar_notificaciones", texto: "Activar" }, "perfil-1")).toBeNull()
    })

    it("instalar_app no tiene href (dispara prompt(), no navega)", () => {
      expect(hrefCta({ tipo: "instalar_app", texto: "Instalar" }, "perfil-1")).toBeNull()
    })

    it("enlace devuelve el href tal cual, sin importar perfilPropioId", () => {
      expect(hrefCta({ tipo: "enlace", texto: "Ir", href: "/perfil/gmail" }, null)).toBe(
        "/perfil/gmail",
      )
      expect(hrefCta({ tipo: "enlace", texto: "Ir", href: "/perfil/gmail" }, "perfil-1")).toBe(
        "/perfil/gmail",
      )
    })

    it("enlace_perfil_propio le agrega ?perfil=<id> cuando hay perfil propio", () => {
      expect(
        hrefCta(
          { tipo: "enlace_perfil_propio", texto: "Ir", ruta: "/perfil/sos/enlace" },
          "f0000000-0000-4000-8000-000000000001",
        ),
      ).toBe("/perfil/sos/enlace?perfil=f0000000-0000-4000-8000-000000000001")
    })

    it("enlace_perfil_propio sin perfil propio (caso defensivo) usa la ruta pelada", () => {
      expect(
        hrefCta({ tipo: "enlace_perfil_propio", texto: "Ir", ruta: "/familia/enlace" }, null),
      ).toBe("/familia/enlace")
    })
  })

  it("las CTA de tipo enlace_perfil_propio usan Route Handlers propios (…/enlace), no la pantalla directa", () => {
    expect(CONTENIDO_CONSEJOS.ficha_sos.cta).toEqual({
      tipo: "enlace_perfil_propio",
      texto: "Completar ficha SOS",
      ruta: "/perfil/sos/enlace",
    })
    expect(CONTENIDO_CONSEJOS.compartir_familia.cta).toEqual({
      tipo: "enlace_perfil_propio",
      texto: "Compartir mi historial",
      ruta: "/familia/enlace",
    })
  })

  describe("cuerpoInstalarApp — el texto nunca contradice lo que se ve en pantalla", () => {
    it("'instalar': menciona el botón real que va a ver debajo, no la instrucción de iOS", () => {
      const texto = cuerpoInstalarApp("instalar")
      expect(texto).toContain("“Instalar”")
      expect(texto).not.toContain("Compartir")
    })

    it("'instrucciones_ios': da la instrucción manual completa, no promete ningún botón", () => {
      const texto = cuerpoInstalarApp("instrucciones_ios")
      expect(texto).toContain("Compartir")
      expect(texto).toContain("pantalla de inicio")
      expect(texto).not.toContain("“Instalar”")
    })

    it("'oculto': solo la mitad genérica, sin prometer un botón ni una instrucción que todavía no están", () => {
      const texto = cuerpoInstalarApp("oculto")
      expect(texto).not.toContain("Tocá")
      expect(texto).not.toContain("Compartir")
      expect(texto.length).toBeGreaterThan(0)
    })
  })
})
