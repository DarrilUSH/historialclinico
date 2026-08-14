"use client"

/**
 * Puente entre las miniaturas de una cobertura y el visor a pantalla
 * completa (`visor-credencial.tsx`): mantiene el estado de "qué lado está
 * abierto" (o ninguno) y monta el visor solo cuando hace falta. Es lo que le
 * permite a `tarjeta-cobertura.tsx` (Server Component) seguir siendo un
 * árbol mayormente estático, con la interactividad acotada a este único
 * componente cliente.
 */

import * as React from "react"

import { ImageOffIcon } from "lucide-react"

import { MiniaturaCredencial } from "@/components/coberturas/miniatura-credencial"
import { VisorCredencial } from "@/components/coberturas/visor-credencial"

export function VisorCredencialLanzador({
  coberturaId,
  proveedor,
  tieneFrente,
  tieneDorso,
}: {
  coberturaId: string
  proveedor: string
  tieneFrente: boolean
  tieneDorso: boolean
}) {
  const [abierto, setAbierto] = React.useState<"front" | "back" | null>(null)

  if (!tieneFrente && !tieneDorso) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ImageOffIcon className="size-4 shrink-0" aria-hidden="true" />
        Todavía no cargaste fotos de la credencial.
      </p>
    )
  }

  return (
    <>
      <div className="flex gap-3 chica:gap-2">
        {tieneFrente && (
          <button
            type="button"
            onClick={() => setAbierto("front")}
            aria-label={`Ver el frente de la credencial de ${proveedor}`}
            className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <MiniaturaCredencial coberturaId={coberturaId} lado="front" alt="Frente de la credencial" />
          </button>
        )}
        {tieneDorso && (
          <button
            type="button"
            onClick={() => setAbierto("back")}
            aria-label={`Ver el dorso de la credencial de ${proveedor}`}
            className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <MiniaturaCredencial coberturaId={coberturaId} lado="back" alt="Dorso de la credencial" />
          </button>
        )}
      </div>

      {abierto && (
        <VisorCredencial
          coberturaId={coberturaId}
          proveedor={proveedor}
          ladoInicial={abierto}
          tieneFrente={tieneFrente}
          tieneDorso={tieneDorso}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </>
  )
}
