"use client"

/**
 * Contenido interactivo de `/estudios/nuevo`: monta `CargadorDocumento` y, al
 * confirmar un archivo, muestra el resultado -por ahora un mensaje "Listo
 * para subir", sin tocar la red-. El pipeline real (Server Action que sube a
 * Storage, extracción con Gemini, persistencia de métricas) es de las tareas
 * siguientes del Sprint 4 (ROADMAP_SPRINTS.md); esta pantalla es
 * deliberadamente provisoria.
 *
 * Vive en un archivo aparte de `page.tsx` porque `page.tsx` es un Server
 * Component (necesita `cookies()` para el guard de `obtenerPerfilActivo`) y
 * este pedazo necesita estado de React -mismo split que
 * `app/(app)/(sin-nav)/perfiles/page.tsx` con `SelectorPerfiles`-.
 */

import * as React from "react"
import Link from "next/link"

import { ArrowLeftIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CargadorDocumento, type ArchivoListo } from "@/components/documentos/cargador-documento"
import { formatearBytes } from "@/lib/archivos/validacion"

export function PantallaNuevoEstudio() {
  const [listo, setListo] = React.useState<ArchivoListo | null>(null)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <div className="flex items-center gap-3">
        {/* `nativeButton={false}`: ver el comentario equivalente en
            `app/(app)/(con-nav)/estudios/page.tsx` -el `render` acá también
            es un `<Link>`, no un `<button>` nativo-. */}
        <Boton
          render={<Link href="/estudios" aria-label="Volver a Estudios" />}
          nativeButton={false}
          variant="ghost"
          size="icon"
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Boton>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Subir estudio</h1>
      </div>

      <p className="text-base text-muted-foreground">
        Sacá una foto del análisis o la receta, o elegí un archivo ya guardado. Después de
        confirmarlo, en el próximo paso lo vamos a guardar y a leer automáticamente.
      </p>

      {listo ? (
        <div className="flex flex-col gap-4">
          <Alerta variante="exito">
            Listo para subir: {listo.nombre} ({formatearBytes(listo.blob.size)})
          </Alerta>
          <Boton variant="outline" size="lg" onClick={() => setListo(null)}>
            Elegir otro archivo
          </Boton>
        </div>
      ) : (
        <CargadorDocumento onArchivoListo={setListo} />
      )}
    </div>
  )
}
