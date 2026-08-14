"use client"

/**
 * Gráfico de evolución de UNA métrica de laboratorio (Sprint 5, tarea 5.4):
 * línea + banda de rango de referencia + puntos táctiles grandes, con panel
 * de detalle al tocar un punto y tabla accesible alternativa.
 *
 * ## Decisión de librería: Recharts (Context7, sin fricción documentada)
 *
 * Se evaluó Recharts v3 contra React 19.2.8 / Next 16.3.0 con el MCP de
 * Context7 antes de escribir este componente:
 *
 * - Requisitos mínimos de Recharts 3.x: React ≥16.8, TypeScript ≥5,
 *   Node ≥18 -este proyecto usa React 19.2.8 y TS ^5, sin conflicto-.
 * - `npm install recharts` resolvió limpio, sin warnings de peer deps ni
 *   `overrides` necesarios (los problemas de peer deps que documenta el wiki
 *   de Recharts son específicos de proyectos en React 16/17, no aplican acá).
 * - `ResponsiveContainer` es SSR-safe por diseño: si `ResizeObserver` no
 *   existe (render de servidor) el efecto es un no-op y el contenedor igual
 *   se pinta; no rompe en Server Components ni exige mocks especiales.
 *
 * Conclusión: Recharts es compatible sin fricción con esta stack, así que se
 * usa (estándar, accesible en su core, sin costo) en vez de SVG a mano.
 *
 * ## Lo que SÍ se reemplaza de Recharts: el `<Tooltip>`
 *
 * El roadmap pide un panel al TOCAR un punto con fecha, valor, rango y un
 * LINK real al documento de origen. El `<Tooltip>` de Recharts se posiciona
 * absoluto y se pensó para hover con mouse: en touch, su contenido no es
 * confiablemente tocable (un segundo toque sobre un link interno compite con
 * el cierre del tooltip al perder el "hover"), y no hay forma limpia de que
 * sobreviva un tap fuera del punto para que la persona lea con calma. En vez
 * de forzar ese componente a un patrón para el que no está pensado, este
 * componente usa Recharts SOLO para la geometría (línea, banda, ejes) y
 * maneja la selección de punto con estado de React propio -`indiceSeleccionado`-,
 * pintando el panel como una `<Tarjeta>` normal del sistema de diseño, con un
 * `<Link>` de verdad. Es una personalización esperada de una librería de
 * gráficos, no un indicio de que Recharts no sirva acá.
 *
 * ## Accesibilidad: imagen decorativa + tabla real, no ARIA sobre el SVG
 *
 * Los lectores de pantalla no leen SVGs de líneas (ni tienen forma sensata
 * de anunciar "línea que sube y baja"). En vez de pelear con el árbol ARIA
 * interno de Recharts, el patrón acá es el recomendado para gráficos
 * accesibles: el contenedor visual entero es `role="img"` con un
 * `aria-label` que resume el gráfico en una frase, y el SVG de adentro es
 * `aria-hidden="true"` -las lectoras de pantalla lo saltean por completo,
 * tratándolo como una sola imagen opaca-. La información completa,
 * PUNTO POR PUNTO, con links reales y navegables por teclado, vive en la
 * tabla `<details>` "Ver como tabla" de más abajo: es la vía de acceso real
 * para teclado y lectores de pantalla, no un adorno redundante. El panel de
 * detalle táctil (arriba) es un beneficio extra para mouse/touch, no la
 * única forma de llegar a los mismos datos.
 *
 * ## Movimiento: sin animación de entrada, siempre
 *
 * `docs/design-system.md` §6 fija 250ms como techo de cualquier animación de
 * este proyecto; la animación de entrada por defecto de Recharts dura
 * ~1500ms y es puramente JS (no CSS), así que el bloque global de
 * `prefers-reduced-motion` de `app/globals.css` -que solo pisa
 * `transition-duration`/`animation-duration` de CSS- no la alcanza. En vez
 * de detectar la preferencia del sistema para decidir, se desactiva
 * `isAnimationActive` SIEMPRE: cumple el techo de 250ms (0ms es "menos que
 * el techo") para todo el mundo, no solo para quien pidió menos movimiento.
 */

import * as React from "react"
import Link from "next/link"

import { ExternalLinkIcon, TriangleAlertIcon } from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"

import { Boton } from "@/components/base/boton"
import { Tarjeta } from "@/components/base/tarjeta"
import { puntosRombo, puntosTriangulo } from "@/components/graficos/formas-punto"
import type { PuntoSerie, SerieMetrica } from "@/lib/laboratorio/series"
import { cn } from "@/lib/utils"

