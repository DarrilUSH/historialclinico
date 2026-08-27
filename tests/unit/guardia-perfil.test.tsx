// @vitest-environment jsdom

/**
 * La guardia de perfil (`components/perfiles/guardia-perfil.tsx` +
 * `lib/perfil-activo-espejo.ts`): la capa de cliente que hace que una pantalla
 * congelada -una pestaña vieja, una restauración de bfcache, la sesión que
 * Chrome reabre al arrancar- no sobreviva a volver al primer plano.
 *
 * Pide `jsdom` por su cuenta (el comentario de la primera línea), igual que
 * `tests/unit/base/velo-espera.test.tsx`: el resto de la suite sigue corriendo
 * en `environment: "node"`. Acá hace falta DOM de verdad porque lo que se prueba
 * son manejadores de `pageshow` / `visibilitychange` / `focus` y una lectura de
 * `document.cookie`.
 *
 * Lo que NO se puede probar acá es la vía que motivó todo esto: dos pestañas
 * reales de Chrome, una congelada y otra cambiando de perfil. Esa reproducción
 * -antes y después del fix, contra `next build && next start`- está en
 * `docs/guardia-perfil.md` §3, y este archivo cubre la lógica que ejecuta.
 *
 *   npm run test
 */

import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GuardiaPerfil } from "@/components/perfiles/guardia-perfil"
import {
  COOKIE_PERFIL_ACTIVO_PUBLICO,
  leerPerfilActivoDelNavegador,
} from "@/lib/perfil-activo-espejo"

/** Los dos perfiles del reporte del dueño: el titular y el gestionado. */
const TITULAR = "660e8400-e29b-41d4-a716-446655440001"
const GESTIONADO = "660e8400-e29b-41d4-a716-446655440003"

const recargar = vi.fn()
const refrescar = vi.fn()

// `useRouter` necesita el contexto del App Router, que no existe fuera de una
// aplicación de Next. Se reemplaza el módulo entero: lo único que la guardia usa
// de él es `refresh()`.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refrescar }),
}))

beforeEach(() => {
  recargar.mockClear()
  refrescar.mockClear()
  vi.useFakeTimers()

  // jsdom no deja espiar `location.reload` (es no configurable en el `Location`
  // real), así que se reemplaza el objeto entero por uno mínimo. Solo se usa
  // `reload`; `href` va para que un fallo de lectura se vea como tal.
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { href: "http://localhost/estudios", reload: recargar },
  })

  borrarCookieEspejo()
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  borrarCookieEspejo()
  window.sessionStorage.clear()
})

function fijarCookieEspejo(valor: string): void {
  document.cookie = `${COOKIE_PERFIL_ACTIVO_PUBLICO}=${valor}; path=/`
}

function borrarCookieEspejo(): void {
  document.cookie = `${COOKIE_PERFIL_ACTIVO_PUBLICO}=; path=/; max-age=0`
}

/** El navegador vuelve a poner la pestaña en primer plano tras un cambio de pestaña. */
function volverALaPestana(): void {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"))
  })
}

/** El gesto "atrás" de Android restaurando la página desde bfcache. */
function restaurarDesdeBfcache(): void {
  act(() => {
    const evento = new Event("pageshow") as Event & { persisted?: boolean }
    // jsdom no implementa `PageTransitionEvent`, así que se le cuelga la
    // propiedad al Event. La guardia no la lee -comprueba siempre-, y esta
    // línea documenta el caso que el evento representa.
    Object.defineProperty(evento, "persisted", { value: true })
    window.dispatchEvent(evento)
  })
}

/** Alt+Tab entre dos ventanas del mismo Chrome: la pestaña ya estaba visible. */
function devolverElFoco(): void {
  act(() => {
    window.dispatchEvent(new Event("focus"))
  })
}

/**
 * El gesto "atrás" (o "adelante") del navegador. El `setTimeout(…, 0)` de la
 * guardia se resuelve acá mismo, con los temporizadores falsos.
 */
