/**
 * `/turnos/nuevo`: alta de turno (Sprint 6, tarea 6.1). Exige `can_upload`
 * (docs/modelo-permisos.md §6.1: INSERT en `appointments` = dueño O
 * `can_upload` O `can_manage`) — un `can_view` como Diego que llegue acá a
 * mano se redirige a `/turnos` antes de ver el formulario; si igualmente
 * postea la Server Action, `crearTurno` vuelve a exigir el permiso
 * (`requerirPermiso`) y RLS (`appointments_insert_puede_cargar`) es la
 * última palabra.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { FormularioTurno } from "@/components/turnos/formulario-turno"
import { requerirSesion } from "@/lib/auth/guardas"
import { hoyIsoUshuaia } from "@/lib/turnos/fecha"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Nuevo turno — Historial Médico",
}

export default async function PaginaNuevoTurno() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canUpload) {
    redirect("/turnos")
  }

  const { supabase } = await requerirSesion({ desde: "/turnos/nuevo" })

  const { data: medicos } = await supabase
    .from("doctors")
    .select("id, full_name, specialty")
    .eq("profile_id", activo.perfil.id)
    .eq("is_active", true)
    .order("full_name", { ascending: true })

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <Link
        href="/turnos"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a turnos
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Nuevo turno</h1>
        <p className="text-base text-muted-foreground">
          Cargá los datos del turno de {activo.perfil.full_name}.
        </p>
      </div>

      <FormularioTurno modo="crear" medicos={medicos ?? []} fechaMinimaIso={hoyIsoUshuaia()} />
    </div>
  )
}
