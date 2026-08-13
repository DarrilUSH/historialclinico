/**
 * Test de la matriz de rutas (`lib/auth/rutas.ts`). Lógica pura: no levanta
 * servidor, no toca la base, no necesita cookies.
 *
 * Corre con el runner nativo de Node (`node --test`) y el type stripping que
 * Node 24 trae de fábrica — por eso el import lleva la extensión `.ts`
 * explícita y una ruta relativa en vez del alias `@/`: el resolver de Node no
 * conoce los `paths` de tsconfig.
 *
 *   npm run test:rutas
 *
 * Vitest y la suite completa de las guardas llegan en la tarea
 * "[Haiku] - Tests unitarios de las guardas de permisos" del mismo sprint;
 * esto cubre mientras tanto la pieza que decide qué se sirve sin sesión.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  destinoSeguro,
  esRutaDeApi,
  esRutaPrivada,
  esRutaPublica,
  esRutaSoloAnonima,
  rutaDeLoginCon,
} from "../../lib/auth/rutas.ts"

const EN_DEV = { incluirRutasDeDesarrollo: true }
const EN_PROD = { incluirRutasDeDesarrollo: false }

test("las rutas públicas se sirven sin sesión", () => {
  for (const ruta of ["/", "/login", "/registro", "/recuperar"]) {
    assert.equal(esRutaPublica(ruta, EN_PROD), true, ruta)
  }
})

test("las subrutas de una ruta pública también son públicas", () => {
  assert.equal(esRutaPublica("/recuperar/confirmar", EN_PROD), true)
})

test("la barra final no cambia la clasificación", () => {
  assert.equal(esRutaPublica("/login/", EN_PROD), true)
  assert.equal(esRutaPublica("/perfiles/", EN_PROD), false)
})

test("`/` no vuelve pública a toda la aplicación", () => {
  assert.equal(esRutaPublica("/perfiles", EN_PROD), false)
  assert.equal(esRutaPublica("/estudios", EN_PROD), false)
})

test("privado por defecto: rutas que todavía no existen exigen sesión", () => {
  for (const ruta of ["/perfiles", "/estudios", "/turnos", "/familia", "/sos"]) {
    assert.equal(esRutaPrivada(ruta, EN_PROD), true, ruta)
  }
})

test("una ruta pública por prefijo no se cuela con un nombre parecido", () => {
  // `/loginfalso` NO es subruta de `/login`.
  assert.equal(esRutaPublica("/loginfalso", EN_PROD), false)
  assert.equal(esRutaPublica("/registro-masivo", EN_PROD), false)
})

test("/estado es pública en desarrollo y privada en producción", () => {
  assert.equal(esRutaPublica("/estado", EN_DEV), true)
  assert.equal(esRutaPublica("/estado", EN_PROD), false)
})

test("solo /login y /registro rebotan cuando ya hay sesión", () => {
  assert.equal(esRutaSoloAnonima("/login"), true)
  assert.equal(esRutaSoloAnonima("/registro"), true)
  assert.equal(esRutaSoloAnonima("/recuperar"), false)
  assert.equal(esRutaSoloAnonima("/recuperar/confirmar"), false)
  assert.equal(esRutaSoloAnonima("/"), false)
})

test("los Route Handlers se reconocen por el prefijo /api", () => {
  assert.equal(esRutaDeApi("/api/documentos"), true)
  assert.equal(esRutaDeApi("/api"), true)
  assert.equal(esRutaDeApi("/apio"), false)
  assert.equal(esRutaDeApi("/perfiles"), false)
})

test("destinoSeguro acepta rutas internas y conserva la query", () => {
  assert.equal(destinoSeguro("/perfiles"), "/perfiles")
  assert.equal(destinoSeguro("/estudios?pagina=2"), "/estudios?pagina=2")
})

test("destinoSeguro rechaza los vectores de open redirect", () => {
  const maliciosos = [
    "https://sitio-falso.ar",
    "//sitio-falso.ar",
    "/\\sitio-falso.ar",
    "javascript:alert(1)",
    "perfiles",
    "",
    null,
    undefined,
  ]
  for (const valor of maliciosos) {
    assert.equal(destinoSeguro(valor), null, String(valor))
  }
})

test("destinoSeguro rechaza caracteres de control (inyección en Location)", () => {
  assert.equal(destinoSeguro("/perfiles\r\nSet-Cookie: a=b"), null)
  assert.equal(destinoSeguro("/perfiles\u0000"), null)
})

test("destinoSeguro evita el rebote infinito hacia el propio login", () => {
  assert.equal(destinoSeguro("/login"), null)
  assert.equal(destinoSeguro("/login?desde=%2Fperfiles"), null)
  assert.equal(destinoSeguro("/registro"), null)
})

test("rutaDeLoginCon arma la URL de vuelta y cae a /login si el destino no sirve", () => {
  assert.equal(rutaDeLoginCon("/perfiles"), "/login?desde=%2Fperfiles")
  assert.equal(
    rutaDeLoginCon("/estudios?pagina=2"),
    "/login?desde=%2Festudios%3Fpagina%3D2",
  )
  assert.equal(rutaDeLoginCon("https://sitio-falso.ar"), "/login")
  assert.equal(rutaDeLoginCon(null), "/login")
})
