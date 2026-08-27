/**
 * La regla: **ningún GET prefetcheable escribe cookies**.
 *
 * El bug que fijan estos tests se capturó con un espía CDP contra el teléfono
 * real, en producción, reproducido dos veces idéntico en noventa segundos: dos
 * segundos después de elegir un perfil gestionado, un `GET
 * /familia/enlace?perfil=<el otro>&_rsc=…` con encabezado de PREFETCH ejecutaba
 * el Route Handler entero —`fijarPerfilActivo`, `Set-Cookie`, auditoría— y
 * revertía la elección. El router de Next prefetchea los `<Link>` que entran en
 * viewport; el enlace era un GET con efectos. El relato completo, con el
 * registro, está en `lib/enlaces-perfil.ts`.
 *
 * Tres capas de tests:
 *
 * 1. **La detección** (`esSolicitudDePrefetch`) y la respuesta (204 sin
 *    cookies, sin cachear).
 * 2. **Los cinco Route Handlers de verdad**, importados y ejecutados: con
 *    encabezado de prefetch no hay una sola escritura de cookie; sin él, el
 *    deep link sigue funcionando exactamente como antes.
 * 3. **El censo contra el disco**: que no exista un sexto Route Handler que
 *    escriba el perfil activo sin pasar por `responderEnlaceDePerfil`. Es el
 *    test que hace que la regla no dependa de que alguien se acuerde.
 *
 *   npm run test -- tests/unit/enlaces-perfil-prefetch.test.ts
 */

import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  revalidatePath,
  requerirPermiso,
  registrarAcceso,
  cookieSet,
  cookieDelete,
  cookieGet,
  redirect,
  ErrorGuardaFalso,
  ErrorPermisoDenegadoFalso,
  ErrorPerfilInvalidoFalso,
  ErrorSesionRequeridaFalso,
  RedirectFalso,
} = vi.hoisted(() => {
  class ErrorGuardaFalso extends Error {}
  class ErrorPermisoDenegadoFalso extends ErrorGuardaFalso {}
  class ErrorPerfilInvalidoFalso extends ErrorGuardaFalso {}
  class ErrorSesionRequeridaFalso extends ErrorGuardaFalso {}
  /** `redirect()` de Next funciona lanzando; este falso hace lo mismo. */
  class RedirectFalso extends Error {
    constructor(public destino: string) {
      super(`NEXT_REDIRECT:${destino}`)
    }
  }
  return {
    revalidatePath: vi.fn(),
    requerirPermiso: vi.fn(),
    registrarAcceso: vi.fn(),
    cookieSet: vi.fn(),
    cookieDelete: vi.fn(),
    cookieGet: vi.fn(),
    redirect: vi.fn((destino: string) => {
      throw new RedirectFalso(destino)
    }),
    ErrorGuardaFalso,
    ErrorPermisoDenegadoFalso,
    ErrorPerfilInvalidoFalso,
    ErrorSesionRequeridaFalso,
    RedirectFalso,
  }
})

vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("next/navigation", () => ({ redirect }))

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: cookieSet, delete: cookieDelete, get: cookieGet })),
}))

vi.mock("@/lib/auditoria", () => ({
  ACCION: { ver_perfil: "ver_perfil" },
  registrarAcceso,
}))

vi.mock("@/lib/auth/guardas", () => ({
  requerirPermiso,
  ErrorPermisoDenegado: ErrorPermisoDenegadoFalso,
  ErrorPerfilInvalido: ErrorPerfilInvalidoFalso,
  ErrorSesionRequerida: ErrorSesionRequeridaFalso,
  esErrorDeGuarda: (error: unknown) => error instanceof ErrorGuardaFalso,
}))

import { GET as enlaceFamilia } from "@/app/(app)/(con-nav)/familia/enlace/route"
import { GET as enlaceMedicacion } from "@/app/(app)/(con-nav)/medicacion/enlace/route"
import { GET as enlaceSos } from "@/app/(app)/(con-nav)/perfil/sos/enlace/route"
import { GET as enlaceSignos } from "@/app/(app)/(con-nav)/signos/enlace/route"
import { GET as enlaceTurnos } from "@/app/(app)/(con-nav)/turnos/enlace/route"
import {
  ENCABEZADO_PREFETCH_ESTANDAR,
  ENCABEZADO_PREFETCH_LEGADO,
  ENCABEZADO_PREFETCH_ROUTER,
  RUTAS_ENLACE_DE_PERFIL,
  esRutaDeEnlaceDePerfil,
  esSolicitudDePrefetch,
  respuestaDePrefetchSinEfectos,
} from "@/lib/enlaces-perfil"

/** El perfil "de Darío": el que el prefetch imponía sin que nadie lo pidiera. */
const OTRO_PERFIL = "60670b0f-1111-4111-8111-111111111111"

