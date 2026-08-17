/**
 * Tests unitarios del modo de letra (Sprint 13, tarea 13.1).
 *
 * Cubre las tres piezas que deciden qué tamaño ve una persona, sin tocar la red:
 *
 *   · `lib/densidad/tamano.ts`   — vocabulario y validación de valores sueltos.
 *   · `lib/densidad/servidor.ts` — el orden de resolución cookie → base →
 *                                  default, y que la escritura vaya SIEMPRE a
 *                                  la fila de la cuenta.
 *   · `app/(app)/actions.ts`     — que la Server Action rechace lo que no es un
 *                                  modo válido, sin efectos de ningún tipo.
 *
 *   npm run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { User } from "@supabase/supabase-js"

/* -------------------------------------------------------------------------
   Mocks
   ------------------------------------------------------------------------- */

/**
 * Cookie store de mentira con la misma superficie que usa el código real
 * (`get` / `set` / `delete`). Se guarda en un Map para poder afirmar sobre el
 * valor escrito y no solo sobre la llamada.
 */
const { almacenCookies, mockCookies, mockClient, mockCreateClient } = vi.hoisted(() => {
  const almacenCookies = new Map<string, string>()

  const mockCookies = vi.fn(() => ({
    get: (nombre: string) =>
      almacenCookies.has(nombre) ? { name: nombre, value: almacenCookies.get(nombre)! } : undefined,
    set: vi.fn((nombre: string, valor: string) => {
      almacenCookies.set(nombre, valor)
    }),
    delete: vi.fn((nombre: string) => {
      almacenCookies.delete(nombre)
    }),
    getAll: () => [...almacenCookies].map(([name, value]) => ({ name, value })),
  }))

  /**
   * Constructor de cadenas de PostgREST. `from()` devuelve un objeto donde cada
   * método encadenable se devuelve a sí mismo y las hojas (`maybeSingle`, o el
   * `select` final de un `update`) resuelven lo que el test haya preparado.
   * Registra cada eslabón en `llamadas` para poder afirmar, por ejemplo, que el
   * `UPDATE` viajó con `.eq("user_id", …)` y no con otro filtro.
   */
  const llamadas: { metodo: string; args: unknown[] }[] = []
  let respuestaLectura: unknown = { data: null, error: null }
  let respuestaEscritura: unknown = { data: null, error: null }

  const constructor = () => {
    const cadena: Record<string, unknown> = {}
    let esEscritura = false

    const registrar = (metodo: string) =>
      vi.fn((...args: unknown[]) => {
        llamadas.push({ metodo, args })
        if (metodo === "update") esEscritura = true
        return cadena
      })

    cadena.select = vi.fn((...args: unknown[]) => {
      llamadas.push({ metodo: "select", args })
      // El `.select()` que cierra un UPDATE es una hoja (devuelve las filas
      // afectadas); el que abre una lectura sigue encadenando.
      return esEscritura ? Promise.resolve(respuestaEscritura) : cadena
    })
    cadena.update = registrar("update")
    cadena.eq = registrar("eq")
    cadena.maybeSingle = vi.fn((...args: unknown[]) => {
      llamadas.push({ metodo: "maybeSingle", args })
      return Promise.resolve(respuestaLectura)
    })

    return cadena
  }

  const mockClient = {
    auth: { getUser: vi.fn() },
    from: vi.fn((tabla: string) => {
      llamadas.push({ metodo: "from", args: [tabla] })
      return constructor()
    }),
    __llamadas: llamadas,
    __responderLectura: (r: unknown) => {
      respuestaLectura = r
    },
    __responderEscritura: (r: unknown) => {
      respuestaEscritura = r
    },
  }

  const mockCreateClient = vi.fn(async () => mockClient)

  return { almacenCookies, mockCookies, mockClient, mockCreateClient }
})

vi.mock("server-only")
vi.mock("next/headers", () => ({ cookies: mockCookies }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }))

import { Constants } from "@/types/database.types"
import {
  COOKIE_TAMANO,
  MODOS,
  TAMANOS,
  TAMANO_POR_DEFECTO,
  alternar,
  esTamano,
} from "@/lib/densidad/tamano"
import {
  fijarCookieTamano,
  limpiarCookieTamano,
  obtenerTamano,
  persistirTamano,
  sincronizarCookieTamano,
} from "@/lib/densidad/servidor"

const USUARIO: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "maria@ejemplo.com.ar",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: new Date().toISOString(),
}

function conSesion() {
  mockClient.auth.getUser.mockResolvedValue({ data: { user: USUARIO }, error: null })
}

