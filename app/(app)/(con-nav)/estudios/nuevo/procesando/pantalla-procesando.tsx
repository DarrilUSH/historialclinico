"use client"

/**
 * Lectura automática del documento: dispara `POST /api/documentos/extraer`
 * al montar y recorre tres estados -leyendo / listo / error- hasta mostrar el
 * resultado. Vive aparte de `page.tsx` por el mismo motivo que
 * `pantalla-carga.tsx` en `/estudios/nuevo`: `page.tsx` es un Server Component
 * (usa `cookies()` para el guard) y esto necesita `useEffect` y estado de
 * React.
 *
 * Esta pantalla es DELIBERADAMENTE PROVISORIA: muestra el JSON que devolvió
 * Gemini en una tabla simple de campos, de solo lectura, con una nota de que
 * el próximo paso permite corregir y confirmar. La pantalla de revisión y
 * edición real -formulario editable, indicador de confianza baja, fallback en
 * blanco si la IA no devolvió nada- es la tarea 4.5 del roadmap
 * ("Pantalla de revisión y fallback de edición manual") y no se implementa
 * acá.
 *
 * `disparado` (un `useRef`, no un `useState`) evita una segunda llamada real
 * a Gemini si el efecto corre dos veces -el comportamiento de React 19 en
 * modo desarrollo (Strict Mode) para detectar efectos no idempotentes-: a
 * diferencia de un simple `console.log` duplicado, acá una segunda ejecución
 * gasta cuota real de la API.
 */

import * as React from "react"
import Link from "next/link"

import { Loader2Icon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { Tarjeta } from "@/components/base/tarjeta"
import type { CategoriaDocumentoExtraida, DocumentoMedicoExtraido } from "@/lib/gemini/schemas"

export interface PantallaProcesandoProps {
  documentoId: string
}

type Estado = "leyendo" | "listo" | "error"

const ETIQUETA_CATEGORIA: Record<CategoriaDocumentoExtraida, string> = {
  laboratory: "Análisis de laboratorio",
  imaging: "Estudio por imágenes",
  prescription: "Receta",
  consultation: "Consulta",
  other: "Documento",
}

/**
 * `document_date`/`fecha` viaja como "aaaa-mm-dd" sin hora: se formatea en
 * UTC a propósito, mismo criterio que `app/(app)/(con-nav)/estudios/page.tsx`
 * -si no, la hora de Ushuaia (-03) podría correr la fecha un día.
 */
const FORMATO_FECHA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
})

function formatearFecha(fechaIso: string): string {
  if (!fechaIso) return "No se detectó una fecha"
  const fecha = new Date(`${fechaIso}T00:00:00Z`)
  return Number.isNaN(fecha.getTime()) ? fechaIso : FORMATO_FECHA.format(fecha)
}

const MENSAJE_ERROR_RED =
  "No pudimos conectarnos para leer el documento. Revisá tu conexión y probá de nuevo."

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

function extraerDocumento(cuerpo: unknown): DocumentoMedicoExtraido | null {
  if (cuerpo && typeof cuerpo === "object" && "extraccion" in cuerpo) {
    return (cuerpo as { extraccion: DocumentoMedicoExtraido }).extraccion
  }
  return null
}

