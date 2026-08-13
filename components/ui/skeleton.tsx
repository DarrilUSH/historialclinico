import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Placeholder de carga estándar (shadcn): un bloque `bg-muted` que pulsa.
 * `animate-pulse` es una animación infinita, pero el bloque global de
 * `prefers-reduced-motion: reduce` en `app/globals.css` la apaga para
 * cualquier elemento (`*, *::before, *::after`), así que no hace falta
 * repetir esa guarda acá.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="skeleton" className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />
  )
}

export { Skeleton }
