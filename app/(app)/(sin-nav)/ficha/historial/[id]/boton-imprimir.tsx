"use client"

/**
 * Botón "Imprimir" de `/ficha/historial/[id]` (Sprint 10, tarea 10.5 —
 * extraído en el Sprint 13, tarea 13.6).
 *
 * `PaginaFichaHistorial` es un Server Component (necesita `cookies()` para
 * `obtenerPerfilActivo()` y consulta Supabase con `createClient()`), así que
 * no puede definir un `onClick` y pasarlo directo a `<Boton>` -eso es un
 * Client Component (`components/ui/button.tsx` vía `@base-ui/react`)-: React
 * lo rechaza en tiempo de render con "Event handlers cannot be passed to
 * Client Components" (visible como 500 en dev, la página nunca llegaba a
 * pintarse). El archivo original tenía justo ese bug -una función `imprimir`
 * declarada adentro del Server Component y pasada como `onClick={imprimir}`,
 * nunca ejercitada en un dispositivo real porque abrir una ficha GUARDADA
 * requiere haber generado una antes, algo que consume cuota de Gemini-. Se
 * arregla moviendo el único pedazo interactivo a este Client Component
 * chico, mismo patrón que `components/compartir/boton-descartar.tsx`.
 */

import { PrinterIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"

export function BotonImprimir() {
  return (
    <Boton onClick={() => window.print()} size="lg" className="sm:flex-1">
      <PrinterIcon aria-hidden="true" />
      Imprimir
    </Boton>
  )
}
