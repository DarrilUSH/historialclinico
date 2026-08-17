"use client"

/**
 * Gráfico de la serie de UN signo vital en `/signos/historial` (Sprint 9,
 * tarea 9.4 — ROADMAP_SPRINTS.md): línea (dos para tensión) + banda de
 * referencia sombreada (salvo peso, ver más abajo) + puntos táctiles
 * grandes, con panel de detalle al tocar un punto y tabla accesible
 * alternativa.
 *
 * Reutiliza deliberadamente el mismo lenguaje visual y de accesibilidad que
 * `components/estudios/grafico-metrica.tsx` (Sprint 5, tarea 5.4) -Recharts
 * solo para la geometría, selección de punto con estado de React propio en
 * vez del `<Tooltip>` de Recharts (mismo motivo: en touch su contenido no es
 * confiablemente tocable), `role="img"` + SVG `aria-hidden` + tabla real
 * `<details>` como vía de acceso para teclado/lectores de pantalla, sin
 * animación de entrada (`docs/design-system.md` §6)-. Lo que SÍ se reutiliza
 * como código, no solo como patrón, es la geometría de los puntos fuera de lo
 * esperado (`components/graficos/formas-punto.ts`, extraído de
 * `grafico-metrica.tsx` para esta tarea).
 *
 * Lo que NO se reutiliza -y por qué hace falta un componente nuevo en vez de
 * generalizar `GraficoMetrica`-: `GraficoMetrica` pinta EXACTAMENTE una
 * línea (`SerieMetrica.puntos`, un valor por fecha). Tensión necesita DOS
 * líneas sobre el mismo eje Y con marcado independiente por línea
 * (`lib/signos/series.ts` ya las separa en `sistolica`/`diastolica`), un caso
 * que `GraficoMetrica` no contempla y que forzarlo a soportarlo -con una API
 * genérica de "N líneas"- habría sido reescribir el componente de Sprint 5
 * entero arriesgando su comportamiento actual, algo que esta tarea tiene
 * prohibido explícitamente.
 *
 * ## Qué significa "fuera de umbral" acá
 *
 * Cada punto ya llega marcado por `lib/signos/series.ts#construirSerieSigno`
 * contra las alertas PERSISTIDAS (`vital_sign_alerts`), no recalculado -ver
 * el encabezado de ese archivo y `docs/modelo-signos.md` §11-. Este
 * componente solo pinta lo que la serie ya resolvió.
 *
 * ## La banda de peso: ausente, con una nota visible
 *
 * `lib/signos/series.ts` no manda `umbralMin`/`umbralMax` para peso a
 * propósito -el umbral es una distancia contra una mediana móvil, no un
 * rango fijo del eje Y-. En vez de dejar ese silencio sin explicar, el
 * gráfico de peso muestra una nota corta debajo del gráfico: la decisión
 * tiene que ser legible para quien usa la app, no solo para quien lee el
 * código (así lo pide el criterio de aceptación: "decidilo y documentalo").
 */

import * as React from "react"

import { TriangleAlertIcon } from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"

import { Tarjeta } from "@/components/base/tarjeta"
import { puntosRombo, puntosTriangulo } from "@/components/graficos/formas-punto"
import type { Tamano } from "@/lib/densidad/tamano"
import { ZONA_HORARIA_TURNOS } from "@/lib/turnos/fecha"
import { formatearFechaLargaTurno, formatearHoraTurno } from "@/lib/turnos/formato"
import type { PuntoSerieSigno, SerieSigno } from "@/lib/signos/series"
import { UNIDAD_TIPO } from "@/lib/signos/tipos"
import { cn } from "@/lib/utils"

export interface GraficoSignoProps {
  serie: SerieSigno
  /**
   * Modo de letra de la cuenta (Sprint 13, tarea 13.4), resuelto server-side
   * en `signos/historial/page.tsx` y bajado por props hasta acá -Recharts
   * pide un alto NUMÉRICO en píxeles, así que no hay un token CSS que lo
   * resuelva solo-. Mismo patrón que `components/estudios/grafico-metrica.tsx`
   * (Tanda 2). Default `"grande"` para los consumidores de test que no lo pasan.
   */
  tamano?: Tamano
  className?: string
}