/** Los cinco handlers y la URL limpia a la que aterriza cada uno. */
const HANDLERS = [
  { nombre: "/turnos/enlace", GET: enlaceTurnos, destino: "/turnos" },
  { nombre: "/medicacion/enlace", GET: enlaceMedicacion, destino: "/medicacion" },
  { nombre: "/signos/enlace", GET: enlaceSignos, destino: "/signos" },
  { nombre: "/familia/enlace", GET: enlaceFamilia, destino: "/familia#invitar" },
  { nombre: "/perfil/sos/enlace", GET: enlaceSos, destino: "/perfil/sos" },
] as const

function pedido(ruta: string, encabezados: Record<string, string> = {}): Request {
  return new Request(`https://www.historialmedico.com.ar${ruta}?perfil=${OTRO_PERFIL}`, {
    headers: encabezados,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Sin cookie de perfil activo: `obtenerPerfilActivo` corta temprano y el
  // camino real llega igual a `fijarPerfilActivo`, que es lo que se mide.
  cookieGet.mockReturnValue(undefined)
  requerirPermiso.mockResolvedValue({ perfilId: OTRO_PERFIL, verbo: "view" })
})

describe("lib/enlaces-perfil.ts — esSolicitudDePrefetch", () => {
  it("detecta el encabezado del router de Next (el que disparó el bug)", () => {
    expect(esSolicitudDePrefetch(pedido("/familia/enlace", { [ENCABEZADO_PREFETCH_ROUTER]: "1" })))
      .toBe(true)
  })

  it("detecta `sec-purpose: prefetch` (el estándar moderno)", () => {
    expect(
      esSolicitudDePrefetch(pedido("/turnos/enlace", { [ENCABEZADO_PREFETCH_ESTANDAR]: "prefetch" })),
    ).toBe(true)
  })

  it("detecta `sec-purpose` con más de un token (`prefetch;prerender`)", () => {
    expect(
      esSolicitudDePrefetch(
        pedido("/turnos/enlace", { [ENCABEZADO_PREFETCH_ESTANDAR]: "prefetch;prerender" }),
      ),
    ).toBe(true)
  })

  it("detecta `purpose: prefetch` (el legado)", () => {
    expect(
      esSolicitudDePrefetch(pedido("/signos/enlace", { [ENCABEZADO_PREFETCH_LEGADO]: "prefetch" })),
    ).toBe(true)
  })

  it("no le importa cómo venga escrito el valor", () => {
    expect(
      esSolicitudDePrefetch(pedido("/signos/enlace", { [ENCABEZADO_PREFETCH_LEGADO]: "PreFetch" })),
    ).toBe(true)
  })

  it("un pedido normal (el toque de una notificación, un click) NO es prefetch", () => {
    expect(esSolicitudDePrefetch(pedido("/turnos/enlace"))).toBe(false)
  })

  it("`purpose` con otro valor no cuenta: ante la duda, es un pedido real", () => {
    // Un falso positivo rompería el deep link de una notificación, que es peor
    // que el bug. Solo `next-router-prefetch` -que no existe fuera de un
    // prefetch- se acepta por su sola presencia.
    expect(
      esSolicitudDePrefetch(pedido("/turnos/enlace", { [ENCABEZADO_PREFETCH_LEGADO]: "subresource" })),
    ).toBe(false)
  })
})

describe("lib/enlaces-perfil.ts — la respuesta al prefetch", () => {
  it("es 204 sin cuerpo: nada que el router pueda guardar y reusar en el click", async () => {
    const respuesta = respuestaDePrefetchSinEfectos()

    expect(respuesta.status).toBe(204)
    expect(await respuesta.text()).toBe("")
  })

  it("va con `Cache-Control: no-store`", () => {
    expect(respuestaDePrefetchSinEfectos().headers.get("Cache-Control")).toBe("no-store")
  })

  it("no manda ninguna cookie", () => {
    expect(respuestaDePrefetchSinEfectos().headers.get("Set-Cookie")).toBeNull()
  })
})

describe("lib/enlaces-perfil.ts — esRutaDeEnlaceDePerfil", () => {
  it.each(RUTAS_ENLACE_DE_PERFIL)("reconoce %s", (ruta) => {
    expect(esRutaDeEnlaceDePerfil(ruta)).toBe(true)
  })

  it("reconoce la ruta con query string, que es como la arma `hrefCta`", () => {
    expect(esRutaDeEnlaceDePerfil(`/familia/enlace?perfil=${OTRO_PERFIL}`)).toBe(true)
  })

  it("reconoce la ruta con fragmento", () => {
    expect(esRutaDeEnlaceDePerfil("/perfil/sos/enlace#algo")).toBe(true)
  })

  it("no marca una pantalla normal", () => {
    expect(esRutaDeEnlaceDePerfil("/familia")).toBe(false)
    expect(esRutaDeEnlaceDePerfil("/familia#invitar")).toBe(false)
    expect(esRutaDeEnlaceDePerfil("/estudios")).toBe(false)
  })

  it("tolera null y vacío", () => {
    expect(esRutaDeEnlaceDePerfil(null)).toBe(false)
    expect(esRutaDeEnlaceDePerfil(undefined)).toBe(false)
    expect(esRutaDeEnlaceDePerfil("")).toBe(false)
  })
})

describe("los cinco Route Handlers de enlace", () => {
  describe("ante un PREFETCH: cero efectos", () => {
    it.each(HANDLERS)("$nombre no escribe ninguna cookie", async ({ GET }) => {
      const respuesta = await GET(pedido("/x", { [ENCABEZADO_PREFETCH_ROUTER]: "1" }))

      expect(cookieSet).not.toHaveBeenCalled()
      expect(cookieDelete).not.toHaveBeenCalled()
      expect(respuesta.status).toBe(204)
    })

    it.each(HANDLERS)("$nombre no audita ni redirige", async ({ GET }) => {
      await GET(pedido("/x", { [ENCABEZADO_PREFETCH_ESTANDAR]: "prefetch" }))

      expect(registrarAcceso).not.toHaveBeenCalled()
      expect(redirect).not.toHaveBeenCalled()
    })

    it.each(HANDLERS)("$nombre ni siquiera consulta el permiso", async ({ GET }) => {
      // La guarda va primero del todo: un prefetch no gasta un viaje a la base.
      await GET(pedido("/x", { [ENCABEZADO_PREFETCH_LEGADO]: "prefetch" }))

      expect(requerirPermiso).not.toHaveBeenCalled()
    })
  })

  describe("ante un pedido REAL: el deep link sigue funcionando", () => {
    it.each(HANDLERS)("$nombre fija el perfil y redirige a $destino", async ({ GET, destino }) => {
      await expect(GET(pedido("/x"))).rejects.toBeInstanceOf(RedirectFalso)

      // Las dos cookies: la httpOnly y su espejo (ver lib/perfil-activo-espejo.ts).
      expect(cookieSet).toHaveBeenCalledTimes(2)
      expect(cookieSet.mock.calls[0][0]).toBe("perfil_activo")
      expect(cookieSet.mock.calls[0][1]).toBe(OTRO_PERFIL)
      expect(registrarAcceso).toHaveBeenCalledOnce()
      expect(redirect).toHaveBeenCalledWith(destino)
    })

    it.each(HANDLERS)("$nombre sin `?perfil=` redirige igual, sin tocar nada", async ({
      GET,
      destino,
    }) => {
      const sinParametro = new Request(`https://www.historialmedico.com.ar/x`)

      await expect(GET(sinParametro)).rejects.toBeInstanceOf(RedirectFalso)

      expect(cookieSet).not.toHaveBeenCalled()
      expect(redirect).toHaveBeenCalledWith(destino)
    })
  })
})

describe("el censo: ningún GET prefetcheable escribe cookies", () => {
  const RAIZ = path.resolve(__dirname, "../..")

  /** Todos los `route.ts` del árbol de la app, con su ruta relativa. */
  function routeHandlers(directorio: string, acumulado: string[] = []): string[] {
    for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
      const completo = path.join(directorio, entrada.name)
      if (entrada.isDirectory()) {
        routeHandlers(completo, acumulado)
      } else if (entrada.name === "route.ts") {
        acumulado.push(completo)
      }
    }
    return acumulado
  }

  const HANDLERS_EN_DISCO = routeHandlers(path.join(RAIZ, "app"))

  it("encontró Route Handlers para revisar (si esto falla, el censo se quedó ciego)", () => {
    expect(HANDLERS_EN_DISCO.length).toBeGreaterThanOrEqual(5)
  })

  it("todo handler que cambie el perfil activo pasa por `responderEnlaceDePerfil`", () => {
    // La regla no puede depender de que alguien se acuerde. Si mañana aparece
    // un sexto enlace escrito a mano —con su `fijarPerfilActivo` suelto y sin
    // guarda de prefetch—, este test lo caza antes de que llegue al teléfono.
    const infractores = HANDLERS_EN_DISCO.filter((archivo) => {
      const codigo = readFileSync(archivo, "utf8")
      const cambiaElPerfil =
        codigo.includes("fijarPerfilActivo") || codigo.includes("cambiarPerfilDesdeParametro")
      return cambiaElPerfil && !codigo.includes("responderEnlaceDePerfil")
    })

    expect(infractores.map((a) => path.relative(RAIZ, a))).toEqual([])
  })

  it("el censo de `RUTAS_ENLACE_DE_PERFIL` coincide con lo que hay en el disco", () => {
    // Los dos sentidos: que no falte ninguna ruta en la constante (o el
    // `prefetch={false}` del cliente no la cubriría) y que no sobre ninguna.
    const enDisco = HANDLERS_EN_DISCO.filter((archivo) =>
      readFileSync(archivo, "utf8").includes("responderEnlaceDePerfil"),
    )
      .map((archivo) =>
        path
          .relative(path.join(RAIZ, "app"), archivo)
          .split(path.sep)
          .filter((segmento) => !segmento.startsWith("(") && segmento !== "route.ts")
          .join("/"),
      )
      .map((ruta) => `/${ruta}`)
      .sort()

    expect(enDisco).toEqual([...RUTAS_ENLACE_DE_PERFIL].sort())
  })
})
