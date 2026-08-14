"use client"

/**
 * Contenido interactivo de `/ficha` (Sprint 10, tarea 10.4): botón "Generar
 * ficha" → `POST /api/ficha/generar` (Sprint 10, tarea 10.3) → estado de
 * carga → hoja de consulta con "Imprimir" y "Compartir".
 *
 * Vive en un archivo aparte de `page.tsx` por el mismo motivo que
 * `app/(app)/(con-nav)/estudios/nuevo/pantalla-carga.tsx`: `page.tsx` es un
 * Server Component (necesita `cookies()` para el guard de
 * `obtenerPerfilActivo`) y este pedazo necesita estado de React.
 *
 * ## Por qué `fetch` a un Route Handler y no una Server Action
 *
 * `POST /api/ficha/generar` ya existe desde la tarea 10.3 con su propio
 * contrato JSON (`{ ficha }` / `{ error }`) y sus propios mensajes en
 * español -reimplementar esa misma lógica como Server Action duplicaría las
 * guardas de permiso y el mapeo de errores de Gemini que ya vive en
 * `app/api/ficha/generar/route.ts`-. `fetch` con `credentials` implícitas
 * (mismo origen) alcanza: la cookie de sesión viaja igual que en cualquier
 * navegación.
 *
 * ## `fechaGeneracion` se calcula UNA vez y se reutiliza
 *
 * Se guarda en estado junto con la `ficha` (no se recalcula en cada render)
 * para que la fecha que ve la persona en la hoja
 * (`components/ficha/hoja-consulta.tsx`) y la que arma el texto de
 * "Compartir" (`lib/ficha/texto-plano.ts`) sean exactamente la misma string,
 * nunca dos llamados a `new Date()` con un instante distinto.
 *
 * ## "Compartir": `navigator.share` con fallback a portapapeles
 *
 * `navigator.share` no existe en todos los navegadores de escritorio (sí en
 * la inmensa mayoría de Android/iOS, el uso primario de esta PWA). Cuando no
 * está, se copia el texto plano al portapapeles con feedback visible -nunca
 * un fallback silencioso: la persona tiene que saber que SÍ pasó algo-.
 * `AbortError` (la persona cierra la hoja de compartir del sistema sin elegir
 * nada) se ignora a propósito: cancelar no es un error que haya que mostrar.
 */

