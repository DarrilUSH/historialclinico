/**
 * Tests de los helpers PUROS del service worker (`public/sw.js`, Sprint 8,
 * tarea 8.4).
 *
 * ## Cómo se prueba un archivo que no se puede importar
 *
 * `public/sw.js` se sirve tal cual desde `public/`: es JavaScript de navegador
 * sin `export`, no pasa por el compilador de Next y por lo tanto tampoco por
 * `tsc`. Así que se lo lee del disco y se lo evalúa con `node:vm` en un
 * contexto que finge ser el scope de un worker (`self`, `caches`, `fetch`).
 * Al final del script evaluado se agrega una expresión que devuelve los
 * helpers, que en ese contexto son variables locales del módulo.
 *
 * **Se prueba el archivo REAL**, no una copia: si alguien renombra un helper o
 * cambia el nombre de una caché, estos tests fallan. Esa es toda la gracia —un
 * service worker es código que corre en el teléfono de otra persona, sin
 * consola a mano, y la única forma de tener confianza en sus decisiones es
 * poder ejercitarlas acá.
 *
 * Lo que NO se prueba acá y se prueba en el dispositivo (ver
 * `docs/capturas/dispositivo-real/README.md`): las estrategias con efectos
 * —`fetch`, `caches.put`— y el ciclo de vida `install`/`activate`/`fetch`. Un
 * mock de la Cache API demostraría que el mock funciona.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import vm from "node:vm"

import { describe, expect, it } from "vitest"

const RUTA_SW = path.resolve(__dirname, "../../public/sw.js")
const CODIGO_SW = readFileSync(RUTA_SW, "utf8")

/** Los helpers puros del worker, extraídos evaluando el archivo real. */
interface HelpersSw {
  clasificarSolicitud: (
    pathname: string,
    esNavegacion: boolean,
  ) => "estatico" | "pagina-sos" | "datos-sos" | "imagen-credencial" | "navegacion" | "red"
  decidirDestinoDeCache: (
    estado: number,
    redirigido: boolean,
    mismaRuta: boolean,
  ) => "guardar" | "descartar" | "conservar"
  cachesAEliminar: (nombres: string[], vigentes: string[]) => string[]
  extraerRecursosDeHtml: (html: string) => string[]
  esEstaticoGuardable: (cacheControl: string | null) => boolean
  claveDeCache: (url: string) => string
  CACHES_VIGENTES: string[]
  FAMILIAS_CON_DATOS: string[]
  VERSION: string
}

function cargarHelpers(): HelpersSw {
  // Scope mínimo de service worker: lo justo para que los `addEventListener`
  // de nivel superior no exploten al evaluar el archivo.
  const oyentes: string[] = []
  const self = {
    addEventListener: (tipo: string) => oyentes.push(tipo),
    location: { origin: "http://localhost:3000" },
    registration: {},
    clients: {},
    skipWaiting: () => Promise.resolve(),
  }

  const contexto = vm.createContext({
    self,
    caches: {},
    fetch: () => Promise.reject(new Error("sin red en los tests")),
    Response: globalThis.Response,
    Request: globalThis.Request,
    URL: globalThis.URL,
    Promise: globalThis.Promise,
    console,
  })

  const expresion = `;({
    clasificarSolicitud,
    decidirDestinoDeCache,
    cachesAEliminar,
    extraerRecursosDeHtml,
    esEstaticoGuardable,
    claveDeCache,
    CACHES_VIGENTES,
    FAMILIAS_CON_DATOS,
    VERSION,
  })`

  const helpers = vm.runInContext(CODIGO_SW + expresion, contexto) as HelpersSw

  // El archivo tiene que seguir registrando los handlers de siempre: si esta
  // suite pasara con un `sw.js` que dejó de escuchar `push`, no serviría de
  // nada. Es la garantía de que agregar caché no apagó las notificaciones.
  expect(oyentes).toEqual(
    expect.arrayContaining(["install", "activate", "fetch", "message", "push", "notificationclick"]),
  )

  return helpers
}

const sw = cargarHelpers()

const UUID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"

