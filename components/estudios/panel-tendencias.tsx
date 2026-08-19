"use client"

/**
 * Orquestador de la interacción en `/estudios/tendencias` (Sprint 5, tareas
 * 5.2 y 5.4): mantiene qué métrica está elegida (estado local) y renderiza:
 * 1. Tarjetas compactas de "último valor", cada una disparadora de su
 *    diálogo de detalle completo (tarea 5.2, ampliado en vivo 2026-08-19:
 *    ver `components/estudios/dialogo-detalle-metrica.tsx`).
 * 2. Selector de métrica y gráfico de la serie elegida (tarea 5.4).
 *
 * Tocar una tarjeta ya NO cambia la métrica graficada más abajo -antes
 * "actuaba como selector alternativo" de `SelectorMetrica"; con el diálogo
 * de detalle nuevo, tocarla tiene un solo trabajo: abrir la lista completa
 * de mediciones de esa métrica. Cambiar qué serie se grafica sigue siendo,
 * sin superposición, trabajo de `SelectorMetrica` (las chips de abajo).
 *
 * Recibe `series`/`metricasDisponibles`/`periodo` YA resueltos como props
 * desde `app/(app)/(con-nav)/estudios/tendencias/page.tsx` (Server
 * Component, dentro del `<Suspense key={periodo}>`): este componente nunca
 * toca Supabase.
 *
 * `GraficoMetrica` se carga con `next/dynamic({ ssr: false })` (Sprint 11,
 * tarea 11.6): es el único punto de la app que importa Recharts para esta
 * pantalla, y este ya es un Client Component -el `ssr: false` funciona acá
 * porque el `dynamic()` vive dentro de un archivo "use client", no en el
 * Server Component que arma `page.tsx` (ver `node_modules/next/dist/docs/…
 * /lazy-loading.md`: sin eso no hay code splitting real). Con `EsqueletoGrafico`
 * como `loading`, el hueco que deja mientras baja el chunk tiene el mismo
 * alto que el gráfico real, así que no hay salto de layout (CLS) cuando
 * termina de cargar.
 */

import * as React from "react"
import dynamic from "next/dynamic"

import { DialogoDetalleMetrica } from "@/components/estudios/dialogo-detalle-metrica"
import { EsqueletoGrafico } from "@/components/graficos/esqueleto-grafico"
import { SelectorMetrica } from "@/components/estudios/selector-metrica"
import type { Tamano } from "@/lib/densidad/tamano"
import type { PeriodoSerie } from "@/lib/laboratorio/periodo"
import type { MetricaDisponible, SerieMetrica } from "@/lib/laboratorio/series"

const GraficoMetrica = dynamic(
  () => import("@/components/estudios/grafico-metrica").then((mod) => mod.GraficoMetrica),
  { ssr: false, loading: () => <EsqueletoGrafico /> },
)

export interface PanelTendenciasProps {
  series: SerieMetrica[]
  metricasDisponibles: MetricaDisponible[]
  /** Modo de letra de la cuenta (Sprint 13), resuelto server-side en `page.tsx` y bajado hasta `GraficoMetrica` para elegir el alto del gráfico sin detección en el cliente. */
  tamano: Tamano
  /** Período elegido (`page.tsx`), bajado hasta `DialogoDetalleMetrica` para matizar el texto de "única medición" ("en este período" vs. "registrada"). */
  periodo: PeriodoSerie
}

export function PanelTendencias({ series, metricasDisponibles, tamano, periodo }: PanelTendenciasProps) {
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
    <div className="flex flex-col gap-4 chica:gap-3">
      {/* Tarjetas de último valor: grilla responsiva. En chica ya son 2
          columnas por default (`grid-cols-2`, sin cambios); lo que se aprieta
          es el espacio entre tarjetas. */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 lg:gap-3 chica:gap-1.5">
        {series.map((serie) => (
          <DialogoDetalleMetrica key={serie.clave} serie={serie} periodo={periodo} />
        ))}
      </div>

      {/* Selector de métrica + gráfico */}
      <div className="flex flex-col gap-4 pt-2 border-t border-borde-sutil chica:gap-3 chica:pt-1.5">
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
            tamano={tamano}
          />
        )}
      </div>
    </div>
  )
}
