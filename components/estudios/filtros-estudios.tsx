"use client"

/**
 * Barra de filtros de `/estudios` (Sprint 5, tarea 5.2): categoría,
 * institución, rango de fechas y búsqueda de texto libre, todo persistido
 * en la URL (`lib/estudios/consultas.ts` documenta los nombres exactos de
 * cada search param y por qué no colisionan con `?hasta=` de paginación).
 *
 * ## Qué queda siempre visible y qué se colapsa en móvil
 *
 * El BUSCADOR queda SIEMPRE visible, en las dos resoluciones: es el filtro
 * de menor fricción (tipear o dictar una palabra) y el que trae el botón de
 * dictado (`conDictado` de `campo-texto.tsx`, Sprint 3) -esconderlo detrás
 * de un toggle adicional le agregaría un paso a la interacción más simple
 * que ofrece esta barra-. Categoría, Institución y el rango Desde/Hasta -los
 * cuatro filtros "estructurados"- sí se colapsan detrás del botón "Filtrar"
 * en pantallas angostas, con un badge que cuenta cuántos de esos cuatro
 * están activos ahora mismo. En `sm:` y para arriba los cuatro se ven en
 * línea sin necesidad de tocar nada.
 *
 * ## Por qué la URL es la única fuente de verdad
 *
 * Cada control (los dos `<Select>`, los dos inputs de fecha, el buscador)
 * lee su valor actual de `useSearchParams()` y escribe cambios con
 * `router.replace()` -nunca queda estado de filtro que viva solo en React y
 * no en la URL-. Esto es lo que hace que recargar la página mantenga los
 * filtros (criterio del roadmap) sin ningún `localStorage` ni contexto
 * extra: la URL ES el estado.
 *
 * El buscador es la única excepción parcial: tiene un `useState` local
 * (`textoBusqueda`) para no navegar en cada tecla, con un debounce de 400ms
 * antes de reflejar el valor en la URL. Mientras el debounce no disparó, el
 * campo y la URL pueden estar momentáneamente desincronizados a propósito;
 * un ajuste EN RENDER (no un efecto, ver el comentario junto a
 * `ultimoQDeUrl` más abajo) los vuelve a alinear si la URL cambia por otra
 * vía (un chip removido, "Limpiar todo", navegación atrás/adelante del
 * navegador).
 *
 * Cualquier cambio de filtro reinicia la paginación (`aplicarCambiosUrlFiltros`
 * borra `?hasta=`): mostrar "hasta 45 documentos" ya no tiene sentido para
 * un conjunto de resultados distinto.
 */

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { FilterIcon, SearchIcon, XIcon } from "lucide-react"

import { CampoTexto } from "@/components/base/campo-texto"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CATEGORIAS_EN_ORDEN, INFO_CATEGORIA } from "@/lib/estudios/categorias"
import {
  aplicarCambiosUrlFiltros,
  contarFiltrosActivos,
  limpiarUrlFiltros,
  parsearFiltrosEstudios,
} from "@/lib/estudios/filtros"
import { cn } from "@/lib/utils"

export interface FiltrosEstudiosProps {
  /** Instituciones distintas de los documentos del perfil, ya ordenadas (`obtenerInstitucionesDistintas`). */
  instituciones: string[]
}

/** Sentinel del ítem "Todas" de cada `<Select>`: nunca colisiona con una categoría real ni con el nombre de una institución (no hay institución de un solo valor reservado, pero por las dudas se compara por referencia al armar la URL, no por substring). */
const VALOR_TODAS = "todas"

const DEBOUNCE_BUSQUEDA_MS = 400

const FORMATO_FECHA_CHIP = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

/** `"2026-01-05"` -> `"05/01/2026"`. UTC a propósito: es una fecha pura de filtro, sin hora (mismo motivo que documenta `lib/estudios/agrupacion.ts`). */
function formatearFechaChip(iso: string): string {
  return FORMATO_FECHA_CHIP.format(new Date(`${iso}T00:00:00Z`))
}