/**
 * Alto del gráfico por densidad. `260` es el valor original (grande, sin
 * cambios). `200` fue la reducción de la tarea 13.4; la tanda B del Sprint 14
 * la bajó a `180` -misma evaluación y mismo resultado que documenta el
 * comentario gemelo de `components/estudios/grafico-metrica.tsx`: los ejes
 * usan `fontSize` y `height`/`width` fijos, así que los 20px cedidos salen
 * del área de trazado, y en tensión (2 líneas) y glucemia/peso (1 línea) del
 * seed los ticks se leyeron completos en el dispositivo real, sin
 * superponerse-.
 */
const ALTURA_GRAFICO_POR_TAMANO: Record<Tamano, number> = { grande: 260, chica: 180 }
/** Mismo umbral y proporciones que `grafico-metrica.tsx`: por encima de esta cantidad de puntos el gráfico scrollea horizontalmente ADENTRO de su propio contenedor, nunca la página. */
const UMBRAL_SCROLL_PUNTOS = 8
const ANCHO_POR_PUNTO_PX = 64
const ANCHO_MINIMO_SCROLL_PX = 560

const COLOR_SISTOLICA = "var(--color-chart-1)"
const COLOR_DIASTOLICA = "var(--color-chart-2)"
const COLOR_UNICO = "var(--color-chart-1)"

const FORMATO_FECHA_CORTA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA_TURNOS,
  day: "2-digit",
  month: "2-digit",
})

const FORMATO_DECIMAL = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 })

function formatearValor(valor: number, tipo: SerieSigno["tipo"]): string {
  return tipo === "peso" ? FORMATO_DECIMAL.format(valor) : String(valor)
}

interface OpcionesPuntoSigno {
  color: string
  indiceSeleccionado: number
  onSeleccionar: (indice: number) => void
}

/**
 * Dot custom de Recharts. Misma forma que `grafico-metrica.tsx#renderPuntoInteractivo`
 * -círculo normal, rombo si `direccion === "abajo"`, triángulo si
 * `"arriba"`, nunca solo color- y mismo círculo invisible de 44px para el
 * área de toque, pero decidido por `PuntoSerieSigno.direccion` en vez de
 * comparar contra `min`/`max`: acá no hay rango, hay un umbral que solo tiene
 * un lado que alerta (salvo peso, que puede alertar para los dos lados).
 */
function renderPuntoSigno(
  dotProps: { cx?: number; cy?: number; payload?: { punto: PuntoSerieSigno }; index?: number },
  opciones: OpcionesPuntoSigno,
): React.ReactElement | null {
  const { cx, cy, payload, index } = dotProps
  if (typeof cx !== "number" || typeof cy !== "number" || !payload || typeof index !== "number") {
    return null
  }

  const { punto } = payload
  const seleccionado = index === opciones.indiceSeleccionado
  const radio = seleccionado ? 8 : 6
  const colorFuera = "var(--color-advertencia)"
  const color = punto.fueraDeUmbral ? colorFuera : opciones.color

  let forma: React.ReactElement
  if (punto.fueraDeUmbral && punto.direccion === "abajo") {
    forma = (
      <polygon points={puntosRombo(cx, cy, radio + 1)} fill={color} stroke="var(--color-card)" strokeWidth={2} />
    )
  } else if (punto.fueraDeUmbral) {
    forma = (
      <polygon points={puntosTriangulo(cx, cy, radio + 1)} fill={color} stroke="var(--color-card)" strokeWidth={2} />
    )
  } else {
    forma = <circle cx={cx} cy={cy} r={radio} fill={color} stroke="var(--color-card)" strokeWidth={2} />
  }

  return (
    <g
      key={`punto-${index}`}
      onClick={() => opciones.onSeleccionar(index)}
      style={{ cursor: "pointer" }}
      data-testid="punto-serie-signo"
      data-fuera-de-umbral={punto.fueraDeUmbral}
      data-seleccionado={seleccionado}
    >
      <circle cx={cx} cy={cy} r={22} fill="transparent" pointerEvents="all" />
      {forma}
      {seleccionado && (
        <circle cx={cx} cy={cy} r={radio + 5} fill="none" stroke={color} strokeWidth={2} opacity={0.45} />
      )}
    </g>
  )
}

