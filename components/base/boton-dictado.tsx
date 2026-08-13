"use client"

/**
 * Botón de dictado por voz Senior UX: envuelve `useReconocimientoVoz` con
 * los cuatro estados visuales de `docs/design-system.md` (color nunca es la
 * única señal, así que cada estado también cambia de ícono):
 *
 * - `inactivo`: ícono de micrófono neutro.
 * - `escuchando`: ícono en color primario + anillo pulsante alrededor
 *   (`prefers-reduced-motion` lo apaga con `motion-reduce:animate-none`,
 *   además de la regla global de `app/globals.css` §7).
 * - `procesando`: ícono girando (mismo patrón que `boton.tsx#cargando`),
 *   botón deshabilitado un instante mientras se resuelve el resultado final.
 * - `error`: ícono de micrófono tachado + mensaje en un globo de texto
 *   (nunca un `title` nativo: no es legible en touch) con `role="alert"`.
 *
 * Si `!soportado` el componente no renderiza nada -ver
 * `campo-texto.tsx#conDictado`, que sigue funcionando igual sin este botón-.
 * El permiso de micrófono lo pide el navegador recién cuando se llama
 * `iniciar()`, y acá `iniciar()` solo se llama desde `onClick`: nunca al
 * montar.
 */

import * as React from "react"
import { Loader2Icon, MicIcon, MicOffIcon } from "lucide-react"

import { useReconocimientoVoz } from "@/hooks/use-reconocimiento-voz"
import { cn } from "@/lib/utils"

export interface BotonDictadoProps {
  /**
   * Se llama con el texto final reconocido (ya recortado, con tildes) cada
   * vez que termina una frase dictada. Quien lo use decide dónde insertarlo
   * -ver `campo-texto.tsx`, que lo inserta en la posición del cursor-.
   */
  onTranscripcion: (texto: string) => void
  /** `id` del campo asociado, para un `aria-label` más específico si hace falta. */
  className?: string
}

export function BotonDictado({ onTranscripcion, className }: BotonDictadoProps) {
  const { soportado, estado, transcripcion, error, iniciar, detener } = useReconocimientoVoz()
  const ultimaTranscripcionEnviada = React.useRef("")

  // Envía la transcripción al padre una sola vez, cuando el reconocimiento
  // ya terminó (estado "inactivo" tras haber escuchado algo).
  React.useEffect(() => {
    if (
      estado === "inactivo" &&
      transcripcion &&
      transcripcion !== ultimaTranscripcionEnviada.current
    ) {
      ultimaTranscripcionEnviada.current = transcripcion
      onTranscripcion(transcripcion)
    }
  }, [estado, transcripcion, onTranscripcion])

  if (!soportado) return null

  const escuchando = estado === "escuchando"
  const procesando = estado === "procesando"
  const enError = estado === "error"

  const manejarClic = () => {
    if (escuchando) {
      detener()
    } else {
      iniciar()
    }
  }

  const etiqueta = escuchando ? "Detener dictado" : "Dictar por voz"

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={manejarClic}
        disabled={procesando}
        aria-label={etiqueta}
        aria-pressed={escuchando}
        aria-describedby={enError ? "boton-dictado-error" : undefined}
        className={cn(
          "relative inline-flex size-tactil shrink-0 items-center justify-center rounded-lg border transition-colors duration-150 ease-salida outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-70",
          enError &&
            "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
          !enError &&
            escuchando &&
            "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20",
          !enError &&
            !escuchando &&
            "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
          className,
        )}
      >
        {enError && <MicOffIcon className="size-5" aria-hidden="true" />}
        {!enError && procesando && (
          <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
        )}
        {!enError && !procesando && <MicIcon className="size-5" aria-hidden="true" />}

        {escuchando && (
          <span
            className="absolute inset-0 -z-10 animate-ping rounded-lg bg-primary/30 motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
      </button>

      {/* Anuncio para lectores de pantalla: no depende solo del color/ícono. */}
      <span className="sr-only" role="status" aria-live="polite">
        {escuchando && "Escuchando dictado."}
        {procesando && "Procesando dictado."}
      </span>

      {enError && error && (
        <p
          id="boton-dictado-error"
          role="alert"
          className="absolute top-full right-0 z-10 mt-2 w-max max-w-64 rounded-lg border border-destructive/30 bg-card px-3 py-2 text-sm font-medium text-destructive shadow-elevada"
        >
          {error}
        </p>
      )}
    </div>
  )
}
