/**
 * `/ficha/historial` — lista de todas las fichas generadas del perfil activo,
 * ordenadas de más reciente a más vieja (Sprint 10, tarea 10.5).
 *
 * Cada fila muestra:
 *   · La fecha de generación (formateada).
 *   · Quién la generó ("vos" si el actor actual, o el nombre de la persona).
 *   · Botón para abrir el detalle.
 *
 * Si no hay fichas, explica qué son y dónde generarlas.
 */

import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { createClient } from "@/lib/supabase/server"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"


export const metadata = {
  title: "Historial de fichas — Historial Médico",
}

function formatearFecha(fecha: string): string {
  const d = new Date(fecha)
  return d.toLocaleDateString("es-AR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default async function PaginaHistorialFichas() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const perfilId = activo.perfil.id
  const actorId = activo.perfil.id // El usuario siempre ve su propio historial

  const supabase = await createClient()

  // Leer fichas del perfil actual, ordenadas por fecha descendente.
  const { data: fichas, error } = await supabase
    .from("consultation_sheets")
    .select(
      `
      id,
      created_at,
      generated_by_profile_id,
      generated_by:generated_by_profile_id (
        id,
        full_name
      )
    `,
    )
    .eq("profile_id", perfilId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[historial] Error al leer fichas:", error)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <div className="flex items-center gap-3">
          <Boton
            render={<Link href="/ficha" aria-label="Volver a la ficha" />}
            nativeButton={false}
            variant="ghost"
            size="icon"
          >
            <ArrowLeftIcon aria-hidden="true" />
          </Boton>
          <h1 className="text-2xl font-semibold tracking-tight">Historial de fichas</h1>
        </div>
        <p className="text-base text-destructive">No pudimos cargar el historial. Probá de nuevo más tarde.</p>
      </div>
    )
  }

  const filasSin = fichas ?? []

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:px-3 chica:py-4">
      <div className="flex items-center gap-3 chica:gap-2">
        <Boton
          render={<Link href="/ficha" aria-label="Volver a la ficha" />}
          nativeButton={false}
          variant="ghost"
          size="icon"
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Boton>
        <h1 className="text-2xl font-semibold tracking-tight">Historial de fichas</h1>
      </div>

      {filasSin.length === 0 ? (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 chica:gap-3 chica:p-4">
          <p className="text-base text-muted-foreground">
            Todavía no generaste ninguna ficha. Generá una para llevar a tus consultas médicas.
          </p>
          <Boton render={<Link href="/ficha" />} nativeButton={false}>
            Generar ficha
          </Boton>
        </div>
      ) : (
        <div className="flex flex-col gap-2 chica:gap-1.5">
          {filasSin.map((fila) => {
            // Quién generó la ficha: "vos" si es el actor actual, o el nombre.
            const generadoPor =
              fila.generated_by_profile_id === actorId
                ? "vos"
                : fila.generated_by?.full_name || "sin registrar"

            return (
              <Link
                key={fila.id}
                href={`/ficha/historial/${fila.id}`}
                className="group flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent chica:gap-3 chica:p-3"
              >
                {/* Fecha + quién: DOS líneas en grande. Chica (Sprint 13,
                    tarea 13.6) las combina en UNA con " · " -mismo patrón que
                    `components/medicos/tarjeta-medico.tsx` (Tanda 4): las
                    líneas separadas se ocultan con `chica:hidden`, la
                    combinada aparece con `hidden chica:block`. */}
                <div className="flex flex-1 flex-col gap-1 chica:gap-0.5">
                  <p className="text-sm font-medium text-muted-foreground chica:hidden">
                    {formatearFecha(fila.created_at)}
                  </p>
                  <p className="text-sm text-muted-foreground chica:hidden">Generada por {generadoPor}</p>
                  <p className="hidden text-sm text-muted-foreground chica:block">
                    <span className="font-medium">{formatearFecha(fila.created_at)}</span>
                    {" · Generada por "}
                    {generadoPor}
                  </p>
                </div>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="h-5 w-5 chica:shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