function recorrerElHistorial(): void {
  act(() => {
    window.dispatchEvent(new Event("popstate"))
  })
  act(() => {
    vi.advanceTimersByTime(1)
  })
}

describe("lib/perfil-activo-espejo.ts — leerPerfilActivoDelNavegador", () => {
  it("encuentra la cookie espejo entre otras cookies del mismo origen", () => {
    const cookies = `sb-127-auth-token=algo; ${COOKIE_PERFIL_ACTIVO_PUBLICO}=${GESTIONADO}; tamano=chica`

    expect(leerPerfilActivoDelNavegador(cookies)).toBe(GESTIONADO)
  })

  it("devuelve null si la cookie no está", () => {
    expect(leerPerfilActivoDelNavegador("tamano=chica; otra=1")).toBeNull()
  })

  it("devuelve null con la cadena vacía (navegador sin ninguna cookie)", () => {
    expect(leerPerfilActivoDelNavegador("")).toBeNull()
  })

  it("no confunde una cookie cuyo nombre TERMINA igual", () => {
    const cookies = `otra_perfil_activo_publico=${TITULAR}`

    expect(leerPerfilActivoDelNavegador(cookies)).toBeNull()
  })

  it("descarta un valor que no tiene forma de uuid (cookie forjada a mano)", () => {
    expect(
      leerPerfilActivoDelNavegador(`${COOKIE_PERFIL_ACTIVO_PUBLICO}=no-soy-un-uuid`),
    ).toBeNull()
  })

  it("descarta un valor imposible de decodificar en vez de lanzar", () => {
    expect(leerPerfilActivoDelNavegador(`${COOKIE_PERFIL_ACTIVO_PUBLICO}=%`)).toBeNull()
  })
})

