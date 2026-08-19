/**
 * Lista de resultados de laboratorio CUALITATIVOS ("Negativo", "No
 * reactivo", "No se observan espermatozoides") en `/estudios/tendencias`
 * (Sprint 18, tarea de resultados cualitativos).
 *
 * Un resultado cualitativo no tiene curva posible -no hay "evolución" de
 * "Negativo"-, así que no entra en `PanelTendencias`/`GraficoMetrica`
 * (pensados para series NUMÉRICAS): esta es la "marca sin curva" que pide el
 * roadmap del sprint, una lista plana ordenada de más reciente a más
 * antiguo -mismo orden que ya trae `obtenerResultadosCualitativos`-, con el
 * mismo patrón de fila-con-link-al-estudio que
 * `components/estudios/dialogo-detalle-metrica.tsx` usa para sus
 * mediciones numéricas (fecha + valor, toda la fila es un `<Link>` cuando
 * hay `documentoId`).
 *
 * Server Component puro -recibe `resultados` ya resueltos como prop desde
 * `app/(app)/(con-nav)/estudios/tendencias/page.tsx`, no toca Supabase-.
 */

import Link from "next/link"

import { Tarjeta } from "@/components/base/tarjeta"
import type { ResultadoCualitativo } from "@/lib/laboratorio/series"
import { cn } from "@/lib/utils"

export interface ListaResultadosCualitativosProps {
  resultados: readonly ResultadoCualitativo[]
}

const FORMATO_FECHA_LARGA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
})

/** `measurement_date` es un `date` puro de Postgres: se formatea en UTC a propósito, mismo motivo que `dialogo-detalle-metrica.tsx`. */
function formatearFechaLarga(iso: string): string {
  return FORMATO_FECHA_LARGA.format(new Date(`${iso}T00:00:00Z`))
}

const CLASE_FILA =
  "flex min-h-tactil flex-col justify-center gap-0.5 border-b border-border py-2.5 last:border-0 chica:py-2"

export function ListaResultadosCualitativos({ resultados }: ListaResultadosCualitativosProps) {
  if (resultados.length === 0) return null

  return (
    <Tarjeta className="gap-3 px-(--card-spacing)">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold text-foreground">Resultados cualitativos</h2>
        <p className="text-sm text-muted-foreground">
          Resultados sin un número asociado (negativo/positivo, reactivo/no reactivo), sin gráfico
          de evolución.
        </p>
      </div>

      <ul className="-mx-1 flex flex-col px-1">
        {resultados.map((resultado, indice) => (
          <FilaResultadoCualitativo
            key={`${resultado.documentoId ?? "sin-documento"}-${resultado.fecha}-${indice}`}
            resultado={resultado}
          />
        ))}
      </ul>
    </Tarjeta>
  )
}

function FilaResultadoCualitativo({ resultado }: { resultado: ResultadoCualitativo }) {
  const contenido = (
    <>
      <span className="text-sm font-medium text-muted-foreground">
        {formatearFechaLarga(resultado.fecha)}
      </span>
      <span className="text-base font-semibold text-foreground">
        {resultado.etiqueta}: <span className="font-normal">{resultado.valorTexto}</span>
      </span>
    </>
  )

  if (resultado.documentoId) {
    return (
      <li>
        <Link
          href={`/estudios/${resultado.documentoId}`}
          className={cn(
            CLASE_FILA,
            "rounded-lg px-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          {contenido}
          <span className="sr-only"> — ver el estudio de origen</span>
        </Link>
      </li>
    )
  }

  return <li className={cn(CLASE_FILA, "px-1")}>{contenido}</li>
}
