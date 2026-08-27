"use client"

/**
 * La guardia de perfil: ninguna pantalla congelada sobrevive al foco.
 *
 * No dibuja nada (`return null`). Montada en `app/(app)/layout.tsx`, o sea en
 * TODA pantalla con sesión, hace una sola cosa: cuando el navegador vuelve a
 * poner esta pantalla en primer plano, comprueba que el perfil con el que el
 * SERVIDOR la dibujó siga siendo el perfil activo del navegador. Si no lo es,
 * recarga.
 *
 * ## El bug que cierra
 *
 * El fix del commit 770959c cerró la fuga del lado del servidor: hoy toda carga
 * fresca contra producción responde SIEMPRE con el perfil de la cookie, y
 * `fijarPerfilActivo` purga el Client Cache de Next.js con
 * `revalidatePath("/", "layout")`. Y sin embargo el dueño seguía viendo los
 * estudios del perfil equivocado.
 *
 * La explicación es que lo que ve no es una pantalla servida mal: es una
 * pantalla vieja que el navegador revive **sin tocar el servidor**. Ninguna
 * purga del lado del servidor puede alcanzarla, porque no hay ningún request
 * que purgar. Son tres vías de la misma clase:
 *
 * 1. **Pestañas viejas.** El dueño trabaja con ~19 pestañas abiertas. Vuelve a
 *    una que quedó en `/estudios` de Darío, renderizada horas antes; mientras
 *    tanto, en otra pestaña, eligió el perfil de León. Chrome muestra la
 *    pestaña tal cual estaba. Sin navegación no hay request. **Este es el
 *    reporte literal del dueño, y es el caso que la reproducción de
 *    `docs/guardia-perfil.md` ejecuta de punta a punta.**
 * 2. **bfcache.** El gesto "atrás" de Android restaura una foto completa de la
 *    página anterior -DOM, estado de JavaScript y todo-, sin volver a
 *    ejecutarla. Es la deuda #2 que dejó abierta el fix anterior.
 * 3. **Restauración de sesión.** Chrome reabre al arrancar las pestañas que
 *    había, algunas desde su propia foto.
 *
 * ## Los tres eventos de la comparación, y por qué hacen falta los tres
 *
 * - `pageshow`: el único que avisa de una restauración de bfcache
 *   (`event.persisted === true`), donde NO se vuelven a ejecutar los efectos de
 *   React -por eso no alcanza con comprobar al montar-. Cubre las vías 2 y 3.
 *   No se filtra por `persisted`: en una carga normal la comprobación coincide
 *   y no cuesta nada.
 * - `visibilitychange` (solo al volver a `visible`): es lo que dispara Chrome
 *   al cambiar de pestaña, y en móvil al volver a la aplicación desde el
 *   conmutador. Cubre la vía 1.
 * - `focus`: la red de seguridad de la vía 1 cuando la pestaña ya estaba
 *   visible pero la ventana no tenía el foco -dos ventanas lado a lado, un
 *   Alt+Tab entre ventanas del mismo Chrome-. Ahí `visibilitychange` no
 *   dispara.
 *
 * En la práctica dos de los tres suelen dispararse juntos; el `recargando` de
 * abajo hace que eso valga por una sola recarga.
 *
 * ## El cuarto evento: `popstate`, y por qué NO compara nada
 *
 * Hay una variante del bug que la comparación de arriba **no puede detectar**,
 * y por eso este componente hace dos cosas y no una. La reportó el dueño en el
 * teléfono: eligió otro perfil, aterrizó en `/inicio` bien (encabezado nuevo,
 * datos nuevos) y con dos gestos de "atrás" llegó a `/estudios` con el
 * **encabezado del perfil NUEVO y la lista de estudios del perfil VIEJO**. Un
 * frankenstein: layout fresco pegado a un segmento de página viejo.
 *
 * Es comportamiento documentado de Next.js, no un accidente. El glosario de la
 * versión instalada, entrada "Client Cache"
 * (`node_modules/next/dist/docs/01-app/04-glossary.md`): *"Pages are not cached
 * by default but are reused during browser back/forward navigation"*. Y
 * `staleTimes` no da manija para apagarlo:
 * (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md`)
 * *"This doesn't change back/forward caching behavior to prevent layout shift
 * and to prevent losing the browser scroll position"*. O sea: en atrás/adelante
 * el router **reusa el segmento de página cacheado a propósito**, sin
 * preguntarle nada al servidor, y ninguna purga del servidor puede alcanzarlo.
 *
 * Para la comparación de arriba ese caso es invisible: el layout -que es de
 * donde sale `perfilId`- está fresco, así que coincide con la cookie y no hay
 * nada que reportar. Por eso en `popstate` la guardia **no compara: refresca
 * siempre**. `router.refresh()` es la herramienta documentada
 * (`.../04-functions/use-router.md`): *"Refresh the current route. Making a new
 * request to the server... This clears the Client Cache for the current
 * route"*. Vuelve a pedir TODOS los segmentos de la ruta al servidor, que los
 * dibuja con la cookie de ahora, y el segmento viejo muere.
 *
 * `popstate` es exactamente el evento correcto y no hace falta filtrar nada:
 * lo dispara el navegador SOLO al recorrer el historial (atrás, adelante,
 * `history.go`). Las navegaciones normales del router usan `pushState`, que no
 * lo dispara: una `<Link>` de la bottom nav no paga este refresco.
 *
 * **Cuesta un viaje RSC extra por cada atrás/adelante.** Se paga con gusto: es
 * una aplicación de salud, y la alternativa es que alguien lea en la pantalla
 * los estudios de otra persona bajo el nombre correcto. Coherencia antes que un
 * RTT.
 *
 * El `setTimeout(…, 0)` no es superstición: el router de Next también escucha
 * `popstate` para restaurar la entrada del historial. Diferir un tick pone el
 * refresco DESPUÉS de esa restauración, sobre la ruta ya restaurada, en vez de
 * competir con ella.
 *
 * Y si en ese mismo `popstate` la comparación YA decidió recargar -la pantalla
 * entera era vieja, no solo el segmento de página-, el refresco no se pide:
 * una recarga completa es estrictamente más fuerte.
 *
 * ## Las tres reglas de la comparación (y el anti-bucle)
 *
 * Recarga **solo** si el espejo está PRESENTE y es DISTINTO. Los otros dos
 * casos son deliberadamente inertes:
 *
 * - **Sin `perfilId`** (el servidor dibujó esta pantalla sin perfil activo:
 *   `/perfiles`, o una pantalla que ya está redirigiendo porque el permiso se
 *   revocó): no hay nada con qué comparar. Si acá se recargara, el caso
 *   "permiso revocado" sería un bucle infinito: `obtenerPerfilActivo` intenta
 *   borrar la cookie durante el render de un Server Component, el borrado
 *   lanza y se traga (ver `limpiarPerfilActivo`), el espejo sobrevive, y la
 *   pantalla recargada volvería a llegar sin perfil. Con esta regla, no.
 * - **Sin cookie espejo**: es una sesión ANTERIOR al despliegue de esta
 *   guardia. Tiene `perfil_activo` (elegido antes) pero no
 *   `perfil_activo_publico`, porque el espejo se siembra al ELEGIR perfil y no
 *   en cada render -no puede: escribir cookies durante el render de un Server
 *   Component no está permitido en Next.js-. Recargar por "ausente" tampoco
 *   arreglaría nada (la recarga no siembra el espejo) y sería el mismo bucle.
 *   **El compromiso, explícito: para esas sesiones la guardia queda inerte
 *   hasta el primer cambio de perfil**, que es exactamente el momento en que
 *   empieza a hacer falta. La ventana se cierra sola: la primera vez que esa
 *   sesión pasa por el selector, por un deep link o por el logout,
 *   `fijarPerfilActivo` / `limpiarPerfilActivo` dejan las dos cookies en
 *   estado. Se descartó sembrar el espejo desde `proxy.ts` -que cerraría la
 *   ventana de entrada- para no romper la invariante de un único escritor, que
 *   es de donde sale la garantía de que esto no puede ciclar.
 *
 * Y el anti-bucle estructural, que es el que de verdad importa: las dos
 * cookies se escriben y se borran SIEMPRE juntas
 * (`lib/perfil-activo-espejo.ts`), así que después de una recarga el servidor
 * dibuja la pantalla con exactamente el valor que el cliente va a leer. Una
 * recarga por desajuste no puede producir otro desajuste.
 *
 * ## El corta-corriente: una recarga, no dos (el caso SIN SEÑAL)
 *
 * Hay un escenario donde el razonamiento de arriba no aplica, porque la
 * recarga no llega al servidor: **sin señal**. El service worker
 * (`public/sw.js`) guarda cuatro pantallas para el modo offline (`/sos`,
 * `/coberturas`, `/turnos`, `/medicacion`, estrategia red-primero). Si una de
 * esas copias quedara guardada con un perfil y el espejo dijera otro, la
 * recarga volvería a servir la MISMA copia guardada, la comparación fallaría
 * otra vez, y sería un bucle de recargas en una aplicación de salud sin
 * conexión: mucho peor que el bug que se está arreglando.
 *
 * En la práctica no debería poder pasar -`components/pwa/registro-service-worker.tsx`
 * purga esas cachés en cuanto una pantalla se dibuja con un perfil distinto
 * del que quedó anotado en disco, y sin señal no se puede cambiar de perfil
 * porque eso exige una Server Action-, pero "no debería" no es suficiente para
 * un bucle. Por eso hay un corta-corriente explícito: se anota en
 * `sessionStorage` el PAR `pantalla→espejo` que motivó la recarga, y si al
 * volver a comprobar el par es exactamente el mismo, **no se recarga de
 * nuevo**. Una recarga por desajuste, nunca dos. (Por qué el par y no solo el
 * espejo: ver `desajuste()` más abajo.)
 *
 * La anotación se borra en los dos momentos correctos: cuando la comparación
 * vuelve a coincidir (el problema se resolvió) y cuando llega el evento
 * `online` (volvió la señal, y ahora sí una recarga puede traer la pantalla
 * buena). Sin ese segundo borrado, la pestaña que intentó recargar sin señal
 * quedaría desprotegida para siempre.
 *
 * `sessionStorage` y no `localStorage`: el alcance correcto es la pestaña. Si
 * el almacenamiento está bloqueado, el corta-corriente se desactiva y la
 * guardia sigue funcionando -la alternativa, desactivar la guardia, sería
 * peor-; el bucle exigiría entonces almacenamiento roto Y sin señal Y una
 * copia offline de otro perfil que la purga no alcanzó.
 *
 * ## Por qué `location.reload()` y no algo más fino
 *
 * `router.refresh()` re-pediría el RSC payload conservando el estado de React,
 * que es justo lo que no se quiere: lo que hay en pantalla es una foto vieja
 * entera -formularios a medio llenar con datos de otra persona, listas
 * paginadas, diálogos abiertos-. Una recarga completa es lo correcto y es
 * barata: ocurre exactamente una vez, al volver a una pestaña que ya estaba
 * equivocada.
 *
 * ## Lo que esta guardia NO es
 *
 * No es una capa de autorización, ni siquiera un poquito. Corre en el cliente y
 * compara dos valores que el cliente ya tiene; alguien que quiera puede
 * desactivarla con la consola abierta y lo único que consigue es quedarse
 * mirando su propia pantalla vieja. Los datos siguen protegidos donde siempre:
 * `requerirPermiso` en cada request (`lib/auth/guardas.ts`) y RLS en la base.
 * Esto es una guardia de FRESCURA.
 *
 * ## Lo que se descartó, y por qué
 *
 * - **El service worker.** Era la sospecha más fuerte -una PWA que cachea
 *   payloads RSC explicaría todo-, y es falsa: `clasificarSolicitud`
 *   (`public/sw.js`) manda a `"red"` toda request que no sea
 *   `mode === "navigate"`, y el `default` del `switch` de `fetch` devuelve sin
 *   `respondWith`, o sea que el worker **ni siquiera intercepta** un pedido
 *   RSC. Verificado además en vivo con el worker activo: sus cachés contenían
 *   solo estáticos con hash, `/sos` y `/api/sos/{perfil}`; ni un payload RSC,
 *   ni `/estudios`. Ver `docs/guardia-perfil.md` §4.
 * - **`staleTimes: { dynamic: 0 }`.** Ya es el default desde Next 15 y, según
 *   su propia documentación, no toca el atrás/adelante. No habría cambiado
 *   nada.
 * - **`router.refresh()` en vez de `location.reload()` para el desajuste.**
 *   Refrescar conserva el estado de React, que es justo lo que hay que tirar
 *   cuando la pantalla entera quedó vieja.
 */

