/**
 * Home provisional. El shell real (bottom nav, header con cambio de perfil,
 * tema Senior UX) llega en el Sprint 3 -acá solo existe para poder cerrar el
 * flujo login → selector → perfil activo de punta a punta.
 *
 * Toda la pantalla depende de `obtenerPerfilActivo()`, que revalida el
 * permiso contra la base en cada request (docs/modelo-permisos.md §1.6): si
 * la cookie falta, es inválida o el permiso se perdió, devuelve `null` y acá
 * se redirige al selector. Esta página no repite esa verificación ni confía
 * en la cookie por su cuenta.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftRightIcon } from "lucide-react"

import { obtenerPerfilActivo, type PermisosPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Inicio — Historial Médico",
}

export default async function PaginaInicio() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { perfil, permisos } = activo

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-8 px-4 py-12 text-center">
      <div className="flex flex-col items-center gap-2">
        <p className="text-lg text-muted-foreground">Estás viendo el historial de</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {perfil.full_name}
        </h1>
        <p className="text-base text-muted-foreground">{descripcionRelacion(permisos)}</p>
      </div>

      <Link
        href="/perfiles"
        className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-4 text-base font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeftRightIcon className="size-4" aria-hidden="true" />
        Cambiar de perfil
      </Link>
    </main>
  )
}

function descripcionRelacion(permisos: PermisosPerfilActivo): string {
  if (permisos.esPropio) {
    return "Este es tu perfil."
  }
  if (permisos.canManage) {
    return "Lo administrás vos: podés cargar y editar sus datos."
  }
  if (permisos.canUpload) {
    return "Podés cargar datos en este perfil."
  }
  return "Tenés acceso de solo lectura a este perfil."
}
