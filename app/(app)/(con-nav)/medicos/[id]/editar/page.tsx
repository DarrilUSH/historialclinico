/**
 * `/medicos/[id]/editar`: edición de un médico ya cargado (Sprint 10, tarea
 * 10.1). Exige `can_manage` (`doctors_update_administrador` — "editar los
 * datos de un médico o darlo de baja es administración",
 * `docs/modelo-permisos.md`). Un `can_view` o `can_upload` que fuerce esta
 * URL se redirige a `/medicos` sin ver el formulario — mismo criterio de
 * "guarda de UI, no LA guarda" que `medicacion/[id]/editar/page.tsx`: RLS
 * sigue siendo la última palabra.
 *
 * Trae la fila de `doctors` directo (no solo los activos): un médico dado de
 * baja también se edita desde acá -corregir el teléfono no exige
 * reactivarlo primero-.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { FormularioMedico, type ValoresMedico } from "@/components/medicos/formulario-medico"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Editar médico — Historial Médico",
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaEditarMedico({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canManage) {
    redirect("/medicos")
  }

  const { id } = await params

  if (!PATRON_UUID.test(id)) {
    redirect("/medicos")
  }

  const { supabase } = await requerirSesion({ desde: "/medicos" })

  const { data: medico } = await supabase
    .from("doctors")
    .select(
      "id, full_name, specialties, license_number, institution, phone, address, city, province, latitude, longitude, notes",
    )
    .eq("id", id)
    .eq("profile_id", activo.perfil.id)
    .maybeSingle()

  if (!medico) {
    redirect("/medicos")
  }

  const valoresIniciales: Partial<ValoresMedico> = {
    nombre: medico.full_name,
    especialidades: medico.specialties,
    matricula: medico.license_number ?? "",
    institucion: medico.institution ?? "",
    telefono: medico.phone ?? "",
    direccion: medico.address ?? "",
    ciudad: medico.city ?? "",
    provincia: medico.province ?? "",
    latitud: medico.latitude !== null ? String(medico.latitude) : "",
    longitud: medico.longitude !== null ? String(medico.longitude) : "",
    notas: medico.notes ?? "",
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <Link
        href="/medicos"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a médicos
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Editar médico</h1>
        <p className="text-base text-muted-foreground">{medico.full_name}</p>
      </div>

      <FormularioMedico modo="editar" medicoId={medico.id} valoresIniciales={valoresIniciales} />
    </div>
  )
}
