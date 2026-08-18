"use client"

/**
 * Contenido interactivo de `/estudios/nuevo`: monta `CargadorDocumento` y, al
 * confirmar el archivo, lo sube con la Server Action `subirDocumento`
 * (`app/(app)/(con-nav)/estudios/actions.ts`). En éxito la acción hace
 * `redirect()` a `/estudios/nuevo/procesando`, así que este componente no
 * maneja el camino feliz: solo el estado "Subiendo…" y el error.
 *
 * Vive en un archivo aparte de `page.tsx` porque `page.tsx` es un Server
 * Component (necesita `cookies()` para el guard de `obtenerPerfilActivo`) y
 * este pedazo necesita estado de React -mismo split que
 * `app/(app)/(sin-nav)/perfiles/page.tsx` con `SelectorPerfiles`-.
 *
 * ## Por qué "Subiendo…" y no una barra de progreso
 *
 * El archivo puede pesar varios MB y la subida por datos móviles puede tardar
 * bastante, así que el estado tiene que ser evidente. Pero una Server Action
 * se invoca como una llamada de función: el `FormData` lo serializa el runtime
 * de React y **no expone eventos de progreso** (harían falta `XMLHttpRequest`
 * o un `ReadableStream` con `duplex: "half"`, es decir un Route Handler
 * aparte, que este sprint no tiene). Se muestra entonces un spinner con el
 * peso real del archivo -"Subiendo… 1,8 MB"-, que es información honesta:
 * dice qué se está mandando y cuánto pesa, sin inventar un porcentaje falso.
 * La barra real es candidata para cuando el Sprint 11 sume el Route Handler de
 * ingesta compartida.
 *
 * Durante la subida el cargador se desmonta a propósito: no hay forma de
 * cancelar una Server Action en curso, así que dejar visible un botón "Elegir
 * otro" que no puede detener nada sería mentirle a la persona.
 *
 * ## Velo de espera (Sprint 14, "Feedback de espera global")
 *
 * "Subiendo el archivo…" es la primera de las tres etapas REALES de la
 * ingesta -las otras dos, "La inteligencia artificial está leyendo tu
 * estudio…" y "Guardando…", viven en `procesando/pantalla-procesando.tsx` y
 * en `components/documentos/formulario-revision.tsx` respectivamente, porque
 * son las tres llamadas de red separadas que existen de verdad en este
 * flujo (Server Action de subida → `fetch` a `/api/documentos/extraer` →
 * Server Action de confirmación), cada una en la pantalla donde ocurre-. El
 * `<div role="status">` que mostraba esta misma información inline se
 * reemplazó por `<VeloEspera>`: los dos cumplían el mismo propósito (bloquear
 * la pantalla y avisar), así que mantener las dos habría duplicado la región
 * viva para un lector de pantalla. El peso del archivo sigue mostrándose,
 * ahora como submensaje.
 */

import * as React from "react"
import Link from "next/link"

import { ArrowLeftIcon, UploadIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { VeloEspera } from "@/components/base/velo-espera"
import { CargadorDocumento, type ArchivoListo } from "@/components/documentos/cargador-documento"
import { formatearBytes } from "@/lib/archivos/validacion"

import { subirDocumento } from "../actions"

type Estado = "eligiendo" | "subiendo" | "error"

export function PantallaNuevoEstudio() {
  const [estado, setEstado] = React.useState<Estado>("eligiendo")
  const [archivo, setArchivo] = React.useState<ArchivoListo | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function subir(listo: ArchivoListo) {
    setArchivo(listo)
    setError(null)
    setEstado("subiendo")

    const formData = new FormData()
    // El tercer argumento es el nombre del archivo: sin él, `FormData` manda
    // "blob" y el título provisional del documento quedaría en "blob".
    formData.append("archivo", listo.blob, listo.nombre)

    try {
      // En éxito esta llamada no vuelve: la acción redirige a
      // `/estudios/nuevo/procesando`.
      const resultado = await subirDocumento(formData)

      if (resultado?.error) {
        setError(resultado.error)
        setEstado("error")
      }
    } catch {
      // Red caída, request abortada, respuesta ilegible. Un `redirect()` de la
      // Server Action NO cae acá: lo intercepta el runtime de React antes.
      setError("No pudimos subir el estudio. Revisá tu conexión y probá de nuevo.")
      setEstado("error")
    }
  }

  function reintentar() {
    if (archivo) void subir(archivo)
  }

  function elegirOtro() {
    setArchivo(null)
    setError(null)
    setEstado("eligiendo")
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
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
        Sacá una foto del análisis o la receta, o elegí un archivo ya guardado. Cuando lo
        confirmes lo guardamos en tu historial.
      </p>

      <VeloEspera
        visible={estado === "subiendo"}
        mensaje="Subiendo el archivo…"
        submensaje={
          archivo
            ? `${archivo.nombre} — ${formatearBytes(archivo.blob.size)}. Esto puede tardar hasta un minuto. No cierres la aplicación.`
            : "Esto puede tardar hasta un minuto. No cierres la aplicación."
        }
      />

      {estado === "error" && (
        <div className="flex flex-col gap-4">
          <Alerta variante="error">{error}</Alerta>
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Boton onClick={reintentar} size="lg" className="sm:flex-1">
              <UploadIcon aria-hidden="true" />
              Probar de nuevo
            </Boton>
            <Boton onClick={elegirOtro} variant="outline" size="lg" className="sm:flex-1">
              Elegir otro archivo
            </Boton>
          </div>
        </div>
      )}

      {estado === "eligiendo" && <CargadorDocumento onArchivoListo={(listo) => void subir(listo)} />}
    </div>
  )
}