export interface GraficoMetricaProps {
  serie: SerieMetrica
  /** Índice 0-4 dentro de `metricasDisponibles`, para asignar `--chart-{n}` de forma estable entre métricas. */
  colorIndice?: number
  className?: string
}

const DIA_MS = 24 * 60 * 60 * 1000
const ALTURA_GRAFICO = 260
/** Más de esta cantidad de puntos activa el modo de scroll interno (requisito 4 de la tarea: nunca scroll horizontal de PÁGINA, pero el gráfico puede scrollear el suyo propio). */
const UMBRAL_SCROLL_PUNTOS = 8
const ANCHO_POR_PUNTO_PX = 64
const ANCHO_MINIMO_SCROLL_PX = 560

const COLORES_CHART = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const

const FORMATO_FECHA_LARGA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
})
const FORMATO_MES_ANIO = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
})
const FORMATO_SOLO_MES = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", month: "long" })
const FORMATO_FECHA_CORTA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
})

function fechaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

function formatearFechaLarga(iso: string): string {
  return FORMATO_FECHA_LARGA.format(fechaUtc(iso))
}

/** ¿Cuántos meses/años abarca la serie, en prosa? "el 1 de agosto de 2026" (un solo punto) o "entre marzo y agosto de 2026" / "entre marzo de 2025 y agosto de 2026". */
function formatearRangoFechas(puntos: readonly PuntoSerie[]): string {
  if (puntos.length === 1) {
    return `el ${formatearFechaLarga(puntos[0].fecha)}`
  }
  const inicio = fechaUtc(puntos[0].fecha)
  const fin = fechaUtc(puntos[puntos.length - 1].fecha)
  const mismoAnio = inicio.getUTCFullYear() === fin.getUTCFullYear()
  const textoInicio = mismoAnio ? FORMATO_SOLO_MES.format(inicio) : FORMATO_MES_ANIO.format(inicio)
  const textoFin = FORMATO_MES_ANIO.format(fin)
  return `entre ${textoInicio} y ${textoFin}`
}

/** Resumen del gráfico en una frase, para `aria-label` (los lectores de pantalla no leen el SVG: ver el encabezado del archivo). */
export function construirAriaLabelSerie(serie: SerieMetrica): string {
  if (serie.puntos.length === 0) {
    return `Evolución de ${serie.etiqueta}: sin mediciones registradas todavía.`
  }
  const ultimo = serie.puntos[serie.puntos.length - 1]
  const textoMediciones = serie.puntos.length === 1 ? "1 medición" : `${serie.puntos.length} mediciones`
  const textoUnidad = ultimo.unidad ? ` ${ultimo.unidad}` : ""
  const textoEstado = ultimo.fueraDeRango ? "fuera del rango" : "dentro del rango"
  return `Evolución de ${serie.etiqueta}: ${textoMediciones} ${formatearRangoFechas(serie.puntos)}, última ${ultimo.valor}${textoUnidad} ${textoEstado}.`
}

interface PuntoGrafico {
  x: number
  valor: number
  punto: PuntoSerie
  indice: number
}

interface OpcionesPunto {
  color: string
  indiceSeleccionado: number
  onSeleccionar: (indice: number) => void
}

/**
 * Dot custom de Recharts (forma función: recibe `dotProps` con `cx`/`cy`/
 * `payload`/`index` y devuelve el SVG a pintar). Además de la forma
 * diferenciada -círculo normal, rombo si el valor cayó por debajo del
 * mínimo, triángulo si superó el máximo, nunca solo color- agrega un
 * círculo invisible de 44px de diámetro (`r={22}`) centrado en el mismo
 * punto SOLO para el área de toque: el requisito de la tarea pide un target
 * táctil ≥44px, pero una forma VISIBLE de 44px se leería como un punto
 * gigante y arruinaría la lectura de la línea. `pointerEvents="all"` es
 * necesario porque un `fill="transparent"` sin eso no captura toques/clicks
 * en la mayoría de los navegadores (un relleno transparente no participa del
 * hit-testing por defecto).
 */
