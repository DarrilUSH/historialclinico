"use client"

/**
 * Botón "Descargar CSV" para `/signos/historial` (Sprint 9, tarea 9.5):
 * descarga la serie filtrada en CSV con Excel.
 *
 * Cliente puro: recibe tipo y período seleccionados como props, arma la URL
 * de descarga y renderiza un link con `download` (navegador inicia el
 * download automático sin navegar).
 *
 * Placement: bajo el gráfico del signo seleccionado, o en el selector de
 * período (decisión de diseño del panel).
 */

import { DownloadIcon } from "lucide-react"

import { ETIQUETA_TIPO, type SignoTipo } from "@/lib/signos/tipos"
import { ETIQUETA_PERIODO_SIGNOS, type PeriodoSignos } from "@/lib/signos/periodo"

export interface BotonExportarProps {
  tipo: SignoTipo
  periodo: PeriodoSignos
}

export function BotonExportar({ tipo, periodo }: BotonExportarProps) {
  const url = `/api/signos/export?tipo=${encodeURIComponent(tipo)}&periodo=${encodeURIComponent(periodo)}`
  const etiquetaTipo = ETIQUETA_TIPO[tipo]
  const etiquetaPeriodo = ETIQUETA_PERIODO_SIGNOS[periodo]

  return (
    <a
      href={url}
      download
      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:bg-primary/80"
      aria-label={`Descargar CSV de ${etiquetaTipo} (últimos ${etiquetaPeriodo.toLowerCase()})`}
    >
      <DownloadIcon className="size-4" aria-hidden="true" />
      Descargar CSV
    </a>
  )
}
