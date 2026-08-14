"use client"

/**
 * "Dados de baja": la sección histórica de `/medicos` arranca COLAPSADA,
 * mismo criterio y mismo disclosure simple que
 * `components/medicacion/seccion-suspendidas.tsx` -la atención de la
 * pantalla va al directorio activo, no al histórico-. Se duplica en vez de
 * importarse cross-dominio: cada sección de la app (`turnos`, `medicacion`,
 * `medicos`) es dueña de sus propios componentes de UI, mismo criterio que el
 * resto de `components/<dominio>/`.
 */

import * as React from "react"

import { ChevronDownIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { cn } from "@/lib/utils"

export function SeccionBajaMedicos({
  cantidad,
  children,
}: {
  cantidad: number
  children: React.ReactNode
}) {
  const [abierto, setAbierto] = React.useState(false)
  const idContenido = "medicos-baja-contenido"

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
        <span>Dados de baja ({cantidad})</span>
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