/** Resumen del gráfico en una frase, para `aria-label` -los lectores de pantalla no leen el SVG, ver el encabezado del archivo-. */
function construirAriaLabelSigno(serie: SerieSigno): string {
  const puntos = serie.tipo === "tension" ? serie.sistolica : serie.puntos
  if (puntos.length === 0) {
    const etiqueta = serie.tipo === "tension" ? "tensión" : serie.tipo
    return `Evolución de ${etiqueta}: sin mediciones registradas en este período.`
  }
  const fueraDeUmbral =
    serie.tipo === "tension"
      ? serie.sistolica.filter((p) => p.fueraDeUmbral).length + serie.diastolica.filter((p) => p.fueraDeUmbral).length
      : serie.puntos.filter((p) => p.fueraDeUmbral).length
  const textoMediciones = puntos.length === 1 ? "1 medición" : `${puntos.length} mediciones`
  const textoFuera =
    fueraDeUmbral > 0
      ? `, ${fueraDeUmbral === 1 ? "1 fuera de umbral" : `${fueraDeUmbral} fuera de umbral`}`
      : ""
  const etiqueta = serie.tipo === "tension" ? "tensión arterial" : serie.tipo === "glucemia" ? "glucemia" : "peso"
  return `Evolución de ${etiqueta}: ${textoMediciones}${textoFuera}.`
}

export function GraficoSigno({ serie, tamano = "grande", className }: GraficoSignoProps) {
  const alturaGrafico = ALTURA_GRAFICO_POR_TAMANO[tamano]
  const cantidadPuntos = serie.tipo === "tension" ? serie.sistolica.length : serie.puntos.length

  const [indiceSeleccionado, setIndiceSeleccionado] = React.useState(Math.max(0, cantidadPuntos - 1))

  const indice = Math.min(indiceSeleccionado, Math.max(0, cantidadPuntos - 1))

  if (cantidadPuntos === 0) {
    const etiqueta = serie.tipo === "tension" ? "tensión" : serie.tipo === "glucemia" ? "glucemia" : "peso"
    return (
      <div className={cn("rounded-xl border border-border bg-card px-4 py-8 text-center text-base text-muted-foreground", className)}>
        No hay mediciones de {etiqueta} para este período.
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="rounded-xl border border-border bg-card p-3">
        <p aria-hidden="true" className="px-1 pb-1 text-sm font-medium text-muted-foreground">
          {serie.tipo === "tension" ? "Valores en mmHg" : `Valores en ${UNIDAD_TIPO[serie.tipo]}`}
        </p>

        <div role="img" aria-label={construirAriaLabelSigno(serie)}>
          <div aria-hidden="true">
            <CuerpoGrafico
              serie={serie}
              indiceSeleccionado={indice}
              onSeleccionar={setIndiceSeleccionado}
              alturaGrafico={alturaGrafico}
            />
          </div>
        </div>

        {cantidadPuntos > UMBRAL_SCROLL_PUNTOS && (
          <p aria-hidden="true" className="pt-1 text-center text-sm text-muted-foreground">
            ← Deslizá para ver el historial completo →
          </p>
        )}
      </div>

      {serie.tipo === "peso" && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          El peso no tiene una banda de referencia fija: cada carga se compara contra la mediana de tus pesos de los
          últimos días, no contra un rango constante. Por eso acá no hay una zona sombreada.
        </p>
      )}

      <PanelDetalle serie={serie} indice={indice} />

      <TablaAlternativa serie={serie} />
    </div>
  )
}

interface RegistroTension {
  x: number
  sistolica: number
  diastolica: number
  puntoSistolica: PuntoSerieSigno
  puntoDiastolica: PuntoSerieSigno
}

interface RegistroSimple {
  x: number
  valor: number
  punto: PuntoSerieSigno
}