function sinSesion() {
  mockClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  almacenCookies.clear()
  mockClient.__llamadas.length = 0
  mockClient.__responderLectura({ data: null, error: null })
  mockClient.__responderEscritura({ data: null, error: null })
  sinSesion()
})

/* -------------------------------------------------------------------------
   1. Vocabulario
   ------------------------------------------------------------------------- */

describe("lib/densidad/tamano.ts", () => {
  /**
   * Sprint 14: el default se invirtió. Hasta el Sprint 13 era `grande` porque
   * lo compacto era "la app apretada"; con la retokenización nativa de
   * `app/globals.css` §5 lo compacto pasó a ser la densidad que cualquiera
   * reconoce como la de una app de celular, y el default del producto se mudó
   * ahí. El modo grande queda a un toque del botón A/a y, elegido, se recuerda.
   *
   * El espejo del lado de la base es el `alter column ... set default 'chica'`
   * de `supabase/migrations/20260817150000_default_chica.sql` §2.
   */
  it("el default del producto es el modo chico", () => {
    expect(TAMANO_POR_DEFECTO).toBe("chica")
  })

  /**
   * La lista de modos de TypeScript y el enum de Postgres tienen que decir lo
   * mismo. `Constants` lo genera `npm run types:gen` desde la base, así que si
   * una migración agrega o saca un modo y nadie toca `MODOS`, esta prueba se
   * pone en rojo — la misma clase de red que el BLOQUE 14 del arnés de RLS le
   * pone a los defaults de `vital_sign_thresholds`.
   */
  it("los modos de la interfaz son exactamente los del enum de la base", () => {
    expect([...TAMANOS].sort()).toEqual([...Constants.public.Enums.display_density].sort())
    expect(Object.keys(MODOS).sort()).toEqual([...Constants.public.Enums.display_density].sort())
  })

  it("cada modo trae glifo, etiqueta y descripción para los conmutadores", () => {
    for (const modo of TAMANOS) {
      expect(MODOS[modo].glifo.length).toBeGreaterThan(0)
      expect(MODOS[modo].etiqueta.length).toBeGreaterThan(0)
      expect(MODOS[modo].descripcion.length).toBeGreaterThan(0)
    }
  })

  it("esTamano acepta los dos modos y nada más", () => {
    expect(esTamano("grande")).toBe(true)
    expect(esTamano("chica")).toBe(true)
  })

  it.each([
    ["mayúsculas", "GRANDE"],
    ["con espacios", " chica "],
    ["vacío", ""],
    ["otro idioma", "small"],
    ["nulo", null],
    ["indefinido", undefined],
    ["número", 1],
    ["objeto", { grande: true }],
    // `Object.hasOwn` y no `in`: `"toString" in MODOS` sería `true` por la
    // cadena de prototipos, y un valor de cookie con ese texto pasaría.
    ["heredado del prototipo", "toString"],
    ["contaminación de prototipo", "__proto__"],
  ])("esTamano rechaza un valor %s", (_caso, valor) => {
    expect(esTamano(valor)).toBe(false)
  })

  it("alternar va y vuelve entre los dos modos", () => {
    expect(alternar("grande")).toBe("chica")
    expect(alternar("chica")).toBe("grande")
    expect(alternar(alternar("chica"))).toBe("chica")
  })
})

/* -------------------------------------------------------------------------
   2. Resolución
   ------------------------------------------------------------------------- */

/**
 * Nota de lectura para todo este bloque (Sprint 14): desde que el default es
 * `chica`, un caso que espere `"chica"` pasaría igual aunque la resolución
 * estuviera rota y cayera al default. Por eso los caminos que tienen que
 * demostrar que se leyó ALGO —la cookie, la fila de la base— usan `"grande"`,
 * que es el único valor que no puede salir de un fallback.
 */
