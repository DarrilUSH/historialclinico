"use client"

/**
 * Selector de período de `/signos/historial` (Sprint 9, tarea 9.4): tres
 * botones segmentados (30 días / 90 días / todo).
 *
 * Mismo lenguaje visual que `components/estudios/selector-periodo.tsx`
 * (Sprint 5, tarea 5.4) -grupo segmentado, `aria-pressed`, altura táctil
 * mínima-, pero estado LOCAL en vez de la URL: a diferencia de laboratorio,
 * acá cambiar de período no dispara ninguna consulta nueva -el corte lo
 * aplica la función pura `lib/signos/series.ts#construirSerieSigno` sobre
 * datos que ya están en memoria del cliente-, así que no hay nada que
 * `router.replace()` tenga que sincronizar. El porqué completo está en el
 * encabezado de `lib/signos/periodo.ts`.
 */

import { ETIQUETA_PERIODO_SIGNOS, PERIODOS_SIGNOS_EN_ORDEN, type PeriodoSignos } from "@/lib/signos/periodo"
import { cn } from "@/lib/utils"

export interface SelectorPeriodoSignoProps {
  periodo: PeriodoSignos
  onCambiar: (periodo: PeriodoSignos) => void
}

export function SelectorPeriodoSigno({ periodo, onCambiar }: SelectorPeriodoSignoProps) {
  return (
    <div
      role="group"
      aria-label="Período"
      className="inline-flex w-full rounded-lg border border-border bg-muted p-1 sm:w-auto"
    >
      {PERIODOS_SIGNOS_EN_ORDEN.map((opcion) => {
        const seleccionado = opcion === periodo
        return (
          <button
            key={opcion}
            type="button"
            aria-pressed={seleccionado}
            onClick={() => onCambiar(opcion)}
            className={cn(
              "min-h-tactil flex-1 rounded-md px-4 text-base font-medium transition-colors sm:flex-none",
              seleccionado
                ? "bg-card text-foreground shadow-suave"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {ETIQUETA_PERIODO_SIGNOS[opcion]}
          </button>
        )
      })}
    </div>
  )
}
