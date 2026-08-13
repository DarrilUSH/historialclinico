"use client"

/**
 * Carga de un documento médico: tres caminos grandes y claros -sacar foto con
 * la cámara, elegir una imagen de la galería o elegir un PDF ya guardado-,
 * validación por MIME real, compresión client-side de fotos grandes con
 * estado visual ("Preparando…") y vista previa antes de confirmar. Ver
 * `lib/archivos/validacion.ts` y `lib/archivos/compresion.ts` para el detalle
 * de cada paso del pipeline.
 *
 * ## Por qué "galería" y "PDF" son inputs separados (y no uno solo con
 * `accept=".pdf,image/*"`)
 *
 * Se verificó en un Samsung Galaxy A71 real (Android 13, Chrome) que un
 * input con `accept` mixto -PDF más cualquier MIME de imagen- abre siempre
 * la hoja multimedia "Cámara / Fotos y videos" del sistema: el PDF queda
 * inalcanzable desde el celular aunque la persona lo tenga guardado. Con
 * `accept="application/pdf"` a solas, Chrome sí abre el selector de
 * documentos correcto. La solución es tener un input de un solo tipo por
 * camino -nunca combinar PDF con imagen en el mismo `accept`-.
 *
 * Componente CONTROLADO en el sentido de que no hace nada por su cuenta con
 * el archivo confirmado: expone `onArchivoListo({ blob, mimeType, nombre })`
 * y quien lo use decide qué hacer con eso. La tarea siguiente del roadmap
 * (ROADMAP_SPRINTS.md, "Pipeline de subida a Storage privado con path
 * determinístico") lo conecta a una Server Action que sube a
 * `documentos-medicos`; acá no se toca la red ni Supabase.
 *
 * Los tres `<input type="file">` van con `className="hidden"` (display:none),
 * no `sr-only`: así quedan afuera del orden de tabulación y del árbol de
 * accesibilidad -el control que el usuario ve, tabula y activa es siempre la
 * `TarjetaInteractiva` (un `<button>` real), que dispara el input por
 * referencia. Un input oculto con `sr-only` seguiría siendo enfocable por
 * teclado y aparecería como un segundo control redundante haciendo lo mismo.
 */

import * as React from "react"

