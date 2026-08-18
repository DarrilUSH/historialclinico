"use client"

/**
 * "¿Te llegó el turno por WhatsApp? Pegalo acá" (Sprint 16, tarea 16.4):
 * sección colapsable arriba de `FormularioTurno` que manda el texto pegado a
 * `POST /api/turnos/analizar-mensaje` y, con el resultado, PRECARGA el
 * formulario para que la persona lo revise y corrija — la IA nunca guarda
 * nada, `onAplicarPropuesta` solo cambia estado de React en el padre.
 *
 * Colapsada por defecto (mismo criterio que el panel de coordenadas
 * avanzadas de `formulario-turno.tsx`): la carga manual sigue siendo el
 * camino principal, esto es una ayuda opcional.
 *
 * ## Qué hace y qué no hace este componente
 *
 * - Dispara el análisis, muestra `VeloEspera` mientras está en curso, y
 *   llama a `onAplicarPropuesta` con la propuesta principal apenas llega -el
 *   padre (`FormularioTurno`) decide, campo por campo, qué pisa y qué no
 *   (`lib/turnos/aplicar-precarga.ts`).
 * - Si `relacion` no es `"unico"`, muestra la explicación de Gemini y, para
 *   `"varios_turnos"`, la lista de los demás turnos detectados con un botón
 *   "Cargar este turno" cada uno -que vuelve a llamar a `onAplicarPropuesta`
 *   con esa otra propuesta-.
 * - Muestra la "franja de revisión": qué encontró y qué faltó, con los
 *   avisos que ya vienen armados en `PropuestaTurno.avisos`
 *   (`lib/turnos/construir-propuestas.ts`) — nunca decide por sí mismo qué
 *   avisar, eso ya lo resolvió la capa pura.
 * - NUNCA guarda nada: no hay ningún `fetch` con método POST/PUT hacia
 *   `appointments`, solo hacia el analizador. Guardar sigue siendo,
 *   exclusivamente, tocar "Guardar turno" al pie de `FormularioTurno`.
 */

import * as React from "react"

import { SparklesIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoTextarea } from "@/components/base/campo-textarea"
import { VeloEspera } from "@/components/base/velo-espera"
import type { PropuestaTurno, ResultadoAnalisisMensaje } from "@/lib/turnos/construir-propuestas"

export interface AnalizadorMensajeTurnoProps {
  /** Se llama con la propuesta principal apenas termina el análisis, y de nuevo si la persona elige cargar otro de los turnos detectados. */
  onAplicarPropuesta: (propuesta: PropuestaTurno) => void
}

const MENSAJE_SIN_TEXTO = "Pegá el mensaje antes de analizarlo."
const MENSAJE_ERROR_RED =
  "No pudimos conectarnos para analizar el mensaje. Revisá tu conexión, o cargá el turno a mano."
const MAX_LARGO_MENSAJE = 8000

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

export function AnalizadorMensajeTurno({ onAplicarPropuesta }: AnalizadorMensajeTurnoProps) {
  const [abierto, setAbierto] = React.useState(false)
  const [mensaje, setMensaje] = React.useState("")
  const [analizando, setAnalizando] = React.useState(false)
  const [errorAnalisis, setErrorAnalisis] = React.useState<string | null>(null)
  const [resultado, setResultado] = React.useState<ResultadoAnalisisMensaje | null>(null)
  // "principal" | índice dentro de otrasPropuestas | null (nada cargado todavía) — solo para el badge "Cargado" de la lista de abajo.
  const [cargado, setCargado] = React.useState<"principal" | number | null>(null)

  async function analizar() {
    if (mensaje.trim().length === 0) {
      setErrorAnalisis(MENSAJE_SIN_TEXTO)
      return
    }

    setAnalizando(true)
    setErrorAnalisis(null)

    try {
      const respuesta = await fetch("/api/turnos/analizar-mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensaje }),
      })

      const cuerpo: unknown = await respuesta.json().catch(() => null)
      const resultadoRecibido = respuesta.ok ? extraerResultado(cuerpo) : null

      if (resultadoRecibido) {
        setResultado(resultadoRecibido)
        setCargado("principal")
        onAplicarPropuesta(resultadoRecibido.propuestaPrincipal)
      } else {
        setResultado(null)
        setCargado(null)
        setErrorAnalisis(extraerMensajeError(cuerpo))
      }
    } catch {
      setResultado(null)
      setCargado(null)
      setErrorAnalisis(MENSAJE_ERROR_RED)
    } finally {
      setAnalizando(false)
    }
  }

  function cargarOtraPropuesta(indice: number) {
    if (!resultado) return
    onAplicarPropuesta(resultado.otrasPropuestas[indice])
    setCargado(indice)
  }

  const avisos = resultado?.propuestaPrincipal.avisos ?? []

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4 chica:gap-2 chica:p-3">
      <Boton
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setAbierto((valor) => !valor)}
        aria-expanded={abierto}
        className="w-fit"
      >
        <SparklesIcon className="size-4 shrink-0" aria-hidden="true" />
        {abierto ? "Ocultar" : "¿Te llegó el turno por WhatsApp? Pegalo acá"}
      </Boton>

      {abierto && (
        <div className="flex flex-col gap-3">
          <CampoTextarea
            id="mensaje-turno-whatsapp"
            label="Mensaje de la clínica"
            rows={6}
            maxLength={MAX_LARGO_MENSAJE}
            value={mensaje}
            onChange={(evento) => setMensaje(evento.target.value)}
            placeholder="Pegá acá el mensaje tal como te llegó (ej: «Clinica San Jorge: Se asigna turno para ecografía vesical...»)"
            ayuda="Se lo mandamos a una inteligencia artificial (Gemini) solo para leerlo — no se guarda. Si trae nombre o DNI del paciente, se ignoran: no se cargan en ningún campo."
          />

          <Boton type="button" onClick={() => void analizar()} cargando={analizando} className="w-fit">
            <SparklesIcon aria-hidden="true" />
            Analizar
          </Boton>

          {errorAnalisis && <Alerta variante="error">{errorAnalisis}</Alerta>}

          {resultado && (
            <div className="flex flex-col gap-3">
              {resultado.relacion !== "unico" && (
                <Alerta
                  variante="info"
                  titulo={
                    resultado.relacion === "varios_turnos"
                      ? "Encontramos más de un turno en el mensaje"
                      : "El mensaje traía una confirmación — fusionamos los datos"
                  }
                >
                  {resultado.explicacion}
                </Alerta>
              )}

              {resultado.contradiccion && (
                <Alerta variante="advertencia" titulo="Hay una contradicción entre los dos mensajes">
                  {resultado.contradiccion}
                </Alerta>
              )}

              <Alerta variante={avisos.length > 0 ? "advertencia" : "exito"} titulo="Esto entendimos del mensaje">
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
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-foreground">
                    Cargamos el primer turno en el formulario. También encontramos:
                  </p>
                  <ul className="flex flex-col gap-2">
                    {resultado.otrasPropuestas.map((otra, indice) => (
                      <li key={indice} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">{otra.resumen}</span>
                        <Boton
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => cargarOtraPropuesta(indice)}
                          disabled={cargado === indice}
                        >
                          {cargado === indice ? "Cargado" : "Cargar este turno"}
                        </Boton>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <VeloEspera
        visible={analizando}
        mensaje="La inteligencia artificial está leyendo el mensaje…"
        submensaje="Esto puede tardar unos segundos."
      />
    </div>
  )
}
