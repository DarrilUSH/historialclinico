/**
 * Test de la huella digital de archivos (`lib/documentos/huella.ts`),
 * hotfix de producto del Sprint 17 en vivo: el mismo estudio no se carga dos
 * veces sin avisar.
 *
 * Motivado por un caso real: dos correos DISTINTOS -un reenvío "RV:" sobre el
 * original, segundos después- con el MISMO PDF adjunto. El dedup por
 * `gmail_message_id` funcionó bien -eran mensajes distintos de verdad-, pero
 * nada comparaba el ARCHIVO. Acá se prueba esa capa: el hash es estable y
 * discrimina contenido distinto, y el cotejo encuentra (o no) coincidencias
 * dentro del PERFIL correcto.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import {
  buscarDuplicadoPorHuella,
  calcularHuellaSha256,
  formatearFechaDuplicado,
} from "@/lib/documentos/huella"

describe("calcularHuellaSha256", () => {
  it("es estable: los mismos bytes dan siempre la misma huella", () => {
    const bytes = new TextEncoder().encode("contenido de un PDF de mentira")
    expect(calcularHuellaSha256(bytes)).toBe(calcularHuellaSha256(bytes))
  })

  it("dos archivos con contenido distinto dan huellas distintas", () => {
    const a = new TextEncoder().encode("resultado de laboratorio, versión 1")
    const b = new TextEncoder().encode("resultado de laboratorio, versión 2")
    expect(calcularHuellaSha256(a)).not.toBe(calcularHuellaSha256(b))
  })

  it("tiene la forma que exige el CHECK de la base: 64 caracteres hex minúscula", () => {
    const huella = calcularHuellaSha256(new TextEncoder().encode("cualquier cosa"))
    expect(huella).toMatch(/^[0-9a-f]{64}$/)
  })

  it("el archivo vacío también tiene una huella válida (no revienta con 0 bytes)", () => {
    expect(calcularHuellaSha256(new Uint8Array(0))).toMatch(/^[0-9a-f]{64}$/)
  })
})

/** Cliente de Supabase mínimo: solo lo que `buscarDuplicadoPorHuella` usa. */
function supabaseFalso(fila: { id: string; title: string; document_date: string } | null) {
  const llamadas: { perfilId?: string; huella?: string }[] = []

  const cliente = {
    from: (tabla: string) => {
      expect(tabla).toBe("documents")
      return {
        select: (columnas: string) => {
          expect(columnas).toBe("id, title, document_date")
          const llamada: { perfilId?: string; huella?: string } = {}
          llamadas.push(llamada)
          const encadenable = {
            eq: (columna: string, valor: string) => {
              if (columna === "profile_id") llamada.perfilId = valor
              if (columna === "content_sha256") llamada.huella = valor
              return encadenable
            },
            order: () => encadenable,
            limit: () => encadenable,
            maybeSingle: async () => ({ data: fila, error: null }),
          }
          return encadenable
        },
      }
    },
  }

  return { cliente, llamadas }
}

describe("buscarDuplicadoPorHuella", () => {
  it("sin coincidencia, devuelve null", async () => {
    const { cliente } = supabaseFalso(null)

    const resultado = await buscarDuplicadoPorHuella(
      cliente as never,
      "660e8400-e29b-41d4-a716-446655440003",
      "a".repeat(64),
    )

    expect(resultado).toBeNull()
  })

  it("con coincidencia, devuelve el documento existente", async () => {
    const { cliente, llamadas } = supabaseFalso({
      id: "22222222-2222-4222-8222-222222222222",
      title: "Resultado de laboratorio",
      document_date: "2026-08-10",
    })

    const resultado = await buscarDuplicadoPorHuella(
      cliente as never,
      "660e8400-e29b-41d4-a716-446655440003",
      "b".repeat(64),
    )

    expect(resultado).toEqual({
      documentoId: "22222222-2222-4222-8222-222222222222",
      titulo: "Resultado de laboratorio",
      fecha: "2026-08-10",
    })

    // El cotejo es POR PERFIL: nunca compara contra documentos de otra
    // persona -mismo criterio de aislamiento que el resto del modelo de
    // permisos-.
    expect(llamadas[0]).toEqual({
      perfilId: "660e8400-e29b-41d4-a716-446655440003",
      huella: "b".repeat(64),
    })
  })

  it("un error de la consulta se propaga (no se traga en silencio)", async () => {
    const cliente = {
      from: () => ({
        select: () => {
          const encadenable = {
            eq: () => encadenable,
            order: () => encadenable,
            limit: () => encadenable,
            maybeSingle: async () => ({ data: null, error: { message: "la base está caída" } }),
          }
          return encadenable
        },
      }),
    }

    await expect(
      buscarDuplicadoPorHuella(cliente as never, "perfil-1", "c".repeat(64)),
    ).rejects.toThrow(/la base está caída/)
  })
})

describe("formatearFechaDuplicado", () => {
  it("no mueve la fecha un día por la zona horaria (formatea en UTC)", () => {
    // `document_date` es un `date` sin hora; si se formateara en la zona de
    // Ushuaia (-03) en vez de UTC, "2026-08-01" se leería "31 de julio".
    expect(formatearFechaDuplicado("2026-08-01")).toBe("1 de agosto de 2026")
  })

  it("fin de año, mismo criterio", () => {
    expect(formatearFechaDuplicado("2026-12-31")).toBe("31 de diciembre de 2026")
  })
})
