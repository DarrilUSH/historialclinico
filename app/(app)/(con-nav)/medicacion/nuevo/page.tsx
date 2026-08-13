/**
 * `/medicacion/nuevo`: alta de medicación (Sprint 7, tarea 7.2). Exige
 * `can_upload` (`medications_insert_puede_cargar`, `docs/modelo-permisos.md`)
 * — un `can_view` que llegue acá a mano se redirige a `/medicacion` antes de
 * ver el formulario; si igualmente postea la Server Action, `crearMedicacion`
 * vuelve a exigir el permiso (`requerirPermiso`) y RLS es la última palabra.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { FormularioMedicacion } from "@/components/medicacion/formulario-medicacion"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Nueva medicación — Historial Médico",
}

export default async function PaginaNuevaMedicacion() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canUpload) {
    redirect("/medicacion")
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <Link
        href="/medicacion"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a medicación
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Nueva medicación</h1>
        <p className="text-base text-muted-foreground">
          Cargá los datos de la medicación de {activo.perfil.full_name}.
        </p>
      </div>

      <FormularioMedicacion modo="crear" />
    </div>
  )
}
