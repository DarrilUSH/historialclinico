/**
 * `/estudios`: galería cronológica de los documentos del perfil activo
 * (Sprint 5, tarea 5.1).
 *
 * El Sprint 4 dejó acá un listado mínimo -sin agrupar, sin paginar, tope
 * fijo de 100 filas- solo para verificar que la subida funcionaba. Esta
 * versión es la galería real del roadmap: agrupada por año y mes
 * (`components/estudios/lista-estudios.tsx`), con paginación "Ver más" y
 * skeletons de carga. Los FILTROS (especialidad, institución, rango de
 * fechas, búsqueda por voz) y el VISOR de documento son las dos tareas
 * siguientes del roadmap (5.2 y 5.3): a propósito no hay nada de eso acá
 * todavía, más allá del stub de navegación en `[id]/page.tsx`.
 *
 * Esta página resuelve solo el GUARDA (perfil activo) y el encabezado -título
 * y botón "Subir estudio", que no dependen de ningún documento-. La consulta
 * de documentos, la paginación y el estado vacío viven en `ListaEstudios`,
 * envuelto en `<Suspense>` para que la carga de datos no bloquee el primer
 * pintado del encabezado.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense } from "react"

import { UploadIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { AvisoConfirmacion } from "@/components/estudios/aviso-confirmacion"
import { EsqueletoListaEstudios, ListaEstudios, POR_PAGINA } from "@/components/estudios/lista-estudios"
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

export default async function PaginaEstudios({
  searchParams,
}: {
  searchParams: Promise<{ hasta?: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { hasta: hastaCrudo } = await searchParams
  const hasta = normalizarHasta(hastaCrudo)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <Suspense fallback={null}>
        <AvisoConfirmacion />
      </Suspense>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Estudios</h1>
        {activo.permisos.canUpload && <BotonSubir />}
      </div>

      {/* `key={hasta}`: al navegar a un `hasta` distinto ("Ver más"), fuerza
          a React a tratarlo como un árbol nuevo y volver a mostrar el
          fallback en vez de dejar el contenido previo colgado mientras la
          consulta más grande resuelve. */}
      <Suspense key={hasta} fallback={<EsqueletoListaEstudios />}>
        <ListaEstudios
          perfilId={activo.perfil.id}
          hasta={hasta}
          puedeSubir={activo.permisos.canUpload}
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
