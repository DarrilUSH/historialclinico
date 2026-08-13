"use client"

/**
 * Orquestador de la interacción en `/estudios/tendencias` (Sprint 5, tareas
 * 5.2 y 5.4): mantiene qué métrica está elegida (estado local) y renderiza:
 * 1. Tarjetas compactas de "último valor" con variación (tarea 5.2).
 * 2. Selector de métrica y gráfico de la serie elegida (tarea 5.4).
 *
 * Las tarjetas actúan como selector alternativo: tocar una cambia la métrica.
 *
 * Recibe `series`/`metricasDisponibles` YA resueltos como props desde
 * `app/(app)/(con-nav)/estudios/tendencias/page.tsx` (Server Component,
 * dentro del `<Suspense key={periodo}>`): este componente nunca toca
 * Supabase.
 */

import * as React from "react"

import { GraficoMetrica } from "@/components/estudios/grafico-metrica"
import { SelectorMetrica } from "@/components/estudios/selector-metrica"
import { TarjetaUltimoValor } from "@/components/estudios/tarjeta-ultimo-valor"
import type { MetricaDisponible, SerieMetrica } from "@/lib/laboratorio/series"
import { resumenUltimoValor } from "@/lib/laboratorio/ultimo-valor"

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
      {/* Tarjetas de último valor: grilla responsiva */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 lg:gap-3">
        {series.map((serie) => {
          const resumen = resumenUltimoValor(serie.puntos)
          return (
            <TarjetaUltimoValor
              key={serie.clave}
              etiqueta={serie.etiqueta}
              resumen={resumen}
              onSeleccionar={() => setClaveSeleccionada(serie.clave)}
            />
          )
        })}
      </div>

      {/* Selector de métrica + gráfico */}
      <div className="flex flex-col gap-4 pt-2 border-t border-borde-sutil">
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
    </div>
  )
}
