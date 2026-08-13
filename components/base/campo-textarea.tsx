"use client"

/**
 * Campo de texto largo Senior UX: mismo contrato visual y de accesibilidad
 * que `campo-texto.tsx` (label siempre visible, ayuda/error asociados por
 * `aria-describedby`, `aria-invalid`), pero envolviendo `components/ui/textarea.tsx`
 * en vez de `Input` -para resúmenes, notas y cualquier texto libre de varias
 * líneas.
 *
 * A diferencia de `campo-numero.tsx` (que deliberadamente NO hereda
 * `conDictado`, ver su comentario), acá SÍ tiene sentido: es texto libre sin
 * ambigüedad de transcripción numérica, el caso que `campo-texto.tsx#conDictado`
 * ya identifica como el bueno para dictado por voz.
 */

import * as React from "react"

import { BotonDictado } from "@/components/base/boton-dictado"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export interface CampoTextareaProps
  extends Omit<React.ComponentProps<typeof Textarea>, "id"> {
  /** `id` del textarea, `htmlFor` del label y, si no se pasa `name`, también el `name`. */
  id: string
  /** Etiqueta SIEMPRE visible arriba del campo. */
  label: string
  /** Texto de ayuda opcional debajo del campo. Se oculta mientras hay error. */
  ayuda?: string
  /** Mensaje de error propio de este campo. */
  error?: string
  /** Marca el campo como inválido sin mensaje propio (ver `campo-texto.tsx`). */
  invalido?: boolean
  describedBy?: string
  /** Agrega el botón de dictado por voz (`boton-dictado.tsx`) a la derecha de la etiqueta, en `es-AR`. */
  conDictado?: boolean
  contenedorClassName?: string
}

export function CampoTextarea({
  id,
  label,
  ayuda,
  error,
  invalido = false,
  describedBy,
  conDictado = false,
  className,
  contenedorClassName,
  name,
  required,
  ...props
}: CampoTextareaProps) {
  const idAyuda = ayuda && !error ? `${id}-ayuda` : undefined
  const idError = error ? `${id}-error` : undefined
  const describedByFinal =
    [idAyuda, idError, describedBy].filter(Boolean).join(" ") || undefined

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  // Mismo patrón de inserción que `campo-texto.tsx#manejarTranscripcion`,
  // adaptado a `HTMLTextAreaElement`: inserta en la posición del cursor y
  // dispara un evento `input` real para que el formulario (no controlado)
  // vea el cambio.
  const manejarTranscripcion = React.useCallback((textoDictado: string) => {
    const textarea = textareaRef.current
    if (!textarea || !textoDictado) return

    const valorPrevio = textarea.value
    const inicio = textarea.selectionStart ?? valorPrevio.length
    const fin = textarea.selectionEnd ?? valorPrevio.length

    const necesitaEspacioAntes = inicio > 0 && !/\s$/.test(valorPrevio.slice(0, inicio))
    const separadorAntes = necesitaEspacioAntes ? " " : ""
    const necesitaEspacioDespues = fin < valorPrevio.length && !/^\s/.test(valorPrevio.slice(fin))
    const separadorDespues = necesitaEspacioDespues ? " " : ""
    const nuevoValor =
      valorPrevio.slice(0, inicio) +
      separadorAntes +
      textoDictado +
      separadorDespues +
      valorPrevio.slice(fin)

    const descriptorNativo = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )
    if (descriptorNativo?.set) {
      descriptorNativo.set.call(textarea, nuevoValor)
    } else {
      textarea.value = nuevoValor
    }
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    const posicionCursor = inicio + separadorAntes.length + textoDictado.length
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(posicionCursor, posicionCursor)
    })
  }, [])

  return (
    <div className={cn("flex flex-col gap-2", contenedorClassName)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {conDictado && <BotonDictado onTranscripcion={manejarTranscripcion} />}
      </div>

      <Textarea
        {...props}
        ref={textareaRef}
        id={id}
        name={name ?? id}
        required={required}
        aria-invalid={error || invalido ? true : undefined}
        aria-describedby={describedByFinal}
        className={className}
      />

      {ayuda && !error && (
        <p id={idAyuda} className="text-sm text-muted-foreground">
          {ayuda}
        </p>
      )}

      {error && (
        <p id={idError} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
