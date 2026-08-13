/**
 * Tarjeta Senior UX: envuelve `components/ui/card.tsx` con las variantes que
 * pide `docs/design-system.md` -superficie con límite visible y sombra
 * suave-, más dos casos de uso concretos:
 *
 * - `Tarjeta`: contenedor visual puro (listas, resúmenes, formularios).
 * - `TarjetaInteractiva`: siempre un `<button type="button">` real -nunca
 *   un `<div role="button">`, que la skill `a11y-audit` marca-, con
 *   levantamiento sutil al pasar el mouse y `focus-visible` con el mismo
 *   anillo de foco que el resto de la app (mismo patrón que
 *   `components/perfiles/selector-perfiles.tsx`). Para navegar, envolverla
 *   en `<Link>` o manejar la navegación en `onClick`.
 *
 * Las dos variantes aceptan `variante="destacada"` para el acento ámbar
 * (`--accent`), reservado a superficies de realce -nunca un botón, ver
 * docs/design-system.md §1-.
 */

import * as React from "react"

import { cn } from "@/lib/utils"

const BASE =
  "flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-base text-card-foreground shadow-suave ring-1 ring-border [--card-spacing:--spacing(5)]"

const DESTACADA = "ring-accent bg-accent/50 dark:bg-accent/20"

const INTERACTIVA =
  "w-full text-left transition-[transform,box-shadow] duration-[var(--duracion-media)] ease-salida hover:-translate-y-0.5 hover:shadow-elevada hover:ring-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 active:scale-[0.995] disabled:pointer-events-none disabled:opacity-50"

type TarjetaVariante = "default" | "destacada"

export interface TarjetaProps extends Omit<React.ComponentProps<"div">, "className"> {
  variante?: TarjetaVariante
  className?: string
}

/** Tarjeta no interactiva: contenedor visual puro. */
export function Tarjeta({ variante = "default", className, ...props }: TarjetaProps) {
  return (
    <div
      data-slot="tarjeta"
      className={cn(BASE, variante === "destacada" && DESTACADA, className)}
      {...props}
    />
  )
}

export interface TarjetaInteractivaProps
  extends Omit<React.ComponentProps<"button">, "className"> {
  variante?: TarjetaVariante
  className?: string
}

/** Tarjeta interactiva: `<button type="button">` real, con hover y focus-visible marcados. */
export function TarjetaInteractiva({
  variante = "default",
  className,
  type = "button",
  ...props
}: TarjetaInteractivaProps) {
  return (
    <button
      type={type}
      data-slot="tarjeta-interactiva"
      className={cn(BASE, INTERACTIVA, variante === "destacada" && DESTACADA, className)}
      {...props}
    />
  )
}
