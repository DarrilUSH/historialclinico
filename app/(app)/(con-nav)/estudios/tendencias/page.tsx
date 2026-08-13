/**
 * `/estudios/tendencias`: evolución temporal de las métricas de laboratorio
 * del perfil activo (Sprint 5, tarea 5.4) — la serie de Glucosa, Colesterol
 * total, Hemoglobina, etc., con banda de rango de referencia, selector de
 * métrica y selector de período (6 meses / 1 año / todo).
 *
 * Mismo reparto de responsabilidades que `app/(app)/(con-nav)/estudios/page.tsx`:
 * esta página resuelve el guarda (perfil activo) y el `?periodo=` de la URL
 * -`lib/laboratorio/periodo.ts`, isomórfico, lo necesita también
 * `components/estudios/selector-periodo.tsx` del lado del cliente-, y deja
 * la consulta pesada (`obtenerSeries`) en `ContenidoTendencias`, envuelta en
 * `<Suspense key={periodo}>` para que cambiar de período muestre el
 * esqueleto en vez de una pantalla congelada mientras la consulta nueva
 * resuelve. El selector de período vive FUERA del `<Suspense>` a propósito
 * -mismo motivo que `FiltrosEstudios` vive fuera del de `ListaEstudios`-:
 * tiene que seguir tocable mientras la consulta nueva está en vuelo.
 */

import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Suspense } from "react"

import { ChartLineIcon, FlaskConicalIcon } from "lucide-react"

import { BotonVolverEstudios } from "@/components/estudios/boton-volver-estudios"
import { PanelTendencias } from "@/components/estudios/panel-tendencias"
import { SelectorPeriodo } from "@/components/estudios/selector-periodo"
import { Skeleton } from "@/components/ui/skeleton"
import { requerirSesion } from "@/lib/auth/guardas"
import { parsearPeriodo } from "@/lib/laboratorio/periodo"
import { obtenerSeries } from "@/lib/laboratorio/series"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Tendencias — Historial Médico",
}

export default async function PaginaTendencias({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { periodo: periodoCrudo } = await searchParams
  const periodo = parsearPeriodo(periodoCrudo)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <BotonVolverEstudios />

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Tendencias de laboratorio</h1>
        <p className="text-base text-muted-foreground">
          Evolución de tus análisis a lo largo del tiempo, con el rango de referencia de cada estudio.
        </p>
      </div>

      <SelectorPeriodo />

      <Suspense key={periodo} fallback={<EsqueletoTendencias />}>
        <ContenidoTendencias perfilId={activo.perfil.id} periodo={periodo} />
      </Suspense>
    </div>
  )
}

async function ContenidoTendencias({
  perfilId,
  periodo,
}: {
  perfilId: string
  periodo: ReturnType<typeof parsearPeriodo>
}) {
  const { supabase } = await requerirSesion({ desde: "/estudios/tendencias" })
  const { series, metricasDisponibles } = await obtenerSeries(supabase, perfilId, periodo)

  if (metricasDisponibles.length === 0) {
    return <EstadoVacioTendencias periodo={periodo} />
  }

  return <PanelTendencias series={series} metricasDisponibles={metricasDisponibles} />
}

function EstadoVacioTendencias({ periodo }: { periodo: ReturnType<typeof parsearPeriodo> }) {
  return (
    <div className="flex w-full flex-col items-center gap-4 px-4 py-12 text-center">
      <span
        className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        {periodo === "todo" ? (
          <FlaskConicalIcon className="size-8" />
        ) : (
          <ChartLineIcon className="size-8" />
        )}
      </span>
      <h2 className="text-xl font-semibold text-balance text-foreground">
        {periodo === "todo"
          ? "Todavía no hay métricas de laboratorio cargadas"
          : "No hay mediciones en este período"}
      </h2>
      <p className="max-w-sm text-base text-muted-foreground">
        {periodo === "todo"
          ? "Cuando subas un análisis de laboratorio con valores numéricos (glucosa, colesterol, hemoglobina...), su evolución va a aparecer acá."
          : "Probá con el período \"Todo\" para ver las mediciones más antiguas."}
      </p>
    </div>
  )
}

/**
 * Fallback de `<Suspense>` mientras `ContenidoTendencias` resuelve la
 * consulta: chips + gráfico + panel de detalle simulados, misma forma final
 * que `EsqueletoListaEstudios` documenta para su propio propósito.
 */
function EsqueletoTendencias() {
  return (
    <div role="status" className="flex flex-col gap-4" aria-hidden="true">
      <span className="sr-only">Cargando tendencias…</span>
      <div className="flex gap-2">
        <Skeleton className="h-11 w-28 rounded-full" />
        <Skeleton className="h-11 w-36 rounded-full" />
        <Skeleton className="h-11 w-32 rounded-full" />
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  )
}