describe("components/perfiles/guardia-perfil.tsx", () => {
  describe("desajuste: la pantalla quedó dibujada con otro perfil", () => {
    it("recarga al volver a la pestaña (el reporte literal del dueño)", () => {
      // La pestaña A se dibujó con el titular; en la pestaña B se cambió al
      // perfil gestionado, así que la cookie del navegador ya dice otra cosa.
      render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)

      volverALaPestana()

      expect(recargar).toHaveBeenCalledTimes(1)
    })

    it("recarga al restaurar la página desde bfcache (el 'atrás' de Android)", () => {
      render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)

      restaurarDesdeBfcache()

      expect(recargar).toHaveBeenCalledTimes(1)
    })

    it("recarga al recuperar el foco con la pestaña ya visible", () => {
      render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)

      devolverElFoco()

      expect(recargar).toHaveBeenCalledTimes(1)
    })

    it("recarga UNA sola vez aunque lleguen los tres eventos juntos", () => {
      // `visibilitychange` y `focus` llegan casi siempre en la misma tanda, y
      // `location.reload()` no descarga la página al instante.
      render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)

      volverALaPestana()
      devolverElFoco()
      restaurarDesdeBfcache()

      expect(recargar).toHaveBeenCalledTimes(1)
    })
  })

  describe("coincidencia: el caso normal, que no puede costar nada", () => {
    it("no recarga cuando el perfil de la pantalla es el activo", () => {
      render(<GuardiaPerfil perfilId={GESTIONADO} />)
      fijarCookieEspejo(GESTIONADO)

      volverALaPestana()
      devolverElFoco()
      restaurarDesdeBfcache()

      expect(recargar).not.toHaveBeenCalled()
    })

    it("no recarga cuando la pestaña se OCULTA (solo mira el vuelta-a-visible)", () => {
      render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)

      const visibilidad = vi
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden")
      volverALaPestana()
      visibilidad.mockRestore()

      expect(recargar).not.toHaveBeenCalled()
    })
  })

  describe("atrás/adelante: el frankenstein que la comparación no puede ver", () => {
    it("refresca la ruta aunque el perfil COINCIDA (layout fresco + página vieja)", () => {
      // El caso del teléfono del dueño: eligió otro perfil, aterrizó bien, y con
      // dos "atrás" llegó a /estudios con el encabezado del perfil NUEVO y los
      // estudios del VIEJO. El layout está fresco, así que la comparación dice
      // "todo en orden"; el segmento de página, no. Next.js reusa los segmentos
      // de página en atrás/adelante a propósito y `staleTimes` no lo apaga.
      render(<GuardiaPerfil perfilId={GESTIONADO} />)
      fijarCookieEspejo(GESTIONADO)

      recorrerElHistorial()

      expect(refrescar).toHaveBeenCalledTimes(1)
      expect(recargar).not.toHaveBeenCalled()
    })

    it("recarga (y NO refresca) si además la pantalla entera quedó vieja", () => {
      // Una recarga completa es estrictamente más fuerte que un refresco: pedir
      // los dos sería tirar un viaje RSC a la basura.
      render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)

      recorrerElHistorial()

      expect(recargar).toHaveBeenCalledTimes(1)
      expect(refrescar).not.toHaveBeenCalled()
    })

    it("refresca también sin cookie espejo (sesión anterior al despliegue)", () => {
      // El refresco no depende de la comparación, así que esta capa SÍ cubre a
      // las sesiones viejas que la otra deja pasar.
      render(<GuardiaPerfil perfilId={TITULAR} />)

      recorrerElHistorial()

      expect(refrescar).toHaveBeenCalledTimes(1)
    })

    it("refresca en cada atrás, no una sola vez", () => {
      render(<GuardiaPerfil perfilId={GESTIONADO} />)
      fijarCookieEspejo(GESTIONADO)

      recorrerElHistorial()
      recorrerElHistorial()
      recorrerElHistorial()

      expect(refrescar).toHaveBeenCalledTimes(3)
    })

    it("no refresca en una navegación normal del router (pushState no es popstate)", () => {
      // La bottom nav no paga este viaje: `<Link>` navega con `pushState`, que
      // no dispara `popstate`.
      render(<GuardiaPerfil perfilId={GESTIONADO} />)
      fijarCookieEspejo(GESTIONADO)

      volverALaPestana()
      devolverElFoco()
      restaurarDesdeBfcache()

      expect(refrescar).not.toHaveBeenCalled()
    })

    it("deja de refrescar al desmontarse", () => {
      const { unmount } = render(<GuardiaPerfil perfilId={GESTIONADO} />)
      fijarCookieEspejo(GESTIONADO)

      unmount()
      recorrerElHistorial()

      expect(refrescar).not.toHaveBeenCalled()
    })
  })

  describe("anti-bucle: los dos casos que NO deben recargar nunca", () => {
    it("no recarga sin cookie espejo (sesión anterior al despliegue)", () => {
      // Tiene `perfil_activo` -el servidor dibujó una pantalla con perfil- pero
      // nunca pasó por `fijarPerfilActivo` desde que existe el espejo. Recargar
      // acá no sembraría la cookie: sería un bucle infinito.
      render(<GuardiaPerfil perfilId={TITULAR} />)

      volverALaPestana()
      devolverElFoco()
      restaurarDesdeBfcache()

      expect(recargar).not.toHaveBeenCalled()
    })

    it("no recarga si el servidor dibujó la pantalla SIN perfil activo", () => {
      // `/perfiles`, o una pantalla que ya está redirigiendo porque el permiso
      // se revocó y el borrado de cookies se tragó (ver `limpiarPerfilActivo`):
      // el espejo sobrevive y no hay con qué compararlo.
      render(<GuardiaPerfil perfilId={null} />)
      fijarCookieEspejo(GESTIONADO)

      volverALaPestana()
      devolverElFoco()
      restaurarDesdeBfcache()

      expect(recargar).not.toHaveBeenCalled()
    })

    it("no recarga con una cookie espejo forjada que no es un uuid", () => {
      render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo("cualquier-cosa")

      volverALaPestana()

      expect(recargar).not.toHaveBeenCalled()
    })
  })

  describe("corta-corriente: una recarga, no dos (el caso sin señal)", () => {
    it("no vuelve a recargar si la pantalla vuelve igual tras la primera recarga", () => {
      // Simula el peor caso offline: el service worker sirve la misma copia
      // guardada, la pantalla vuelve con el perfil viejo y el espejo sigue
      // diciendo otra cosa. Sin corta-corriente esto sería un bucle infinito.
      const primera = render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)
      volverALaPestana()
      expect(recargar).toHaveBeenCalledTimes(1)

      // La "recarga" trae exactamente la misma pantalla: mismo perfil, mismo
      // espejo. En el navegador esto es un documento nuevo; acá alcanza con
      // volver a montar, porque el corta-corriente vive en `sessionStorage`,
      // que sobrevive a una recarga.
      primera.unmount()
      render(<GuardiaPerfil perfilId={TITULAR} />)
      volverALaPestana()
      devolverElFoco()
      restaurarDesdeBfcache()

      expect(recargar).toHaveBeenCalledTimes(1)
    })

    it("vuelve a proteger en cuanto la comparación coincide una vez", () => {
      const primera = render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)
      volverALaPestana()
      primera.unmount()

      // La recarga funcionó: ahora la pantalla es la del perfil correcto.
      const segunda = render(<GuardiaPerfil perfilId={GESTIONADO} />)
      volverALaPestana()
      segunda.unmount()

      // Y un desajuste NUEVO se vuelve a atender.
      render(<GuardiaPerfil perfilId={GESTIONADO} />)
      fijarCookieEspejo(TITULAR)
      volverALaPestana()

      expect(recargar).toHaveBeenCalledTimes(2)
    })

    it("el evento `online` levanta el corta-corriente y reintenta", () => {
      const primera = render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)
      volverALaPestana()
      primera.unmount()

      render(<GuardiaPerfil perfilId={TITULAR} />)
      volverALaPestana()
      expect(recargar).toHaveBeenCalledTimes(1)

      act(() => {
        window.dispatchEvent(new Event("online"))
      })

      expect(recargar).toHaveBeenCalledTimes(2)
    })

    it("un espejo distinto no queda tapado por el corta-corriente", () => {
      const primera = render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)
      volverALaPestana()
      primera.unmount()

      // Otro perfil más: el espejo cambió, así que la anotación no aplica.
      render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo("4bfea15c-7a18-405b-9f18-e389631a1068")
      volverALaPestana()

      expect(recargar).toHaveBeenCalledTimes(2)
    })

    it("una PANTALLA distinta con el mismo espejo tampoco queda tapada", () => {
      // El caso que obliga a anotar el par y no solo el espejo: se recargó por
      // "titular con espejo gestionado", después la pantalla pasó a mostrar un
      // tercer perfil sin que ningún evento comprobara nada, y el espejo volvió
      // a decir gestionado. Es un desajuste NUEVO y hay que atenderlo.
      const primera = render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)
      volverALaPestana()
      primera.unmount()

      render(<GuardiaPerfil perfilId="4bfea15c-7a18-405b-9f18-e389631a1068" />)
      volverALaPestana()

      expect(recargar).toHaveBeenCalledTimes(2)
    })
  })

  describe("ciclo de vida", () => {
    it("no dibuja nada", () => {
      const { container } = render(<GuardiaPerfil perfilId={TITULAR} />)

      expect(container.innerHTML).toBe("")
    })

    it("deja de escuchar al desmontarse", () => {
      const { unmount } = render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)

      unmount()
      volverALaPestana()
      devolverElFoco()

      expect(recargar).not.toHaveBeenCalled()
    })

    it("vuelve a armar la comparación cuando cambia el perfil de la pantalla", () => {
      // Una navegación client-side dentro de la misma pestaña: el layout se
      // re-renderiza con el perfil nuevo y la guardia tiene que comparar contra
      // ESE, no contra el que tenía al montarse.
      const { rerender } = render(<GuardiaPerfil perfilId={TITULAR} />)
      fijarCookieEspejo(GESTIONADO)

      rerender(<GuardiaPerfil perfilId={GESTIONADO} />)
      volverALaPestana()

      expect(recargar).not.toHaveBeenCalled()
    })
  })
})
