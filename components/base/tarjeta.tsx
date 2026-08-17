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
 *
 * `CLASE_TARJETA_BASE` y `CLASE_TARJETA_INTERACTIVA` se exportan además como
 * strings para el caso -Sprint 5, `components/estudios/tarjeta-estudio.tsx`-
 * en el que la tarjeta interactiva tiene que ser una navegación real
 * (`<Link>`, para que abrir en pestaña nueva, el menú contextual "Copiar
 * enlace" y los lectores de pantalla la anuncien como enlace) y no un
 * `<button>` que dispara `router.push`. `TarjetaInteractiva` sigue siendo
 * el default para acciones que NO navegan -sigue el mismo consejo del
 * comentario de arriba: "para navegar, envolverla en `<Link>` o manejar la
 * navegación en `onClick`"-, pero envolver un `<button>` dentro de un
 * `<Link>` (que renderiza `<a>`) anida contenido interactivo, inválido en
 * HTML y con comportamiento inconsistente entre lectores de pantalla. Componer
 * las mismas clases directo sobre el `<Link>` da la identidad visual idéntica
 * sin ese anidado.
 */

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * `chica:[--card-spacing:--spacing(3.5)]` (Sprint 14): mismo ajuste, y por el
 * mismo motivo, que el de `components/ui/card.tsx` -el padding y el gap
 * internos de la tarjeta cuelgan los dos de este token-. Con la unidad de
 * espaciado compacta (3,5px), 5 escalones dan 17,5px y 3,5 dan 12,25px, que es
 * el padding de tarjeta densa de Material (12dp). Acá el `chica:` va a secas
 * porque esta clase no tiene variantes de tamaño con las que empatar en
 * especificidad: le gana al `[--card-spacing:--spacing(5)]` de la misma cadena
 * por el atributo del <html> (0-2-0 contra 0-1-0).
 */
export const CLASE_TARJETA_BASE =
  "flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-base text-card-foreground shadow-suave ring-1 ring-border [--card-spacing:--spacing(5)] chica:[--card-spacing:--spacing(3.5)]"

const BASE = CLASE_TARJETA_BASE

const DESTACADA = "ring-accent bg-accent/50 dark:bg-accent/20"

export const CLASE_TARJETA_INTERACTIVA =
  "w-full text-left transition-[transform,box-shadow] duration-[var(--duracion-media)] ease-salida hover:-translate-y-0.5 hover:shadow-elevada hover:ring-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 active:scale-[0.995] disabled:pointer-events-none disabled:opacity-50"

const INTERACTIVA = CLASE_TARJETA_INTERACTIVA

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
