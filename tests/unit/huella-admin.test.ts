/**
 * Test del backfill perezoso de huellas (`lib/documentos/huella-admin.ts`),
 * hotfix de producto del Sprint 17 en vivo.
 *
 * Los documentos anteriores a `20260818150000_huella_documentos.sql` nacen
 * sin `content_sha256` -los bytes viven en Storage, no en la base, y una
 * migración SQL no los puede leer-. Este módulo los completa de a poco, la
 * primera vez que hace falta cotejar un perfil que todavía tiene alguno sin
 * huella. Acá se prueba con Storage y el cliente `service_role` MOCKEADOS,
 * mismo criterio que `lib/gmail/barrido.ts` -no se toca una base real-.
 *
 *   npm run test
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

/* ------------------------------------------------------------------ *
 *  Estado mutable que maneja el cliente `service_role` falso. Vive en
 *  el nivel del módulo -no dentro de cada test- porque `huella-admin.ts`
 *  cachea el cliente en un `let clienteCache` de módulo: la MISMA
 *  instancia del cliente falso se reutiliza entre tests del archivo, así
 *  que su comportamiento se parametriza reseteando estas variables en
 *  `beforeEach`, no reconstruyendo el cliente.
 * ------------------------------------------------------------------ */
let filasSinHuella: { id: string; storage_path: string }[] = []
let erroresSelect: string | null = null
let erroresUpdate: string | null = null
const actualizaciones: { id: string; profileId: string; huella: string }[] = []

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (tabla: string) => {
      if (tabla !== "documents") throw new Error(`Tabla inesperada en el test: ${tabla}`)
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              limit: async (n: number) => {
                if (erroresSelect) return { data: null, error: { message: erroresSelect } }
                return { data: filasSinHuella.slice(0, n), error: null }
              },
            }),
          }),
        }),
        update: (cambios: { content_sha256: string }) => ({
          eq: (_col1: string, id: string) => ({
            eq: (_col2: string, perfilId: string) => {
              if (erroresUpdate) return Promise.resolve({ error: { message: erroresUpdate } })
              actualizaciones.push({ id, profileId: perfilId, huella: cambios.content_sha256 })
              return Promise.resolve({ error: null })
            },
          }),
        }),
      }
    },
  })),
}))

vi.mock("@/lib/storage-admin", () => ({
  BUCKETS: { documentos: "documentos-medicos" },
  descargarObjeto: vi.fn(),
}))

// `vi.mock(...)` de arriba se HOISTEA por delante de estos imports (vitest lo
// hace con una transformación estática), así que el módulo real nunca corre
// con el `createClient`/`descargarObjeto` de verdad — mismo patrón que el
// resto de la suite (`tests/setup.ts`).
const { descargarObjeto } = await import("@/lib/storage-admin")
const { backfillHuellasFaltantes, LIMITE_BACKFILL_POR_COTEJO } = await import(
  "@/lib/documentos/huella-admin"
)

const descargarObjetoMock = vi.mocked(descargarObjeto)

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321")
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "clave-de-service-role-de-mentira")

  filasSinHuella = []
  erroresSelect = null
  erroresUpdate = null
  actualizaciones.length = 0
  descargarObjetoMock.mockReset()

  // Silencia `console.error`: los tests de fallo esperan que loguee, no que
  // ensucie la salida de `npm run test`.
  vi.spyOn(console, "error").mockImplementation(() => {})
})

function blobDe(texto: string): Blob {
  return new Blob([texto], { type: "application/pdf" })
}