describe("public/sw.js — clasificarSolicitud (la matriz de docs/offline.md §3)", () => {
  it("los estáticos de Next van al caché de estáticos", () => {
    expect(sw.clasificarSolicitud("/_next/static/chunks/main-abc123.js", false)).toBe("estatico")
    expect(sw.clasificarSolicitud("/_next/static/css/hoja.css", false)).toBe("estatico")
  })

  it("una NAVEGACIÓN a /sos se cachea; el mismo /sos pedido como RSC NO", () => {
    // Es la trampa central del archivo: Next pide la misma URL como HTML (en
    // una navegación completa) y como payload RSC (`text/x-component`, en una
    // navegación del router). Guardar las dos bajo la clave `/sos` dejaría el
    // caché con un payload RSC que el navegador intentaría mostrar como
    // página.
    expect(sw.clasificarSolicitud("/sos", true)).toBe("pagina-sos")
    expect(sw.clasificarSolicitud("/sos", false)).toBe("red")
  })

  it("el payload JSON de CUALQUIER perfil es datos-sos", () => {
    expect(sw.clasificarSolicitud(`/api/sos/${UUID}`, false)).toBe("datos-sos")
  })

  it("la imagen de credencial gana tanto como subrecurso como abierta en una pestaña", () => {
    // El `<img>` de la ficha la pide con `mode: "no-cors"`/`"cors"`; el enlace
    // "verla en grande" la pide como navegación. Las dos tienen que caer en la
    // misma estrategia, o abrirla en una pestaña devolvería `/offline`.
    expect(sw.clasificarSolicitud(`/api/credenciales/${UUID}/imagen`, false)).toBe(
      "imagen-credencial",
    )
    expect(sw.clasificarSolicitud(`/api/credenciales/${UUID}/imagen`, true)).toBe(
      "imagen-credencial",
    )
  })

  it("la SIGNED URL de una credencial NO se cachea nunca", () => {
    // `/api/credenciales/{id}/url` emite un enlace público de vida corta.
    // Cachearlo dejaría escrito en el teléfono un acceso al objeto que no
    // depende de ninguna sesión. Ver el encabezado de `public/sw.js`.
    expect(sw.clasificarSolicitud(`/api/credenciales/${UUID}/url`, false)).toBe("red")
  })

  it("el resto de la app navega contra la red y cae a /offline, sin cachearse", () => {
    for (const ruta of ["/estudios", "/turnos", "/medicacion", "/coberturas", "/inicio"]) {
      expect(sw.clasificarSolicitud(ruta, true)).toBe("navegacion")
      expect(sw.clasificarSolicitud(ruta, false)).toBe("red")
    }
  })

  it("las otras rutas de /api no se tocan", () => {
    expect(sw.clasificarSolicitud("/api/push/suscribir", false)).toBe("red")
    expect(sw.clasificarSolicitud("/api/documentos/extraer", false)).toBe("red")
  })
})

describe("public/sw.js — decidirDestinoDeCache (la decisión de seguridad)", () => {
  it("una respuesta buena de la misma ruta se guarda", () => {
    expect(sw.decidirDestinoDeCache(200, false, true)).toBe("guardar")
    expect(sw.decidirDestinoDeCache(204, false, true)).toBe("guardar")
  })

  it("un 307 al login llega como 200 REDIRIGIDO y se descarta", () => {
    // `fetch` sigue las redirecciones por defecto, así que la sesión vencida
    // llega acá disfrazada de 200 con el HTML del login. Sin este caso, el
    // caché de `/sos` terminaría conteniendo la pantalla de login.
    expect(sw.decidirDestinoDeCache(200, true, true)).toBe("descartar")
    expect(sw.decidirDestinoDeCache(200, false, false)).toBe("descartar")
  })

  it("401/403/404 BORRAN la copia local: así se propaga una revocación", () => {
    expect(sw.decidirDestinoDeCache(401, false, true)).toBe("descartar")
    expect(sw.decidirDestinoDeCache(403, false, true)).toBe("descartar")
    expect(sw.decidirDestinoDeCache(404, false, true)).toBe("descartar")
  })

  it("un 5xx CONSERVA la copia local: un servidor caído no borra la ficha de emergencia", () => {
    expect(sw.decidirDestinoDeCache(500, false, true)).toBe("conservar")
    expect(sw.decidirDestinoDeCache(503, false, true)).toBe("conservar")
  })
})

