"use client"

/**
 * Diálogo de detalle de UNA métrica de laboratorio en `/estudios/tendencias`
 * (pedido en vivo del usuario, 2026-08-19, mientras probaba la pantalla con
 * su historial real: "Estaría bueno que si toco en la tarjeta me aparezcan
 * todas las mediciones de esa tarjeta con fecha y valor"). Antes, tocar la
 * tarjeta de "último valor" solo cambiaba la métrica graficada más abajo
 * -para ver el resto de la serie en números había que abrir "Ver como
 * tabla" dentro del gráfico, y solo alcanzaba a la métrica que estuviera
 * seleccionada ahí en ese momento-.
 *
 * Envuelve `components/ui/dialog.tsx` (Base UI: foco atrapado, Escape,
 * click afuera, todo ya resuelto ahí), mismo patrón que
 * `components/base/dialogo-confirmacion.tsx` y
 * `components/gmail/detalle-correo.tsx`: `DialogTrigger` con `render`
 * apunta directo a `TarjetaUltimoValor` -la tarjeta ENTERA pasa a ser el
 * disparador (Base UI clona el elemento e inyecta su propio `onClick` en
 * tiempo de ejecución; `TarjetaUltimoValor` ya difunde cualquier prop extra
 * sobre `TarjetaInteractiva`, así que el `aria-label` de acá viaja igual
 * que el resto)-, con un nombre accesible propio que nombra la métrica
 * (WCAG 2.5.3, mismo criterio que `detalle-correo.tsx` documenta para el
 * asunto del correo).
 *
 * La lista muestra TODAS las mediciones de la serie EN EL PERÍODO elegido
 * -`serie` ya llega recortada por `obtenerSeries`, no hace falta filtrar
 * de nuevo acá-, de la más reciente a la más vieja, marcando fuera de rango
 * con el MISMO criterio visual que `tarjeta-ultimo-valor.tsx` -ícono +
 * color + texto, nunca color solo (`docs/design-system.md` §8, regla 2)-,
 * y cada fila con documento asociado (`lab_metrics.document_id`) es un
 * `<Link>` real al estudio de origen -mismo motivo que documenta la
 * cabecera de `components/estudios/tarjeta-estudio.tsx` para navegación:
 * un enlace real, no un `<button>` con `router.push`-, con hover/foco
 * propios de fila de lista (no las clases de `TarjetaInteractiva`: el
 * levantamiento con sombra que usa esa tarjeta está pensado para un tile
 * grande en una grilla, no para una fila angosta dentro de un diálogo).
 */

import Link from "next/link"

import { AlertCircleIcon, CheckCircleIcon } from "lucide-react"

import { TarjetaUltimoValor } from "@/components/estudios/tarjeta-ultimo-valor"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ETIQUETA_PERIODO, type PeriodoSerie } from "@/lib/laboratorio/periodo"
import type { PuntoSerie, SerieMetrica } from "@/lib/laboratorio/series"
import { esMedicionUnica } from "@/lib/laboratorio/ultimo-valor"
import { cn } from "@/lib/utils"

export interface DialogoDetalleMetricaProps {
  serie: SerieMetrica
  periodo: PeriodoSerie
}

const FORMATO_FECHA_LARGA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
})

/** `measurement_date` es un `date` puro de Postgres: se formatea en UTC a propósito, mismo motivo que documenta `lib/estudios/agrupacion.ts`. */
function formatearFechaLarga(iso: string): string {
  return FORMATO_FECHA_LARGA.format(new Date(`${iso}T00:00:00Z`))
}

export function DialogoDetalleMetrica({ serie, periodo }: DialogoDetalleMetricaProps) {
  // Más reciente primero (requisito de la tarea): `serie.puntos` llega
  // ascendente desde `agruparEnSeries`, mismo criterio de vuelta que ya usa
  // `TablaAlternativa` en `grafico-metrica.tsx`.
  const puntosDescendente = [...serie.puntos].reverse()
  const unica = esMedicionUnica(serie.puntos)

  return (
    <Dialog>
      <DialogTrigger
        render={
          <TarjetaUltimoValor
            serie={serie}
            periodo={periodo}
            aria-label={`Ver todas las mediciones de ${serie.etiqueta}`}
          />
        }
      />

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{serie.etiqueta}</DialogTitle>
          <DialogDescription>
            {/* Mismo texto que `tarjeta-ultimo-valor.tsx` -una sola voz para
                la misma información, tarjeta y diálogo-. */}
            {unica
              ? `Única medición ${periodo === "todo" ? "registrada" : "en este período"}.`
              : `${serie.puntos.length} mediciones · ${ETIQUETA_PERIODO[periodo]}`}
          </DialogDescription>
        </DialogHeader>

        <ul className="-mx-1 flex max-h-[60vh] flex-col overflow-y-auto px-1">
          {puntosDescendente.map((punto, indice) => (
            <FilaMedicion key={`${punto.documentoId ?? "sin-documento"}-${punto.fecha}-${indice}`} punto={punto} />
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

const CLASE_FILA =
  "flex min-h-tactil items-center justify-between gap-3 border-b border-borde-sutil py-2.5 last:border-0 chica:py-2"

/** Una medición: fecha, valor + unidad, rango si existe, badge de rango con ícono, y link al estudio si lo tiene. */
function FilaMedicion({ punto }: { punto: PuntoSerie }) {
  const tieneRango = punto.min !== null || punto.max !== null

  const contenido = (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-muted-foreground">{formatearFechaLarga(punto.fecha)}</span>
        <span className="numeros-clinicos text-lg font-semibold text-foreground chica:text-base">
          {punto.valor}
          {punto.unidad ? ` ${punto.unidad}` : ""}
        </span>
        {punto.rangoTexto && (
          <span className="numeros-clinicos text-xs text-muted-foreground">Rango: {punto.rangoTexto}</span>
        )}
      </div>

      {tieneRango && (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 text-xs font-medium",
            punto.fueraDeRango ? "text-advertencia" : "text-exito",
          )}
        >
          {punto.fueraDeRango ? (
            <AlertCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          {punto.fueraDeRango ? "Fuera de rango" : "En rango"}
        </span>
      )}
    </>
  )

  if (punto.documentoId) {
    return (
      <li>
        <Link
          href={`/estudios/${punto.documentoId}`}
          className={cn(
            CLASE_FILA,
            "rounded-lg px-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
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