describe("backfillHuellasFaltantes", () => {
  it("no hace nada si el perfil no tiene documentos sin huella", async () => {
    filasSinHuella = []

    await backfillHuellasFaltantes("perfil-1")

    expect(descargarObjetoMock).not.toHaveBeenCalled()
    expect(actualizaciones).toHaveLength(0)
  })

  it("completa la huella de cada documento bajando sus bytes de Storage", async () => {
    filasSinHuella = [
      { id: "doc-1", storage_path: "perfil-1/2026/uno.pdf" },
      { id: "doc-2", storage_path: "perfil-1/2026/dos.pdf" },
    ]
    descargarObjetoMock.mockImplementation(async (_bucket, path) => ({
      datos: blobDe(`contenido de ${path}`),
      tipo: "application/pdf",
    }))

    await backfillHuellasFaltantes("perfil-1")

    expect(descargarObjetoMock).toHaveBeenCalledTimes(2)
    expect(descargarObjetoMock).toHaveBeenCalledWith("documentos-medicos", "perfil-1/2026/uno.pdf")
    expect(actualizaciones).toHaveLength(2)
    expect(actualizaciones[0]).toMatchObject({ id: "doc-1", profileId: "perfil-1" })
    expect(actualizaciones[0].huella).toMatch(/^[0-9a-f]{64}$/)
    // Contenidos distintos -> huellas distintas.
    expect(actualizaciones[0].huella).not.toBe(actualizaciones[1].huella)
  })

  it("pide como mucho LIMITE_BACKFILL_POR_COTEJO documentos por vez", async () => {
    filasSinHuella = Array.from({ length: 50 }, (_, indice) => ({
      id: `doc-${indice}`,
      storage_path: `perfil-1/2026/${indice}.pdf`,
    }))
    descargarObjetoMock.mockResolvedValue({ datos: blobDe("x"), tipo: "application/pdf" })

    await backfillHuellasFaltantes("perfil-1")

    // El `.limit(N)` del SELECT ya recorta la lista a `filasSinHuella.slice(0, n)`
    // en el cliente falso, así que esto confirma que se pidió el límite chico
    // y no "todos los documentos sin huella".
    expect(descargarObjetoMock).toHaveBeenCalledTimes(LIMITE_BACKFILL_POR_COTEJO)
  })

  it("best-effort: si Storage falla para un documento, sigue con los demás", async () => {
    filasSinHuella = [
      { id: "doc-roto", storage_path: "perfil-1/2026/roto.pdf" },
      { id: "doc-ok", storage_path: "perfil-1/2026/ok.pdf" },
    ]
    descargarObjetoMock.mockImplementation(async (_bucket, path) => {
      if (path.includes("roto")) throw new Error("objeto purgado")
      return { datos: blobDe("contenido bueno"), tipo: "application/pdf" }
    })

    await expect(backfillHuellasFaltantes("perfil-1")).resolves.toBeUndefined()

    // El roto se queda sin huella (no hay UPDATE para él); el bueno sí se completó.
    expect(actualizaciones).toHaveLength(1)
    expect(actualizaciones[0].id).toBe("doc-ok")
    expect(console.error).toHaveBeenCalled()
  })

  it("best-effort: si falla el SELECT inicial (base caída), no lanza", async () => {
    erroresSelect = "la base está caída"

    await expect(backfillHuellasFaltantes("perfil-1")).resolves.toBeUndefined()
    expect(descargarObjetoMock).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })

  it("best-effort: si falla el UPDATE, no lanza y sigue con el siguiente documento", async () => {
    filasSinHuella = [
      { id: "doc-1", storage_path: "perfil-1/2026/uno.pdf" },
      { id: "doc-2", storage_path: "perfil-1/2026/dos.pdf" },
    ]
    descargarObjetoMock.mockResolvedValue({ datos: blobDe("x"), tipo: "application/pdf" })
    erroresUpdate = "constraint violada"

    await expect(backfillHuellasFaltantes("perfil-1")).resolves.toBeUndefined()

    expect(descargarObjetoMock).toHaveBeenCalledTimes(2)
    expect(actualizaciones).toHaveLength(0)
    expect(console.error).toHaveBeenCalled()
  })

  it("nunca escribe fuera del perfil pedido: el UPDATE va acotado por profile_id", async () => {
    filasSinHuella = [{ id: "doc-1", storage_path: "perfil-A/2026/uno.pdf" }]
    descargarObjetoMock.mockResolvedValue({ datos: blobDe("x"), tipo: "application/pdf" })

    await backfillHuellasFaltantes("perfil-A")

    expect(actualizaciones[0].profileId).toBe("perfil-A")
  })
})