describe("public/sw.js — versionado y limpieza de cachés", () => {
  it("las cinco cachés vigentes llevan el prefijo del proyecto y la versión", () => {
    expect(sw.CACHES_VIGENTES).toHaveLength(5)
    for (const nombre of sw.CACHES_VIGENTES) {
      expect(nombre.startsWith("historial-medico-")).toBe(true)
      expect(nombre.endsWith(`-${sw.VERSION}`)).toBe(true)
    }
  })

  it("activate borra las versiones viejas del proyecto y NADA más", () => {
    const nombres = [
      ...sw.CACHES_VIGENTES,
      "historial-medico-datos-v0",
      "historial-medico-paginas-v0",
      // De otra aplicación del mismo origen: no es asunto de este worker.
      "workbox-precache-v2",
      "otra-app-v1",
    ]

    expect(sw.cachesAEliminar(nombres, sw.CACHES_VIGENTES)).toEqual([
      "historial-medico-datos-v0",
      "historial-medico-paginas-v0",
    ])
  })

  it("las familias con datos personales son las mismas que declara lib/pwa/registrar-sw.ts", () => {
    // La lista está duplicada porque `public/sw.js` no se puede importar desde
    // TypeScript. Este test es lo que impide que las dos copias diverjan en
    // silencio y que un logout deje de borrar una de ellas.
    const registrarSw = readFileSync(
      path.resolve(__dirname, "../../lib/pwa/registrar-sw.ts"),
      "utf8",
    )
    const declarada = registrarSw.match(/FAMILIAS_CON_DATOS = \[([^\]]+)\]/)
    expect(declarada).not.toBeNull()

    const familiasEnTs = [...declarada![1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect(familiasEnTs).toEqual(sw.FAMILIAS_CON_DATOS)
  })

  it("cada familia con datos tiene su caché vigente", () => {
    for (const familia of sw.FAMILIAS_CON_DATOS) {
      expect(sw.CACHES_VIGENTES).toContain(`historial-medico-${familia}-${sw.VERSION}`)
    }
  })
})

describe("public/sw.js — extraerRecursosDeHtml", () => {
  const HTML = `<!DOCTYPE html><html><head>
    <link rel="stylesheet" href="/_next/static/chunks/hoja-abc.css"/>
    <link rel="preload" href="/_next/static/media/fuente.woff2" as="font"/>
    </head><body>
    <img src="/api/credenciales/${UUID}/imagen?lado=front" alt="frente"/>
    <img src="/api/credenciales/${UUID}/imagen?lado=back" alt="dorso"/>
    <a href="/coberturas">Billetera</a>
    <img src="https://otro-origen.example/foto.jpg" alt="ajena"/>
    <script src="/_next/static/chunks/main-def.js"></script>
    </body></html>`

  it("saca los estáticos de Next y las fotos de credencial, y nada más", () => {
    expect(sw.extraerRecursosDeHtml(HTML)).toEqual([
      "/_next/static/chunks/hoja-abc.css",
      "/_next/static/media/fuente.woff2",
      `/api/credenciales/${UUID}/imagen?lado=front`,
      `/api/credenciales/${UUID}/imagen?lado=back`,
      "/_next/static/chunks/main-def.js",
    ])
  })

  it("conserva el query de la imagen: sin `?lado` se precargaría la cara equivocada", () => {
    const rutas = sw.extraerRecursosDeHtml(HTML)
    expect(rutas).toContain(`/api/credenciales/${UUID}/imagen?lado=front`)
    expect(rutas).toContain(`/api/credenciales/${UUID}/imagen?lado=back`)
  })

  it("desescapa &amp; en los atributos", () => {
    const html = `<img src="/api/credenciales/${UUID}/imagen?lado=front&amp;v=2"/>`
    expect(sw.extraerRecursosDeHtml(html)).toEqual([
      `/api/credenciales/${UUID}/imagen?lado=front&v=2`,
    ])
  })

  it("no repite una ruta que aparece dos veces", () => {
    const html = `<link href="/_next/static/a.css"/><link href="/_next/static/a.css"/>`
    expect(sw.extraerRecursosDeHtml(html)).toEqual(["/_next/static/a.css"])
  })

  it("un HTML sin recursos no rompe nada", () => {
    expect(sw.extraerRecursosDeHtml("<html><body>hola</body></html>")).toEqual([])
  })
})

describe("public/sw.js — esEstaticoGuardable", () => {
  it("guarda lo que `next start` marca immutable", () => {
    expect(sw.esEstaticoGuardable("public, max-age=31536000, immutable")).toBe(true)
  })

  it("NO guarda los chunks de `next dev`: servirían código viejo tras cada edición", () => {
    expect(sw.esEstaticoGuardable("no-store, must-revalidate")).toBe(false)
    expect(sw.esEstaticoGuardable("no-cache")).toBe(false)
    expect(sw.esEstaticoGuardable(null)).toBe(false)
  })
})

describe("public/sw.js — claveDeCache", () => {
  it("conserva el query (dos caras de la credencial son dos entradas)", () => {
    expect(sw.claveDeCache(`http://localhost:3000/api/credenciales/${UUID}/imagen?lado=front`)).toBe(
      `http://localhost:3000/api/credenciales/${UUID}/imagen?lado=front`,
    )
  })

  it("descarta el fragmento, que nunca viaja al servidor", () => {
    expect(sw.claveDeCache("http://localhost:3000/sos#contacto")).toBe("http://localhost:3000/sos")
  })
})
