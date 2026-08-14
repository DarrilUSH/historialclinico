/**
 * Indicador de "última sincronización" en la ficha SOS (Sprint 8, tarea 8.5).
 *
 * Muestra cuándo se descargó por última vez esta copia de los datos vitales
 * cuando está offline. Responde la pregunta "¿hace cuánto que este dispositivo
 * bajó esta copia?" (`generado_at` del payload), distinta de "¿hace cuánto que
 * alguien revisó los datos?" (`sos_updated_at`, que ya muestra `FichaSos`).
 *
 * ## Comportamiento
 *
 * - **Offline:** hace un fetch a `/api/sos/{perfilId}`. El service worker lo
 *   responde desde el caché si existe. Lee `generado_at` del payload y lo
 *   formatea.
 * - **Online:** no hace nada (no hay frescura de caché que mostrar cuando los
 *   datos están frescos en línea).
 * - **Fetch falla:** no muestra nada. Si el caché no tiene el payload, la
 *   página misma tampoco la tiene (porque `<FichaSos>` se renderiza en servidor
 *   y la precarga del SW sucede después). Fallar silenciosamente es lo correcto.
 *
 * ## Contrato del payload
 *
 * Espera el shape de `construirPayloadSos` (`lib/sos/payload.ts`):
 * ```json
 * {
 *   "version": 1,
 *   "generado_at": "2026-08-14T17:30:00.000Z",
 *   ...
 * }
 * ```
 *
 * Desconoce la estructura del resto del payload: solo le importa `generado_at`.
 */

"use client"

import { useEffect, useState } from "react"

import { useEstadoConexion } from "@/hooks/use-estado-conexion"
import { formatearRevisionSos } from "@/lib/sos/frescura"

interface FrescuraOfflineProps {
  perfilId: string
}

export function FrescuraOffline({ perfilId }: FrescuraOfflineProps) {
  const online = useEstadoConexion()
  const [generadoAt, setGeneradoAt] = useState<string | null>(null)

  useEffect(() => {
    // Solo offline: si hay conexión, no hace falta mostrar "hace cuánto bajé
    // esto" —el usuario está leyendo la ficha en línea-.
    if (online) {
      return
    }

    // Fetch al payload offline. El SW lo responde desde caché sin red.
    const fetchPayload = async () => {
      try {
        const resp = await fetch(`/api/sos/${perfilId}`)
        if (!resp.ok) {
          // 401, 403, 404, 5xx, etc.: no muestra nada.
          return
        }
        const payload = await resp.json()

        // Extraer `generado_at`, asegurar que es un string válido.
        if (
          payload &&
          typeof payload === "object" &&
          typeof payload.generado_at === "string"
        ) {
          setGeneradoAt(payload.generado_at)
        }
      } catch {
        // Network error, JSON parse error, etc.: fallar silenciosamente.
      }
    }

    fetchPayload()
  }, [online, perfilId])

  // Si no hay `generado_at` o estamos online, no muestra nada.
  if (!generadoAt || online) {
    return null
  }

  // Formatear la fecha usando el helper que comparten las tres pantallas SOS.
  const fechaFormato = formatearRevisionSos(generadoAt)
  if (!fechaFormato) {
    return null
  }

  return (
    <p className="text-center text-base text-muted-foreground">
      Copia descargada el {fechaFormato}.
    </p>
  )
}
