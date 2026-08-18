"use client"

/**
 * Precarga del formulario de turno a partir de un correo de la bandeja de
 * Gmail (Sprint 17, tarea 17.2).
 *
 * Es el hermano automático de `AnalizadorMensajeTurno` (tarea 16.4): lo que
 * allá hace la persona -pegar el texto de la clínica y tocar "Analizar"- acá lo
 * hace la app sola al abrir `/turnos/nuevo?gmail=<id>` desde la bandeja. El
 * resto es idéntico: la misma llamada a Gemini por detrás
 * (`analizarMensajeTurno`), la misma `PropuestaTurno`, la misma franja de
 * avisos y el mismo `onAplicarPropuesta` que el formulario resuelve campo por
 * campo con `lib/turnos/aplicar-precarga.ts`.
 *
 * **Y como allá, la IA no guarda nada**: esto solo cambia estado de React. El
 * turno se guarda cuando la persona revisa y toca "Guardar turno".
 *
 * ## Se dispara una sola vez
 *
 * `disparado` es un `useRef` y no un `useState`, por el mismo motivo que en
 * `pantalla-procesando.tsx`: en modo desarrollo React 19 corre los efectos dos
 * veces para detectar efectos no idempotentes, y acá una segunda ejecución
 * gasta cuota real de Gemini.
 */

import * as React from "react"

import { SparklesIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { VeloEspera } from "@/components/base/velo-espera"
import type { PropuestaTurno, ResultadoAnalisisMensaje } from "@/lib/turnos/construir-propuestas"

export interface PrecargaGmailProps {
  /** `gmail_messages.id` del correo que se está revisando. */
  correoId: string
  /** El formulario decide, campo por campo, qué pisa y qué no. */
  onAplicarPropuesta: (propuesta: PropuestaTurno) => void
}

const MENSAJE_ERROR_RED =
  "No pudimos leer el correo para precargar el turno. Revisá tu conexión, o cargalo a mano."

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

function extraerResultado(cuerpo: unknown): ResultadoAnalisisMensaje | null {
  if (cuerpo && typeof cuerpo === "object" && "resultado" in cuerpo) {
    return (cuerpo as { resultado: ResultadoAnalisisMensaje }).resultado
  }
  return null
}

export function PrecargaGmail({ correoId, onAplicarPropuesta }: PrecargaGmailProps) {
  const [analizando, setAnalizando] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [resultado, setResultado] = React.useState<ResultadoAnalisisMensaje | null>(null)
  const disparado = React.useRef(false)

  // `onAplicarPropuesta` cambia de identidad en cada render del formulario (es
  // una función declarada adentro), así que va por ref: incluirla en las
  // dependencias del efecto lo volvería a disparar en cada tecleo.
  const aplicarRef = React.useRef(onAplicarPropuesta)
  React.useEffect(() => {
    aplicarRef.current = onAplicarPropuesta
  }, [onAplicarPropuesta])

  React.useEffect(() => {
    if (disparado.current) return
    disparado.current = true

    async function analizar() {
      try {
        const respuesta = await fetch("/api/gmail/analizar-correo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ correoId }),
        })

        const cuerpo: unknown = await respuesta.json().catch(() => null)
        const recibido = respuesta.ok ? extraerResultado(cuerpo) : null

        if (recibido) {
          setResultado(recibido)
          aplicarRef.current(recibido.propuestaPrincipal)
        } else {
          setError(extraerMensajeError(cuerpo))
        }
      } catch {
        setError(MENSAJE_ERROR_RED)
      } finally {
        // Pase lo que pase se llega al formulario: la carga manual nunca queda
        // bloqueada por la IA (misma regla de oro que la subida de estudios).
        setAnalizando(false)
      }
    }

    void analizar()
  }, [correoId])

  const avisos = resultado?.propuestaPrincipal.avisos ?? []

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4 chica:gap-2 chica:p-3">
      <p className="flex items-center gap-2 text-base font-medium chica:text-sm">
        <SparklesIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
        Turno que llegó por Gmail
      </p>

      {error && <Alerta variante="advertencia">{error}</Alerta>}

      {resultado && (
        <>
          {resultado.relacion !== "unico" && (
            <Alerta
              variante="info"
              titulo={
                resultado.relacion === "varios_turnos"
                  ? "El correo mencionaba más de un turno"
                  : "El correo traía una confirmación — fusionamos los datos"
              }
            >
              {resultado.explicacion}
            </Alerta>
          )}

          {resultado.contradiccion && (
            <Alerta variante="advertencia" titulo="Hay una contradicción en el correo">
              {resultado.contradiccion}
            </Alerta>
          )}

          <Alerta variante={avisos.length > 0 ? "advertencia" : "exito"} titulo="Esto entendimos del correo">
            {avisos.length > 0 ? (
              <ul className="list-disc pl-5">
                {avisos.map((aviso, indice) => (
                  <li key={indice}>{aviso}</li>
                ))}
              </ul>
            ) : (
              <p>El formulario de abajo quedó precargado. Revisalo y guardá cuando esté correcto.</p>
            )}
          </Alerta>

          {resultado.otrasPropuestas.length > 0 && (
            <p className="text-sm text-muted-foreground chica:text-xs">
              El correo mencionaba {resultado.otrasPropuestas.length + 1} turnos. Cargamos el
              primero: cuando lo guardes, volvé al correo para cargar el que sigue.
            </p>
          )}
        </>
      )}

      <VeloEspera
        visible={analizando}
        mensaje="La inteligencia artificial está leyendo el correo…"
        submensaje="Esto puede tardar unos segundos."
      />
    </div>
  )
}
