/**
 * Badge de `appointment_status`: ícono + texto + color (Sprint 6, tarea 6.1).
 * El color nunca es la única señal (docs/design-system.md §8) -por eso el
 * ícono cambia con cada estado, ver `lib/turnos/estados.ts`-. Server
 * Component puro, sin estado ni efectos.
 */

import { INFO_ESTADO_TURNO } from "@/lib/turnos/estados"
import { cn } from "@/lib/utils"
import type { EstadoTurno } from "@/types/dominio"

export function BadgeEstadoTurno({
  estado,
  className,
}: {
  estado: EstadoTurno
  className?: string
}) {
  const info = INFO_ESTADO_TURNO[estado]
  const Icono = info.Icono

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
        info.claseFondo,
        info.claseTexto,
        className,
      )}
    >
      <Icono className="size-4 shrink-0" aria-hidden="true" />
      {info.etiqueta}
    </span>
  )
}