function CuerpoGrafico({
  serie,
  indiceSeleccionado,
  onSeleccionar,
  alturaGrafico,
}: {
  serie: SerieSigno
  indiceSeleccionado: number
  onSeleccionar: (indice: number) => void
  alturaGrafico: number
}) {
  if (serie.tipo === "tension") {
    const datos: RegistroTension[] = serie.sistolica.map((puntoSistolica, i) => ({
      x: Date.parse(puntoSistolica.fecha),
      sistolica: puntoSistolica.valor,
      diastolica: serie.diastolica[i]!.valor,
      puntoSistolica,
      puntoDiastolica: serie.diastolica[i]!,
    }))

    const valores = datos.flatMap((d) => [d.sistolica, d.diastolica])
    const dominioY = calcularDominioY(valores, [serie.umbralSistolica, serie.umbralDiastolica])
    const dominioX = calcularDominioX(datos.map((d) => d.x))
    const necesitaScroll = datos.length > UMBRAL_SCROLL_PUNTOS
    const anchoPx = Math.max(ANCHO_MINIMO_SCROLL_PX, datos.length * ANCHO_POR_PUNTO_PX)

    const contenido = (
      <>
        <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.35} strokeDasharray="3 3" />
        <ReferenceArea
          y2={serie.umbralSistolica}
          fill={COLOR_SISTOLICA}
          fillOpacity={0.08}
          stroke={COLOR_SISTOLICA}
          strokeOpacity={0.35}
          strokeDasharray="4 4"
          ifOverflow="extendDomain"
        />
        <ReferenceArea
          y2={serie.umbralDiastolica}
          fill={COLOR_DIASTOLICA}
          fillOpacity={0.1}
          stroke={COLOR_DIASTOLICA}
          strokeOpacity={0.35}
          strokeDasharray="4 4"
          ifOverflow="extendDomain"
        />
        <EjeX dominioX={dominioX} ticks={necesitaScroll ? undefined : datos.map((d) => d.x)} />
        <EjeY dominioY={dominioY} />
        <Line
          type="monotone"
          dataKey="sistolica"
          stroke={COLOR_SISTOLICA}
          strokeWidth={3}
          isAnimationActive={false}
          activeDot={false}
          dot={(dotProps: { cx?: number; cy?: number; payload?: RegistroTension; index?: number }) =>
            renderPuntoSigno(
              { ...dotProps, payload: dotProps.payload && { punto: dotProps.payload.puntoSistolica } },
              { color: COLOR_SISTOLICA, indiceSeleccionado, onSeleccionar },
            )
          }
        />
        <Line
          type="monotone"
          dataKey="diastolica"
          stroke={COLOR_DIASTOLICA}
          strokeWidth={3}
          isAnimationActive={false}
          activeDot={false}
          dot={(dotProps: { cx?: number; cy?: number; payload?: RegistroTension; index?: number }) =>
            renderPuntoSigno(
              { ...dotProps, payload: dotProps.payload && { punto: dotProps.payload.puntoDiastolica } },
              { color: COLOR_DIASTOLICA, indiceSeleccionado, onSeleccionar },
            )
          }
        />
      </>
    )

    return (
      <ContenedorGrafico necesitaScroll={necesitaScroll} anchoPx={anchoPx} datos={datos} alturaGrafico={alturaGrafico}>
        {contenido}
      </ContenedorGrafico>
    )
  }

  const puntos = serie.puntos
  const datos: RegistroSimple[] = puntos.map((punto) => ({ x: Date.parse(punto.fecha), valor: punto.valor, punto }))
  const bandaMin = serie.tipo === "glucemia" ? serie.umbralMin : null
  const bandaMax = serie.tipo === "glucemia" ? serie.umbralMax : null
  const candidatosBanda = [bandaMin, bandaMax].filter((v): v is number => v !== null)
  const dominioY = calcularDominioY(datos.map((d) => d.valor), candidatosBanda)
  const dominioX = calcularDominioX(datos.map((d) => d.x))
  const necesitaScroll = datos.length > UMBRAL_SCROLL_PUNTOS
  const anchoPx = Math.max(ANCHO_MINIMO_SCROLL_PX, datos.length * ANCHO_POR_PUNTO_PX)

  const contenido = (
    <>
      <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.35} strokeDasharray="3 3" />
      {bandaMin !== null && bandaMax !== null && (
        <ReferenceArea
          y1={bandaMin}
          y2={bandaMax}
          fill="var(--color-exito)"
          fillOpacity={0.12}
          stroke="var(--color-exito)"
          strokeOpacity={0.4}
          strokeDasharray="4 4"
          ifOverflow="extendDomain"
        />
      )}
      <EjeX dominioX={dominioX} ticks={necesitaScroll ? undefined : datos.map((d) => d.x)} />
      <EjeY dominioY={dominioY} />
      <Line
        type="monotone"
        dataKey="valor"
        stroke={COLOR_UNICO}
        strokeWidth={3}
        isAnimationActive={false}
        activeDot={false}
        dot={(dotProps: { cx?: number; cy?: number; payload?: RegistroSimple; index?: number }) =>
          renderPuntoSigno(dotProps, { color: COLOR_UNICO, indiceSeleccionado, onSeleccionar })
        }
      />
    </>
  )

  return (
    <ContenedorGrafico necesitaScroll={necesitaScroll} anchoPx={anchoPx} datos={datos} alturaGrafico={alturaGrafico}>
      {contenido}
    </ContenedorGrafico>
  )
}

