/**
 * Header mínimo del shell (Sprint 3): quién es el perfil activo y un acceso
 * directo para cambiarlo. Vive arriba de cada pantalla bajo
 * `app/(app)/(con-nav)/`, servido por el layout de ese route group -nunca
 * en `/perfiles`, que es justamente donde se elige el perfil activo-.
 *
 * Server Component puro: no necesita estado ni efectos, así que no paga el
 * costo de un Client Component solo para mostrar un nombre y un enlace.
 *
 * Sticky pero sobrio a propósito (ROADMAP_SPRINTS.md): fondo sólido de la
 * app, sin blur ni translucidez -esta app no hace glassmorphism en ningún
 * lado (docs/design-system.md §5)-, un único hairline (`border-borde-sutil`)
 * como límite inferior.
 */

import Link from "next/link"

import { ArrowLeftRightIcon } from "lucide-react"

import { colorAvatarPara, inicialesDe } from "@/lib/perfiles/avatar"
import { cn } from "@/lib/utils"
import type { Perfil } from "@/types/dominio"

interface EncabezadoPerfilProps {
  perfil: Perfil
  /** `permisos.esPropio` del perfil activo: decide "Tu historial" vs "Viendo a {nombre}". */
  esPropio: boolean
}

export function EncabezadoPerfil({ perfil, esPropio }: EncabezadoPerfilProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-borde-sutil bg-background">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-2.5">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-avatar-foreground",
            colorAvatarPara(perfil.id),
          )}
          aria-hidden="true"
        >
          {inicialesDe(perfil.full_name)}
        </span>

        <p className="min-w-0 flex-1 truncate text-base font-medium text-foreground">
          {esPropio ? "Tu historial" : `Viendo a ${perfil.full_name}`}
        </p>

        <Link
          href="/perfiles"
          className="objetivo-tactil inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary transition-colors duration-150 ease-salida hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeftRightIcon className="size-4" aria-hidden="true" />
          Cambiar
        </Link>
      </div>
    </header>
  )
}
