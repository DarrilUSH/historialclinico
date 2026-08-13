/**
 * `/estudios`: listado mínimo de los documentos del perfil activo.
 *
 * ALCANCE DELIBERADAMENTE CHICO. La galería rica -agrupada por año y mes, con
 * filtros, búsqueda por voz, paginación y visor con signed URL- es del
 * Sprint 5 (ROADMAP_SPRINTS.md). Lo de acá es lo mínimo para poder VER que la
 * subida del Sprint 4 funcionó: título, fecha, categoría y peso, ordenados por
 * fecha del estudio de más nuevo a más viejo. Sin `<Link>` al detalle todavía,
 * porque el detalle no existe: una tarjeta que parece clickeable y no lo es es
 * peor que una que no lo parece.
 *
 * La consulta va con el cliente del USUARIO, así que la política
 * `documents_select_puede_ver` filtra por `puede_ver_perfil(profile_id)`. El
 * `.eq("profile_id", ...)` es acotación de la consulta, no la barrera de
 * seguridad: si la cookie de perfil activo estuviera forzada, RLS devolvería
 * cero filas igual (y `obtenerPerfilActivo()` ya habría rechazado el perfil
 * antes de llegar acá).
 *
 * No se audita el listado: la granularidad del enum `access_action` registra
 * "abrió un documento" (`ver_documento`, Sprint 5), no "renderizó una
 * pantalla" -misma decisión que documenta `lib/auditoria.ts` para
 * `ver_perfil`-.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { FlaskConicalIcon, UploadIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { Tarjeta } from "@/components/base/tarjeta"
import { formatearBytes } from "@/lib/archivos/validacion"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import type { CategoriaDocumento } from "@/types/dominio"

export const metadata: Metadata = {
  title: "Estudios — Historial Médico",
}

/** Tope de la lista hasta que el Sprint 5 traiga la paginación real. */
const MAXIMO_DOCUMENTOS = 100

const ETIQUETA_CATEGORIA: Record<CategoriaDocumento, string> = {
  laboratory: "Análisis de laboratorio",
  imaging: "Estudio por imágenes",
  prescription: "Receta",
  consultation: "Consulta",
  other: "Documento",
}

/**
 * `document_date` es un `date` de Postgres: llega como "2026-08-12", sin hora
 * ni zona. Se formatea **en UTC a propósito**: `new Date("2026-08-12")` se
 * parsea como medianoche UTC, y formatear eso en la hora de Ushuaia (-03)
 * mostraría "11 de agosto". Una fecha sin hora no tiene que viajar por ninguna
 * zona horaria -a diferencia de un `timestamptz` como `created_at`, que sí se
 * muestra en hora de pared de Ushuaia (ver `familia/accesos`)-.
 */
const FORMATO_FECHA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
})

function formatearFecha(fechaIso: string): string {
  return FORMATO_FECHA.format(new Date(`${fechaIso}T00:00:00Z`))
}

export default async function PaginaEstudios() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { supabase } = await requerirSesion({ desde: "/estudios" })

  const { data: documentos, error } = await supabase
    .from("documents")
    .select("id, title, category, document_date, file_size_bytes")
    .eq("profile_id", activo.perfil.id)
    .order("document_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(MAXIMO_DOCUMENTOS)

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold">No pudimos cargar los estudios</h1>
        <p className="max-w-md text-base text-muted-foreground">
          Probá recargar la página en unos segundos. Si el problema sigue, escribinos.
        </p>
      </div>
    )
  }

  if (!documentos || documentos.length === 0) {
    return <SinEstudios puedeSubir={activo.permisos.canUpload} />
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Estudios</h1>
          <p className="text-base text-muted-foreground">
            {documentos.length === 1
              ? "1 documento guardado"
              : `${documentos.length} documentos guardados`}
          </p>
        </div>
        {activo.permisos.canUpload && <BotonSubir />}
      </div>

      <ul className="flex flex-col gap-3">
        {documentos.map((documento) => (
          <li key={documento.id}>
            <Tarjeta className="gap-2 px-(--card-spacing)">
              <p className="text-lg font-semibold text-foreground">{documento.title}</p>
              <p className="text-base text-muted-foreground numeros-clinicos">
                {formatearFecha(documento.document_date)}
              </p>
              <p className="text-base text-muted-foreground">
                {ETIQUETA_CATEGORIA[documento.category]}
                {documento.file_size_bytes
                  ? ` · ${formatearBytes(documento.file_size_bytes)}`
                  : ""}
              </p>
            </Tarjeta>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* `nativeButton={false}`: el `render` es un `<Link>` (navegación real, no una
   acción de formulario), y Base UI por defecto espera que el elemento
   reemplazado sea un `<button>` nativo -sin esto tira un warning en consola
   pidiendo justo esto-. */
function BotonSubir({ className }: { className?: string }) {
  return (
    <Boton render={<Link href="/estudios/nuevo" />} nativeButton={false} size="lg" className={className}>
      <UploadIcon aria-hidden="true" />
      Subir estudio
    </Boton>
  )
}

function SinEstudios({ puedeSubir }: { puedeSubir: boolean }) {
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <span
        className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <FlaskConicalIcon className="size-8" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">Todavía no hay estudios</h1>
      <p className="max-w-sm text-base text-muted-foreground">
        Acá vas a ver los análisis, recetas e informes que vayas guardando, ordenados del más
        nuevo al más viejo.
      </p>
      {puedeSubir && <BotonSubir className="mt-2" />}
    </div>
  )
}
