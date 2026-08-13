"use client"

/**
 * Orquestador de la interacción en `/estudios/tendencias` (Sprint 5, tarea
 * 5.4): mantiene qué métrica está elegida (estado local, ver
 * `selector-metrica.tsx` sobre por qué NO vive en la URL) y renderiza el
 * gráfico de esa serie.
 *
 * Recibe `series`/`metricasDisponibles` YA resueltos como props desde
 * `app/(app)/(con-nav)/estudios/tendencias/page.tsx` (Server Component,
 * dentro del `<Suspense key={periodo}>`): este componente nunca toca
 * Supabase.
 */

import * as React from "react"

import { GraficoMetrica } from "@/components/estudios/grafico-metrica"
import { SelectorMetrica } from "@/components/estudios/selector-metrica"
import type { MetricaDisponible, SerieMetrica } from "@/lib/laboratorio/series"

export interface PanelTendenciasProps {
  series: SerieMetrica[]
  metricasDisponibles: MetricaDisponible[]
}

export function PanelTendencias({ series, metricasDisponibles }: PanelTendenciasProps) {
  const [claveSeleccionada, setClaveSeleccionada] = React.useState<string>(
    metricasDisponibles[0]?.clave ?? "",
  )

  // Red de seguridad: en la arquitectura actual, cambiar de período remonta
  // este componente entero (`<Suspense key={periodo}>` en `page.tsx`), así
  // que el `useState` de arriba ya arranca limpio con la primera métrica del
  // conjunto nuevo. Este ajuste EN RENDER (no en un efecto, mismo patrón que
  // `filtros-estudios.tsx` usa para `ultimoQDeUrl`) cubre igual el caso de
  // que la selección actual no exista en `metricasDisponibles` -por las
  // dudas de que algún cambio futuro deje de remontar en cada período-, en
  // vez de mostrar un gráfico vacío o congelado.
  const existeSeleccionActual = metricasDisponibles.some((m) => m.clave === claveSeleccionada)
  if (!existeSeleccionActual && metricasDisponibles.length > 0) {
    setClaveSeleccionada(metricasDisponibles[0].clave)
  }

  const indiceColor = metricasDisponibles.findIndex((m) => m.clave === claveSeleccionada)
  const serieSeleccionada = series.find((s) => s.clave === claveSeleccionada)

  return (
    <div className="flex flex-col gap-4">
      <SelectorMetrica
        metricas={metricasDisponibles}
        claveSeleccionada={claveSeleccionada}
        onSeleccionar={setClaveSeleccionada}
      />

      {serieSeleccionada && (
        <GraficoMetrica
          key={serieSeleccionada.clave}
          serie={serieSeleccionada}
          colorIndice={Math.max(0, indiceColor)}
        />
      )}
    </div>
  )
}
