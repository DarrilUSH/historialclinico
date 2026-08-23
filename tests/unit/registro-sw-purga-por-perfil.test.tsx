// @vitest-environment jsdom

/**
 * Tests de `RegistroServiceWorker` (`components/pwa/registro-service-worker.tsx`),
 * enfocados en el arreglo del 2026-08-23: **el dispositivo guarda offline los
 * datos de un solo perfil a la vez**.
 *
 * El bug que cierran, reproducido con un build de producción: el caché
 * `paginas` del service worker guarda `/sos` bajo **una sola clave, sin
 * discriminar perfil** (`public/sw.js`, `RUTAS_PAGINA_OFFLINE`). La precarga
 * que se suponía que iba a pisar la copia vieja está condicionada por una
 * marca de sesión de PESTAÑA por perfil, así que volver a un perfil ya
 * precargado en esa misma sesión la salteaba. Resultado: con María como perfil
 * activo y el teléfono sin señal, `/sos` mostraba la ficha de Roberto —grupo
 * sanguíneo, alergias y medicación crítica de otra persona—.
 *
 * Lo que se prueba es la regla, no la implementación: si lo que hay en disco no
 * es de este perfil, **se purga primero y se precarga después**; si sí lo es y
 * esta pestaña ya precargó, no se toca nada (la economía de datos del diseño
 * original sigue intacta).
 *
 *   npm run test -- registro-sw-purga-por-perfil
 */

import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const precargarFichaSos = vi.fn()
const purgarCacheOffline = vi.fn(async () => {})
const registrarServiceWorker = vi.fn(async () => ({ active: {} }) as ServiceWorkerRegistration)

vi.mock("@/lib/pwa/registrar-sw", () => ({
  precargarFichaSos: (...args: unknown[]) => precargarFichaSos(...args),
  purgarCacheOffline: () => purgarCacheOffline(),
  registrarServiceWorker: () => registrarServiceWorker(),
}))

// El aviso de actualización no tiene nada que ver con la purga y arrastra su
// propio manejo de `navigator.serviceWorker`.
vi.mock("@/components/pwa/aviso-actualizacion", () => ({
  AvisoActualizacion: () => null,
}))

const { RegistroServiceWorker } = await import("@/components/pwa/registro-service-worker")

const MARIA = "660e8400-e29b-41d4-a716-446655440001"
const ROBERTO = "660e8400-e29b-41d4-a716-446655440003"

const CLAVE_PERFIL_EN_DISCO = "historial-medico:perfil-offline"
const clavePrecarga = (perfilId: string) => `historial-medico:precarga-sos:${perfilId}`

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe("RegistroServiceWorker — el disco es de un perfil por vez", () => {
  it("si en disco hay datos de OTRO perfil, los purga y precarga los del activo", async () => {
    window.localStorage.setItem(CLAVE_PERFIL_EN_DISCO, ROBERTO)

    render(<RegistroServiceWorker perfilId={MARIA} />)

    await waitFor(() => expect(purgarCacheOffline).toHaveBeenCalledOnce())
    await waitFor(() => expect(precargarFichaSos).toHaveBeenCalledOnce())

    // La purga va PRIMERO: precargar sobre un caché que todavía tiene la ficha
    // ajena deja abierta la ventana en la que se puede leer la equivocada.
    expect(purgarCacheOffline.mock.invocationCallOrder[0]).toBeLessThan(
      precargarFichaSos.mock.invocationCallOrder[0],
    )
    expect(precargarFichaSos).toHaveBeenCalledWith(expect.anything(), MARIA)
    expect(window.localStorage.getItem(CLAVE_PERFIL_EN_DISCO)).toBe(MARIA)
  })

  it("purga aunque esta pestaña YA haya precargado ese perfil — el caso exacto del bug", async () => {
    // María ya se precargó en esta pestaña, después se pasó a Roberto (que
    // pisó el único `/sos` del caché) y ahora se vuelve a María. Con la marca
    // de pestaña puesta, la precarga se saltea: sin purga, el `/sos` guardado
    // seguiría siendo el de Roberto.
    window.localStorage.setItem(CLAVE_PERFIL_EN_DISCO, ROBERTO)
    window.sessionStorage.setItem(clavePrecarga(MARIA), "1")

    render(<RegistroServiceWorker perfilId={MARIA} />)

    await waitFor(() => expect(purgarCacheOffline).toHaveBeenCalledOnce())
    // Y la marca de pestaña se olvida, así que la ficha correcta se vuelve a
    // bajar en vez de quedar el caché vacío hasta la próxima apertura.
    await waitFor(() => expect(precargarFichaSos).toHaveBeenCalledWith(expect.anything(), MARIA))
  })

  it("sin nada anotado en disco purga igual: sin memoria, la opción segura es asumir que es de otro", async () => {
    render(<RegistroServiceWorker perfilId={MARIA} />)

    await waitFor(() => expect(purgarCacheOffline).toHaveBeenCalledOnce())
    expect(window.localStorage.getItem(CLAVE_PERFIL_EN_DISCO)).toBe(MARIA)
  })

  it("si el disco ya es de este perfil, no purga nada", async () => {
    window.localStorage.setItem(CLAVE_PERFIL_EN_DISCO, MARIA)

    render(<RegistroServiceWorker perfilId={MARIA} />)

    await waitFor(() => expect(precargarFichaSos).toHaveBeenCalledOnce())
    expect(purgarCacheOffline).not.toHaveBeenCalled()
  })

  it("mismo perfil y precarga ya hecha en esta pestaña: no gasta datos de nuevo", async () => {
    window.localStorage.setItem(CLAVE_PERFIL_EN_DISCO, MARIA)
    window.sessionStorage.setItem(clavePrecarga(MARIA), "1")

    render(<RegistroServiceWorker perfilId={MARIA} />)

    await waitFor(() => expect(registrarServiceWorker).toHaveBeenCalledOnce())
    expect(purgarCacheOffline).not.toHaveBeenCalled()
    expect(precargarFichaSos).not.toHaveBeenCalled()
  })
})
