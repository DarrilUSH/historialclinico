/**
 * Metadata de presentación por categoría de documento: ícono, etiqueta en
 * español y color (token del sistema de diseño). Usado por
 * `components/estudios/tarjeta-estudio.tsx` (Sprint 5, tarea 5.1) y pensado
 * para que la tarea 5.2 (filtros) reutilice las mismas cinco etiquetas sin
 * duplicarlas.
 *
 * El color NUNCA es la única señal (docs/design-system.md §8, regla 2): cada
 * categoría además tiene un ÍCONO de forma distinta, así que alguien con
 * daltonismo distingue "Receta" de "Consulta" sin depender del color.
 *
 * Los colores reutilizan los tokens `--chart-1`..`--chart-5` -las cinco
 * series de datos ya verificadas por `scripts/verificar-contraste.mjs`
 * (docs/design-system.md §2.7, ≥3:1 contra el fondo en los dos temas)-. Es
 * un uso categórico legítimo del mismo conjunto de tokens, no una colisión:
 * acá identifican una CATEGORÍA de documento en una tarjeta; en la tarea de
 * gráficos del roadmap (5.4) identificarán una SERIE de laboratorio en un
 * gráfico de líneas. Reutilizarlos evita inventar cinco tokens nuevos -y
 * cinco pares más que verificar- para un problema que ya tiene una paleta
 * accesible resuelta.
 */

import {
  FileTextIcon,
  FlaskConicalIcon,
  PillIcon,
  ScanLineIcon,
  StethoscopeIcon,
  type LucideIcon,
} from "lucide-react"

import type { CategoriaDocumento } from "@/types/dominio"

export interface InfoCategoria {
  etiqueta: string
  Icono: LucideIcon
  /** Color del ícono y la etiqueta, ej. `"text-chart-1"`. */
  claseTexto: string
  /** Fondo suave del círculo del ícono, ej. `"bg-chart-1/10"`. */
  claseFondo: string
}

export const INFO_CATEGORIA: Record<CategoriaDocumento, InfoCategoria> = {
  laboratory: {
    etiqueta: "Laboratorio",
    Icono: FlaskConicalIcon,
    claseTexto: "text-chart-1",
    claseFondo: "bg-chart-1/10",
  },
  imaging: {
    etiqueta: "Imágenes",
    Icono: ScanLineIcon,
    claseTexto: "text-chart-2",
    claseFondo: "bg-chart-2/10",
  },
  prescription: {
    etiqueta: "Receta",
    Icono: PillIcon,
    claseTexto: "text-chart-3",
    claseFondo: "bg-chart-3/10",
  },
  consultation: {
    etiqueta: "Consulta",
    Icono: StethoscopeIcon,
    claseTexto: "text-chart-4",
    claseFondo: "bg-chart-4/10",
  },
  other: {
    etiqueta: "Otro",
    Icono: FileTextIcon,
    claseTexto: "text-chart-5",
    claseFondo: "bg-chart-5/10",
  },
}
