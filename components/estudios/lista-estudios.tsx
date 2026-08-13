/**
 * Cuerpo de `/estudios` (Sprint 5, tarea 5.1; filtros en la tarea 5.2): la
 * consulta paginada y filtrada, la agrupación por período y los estados
 * vacíos. Vive separado de `page.tsx` para poder envolverlo en
 * `<Suspense>` -mientras la consulta resuelve, la persona ve
 * `EsqueletoListaEstudios` en vez de una pantalla en blanco-, mismo motivo
 * de separación que `PantallaProcesando` documenta para
 * `/estudios/nuevo/procesando`.
 *
 * ## Paginación: "Ver más", nunca scroll infinito
 *
 * `hasta` es un límite ACUMULATIVO ("mostrar hasta N documentos"), no un
 * número de página: arranca en `POR_PAGINA` (15) y el botón "Ver más" navega
 * a `?hasta={hasta + POR_PAGINA}` (arrastrando los filtros activos, ver
 * `serializarFiltrosEstudios`) con un `<Link>` real -Server Component de
 * punta a punta, sin JavaScript de cliente ni "cargar más" que dispare solo
 * al hacer scroll (ROADMAP_SPRINTS.md, Sprint 5: "nunca scroll infinito sin
 * control")-. `count: "exact"` en la misma consulta trae el total real
 * (YA filtrado) sin una segunda ida a la base, así el botón puede mostrar
 * cuántos quedan.
 *
 * ## Por qué la consulta va acá y no en `page.tsx`
 *
 * El cliente de Supabase sale de `requerirSesion`, la MISMA guarda que usan
 * las Server Actions de este módulo: revalida sesión y deja que RLS
 * (`documents_select_puede_ver`, filtrando por `puede_ver_perfil(profile_id)`)
 * sea la barrera real. El `.eq("profile_id", perfilId)` de
 * `construirConsultaEstudios` es acotación de la consulta, no la barrera de
 * seguridad -mismo comentario que traía la versión mínima de Sprint 4-.
 *
 * ## Dos estados vacíos distintos
 *
 * `total === 0` con filtros activos (`hayFiltrosActivos(filtros)`) es "no
 * hay estudios que coincidan con ESTOS filtros" -la persona tiene
 * documentos, solo que ninguno matchea-, con la acción "Limpiar filtros".
 * `total === 0` sin filtros es el vacío REAL del perfil -nunca cargó
 * nada-, con la acción "Subir mi primer estudio" (criterio de aceptación de
 * la tarea 5.1). Confundir los dos mandaría a alguien con documentos
 * cargados a "subir tu primer estudio" solo porque el filtro no encontró
 * nada, lo cual es directamente incorrecto.
 */

import Link from "next/link"