export function FiltrosEstudios({ instituciones }: FiltrosEstudiosProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const filtros = parsearFiltrosEstudios({
    categoria: searchParams.get("categoria") ?? undefined,
    institucion: searchParams.get("institucion") ?? undefined,
    desde: searchParams.get("desde") ?? undefined,
    hasta_fecha: searchParams.get("hasta_fecha") ?? undefined,
    q: searchParams.get("q") ?? undefined,
  })

  const cantidadPanel = [filtros.categoria, filtros.institucion, filtros.desde, filtros.hastaFecha].filter(
    Boolean,
  ).length
  const cantidadTotal = contarFiltrosActivos(filtros)

  const [abierto, setAbierto] = React.useState(cantidadPanel > 0)

  // `qDeUrl` es el `q` CRUDO de la URL (sin el recorte/trim de
  // `parsearFiltrosEstudios`, que es para la consulta, no para lo que se
  // muestra en el campo). El campo y el rastreo de "último valor visto"
  // arrancan de ese mismo valor crudo para que nunca se desincronicen entre
  // sí en el primer render.
  const qDeUrl = searchParams.get("q") ?? ""
  const [textoBusqueda, setTextoBusqueda] = React.useState(qDeUrl)

  // Mantiene el campo alineado si la URL cambia por otra vía (chip
  // removido, "Limpiar todo", atrás/adelante del navegador) mientras no hay
  // un debounce propio en vuelo. Ajuste EN RENDER, no en un efecto -patrón
  // recomendado por React para "sincronizar estado cuando cambia una prop
  // externa" (acá, el `q` de la URL): dispara un re-render inmediato antes
  // de pintar, sin el parpadeo de un efecto que corre después del commit.
  const [ultimoQDeUrl, setUltimoQDeUrl] = React.useState(qDeUrl)
  if (qDeUrl !== ultimoQDeUrl) {
    setUltimoQDeUrl(qDeUrl)
    setTextoBusqueda(qDeUrl)
  }

  function navegar(cambios: Record<string, string | null>) {
    const query = aplicarCambiosUrlFiltros(searchParams, cambios)
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  React.useEffect(() => {
    const actual = searchParams.get("q") ?? ""
    if (textoBusqueda === actual) return
    const id = setTimeout(() => {
      navegar({ q: textoBusqueda || null })
    }, DEBOUNCE_BUSQUEDA_MS)
    return () => clearTimeout(id)
    // Solo debe reprogramarse cuando cambia el texto tipeado/dictado: `navegar`
    // y `searchParams` son estables entre renders para este propósito (mismo
    // patrón que `aviso-confirmacion.tsx`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textoBusqueda])

  const valorCategoria = filtros.categoria ?? VALOR_TODAS
  const valorInstitucion = filtros.institucion ?? VALOR_TODAS

  const itemsCategoria = [
    { value: VALOR_TODAS, label: "Todas las categorías" },
    ...CATEGORIAS_EN_ORDEN.map((categoria) => ({
      value: categoria as string,
      label: INFO_CATEGORIA[categoria].etiqueta,
    })),
  ]

  const itemsInstitucion = [
    { value: VALOR_TODAS, label: "Todas las instituciones" },
    ...instituciones.map((institucion) => ({ value: institucion, label: institucion })),
  ]

  const chips: { id: string; etiqueta: string; quitar: () => void }[] = []
  if (filtros.categoria) {
    chips.push({
      id: "categoria",
      etiqueta: INFO_CATEGORIA[filtros.categoria].etiqueta,
      quitar: () => navegar({ categoria: null }),
    })
  }
  if (filtros.institucion) {
    chips.push({
      id: "institucion",
      etiqueta: filtros.institucion,
      quitar: () => navegar({ institucion: null }),
    })
  }
  if (filtros.desde) {
    chips.push({
      id: "desde",
      etiqueta: `Desde ${formatearFechaChip(filtros.desde)}`,
      quitar: () => navegar({ desde: null }),
    })
  }
  if (filtros.hastaFecha) {
    chips.push({
      id: "hasta_fecha",
      etiqueta: `Hasta ${formatearFechaChip(filtros.hastaFecha)}`,
      quitar: () => navegar({ hasta_fecha: null }),
    })
  }
  if (filtros.q) {
    chips.push({ id: "q", etiqueta: `"${filtros.q}"`, quitar: () => navegar({ q: null }) })
  }

  function limpiarTodo() {
    const query = limpiarUrlFiltros(searchParams)
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <div className="flex flex-col gap-3 chica:gap-2">
      {/* Chica (Sprint 13, tarea 13.3): buscador + micrófono + "Filtrar" en
          una sola línea apretada, reutilizando el mismo layout de fila que ya
          usa `sm:` -acá disparado por el modo compacto en vez de por el
          ancho de pantalla, así que ya viene probado-. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end chica:flex-row chica:items-end chica:gap-2">
        <CampoTexto
          id="buscador-estudios"
          label="Buscar"
          placeholder="Título, resumen o institución"
          icono={<SearchIcon aria-hidden="true" />}
          value={textoBusqueda}
          onChange={(evento) => setTextoBusqueda(evento.target.value)}
          conDictado
          contenedorClassName="flex-1"
        />

        <button
          type="button"
          onClick={() => setAbierto((valor) => !valor)}
          aria-expanded={abierto}
          aria-controls="panel-filtros-estudios"
          aria-label={
            cantidadPanel > 0
              ? `Filtrar (${cantidadPanel} ${cantidadPanel === 1 ? "filtro activo" : "filtros activos"})`
              : "Filtrar"
          }
          className="inline-flex min-h-tactil shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-base font-medium text-foreground transition-colors hover:bg-muted sm:hidden chica:px-3"
        >
          <FilterIcon className="size-5" aria-hidden="true" />
          <span className="chica:hidden">Filtrar</span>
          {cantidadPanel > 0 && (
            <span
              aria-hidden="true"
              className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
            >
              {cantidadPanel}
            </span>
          )}
        </button>
      </div>

      <div
        id="panel-filtros-estudios"
        className={cn(
          "flex-col gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-end chica:gap-2",
          abierto ? "flex" : "hidden",
        )}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="categoria-filtro-trigger">Categoría</Label>
          <Select
            items={itemsCategoria}
            value={valorCategoria}
            onValueChange={(valor) =>
              navegar({ categoria: !valor || valor === VALOR_TODAS ? null : valor })
            }
          >
            <SelectTrigger id="categoria-filtro-trigger" className="w-full sm:w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {itemsCategoria.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="institucion-filtro-trigger">Institución</Label>
          <Select
            items={itemsInstitucion}
            value={valorInstitucion}
            onValueChange={(valor) =>
              navegar({ institucion: !valor || valor === VALOR_TODAS ? null : valor })
            }
          >
            <SelectTrigger id="institucion-filtro-trigger" className="w-full sm:w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {itemsInstitucion.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <CampoTexto
          id="desde-filtro"
          label="Desde"
          type="date"
          value={filtros.desde ?? ""}
          onChange={(evento) => navegar({ desde: evento.target.value || null })}
          contenedorClassName="w-full sm:w-auto"
        />

        <CampoTexto
          id="hasta-filtro"
          label="Hasta"
          type="date"
          value={filtros.hastaFecha ?? ""}
          onChange={(evento) => navegar({ hasta_fecha: evento.target.value || null })}
          contenedorClassName="w-full sm:w-auto"
        />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 chica:gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={chip.quitar}
              aria-label={`Quitar filtro ${chip.etiqueta}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/70 chica:gap-1 chica:px-2.5 chica:py-1 chica:text-xs"
            >
              {chip.etiqueta}
              <XIcon className="size-3.5 chica:size-3" aria-hidden="true" />
            </button>
          ))}

          {cantidadTotal >= 2 && (
            <button
              type="button"
              onClick={limpiarTodo}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline chica:text-xs"
            >
              Limpiar todo
            </button>
          )}
        </div>
      )}
    </div>
  )
}