export function PantallaProcesando({ documentoId }: PantallaProcesandoProps) {
  const [estado, setEstado] = React.useState<Estado>("leyendo")
  const [extraccion, setExtraccion] = React.useState<DocumentoMedicoExtraido | null>(null)
  const [error, setError] = React.useState<string>(MENSAJE_ERROR_RED)
  const disparado = React.useRef(false)

  React.useEffect(() => {
    // `disparado` es lo único que hace falta para que la llamada real a
    // Gemini ocurra UNA sola vez. React 19 en modo desarrollo (Strict Mode)
    // corre setup → cleanup → setup de cada efecto una vez al montar, sobre
    // la MISMA instancia -el `useRef` sobrevive ese ciclo sintético-: el
    // primer `setup` dispara `extraer()` y marca `disparado.current = true`;
    // el `cleanup` sintético no cancela nada; el segundo `setup` ve
    // `disparado.current` en `true` y no vuelve a llamar a Gemini. Se
    // comprobaron -y se descartaron- en la verificación manual de esta tarea
    // dos variantes rotas: (a) cancelar el `fetch` con `AbortController` en
    // el cleanup mata la única request real antes de que responda
    // (`net::ERR_ABORTED`, sin costo real ahorrado: el Route Handler no
    // escucha la desconexión del cliente, así que el servidor sigue
    // llamando a Gemini igual); (b) una bandera `vivo` que se apaga en el
    // cleanup sintético descarta el resultado de esa ÚNICA request real
    // cuando llega, porque el cleanup sintético corre ANTES de que la
    // promesa resuelva -la pantalla queda en "Leyendo…" para siempre aunque
    // el `fetch` haya devuelto 200 con el JSON correcto-. La solución es no
    // tener ninguna de las dos: sin `AbortController` y sin bandera de
    // desmontaje, la única llamada real corre hasta el final y actualiza el
    // estado cuando llega. Un desmontaje de verdad (navegar a otra pantalla)
    // deja un `setState` de una instancia ya desmontada, que React descarta
    // sola sin error ni warning desde React 18.
    if (disparado.current) return
    disparado.current = true

    async function extraer() {
      try {
        const respuesta = await fetch("/api/documentos/extraer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentoId }),
        })

        const cuerpo: unknown = await respuesta.json().catch(() => null)
        const extraida = respuesta.ok ? extraerDocumento(cuerpo) : null

        if (extraida) {
          setExtraccion(extraida)
          setEstado("listo")
          return
        }

        setError(extraerMensajeError(cuerpo))
        setEstado("error")
      } catch {
        setError(MENSAJE_ERROR_RED)
        setEstado("error")
      }
    }

    void extraer()
  }, [documentoId])

  if (estado === "leyendo") {
    return (
      <div
        role="status"
        className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center"
      >
        <Loader2Icon className="size-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-lg font-semibold text-foreground">Leyendo el documento…</p>
        <p className="text-base text-muted-foreground">
          Estamos buscando la fecha, la especialidad y los resultados. Puede tardar hasta medio
          minuto: no cierres esta pantalla.
        </p>
      </div>
    )
  }

  if (estado === "error") {
    return (
      <div className="flex w-full flex-col gap-4">
        <Alerta variante="error">{error}</Alerta>
        <p className="text-base text-muted-foreground">
          No hay problema: en el próximo paso vas a poder cargar los datos a mano.
        </p>
        {/* `nativeButton={false}`: el `render` es un `<Link>`, no un `<button>` nativo. */}
        <Boton render={<Link href="/estudios" />} nativeButton={false} size="lg">
          Ver mis estudios
        </Boton>
      </div>
    )
  }

  if (!extraccion) return null

  return (
    <div className="flex w-full flex-col gap-4">
      <Alerta variante="info" estatica className="text-left">
        Así entendimos el documento. En el próximo paso vas a poder corregir y confirmar estos
        datos.
      </Alerta>

      <Tarjeta className="gap-4 px-(--card-spacing) text-left">
        <CampoExtraido etiqueta="Fecha" valor={formatearFecha(extraccion.fecha)} />
        <CampoExtraido
          etiqueta="Categoría"
          valor={ETIQUETA_CATEGORIA[extraccion.categoria] ?? extraccion.categoria}
        />
        <CampoExtraido etiqueta="Especialidad" valor={extraccion.especialidad || "No detectada"} />
        <CampoExtraido etiqueta="Institución" valor={extraccion.institucion || "No detectada"} />
        <CampoExtraido etiqueta="Médico" valor={extraccion.medico || "No detectado"} />
        <CampoExtraido etiqueta="Resumen" valor={extraccion.resumen || "Sin resumen"} />
      </Tarjeta>

      {extraccion.metricas.length > 0 && (
        <Tarjeta className="gap-3 px-(--card-spacing) text-left">
          <p className="text-base font-semibold text-foreground">Resultados de laboratorio</p>
          <ul className="flex flex-col gap-2">
            {extraccion.metricas.map((metrica, indice) => (
              <li
                key={`${metrica.nombre}-${indice}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-2 last:border-0 last:pb-0"
              >
                <span className="text-base font-medium text-foreground">{metrica.nombre}</span>
                <span className="text-base text-muted-foreground numeros-clinicos">
                  {metrica.valor} {metrica.unidad}
                  {metrica.rango && ` (ref: ${metrica.rango})`}
                </span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {/* `nativeButton={false}`: el `render` es un `<Link>`, no un `<button>` nativo. */}
      <Boton render={<Link href="/estudios" />} nativeButton={false} size="lg">
        Ver mis estudios
      </Boton>
    </div>
  )
}

function CampoExtraido({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-sm font-medium text-muted-foreground">{etiqueta}</p>
      <p className="text-base text-foreground">{valor}</p>
    </div>
  )
}
