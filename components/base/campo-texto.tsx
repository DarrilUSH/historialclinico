"use client"

/**
 * Campo de texto Senior UX: envuelve `components/ui/input.tsx` (que ya trae
 * 18px y alto táctil) con las reglas de formularios de
 * `docs/design-system.md` §8: etiqueta SIEMPRE visible arriba (nunca el
 * placeholder como etiqueta), ayuda opcional debajo, error asociado por
 * `aria-describedby` + `aria-invalid`, e ícono/sufijo opcionales.
 *
 * `campo-numero.tsx` se construye ENCIMA de este componente (mismo layout,
 * agrega `inputMode`/`pattern`), así que los dos comparten exactamente la
 * misma estructura visual y de accesibilidad.
 */

import * as React from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export interface CampoTextoProps
  extends Omit<React.ComponentProps<typeof Input>, "id"> {
  /** `id` del input, `htmlFor` del label y, si no se pasa `name`, también el `name`. */
  id: string
  /** Etiqueta SIEMPRE visible arriba del campo. Nunca se reemplaza por el placeholder. */
  label: string
  /** Texto de ayuda opcional debajo del campo. Se oculta mientras hay error. */
  ayuda?: string
  /** Mensaje de error propio de este campo: lo asocia con `aria-describedby` y marca `aria-invalid`. */
  error?: string
  /**
   * Marca el campo como inválido sin mostrar un mensaje propio -por ejemplo
   * cuando el error es compartido por todo el formulario y se muestra una
   * sola vez con `<Alerta>` (ver `components/auth/formulario-auth.tsx`)-. Si
   * se pasa `error`, este flag es redundante: `error` ya implica inválido.
   */
  invalido?: boolean
  /** ids extra para `aria-describedby` (por ejemplo el id de una `<Alerta>` compartida). */
  describedBy?: string
  /** Ícono opcional a la izquierda del campo. */
  icono?: React.ReactNode
  /** Unidad clínica opcional a la derecha del campo (mg/dl, kg, latidos/min, etc.). */
  sufijo?: string
  /** Clases para el contenedor (label + input + ayuda/error), no para el input. */
  contenedorClassName?: string
}

export function CampoTexto({
  id,
  label,
  ayuda,
  error,
  invalido = false,
  describedBy,
  icono,
  sufijo,
  className,
  contenedorClassName,
  name,
  required,
  type = "text",
  ...props
}: CampoTextoProps) {
  const idAyuda = ayuda && !error ? `${id}-ayuda` : undefined
  const idError = error ? `${id}-error` : undefined
  const describedByFinal =
    [idAyuda, idError, describedBy].filter(Boolean).join(" ") || undefined

  return (
    <div className={cn("flex flex-col gap-2", contenedorClassName)}>
      <Label htmlFor={id}>{label}</Label>

      <div className="relative flex items-center">
        {icono && (
          <span
            className="pointer-events-none absolute left-3.5 flex text-muted-foreground [&_svg]:size-5"
            aria-hidden="true"
          >
            {icono}
          </span>
        )}

        <Input
          {...props}
          id={id}
          name={name ?? id}
          type={type}
          required={required}
          aria-invalid={error || invalido ? true : undefined}
          aria-describedby={describedByFinal}
          className={cn(icono && "pl-11", sufijo && "pr-14", className)}
        />

        {sufijo && (
          <span
            className="pointer-events-none absolute right-3.5 text-base text-muted-foreground"
            aria-hidden="true"
          >
            {sufijo}
          </span>
        )}
      </div>

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
