/**
 * Tarjeta de una cobertura en la billetera de `/coberturas` (Sprint 8, tarea
 * 8.1): proveedor + plan + número de afiliado, badge "Principal", las dos
 * miniaturas de la credencial -que abren el visor a pantalla completa al
 * tocarlas, ver `visor-credencial-lanzador.tsx`- y las acciones si
 * `puedeEditar`. Server Component puro: la interactividad vive en los dos
 * componentes cliente que envuelve.
 */

import { CreditCardIcon, StarIcon } from "lucide-react"

import { Tarjeta } from "@/components/base/tarjeta"
import { AccionesCobertura } from "@/components/coberturas/acciones-cobertura"
import { VisorCredencialLanzador } from "@/components/coberturas/visor-credencial-lanzador"

export interface FilaCobertura {
  id: string
  provider: string
  plan: string | null
  member_number: string | null
  is_primary: boolean
  front_storage_path: string | null
  back_storage_path: string | null
}

export function TarjetaCobertura({
  cobertura,
  puedeEditar,
}: {
  cobertura: FilaCobertura
  puedeEditar: boolean
}) {
  return (
    <Tarjeta className="gap-4 px-(--card-spacing)">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <CreditCardIcon className="size-5" />
          </span>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-lg font-semibold text-balance text-foreground">
              {cobertura.provider}
            </h3>
            {cobertura.plan && <p className="text-sm text-muted-foreground">{cobertura.plan}</p>}
            {cobertura.member_number && (
              <p className="text-sm text-muted-foreground numeros-clinicos">
                Afiliado {cobertura.member_number}
              </p>
            )}
          </div>
        </div>

        {cobertura.is_primary && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
            <StarIcon className="size-3.5" aria-hidden="true" />
            Principal
          </span>
        )}
      </div>

      <VisorCredencialLanzador
        coberturaId={cobertura.id}
        proveedor={cobertura.provider}
        tieneFrente={!!cobertura.front_storage_path}
        tieneDorso={!!cobertura.back_storage_path}
      />

      {puedeEditar && (
        <AccionesCobertura
          coberturaId={cobertura.id}
          proveedor={cobertura.provider}
          esPrincipal={cobertura.is_primary}
        />
      )}
    </Tarjeta>
  )
}