function renderPuntoInteractivo(
  dotProps: { cx?: number; cy?: number; payload?: PuntoGrafico; index?: number },
  opciones: OpcionesPunto,
): React.ReactElement | null {
  const { cx, cy, payload, index } = dotProps
  if (typeof cx !== "number" || typeof cy !== "number" || !payload || typeof index !== "number") {
    return null
  }

  const { punto } = payload
  const seleccionado = index === opciones.indiceSeleccionado
  const radio = seleccionado ? 8 : 6
  const colorFuera = "var(--color-advertencia)"
  const color = punto.fueraDeRango ? colorFuera : opciones.color
  const debajoDelMinimo = punto.fueraDeRango && punto.min !== null && punto.valor < punto.min

  let forma: React.ReactElement
  if (punto.fueraDeRango && debajoDelMinimo) {
    forma = (
      <polygon
        points={puntosRombo(cx, cy, radio + 1)}
        fill={color}
        stroke="var(--color-card)"
        strokeWidth={2}
      />
    )
  } else if (punto.fueraDeRango) {
    forma = (
      <polygon
        points={puntosTriangulo(cx, cy, radio + 1)}
        fill={color}
        stroke="var(--color-card)"
        strokeWidth={2}
      />
    )
  } else {
    forma = <circle cx={cx} cy={cy} r={radio} fill={color} stroke="var(--color-card)" strokeWidth={2} />
  }

  return (
    <g
      key={`punto-${index}`}
      onClick={() => opciones.onSeleccionar(index)}
      style={{ cursor: "pointer" }}
      data-testid="punto-serie"
      data-fuera-de-rango={punto.fueraDeRango}
      data-seleccionado={seleccionado}
    >
      {/* Área de toque ≥44px, invisible: ver el comentario de la función. */}
      <circle cx={cx} cy={cy} r={22} fill="transparent" pointerEvents="all" />
      {forma}
      {seleccionado && (
        <circle cx={cx} cy={cy} r={radio + 5} fill="none" stroke={color} strokeWidth={2} opacity={0.45} />
      )}
    </g>
  )
}

export function GraficoMetrica({ serie, colorIndice = 0, className }: GraficoMetricaProps) {
  const [indiceSeleccionado, setIndiceSeleccionado] = React.useState(
    Math.max(0, serie.puntos.length - 1),
  )

  const color = COLORES_CHART[colorIndice % COLORES_CHART.length]

  const datos: PuntoGrafico[] = React.useMemo(
    () =>
      serie.puntos.map((punto, indice) => ({
        x: fechaUtc(punto.fecha).getTime(),
        valor: punto.valor,
        punto,
        indice,
      })),
    [serie],
  )

  if (datos.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-base text-muted-foreground">
        No hay mediciones de {serie.etiqueta.toLowerCase()} para este período.
      </div>
    )
  }

  const puntoSeleccionado = serie.puntos[Math.min(indiceSeleccionado, serie.puntos.length - 1)]

  const tiempos = datos.map((d) => d.x)
  const minX = Math.min(...tiempos)
  const maxX = Math.max(...tiempos)
  const paddingX = Math.max((maxX - minX) * 0.08, DIA_MS)
  const dominioX: [number, number] = [minX - paddingX, maxX + paddingX]

  const ultimoConRango = [...serie.puntos].reverse().find((p) => p.min !== null || p.max !== null)
  const bandaMin = ultimoConRango?.min ?? null
  const bandaMax = ultimoConRango?.max ?? null

  const valores = datos.map((d) => d.valor)
  const candidatosMin = bandaMin !== null ? [...valores, bandaMin] : valores
  const candidatosMax = bandaMax !== null ? [...valores, bandaMax] : valores
  const minY = Math.min(...candidatosMin)
  const maxY = Math.max(...candidatosMax)
  const paddingY = Math.max((maxY - minY) * 0.18, 1)
  const dominioY: [number, number] = [minY - paddingY, maxY + paddingY]

  const necesitaScroll = datos.length > UMBRAL_SCROLL_PUNTOS
  const anchoPx = Math.max(ANCHO_MINIMO_SCROLL_PX, datos.length * ANCHO_POR_PUNTO_PX)

  const contenidoEjesYSeries = (
    <>
      <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.35} strokeDasharray="3 3" />
      {(bandaMin !== null || bandaMax !== null) && (
        <ReferenceArea
          y1={bandaMin ?? undefined}
          y2={bandaMax ?? undefined}
          fill="var(--color-exito)"
          fillOpacity={0.12}
          stroke="var(--color-exito)"
          strokeOpacity={0.4}
          strokeDasharray="4 4"
          ifOverflow="extendDomain"
        />
      )}
      <XAxis
        dataKey="x"
        type="number"
        domain={dominioX}
        ticks={necesitaScroll ? undefined : tiempos}
        tickFormatter={(valor: number) => FORMATO_FECHA_CORTA.format(new Date(valor))}
        tick={{ fill: "var(--color-muted-foreground)", fontSize: 13 }}
        stroke="var(--color-border)"
        height={28}
      />
      <YAxis
        domain={dominioY}
        width={40}
        tickFormatter={(valor: number) => (Number.isInteger(valor) ? String(valor) : valor.toFixed(1))}
        tick={{ fill: "var(--color-muted-foreground)", fontSize: 13 }}
        stroke="var(--color-border)"
      />
      <Line
        type="monotone"
        dataKey="valor"
        stroke={color}
        strokeWidth={3}
        isAnimationActive={false}
        activeDot={false}
        dot={(dotProps: { cx?: number; cy?: number; payload?: PuntoGrafico; index?: number }) =>
          renderPuntoInteractivo(dotProps, {
            color,
            indiceSeleccionado,
            onSeleccionar: setIndiceSeleccionado,
          })
        }
      />
    </>
  )

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="rounded-xl border border-border bg-card p-3">
        {serie.unidad && (
          <p aria-hidden="true" className="px-1 pb-1 text-sm font-medium text-muted-foreground">
            Valores en {serie.unidad}
          </p>
        )}

        <div role="img" aria-label={construirAriaLabelSerie(serie)}>
          <div aria-hidden="true">
            {necesitaScroll ? (
              <div className="overflow-x-auto overscroll-x-contain rounded-lg" data-testid="grafico-scroll">
                <LineChart
                  width={anchoPx}
                  height={ALTURA_GRAFICO}
                  data={datos}
                  margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                >
                  {contenidoEjesYSeries}
                </LineChart>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={ALTURA_GRAFICO}>
                <LineChart data={datos} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  {contenidoEjesYSeries}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {necesitaScroll && (
          <p aria-hidden="true" className="pt-1 text-center text-sm text-muted-foreground">
            ← Deslizá para ver el historial completo →
          </p>
        )}
      </div>

      <Tarjeta aria-live="polite" className="gap-2 px-(--card-spacing)">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-muted-foreground">
              {formatearFechaLarga(puntoSeleccionado.fecha)}
            </p>
            <p className="numeros-clinicos text-2xl font-semibold text-foreground">
              {puntoSeleccionado.valor}
              {puntoSeleccionado.unidad ? ` ${puntoSeleccionado.unidad}` : ""}
            </p>
            <p className="text-sm text-muted-foreground">
              Rango de referencia: {puntoSeleccionado.rangoTexto ?? "No informado"}
            </p>
          </div>

          {puntoSeleccionado.fueraDeRango && (
            <span className="flex items-center gap-1.5 rounded-full bg-advertencia-suave px-3 py-1.5 text-sm font-semibold text-advertencia-fuerte">
              <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
              Fuera de rango
            </span>
          )}
        </div>

        {puntoSeleccionado.documentoId ? (
          <Boton
            render={<Link href={`/estudios/${puntoSeleccionado.documentoId}`} />}
            nativeButton={false}
            variant="outline"
            size="lg"
            className="mt-1 self-start"
          >
            <ExternalLinkIcon aria-hidden="true" />
            Ver el estudio
          </Boton>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Sin documento de origen asociado.</p>
        )}
      </Tarjeta>

      <TablaAlternativa serie={serie} />
    </div>
  )
}

