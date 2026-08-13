"use client"

/**
 * Visor del archivo de un estudio (Sprint 5, tarea 5.3): pide una signed URL
 * a `GET /api/documentos/{id}/url` y renderiza el archivo -imagen o PDF-,
 * con los controles "Abrir el documento" y "Descargar".
 *
 * Client Component a propósito -mismo motivo que `pantalla-procesando.tsx`
 * documenta para su propio `fetch`-: la signed URL es un secreto de vida
 * corta que no tiene sentido incrustar en el HTML servido (quedaría en el
 * cache de Next, en el historial del navegador, en cualquier proxy
 * intermedio), y el visor necesita poder REINTENTAR sin recargar toda la
 * página cuando la URL vence mientras la persona sigue mirando la pantalla.
 *
 * ## Por qué `<img>` normal y NO `next/image`
 *
 * `next/image` optimiza asumiendo que la URL de origen es estable -la usa
 * como clave de cache del optimizador y del `srcset` que genera-. Una signed
 * URL cambia de token en cada pedido y expira a los `TTL_MAXIMO_SEGUNDOS`
 * (`lib/storage-admin.ts`, 300s): pedirle a `next/image` que la optimice
 * agregaría una capa de cache para un recurso pensado para NO cachearse, y
 * el dominio de Supabase Storage ni siquiera está en `images.remotePatterns`
 * (agregarlo solo para 300 segundos de vida no tiene sentido). Un `<img>`
 * llano pide exactamente la URL que se le da, ni una vez más ni una vez
 * menos.
 *
 * ## Los tres estados de error, y por qué son estados distintos
 *
 * - `"error"`: el pedido inicial de la signed URL falló (404 sin objeto en
 *   Storage -el caso real de los documentos del seed-, 403, 500, sin red).
 *   Se muestra el mensaje que ya viene en español desde la API.
 * - `"expirado"`: la URL se sirvió bien, pero el temporizador local (armado
 *   con el `expiraEn` que devuelve la API) venció mientras la pantalla seguía
 *   abierta. Es un estado DISTINTO de `"error"` porque el diagnóstico y la
 *   acción son distintos: acá no hay nada roto, es el comportamiento
 *   esperado de una URL de vida corta, y "Volver a cargar" alcanza para
 *   resolverlo sin recargar la página.
 * - El margen de 2 segundos antes del vencimiento real (`expiraEn - 2`) es
 *   deliberado: mostrar el aviso un toque antes de que la URL deje de sonar
 *   evita la carrera de "la imagen está a mitad de cargar justo cuando
 *   Storage ya rechazó el token".
 */

import * as React from "react"

import { DownloadIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { Skeleton } from "@/components/ui/skeleton"

export interface VisorDocumentoProps {
  documentoId: string
  /** `documents.mime_type`. `null` en documentos muy viejos sin este dato -se trata como PDF, el formato más común. */
  mimeType: string | null
  /** `documents.title`, para el `alt` de la imagen, el `title` del iframe y el nombre de la descarga. */
  titulo: string
}

type EstadoVisor = "cargando" | "listo" | "error" | "expirado"

interface RespuestaUrl {
  url?: string
  expiraEn?: number
  error?: string
}

const MENSAJE_ERROR_RED =
  "No pudimos conectarnos para abrir el documento. Revisá tu conexión y probá de nuevo."
const MENSAJE_ERROR_DESCARGA =
  "No pudimos preparar la descarga. Probá de nuevo en unos segundos."

/** Margen antes del vencimiento real: ver el bloque "los tres estados de error" del encabezado. */
const MARGEN_EXPIRACION_SEGUNDOS = 2

async function pedirUrl(
  documentoId: string,
  descargar: boolean,
  signal?: AbortSignal,
): Promise<RespuestaUrl> {
  const query = descargar ? "?descargar=1" : ""
  const respuesta = await fetch(`/api/documentos/${documentoId}/url${query}`, {
    cache: "no-store",
    signal,
  })
  const cuerpo: unknown = await respuesta.json().catch(() => null)
  const datos = (cuerpo ?? {}) as RespuestaUrl

  if (!respuesta.ok) {
    return { error: datos.error ?? MENSAJE_ERROR_RED }
  }
  return datos
}

export function VisorDocumento({ documentoId, mimeType, titulo }: VisorDocumentoProps) {
  const [estado, setEstado] = React.useState<EstadoVisor>("cargando")
  const [url, setUrl] = React.useState<string | null>(null)
  const [mensajeError, setMensajeError] = React.useState<string>(MENSAJE_ERROR_RED)
  const [descargando, setDescargando] = React.useState(false)
  // Se bumpea para forzar una nueva carga desde "Volver a intentar" / "Volver
  // a cargar el documento", sin llamar a una función que haga `setState`
  // DENTRO del cuerpo del efecto -el lint `react-hooks/set-state-in-effect`
  // lo marca como anti-patrón incluso para un `fetch` legítimo si la función
  // async vive fuera del efecto (`useCallback`). El patrón que ya usa
  // `pantalla-procesando.tsx` (`async function` DEFINIDA DENTRO del efecto)
  // no dispara el lint, así que acá se replica: el botón de reintento solo
  // cambia `intento`, y es ESE cambio de dependencia el que hace que el
  // efecto vuelva a correr y pida la URL de nuevo.
  const [intento, setIntento] = React.useState(0)

  React.useEffect(() => {
    // `AbortController`, no un simple flag booleano: React 19 en desarrollo
    // (Strict Mode) ejecuta este efecto dos veces (monta → limpia → monta de
    // nuevo) para detectar efectos no idempotentes. Un flag `cancelado` solo
    // frenaría el `setState` del PRIMER pedido, pero la petición HTTP igual
    // llegaría a destino -y el Route Handler audita `ver_documento` en cada
    // pedido que logra firmar la URL (`app/api/documentos/[id]/url/route.ts`,
    // paso 5)-, así que dos montajes producirían DOS filas de auditoría por
    // una sola apertura real de la pantalla. Abortar la request del primer
    // montaje cuando React lo limpia hace que esa primera petición nunca
    // llegue a completarse: solo el segundo montaje (el que persiste) firma
    // la URL y audita. Mismo mecanismo protege el cambio real de `intento` al
    // reintentar: la petición vieja se cancela en vez de competir con la
    // nueva por escribir el estado.
    const controlador = new AbortController()
    let idTemporizador: ReturnType<typeof setTimeout> | null = null

    async function cargar() {
      setEstado("cargando")

      try {
        const datos = await pedirUrl(documentoId, false, controlador.signal)

        if (!datos.url || typeof datos.expiraEn !== "number") {
          setMensajeError(datos.error ?? MENSAJE_ERROR_RED)
          setEstado("error")
          return
        }

        setUrl(datos.url)
        setEstado("listo")

        const segundosHastaAviso = Math.max(0, datos.expiraEn - MARGEN_EXPIRACION_SEGUNDOS)
        idTemporizador = setTimeout(() => setEstado("expirado"), segundosHastaAviso * 1000)
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          // Este pedido se canceló porque el efecto se limpió (ver el
          // comentario de arriba): no es un error para mostrarle a nadie, y
          // el próximo montaje/`intento` ya se encarga de pedir la URL real.
          return
        }
        setMensajeError(MENSAJE_ERROR_RED)
        setEstado("error")
      }
    }

    void cargar()

    return () => {
      controlador.abort()
      if (idTemporizador) clearTimeout(idTemporizador)
    }
  }, [documentoId, intento])

  function reintentar() {
    setIntento((valor) => valor + 1)
  }

  async function manejarDescarga() {
    setDescargando(true)
    try {
      const datos = await pedirUrl(documentoId, true)
      if (!datos.url) {
        toast.error("No pudimos descargar el documento", {
          description: datos.error ?? MENSAJE_ERROR_DESCARGA,
        })
        return
      }
      // Navegar a la URL firmada con `download=` dispara la descarga del
      // navegador (`Content-Disposition: attachment`) sin abrir pestaña
      // nueva ni perder esta pantalla.
      window.location.href = datos.url
    } catch {
      toast.error("No pudimos descargar el documento", { description: MENSAJE_ERROR_DESCARGA })
    } finally {
      setDescargando(false)
    }
  }

  if (estado === "cargando") {
    return (
      <div role="status" className="flex flex-col gap-3">
        <span className="sr-only">Cargando el documento…</span>
        <Skeleton className="h-72 w-full rounded-xl" aria-hidden="true" />
        <Skeleton className="h-11 w-full rounded-lg" aria-hidden="true" />
      </div>
    )
  }

  if (estado === "error") {
    return (
      <Alerta variante="error" titulo="No pudimos abrir el documento">
        <p>{mensajeError}</p>
        <Boton variant="outline" size="lg" className="mt-3" onClick={reintentar}>
          <RefreshCwIcon aria-hidden="true" />
          Volver a intentar
        </Boton>
      </Alerta>
    )
  }

  if (estado === "expirado") {
    return (
      <Alerta variante="advertencia" titulo="El enlace del documento venció">
        <p>
          Por seguridad, el enlace para ver este archivo solo dura unos minutos. Volvé a cargarlo
          para seguir viéndolo.
        </p>
        <Boton size="lg" className="mt-3" onClick={reintentar}>
          <RefreshCwIcon aria-hidden="true" />
          Volver a cargar el documento
        </Boton>
      </Alerta>
    )
  }

  // estado === "listo": `url` está garantizado por el efecto de arriba.
  const esImagen = mimeType?.startsWith("image/") ?? false

  return (
    <div className="flex flex-col gap-3">
      {esImagen ? (
        // eslint-disable-next-line @next/next/no-img-element -- ver el bloque "Por qué <img> normal" del encabezado.
        <img
          src={url ?? undefined}
          alt={`Documento: ${titulo}`}
          className="w-full rounded-xl border border-border bg-muted object-contain"
          onError={() => setEstado("expirado")}
        />
      ) : (
        <iframe
          src={url ?? undefined}
          title={`Documento: ${titulo}`}
          className="h-[70vh] w-full rounded-xl border border-border bg-muted"
        />
      )}

      {!esImagen && (
        <p className="text-sm text-muted-foreground">
          En el celular, la vista del PDF puede verse recortada. Si no se lee bien, usá “Abrir el
          documento”.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Boton
          render={<a href={url ?? undefined} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
          variant="outline"
          size="lg"
          className="sm:flex-1"
        >
          <ExternalLinkIcon aria-hidden="true" />
          Abrir el documento
        </Boton>
        <Boton size="lg" cargando={descargando} onClick={manejarDescarga} className="sm:flex-1">
          <DownloadIcon aria-hidden="true" />
          Descargar
        </Boton>
      </div>
    </div>
  )
}
