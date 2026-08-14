/**
 * `/coberturas/nuevo`: alta de cobertura (Sprint 8, tarea 8.1). Exige
 * `can_upload` (`insurance_cards` INSERT, `docs/modelo-permisos.md` §6) —
 * un `can_view` que llegue acá a mano se redirige a `/coberturas` antes de
 * ver el formulario; si igualmente postea la Server Action,
 * `crearCobertura` vuelve a exigir el permiso (`requerirPermiso`) y RLS es
 * la última palabra.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { FormularioCobertura } from "@/components/coberturas/formulario-cobertura"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Nueva cobertura — Historial Médico",
}

export default async function PaginaNuevaCobertura() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canUpload) {
    redirect("/coberturas")
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <Link
        href="/coberturas"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a coberturas
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Nueva cobertura</h1>
        <p className="text-base text-muted-foreground">
          Cargá la obra social o prepaga de {activo.perfil.full_name}.
        </p>
      </div>

      <FormularioCobertura modo="crear" />
    </div>
  )
}
