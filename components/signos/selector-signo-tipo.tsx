"use client"

/**
 * Chips de selección de signo en `/signos/historial` (Sprint 9, tarea 9.4):
 * los tres botones grandes -Tensión/Glucemia/Peso, con su ícono- que deciden
 * qué serie se grafica.
 *
 * Mismo patrón visual y de accesibilidad que
 * `components/estudios/selector-metrica.tsx` (Sprint 5, tarea 5.4): fila
 * `role="group"` con chips `aria-pressed`, altura táctil mínima, forma +
 * color -acá el ícono cumple el rol que el punto de color cumple en
 * laboratorio, porque acá los "tres" son siempre los mismos tres, no una
 * lista dinámica de métricas-. Estado 100% local, no en la URL, por el mismo
 * motivo que documenta `selector-metrica.tsx`: las tres series ya llegaron
 * resueltas del servidor, cambiar de chip no necesita una consulta nueva.
 */

import { DropletIcon, HeartPulseIcon, WeightIcon } from "lucide-react"

import { ETIQUETA_TIPO, TIPOS_SIGNO, type SignoTipo } from "@/lib/signos/tipos"
import { cn } from "@/lib/utils"

const ICONO_TIPO: Record<SignoTipo, typeof HeartPulseIcon> = {
  tension: HeartPulseIcon,
  glucemia: DropletIcon,
  peso: WeightIcon,
}

export interface SelectorSignoTipoProps {
  tipoSeleccionado: SignoTipo
  onSeleccionar: (tipo: SignoTipo) => void
  /** Qué tipos tienen al menos una medición cargada -mismo criterio que `metrica.fueraDeRango` de laboratorio, pero acá para avisar "sin datos" en vez de "fuera de rango"-. */
  tiposConDatos: ReadonlySet<SignoTipo>
}

export function SelectorSignoTipo({ tipoSeleccionado, onSeleccionar, tiposConDatos }: SelectorSignoTipoProps) {
  return (
    <div role="group" aria-label="Elegir signo vital" className="grid grid-cols-3 gap-2 chica:gap-1.5">
      {TIPOS_SIGNO.map((tipo) => {
        const seleccionado = tipo === tipoSeleccionado
        const Icono = ICONO_TIPO[tipo]
        const tieneDatos = tiposConDatos.has(tipo)
        return (
          <button
            key={tipo}
            type="button"
            aria-pressed={seleccionado}
            aria-label={tieneDatos ? undefined : `${ETIQUETA_TIPO[tipo]}, sin mediciones cargadas`}
            onClick={() => onSeleccionar(tipo)}
            className={cn(
              "flex min-h-tactil flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-center text-sm font-medium transition-colors chica:gap-0.5 chica:py-2 chica:text-xs",
              seleccionado
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted",
              !tieneDatos && !seleccionado && "opacity-60",
            )}
          >
            <Icono className="size-5 shrink-0 chica:size-4" aria-hidden="true" />
            {ETIQUETA_TIPO[tipo]}
          </button>
        )
      })}
    </div>
  )
}
