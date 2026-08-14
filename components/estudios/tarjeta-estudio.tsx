/**
 * Tarjeta de un estudio en la galería de `/estudios` (Sprint 5, tarea 5.1).
 *
 * Es un `<Link>` estilado con las mismas clases que `TarjetaInteractiva`
 * (`components/base/tarjeta.tsx`), no un `<button>`: navega a
 * `/estudios/{id}`, y un enlace real -a diferencia de un botón con
 * `router.push`- se abre en pestaña nueva, aparece en "Copiar enlace" del
 * menú contextual y lo anuncia como enlace un lector de pantalla. Ver el
 * comentario de cabecera de `tarjeta.tsx` para el motivo completo.
 *
 * Server Component puro: no necesita estado ni efectos.
 */

import Link from "next/link"

import { CLASE_TARJETA_BASE, CLASE_TARJETA_INTERACTIVA } from "@/components/base/tarjeta"
import { INFO_CATEGORIA } from "@/lib/estudios/categorias"
import { cn } from "@/lib/utils"
import type { CategoriaDocumento } from "@/types/dominio"

export interface DocumentoDeGaleria {
  id: string
  title: string
  category: CategoriaDocumento
  document_date: string
  institution: string | null
  ai_summary: string | null
}

/**
 * Fecha corta para la tarjeta, sin año -el año ya lo dice el encabezado del
 * grupo que la contiene (`lib/estudios/agrupacion.ts`)-. UTC a propósito,
 * mismo motivo que el resto de fechas `date` puras de la app: ver el
 * comentario de `lib/estudios/agrupacion.ts`.
 */
const FORMATO_FECHA_CORTA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
})

function formatearFechaCorta(fechaIso: string): string {
  return FORMATO_FECHA_CORTA.format(new Date(`${fechaIso}T00:00:00Z`))
}

export function TarjetaEstudio({ documento }: { documento: DocumentoDeGaleria }) {
  const info = INFO_CATEGORIA[documento.category]
  const Icono = info.Icono

  return (
    <Link
      href={`/estudios/${documento.id}`}
      className={cn(CLASE_TARJETA_BASE, CLASE_TARJETA_INTERACTIVA, "px-(--card-spacing)")}
    >
      <div className="flex items-start gap-3 chica:gap-2">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full chica:size-9",
            info.claseFondo,
            info.claseTexto,
          )}
          aria-hidden="true"
        >
          <Icono className="size-5 chica:size-4" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1 chica:gap-0.5">
          {/* Grande: 4 líneas -categoría, título, fecha+institución, resumen-.
              Chica (Sprint 13, tarea 13.3): la categoría y la fecha+institución
              se combinan en UNA línea para que la tarjeta ocupe menos alto
              -título + metadatos + resumen, tres líneas en vez de cuatro-. Es
              una segunda representación de los MISMOS tres datos (categoría,
              fecha, institución), no un truco de `order` que reordenaría el
              árbol para lectores de pantalla: la versión larga se oculta en
              chica (`chica:hidden`) y la combinada se oculta en grande
              (`hidden chica:block`), así que en cualquier modo dado la
              información completa aparece una sola vez, nunca duplicada ni
              perdida (docs/densidad.md §4 regla 5). */}
          <span className={cn("text-sm font-medium chica:hidden", info.claseTexto)}>
            {info.etiqueta}
          </span>

          <span className="text-lg font-semibold text-balance text-foreground">
            {documento.title}
          </span>

          <span className="text-base text-muted-foreground numeros-clinicos chica:hidden">
            {formatearFechaCorta(documento.document_date)}
            {documento.institution ? ` · ${documento.institution}` : ""}
          </span>

          {/* `chica:block` a propósito, no `chica:flex`: como flujo de texto
              normal, si "· fecha · institución" no entra en una línea se
              recorta a la izquierda del bloque completo (como cualquier
              párrafo), en vez del sangrado colgante que deja un `flex-row`
              cuando uno de los dos ítems envuelve a dos líneas. */}
          <span className="hidden chica:block chica:text-sm text-muted-foreground chica:numeros-clinicos">
            <span className={cn("font-medium", info.claseTexto)}>{info.etiqueta}</span>
            {" · "}
            {formatearFechaCorta(documento.document_date)}
            {documento.institution ? ` · ${documento.institution}` : ""}
          </span>

          {documento.ai_summary && (
            <span className="line-clamp-2 text-base text-muted-foreground chica:line-clamp-1">
              {documento.ai_summary}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
