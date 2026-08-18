"use client"

/**
 * Botón "Actualizar" del catálogo REFES (Sprint 16, tarea 16.3).
 *
 * ## Por qué el bucle vive en el navegador
 *
 * Sincronizar 36.046 centros no entra en una sola función serverless de
 * Vercel Hobby (el porqué medido está en el encabezado de
 * `lib/lugares/sincronizacion.ts`). Alguien tiene que llamar N veces al
 * endpoint, y ese alguien es esta pantalla: no hay cola de trabajos ni
 * worker en el plan gratuito, y montar uno para un botón que se toca dos
 * veces al año sería el tipo de infraestructura que este proyecto se propuso
 * no tener.
 *
 * Que el bucle sea del cliente NO significa que el progreso sea del cliente:
 * cada tanda deja su avance en la base (`health_centers_sync`), así que si
 * esta pantalla se cierra a la mitad, la próxima vez que alguien toque
 * "Actualizar" la corrida SE RETOMA desde donde quedó en vez de empezar de
 * cero. El estado que vive acá es puramente el de la animación.
 *
 * ## El velo con progreso real
 *
 * `VeloEspera` (`components/base/velo-espera.tsx`) va cambiando de mensaje
 * por etapa, con NÚMEROS REALES y no con una animación indeterminada: el
 * total de filas se cuenta durante la preparación
 * (`lib/lugares/csv.ts#contarFilasCsv`), así que el velo puede decir
 * "Sincronizando 12.000 de 36.046 centros" desde la primera tanda. Un velo
 * que no dice cuánto falta, en una operación de casi un minuto, se lee como
 * "se colgó".
 *
 * ## Los tres finales posibles
 *
 * - **Ya estás al día**: el portal no publicó una edición nueva. No se
 *   descarga nada (la comparación es contra la API del portal, 120 ms) y se
 *   ofrece "Sincronizar igual" por si el catálogo local quedó a medias.
 * - **Ocupado**: otra persona está sincronizando ahora mismo. El lock de la
 *   base ya lo impidió; acá solo se explica.
 * - **Listo**: se refresca la pantalla para que el listado y el "última
 *   actualización" muestren lo nuevo.
 */

import * as React from "react"
import { useRouter } from "next/navigation"

import { RefreshCwIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { VeloEspera } from "@/components/base/velo-espera"

interface RespuestaProgreso {
  etapa: "al-dia" | "en-curso" | "completo" | "ocupado"
  token: string | null
  filasProcesadas: number
  filasTotales: number | null
  bytesProcesados: number
  bytesTotales: number | null
  edicion: string | null
  centrosEnCatalogo: number | null
  ultimaActualizacion: string | null
}

type Resultado =
  | { tipo: "ok"; centros: number | null }
  | { tipo: "al-dia"; centros: number | null }
  | { tipo: "ocupado" }
  | { tipo: "error"; mensaje: string }

/**
 * Tope de tandas por click. 36.046 filas entran en 9 ventanas de 1 MiB; 60 es
 * margen de sobra para una edición futura mucho más grande, y a la vez un
 * freno duro para que un bug del servidor -una tanda que no avanza el
 * offset- no deje al navegador pegándole al endpoint para siempre.
 */
const TOPE_TANDAS = 60

const FORMATO_NUMERO = new Intl.NumberFormat("es-AR")

export interface BotonActualizarCatalogoProps {
  /** `true` si la base dice que hay una corrida viva (otra pestaña, otra persona). */
  sincronizandoAlCargar?: boolean
  /** `true` si quedó una corrida a medio hacer que se puede retomar. */
  hayCorridaIncompleta?: boolean
  className?: string
}

export function BotonActualizarCatalogo({
  sincronizandoAlCargar = false,
  hayCorridaIncompleta = false,
  className,
}: BotonActualizarCatalogoProps) {
  const router = useRouter()
  const [enCurso, setEnCurso] = React.useState(false)
  const [mensajeVelo, setMensajeVelo] = React.useState("Preparando la sincronización")
  const [submensajeVelo, setSubmensajeVelo] = React.useState<string | undefined>(undefined)
  const [resultado, setResultado] = React.useState<Resultado | null>(null)

  async function llamar(cuerpo: Record<string, unknown>): Promise<RespuestaProgreso> {
    const respuesta = await fetch("/api/lugares/sincronizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    })

    if (!respuesta.ok) {
      let detalle = `El servidor respondió ${respuesta.status}.`
      try {
        const cuerpoError = (await respuesta.json()) as { error?: string }
        if (typeof cuerpoError.error === "string" && cuerpoError.error.length > 0) {
          detalle = cuerpoError.error
        }
      } catch {
        // Respuesta sin JSON (un 502 del borde, por ejemplo): queda el genérico.
      }
      throw new Error(detalle)
    }

    return (await respuesta.json()) as RespuestaProgreso
  }

  function describirTanda(progreso: RespuestaProgreso) {
    const total = progreso.filasTotales
    if (total && total > 0) {
      setMensajeVelo(
        `Sincronizando ${FORMATO_NUMERO.format(progreso.filasProcesadas)} de ${FORMATO_NUMERO.format(total)} centros`,
      )
    } else {
      setMensajeVelo(`Sincronizando ${FORMATO_NUMERO.format(progreso.filasProcesadas)} centros`)
    }
    setSubmensajeVelo("No cierres esta pantalla. Si se corta, la próxima vez sigue desde acá.")
  }

  async function sincronizar(forzar: boolean) {
    setResultado(null)
    setEnCurso(true)
    setMensajeVelo(
      hayCorridaIncompleta && !forzar
        ? "Retomando la sincronización donde quedó"
        : "Buscando la edición más nueva del Ministerio",
    )
    setSubmensajeVelo("El listado oficial pesa casi 9 MB: puede tardar unos segundos.")

    try {
      let progreso = await llamar({ paso: "preparar", forzar })

      if (progreso.etapa === "ocupado") {
        setResultado({ tipo: "ocupado" })
        return
      }

      if (progreso.etapa === "al-dia") {
        setResultado({ tipo: "al-dia", centros: progreso.centrosEnCatalogo })
        return
      }

      describirTanda(progreso)

      for (let tanda = 0; tanda < TOPE_TANDAS; tanda += 1) {
        if (progreso.etapa === "completo") break

        const token = progreso.token
        if (!token) {
          throw new Error("La sincronización perdió su identificador. Volvé a intentarlo.")
        }

        const anterior = progreso.bytesProcesados
        progreso = await llamar({ paso: "procesar", token })

        if (progreso.etapa === "ocupado") {
          setResultado({ tipo: "ocupado" })
          return
        }

        describirTanda(progreso)

        // Guarda contra un bucle infinito: si una tanda no movió el offset,
        // seguir llamando solo repetiría el mismo trabajo para siempre.
        if (progreso.etapa === "en-curso" && progreso.bytesProcesados <= anterior) {
          throw new Error(
            "La sincronización dejó de avanzar. Volvé a intentarlo en unos minutos.",
          )
        }
      }

      if (progreso.etapa !== "completo") {
        throw new Error(
          "La sincronización no terminó en el tiempo previsto. Volvé a tocar Actualizar para retomarla.",
        )
      }

      setResultado({ tipo: "ok", centros: progreso.centrosEnCatalogo })
      router.refresh()
    } catch (error) {
      setResultado({
        tipo: "error",
        mensaje:
          error instanceof Error
            ? error.message
            : "No pudimos actualizar el catálogo. Probá de nuevo en un rato.",
      })
    } finally {
      setEnCurso(false)
    }
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <Boton
          type="button"
          variant="secondary"
          size="lg"
          cargando={enCurso}
          onClick={() => void sincronizar(false)}
        >
          <RefreshCwIcon aria-hidden="true" />
          {hayCorridaIncompleta ? "Retomar actualización" : "Actualizar"}
        </Boton>

        {sincronizandoAlCargar && !enCurso && (
          <p className="text-sm text-muted-foreground">
            Hay una actualización en curso en este momento.
          </p>
        )}
      </div>

      {resultado?.tipo === "ok" && (
        <Alerta variante="exito" className="mt-3">
          Catálogo actualizado
          {resultado.centros !== null
            ? `: ${FORMATO_NUMERO.format(resultado.centros)} centros de salud.`
            : "."}
        </Alerta>
      )}

      {resultado?.tipo === "al-dia" && (
        <Alerta variante="info" className="mt-3">
          <span className="block">
            Ya tenés la edición más nueva que publicó el Ministerio
            {resultado.centros ? `: ${FORMATO_NUMERO.format(resultado.centros)} centros.` : "."}
          </span>
          <Boton
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 px-0 underline underline-offset-2"
            onClick={() => void sincronizar(true)}
          >
            Descargarla de nuevo igual
          </Boton>
        </Alerta>
      )}

      {resultado?.tipo === "ocupado" && (
        <Alerta variante="info" className="mt-3">
          Otra persona está actualizando el catálogo en este momento. Probá de nuevo en un par de
          minutos.
        </Alerta>
      )}

      {resultado?.tipo === "error" && (
        <Alerta variante="error" className="mt-3">
          {resultado.mensaje}
        </Alerta>
      )}

      <VeloEspera visible={enCurso} mensaje={mensajeVelo} submensaje={submensajeVelo} />
    </div>
  )
}