import { CameraIcon, FileTextIcon, ImagesIcon, Loader2Icon, RotateCcwIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { TarjetaInteractiva } from "@/components/base/tarjeta"
import { comprimirArchivo } from "@/lib/archivos/compresion"
import { formatearBytes, validarArchivo } from "@/lib/archivos/validacion"
import { cn } from "@/lib/utils"

export interface ArchivoListo {
  blob: Blob
  mimeType: string
  nombre: string
}

export interface CargadorDocumentoProps {
  /** Se ejecuta al tocar "Usar este archivo", con el archivo ya validado y comprimido. */
  onArchivoListo: (archivo: ArchivoListo) => void
  className?: string
}

type Paso = "elegir" | "preparando" | "vista-previa"

interface ArchivoPreparado {
  blob: Blob
  mimeType: string
  nombre: string
  bytesAntes: number
  bytesDespues: number
  redimensionada: boolean
  /** Object URL de la miniatura, solo para imágenes. `null` en un PDF. */
  previewUrl: string | null
}

const EXTENSION_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

/**
 * Cambia la extensión del nombre original según el MIME final. Hace falta
 * porque la compresión puede convertir el formato (una foto PNG pesada se
 * re-encodea como JPEG): sin esto, el archivo terminaría llamándose
 * "estudio.png" con contenido JPEG adentro.
 */
function nombreConExtension(nombreOriginal: string, mimeType: string): string {
  const extension = EXTENSION_POR_MIME[mimeType] ?? "bin"
  const base = nombreOriginal.replace(/\.[^./\\]+$/, "").trim() || "documento"
  return `${base}.${extension}`
}

export function CargadorDocumento({ onArchivoListo, className }: CargadorDocumentoProps) {
  const [paso, setPaso] = React.useState<Paso>("elegir")
  const [archivo, setArchivo] = React.useState<ArchivoPreparado | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const inputCamaraRef = React.useRef<HTMLInputElement>(null)
  const inputGaleriaRef = React.useRef<HTMLInputElement>(null)
  const inputPdfRef = React.useRef<HTMLInputElement>(null)

  // El object URL de la miniatura se libera al reemplazar el archivo o al
  // desmontar el componente: si no, cada foto que el usuario descarta con
  // "Elegir otro" deja un blob vivo en memoria hasta que se cierra la pestaña.
  React.useEffect(() => {
    return () => {
      if (archivo?.previewUrl) URL.revokeObjectURL(archivo.previewUrl)
    }
  }, [archivo])

  async function procesarArchivo(file: File) {
    setError(null)
    setPaso("preparando")

    const resultadoValidacion = await validarArchivo(file)

    if (!resultadoValidacion.valido || !resultadoValidacion.tipo) {
      setError(resultadoValidacion.error ?? "El archivo no es válido.")
      setPaso("elegir")
      return
    }

    try {
      const { blob, mimeType, redimensionada, bytesAntes, bytesDespues } = await comprimirArchivo(
        file,
        resultadoValidacion.tipo,
      )

      const previewUrl = mimeType.startsWith("image/") ? URL.createObjectURL(blob) : null

      setArchivo({
        blob,
        mimeType,
        nombre: nombreConExtension(file.name, mimeType),
        bytesAntes,
        bytesDespues,
        redimensionada,
        previewUrl,
      })
      setPaso("vista-previa")
    } catch {
      setError("No se pudo preparar el archivo. Probá de nuevo o elegí otro.")
      setPaso("elegir")
    }
  }

  function manejarSeleccion(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Limpia el input: si no, elegir EL MISMO archivo dos veces seguidas (por
    // ejemplo, después de "Elegir otro") no vuelve a disparar `onChange`.
    event.target.value = ""
    if (file) void procesarArchivo(file)
  }

  function elegirOtro() {
    if (archivo?.previewUrl) URL.revokeObjectURL(archivo.previewUrl)
    setArchivo(null)
    setError(null)
    setPaso("elegir")
  }

  function confirmar() {
    if (!archivo) return
    onArchivoListo({ blob: archivo.blob, mimeType: archivo.mimeType, nombre: archivo.nombre })
  }

  return (
    <div className={cn("flex w-full flex-col gap-4", className)}>
      {error && <Alerta variante="error">{error}</Alerta>}

      {paso === "preparando" && (
        <div
          role="status"
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center"
        >
          <Loader2Icon className="size-8 animate-spin text-primary" aria-hidden="true" />
          <p className="text-lg font-semibold text-foreground">Preparando…</p>
          <p className="text-base text-muted-foreground">
            Estamos revisando el archivo y, si hace falta, achicando la foto para que suba más
            rápido.
          </p>
        </div>
      )}

      {paso === "elegir" && (
        <div className="grid gap-4 sm:grid-cols-3">
          <input
            ref={inputCamaraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={manejarSeleccion}
          />
          <TarjetaInteractiva
            onClick={() => inputCamaraRef.current?.click()}
            className="flex flex-col items-center gap-3 px-6 py-8 text-center"
          >
            <span
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <CameraIcon className="size-7" />
            </span>
            <span className="text-lg font-semibold text-foreground">Sacar foto</span>
            <span className="text-base text-muted-foreground">
              Usá la cámara para fotografiar el estudio o la receta
            </span>
          </TarjetaInteractiva>

          {/* `accept="image/*"` a solas, SIN `capture`: dispara el selector de
              galería/archivos de imágenes del sistema. No combinar con el
              input de PDF de abajo -ver el comentario de cabecera del
              archivo sobre el bug de `accept` mixto en Android Chrome-. */}
          <input
            ref={inputGaleriaRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={manejarSeleccion}
          />
          <TarjetaInteractiva
            onClick={() => inputGaleriaRef.current?.click()}
            className="flex flex-col items-center gap-3 px-6 py-8 text-center"
          >
            <span
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
              aria-hidden="true"
            >
              <ImagesIcon className="size-7" />
            </span>
            <span className="text-lg font-semibold text-foreground">Elegir de la galería</span>
            <span className="text-base text-muted-foreground">
              Buscá una foto o imagen ya guardada en el dispositivo
            </span>
          </TarjetaInteractiva>

          {/* `accept="application/pdf"` a solas: es el único valor que abre el
              selector de documentos del sistema en Android Chrome. */}
          <input
            ref={inputPdfRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={manejarSeleccion}
          />
          <TarjetaInteractiva
            onClick={() => inputPdfRef.current?.click()}
            className="flex flex-col items-center gap-3 px-6 py-8 text-center"
          >
            <span
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
              aria-hidden="true"
            >
              <FileTextIcon className="size-7" />
            </span>
            <span className="text-lg font-semibold text-foreground">Elegir un PDF</span>
            <span className="text-base text-muted-foreground">
              Buscá un PDF ya guardado en el dispositivo
            </span>
          </TarjetaInteractiva>
        </div>
      )}

      {paso === "vista-previa" && archivo && (
        <div className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-4">
            {archivo.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- object URL local (blob en memoria), no un asset que next/image pueda optimizar
              <img
                src={archivo.previewUrl}
                alt={`Vista previa de ${archivo.nombre}`}
                className="size-24 shrink-0 rounded-lg border border-border object-cover"
              />
            ) : (
              <span
                className="flex size-24 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"
                aria-hidden="true"
              >
                <FileTextIcon className="size-10" />
              </span>
            )}

            <div className="flex min-w-0 flex-col gap-1">
              <p className="truncate text-base font-semibold text-foreground">{archivo.nombre}</p>
              <p className="text-base text-muted-foreground numeros-clinicos">
                {archivo.bytesDespues < archivo.bytesAntes
                  ? `${formatearBytes(archivo.bytesAntes)} → ${formatearBytes(archivo.bytesDespues)}`
                  : formatearBytes(archivo.bytesDespues)}
              </p>
              {archivo.redimensionada && (
                <p className="text-sm text-muted-foreground">Se redujo el tamaño de la imagen</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Boton onClick={confirmar} size="lg" className="sm:flex-1">
              Usar este archivo
            </Boton>
            <Boton onClick={elegirOtro} variant="outline" size="lg" className="sm:flex-1">
              <RotateCcwIcon aria-hidden="true" />
              Elegir otro
            </Boton>
          </div>
        </div>
      )}
    </div>
  )
}
