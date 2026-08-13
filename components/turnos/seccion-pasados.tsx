"use client"

/**
 * "Ver anteriores": la sección "Pasados" de `/turnos` arranca COLAPSADA
 * (criterio de aceptación del roadmap, Sprint 6 tarea 6.1), para que la
 * pantalla abra con la atención puesta en lo que falta, no en el historial.
 *
 * Disclosure simple con `useState` + `aria-expanded` -no hace falta el focus
 * trap ni el overlay de `components/ui/dialog.tsx`, esto no es un modal, es
 * un mostrar/ocultar en el flujo normal de la página-. Los turnos pasados
 * (`TarjetaTurno[]`) se renderizan en el SERVIDOR (`/turnos/page.tsx`, un
 * Server Component) y llegan acá como `children` ya resueltos: este
 * componente es "use client" solo por el estado de abierto/cerrado, no
 * porque necesite volver a pedir datos.
 */

import * as React from "react"

import { ChevronDownIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { cn } from "@/lib/utils"

export interface SeccionPasadosProps {
  cantidad: number
  children: React.ReactNode
}

export function SeccionPasados({ cantidad, children }: SeccionPasadosProps) {
  const [abierto, setAbierto] = React.useState(false)
  const idContenido = "turnos-pasados-contenido"

  return (
    <div className="flex flex-col gap-3">
      <Boton
        type="button"
        variant="outline"
        size="lg"
        onClick={() => setAbierto((valor) => !valor)}
        aria-expanded={abierto}
        aria-controls={idContenido}
        className="w-full justify-between"
      >
        <span>Ver anteriores ({cantidad})</span>
        <ChevronDownIcon
          className={cn("size-5 shrink-0 transition-transform", abierto && "rotate-180")}
          aria-hidden="true"
        />
      </Boton>

      {abierto && (
        <div id={idContenido} className="flex flex-col gap-3">
          {children}
        </div>
      )}
    </div>
  )
}
