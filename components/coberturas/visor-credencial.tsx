"use client"

/**
 * Visor a pantalla completa de UNA cara de una credencial de cobertura
 * (Sprint 8, tarea 8.1): fondo BLANCO -para máxima luminosidad, la lectura
 * la suele hacer un lector de códigos en una ventanilla, no una persona
 * leyendo texto-, botón "Girar" (rotación CSS, 90° por toque), alternar
 * frente/dorso si la cobertura tiene las dos caras cargadas, y controles
 * grandes (Senior UX: nada de íconos de 16px para cerrar o rotar).
 *
 * ## Brillo del dispositivo: limitación real, documentada acá porque el
 * criterio de esta tarea lo pide explícitamente
 *
 * Ningún navegador expone una API para subir el BRILLO DE LA PANTALLA desde
 * contenido web -es una decisión de plataforma (motivo: fingerprinting y
 * batería), no una omisión de esta app-. Lo único que está al alcance es
 * maximizar el brillo PERCIBIDO del contenido: fondo blanco puro (en vez del
 * tema oscuro del resto de la app) más, si el navegador lo soporta, la
 * Fullscreen API para sacar cualquier chrome del sistema (barra de estado,
 * barra de direcciones) que reste superficie blanca. `document.fullscreenEnabled`
 * se chequea una sola vez al montar -algunos navegadores (Safari iOS,
 * ciertos WebViews embebidos) no la soportan, y en esos casos el botón
 * directamente no aparece: nunca se ofrece un control que vaya a fallar-.
 *
 * ## Por qué usa los primitivos de Base UI Dialog directo, no `DialogContent`
 *
 * `components/ui/dialog.tsx` está pensado para un modal centrado de tamaño
 * acotado (confirmar una acción, un formulario corto). Acá hace falta un
 * popup que ocupe el 100% de la pantalla, sin bordes redondeados ni límite
 * de ancho, así que se usa `@base-ui/react/dialog` directo con estilos
 * propios -el focus trap, Escape-para-cerrar y el portal al `document.body`
 * los sigue resolviendo Base UI, nada de eso se reimplementa acá-.
 */

