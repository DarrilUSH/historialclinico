/**
 * `/turnos/[id]/editar`: edición de un turno y sus transiciones de estado
 * (Sprint 6, tarea 6.1). Es también la única "pantalla de detalle" de un
 * turno en este sprint -no hay un `/turnos/[id]` de solo lectura separado-,
 * por eso reúne el formulario editable Y las acciones de confirmar /
 * completar / cancelar (`components/turnos/acciones-estado-turno.tsx`).
 *
 * Exige `can_manage` sobre el perfil activo -docs/modelo-permisos.md §6.1:
 * UPDATE/DELETE en `appointments` = dueño O `can_manage`, y la nota ⑬ del
 * documento deja "confirmar o cancelar un turno" en `can_manage` también-.
 * Un `can_view` o `can_upload` que fuerce esta URL se redirige a `/turnos`
 * sin ver el formulario: la política `appointments_update_administrador`
 * (RLS) igual bloquearía cualquier escritura, pero mostrar el formulario
 * para que el submit falle recién en el servidor sería una mala pantalla,
 * no una brecha de seguridad -por eso esto es una guarda de UI, no LA
 * guarda-.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { Tarjeta } from "@/components/base/tarjeta"
import { AccionesEstadoTurno } from "@/components/turnos/acciones-estado-turno"
import { BadgeEstadoTurno } from "@/components/turnos/badge-estado-turno"
import { FormularioTurno, type ValoresTurno } from "@/components/turnos/formulario-turno"
import { requerirSesion } from "@/lib/auth/guardas"
import { fechaIsoUshuaia, horaUshuaia } from "@/lib/turnos/fecha"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Editar turno — Historial Médico",
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaEditarTurno({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canManage) {
    redirect("/turnos")
  }

  const { id } = await params

  if (!PATRON_UUID.test(id)) {
    redirect("/turnos")
  }

  const { supabase } = await requerirSesion({ desde: "/turnos" })

  const { data: turno } = await supabase
    .from("appointments")
    .select(
      "id, specialty, doctor_name, doctor_id, appointment_date, location_name, location_address, location_city, location_province, latitude, longitude, preparation_notes, status",
    )
    .eq("id", id)
    .eq("profile_id", activo.perfil.id)
    .maybeSingle()

  if (!turno) {
    redirect("/turnos")
  }

  const { data: medicos } = await supabase
    .from("doctors")
    .select("id, full_name, specialty, institution, address, city, province, latitude, longitude")
    .eq("profile_id", activo.perfil.id)
    .eq("is_active", true)
    .order("full_name", { ascending: true })

  const fechaTurno = new Date(turno.appointment_date)

  const valoresIniciales: Partial<ValoresTurno> = {
    especialidad: turno.specialty,
    medico: turno.doctor_name ?? "",
    fecha: fechaIsoUshuaia(fechaTurno),
    hora: horaUshuaia(fechaTurno),
    lugarNombre: turno.location_name ?? "",
    lugarDireccion: turno.location_address ?? "",
    lugarCiudad: turno.location_city ?? "",
    lugarProvincia: turno.location_province ?? "",
    latitud: turno.latitude !== null ? String(turno.latitude) : "",
    longitud: turno.longitude !== null ? String(turno.longitude) : "",
    notasPreparacion: turno.preparation_notes ?? "",
    doctorId: turno.doctor_id ?? "",
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <Link
        href="/turnos"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a turnos
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 chica:gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Editar turno</h1>
          <p className="text-base text-muted-foreground">{turno.specialty}</p>
        </div>
        <BadgeEstadoTurno estado={turno.status} />
      </div>

      <Tarjeta className="gap-3 px-(--card-spacing) chica:gap-2">
        <h2 className="text-base font-semibold text-foreground">Estado del turno</h2>
        <AccionesEstadoTurno turnoId={turno.id} estado={turno.status} />
      </Tarjeta>

      <FormularioTurno
        modo="editar"
        turnoId={turno.id}
        valoresIniciales={valoresIniciales}
        medicos={medicos ?? []}
      />
    </div>
  )
}
