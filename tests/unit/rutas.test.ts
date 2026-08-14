/**
 * Test de la matriz de rutas (`lib/auth/rutas.ts`). Lógica pura: no levanta
 * servidor, no toca la base, no necesita cookies.
 *
 * Corre con Vitest configurado en `vitest.config.ts`.
 *
 *   npm run test
 *   npm run test:rutas
 */

import { describe, it, expect } from "vitest"

import {
  RUTA_COMPARTIR,
  RUTA_CRON_ALERTAS_MEDICACION,
  RUTA_CRON_RECORDATORIOS,
  RUTA_MANIFEST,
  RUTA_OFFLINE,
  destinoSeguro,
  esRutaDeApi,
  esRutaPrivada,
  esRutaPublica,
  esRutaSoloAnonima,
  rutaDeLoginCon,
} from "@/lib/auth/rutas.ts"

const EN_DEV = { incluirRutasDeDesarrollo: true }
const EN_PROD = { incluirRutasDeDesarrollo: false }

describe("lib/auth/rutas.ts", () => {
  it("las rutas públicas se sirven sin sesión", () => {
    for (const ruta of ["/", "/login", "/registro", "/recuperar"]) {
      expect(esRutaPublica(ruta, EN_PROD)).toBe(true)
    }
  })

  it("las subrutas de una ruta pública también son públicas", () => {
    expect(esRutaPublica("/recuperar/confirmar", EN_PROD)).toBe(true)
  })

  it("el service worker es público TAMBIÉN en producción", () => {
    // `navigator.serviceWorker.register()` no sigue redirecciones: un 307 al
    // login rompe el registro y con él todas las notificaciones push. Ver el
    // comentario de RUTA_SERVICE_WORKER en lib/auth/rutas.ts.
    expect(esRutaPublica("/sw.js", EN_PROD)).toBe(true)
  })

  it("la pantalla de sin conexión es pública TAMBIÉN en producción", () => {
    // El service worker la precarga durante `install`, con un `fetch` que
    // puede ocurrir antes de que exista sesión: si el proxy contestara
    // `307 → /login`, lo que quedaría guardado en el teléfono sería la
    // pantalla de login. Ver el comentario de RUTA_OFFLINE en lib/auth/rutas.ts.
    expect(esRutaPublica(RUTA_OFFLINE, EN_PROD)).toBe(true)
    expect(esRutaPublica("/offline", EN_PROD)).toBe(true)
  })

  it("/offline no vuelve pública ninguna ruta con nombre parecido", () => {
    expect(esRutaPublica("/offline-datos", EN_PROD)).toBe(false)
    expect(esRutaPrivada("/offline-datos", EN_PROD)).toBe(true)
  })

  it("el manifest de instalación es público TAMBIÉN en producción", () => {
    // Chrome lo pide para evaluar instalabilidad, posiblemente sin sesión:
    // un 307 al login rompe el manifest y la app deja de ofrecerse como
    // instalable. Ver el comentario de RUTA_MANIFEST en lib/auth/rutas.ts.
    expect(esRutaPublica(RUTA_MANIFEST, EN_PROD)).toBe(true)
    expect(esRutaPublica("/manifest.webmanifest", EN_PROD)).toBe(true)
  })

  it("el payload offline de la ficha SOS SÍ exige sesión", () => {
    // Es lo contrario de `/offline`: el JSON de `/api/sos/{perfilId}` trae
    // datos de salud y se sirve por el camino normal (401 sin cookie, porque
    // es una ruta de API). Que la pantalla offline sea pública no arrastra a
    // los datos que esa pantalla promete tener guardados.
    expect(esRutaPrivada("/api/sos/3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", EN_PROD)).toBe(true)
    expect(esRutaDeApi("/api/sos/3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d")).toBe(true)
    expect(esRutaPrivada("/sos", EN_PROD)).toBe(true)
  })

  it("la imagen estable de una credencial exige sesión", () => {
    const ruta = "/api/credenciales/3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/imagen"
    expect(esRutaPrivada(ruta, EN_PROD)).toBe(true)
    expect(esRutaDeApi(ruta)).toBe(true)
  })

  it("el barrido de recordatorios es público para el proxy, también en producción", () => {
    // Lo llama pg_cron vía pg_net: un proceso de la base, sin cookies y sin
    // ninguna cuenta con la cual iniciar sesión. Se autentica con el header
    // `x-cron-secret` dentro del propio Route Handler. Ver el comentario de
    // RUTA_CRON_RECORDATORIOS en lib/auth/rutas.ts.
    expect(esRutaPublica(RUTA_CRON_RECORDATORIOS, EN_PROD)).toBe(true)
    expect(esRutaPublica("/api/push/procesar-recordatorios", EN_PROD)).toBe(true)
  })

  it("el barrido de alertas de medicación también es público en producción", () => {
    // Sprint 7.4: gemelo del anterior. Lo llama el mismo pg_cron con el mismo
    // header `x-cron-secret` contra la misma variable CRON_SECRET.
    expect(esRutaPublica(RUTA_CRON_ALERTAS_MEDICACION, EN_PROD)).toBe(true)
    expect(esRutaPublica("/api/push/procesar-alertas-medicacion", EN_PROD)).toBe(true)
  })

  it("el receptor del Web Share Target es público para el proxy, también en producción, pero sigue siendo una ruta de /api", () => {
    // A diferencia de RUTA_CRON_*, la autenticación real acá SÍ es la cookie
    // de sesión: declararla pública en el proxy solo evita el 401 JSON
    // automático, para que app/api/compartir/route.ts pueda hacer su propia
    // redirección amable a /login cuando no hay sesión (ver el comentario de
    // RUTA_COMPARTIR en lib/auth/rutas.ts).
    expect(esRutaPublica(RUTA_COMPARTIR, EN_PROD)).toBe(true)
    expect(esRutaPublica("/api/compartir", EN_PROD)).toBe(true)
    expect(esRutaDeApi(RUTA_COMPARTIR)).toBe(true)
  })

  it("la pantalla de recepción /compartir sigue exigiendo sesión: la excepción es solo el receptor de /api", () => {
    expect(esRutaPrivada("/compartir", EN_PROD)).toBe(true)
    expect(esRutaDeApi("/compartir")).toBe(false)
  })

  it("las excepciones de los barridos NO abren el resto de /api/push", () => {
    // `/api/push/probar` sigue exigiendo sesión: manda notificaciones a la
    // cuenta que llama y necesita saber quién es.
    expect(esRutaPrivada("/api/push/probar", EN_PROD)).toBe(true)
    expect(esRutaPrivada("/api/push", EN_PROD)).toBe(true)
    expect(esRutaPrivada("/api/push/procesar-recordatorios-falso", EN_PROD)).toBe(true)
    expect(esRutaPrivada("/api/push/procesar-alertas", EN_PROD)).toBe(true)
    expect(esRutaPrivada("/api/push/procesar-alertas-medicacion-falso", EN_PROD)).toBe(true)
  })

  it("la barra final no cambia la clasificación", () => {
    expect(esRutaPublica("/login/", EN_PROD)).toBe(true)
    expect(esRutaPublica("/perfiles/", EN_PROD)).toBe(false)
  })

  it("`/` no vuelve pública a toda la aplicación", () => {
    expect(esRutaPublica("/perfiles", EN_PROD)).toBe(false)
    expect(esRutaPublica("/estudios", EN_PROD)).toBe(false)
  })

  it("privado por defecto: rutas que todavía no existen exigen sesión", () => {
    for (const ruta of ["/perfiles", "/estudios", "/turnos", "/familia", "/sos"]) {
      expect(esRutaPrivada(ruta, EN_PROD)).toBe(true)
    }
  })

  it("el deep link de perfil (/turnos/enlace, Sprint 6.6) exige sesión, sin sesión rebota a /login y no a un 401 JSON", () => {
    // A diferencia de `RUTA_CRON_RECORDATORIOS`, acá quien llega es una
    // persona tocando una notificación, no un proceso sin cookies: por eso
    // `turnos/enlace/route.ts` vive fuera de `/api` (`esRutaDeApi` da
    // `false`) y sin sesión cae en la rama de redirect a `/login?desde=...`
    // de `proxy.ts`, no en la de 401 JSON.
    expect(esRutaPrivada("/turnos/enlace", EN_PROD)).toBe(true)
    expect(esRutaDeApi("/turnos/enlace")).toBe(false)
  })

  it("una ruta pública por prefijo no se cuela con un nombre parecido", () => {
    // `/loginfalso` NO es subruta de `/login`.
    expect(esRutaPublica("/loginfalso", EN_PROD)).toBe(false)
    expect(esRutaPublica("/registro-masivo", EN_PROD)).toBe(false)
  })

  it("/estado es pública en desarrollo y privada en producción", () => {
    expect(esRutaPublica("/estado", EN_DEV)).toBe(true)
    expect(esRutaPublica("/estado", EN_PROD)).toBe(false)
  })

  it("solo /login y /registro rebotan cuando ya hay sesión", () => {
    expect(esRutaSoloAnonima("/login")).toBe(true)
    expect(esRutaSoloAnonima("/registro")).toBe(true)
    expect(esRutaSoloAnonima("/recuperar")).toBe(false)
    expect(esRutaSoloAnonima("/recuperar/confirmar")).toBe(false)
    expect(esRutaSoloAnonima("/")).toBe(false)
  })

  it("los Route Handlers se reconocen por el prefijo /api", () => {
    expect(esRutaDeApi("/api/documentos")).toBe(true)
    expect(esRutaDeApi("/api")).toBe(true)
    expect(esRutaDeApi("/apio")).toBe(false)
    expect(esRutaDeApi("/perfiles")).toBe(false)
  })

  it("destinoSeguro acepta rutas internas y conserva la query", () => {
    expect(destinoSeguro("/perfiles")).toBe("/perfiles")
    expect(destinoSeguro("/estudios?pagina=2")).toBe("/estudios?pagina=2")
  })

  it("destinoSeguro rechaza los vectores de open redirect", () => {
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
      expect(destinoSeguro(valor)).toBe(null)
    }
  })

  it("destinoSeguro rechaza caracteres de control (inyección en Location)", () => {
    expect(destinoSeguro("/perfiles\r\nSet-Cookie: a=b")).toBe(null)
    expect(destinoSeguro("/perfiles\u0000")).toBe(null)
  })

  it("destinoSeguro evita el rebote infinito hacia el propio login", () => {
    expect(destinoSeguro("/login")).toBe(null)
    expect(destinoSeguro("/login?desde=%2Fperfiles")).toBe(null)
    expect(destinoSeguro("/registro")).toBe(null)
  })

  it("rutaDeLoginCon arma la URL de vuelta y cae a /login si el destino no sirve", () => {
    expect(rutaDeLoginCon("/perfiles")).toBe("/login?desde=%2Fperfiles")
    expect(rutaDeLoginCon("/estudios?pagina=2")).toBe(
      "/login?desde=%2Festudios%3Fpagina%3D2",
    )
    expect(rutaDeLoginCon("https://sitio-falso.ar")).toBe("/login")
    expect(rutaDeLoginCon(null)).toBe("/login")
  })
})