import * as React from "react"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import {
  Maximize2Icon,
  Minimize2Icon,
  RefreshCwIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react"

export interface VisorCredencialProps {
  coberturaId: string
  proveedor: string
  ladoInicial: "front" | "back"
  tieneFrente: boolean
  tieneDorso: boolean
  onCerrar: () => void
}

interface RespuestaUrl {
  url?: string
  expiraEn?: number
  error?: string
}

const MENSAJE_ERROR = "No pudimos abrir la foto. Revisá tu conexión y probá de nuevo."
const MENSAJE_EXPIRADO = "El enlace de la foto venció. Tocá para volver a cargarla."

const ETIQUETA_LADO: Record<"front" | "back", string> = {
  front: "Frente",
  back: "Dorso",
}

/** Margen antes del vencimiento real: mismo criterio que `visor-documento.tsx`. */
const MARGEN_EXPIRACION_SEGUNDOS = 2

export function VisorCredencial({
  coberturaId,
  proveedor,
  ladoInicial,
  tieneFrente,
  tieneDorso,
  onCerrar,
}: VisorCredencialProps) {
  const [lado, setLado] = React.useState<"front" | "back">(ladoInicial)
  const [rotacion, setRotacion] = React.useState(0)
  const [estado, setEstado] = React.useState<"cargando" | "listo" | "error" | "expirado">(
    "cargando",
  )
  const [url, setUrl] = React.useState<string | null>(null)
  const [intento, setIntento] = React.useState(0)
  const [pantallaCompleta, setPantallaCompleta] = React.useState(false)
  const contenedorRef = React.useRef<HTMLDivElement>(null)

  // Se resuelve una sola vez: no hace falta recalcularlo en cada render, y
  // leer `document` acá es seguro porque este componente solo se monta del
  // lado del cliente, después de un click (ver `visor-credencial-lanzador.tsx`).
  const [puedeFullscreen] = React.useState(
    () => typeof document !== "undefined" && document.fullscreenEnabled === true,
  )

  /**
   * Cambia de cara Y reinicia la rotación en el mismo gesto: girar el frente
   * no debería dejar el dorso ya rotado la próxima vez que se lo mire. Se
   * hace acá -no en un `useEffect` que reaccione a `lado`- porque ambos
   * cambios de estado pertenecen al MISMO evento de usuario (tocar "Dorso"):
   * derivar el reinicio con un efecto dispararía un render de más y el lint
   * `react-hooks/set-state-in-effect` lo marca como anti-patrón (`setState`
   * síncrono dentro de un efecto, cuando el gesto que lo origina ya se
   * conoce en el manejador de evento).
   */
  function cambiarLado(nuevoLado: "front" | "back") {
    setLado(nuevoLado)
    setRotacion(0)
  }

  React.useEffect(() => {
    const controlador = new AbortController()
    let idTemporizador: ReturnType<typeof setTimeout> | null = null

    async function cargar() {
      setEstado("cargando")
      try {
        const respuesta = await fetch(`/api/credenciales/${coberturaId}/url?lado=${lado}`, {
          cache: "no-store",
          signal: controlador.signal,
        })
        const datos = (await respuesta.json().catch(() => null)) as RespuestaUrl | null

        if (!respuesta.ok || !datos?.url || typeof datos.expiraEn !== "number") {
          setEstado("error")
          return
        }

        setUrl(datos.url)
        setEstado("listo")

        const segundos = Math.max(0, datos.expiraEn - MARGEN_EXPIRACION_SEGUNDOS)
        idTemporizador = setTimeout(() => setEstado("expirado"), segundos * 1000)
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
        setEstado("error")
      }
    }

    void cargar()
    return () => {
      controlador.abort()
      if (idTemporizador) clearTimeout(idTemporizador)
    }
  }, [coberturaId, lado, intento])

  React.useEffect(() => {
    function manejarCambio() {
      setPantallaCompleta(document.fullscreenElement != null)
    }
    document.addEventListener("fullscreenchange", manejarCambio)
    return () => document.removeEventListener("fullscreenchange", manejarCambio)
  }, [])

  async function alternarPantallaCompleta() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await contenedorRef.current?.requestFullscreen()
      }
    } catch {
      // Sin gesto de usuario reciente, sin permiso, o no soportado: el resto
      // del visor (fondo blanco, imagen grande) sigue funcionando igual, así
      // que no hay nada que mostrarle a la persona por esto.
    }
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          className="contents"
          aria-label={`Credencial de ${proveedor} — ${ETIQUETA_LADO[lado]}`}
        >
          <div
            ref={contenedorRef}
            className="fixed inset-0 z-50 flex flex-col bg-white text-neutral-900"
          >
            <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2">
              <span className="min-w-0 truncate text-base font-semibold">{proveedor}</span>
              <DialogPrimitive.Close
                render={
                  <button
                    type="button"
                    aria-label="Cerrar"
                    className="flex size-12 shrink-0 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-100 active:bg-neutral-200"
                  />
                }
              >
                <XIcon className="size-6" aria-hidden="true" />
              </DialogPrimitive.Close>
            </header>

            <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-white p-2">
              {estado === "cargando" && (
                <p role="status" className="text-base text-neutral-600">
                  Cargando la foto…
                </p>
              )}

              {(estado === "error" || estado === "expirado") && (
                <button
                  type="button"
                  onClick={() => setIntento((valor) => valor + 1)}
                  className="flex min-h-tactil flex-col items-center gap-3 rounded-xl border border-neutral-300 px-6 py-8 text-center text-neutral-700"
                >
                  <RefreshCwIcon className="size-6" aria-hidden="true" />
                  <span className="text-base font-medium">
                    {estado === "expirado" ? MENSAJE_EXPIRADO : MENSAJE_ERROR}
                  </span>
                </button>
              )}

              {estado === "listo" && url && (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL de vida corta, ver visor-documento.tsx
                <img
                  src={url}
                  alt={`Credencial de ${proveedor} — ${ETIQUETA_LADO[lado]}`}
                  onError={() => setEstado("expirado")}
                  className="object-contain transition-transform duration-200"
                  style={{
                    transform: `rotate(${rotacion}deg)`,
                    // Rotada 90°/270°, la caja que la contiene tiene que
                    // intercambiar ancho y alto: si no, una foto en vertical
                    // rotada a horizontal se sigue acotando al ancho angosto
                    // original y queda diminuta.
                    maxWidth: rotacion % 180 === 0 ? "100%" : "100dvh",
                    maxHeight: rotacion % 180 === 0 ? "100%" : "100vw",
                  }}
                />
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-center gap-3 border-t border-neutral-200 px-3 py-3">
              {tieneFrente && tieneDorso && (
                <div className="flex overflow-hidden rounded-full border border-neutral-300">
                  {(["front", "back"] as const).map((valor) => (
                    <button
                      key={valor}
                      type="button"
                      onClick={() => cambiarLado(valor)}
                      aria-pressed={lado === valor}
                      className={
                        lado === valor
                          ? "min-h-tactil bg-neutral-900 px-5 text-base font-semibold text-white"
                          : "min-h-tactil px-5 text-base font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
                      }
                    >
                      {ETIQUETA_LADO[valor]}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => setRotacion((valor) => (valor + 90) % 360)}
                className="flex min-h-tactil items-center gap-2 rounded-full border border-neutral-300 px-5 text-base font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
              >
                <RotateCwIcon className="size-5" aria-hidden="true" />
                Girar
              </button>

              {puedeFullscreen && (
                <button
                  type="button"
                  onClick={() => void alternarPantallaCompleta()}
                  className="flex min-h-tactil items-center gap-2 rounded-full border border-neutral-300 px-5 text-base font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
                >
                  {pantallaCompleta ? (
                    <Minimize2Icon className="size-5" aria-hidden="true" />
                  ) : (
                    <Maximize2Icon className="size-5" aria-hidden="true" />
                  )}
                  Pantalla completa
                </button>
              )}
            </footer>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
