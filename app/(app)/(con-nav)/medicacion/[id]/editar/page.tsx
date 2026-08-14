/**
 * `/medicacion/[id]/editar`: edición de una medicación ya cargada (Sprint 7,
 * tarea 7.2). Exige `can_manage`
 * (`medications_update_administrador` — "suspender una medicación o editar
 * una dosis es administración", `docs/modelo-permisos.md`). Un `can_view` o
 * `can_upload` que fuerce esta URL se redirige a `/medicacion` sin ver el
 * formulario — mismo criterio de "guarda de UI, no LA guarda" que
 * `turnos/[id]/editar/page.tsx`: RLS sigue siendo la última palabra.
 *
 * Trae la fila de `medications` directo (no de `v_medicacion_estado`): una
 * medicación suspendida también se edita desde acá -reactivarla no hace
 * falta para corregir, por ejemplo, la dosis-, y la vista no la incluiría.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { FormularioMedicacion, type ValoresMedicacion } from "@/components/medicacion/formulario-medicacion"
import { SelectorReceta } from "@/components/medicacion/selector-receta"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Editar medicación — Historial Médico",
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaEditarMedicacion({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canManage) {
    redirect("/medicacion")
  }

  const { id } = await params

  if (!PATRON_UUID.test(id)) {
    redirect("/medicacion")
  }

  const { supabase } = await requerirSesion({ desde: "/medicacion" })

  const { data: medicacion } = await supabase
    .from("medications")
    .select(
      "id, name, active_ingredient, presentation, dose_amount, dose_unit, frequency, schedule_times, interval_hours, start_date, end_date, stock_units, notes, prescription_document_id",
    )
    .eq("id", id)
    .eq("profile_id", activo.perfil.id)
    .maybeSingle()

  if (!medicacion) {
    redirect("/medicacion")
  }

  // Traer recetas disponibles (documentos confirmados categoría prescription)
  const { data: recetasDisponibles } = await supabase
    .from("documents")
    .select("id, title")
    .eq("profile_id", activo.perfil.id)
    .eq("category", "prescription")
    .not("confirmed_at", "is", null)
    .order("document_date", { ascending: false })

  // Traer el documento asociado si existe, para mostrar su título
  let recetaActual: { id: string; title: string } | null = null
  if (medicacion.prescription_document_id) {
    const { data: doc } = await supabase
      .from("documents")
      .select("id, title")
      .eq("id", medicacion.prescription_document_id)
      .maybeSingle()
    recetaActual = doc
  }

  const valoresIniciales: Partial<ValoresMedicacion> = {
    nombre: medicacion.name,
    droga: medicacion.active_ingredient ?? "",
    presentacion: medicacion.presentation ?? "",
    dosisCantidad: String(medicacion.dose_amount),
    dosisUnidad: medicacion.dose_unit,
    frecuencia: medicacion.frequency,
    horarios: (medicacion.schedule_times ?? []).map((hora) => hora.slice(0, 5)),
    intervaloHoras: medicacion.interval_hours !== null ? String(medicacion.interval_hours) : "",
    fechaInicio: medicacion.start_date,
    fechaFin: medicacion.end_date ?? "",
    stock: medicacion.stock_units !== null ? String(medicacion.stock_units) : "",
    notas: medicacion.notes ?? "",
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <Link
        href="/medicacion"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a medicación
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Editar medicación</h1>
        <p className="text-base text-muted-foreground">{medicacion.name}</p>
      </div>

      <FormularioMedicacion modo="editar" medicacionId={medicacion.id} valoresIniciales={valoresIniciales} />

      <SelectorReceta
        medicacionId={medicacion.id}
        recetaActualId={recetaActual?.id ?? null}
        recetaActualTitulo={recetaActual?.title ?? null}
        recetasDisponibles={recetasDisponibles ?? []}
      />
    </div>
  )
}
