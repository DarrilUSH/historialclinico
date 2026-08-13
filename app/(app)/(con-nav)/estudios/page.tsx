/**
 * Estudios: stub digno para que la bottom nav (Sprint 3) no lleve a un 404.
 * La pantalla real -galería cronológica, filtros, visor de documentos y
 * gráficos de tendencias- es del Sprint 4 y 5 (ROADMAP_SPRINTS.md).
 *
 * Mismo patrón que `/inicio` y `/familia`: revalida `obtenerPerfilActivo()`
 * y redirige si no hay perfil activo válido, aunque el layout ya lo hizo
 * (memoizado con `cache()`, sin costo extra de red) -esta página tiene que
 * ser correcta sola, no solo "dentro del árbol correcto".
 */

import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { FlaskConicalIcon } from "lucide-react"

import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Estudios — Historial Médico",
}

export default async function PaginaEstudios() {
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
        <FlaskConicalIcon className="size-8" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">
        Disponible próximamente
      </h1>
      <p className="max-w-sm text-base text-muted-foreground">
        Acá vas a poder ver tus análisis y estudios médicos con sus resultados, y un gráfico de
        cómo van cambiando en el tiempo.
      </p>
    </div>
  )
}
