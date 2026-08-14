/**
 * Tests del payload offline de la ficha SOS (`lib/sos/payload.ts`, Sprint 8,
 * tarea 8.4).
 *
 * Lo que se prueba es **el contrato de `docs/modelo-sos.md` §7**, no la
 * implementación: los nombres de los campos, las cuatro reglas duras y los
 * casos de ausencia. Importa más que un test común porque este JSON se lee de
 * una copia guardada en el disco de un teléfono, posiblemente semanas después
 * del deploy que lo escribió: no hay ninguna otra oportunidad de detectar que
 * un campo cambió de nombre.
 */

import { describe, expect, it } from "vitest"

import {
  VERSION_PAYLOAD_SOS,
  construirPayloadSos,
  urlImagenCredencial,
  type CoberturaPrincipalCruda,
} from "@/lib/sos/payload"
import type { Perfil } from "@/types/dominio"

const GENERADO_AT = new Date("2026-08-14T17:30:00.000Z")

/** Perfil mínimo con las ocho columnas SOS. El resto no lo mira el payload. */
function perfilDe(parcial: Partial<Perfil> = {}): Perfil {
  return {
    id: "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    full_name: "Roberto Gómez",
    national_id: "12345678",
    date_of_birth: "1948-03-02",
    blood_type: "O+",
    allergies: ["Penicilina"],
    chronic_conditions: ["Hipertensión arterial"],
    critical_medication: ["Acenocumarol 4 mg"],
    emergency_contact: "María Gómez",
    emergency_contact_phone: "+54 9 2901 612345",
    emergency_contact_relationship: "hija",
    sos_notes: "Marcapasos desde 2019.",
    sos_updated_at: "2026-04-03T12:12:00.000Z",
    ...parcial,
  } as Perfil
}

const COBERTURA: CoberturaPrincipalCruda = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  provider: "OSDE",
  plan: "210",
  member_number: "61234567801",
  front_storage_path: "perfil/credencial-frente.jpg",
  back_storage_path: "perfil/credencial-dorso.jpg",
}

describe("lib/sos/payload.ts — forma del contrato (§7)", () => {
  it("arma el payload completo con los nombres exactos del contrato", () => {
    expect(construirPayloadSos(perfilDe(), COBERTURA, GENERADO_AT)).toEqual({
      version: 1,
      generado_at: "2026-08-14T17:30:00.000Z",
      perfil: {
        id: "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        nombre_completo: "Roberto Gómez",
        documento: "12345678",
        fecha_nacimiento: "1948-03-02",
      },
      vitales: {
        grupo_sanguineo: "O+",
        alergias: ["Penicilina"],
        condiciones_cronicas: ["Hipertensión arterial"],
        medicacion_critica: ["Acenocumarol 4 mg"],
        observaciones: "Marcapasos desde 2019.",
        actualizado_at: "2026-04-03T12:12:00.000Z",
      },
      contacto_emergencia: {
        nombre: "María Gómez",
        telefono: "+54 9 2901 612345",
        vinculo: "hija",
      },
      cobertura_principal: {
        proveedor: "OSDE",
        plan: "210",
        numero_afiliado: "61234567801",
        imagen_frente: `/api/credenciales/${COBERTURA.id}/imagen?lado=front`,
        imagen_dorso: `/api/credenciales/${COBERTURA.id}/imagen?lado=back`,
      },
    })
  })

  it("la versión de la forma es la que exporta el módulo", () => {
    expect(construirPayloadSos(perfilDe(), null, GENERADO_AT).version).toBe(VERSION_PAYLOAD_SOS)
  })

  it("las tildes y la ñ sobreviven intactas", () => {
    const payload = construirPayloadSos(
      perfilDe({
        full_name: "Roberto Ñáñez",
        allergies: ["Alergia a penicilína, ñoquis"],
        sos_notes: "Añadió una observación con ¿signos? ¡y más!",
      }),
      null,
      GENERADO_AT,
    )

    expect(payload.perfil.nombre_completo).toBe("Roberto Ñáñez")
    // La alergia con coma es UN solo elemento: el `text[]` no se parte.
    expect(payload.vitales.alergias).toEqual(["Alergia a penicilína, ñoquis"])
    expect(payload.vitales.observaciones).toBe("Añadió una observación con ¿signos? ¡y más!")
  })
})

describe("lib/sos/payload.ts — regla dura 1: ninguna signed URL adentro", () => {
  it("las fotos viajan como URL estable del propio origen", () => {
    const payload = construirPayloadSos(perfilDe(), COBERTURA, GENERADO_AT)
    const serializado = JSON.stringify(payload)

    expect(payload.cobertura_principal?.imagen_frente).toBe(
      urlImagenCredencial(COBERTURA.id, "front"),
    )
    // Una signed URL de Supabase Storage lleva `/storage/v1/object/sign/` y un
    // parámetro `token=`. Ninguno de los dos puede aparecer en este JSON: vive
    // 300 segundos y el payload tiene que servir dentro de una semana.
    expect(serializado).not.toContain("token=")
    expect(serializado).not.toContain("/storage/v1/")
    expect(serializado).not.toContain("http")
  })

  it("una cara sin foto es null, no una URL que daría 404", () => {
    const payload = construirPayloadSos(
      perfilDe(),
      { ...COBERTURA, back_storage_path: null },
      GENERADO_AT,
    )
    expect(payload.cobertura_principal?.imagen_frente).not.toBeNull()
    expect(payload.cobertura_principal?.imagen_dorso).toBeNull()
  })

  it("nunca expone el storage_path, que es información del bucket", () => {
    const serializado = JSON.stringify(construirPayloadSos(perfilDe(), COBERTURA, GENERADO_AT))
    expect(serializado).not.toContain("credencial-frente.jpg")
    expect(serializado).not.toContain("credencial-dorso.jpg")
  })
})

