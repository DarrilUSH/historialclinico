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
    <Tarjeta className="gap-4 px-(--card-spacing) chica:gap-3">
      {/* Sprint 14 (tanda B): en chica el encabezado (proveedor+badge/
          plan·afiliado) y las miniaturas de la credencial pasan a compartir
          UNA fila -miniaturas a la derecha, criterio del encargo-, en vez de
          quedar apiladas como en grande. El wrapper repite el `gap-4` que
          esos dos bloques ya tenían como hijos directos de la `Tarjeta`
          (arriba), así que en GRANDE el resultado es pixel a pixel el mismo
          -flex-col con el mismo gap-, ni un cambio real de layout: docs/
          densidad.md §4 regla 1. */}
      <div className="flex flex-col gap-4 chica:flex-row chica:items-start chica:justify-between chica:gap-2">
        <div className="flex items-start justify-between gap-3 chica:min-w-0 chica:flex-1 chica:gap-2">
          <div className="flex items-start gap-3 chica:min-w-0 chica:gap-2">
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary chica:size-9"
              aria-hidden="true"
            >
              <CreditCardIcon className="size-5 chica:size-4" />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              {/* h2 y no h3 (Sprint 11, auditoría a11y): entre el h1 de
                  `/coberturas` y estas tarjetas no hay ninguna sección
                  intermedia -el único h2 de la pantalla vivía en el estado
                  vacío, que por definición nunca coexiste con la lista-, así que
                  un h3 acá saltaba un nivel (WCAG 1.3.1). El tamaño lo sigue
                  fijando `text-lg`: no cambia nada visualmente. */}
              <h2 className="min-w-0 text-lg font-semibold text-balance text-foreground">
                {cobertura.provider}
              </h2>
              {/* Plan + N.º de afiliado: DOS líneas en grande. Chica (Sprint
                  13, tarea 13.5) las combina en UNA -mismo patrón que
                  `tarjeta-medicacion.tsx` (Tanda 3)-: la versión larga se
                  oculta con `chica:hidden`, la combinada con `hidden
                  chica:block`, así que cada dato aparece una sola vez por
                  modo. */}
              {cobertura.plan && (
                <p className="text-sm text-muted-foreground chica:hidden">{cobertura.plan}</p>
              )}
              {cobertura.member_number && (
                <p className="text-sm text-muted-foreground numeros-clinicos chica:hidden">
                  Afiliado {cobertura.member_number}
                </p>
              )}
              {(cobertura.plan || cobertura.member_number) && (
                <p className="hidden text-sm text-muted-foreground numeros-clinicos chica:block">
                  {[cobertura.plan, cobertura.member_number ? `Afiliado ${cobertura.member_number}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
          </div>

          {cobertura.is_primary && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground chica:px-2 chica:py-0.5">
              <StarIcon className="size-3.5 chica:size-3" aria-hidden="true" />
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
      </div>

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