describe("obtenerTamano", () => {
  it("con cookie válida devuelve ese modo SIN consultar la base", async () => {
    almacenCookies.set(COOKIE_TAMANO, "grande")

    expect(await obtenerTamano()).toBe("grande")
    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(mockClient.auth.getUser).not.toHaveBeenCalled()
  })

  it("con cookie 'chica' devuelve chica, también sin consultar", async () => {
    almacenCookies.set(COOKIE_TAMANO, "chica")

    expect(await obtenerTamano()).toBe("chica")
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it("sin cookie y sin sesión cae al default sin tocar profiles", async () => {
    expect(await obtenerTamano()).toBe(TAMANO_POR_DEFECTO)
    expect(mockClient.from).not.toHaveBeenCalled()
  })

  it("sin cookie y con sesión lee la fila de la CUENTA (user_id = auth.uid())", async () => {
    conSesion()
    mockClient.__responderLectura({ data: { display_density: "grande" }, error: null })

    expect(await obtenerTamano()).toBe("grande")

    expect(mockClient.from).toHaveBeenCalledWith("profiles")
    const filtro = mockClient.__llamadas.find((l) => l.metodo === "eq")
    expect(filtro?.args).toEqual(["user_id", USUARIO.id])
  })

  it("resuelto desde la base, deja la cookie espejo escrita", async () => {
    conSesion()
    mockClient.__responderLectura({ data: { display_density: "grande" }, error: null })

    await obtenerTamano()

    expect(almacenCookies.get(COOKIE_TAMANO)).toBe("grande")
  })

  it("una cookie con basura se ignora y manda la base", async () => {
    almacenCookies.set(COOKIE_TAMANO, "gigante")
    conSesion()
    mockClient.__responderLectura({ data: { display_density: "grande" }, error: null })

    expect(await obtenerTamano()).toBe("grande")
  })

  it("con sesión pero sin fila de perfil cae al default", async () => {
    conSesion()
    mockClient.__responderLectura({ data: null, error: null })

    expect(await obtenerTamano()).toBe(TAMANO_POR_DEFECTO)
  })

  it("si la base devuelve un valor que no es un modo, cae al default", async () => {
    conSesion()
    mockClient.__responderLectura({ data: { display_density: "enorme" }, error: null })

    expect(await obtenerTamano()).toBe(TAMANO_POR_DEFECTO)
  })

  it("si la consulta falla cae al default en vez de lanzar", async () => {
    conSesion()
    mockClient.__responderLectura({ data: null, error: { message: "sin conexión" } })

    expect(await obtenerTamano()).toBe(TAMANO_POR_DEFECTO)
  })

  /**
   * El atributo `data-tamano` se pinta en `<html>`: si esta función lanzara,
   * se caería el render de TODA la app —incluida `/sos`— por no poder leer una
   * preferencia de interfaz. Caer en `TAMANO_POR_DEFECTO` es la salida segura:
   * la app se pinta igual que en el camino feliz y nadie se entera del fallo.
   */
  it("si el cliente de Supabase explota cae al default en vez de lanzar", async () => {
    almacenCookies.set(COOKIE_TAMANO, "no-es-un-modo")
    mockCreateClient.mockRejectedValueOnce(new Error("boom"))

    await expect(obtenerTamano()).resolves.toBe(TAMANO_POR_DEFECTO)
  })
})

/* -------------------------------------------------------------------------
   3. Cookie espejo
   ------------------------------------------------------------------------- */

describe("cookie espejo", () => {
  it("fijarCookieTamano escribe el valor", async () => {
    await fijarCookieTamano("chica")
    expect(almacenCookies.get(COOKIE_TAMANO)).toBe("chica")
  })

  it("limpiarCookieTamano la borra (logout en navegador compartido)", async () => {
    almacenCookies.set(COOKIE_TAMANO, "chica")
    await limpiarCookieTamano()
    expect(almacenCookies.has(COOKIE_TAMANO)).toBe(false)
  })

  it("sincronizarCookieTamano PISA la cookie ajena con la preferencia de la cuenta", async () => {
    almacenCookies.set(COOKIE_TAMANO, "chica")
    conSesion()
    mockClient.__responderLectura({ data: { display_density: "grande" }, error: null })

    await sincronizarCookieTamano()

    expect(almacenCookies.get(COOKIE_TAMANO)).toBe("grande")
  })

  it("sincronizarCookieTamano sin preferencia guardada deja el default", async () => {
    // La cookie de partida es la del OTRO modo (el que no es el default): si
    // fuera ya la del default, el caso pasaría sin hacer nada.
    almacenCookies.set(COOKIE_TAMANO, "grande")
    conSesion()
    mockClient.__responderLectura({ data: null, error: null })

    await sincronizarCookieTamano()

    expect(almacenCookies.get(COOKIE_TAMANO)).toBe(TAMANO_POR_DEFECTO)
  })

  /**
   * `cookies().set()` lanza cuando corre dentro del render de un Server
   * Component (Next.js solo deja escribir cookies desde Server Actions y Route
   * Handlers). Es un caso REAL de esta app: `obtenerTamano` escribe la cookie
   * de forma oportunista desde el layout raíz. Tiene que ser un no-op, no una
   * excepción que tumbe la página.
   */
  it("un cookie store de solo lectura no rompe nada", async () => {
    mockCookies.mockReturnValueOnce({
      get: () => undefined,
      set: () => {
        throw new Error("Cookies can only be modified in a Server Action or Route Handler")
      },
      delete: () => {},
      getAll: () => [],
    } as unknown as ReturnType<typeof mockCookies>)

    await expect(fijarCookieTamano("chica")).resolves.toBeUndefined()
  })
})

/* -------------------------------------------------------------------------
   4. Persistencia
   ------------------------------------------------------------------------- */

describe("persistirTamano", () => {
  it("escribe display_density en la fila de la cuenta y en ninguna otra", async () => {
    conSesion()
    mockClient.__responderEscritura({ data: [{ id: "perfil-de-maria" }], error: null })

    const resultado = await persistirTamano("chica")

    expect(resultado).toEqual({ tamano: "chica", persistido: true })

    const update = mockClient.__llamadas.find((l) => l.metodo === "update")
    expect(update?.args).toEqual([{ display_density: "chica" }])

    // El filtro es la cerradura: no hay forma de pedirle a esta función que
    // escriba en el perfil de otra persona, porque no recibe ningún id.
    const filtros = mockClient.__llamadas.filter((l) => l.metodo === "eq")
    expect(filtros).toHaveLength(1)
    expect(filtros[0].args).toEqual(["user_id", USUARIO.id])
  })

  it("deja la cookie espejo alineada con lo persistido", async () => {
    conSesion()
    mockClient.__responderEscritura({ data: [{ id: "perfil-de-maria" }], error: null })

    await persistirTamano("chica")

    expect(almacenCookies.get(COOKIE_TAMANO)).toBe("chica")
  })

  it("sin sesión no persiste NI siembra cookie", async () => {
    const resultado = await persistirTamano("chica")

    expect(resultado).toEqual({ tamano: "chica", persistido: false })
    expect(mockClient.from).not.toHaveBeenCalled()
    expect(almacenCookies.has(COOKIE_TAMANO)).toBe(false)
  })

  /**
   * Cuenta sin fila en `profiles` (el estado que `registrarse` contempla
   * cuando el INSERT del perfil falla): el UPDATE no afecta ninguna fila. La
   * persona igual ve el efecto en esta sesión; lo que se pierde es que la
   * elección la siga al próximo dispositivo, y eso queda dicho en el resultado.
   */
  it("si el UPDATE no afecta filas, informa persistido:false pero aplica la cookie", async () => {
    conSesion()
    mockClient.__responderEscritura({ data: [], error: null })

    const resultado = await persistirTamano("chica")

    expect(resultado.persistido).toBe(false)
    expect(almacenCookies.get(COOKIE_TAMANO)).toBe("chica")
  })

  it("un error de la base no lanza: informa persistido:false", async () => {
    conSesion()
    mockClient.__responderEscritura({ data: null, error: { message: "42501" } })

    await expect(persistirTamano("chica")).resolves.toMatchObject({ persistido: false })
  })
})

/* -------------------------------------------------------------------------
   5. La Server Action
   ------------------------------------------------------------------------- */

describe("cambiarTamano (Server Action)", () => {
  it("con un modo válido persiste y revalida el layout raíz", async () => {
    vi.resetModules()
    const revalidatePath = vi.fn()
    const persistir = vi.fn(async () => ({ tamano: "chica" as const, persistido: true }))

    vi.doMock("next/cache", () => ({ revalidatePath }))
    vi.doMock("@/lib/densidad/servidor", () => ({ persistirTamano: persistir }))

    const { cambiarTamano } = await import("@/app/(app)/actions")
    await cambiarTamano("chica")

    expect(persistir).toHaveBeenCalledWith("chica")
    // `"layout"` y no `"page"`: lo que cambia es el <html> del layout raíz.
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout")

    vi.doUnmock("next/cache")
    vi.doUnmock("@/lib/densidad/servidor")
  })

  /**
   * Una Server Action es un endpoint HTTP público: su argumento lo controla
   * quien la llama. Un valor inválido no persiste, no toca la cookie, no
   * revalida y no lanza — no hay ninguna pantalla de error que valga la pena
   * mostrar por un tamaño de letra.
   */
  it.each(["gigante", "", "GRANDE", "__proto__"])(
    "con el valor inválido %j no produce NINGÚN efecto",
    async (valor) => {
      vi.resetModules()
      const revalidatePath = vi.fn()
      const persistir = vi.fn()

      vi.doMock("next/cache", () => ({ revalidatePath }))
      vi.doMock("@/lib/densidad/servidor", () => ({ persistirTamano: persistir }))

      const { cambiarTamano } = await import("@/app/(app)/actions")
      await expect(
        cambiarTamano(valor as unknown as Parameters<typeof cambiarTamano>[0]),
      ).resolves.toBeUndefined()

      expect(persistir).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()

      vi.doUnmock("next/cache")
      vi.doUnmock("@/lib/densidad/servidor")
    },
  )
})