import { FlaskConicalIcon, SearchXIcon, UploadIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { TarjetaEstudio, type DocumentoDeGaleria } from "@/components/estudios/tarjeta-estudio"
import { Skeleton } from "@/components/ui/skeleton"
import { requerirSesion } from "@/lib/auth/guardas"
import { agruparPorPeriodo } from "@/lib/estudios/agrupacion"
import { construirConsultaEstudios } from "@/lib/estudios/consultas"
import {
  hayFiltrosActivos,
  serializarFiltrosEstudios,
  type FiltrosEstudios,
} from "@/lib/estudios/filtros"

export const POR_PAGINA = 15

export interface ListaEstudiosProps {
  perfilId: string
  /** Cuántos documentos mostrar como máximo en esta carga (paginación acumulativa). */
  hasta: number
  puedeSubir: boolean
  /** Filtros ya validados (`parsearFiltrosEstudios`), aplicados a la consulta. */
  filtros: FiltrosEstudios
}

export async function ListaEstudios({ perfilId, hasta, puedeSubir, filtros }: ListaEstudiosProps) {
  const { supabase } = await requerirSesion({ desde: "/estudios" })

  const { data: documentos, count, error } = await construirConsultaEstudios(
    supabase,
    perfilId,
    filtros,
  )
    .order("document_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(0, hasta - 1)

  if (error) {
    return (
      <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-border bg-card px-4 py-10 text-center">
        <p className="text-lg font-semibold text-foreground">No pudimos cargar los estudios</p>
        <p className="max-w-md text-base text-muted-foreground">
          Probá recargar la página en unos segundos. Si el problema sigue, escribinos.
        </p>
      </div>
    )
  }

  const total = count ?? 0

  if (total === 0) {
    return hayFiltrosActivos(filtros) ? <EstadoVacioFiltrado /> : <EstadoVacio puedeSubir={puedeSubir} />
  }

  const filas = documentos ?? []
  const grupos = agruparPorPeriodo<DocumentoDeGaleria>(filas)
  const restantes = Math.max(0, total - filas.length)

  return (
    <div className="flex flex-col gap-6">
      <p className="text-base text-muted-foreground">
        {total === 1 ? "1 estudio" : `${total} estudios`}
      </p>

      {grupos.map((grupo) => (
        <section key={grupo.clave} className="flex flex-col gap-3">
          {/* `top-[73px]`: alto real de `EncabezadoPerfil` (medido en el
              navegador, `getBoundingClientRect().height` ≈ 72.8px), el
              header sticky del shell -ver su comentario en
              `components/navegacion/encabezado-perfil.tsx`-. `z-20` queda
              por debajo de su `z-30`, así el encabezado de mes se esconde
              detrás en vez de superponerse cuando ambos coinciden en pantalla.
              Fondo sólido (`bg-background`), sin blur ni translucidez -esta
              app no hace glassmorphism en ningún lado, docs/design-system.md
              §5-. */}
          <h2 className="sticky top-[73px] z-20 -mx-4 border-b border-borde-sutil bg-background px-4 py-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase sm:mx-0 sm:rounded-t-lg sm:px-1">
            {grupo.etiqueta}
          </h2>

          <ul className="flex flex-col gap-3">
            {grupo.documentos.map((documento) => (
              <li key={documento.id}>
                <TarjetaEstudio documento={documento} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {restantes > 0 && (
        <Boton
          render={
            <Link
              href={`/estudios?${serializarFiltrosEstudios(filtros, { hasta: String(hasta + POR_PAGINA) })}`}
            />
          }
          nativeButton={false}
          variant="outline"
          size="lg"
          className="w-full"
        >
          Ver más ({restantes} {restantes === 1 ? "estudio" : "estudios"})
        </Boton>
      )}
    </div>
  )
}

function EstadoVacio({ puedeSubir }: { puedeSubir: boolean }) {
  return (
    <div className="flex w-full flex-col items-center gap-4 px-4 py-12 text-center">
      <span
        className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <FlaskConicalIcon className="size-8" />
      </span>
      <h2 className="text-xl font-semibold text-balance text-foreground">
        Todavía no hay estudios cargados
      </h2>
      <p className="max-w-sm text-base text-muted-foreground">
        Acá vas a ver los análisis, recetas e informes que vayas guardando, agrupados por mes.
      </p>
      {puedeSubir && (
        <Boton
          render={<Link href="/estudios/nuevo" />}
          nativeButton={false}
          size="lg"
          className="mt-2"
        >
          <UploadIcon aria-hidden="true" />
          Subir mi primer estudio
        </Boton>
      )}
    </div>
  )
}

/**
 * Vacío por filtro (tarea 5.2): distinto del vacío real de arriba -acá SÍ
 * hay estudios cargados, ninguno matchea el filtro actual-. "Limpiar
 * filtros" navega a la ruta pelada, sin ningún search param -ni de filtro
 * ni de paginación-: `limpiarUrlFiltros` sobre un query string vacío
 * siempre da `""`, así que el link es directamente `/estudios` (mismo
 * resultado final, sin el `?` colgado de un query string vacío).
 */
function EstadoVacioFiltrado() {
  return (
    <div className="flex w-full flex-col items-center gap-4 px-4 py-12 text-center">
      <span
        className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <SearchXIcon className="size-8" />
      </span>
      <h2 className="text-xl font-semibold text-balance text-foreground">
        No hay estudios que coincidan con estos filtros
      </h2>
      <p className="max-w-sm text-base text-muted-foreground">
        Probá con otra categoría, institución o rango de fechas, o limpiá los filtros para ver todos
        los estudios de nuevo.
      </p>
      <Boton render={<Link href="/estudios" />} nativeButton={false} variant="outline" size="lg" className="mt-2">
        Limpiar filtros
      </Boton>
    </div>
  )
}

/**
 * Fallback de `<Suspense>` mientras `ListaEstudios` resuelve la consulta.
 * Dos "grupos" falsos (barra de encabezado + tres tarjetas) alcanzan para
 * comunicar la forma final sin fingir datos concretos.
 */
export function EsqueletoListaEstudios() {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">Cargando estudios…</span>
      <Skeleton className="h-5 w-32" aria-hidden="true" />

      {[0, 1].map((grupo) => (
        <div key={grupo} className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-5 w-40" />
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((tarjeta) => (
              <Skeleton key={tarjeta} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
