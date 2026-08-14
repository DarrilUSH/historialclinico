/**
 * `/medicos/nuevo`: alta de médico (Sprint 10, tarea 10.1). Exige
 * `can_upload` (`doctors_insert_puede_cargar`, `docs/modelo-permisos.md`) —
 * un `can_view` que llegue acá a mano se redirige a `/medicos` antes de ver
 * el formulario; si igualmente postea la Server Action, `crearMedico` vuelve
 * a exigir el permiso (`requerirPermiso`) y RLS es la última palabra.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { FormularioMedico } from "@/components/medicos/formulario-medico"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Nuevo médico — Historial Médico",
}

export default async function PaginaNuevoMedico() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canUpload) {
    redirect("/medicos")
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <Link
        href="/medicos"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a médicos
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Nuevo médico</h1>
        <p className="text-base text-muted-foreground">
          Cargá los datos del médico en el directorio de {activo.perfil.full_name}.
        </p>
      </div>

      <FormularioMedico modo="crear" />
    </div>
  )
}
