"use client"

/**
 * Selector de período de `/estudios/tendencias` (Sprint 5, tarea 5.4): tres
 * botones segmentados (6 meses / 1 año / todo), persistidos en la URL
 * (`?periodo=`) -mismo criterio que `filtros-estudios.tsx`: la URL es la
 * única fuente de verdad, así recargar la página o compartir el link
 * conserva el período elegido-.
 *
 * A diferencia de la selección de métrica (`selector-metrica.tsx`, estado
 * local puro), cambiar de período SÍ necesita una consulta nueva del lado
 * del servidor -`obtenerSeries` filtra `measurement_date` con otro corte-,
 * así que `router.replace()` es lo correcto acá: dispara la navegación que
 * vuelve a ejecutar `app/(app)/(con-nav)/estudios/tendencias/page.tsx` con
 * el `?periodo=` nuevo, y el `<Suspense key={periodo}>` de esa página
 * muestra el esqueleto mientras la consulta nueva resuelve.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { ETIQUETA_PERIODO, PERIODOS_EN_ORDEN, parsearPeriodo, type PeriodoSerie } from "@/lib/laboratorio/periodo"
import { cn } from "@/lib/utils"

export function SelectorPeriodo() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const periodoActual = parsearPeriodo(searchParams.get("periodo"))

  function elegir(periodo: PeriodoSerie) {
    if (periodo === periodoActual) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("periodo", periodo)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div
      role="group"
      aria-label="Período"
      className="inline-flex w-full rounded-lg border border-border bg-muted p-1 sm:w-auto"
    >
      {PERIODOS_EN_ORDEN.map((periodo) => {
        const seleccionado = periodo === periodoActual
        return (
          <button
            key={periodo}
            type="button"
            aria-pressed={seleccionado}
            onClick={() => elegir(periodo)}
            className={cn(
              "min-h-tactil flex-1 rounded-md px-4 text-base font-medium transition-colors sm:flex-none",
              seleccionado
                ? "bg-card text-foreground shadow-suave"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {ETIQUETA_PERIODO[periodo]}
          </button>
        )
      })}
    </div>
  )
}