/**
 * Tabla alternativa accesible (requisito 3 de la tarea): mismos datos que el
 * gráfico, en HTML de verdad -leíble por cualquier lector de pantalla, sin
 * depender de interpretar un SVG-, con el link real a cada documento. Vive
 * colapsada en un `<details>` para no duplicar visualmente la información
 * del panel de arriba en pantalla para quien SÍ ve el gráfico.
 */
function TablaAlternativa({ serie }: { serie: SerieMetrica }) {
  return (
    <details className="rounded-xl border border-border bg-card px-(--card-spacing) py-3 [--card-spacing:--spacing(5)]">
      <summary className="cursor-pointer text-base font-medium text-primary select-none">
        Ver como tabla
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">
            Mediciones de {serie.etiqueta}: fecha, valor, rango de referencia y estudio de origen
          </caption>
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                Fecha
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Valor
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Rango de referencia
              </th>
              <th scope="col" className="py-2 font-medium">
                Estudio
              </th>
            </tr>
          </thead>
          <tbody>
            {[...serie.puntos].reverse().map((punto) => (
              <tr key={`${punto.fecha}-${punto.documentoId ?? "sin-documento"}`} className="border-b border-border text-base last:border-0">
                <td className="py-2 pr-3 whitespace-nowrap text-foreground">
                  {formatearFechaLarga(punto.fecha)}
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={cn(
                      "numeros-clinicos",
                      punto.fueraDeRango ? "font-semibold text-advertencia-fuerte" : "text-foreground",
                    )}
                  >
                    {punto.valor}
                    {punto.unidad ? ` ${punto.unidad}` : ""}
                  </span>
                  {punto.fueraDeRango && <span className="sr-only"> (fuera de rango)</span>}
                </td>
                <td className="numeros-clinicos py-2 pr-3 text-muted-foreground">
                  {punto.rangoTexto ?? "—"}
                </td>
                <td className="py-2">
                  {punto.documentoId ? (
                    <Link
                      href={`/estudios/${punto.documentoId}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Ver el estudio
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
