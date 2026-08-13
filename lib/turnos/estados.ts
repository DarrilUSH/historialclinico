/**
 * Metadata de presentación por `appointment_status`: ícono, etiqueta en
 * español y color (Sprint 6, tarea 6.1). Mismo patrón que
 * `lib/estudios/categorias.ts#INFO_CATEGORIA` -el color nunca es la única
 * señal (docs/design-system.md §8, regla 2), así que cada estado además
 * cambia de ícono, y `BadgeEstadoTurno` siempre pinta ícono + texto juntos-.
 *
 * Colores: reutiliza los tokens semánticos ya verificados por
 * `scripts/verificar-contraste.mjs` (`--exito`, `--advertencia`,
 * `--destructive`, `components/base/alerta.tsx`) en vez de inventar cuatro
 * pares nuevos. `completed` no tiene un token semántico propio -no es ni
 * éxito ni error, es simplemente "ya pasó"- así que usa `--primary`, el color
 * de marca del proyecto, con el mismo criterio neutro-positivo que le da
 * `boton.tsx` por defecto.
 */

import {
  CalendarClockIcon,
  CheckCheckIcon,
  CircleCheckIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react"

import type { EstadoTurno } from "@/types/dominio"

export interface InfoEstadoTurno {
  etiqueta: string
  Icono: LucideIcon
  /** Color del ícono y el texto del badge, ej. `"text-exito-fuerte"`. */
  claseTexto: string
  /** Fondo suave del badge, ej. `"bg-exito-suave"`. */
  claseFondo: string
}

/** Orden estable para selects/leyendas, de "recién cargado" a "cerrado". */
export const ESTADOS_TURNO_EN_ORDEN: readonly EstadoTurno[] = [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
]

export const INFO_ESTADO_TURNO: Record<EstadoTurno, InfoEstadoTurno> = {
  pending: {
    etiqueta: "Pendiente",
    Icono: CalendarClockIcon,
    claseTexto: "text-advertencia-fuerte",
    claseFondo: "bg-advertencia-suave",
  },
  confirmed: {
    etiqueta: "Confirmado",
    Icono: CircleCheckIcon,
    claseTexto: "text-exito-fuerte",
    claseFondo: "bg-exito-suave",
  },
  completed: {
    etiqueta: "Completado",
    Icono: CheckCheckIcon,
    claseTexto: "text-primary",
    claseFondo: "bg-primary/10",
  },
  cancelled: {
    etiqueta: "Cancelado",
    Icono: XCircleIcon,
    claseTexto: "text-destructive",
    claseFondo: "bg-destructive/10",
  },
}
