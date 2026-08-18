"use client"

/**
 * Contenido interactivo de `/estudios/nuevo`: monta `CargadorDocumento` y, al
 * confirmar el archivo, lo sube con la Server Action `subirDocumento`
 * (`app/(app)/(con-nav)/estudios/actions.ts`). En éxito la acción hace
 * `redirect()` a `/estudios/nuevo/procesando`, así que este componente no
 * maneja el camino feliz: solo "Subiendo…", el error y el aviso de duplicado.
 *
 * ## El aviso de duplicado (hotfix de huella digital, Sprint 17 en vivo)
 *
 * Si `subirDocumento` devuelve `duplicado`, el archivo YA ESTÁ EN MEMORIA acá
 * -`archivo` en el estado, el mismo `ArchivoListo` que entregó
 * `CargadorDocumento`- así que "Cargar igual" no le pide nada de nuevo a la
 * persona: vuelve a llamar a `subir()` con el MISMO blob y `forzar: true`, que
 * arma un `FormData` con el campo oculto `forzar=1`. No hace falta reabrir el
 * selector de archivos ni volver a comprimir la foto.
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

import { useRouter } from "next/navigation"

import { subirDocumento } from "../actions"

type Estado = "eligiendo" | "subiendo" | "error" | "duplicado"

interface DuplicadoDetectado {
  documentoId: string
  titulo: string
  fechaTexto: string
}

export function PantallaNuevoEstudio() {
  const router = useRouter()
  const [estado, setEstado] = React.useState<Estado>("eligiendo")
  const [archivo, setArchivo] = React.useState<ArchivoListo | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [duplicado, setDuplicado] = React.useState<DuplicadoDetectado | null>(null)

  // Guardia SÍNCRONA contra el doble envío — mismo patrón canónico que
  // `components/coberturas/formulario-cobertura.tsx#manejarSubmit` (ese
  // comentario documenta el mecanismo completo: por qué un `ref` y no un
  // `useState`, y la reproducción real -dos invocaciones de una Server Action
  // llamada directo, sin pasar por `<form action>`- que lo motivó). Acá los
  // tres caminos que terminan llamando a `subirDocumento` -elegir un archivo,
  // "Probar de nuevo", "Cargar igual"- pasan todos por esta MISMA función
  // `subir`, así que un solo guardia alcanza para los tres.
  const enviandoRef = React.useRef(false)

  async function subir(listo: ArchivoListo, forzar = false) {
    if (enviandoRef.current) return
    enviandoRef.current = true
    setArchivo(listo)
    setError(null)
    setEstado("subiendo")

    const formData = new FormData()
    // El tercer argumento es el nombre del archivo: sin él, `FormData` manda
    // "blob" y el título provisional del documento quedaría en "blob".
    formData.append("archivo", listo.blob, listo.nombre)
    // Solo en el reintento de "Cargar igual": saltea el cotejo de huella en
    // `ingestarDocumento` (ver el encabezado del archivo).
    if (forzar) formData.append("forzar", "1")

    try {
      const resultado = await subirDocumento(formData)

      if (resultado.duplicado) {
        setDuplicado(resultado.duplicado)
        setEstado("duplicado")
        enviandoRef.current = false
      } else if (resultado.error) {
        setError(resultado.error)
        setEstado("error")
        enviandoRef.current = false
      } else if (resultado.documentoId) {
        // La acción YA NO redirige (hotfix del "error de red fantasma": un
        // `redirect()` de Server Action rechaza la promesa de quien la invoca
        // a mano, y ese rechazo terminaba en el `catch` de abajo pintando un
        // error de conexión sobre una subida exitosa — ver el "Contrato de
        // retorno" en `../actions.ts`).
        //
        // El guardia queda tomado y el estado sigue en "subiendo" a propósito:
        // la pantalla no debe volver a habilitarse mientras navega.
        router.push(`/estudios/nuevo/procesando?doc=${resultado.documentoId}`)
      }
    } catch {
      // Ahora sí: acá SOLO llegan fallas de verdad de la request (red caída,
      // request abortada, respuesta ilegible).
      setError("No pudimos subir el estudio. Revisá tu conexión y probá de nuevo.")
      setEstado("error")
      enviandoRef.current = false
    }
  }

  function reintentar() {
    if (archivo) void subir(archivo)
  }

  function cargarIgual() {
    // El archivo sigue en memoria -es el mismo `ArchivoListo` de la primera
    // vez-, así que no hace falta volver a elegirlo ni a comprimirlo.
    if (archivo) void subir(archivo, true)
  }

  function elegirOtro() {
    setArchivo(null)
    setError(null)
    setDuplicado(null)
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

      {estado === "duplicado" && duplicado && (
        <div className="flex flex-col gap-4">
          <Alerta variante="advertencia">
            Este archivo es idéntico a «{duplicado.titulo}» cargado el {duplicado.fechaTexto}.
          </Alerta>
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Boton
              render={<Link href={`/estudios/${duplicado.documentoId}`} />}
              nativeButton={false}
              size="lg"
              className="sm:flex-1"
            >
              Ver ese estudio
            </Boton>
            <Boton onClick={cargarIgual} variant="outline" size="lg" className="sm:flex-1">
              Cargar igual
            </Boton>
          </div>
          <Boton onClick={elegirOtro} variant="ghost" size="lg">
            Elegir otro archivo
          </Boton>
        </div>
      )}

      {estado === "eligiendo" && <CargadorDocumento onArchivoListo={(listo) => void subir(listo)} />}
    </div>
  )
}
