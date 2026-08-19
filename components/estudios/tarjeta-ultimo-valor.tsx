/**
 * Tarjeta compacta de "último valor" de una métrica de laboratorio
 * (Sprint 5, tarea 5.2).
 *
 * Muestra:
 * - Nombre de la métrica (etiqueta).
 * - Último valor con unidad (grande, números clínicos).
 * - Fecha corta de la medición.
 * - Badge dentro/fuera de rango (ícono + texto, color como refuerzo).
 * - Variación vs. medición anterior (flecha + diferencia), o un aviso de
 *   "Única medición" si todavía no hay una segunda con la que comparar
 *   (pedido en vivo del usuario, 2026-08-19: "si solo existe una medición
 *   que aclare que es la única medición" — antes decía "Primera medición",
 *   que suena a "va a haber más pronto" en vez de "esto es lo único que
 *   hay todavía", justo la lectura que confundía).
 *
 * Disparador de `components/estudios/dialogo-detalle-metrica.tsx`: ESTE
 * archivo ya no abre nada por sí mismo -`DialogoDetalleMetrica` envuelve la
 * tarjeta entera en un `<Dialog>` de Base UI (`components/ui/dialog.tsx`) y
 * la pasa como `render` de su `DialogTrigger`, que le inyecta `onClick` y
 * demás atributos de disparador en tiempo de ejecución (mismo mecanismo que
 * ya usa `components/base/boton.tsx` para `variant="destructivo"`, ver su
 * comentario de cabecera)-. Por eso este componente recibe `serie` y
 * `periodo` completos -antes recibía `resumen`/`etiqueta` ya resueltos por
 * `panel-tendencias.tsx`, pero el diálogo necesita la SERIE completa para
 * listar todas las mediciones, así que el cálculo de `resumenUltimoValor`
 * se mudó para acá, un solo lugar- y difunde cualquier prop extra
 * (`...resto`) sobre `TarjetaInteractiva`, que a su vez la difunde sobre el
 * `<button>` nativo: ni este archivo ni `TarjetaInteractiva` necesitan saber
 * que existe un diálogo del otro lado.
 *
 * Antes también aceptaba `onSeleccionar` para cambiar la métrica graficada
 * más abajo -"las tarjetas actúan como selector alternativo"-. Se sacó: con
 * el diálogo de detalle, tocar la tarjeta tiene un solo trabajo. Cambiar la
 * métrica del gráfico lo sigue cubriendo, sin superposición,
 * `components/estudios/selector-metrica.tsx`.
 */

"use client"

import * as React from "react"

import { ArrowDownIcon, ArrowUpIcon, CheckCircleIcon, AlertCircleIcon, InfoIcon } from "lucide-react"

import { TarjetaInteractiva } from "@/components/base/tarjeta"
import type { PeriodoSerie } from "@/lib/laboratorio/periodo"
import type { SerieMetrica } from "@/lib/laboratorio/series"
import { esMedicionUnica, resumenUltimoValor } from "@/lib/laboratorio/ultimo-valor"
import { cn } from "@/lib/utils"

export interface TarjetaUltimoValorProps extends Omit<React.ComponentProps<"button">, "children"> {
  /** Serie completa de la métrica -el diálogo de detalle necesita TODOS los puntos, no solo el último-. */
  serie: SerieMetrica
  /** Período elegido en la pantalla, solo para matizar el texto de "única medición" (ver más abajo). */
  periodo: PeriodoSerie
}

/**
 * Formatea la fecha `YYYY-MM-DD` a formato corto legible: "12/08" o
 * "12 ago" según el contexto. Acá usamos "DD/MM" para consistencia con
 * otros lugares de la app.
 */
function formatearFechaCorta(fecha: string): string {
  const [, mes, dia] = fecha.split("-")
  return `${dia}/${mes}`
}

/**
 * Formatea el valor numérico con decimales apropiados.
 * Si es un entero, sin decimales; si tiene decimales, máximo 2.
 */
function formatearValor(valor: number): string {
  if (Number.isInteger(valor)) {
    return valor.toString()
  }
  return valor.toFixed(2).replace(/\.?0+$/, "")
}

export function TarjetaUltimoValor({ serie, periodo, className, ...resto }: TarjetaUltimoValorProps) {
  const resumen = resumenUltimoValor(serie.puntos)
  const unica = esMedicionUnica(serie.puntos)

  return (
    <TarjetaInteractiva
      className={cn("flex flex-col gap-3 px-4 py-3 chica:gap-1.5 chica:px-3 chica:py-2", className)}
      {...resto}
    >
      {/* Encabezado: etiqueta de la métrica */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {serie.etiqueta}
        </span>
      </div>

      {/* Valor grande con unidad */}
      <div className="flex items-baseline gap-1">
        <span className="numeros-clinicos text-3xl font-semibold text-foreground chica:text-2xl">
          {formatearValor(resumen.valor)}
        </span>
        {resumen.unidad && (
          <span className="text-sm text-muted-foreground chica:text-xs">{resumen.unidad}</span>
        )}
      </div>

      {/* Fecha de la medición */}
      <div className="text-xs text-muted-foreground">
        Última: {formatearFechaCorta(resumen.fecha)}
      </div>

      {/* Badge de rango + Variación: mismo dato, en fila -no apilado- en
          chica (Sprint 14, tanda B), así el tile gana un renglón de alto. */}
      <div className="flex flex-col gap-2 pt-1 chica:flex-row chica:flex-wrap chica:items-center chica:gap-x-2 chica:gap-y-1 chica:pt-0.5">
        {/* Badge de rango (solo si hay rango definido) */}
        {resumen.enRango !== null && (
          <div className="flex items-center gap-1.5 chica:gap-1">
            {resumen.enRango ? (
              <>
                <CheckCircleIcon className="size-4 shrink-0 text-exito chica:size-3.5" aria-hidden="true" />
                <span className="text-xs font-medium text-exito">En rango</span>
              </>
            ) : (
              <>
                <AlertCircleIcon className="size-4 shrink-0 text-advertencia chica:size-3.5" aria-hidden="true" />
                <span className="text-xs font-medium text-advertencia">Fuera de rango</span>
              </>
            )}
          </div>
        )}

        {/* Variación, o el aviso de única medición si todavía no hay con qué comparar. */}
        {unica ? (
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground chica:gap-1">
            <InfoIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{periodo === "todo" ? "Única medición registrada" : "Única medición en este período"}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground chica:gap-1">
            {resumen.variacion?.direccion === "subio" && (
              <>
                <ArrowUpIcon className="size-3 shrink-0" aria-hidden="true" />
                <span>
                  {resumen.variacion.diferencia} {resumen.unidad}
                </span>
              </>
            )}
            {resumen.variacion?.direccion === "bajo" && (
              <>
                <ArrowDownIcon className="size-3 shrink-0" aria-hidden="true" />
                <span>
                  {resumen.variacion.diferencia} {resumen.unidad}
                </span>
              </>
            )}
            {resumen.variacion?.direccion === "igual" && <span>Sin cambios</span>}
          </div>
        )}
      </div>
    </TarjetaInteractiva>
  )
}
