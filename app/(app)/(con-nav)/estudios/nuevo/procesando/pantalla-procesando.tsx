"use client"

/**
 * Lectura automática del documento: dispara `POST /api/documentos/extraer`
 * al montar y, pase lo que pase -éxito, falla de Gemini, respuesta vacía o
 * inválida-, termina mostrando `FormularioRevision`
 * (`components/documentos/formulario-revision.tsx`), la pantalla de revisión
 * real de la tarea 4.5. Vive aparte de `page.tsx` por el mismo motivo que
 * `pantalla-carga.tsx` en `/estudios/nuevo`: `page.tsx` es un Server
 * Component (usa `cookies()` para el guard) y esto necesita `useEffect` y
 * estado de React.
 *
 * REGLA DE ORO (ROADMAP_SPRINTS.md, Sprint 4): la subida NUNCA queda
 * bloqueada por la IA. Antes esta pantalla tenía un tercer estado ("error")
 * que terminaba en un callejón sin salida -un botón "Ver mis estudios" y
 * nada más, dejando el documento provisional (título de archivo, categoría
 * "Otro") sin ninguna forma de corregirlo salvo pedirle a un `can_manage` que
 * lo edite-. Ahora CUALQUIER desenlace de la extracción lleva al mismo
 * formulario: con `extraccion` si Gemini devolvió algo válido, con
 * `extraccion: null` (+ el mensaje de error) si no.
 *
 * `disparado` (un `useRef`, no un `useState`) evita una segunda llamada real
 * a Gemini si el efecto corre dos veces -el comportamiento de React 19 en
 * modo desarrollo (Strict Mode) para detectar efectos no idempotentes-: a
 * diferencia de un simple `console.log` duplicado, acá una segunda ejecución
 * gasta cuota real de la API. Ver la explicación completa en el commit que
 * introdujo este patrón (tarea 4.3 del roadmap).
 */

import * as React from "react"

import { Loader2Icon } from "lucide-react"

import { FormularioRevision } from "@/components/documentos/formulario-revision"
import type { DocumentoMedicoExtraido } from "@/lib/gemini/schemas"
import type { CategoriaDocumento } from "@/types/dominio"

export interface PantallaProcesandoProps {
  documentoId: string
  /** Título ya guardado en `documents.title` (provisional, derivado del nombre de archivo). */
  tituloProvisional: string
  /** Categoría ya guardada en `documents.category` (default `"other"`). */
  categoriaProvisional: CategoriaDocumento
  /** Fecha ya guardada en `documents.document_date` (default: hoy). */
  fechaProvisional: string
  /** Fecha de hoy en `YYYY-MM-DD`, hora de pared de Ushuaia — tope del input date del formulario. */
  fechaMaximaIso: string
}

type Estado = "leyendo" | "revisando"

const MENSAJE_ERROR_RED =
  "No pudimos conectarnos para leer el documento. Revisá tu conexión: podés cargar los datos a mano igual."

function extraerMensajeError(cuerpo: unknown): string {
  if (
    cuerpo &&
    typeof cuerpo === "object" &&
    "error" in cuerpo &&
    typeof (cuerpo as { error: unknown }).error === "string"
  ) {
    return (cuerpo as { error: string }).error
  }
  return MENSAJE_ERROR_RED
}

function extraerDocumento(cuerpo: unknown): DocumentoMedicoExtraido | null {
  if (cuerpo && typeof cuerpo === "object" && "extraccion" in cuerpo) {
    return (cuerpo as { extraccion: DocumentoMedicoExtraido }).extraccion
  }
  return null
}

export function PantallaProcesando({
  documentoId,
  tituloProvisional,
  categoriaProvisional,
  fechaProvisional,
  fechaMaximaIso,
}: PantallaProcesandoProps) {
  const [estado, setEstado] = React.useState<Estado>("leyendo")
  const [extraccion, setExtraccion] = React.useState<DocumentoMedicoExtraido | null>(null)
  const [mensajeError, setMensajeError] = React.useState<string | null>(null)
  const disparado = React.useRef(false)

  React.useEffect(() => {
    // Ver el comentario del encabezado: evita una segunda llamada real a
    // Gemini cuando el efecto corre dos veces en Strict Mode.
    if (disparado.current) return
    disparado.current = true

    async function extraer() {
      try {
        const respuesta = await fetch("/api/documentos/extraer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentoId }),
        })

        const cuerpo: unknown = await respuesta.json().catch(() => null)
        const extraida = respuesta.ok ? extraerDocumento(cuerpo) : null

        if (extraida) {
          setExtraccion(extraida)
        } else {
          setMensajeError(extraerMensajeError(cuerpo))
        }
      } catch {
        setMensajeError(MENSAJE_ERROR_RED)
      } finally {
        // La extracción NUNCA bloquea la subida: haya salido bien o mal, se
        // pasa al formulario de revisión.
        setEstado("revisando")
      }
    }

    void extraer()
  }, [documentoId])

  if (estado === "leyendo") {
    return (
      <div
        role="status"
        className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center"
      >
        <Loader2Icon className="size-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-lg font-semibold text-foreground">Leyendo el documento…</p>
        <p className="text-base text-muted-foreground">
          Estamos buscando la fecha, la especialidad y los resultados. Puede tardar hasta medio
          minuto: no cierres esta pantalla.
        </p>
      </div>
    )
  }

  return (
    <FormularioRevision
      documentoId={documentoId}
      extraccion={extraccion}
      mensajeError={mensajeError}
      tituloProvisional={tituloProvisional}
      categoriaProvisional={categoriaProvisional}
      fechaProvisional={fechaProvisional}
      fechaMaximaIso={fechaMaximaIso}
    />
  )
}
