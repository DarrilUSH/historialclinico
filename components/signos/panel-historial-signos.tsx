"use client"

/**
 * Orquestador de la interacción en `/signos/historial` (Sprint 9, tarea 9.4):
 * mantiene qué signo y qué período están elegidos (estado local, ver
 * `lib/signos/periodo.ts` para el porqué de que período NO viva en la URL
 * acá) y arma la serie del signo elegido con la función PURA
 * `lib/signos/series.ts#construirSerieSigno`.
 *
 * Mismo reparto de responsabilidades que
 * `components/estudios/panel-tendencias.tsx` (Sprint 5, tarea 5.4): recibe
 * los datos crudos YA resueltos como props desde
 * `app/(app)/(con-nav)/signos/historial/page.tsx` (Server Component) y nunca
 * toca Supabase. A diferencia de `PanelTendencias`, acá la transformación de
 * filas → serie NO pasó por el servidor -es pura, corre bien en el cliente-,
 * así que cambiar de signo o de período es instantáneo, sin ningún viaje de
 * red.
 *
 * `GraficoSigno` se carga con `next/dynamic({ ssr: false })` (Sprint 11,
 * tarea 11.6), mismo motivo y mismo esqueleto compartido
 * (`EsqueletoGrafico`) que `PanelTendencias` documenta para `GraficoMetrica`:
 * Recharts queda fuera del First Load JS de esta pantalla, sin CLS al
 * terminar de bajar el chunk porque el esqueleto ya reserva su alto.
 */

import * as React from "react"
import dynamic from "next/dynamic"

import { BotonExportar } from "@/components/signos/boton-exportar"
import { EsqueletoGrafico } from "@/components/graficos/esqueleto-grafico"
import { SelectorPeriodoSigno } from "@/components/signos/selector-periodo-signo"
import { SelectorSignoTipo } from "@/components/signos/selector-signo-tipo"
import { parsearPeriodoSignos, type PeriodoSignos } from "@/lib/signos/periodo"
import {
  construirSerieSigno,
  type FilaAlertaParaSerie,
  type FilaVitalSignParaSerie,
} from "@/lib/signos/series"
import { TIPOS_SIGNO, type SignoTipo } from "@/lib/signos/tipos"
import type { UmbralesSignos } from "@/lib/signos/umbrales"

const GraficoSigno = dynamic(
  () => import("@/components/signos/grafico-signo").then((mod) => mod.GraficoSigno),
  { ssr: false, loading: () => <EsqueletoGrafico /> },
)

export interface PanelHistorialSignosProps {
  historial: Record<SignoTipo, FilaVitalSignParaSerie[]>
  alertas: FilaAlertaParaSerie[]
  umbrales: UmbralesSignos
  /** `?tipo=` inicial, para el deep link de una notificación (`/signos/enlace`) o de un favorito -si no viene o no es válido, arranca en "tension". */
  tipoInicial?: string
}

export function PanelHistorialSignos({ historial, alertas, umbrales, tipoInicial }: PanelHistorialSignosProps) {
  const [tipo, setTipo] = React.useState<SignoTipo>(
    tipoInicial && (TIPOS_SIGNO as readonly string[]).includes(tipoInicial) ? (tipoInicial as SignoTipo) : "tension",
  )
  const [periodo, setPeriodo] = React.useState<PeriodoSignos>(() => parsearPeriodoSignos(undefined))

  const tiposConDatos = React.useMemo(
    () => new Set(TIPOS_SIGNO.filter((t) => historial[t].length > 0)),
    [historial],
  )

  // `ahora` se fija una sola vez por montaje (no en cada render) para que el
  // corte de período no "se corra" mientras la persona mira la pantalla -un
  // re-render disparado por otra cosa (el banner, un foco de teclado) no
  // puede hacer que un punto entre o salga de "30 días" a mitad de sesión.
  const [ahora] = React.useState(() => new Date())

  const serie = React.useMemo(
    () => construirSerieSigno(tipo, historial[tipo], alertas, umbrales, periodo, ahora),
    [tipo, historial, alertas, umbrales, periodo, ahora],
  )

  return (
    <div className="flex flex-col gap-4">
      <SelectorSignoTipo tipoSeleccionado={tipo} onSeleccionar={setTipo} tiposConDatos={tiposConDatos} />

      <div className="flex flex-col gap-4 border-t border-borde-sutil pt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SelectorPeriodoSigno periodo={periodo} onCambiar={setPeriodo} />
          <BotonExportar tipo={tipo} periodo={periodo} />
        </div>

        <GraficoSigno key={`${tipo}-${periodo}`} serie={serie} />
      </div>
    </div>
  )
}
