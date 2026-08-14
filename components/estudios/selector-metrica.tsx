"use client"

/**
 * Chips de selección de métrica en `/estudios/tendencias` (Sprint 5, tarea
 * 5.4): fila scrolleable horizontal con una chip grande y táctil por
 * métrica disponible ("Glucosa", "Colesterol total", "Hemoglobina"...).
 *
 * Estado 100% local -a diferencia de `filtros-estudios.tsx`, NO vive en la
 * URL-: cambiar de métrica no requiere una consulta nueva a la base (todas
 * las series del período ya llegaron en una sola respuesta de
 * `obtenerSeries`), así que reflejarlo en la URL con `router.replace()`
 * dispararía un viaje de ida y vuelta al servidor -el shell de
 * `app/(app)/(con-nav)/layout.tsx` documenta que cualquier navegación en
 * esta rama vuelve a pedir el RSC entero, `staleTimes.dynamic = 0`- para
 * redibujar algo que ya está en memoria del lado del cliente. El período SÍ
 * vive en la URL (`selector-periodo.tsx`) porque ESE cambio sí necesita una
 * consulta nueva (otro rango de fechas).
 */

import { TriangleAlertIcon } from "lucide-react"

import type { MetricaDisponible } from "@/lib/laboratorio/series"
import { cn } from "@/lib/utils"

export interface SelectorMetricaProps {
  metricas: readonly MetricaDisponible[]
  claveSeleccionada: string
  onSeleccionar: (clave: string) => void
}

const COLORES_CHART = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const

export function SelectorMetrica({ metricas, claveSeleccionada, onSeleccionar }: SelectorMetricaProps) {
  return (
    <div
      role="group"
      aria-label="Elegir métrica"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 chica:gap-1.5"
    >
      {metricas.map((metrica, indice) => {
        const seleccionada = metrica.clave === claveSeleccionada
        const color = COLORES_CHART[indice % COLORES_CHART.length]
        return (
          <button
            key={metrica.clave}
            type="button"
            aria-pressed={seleccionada}
            aria-label={
              metrica.fueraDeRango ? `${metrica.etiqueta}, última medición fuera de rango` : undefined
            }
            onClick={() => onSeleccionar(metrica.clave)}
            className={cn(
              "flex min-h-tactil shrink-0 items-center gap-2 rounded-full border px-4 text-base font-medium whitespace-nowrap transition-colors chica:gap-1.5 chica:px-3 chica:text-sm",
              seleccionada
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full chica:size-2"
              style={{ backgroundColor: seleccionada ? "currentColor" : color }}
            />
            {metrica.etiqueta}
            {metrica.fueraDeRango && (
              <TriangleAlertIcon
                aria-hidden="true"
                className={cn("size-4 shrink-0 chica:size-3.5", seleccionada ? "text-primary-foreground" : "text-advertencia")}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
