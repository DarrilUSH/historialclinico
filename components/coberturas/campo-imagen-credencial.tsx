"use client"

/**
 * Selector de UNA foto de credencial (frente o dorso) — mismo pipeline de
 * validación/compresión que `components/documentos/cargador-documento.tsx`
 * (`lib/archivos/validacion.ts#validarImagenCredencial`,
 * `lib/archivos/compresion.ts#comprimirArchivo`), recortado a lo que
 * necesita una credencial: SOLO imagen, nunca PDF -el bucket
 * `credenciales-cobertura` no lo acepta, ver el comentario del bucket en
 * `supabase/migrations/20260812230000_storage.sql`-, y dos caminos en vez de
 * tres ("Sacar foto" / "Galería", cada uno con su propio `accept="image/*"`
 * — nunca combinado con otro tipo de archivo en el mismo input, ver el
 * comentario de cabecera de `cargador-documento.tsx` sobre el bug real de
 * Android Chrome con `accept` mixto).
 *
 * Componente CONTROLADO: no sube nada por su cuenta. Reporta el blob listo
 * (o `null` si se quita) por `onCambio`; `formulario-cobertura.tsx` es quien
 * junta las dos caras y arma el `FormData` que viaja a la Server Action.
 */

import * as React from "react"

import { CameraIcon, ImageOffIcon, ImagesIcon, Loader2Icon, XIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { comprimirArchivo } from "@/lib/archivos/compresion"
import { formatearBytes, validarImagenCredencial } from "@/lib/archivos/validacion"
import { cn } from "@/lib/utils"

export interface ArchivoCredencialListo {
  blob: Blob
  mimeType: string
}

export interface CampoImagenCredencialProps {
  label: string
  /** `true` en modo editar cuando esta cara YA tiene una foto guardada -solo cambia el texto de ayuda, no el comportamiento-. */
  tieneExistente?: boolean
  onCambio: (archivo: ArchivoCredencialListo | null) => void
  className?: string
}

type Paso = "vacio" | "preparando" | "listo"

export function CampoImagenCredencial({
  label,
  tieneExistente = false,
  onCambio,
  className,
}: CampoImagenCredencialProps) {
  const [paso, setPaso] = React.useState<Paso>("vacio")
  const [error, setError] = React.useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [peso, setPeso] = React.useState<string | null>(null)

  const inputCamaraRef = React.useRef<HTMLInputElement>(null)
  const inputGaleriaRef = React.useRef<HTMLInputElement>(null)

  // Mismo motivo que `cargador-documento.tsx`: liberar el object URL de la
  // miniatura al reemplazar o desmontar, para no dejar un blob vivo en
  // memoria.
  React.useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function procesarArchivo(file: File) {
    setError(null)
    setPaso("preparando")

    const validacion = await validarImagenCredencial(file)
    if (!validacion.valido || !validacion.tipo) {
      setError(validacion.error ?? "La foto no es válida.")
      setPaso("vacio")
      return
    }

    try {
      const { blob, mimeType, bytesDespues } = await comprimirArchivo(file, validacion.tipo)

      if (previewUrl) URL.revokeObjectURL(previewUrl)
      const url = URL.createObjectURL(blob)

      setPreviewUrl(url)
      setPeso(formatearBytes(bytesDespues))
      setPaso("listo")
      onCambio({ blob, mimeType })
    } catch {
      setError("No pudimos preparar la foto. Probá de nuevo.")
      setPaso("vacio")
    }
  }

  function manejarSeleccion(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Limpia el input: sin esto, elegir EL MISMO archivo dos veces seguidas
    // no vuelve a disparar `onChange` (mismo criterio que `cargador-documento.tsx`).
    event.target.value = ""
    if (file) void procesarArchivo(file)
  }

  function quitar() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPeso(null)
    setPaso("vacio")
    setError(null)
    onCambio(null)
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="text-sm font-medium text-foreground">{label}</span>

      {error && <Alerta variante="error">{error}</Alerta>}

      {paso === "preparando" && (
        <div
          role="status"
          className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-6 text-center"
        >
          <Loader2Icon className="size-6 animate-spin text-primary" aria-hidden="true" />
          <p className="text-base text-muted-foreground">Preparando la foto…</p>
        </div>
      )}

      {paso === "vacio" && (
        <>
          {tieneExistente && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ImageOffIcon className="size-4 shrink-0" aria-hidden="true" />
              Ya hay una foto cargada. Elegí una nueva solo si querés reemplazarla.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* `capture="environment"`: abre la cámara trasera directo, mismo
                criterio que `cargador-documento.tsx`. */}
            <input
              ref={inputCamaraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={manejarSeleccion}
            />
            <Boton
              type="button"
              variant="outline"
              size="lg"
              onClick={() => inputCamaraRef.current?.click()}
            >
              <CameraIcon aria-hidden="true" />
              Sacar foto
            </Boton>

            {/* `accept="image/*"` a solas, SIN `capture`: abre el selector de
                galería/archivos de imágenes del sistema (ver el comentario de
                cabecera sobre por qué nunca se combina con otro tipo). */}
            <input
              ref={inputGaleriaRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={manejarSeleccion}
            />
            <Boton
              type="button"
              variant="outline"
              size="lg"
              onClick={() => inputGaleriaRef.current?.click()}
            >
              <ImagesIcon aria-hidden="true" />
              Galería
            </Boton>
          </div>
        </>
      )}

      {paso === "listo" && previewUrl && (
        <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- object URL local (blob en memoria), ver cargador-documento.tsx */}
          <img
            src={previewUrl}
            alt={`Vista previa: ${label.toLowerCase()}`}
            className="size-20 shrink-0 rounded-lg border border-border object-cover"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm text-muted-foreground numeros-clinicos">{peso}</p>
            <Boton type="button" variant="outline" size="sm" onClick={quitar} className="w-fit">
              <XIcon aria-hidden="true" />
              Quitar
            </Boton>
          </div>
        </div>
      )}
    </div>
  )
}