function ContenedorGrafico({
  necesitaScroll,
  anchoPx,
  datos,
  alturaGrafico,
  children,
}: {
  necesitaScroll: boolean
  anchoPx: number
  datos: readonly unknown[]
  alturaGrafico: number
  children: React.ReactNode
}) {
  if (necesitaScroll) {
    return (
      <div className="overflow-x-auto overscroll-x-contain rounded-lg" data-testid="grafico-scroll">
        <LineChart width={anchoPx} height={alturaGrafico} data={datos as object[]} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          {children}
        </LineChart>
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={alturaGrafico}>
      <LineChart data={datos as object[]} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
        {children}
      </LineChart>
    </ResponsiveContainer>
  )
}

function EjeX({ dominioX, ticks }: { dominioX: [number, number]; ticks: number[] | undefined }) {
  return (
    <XAxis
      dataKey="x"
      type="number"
      domain={dominioX}
      ticks={ticks}
      tickFormatter={(valor: number) => FORMATO_FECHA_CORTA.format(new Date(valor))}
      tick={{ fill: "var(--color-muted-foreground)", fontSize: 13 }}
      stroke="var(--color-border)"
      height={28}
    />
  )
}

function EjeY({ dominioY }: { dominioY: [number, number] }) {
  return (
    <YAxis
      domain={dominioY}
      width={40}
      tickFormatter={(valor: number) => (Number.isInteger(valor) ? String(valor) : valor.toFixed(1))}
      tick={{ fill: "var(--color-muted-foreground)", fontSize: 13 }}
      stroke="var(--color-border)"
    />
  )
}

const DIA_MS = 24 * 60 * 60 * 1000

function calcularDominioX(tiempos: readonly number[]): [number, number] {
  const minX = Math.min(...tiempos)
  const maxX = Math.max(...tiempos)
  const paddingX = Math.max((maxX - minX) * 0.08, DIA_MS)
  return [minX - paddingX, maxX + paddingX]
}

function calcularDominioY(valores: readonly number[], bandas: readonly number[]): [number, number] {
  const candidatosMin = bandas.length > 0 ? [...valores, ...bandas] : valores
  const candidatosMax = bandas.length > 0 ? [...valores, ...bandas] : valores
  const minY = Math.min(...candidatosMin)
  const maxY = Math.max(...candidatosMax)
  const paddingY = Math.max((maxY - minY) * 0.18, 1)
  return [minY - paddingY, maxY + paddingY]
}

function PanelDetalle({ serie, indice }: { serie: SerieSigno; indice: number }) {
  if (serie.tipo === "tension") {
    const puntoSistolica = serie.sistolica[indice]
    const puntoDiastolica = serie.diastolica[indice]
    if (!puntoSistolica || !puntoDiastolica) return null

    return (
      <Tarjeta aria-live="polite" className="gap-3 px-(--card-spacing)">
        <FechaDetalle fecha={puntoSistolica.fecha} />
        <div className="grid grid-cols-2 gap-3">
          <FilaValorDetalle etiqueta="Sistólica" color={COLOR_SISTOLICA} punto={puntoSistolica} unidad="mmHg" />
          <FilaValorDetalle etiqueta="Diastólica" color={COLOR_DIASTOLICA} punto={puntoDiastolica} unidad="mmHg" />
        </div>
      </Tarjeta>
    )
  }

  const punto = serie.puntos[indice]
  if (!punto) return null

  return (
    <Tarjeta aria-live="polite" className="gap-2 px-(--card-spacing)">
      <FechaDetalle fecha={punto.fecha} />
      <div className="flex items-start justify-between gap-3">
        <p className="numeros-clinicos text-2xl font-semibold text-foreground">
          {formatearValor(punto.valor, serie.tipo)} {UNIDAD_TIPO[serie.tipo]}
        </p>
        <InsigniaUmbral punto={punto} />
      </div>
      {punto.fueraDeUmbral && punto.etiquetaUmbral && (
        <p className="text-sm font-medium text-advertencia-fuerte">{punto.etiquetaUmbral}</p>
      )}
    </Tarjeta>
  )
}

function FechaDetalle({ fecha }: { fecha: string }) {
  return (
    <p className="text-sm font-medium text-muted-foreground">
      {formatearFechaLargaTurno(fecha)} · {formatearHoraTurno(fecha)} hs
    </p>
  )
}

function FilaValorDetalle({
  etiqueta,
  color,
  punto,
  unidad,
}: {
  etiqueta: string
  color: string
  punto: PuntoSerieSigno
  unidad: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        {etiqueta}
      </p>
      <p className="numeros-clinicos text-xl font-bold text-foreground">
        {punto.valor} {unidad}
      </p>
      {punto.fueraDeUmbral && punto.etiquetaUmbral && (
        <p className="flex items-center gap-1 text-sm font-medium text-advertencia-fuerte">
          <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
          {punto.etiquetaUmbral}
        </p>
      )}
    </div>
  )
}

function InsigniaUmbral({ punto }: { punto: PuntoSerieSigno }) {
  if (!punto.fueraDeUmbral) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-advertencia-suave px-3 py-1.5 text-sm font-semibold text-advertencia-fuerte">
      <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
      Fuera de umbral
    </span>
  )
}

