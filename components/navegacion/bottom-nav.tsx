"use client"

/**
 * Bottom nav fija de 4 accesos: Inicio/SOS, Estudios, Turnos y Perfil/Familia.
 * Vive en el shell de `app/(app)/(con-nav)/layout.tsx` -nunca en `/perfiles`,
 * que está fuera de ese route group porque ahí todavía no hay un perfil
 * activo elegido (ver el comentario de cabecera del layout).
 *
 * Reglas Senior UX de esta pantalla (ROADMAP_SPRINTS.md, Sprint 3):
 * - Ícono grande (≥28px) CON etiqueta de texto siempre visible debajo: nunca
 *   ícono solo. El texto es la señal principal para alguien que no reconoce
 *   pictogramas de un vistazo.
 * - Estado activo por DOS señales, nunca una sola: color (`text-primary`) Y
 *   forma (la barra superior). Alguien con daltonismo tiene que poder ver
 *   cuál pestaña está activa igual.
 * - Cada botón mide ≥48×48px reales: `objetivo-tactil` fija el piso aunque
 *   el layout reparta menos espacio en una pantalla angosta.
 * - `aria-current="page"` en el activo, para lectores de pantalla.
 *
 * `usePathname` (Client Component) decide el activo por prefijo, no por
 * igualdad exacta: `/familia/accesos` tiene que dejar "Familia" marcada,
 * y ninguna de las cuatro rutas es prefijo de otra en esta lista, así que no
 * hay ambigüedad entre pestañas.
 */

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  CalendarDaysIcon,
  FlaskConicalIcon,
  HomeIcon,
  type LucideIcon,
  UsersIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

interface AccesoNav {
  href: string
  etiqueta: string
  Icono: LucideIcon
}

const ACCESOS: AccesoNav[] = [
  { href: "/inicio", etiqueta: "Inicio", Icono: HomeIcon },
  { href: "/estudios", etiqueta: "Estudios", Icono: FlaskConicalIcon },
  { href: "/turnos", etiqueta: "Turnos", Icono: CalendarDaysIcon },
  { href: "/familia", etiqueta: "Familia", Icono: UsersIcon },
]

/** ¿`pathname` es `href` o una subruta suya (p. ej. `/familia/accesos`)? */
function esAccesoActivo(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card shadow-elevada"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex h-bottom-nav max-w-2xl items-stretch">
        {ACCESOS.map(({ href, etiqueta, Icono }) => {
          const activo = esAccesoActivo(pathname, href)

          return (
            <li key={href} className="flex flex-1">
              <Link
                href={href}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "objetivo-tactil relative flex flex-1 flex-col items-center justify-center gap-1 px-1 text-xs font-medium transition-colors duration-150 ease-salida",
                  "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
                  activo
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {/* Indicador de forma del estado activo: una barra superior,
                    no solo un cambio de color. `aria-hidden` porque
                    `aria-current="page"` en el <Link> ya lo anuncia. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-[22%] top-0 h-1 rounded-full bg-primary transition-opacity duration-150 ease-salida",
                    activo ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icono className="size-7 shrink-0" aria-hidden="true" />
                <span>{etiqueta}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
