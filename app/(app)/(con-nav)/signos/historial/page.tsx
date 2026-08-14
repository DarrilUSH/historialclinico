/**
 * `/signos/historial`: serie temporal de los signos vitales del perfil activo
 * (Sprint 9, tarea 9.4 — ROADMAP_SPRINTS.md). Tensión (dos líneas, sistólica
 * y diastólica), glucemia y peso, con banda de referencia sombreada -salvo
 * peso, ver `components/signos/grafico-signo.tsx`-, filtro por período y
 * puntos fuera de umbral marcados visual y textualmente.
 *
 * Guarda igual que `/signos`: perfil activo obligatorio, sin exigir ningún
 * permiso puntual -a diferencia de los tres botones de carga, que piden
 * `can_upload`, mirar el historial es lectura y la política de
 * `vital_signs_select_puede_ver` ya la resuelve RLS (titular, `can_view`,
 * `can_upload` o `can_manage`)-. Las marcas de "fuera de umbral" sí dependen
 * de un permiso más estrecho -`can_manage`, la política de
 * `vital_sign_alerts`- pero eso lo resuelve la RLS en silencio
 * (`lib/signos/alertas-historial.ts` documenta el porqué): quien no tiene
 * `can_manage` ve el gráfico igual, sin las marcas.
 *
 * Server Component puro: junta en paralelo el historial completo de los tres
 * tipos, las alertas del perfil y los umbrales vigentes, y se los pasa como
 * props a `PanelHistorialSignos` (Client Component), que arma la serie con la
 * función pura de `lib/signos/series.ts`. Sin `<Suspense>` -a diferencia de
 * `/estudios/tendencias`- porque acá no hay `?periodo=` en la URL que dispare
 * una consulta nueva: una sola carga trae todo lo que las tres series van a
 * necesitar (ver `lib/signos/periodo.ts`).
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { PanelHistorialSignos } from "@/components/signos/panel-historial-signos"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { obtenerAlertasDeSignos } from "@/lib/signos/alertas-historial"
import { obtenerHistorialSigno, obtenerUmbralesDelPerfil } from "@/lib/signos/consultas"
import type { FilaVitalSignParaSerie } from "@/lib/signos/series"
import type { SignoTipo } from "@/lib/signos/tipos"

export const metadata: Metadata = {
  title: "Historial de signos vitales — Historial Médico",
}

export default async function PaginaHistorialSignos({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string | string[] }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { tipo: parametroTipo } = await searchParams
  const tipoInicial = Array.isArray(parametroTipo) ? parametroTipo[0] : parametroTipo

  const { supabase } = await requerirSesion({ desde: "/signos/historial" })

  const [tension, glucemia, peso, alertas, umbrales] = await Promise.all([
    obtenerHistorialSigno(supabase, activo.perfil.id, "tension"),
    obtenerHistorialSigno(supabase, activo.perfil.id, "glucemia"),
    obtenerHistorialSigno(supabase, activo.perfil.id, "peso"),
    obtenerAlertasDeSignos(supabase, activo.perfil.id),
    obtenerUmbralesDelPerfil(supabase, activo.perfil.id),
  ])

  const historial: Record<SignoTipo, FilaVitalSignParaSerie[]> = { tension, glucemia, peso }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <Link
        href="/signos"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a signos vitales
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Historial de signos vitales</h1>
        <p className="text-base text-muted-foreground">
          Evolución de {activo.perfil.full_name} a lo largo del tiempo, con los umbrales de alerta vigentes.
        </p>
      </div>

      <PanelHistorialSignos historial={historial} alertas={alertas} umbrales={umbrales} tipoInicial={tipoInicial} />
    </div>
  )
}
