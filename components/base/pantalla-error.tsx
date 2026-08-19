"use client"

/**
 * El estado de error de pantalla completa que ven las personas cuando el
 * servidor no pudo armar una pantalla.
 *
 * ## Por qué existe (P0 del 2026-08-19)
 *
 * El dueño abrió `/estudios` en su teléfono y vio la pantalla cruda de Next
 * ("This page couldn't load — A server error occurred"), en inglés, sin
 * botones y sin ninguna explicación, con 47 documentos recién cargados del
 * otro lado. La causa técnica fue un desfasaje de reloj de Supabase
 * (`lib/auth/guardas.ts` documenta el mecanismo completo) que dura segundos
 * y se corrige solo. La causa del susto fue otra: **la aplicación no tenía
 * ningún `error.tsx`**, así que cualquier excepción de un Server Component
 * caía en la pantalla por defecto del framework.
 *
 * En una aplicación de salud eso no es un detalle de prolijidad. Una pantalla
 * en inglés que dice "server error" y no dice nada más se lee, del otro lado,
 * como "perdí mi historial médico". Por eso lo primero que dice este
 * componente —antes que cualquier otra cosa, y sin condicionarlo a qué tipo
 * de error fue— es que los datos están guardados.
 *
 * ## Por qué el texto es genérico y no explica el error
 *
 * No es pereza: es una restricción del framework. Next.js **borra el mensaje
 * del error antes de mandárselo al cliente** en producción, justamente para
 * no filtrar detalles del servidor; lo único que cruza es `digest`, un hash.
 * Un `error.tsx` no puede saber si lo que falló fue el reloj, la red o una
 * consulta. Así que el texto tiene que ser verdadero para todos los casos a
 * la vez, y lo es: los datos están en la base pase lo que pase, y reintentar
 * es lo correcto en todos ellos.
 *
 * El `digest` sí se muestra, chiquito y al final: es el número que aparece
 * también en el log del servidor, y es lo único que convierte "me falló" en
 * un reporte que se puede rastrear.
 *
 * ## `retry`, no `reset`
 *
 * Next 16 renombró la función y le cambió el alcance: `retry()` vuelve a
 * pedirle al servidor el contenido del segmento y lo re-renderiza, que es
 * exactamente lo que hace falta acá (el error nació en el servidor, no en el
 * cliente). `reset()` —que sigue existiendo— solo limpia el estado del
 * boundary sin volver a pedir nada, y contra un fallo de servidor mostraría
 * el mismo error de nuevo. Ver
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`.
 *
 * El segundo camino es un `<a>` nativo a `/inicio`, no un `<Link>`: si el
 * router quedó en un estado raro, una navegación completa siempre sale.
 */

import { useEffect } from "react"

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react"

export interface PantallaErrorProps {
  error: Error & { digest?: string }
  /** `retry` del `error.tsx` de Next 16: vuelve a pedirle el segmento al servidor. */
  alReintentar: () => void
  /**
   * Ocultar el enlace "Ir al inicio". Lo usa `app/global-error.tsx`: cuando
   * lo que falló es el layout raíz, mandar a otra pantalla de la misma app no
   * es una salida, es la misma pared un poco más allá.
   */
  sinEnlaceAlInicio?: boolean
}

export function PantallaError({ error, alReintentar, sinEnlaceAlInicio }: PantallaErrorProps) {
  // El `digest` y el stack ya quedan en el log del servidor; esto deja
  // constancia también en la consola del dispositivo, que es lo que se puede
  // pedir por captura cuando alguien reporta el problema desde el teléfono.
  useEffect(() => {
    console.error("[pantalla-error] El servidor no pudo armar esta pantalla:", error)
  }, [error])

  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 bg-background px-6 py-10 text-center chica:gap-4 chica:px-4 chica:py-6">
      <TriangleAlertIcon
        className="size-16 text-muted-foreground chica:size-12"
        aria-hidden="true"
        strokeWidth={1.5}
      />

      <div className="flex max-w-md flex-col gap-3 chica:gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-balance text-foreground">
          No pudimos abrir esta pantalla
        </h1>
        <p className="text-lg text-pretty text-muted-foreground">
          Fue un problema momentáneo del servidor. Tu historial está guardado y
          completo: no se perdió nada.
        </p>
        <p className="text-lg text-pretty text-muted-foreground">
          Probá de nuevo. Casi siempre alcanza con eso.
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3 chica:gap-2">
        <button
          type="button"
          onClick={alReintentar}
          className="flex min-h-tactil-amplio w-full items-center justify-center gap-3 rounded-xl bg-primary px-5 text-center text-xl leading-tight font-bold text-primary-foreground shadow-elevada transition-[transform,box-shadow] duration-(--duracion-media) ease-salida hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:translate-y-0"
        >
          <RefreshCwIcon className="size-7 shrink-0" aria-hidden="true" />
          Probar de nuevo
        </button>

        {!sinEnlaceAlInicio && (
          <a
            href="/inicio"
            className="flex min-h-tactil w-full items-center justify-center rounded-lg border border-border px-4 py-3 text-base font-semibold text-foreground transition-colors duration-(--duracion-media) hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none chica:px-3 chica:py-2"
          >
            Ir al inicio
          </a>
        )}
      </div>

      {error.digest && (
        <p className="max-w-md text-sm text-muted-foreground">
          Si el problema sigue, pasanos este código:{" "}
          <span className="font-mono font-semibold text-foreground">{error.digest}</span>
        </p>
      )}
    </main>
  )
}