describe("lib/sos/payload.ts — regla dura 2: los arrays son SIEMPRE arrays", () => {
  it("una ficha vacía trae tres arrays vacíos, nunca null", () => {
    const payload = construirPayloadSos(
      perfilDe({ allergies: [], chronic_conditions: [], critical_medication: [] }),
      null,
      GENERADO_AT,
    )

    expect(payload.vitales.alergias).toEqual([])
    expect(payload.vitales.condiciones_cronicas).toEqual([])
    expect(payload.vitales.medicacion_critica).toEqual([])
  })

  it("aunque la base devolviera null, el payload devuelve array", () => {
    // Las tres columnas son `NOT NULL DEFAULT '{}'`, así que esto no debería
    // pasar nunca. La garantía existe igual porque un `.map` sobre `null` en
    // la pantalla que se abre en modo avión no tiene reintento posible.
    const payload = construirPayloadSos(
      perfilDe({
        allergies: null as unknown as string[],
        chronic_conditions: undefined as unknown as string[],
        critical_medication: null as unknown as string[],
      }),
      null,
      GENERADO_AT,
    )

    expect(payload.vitales.alergias).toEqual([])
    expect(payload.vitales.condiciones_cronicas).toEqual([])
    expect(payload.vitales.medicacion_critica).toEqual([])
  })
})

describe("lib/sos/payload.ts — regla dura 3: `generado_at` lo estampa el servidor", () => {
  it("usa exactamente el instante que le pasan, en ISO con zona Z", () => {
    const payload = construirPayloadSos(perfilDe(), null, new Date("2026-01-02T03:04:05.678Z"))
    expect(payload.generado_at).toBe("2026-01-02T03:04:05.678Z")
  })

  it("`generado_at` y `actualizado_at` son marcas DISTINTAS (§6.1)", () => {
    // Una ficha puede estar fresca de caché y vieja de contenido. Confundirlas
    // es el error que el contrato pide evitar.
    const payload = construirPayloadSos(perfilDe(), null, GENERADO_AT)
    expect(payload.generado_at).toBe("2026-08-14T17:30:00.000Z")
    expect(payload.vitales.actualizado_at).toBe("2026-04-03T12:12:00.000Z")
  })

  it("`actualizado_at` null significa que nunca se cargó ningún dato SOS", () => {
    const payload = construirPayloadSos(perfilDe({ sos_updated_at: null }), null, GENERADO_AT)
    // Nunca la fecha de hoy ni la de creación del perfil: eso haría creer que
    // los datos fueron revisados cuando nunca existieron.
    expect(payload.vitales.actualizado_at).toBeNull()
  })
})

describe("lib/sos/payload.ts — ausencias", () => {
  it("sin ningún dato de contacto, el bloque entero es null", () => {
    const payload = construirPayloadSos(
      perfilDe({
        emergency_contact: null,
        emergency_contact_phone: null,
        emergency_contact_relationship: null,
      }),
      null,
      GENERADO_AT,
    )
    expect(payload.contacto_emergencia).toBeNull()
  })

  it("un contacto PARCIAL (escrito por fuera de la app) no se pierde", () => {
    // La regla "teléfono exige nombre" solo vive en el schema de la app
    // (§2.4 y §9.4): una escritura directa en la base puede dejar un teléfono
    // huérfano, y el payload tiene que tolerarlo sin romperse ni tirarlo.
    const payload = construirPayloadSos(
      perfilDe({ emergency_contact: null, emergency_contact_relationship: null }),
      null,
      GENERADO_AT,
    )
    expect(payload.contacto_emergencia).toEqual({
      nombre: null,
      telefono: "+54 9 2901 612345",
      vinculo: null,
    })
  })

  it("los campos en blanco valen lo mismo que ausentes", () => {
    const payload = construirPayloadSos(
      perfilDe({
        national_id: "   ",
        blood_type: "",
        sos_notes: "  ",
        emergency_contact: "",
        emergency_contact_phone: "   ",
        emergency_contact_relationship: "",
      }),
      null,
      GENERADO_AT,
    )

    expect(payload.perfil.documento).toBeNull()
    expect(payload.vitales.grupo_sanguineo).toBeNull()
    expect(payload.vitales.observaciones).toBeNull()
    // Tres blancos no son "hay contacto": el bloque entero desaparece.
    expect(payload.contacto_emergencia).toBeNull()
  })

  it("sin cobertura principal, el bloque es null", () => {
    expect(construirPayloadSos(perfilDe(), null, GENERADO_AT).cobertura_principal).toBeNull()
  })

  it("sin fecha de nacimiento ni documento, la ficha sigue armándose", () => {
    const payload = construirPayloadSos(
      perfilDe({ date_of_birth: null, national_id: null }),
      null,
      GENERADO_AT,
    )
    expect(payload.perfil.fecha_nacimiento).toBeNull()
    expect(payload.perfil.documento).toBeNull()
    expect(payload.perfil.nombre_completo).toBe("Roberto Gómez")
  })
})

describe("lib/sos/payload.ts — urlImagenCredencial", () => {
  it("es una ruta relativa del propio origen, con el lado en el query", () => {
    expect(urlImagenCredencial("abc", "front")).toBe("/api/credenciales/abc/imagen?lado=front")
    expect(urlImagenCredencial("abc", "back")).toBe("/api/credenciales/abc/imagen?lado=back")
  })
})
