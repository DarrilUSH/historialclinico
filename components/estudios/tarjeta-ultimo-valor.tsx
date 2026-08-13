/**
 * Tarjeta compacta de "último valor" de una métrica de laboratorio
 * (Sprint 5, tarea 5.2).
 *
 * Muestra:
 * - Nombre de la métrica (etiqueta).
 * - Último valor con unidad (grande, números clínicos).
 * - Fecha corta de la medición.
 * - Badge dentro/fuera de rango (ícono + texto, color como refuerzo).
 * - Variación vs. medición anterior (flecha + diferencia) o "Primera medición".
 *
 * Accionable: es un `<button>` que cambia la métrica seleccionada en el
 * gráfico vía `searchParam` en la URL (mismo patrón que `selector-metrica.tsx`).
 *
 * Semántica de la flecha: neutral. La dirección es informativa ("subió",
 * "bajó"), no un juicio clínico — el badge de rango da ese contexto.
 */

"use client"

import * as React from "react"

import { ArrowDownIcon, ArrowUpIcon, CheckCircleIcon, AlertCircleIcon } from "lucide-react"

import { TarjetaInteractiva } from "@/components/base/tarjeta"
import type { ResumenUltimoValor } from "@/lib/laboratorio/ultimo-valor"

export interface TarjetaUltimoValorProps {
  /** Nombre de la métrica a mostrar. */
  etiqueta: string
  /** Resumen calculado (último valor, rango, variación). */
  resumen: ResumenUltimoValor
  /**
   * Callback cuando la tarjeta se toca. Por ejemplo:
   * `() => router.push("?metrica=colesterol_total")`
   */
  onSeleccionar?: () => void
}

/**
 * Formatea la fecha `YYYY-MM-DD` a formato corto legible: "12/08" o
 * "12 ago" según el contexto. Acá usamos "DD/MM" para consistencia con
 * otros lugares de la app.
 */
function formatearFechaCorta(fecha: string): string {
  const [año, mes, dia] = fecha.split("-")
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

export function TarjetaUltimoValor({
  etiqueta,
  resumen,
  onSeleccionar,
}: TarjetaUltimoValorProps) {
  return (
    <TarjetaInteractiva
      onClick={onSeleccionar}
      className="flex flex-col gap-3 px-4 py-3"
    >
      {/* Encabezado: etiqueta de la métrica */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {etiqueta}
        </span>
      </div>

      {/* Valor grande con unidad */}
      <div className="flex items-baseline gap-1">
        <span className="numeros-clinicos text-3xl font-semibold text-foreground">
          {formatearValor(resumen.valor)}
        </span>
        {resumen.unidad && (
          <span className="text-sm text-muted-foreground">{resumen.unidad}</span>
        )}
      </div>

      {/* Fecha de la medición */}
      <div className="text-xs text-muted-foreground">
        Última: {formatearFechaCorta(resumen.fecha)}
      </div>

      {/* Badge de rango + Variación */}
      <div className="flex flex-col gap-2 pt-1">
        {/* Badge de rango (solo si hay rango definido) */}
        {resumen.enRango !== null && (
          <div className="flex items-center gap-1.5">
            {resumen.enRango ? (
              <>
                <CheckCircleIcon className="size-4 shrink-0 text-exito" aria-hidden="true" />
                <span className="text-xs font-medium text-exito">En rango</span>
              </>
            ) : (
              <>
                <AlertCircleIcon className="size-4 shrink-0 text-advertencia" aria-hidden="true" />
                <span className="text-xs font-medium text-advertencia">Fuera de rango</span>
              </>
            )}
          </div>
        )}

        {/* Variación o "Primera medición" */}
        {resumen.variacion ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {resumen.variacion.direccion === "subio" && (
              <>
                <ArrowUpIcon className="size-3 shrink-0" aria-hidden="true" />
                <span>
                  {resumen.variacion.diferencia} {resumen.unidad}
                </span>
              </>
            )}
            {resumen.variacion.direccion === "bajo" && (
              <>
                <ArrowDownIcon className="size-3 shrink-0" aria-hidden="true" />
                <span>
                  {resumen.variacion.diferencia} {resumen.unidad}
                </span>
              </>
            )}
            {resumen.variacion.direccion === "igual" && (
              <span>Sin cambios</span>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Primera medición</div>
        )}
      </div>
    </TarjetaInteractiva>
  )
}