import { useCallback, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

import { leerPerfilActivoDelNavegador } from "@/lib/perfil-activo-espejo"

/**
 * Dónde anota el corta-corriente el desajuste que ya motivó una recarga. Ver
 * "El corta-corriente" en el encabezado.
 */
const CLAVE_RECARGA_INTENTADA = "historial-medico:guardia-perfil:recarga-intentada"

/**
 * La anotación es el PAR `pantalla→espejo`, no solo el espejo.
 *
 * Con solo el espejo, el corta-corriente podía trabarse en un caso raro pero
 * real: si se recargó por "espejo = X", después la pantalla pasó a mostrar Y
 * sin que ningún evento disparara la comprobación, y el espejo volvió a X, la
 * anotación vieja bloqueaba una recarga que esta vez SÍ correspondía. Con el
 * par, "Y con espejo X" es un desajuste distinto de "X con espejo X" y se
 * atiende. Solo se bloquea la repetición EXACTA, que es la única que significa
 * "recargar no sirvió".
 */
function desajuste(perfilId: string, espejo: string): string {
  return `${perfilId}→${espejo}`
}

/** Las tres son a prueba de `sessionStorage` bloqueado (modo privado). */
function yaSeIntentoRecargarPor(clave: string): boolean {
  try {
    return window.sessionStorage.getItem(CLAVE_RECARGA_INTENTADA) === clave
  } catch {
    // Sin corta-corriente, pero con guardia. Ver el encabezado.
    return false
  }
}

function anotarIntentoDeRecarga(clave: string): void {
  try {
    window.sessionStorage.setItem(CLAVE_RECARGA_INTENTADA, clave)
  } catch {
    // Ídem.
  }
}

function olvidarIntentoDeRecarga(): void {
  try {
    window.sessionStorage.removeItem(CLAVE_RECARGA_INTENTADA)
  } catch {
    // Ídem.
  }
}

export interface GuardiaPerfilProps {
  /**
   * El perfil con el que el servidor dibujó esta pantalla, o `null` si la
   * dibujó sin perfil activo. Viene de `idDePerfilActivoEnCookie()`
   * (`lib/perfil-activo.ts`), que lee la cookie `httpOnly` sin consultar la
   * base.
   */
  perfilId: string | null
}

export function GuardiaPerfil({ perfilId }: GuardiaPerfilProps) {
  const router = useRouter()

  // Una sola recarga por pantalla: `visibilitychange` y `focus` llegan casi
  // siempre juntos, y `location.reload()` no descarga la página al instante
  // -el manejador que sigue corriendo vería el mismo desajuste-. Es un `ref` y
  // no una variable del efecto para que sobreviva a un cambio de `perfilId`:
  // una recarga en curso no se cancela porque el árbol se vuelva a renderizar.
  const recargando = useRef(false)

  /**
   * La comparación. Devuelve `true` si decidió recargar, para que quien la
   * llame sepa que no tiene sentido hacer nada más.
   */
  const comprobar = useCallback((): boolean => {
    if (recargando.current || !perfilId) {
      return false
    }

    const enElNavegador = leerPerfilActivoDelNavegador(document.cookie)

    // Ausente → inerte: es una sesión anterior al despliegue de la guardia.
    // Ver el encabezado; recargar acá sería un bucle sin arreglar nada.
    if (!enElNavegador) {
      return false
    }

    // El caso normal, y no cuesta nada. De paso se levanta el corta-corriente:
    // si había una recarga anotada, la situación ya se resolvió.
    if (enElNavegador === perfilId) {
      olvidarIntentoDeRecarga()
      return false
    }

    // Corta-corriente: ya se recargó una vez por este MISMO desajuste y la
    // pantalla volvió igual (típicamente sin señal, servida por el service
    // worker). Insistir sería un bucle. Ver el encabezado.
    const clave = desajuste(perfilId, enElNavegador)
    if (yaSeIntentoRecargarPor(clave)) {
      return false
    }

    anotarIntentoDeRecarga(clave)
    recargando.current = true
    window.location.reload()
    return true
  }, [perfilId])

  useEffect(() => {
    // `pageshow` sin filtrar por `event.persisted`: la restauración de bfcache
    // es el caso que obliga a escucharlo, pero comprobar también en la carga
    // normal es gratis y una rama menos.
    const alMostrarse = () => {
      comprobar()
    }

    const alVolverAVisible = () => {
      if (document.visibilityState === "visible") {
        comprobar()
      }
    }

    // Atrás/adelante: acá NO se compara, se refresca siempre. Ver "El cuarto
    // evento" en el encabezado -el segmento de página puede estar viejo con el
    // layout fresco, y eso la comparación no lo ve-.
    const alRecorrerElHistorial = () => {
      if (comprobar()) {
        return
      }

      window.setTimeout(() => {
        if (!recargando.current) {
          router.refresh()
        }
      }, 0)
    }

    // Volvió la señal: el corta-corriente se levanta y se vuelve a comprobar.
    // Sin esto, la pestaña que intentó recargar sin conexión quedaría
    // desprotegida hasta cerrarla. Ver "El corta-corriente" en el encabezado.
    const alVolverLaSenal = () => {
      olvidarIntentoDeRecarga()
      comprobar()
    }

    window.addEventListener("pageshow", alMostrarse)
    document.addEventListener("visibilitychange", alVolverAVisible)
    window.addEventListener("focus", alMostrarse)
    window.addEventListener("popstate", alRecorrerElHistorial)
    window.addEventListener("online", alVolverLaSenal)

    return () => {
      window.removeEventListener("pageshow", alMostrarse)
      document.removeEventListener("visibilitychange", alVolverAVisible)
      window.removeEventListener("focus", alMostrarse)
      window.removeEventListener("popstate", alRecorrerElHistorial)
      window.removeEventListener("online", alVolverLaSenal)
    }
  }, [comprobar, router])

  return null
}
