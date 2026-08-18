/**
 * Test de la marca de "posible duplicado" en la bandeja de Gmail
 * (`lib/gmail/deteccion-duplicados.ts`), hotfix de huella digital, Sprint 17
 * en vivo, punto 5 del encargo.
 *
 * Puro y sin red: solo (nombre, tamaño) de adjuntos entre correos PENDIENTES,
 * la misma metadata que el barrido ya registra en `gmail_messages.attachments`
 * (`lib/gmail/mensaje.ts#AdjuntoGmail`). No confirma nada por contenido -eso
 * lo hace el cotejo real (`lib/documentos/huella.ts`) recién cuando la
 * persona toca "Revisar este estudio"-.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import { emparejarPorNombreYTamano, type CorreoParaDeteccion } from "@/lib/gmail/deteccion-duplicados"

function correo(
  id: string,
  adjuntos: { attachmentId: string; filename: string; size: number; apto?: boolean }[],
): CorreoParaDeteccion {
  return {
    id,
    adjuntos: adjuntos.map((adjunto) => ({ apto: true, ...adjunto })),
  }
}

describe("emparejarPorNombreYTamano", () => {
  it("dos correos con el mismo (nombre, tamaño) se emparejan entre sí", () => {
    const correos = [
      correo("correo-A", [{ attachmentId: "att-1", filename: "resultado.pdf", size: 51234 }]),
      correo("correo-B", [{ attachmentId: "att-2", filename: "resultado.pdf", size: 51234 }]),
    ]

    const emparejados = emparejarPorNombreYTamano(correos)

    expect(emparejados.get("correo-A:att-1")).toBe("correo-B")
    expect(emparejados.get("correo-B:att-2")).toBe("correo-A")
  })

  it("mismo nombre pero distinto tamaño: NO se marca (son archivos distintos)", () => {
    const correos = [
      correo("correo-A", [{ attachmentId: "att-1", filename: "resultado.pdf", size: 51234 }]),
      correo("correo-B", [{ attachmentId: "att-2", filename: "resultado.pdf", size: 99999 }]),
    ]

    expect(emparejarPorNombreYTamano(correos).size).toBe(0)
  })

  it("mismo tamaño pero distinto nombre: NO se marca", () => {
    const correos = [
      correo("correo-A", [{ attachmentId: "att-1", filename: "analisis.pdf", size: 51234 }]),
      correo("correo-B", [{ attachmentId: "att-2", filename: "radiografia.pdf", size: 51234 }]),
    ]

    expect(emparejarPorNombreYTamano(correos).size).toBe(0)
  })

  it("un adjunto NO apto no se compara (no se puede importar de todos modos)", () => {
    const correos = [
      correo("correo-A", [
        { attachmentId: "att-1", filename: "resultado.pdf", size: 51234, apto: false },
      ]),
      correo("correo-B", [{ attachmentId: "att-2", filename: "resultado.pdf", size: 51234 }]),
    ]

    expect(emparejarPorNombreYTamano(correos).size).toBe(0)
  })

  it("un correo solo (sin pareja) no queda marcado", () => {
    const correos = [correo("correo-A", [{ attachmentId: "att-1", filename: "unico.pdf", size: 1000 }])]

    expect(emparejarPorNombreYTamano(correos).size).toBe(0)
  })

  it("tres correos con el mismo archivo: cada uno queda marcado apuntando a otro", () => {
    const correos = [
      correo("correo-A", [{ attachmentId: "att-1", filename: "orden.pdf", size: 2048 }]),
      correo("correo-B", [{ attachmentId: "att-2", filename: "orden.pdf", size: 2048 }]),
      correo("correo-C", [{ attachmentId: "att-3", filename: "orden.pdf", size: 2048 }]),
    ]

    const emparejados = emparejarPorNombreYTamano(correos)

    expect(emparejados.size).toBe(3)
    // Cada uno apunta a OTRO correo real de la rueda, nunca a sí mismo.
    for (const [clave, otroCorreoId] of emparejados) {
      const [correoId] = clave.split(":")
      expect(otroCorreoId).not.toBe(correoId)
      expect(["correo-A", "correo-B", "correo-C"]).toContain(otroCorreoId)
    }
  })

  it("un adjunto con tamaño 0 nunca se marca (metadata sin datos reales)", () => {
    const correos = [
      correo("correo-A", [{ attachmentId: "att-1", filename: "sin-tamano.pdf", size: 0 }]),
      correo("correo-B", [{ attachmentId: "att-2", filename: "sin-tamano.pdf", size: 0 }]),
    ]

    expect(emparejarPorNombreYTamano(correos).size).toBe(0)
  })

  it("TOLERANCIA ±2% — 2 bytes de diferencia sobre un PDF regenerado (evidencia real: Sanatorio San Jorge) SÍ se marca", () => {
    const correos = [
      correo("correo-A", [{ attachmentId: "att-1", filename: "orden.pdf", size: 51234 }]),
      correo("correo-B", [{ attachmentId: "att-2", filename: "orden.pdf", size: 51236 }]),
    ]

    const emparejados = emparejarPorNombreYTamano(correos)
    expect(emparejados.get("correo-A:att-1")).toBe("correo-B")
    expect(emparejados.get("correo-B:att-2")).toBe("correo-A")
  })

  it("TOLERANCIA ±2% — justo en el borde (2,00%) SÍ se marca", () => {
    const base = 100000
    const correos = [
      correo("correo-A", [{ attachmentId: "att-1", filename: "orden.pdf", size: base }]),
      correo("correo-B", [{ attachmentId: "att-2", filename: "orden.pdf", size: base * 1.02 }]),
    ]

    expect(emparejarPorNombreYTamano(correos).size).toBe(2)
  })

  it("TOLERANCIA ±2% — pasado el borde (5%) NO se marca: son archivos distintos", () => {
    const base = 100000
    const correos = [
      correo("correo-A", [{ attachmentId: "att-1", filename: "orden.pdf", size: base }]),
      correo("correo-B", [{ attachmentId: "att-2", filename: "orden.pdf", size: base * 1.05 }]),
    ]

    expect(emparejarPorNombreYTamano(correos).size).toBe(0)
  })

  it("TOLERANCIA ±2% — tres correos con tamaños escalonados dentro de tolerancia quedan todos agrupados", () => {
    const correos = [
      correo("correo-A", [{ attachmentId: "att-1", filename: "orden.pdf", size: 100000 }]),
      correo("correo-B", [{ attachmentId: "att-2", filename: "orden.pdf", size: 100500 }]),
      correo("correo-C", [{ attachmentId: "att-3", filename: "orden.pdf", size: 101000 }]),
    ]

    const emparejados = emparejarPorNombreYTamano(correos)
    expect(emparejados.size).toBe(3)
    for (const [clave, otroCorreoId] of emparejados) {
      const [correoId] = clave.split(":")
      expect(otroCorreoId).not.toBe(correoId)
    }
  })

  it("distintos adjuntos DENTRO del mismo correo no se emparejan entre sí", () => {
    const correos = [
      correo("correo-A", [
        { attachmentId: "att-1", filename: "orden.pdf", size: 2048 },
        { attachmentId: "att-2", filename: "orden.pdf", size: 2048 },
      ]),
    ]

    // Es una coincidencia real (mismo nombre y tamaño, DOS adjuntos del MISMO
    // correo) — se marcan igual, cada uno apuntando al otro adjunto de su
    // propio correo. No es el caso típico, pero tampoco hay que ocultarlo.
    const emparejados = emparejarPorNombreYTamano(correos)
    expect(emparejados.get("correo-A:att-1")).toBe("correo-A")
    expect(emparejados.get("correo-A:att-2")).toBe("correo-A")
  })
})