/** Tabla alternativa accesible (mismo patrón que `grafico-metrica.tsx#TablaAlternativa`): los mismos datos del gráfico, en HTML de verdad, colapsada en un `<details>`. */
function TablaAlternativa({ serie }: { serie: SerieSigno }) {
  if (serie.tipo === "tension") {
    const filas = serie.sistolica.map((puntoSistolica, i) => ({
      sistolica: puntoSistolica,
      diastolica: serie.diastolica[i]!,
    }))
    return (
      <details className="rounded-xl border border-border bg-card px-(--card-spacing) py-3 [--card-spacing:--spacing(5)]">
        <summary className="cursor-pointer text-base font-medium text-primary select-none">Ver como tabla</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Mediciones de tensión arterial: fecha, sistólica, diastólica y estado</caption>
            <thead>
              <tr className="border-b border-border text-sm text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">Fecha</th>
                <th scope="col" className="py-2 pr-3 font-medium">Sistólica</th>
                <th scope="col" className="py-2 pr-3 font-medium">Diastólica</th>
                <th scope="col" className="py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {[...filas].reverse().map(({ sistolica, diastolica }) => (
                <tr key={sistolica.vitalSignId} className="border-b border-border text-base last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap text-foreground">
                    {formatearFechaLargaTurno(sistolica.fecha)} · {formatearHoraTurno(sistolica.fecha)} hs
                  </td>
                  <CeldaValor punto={sistolica} unidad="mmHg" />
                  <CeldaValor punto={diastolica} unidad="mmHg" />
                  <td className="py-2 text-sm text-muted-foreground">
                    {[sistolica, diastolica].some((p) => p.fueraDeUmbral)
                      ? [sistolica.etiquetaUmbral, diastolica.etiquetaUmbral].filter(Boolean).join(" · ")
                      : "Dentro de umbral"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    )
  }

  const etiquetaTipo = serie.tipo === "glucemia" ? "glucemia" : "peso"
  const unidad = UNIDAD_TIPO[serie.tipo]

  return (
    <details className="rounded-xl border border-border bg-card px-(--card-spacing) py-3 [--card-spacing:--spacing(5)]">
      <summary className="cursor-pointer text-base font-medium text-primary select-none">Ver como tabla</summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">Mediciones de {etiquetaTipo}: fecha, valor y estado</caption>
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">Fecha</th>
              <th scope="col" className="py-2 pr-3 font-medium">Valor</th>
              <th scope="col" className="py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {[...serie.puntos].reverse().map((punto) => (
              <tr key={punto.vitalSignId} className="border-b border-border text-base last:border-0">
                <td className="py-2 pr-3 whitespace-nowrap text-foreground">
                  {formatearFechaLargaTurno(punto.fecha)} · {formatearHoraTurno(punto.fecha)} hs
                </td>
                <CeldaValor punto={punto} unidad={unidad} tipo={serie.tipo} />
                <td className="py-2 text-sm text-muted-foreground">{punto.etiquetaUmbral ?? "Dentro de umbral"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function CeldaValor({ punto, unidad, tipo }: { punto: PuntoSerieSigno; unidad: string; tipo?: SerieSigno["tipo"] }) {
  return (
    <td className="py-2 pr-3">
      <span
        className={cn("numeros-clinicos", punto.fueraDeUmbral ? "font-semibold text-advertencia-fuerte" : "text-foreground")}
      >
        {formatearValor(punto.valor, tipo ?? "tension")} {unidad}
      </span>
      {punto.fueraDeUmbral && <span className="sr-only"> (fuera de umbral)</span>}
    </td>
  )
}
