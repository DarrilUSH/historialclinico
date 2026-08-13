/**
 * Turnos: stub digno para que la bottom nav (Sprint 3) no lleve a un 404.
 * La pantalla real -alta y edición de turnos, recordatorios push y accesos
 * de logística (Maps, viaje, calendario)- es del Sprint 6 (ROADMAP_SPRINTS.md).
 *
 * Mismo patrón que `/inicio`, `/familia` y `/estudios`: revalida
 * `obtenerPerfilActivo()` y redirige si no hay perfil activo válido, aunque
 * el layout ya lo hizo (memoizado con `cache()`, sin costo extra de red).
 */

import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { CalendarDaysIcon } from "lucide-react"

import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Turnos — Historial Médico",
}

export default async function PaginaTurnos() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <span
        className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <CalendarDaysIcon className="size-8" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">
        Disponible próximamente
      </h1>
      <p className="max-w-sm text-base text-muted-foreground">
        Acá vas a poder cargar tus turnos médicos, con recordatorios y accesos directos para
        llegar o pedir un viaje.
      </p>
    </div>
  )
}