import * as React from "react"
import Link from "next/link"
import { Loader2Icon, PrinterIcon, ShareIcon, SparklesIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { HojaConsulta } from "@/components/ficha/hoja-consulta"
import { formatearFechaGeneracionFicha } from "@/lib/ficha/formato"
import { fichaATextoPlano } from "@/lib/ficha/texto-plano"
import type { FichaGenerada } from "@/lib/gemini/schemas"

type Estado = "inicial" | "generando" | "lista" | "error"

const MENSAJE_ERROR_RED = "No pudimos generar la ficha. Revisá tu conexión y probá de nuevo."

export interface PantallaFichaProps {
  nombreCompleto: string
  edadAnios: number | null
}

export function PantallaFicha({ nombreCompleto, edadAnios }: PantallaFichaProps) {
  const [estado, setEstado] = React.useState<Estado>("inicial")
  const [ficha, setFicha] = React.useState<FichaGenerada | null>(null)
  const [fechaGeneracion, setFechaGeneracion] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [avisoCopiado, setAvisoCopiado] = React.useState(false)

  async function generar() {
    setEstado("generando")
    setError(null)

    try {
      const respuesta = await fetch("/api/ficha/generar", { method: "POST" })
      const cuerpo: unknown = await respuesta.json().catch(() => null)

      if (!respuesta.ok || !cuerpo || typeof cuerpo !== "object" || !("ficha" in cuerpo)) {
        const mensaje =
          cuerpo && typeof cuerpo === "object" && "error" in cuerpo && typeof cuerpo.error === "string"
            ? cuerpo.error
            : MENSAJE_ERROR_RED
        setError(mensaje)
        setEstado("error")
        return
      }

      setFicha((cuerpo as { ficha: FichaGenerada }).ficha)
      setFechaGeneracion(formatearFechaGeneracionFicha(new Date()))
      setEstado("lista")
    } catch {
      // Red caída, request abortada, respuesta ilegible.
      setError(MENSAJE_ERROR_RED)
      setEstado("error")
    }
  }

  function imprimir() {
    window.print()
  }

  async function compartir() {
    if (!ficha || !fechaGeneracion) return

    const texto = fichaATextoPlano(ficha, { nombreCompleto, edadAnios, fechaGeneracion })

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Ficha de consulta", text: texto })
      } catch (compartirError) {
        // La persona cancela el diálogo del sistema: no es un error a mostrar.
        if (compartirError instanceof DOMException && compartirError.name === "AbortError") return
      }
      return
    }

    try {
      await navigator.clipboard.writeText(texto)
      setAvisoCopiado(true)
      window.setTimeout(() => setAvisoCopiado(false), 4000)
    } catch {
      setError("No pudimos copiar la ficha. Copiala manualmente desde la pantalla.")
    }
  }

  if (estado === "lista" && ficha && fechaGeneracion) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row print:hidden">
          <Boton onClick={imprimir} size="lg" className="sm:flex-1">
            <PrinterIcon aria-hidden="true" />
            Imprimir
          </Boton>
          <Boton onClick={() => void compartir()} variant="outline" size="lg" className="sm:flex-1">
            <ShareIcon aria-hidden="true" />
            Compartir
          </Boton>
        </div>

        {avisoCopiado && (
          <Alerta variante="exito" className="print:hidden">
            Copiamos el texto de la ficha al portapapeles.
          </Alerta>
        )}
        {error && (
          <Alerta variante="error" className="print:hidden">
            {error}
          </Alerta>
        )}

        <HojaConsulta
          ficha={ficha}
          nombreCompleto={nombreCompleto}
          edadAnios={edadAnios}
          fechaGeneracion={fechaGeneracion}
        />

        <div className="flex flex-col gap-2 print:hidden">
          <Boton
            onClick={() => {
              setEstado("inicial")
              setFicha(null)
              setFechaGeneracion(null)
            }}
            variant="ghost"
          >
            Generar una ficha nueva
          </Boton>
          <Boton
            render={<Link href="/ficha/historial" />}
            nativeButton={false}
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
          >
            Ver fichas anteriores
          </Boton>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-base text-muted-foreground">
        Armamos una hoja de una página con tus antecedentes, medicación y estudios recientes, lista
        para llevar o mostrar en la consulta. La redacta una inteligencia artificial a partir de tus
        datos cargados en la app.
      </p>

      {/*
        Aviso de minimización (docs/minimizacion-datos.md §5): el texto libre
        que escribió una persona -el título de un estudio, una nota de
        signos vitales- puede contener un dato que no se pensó como
        identificatorio en el momento de cargarlo, y ese texto SÍ viaja tal
        cual a un servicio externo para redactar el resumen. La mitigación
        que documenta §5 es justamente esta: avisar ANTES de generar, no
        sanitizar después con heurísticas que romperían contenido clínico
        legítimo.
      */}
      <Alerta variante="advertencia">
        Antes de generar, revisá que los títulos de tus estudios y tus notas no tengan datos que no
        quieras compartir con un servicio externo (por ejemplo, un nombre escrito adentro del título
        de un estudio): ese texto viaja tal cual para redactar el resumen.
      </Alerta>

      {estado === "error" && error && <Alerta variante="error">{error}</Alerta>}

      {estado === "generando" ? (
        <div
          role="status"
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center"
        >
          <Loader2Icon className="size-8 animate-spin text-primary" aria-hidden="true" />
          <p className="text-lg font-semibold text-foreground">Generando tu ficha…</p>
          <p className="text-base text-muted-foreground">
            Puede tardar unos segundos: no cierres esta pantalla.
          </p>
        </div>
      ) : (
        <Boton onClick={() => void generar()} size="lg">
          <SparklesIcon aria-hidden="true" />
          {estado === "error" ? "Probar de nuevo" : "Generar ficha"}
        </Boton>
      )}
    </div>
  )
}
