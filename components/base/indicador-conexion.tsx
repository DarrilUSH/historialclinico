/**
 * Indicador global de conexión: barra visible cuando el dispositivo está
 * offline (Sprint 8, tarea 8.5).
 *
 * ## Accesibilidad
 *
 * `role="status"` + `aria-live="polite"` para que lectores de pantalla anuncien
 * la desconexión sin sobresaltos. El cambio es polite (no assertive) porque no
 * interrumpe lo que la persona está leyendo, y el cambio es inevitable (un
 * evento del navegador, no un error de la app).
 *
 * ## Estilos
 *
 * Barra fina bajo el header, con el color de advertencia del sistema de diseño
 * (`--advertencia`). Sin sombra ni efecto: es una barra de estado, no un
 * componente decorativo.
 */

"use client"

import { useEstadoConexion } from "@/hooks/use-estado-conexion"

export function IndicadorConexion() {
  const online = useEstadoConexion()

  if (online) {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-[var(--advertencia)] px-4 py-2 text-center text-sm font-medium text-[var(--advertencia-foreground)]"
    >
      Sin conexión — estás viendo datos guardados
    </div>
  )
}
