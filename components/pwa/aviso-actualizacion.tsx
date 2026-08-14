"use client"

/**
 * Aviso de "hay una versión nueva" (Sprint 11, tarea 11.3).
 *
 * Es la mitad visible del ciclo de actualización que arrancó en `public/sw.js`
 * al sacarle el `skipWaiting()` automático a `install`. El circuito entero:
 *
 * ```
 *  deploy con sw.js nuevo
 *      → el navegador lo instala y lo deja en `waiting` (NO toma el control)
 *      → `vigilarActualizacion` lo detecta                     ← este componente
 *      → aparece esta barra: "Hay una versión nueva — Actualizar"
 *      → toque en "Actualizar"
 *      → `aplicarActualizacion` manda `saltar-espera` al worker en espera
 *      → el worker hace `skipWaiting()` y `clients.claim()`
 *      → `controllerchange` → una sola recarga, misma pantalla, misma sesión
 * ```
 *
 * ## Por qué es una barra y no un diálogo
 *
 * Actualizar no es urgente ni obligatorio: el worker viejo sigue sirviendo la
 * app y sigue recibiendo los pushes indefinidamente. Un diálogo modal
 * interrumpiría una tarea real (cargar un turno, mirar una credencial en una
 * ventanilla) por algo que puede esperar horas. La barra se puede ignorar sin
 * costo, y no se puede ignorar sin verla.
 *
 * ## Por qué NO se puede cerrar
 *
 * No hay una "X". Un descarte tendría que persistirse en algún lado, y
 * persistirlo por versión es exactamente el bug que deja a alguien clavado en
 * una versión vieja para siempre. La barra ocupa una franja fina sobre la
 * bottom nav, no tapa contenido (el `main` ya reserva el alto de la nav) y
 * desaparece sola en cuanto se acepta.
 *
 * ## Accesibilidad
 *
 * `role="status"` + `aria-live="polite"` —igual que `IndicadorConexion`— para
 * que un lector de pantalla lo anuncie sin cortar lo que se está leyendo:
 * aparece por un evento del navegador, no por algo que la persona hizo.
 */

import * as React from "react"
import { RefreshCwIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { aplicarActualizacion, vigilarActualizacion } from "@/lib/pwa/registrar-sw"

export function AvisoActualizacion({
  registro,
}: {
  /**
   * El registro que devolvió `registrarServiceWorker()`. Se recibe por prop y
   * no se pide acá para no duplicar el registro: **hay un solo
   * `navigator.serviceWorker.register()` en todo el proyecto** y es el de
   * `lib/pwa/registrar-sw.ts`, invocado por `RegistroServiceWorker`.
   */
  registro: ServiceWorkerRegistration
}) {
  const [hayVersionNueva, setHayVersionNueva] = React.useState(false)
  const [aplicando, setAplicando] = React.useState(false)

  React.useEffect(() => {
    return vigilarActualizacion(registro, () => {
      setHayVersionNueva(true)
    })
  }, [registro])

  if (!hayVersionNueva) {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      // Justo por encima de la bottom nav fija (misma `z-40`, apilado después
      // en el DOM) y respetando la safe area del gesto de Android/iOS.
      className="fixed inset-x-0 bottom-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] z-40 border-t border-border bg-card px-4 py-3"
    >
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3">
        <p className="text-sm font-medium text-card-foreground">
          Hay una versión nueva
        </p>
        <Boton
          size="sm"
          onClick={() => {
            // El estado de carga no se apaga nunca a propósito: si el mensaje
            // llega, esta pantalla se recarga entera en el instante siguiente.
            // Devolver el botón a su estado normal solo alcanzaría a verse si
            // algo falló, y ahí "Actualizar" otra vez es lo correcto — pero eso
            // ya se resuelve recargando a mano, no dejando el botón parpadeando.
            setAplicando(true)
            aplicarActualizacion(registro)
          }}
          cargando={aplicando}
        >
          <RefreshCwIcon aria-hidden="true" />
          Actualizar
        </Boton>
      </div>
    </div>
  )
}
