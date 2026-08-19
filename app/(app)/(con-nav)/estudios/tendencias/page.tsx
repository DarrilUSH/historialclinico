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
import { ListaResultadosCualitativos } from "@/components/estudios/lista-resultados-cualitativos"
import { PanelTendencias } from "@/components/estudios/panel-tendencias"
import { SelectorPeriodo } from "@/components/estudios/selector-periodo"
import { Skeleton } from "@/components/ui/skeleton"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerTamano } from "@/lib/densidad/servidor"
import type { Tamano } from "@/lib/densidad/tamano"
import { parsearPeriodo } from "@/lib/laboratorio/periodo"
import { obtenerResultadosCualitativos, obtenerSeries } from "@/lib/laboratorio/series"
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
  // Resuelto server-side (mismo helper que ya usa el layout raíz para
  // `data-tamano`) para que `GraficoMetrica` sepa qué alto de gráfico pintar
  // -260px en grande, 200px en chica- desde el primer render, sin detección
  // en el cliente ni salto de layout al montar.
  const tamano = await obtenerTamano()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <BotonVolverEstudios />

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Tendencias de laboratorio</h1>
        <p className="text-base text-muted-foreground">
          Evolución de tus análisis a lo largo del tiempo, con el rango de referencia de cada estudio.
        </p>
      </div>

      <SelectorPeriodo />

      <Suspense key={periodo} fallback={<EsqueletoTendencias />}>
        <ContenidoTendencias perfilId={activo.perfil.id} periodo={periodo} tamano={tamano} />
      </Suspense>
    </div>
  )
}

async function ContenidoTendencias({
  perfilId,
  periodo,
  tamano,
}: {
  perfilId: string
  periodo: ReturnType<typeof parsearPeriodo>
  tamano: Tamano
}) {
  const { supabase } = await requerirSesion({ desde: "/estudios/tendencias" })
  // Series numéricas y resultados cualitativos son consultas independientes
  // (Sprint 18): un resultado cualitativo no tiene curva posible, así que
  // vive en su propia lista aparte (`ListaResultadosCualitativos`) en vez de
  // forzarlo dentro de `PanelTendencias`, que asume valores numéricos de
  // punta a punta (gráfico, tarjeta de "último valor", variación).
  const [{ series, metricasDisponibles }, resultadosCualitativos] = await Promise.all([
    obtenerSeries(supabase, perfilId, periodo),
    obtenerResultadosCualitativos(supabase, perfilId, periodo),
  ])

  if (metricasDisponibles.length === 0 && resultadosCualitativos.length === 0) {
    return <EstadoVacioTendencias periodo={periodo} />
  }

  return (
    <div className="flex flex-col gap-4 chica:gap-3">
      {metricasDisponibles.length > 0 && (
        <PanelTendencias series={series} metricasDisponibles={metricasDisponibles} tamano={tamano} />
      )}

      <ListaResultadosCualitativos resultados={resultadosCualitativos} />
    </div>
  )
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
