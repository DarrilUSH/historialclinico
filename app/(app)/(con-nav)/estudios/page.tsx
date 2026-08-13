/**
 * `/estudios`: galería cronológica de los documentos del perfil activo
 * (Sprint 5, tarea 5.1) con filtros persistidos en la URL (tarea 5.2).
 *
 * El Sprint 4 dejó acá un listado mínimo -sin agrupar, sin paginar, tope
 * fijo de 100 filas- solo para verificar que la subida funcionaba. Esta
 * versión es la galería real del roadmap: agrupada por año y mes
 * (`components/estudios/lista-estudios.tsx`), con paginación "Ver más",
 * skeletons de carga y la barra de filtros (`components/estudios/filtros-estudios.tsx`).
 * El VISOR de documento es la tarea siguiente del roadmap (5.3): a propósito
 * no hay nada de eso acá todavía, más allá del stub de navegación en
 * `[id]/page.tsx`.
 *
 * Esta página resuelve el GUARDA (perfil activo), el encabezado -título y
 * botón "Subir estudio", que no dependen de ningún documento-, parsea y
 * valida los `searchParams` de filtro (`parsearFiltrosEstudios`) y trae las
 * instituciones distintas del perfil para poblar el `<Select>` de
 * `FiltrosEstudios` -consulta liviana, fuera del `<Suspense>` de la lista a
 * propósito, para que la barra de filtros no parpadee ni quede bloqueada
 * mientras la consulta (más pesada, filtrada) de `ListaEstudios` resuelve-.
 * La consulta de documentos, la paginación y los dos estados vacíos viven en
 * `ListaEstudios`, envuelto en `<Suspense>` para que la carga de datos no
 * bloquee el primer pintado del encabezado ni de la barra de filtros.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense } from "react"

import { UploadIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { AvisoConfirmacion } from "@/components/estudios/aviso-confirmacion"
import { FiltrosEstudios } from "@/components/estudios/filtros-estudios"
import { EsqueletoListaEstudios, ListaEstudios, POR_PAGINA } from "@/components/estudios/lista-estudios"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerInstitucionesDistintas } from "@/lib/estudios/consultas"
import {
  parsearFiltrosEstudios,
  type SearchParamsFiltrosEstudios,
} from "@/lib/estudios/filtros"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Estudios — Historial Médico",
}

/**
 * Tope defensivo de `?hasta=`: un valor manipulado a mano (`?hasta=999999999`)
 * no debería poder forzar una consulta de rango arbitrariamente grande. En la
 * práctica nadie llega ni cerca de esto a mano tocando "Ver más".
 */
const HASTA_MAXIMO = 2000

function normalizarHasta(crudo: string | undefined): number {
  const numero = Number(crudo)
  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero <= 0) {
    return POR_PAGINA
  }
  return Math.min(numero, HASTA_MAXIMO)
}

type SearchParamsPagina = SearchParamsFiltrosEstudios & { hasta?: string }

export default async function PaginaEstudios({
  searchParams,
}: {
  searchParams: Promise<SearchParamsPagina>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const paramsCrudos = await searchParams
  const hasta = normalizarHasta(paramsCrudos.hasta)
  const filtros = parsearFiltrosEstudios(paramsCrudos)

  // Consulta propia y liviana (solo la columna `institution`), separada de
  // la de `ListaEstudios`: ver el comentario de cabecera sobre por qué vive
  // acá y no dentro del `<Suspense>` de la lista.
  const { supabase } = await requerirSesion({ desde: "/estudios" })
  const instituciones = await obtenerInstitucionesDistintas(supabase, activo.perfil.id)

  // Clave del `<Suspense>`: cualquier combinación distinta de filtros o de
  // paginación es, a todos los efectos, un árbol nuevo -mismo motivo que ya
  // documentaba `key={hasta}` para "Ver más", extendido a los cinco filtros:
  // sin esto, cambiar de categoría dejaría el listado anterior colgado en
  // pantalla mientras la consulta filtrada nueva resuelve, en vez de mostrar
  // el skeleton.
  const claveSuspense = JSON.stringify({ hasta, ...filtros })

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <Suspense fallback={null}>
        <AvisoConfirmacion />
      </Suspense>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Estudios</h1>
        {activo.permisos.canUpload && <BotonSubir />}
      </div>

      <FiltrosEstudios instituciones={instituciones} />

      <Suspense key={claveSuspense} fallback={<EsqueletoListaEstudios />}>
        <ListaEstudios
          perfilId={activo.perfil.id}
          hasta={hasta}
          puedeSubir={activo.permisos.canUpload}
          filtros={filtros}
        />
      </Suspense>
    </div>
  )
}

/* `nativeButton={false}`: el `render` es un `<Link>` (navegación real, no una
   acción de formulario), y Base UI por defecto espera que el elemento
   reemplazado sea un `<button>` nativo -sin esto tira un warning en consola
   pidiendo justo esto-. */
function BotonSubir() {
  return (
    <Boton render={<Link href="/estudios/nuevo" />} nativeButton={false} size="lg">
      <UploadIcon aria-hidden="true" />
      Subir estudio
    </Boton>
  )
}
