"use client"

/**
 * Botón Senior UX: envuelve `components/ui/button.tsx` (que ya trae 18px,
 * alto táctil y foco visible) con dos reglas propias del proyecto:
 *
 * 1. `cargando`: spinner + `disabled` + `aria-busy` en un solo prop, en vez
 *    de repetir esas tres cosas a mano en cada formulario (como hacía
 *    `BotonEnviar` en `components/auth/formulario-auth.tsx` antes de esta
 *    migración).
 * 2. `variant="destructivo"`: el botón NUNCA confirma una acción por sí
 *    mismo. A nivel de tipos no acepta `onClick` -así que un desarrollador
 *    no puede cablear una acción destructiva directo a este botón-: se usa
 *    como disparador de `dialogo-confirmacion.tsx` (prop `disparador`, con
 *    el patrón `render` de Base UI) o como su botón de confirmación final.
 *    En los dos casos la ejecución real la dispara ese componente, nunca
 *    este botón solo. (El `render` de Base UI igual funciona: clona el
 *    elemento e inyecta su propio manejador en tiempo de ejecución, fuera
 *    del alcance de este chequeo de tipos.)
 */

import * as React from "react"
import { Loader2Icon } from "lucide-react"
import type { VariantProps } from "class-variance-authority"

import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type VarianteEstandar = Exclude<
  NonNullable<VariantProps<typeof buttonVariants>["variant"]>,
  "destructive"
>

interface BotonComunes {
  /** Spinner + `disabled` + `aria-busy` en un solo prop. */
  cargando?: boolean
  size?: VariantProps<typeof buttonVariants>["size"]
  className?: string
  children?: React.ReactNode
}

type BotonPropsEstandar = BotonComunes & {
  variant?: VarianteEstandar
} & Omit<React.ComponentProps<typeof Button>, "variant" | "size" | "className" | "children">

type BotonPropsDestructivo = BotonComunes & {
  variant: "destructivo"
} & Omit<
    React.ComponentProps<typeof Button>,
    "variant" | "size" | "className" | "children" | "onClick"
  >

export type BotonProps = BotonPropsEstandar | BotonPropsDestructivo

export function Boton(props: BotonProps) {
  const {
    cargando = false,
    disabled,
    children,
    className,
    variant = "default",
    ...resto
  } = props

  return (
    <Button
      {...resto}
      variant={variant === "destructivo" ? "destructive" : variant}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={cn(className)}
    >
      {cargando && <Loader2Icon className="animate-spin" aria-hidden="true" />}
      {children}
    </Button>
  )
}
