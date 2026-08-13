import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Textarea nativo, mismo lenguaje visual que `input.tsx`: 18px SIEMPRE (sin
 * `md:text-sm`), alto mínimo cómodo para varias líneas y el mismo foco/estado
 * de error que el resto de los campos. A diferencia de `Input`, este es un
 * `<textarea>` nativo puro (no hay primitivo de Base UI para textarea), así
 * que no hace falta envolver nada.
 */
function Textarea({ className, rows = 4, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(
        "field-sizing-content min-h-24 w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-3.5 py-2.5 text-base transition-colors duration-150 ease-salida outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
