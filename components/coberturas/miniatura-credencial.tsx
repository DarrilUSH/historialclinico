"use client"

/**
 * Miniatura de UNA cara de una credencial en la billetera (`/coberturas`):
 * pide su propia signed URL con `?miniatura=1` -que NO audita
 * `ver_credencial`, a diferencia de abrir el visor a pantalla completa
 * (`visor-credencial.tsx`)-. Ver el bloque "`?miniatura=1`" del encabezado
 * de `app/api/credenciales/[id]/url/route.ts` para el porqué completo: es
 * el mismo criterio de granularidad que ya aplica
 * `docs/modelo-permisos.md` §6.3 a los listados ("no generan una fila cada
 * uno").
 *
 * Client Component chico a propósito: cada card de la billetera monta hasta
 * dos de estas, y cada una pide su propia URL de forma independiente -mismo
 * motivo que `components/estudios/visor-documento.tsx` es client, adaptado a
 * que acá no hace falta el manejo de expiración con temporizador (una
 * miniatura de 64px que falla en cargar simplemente no se ve; no hay una
 * pantalla completa que dependa de que siga viva)-.
 */

import * as React from "react"

import { ImageOffIcon, Loader2Icon } from "lucide-react"

interface RespuestaUrl {
  url?: string
  error?: string
}

export function MiniaturaCredencial({
  coberturaId,
  lado,
  alt,
}: {
  coberturaId: string
  lado: "front" | "back"
  alt: string
}) {
  const [url, setUrl] = React.useState<string | null>(null)
  const [estado, setEstado] = React.useState<"cargando" | "listo" | "error">("cargando")

  React.useEffect(() => {
    const controlador = new AbortController()

    async function cargar() {
      setEstado("cargando")
      try {
        const respuesta = await fetch(
          `/api/credenciales/${coberturaId}/url?lado=${lado}&miniatura=1`,
          { cache: "no-store", signal: controlador.signal },
        )
        const datos = (await respuesta.json().catch(() => null)) as RespuestaUrl | null

        if (!respuesta.ok || !datos?.url) {
          setEstado("error")
          return
        }
        setUrl(datos.url)
        setEstado("listo")
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
        setEstado("error")
      }
    }

    void cargar()
    return () => controlador.abort()
  }, [coberturaId, lado])

  if (estado === "cargando") {
    return (
      <div
        className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-border bg-muted chica:size-14"
        aria-hidden="true"
      >
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (estado === "error" || !url) {
    return (
      <div
        className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground chica:size-14"
        aria-hidden="true"
      >
        <ImageOffIcon className="size-5" />
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- signed URL de vida corta, ver visor-documento.tsx
    <img
      src={url}
      alt={alt}
      className="size-16 shrink-0 rounded-lg border border-border object-cover chica:size-14"
    />
  )
}
