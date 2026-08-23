/**
 * `/ficha/historial/[id]` — detalle de una ficha guardada (Sprint 10, tarea
 * 10.5). Renderiza el `content` guardado, validándolo contra
 * `FichaGeneradaSchema`, sin llamar a Gemini ni regenerar.
 *
 * Si el content no pasa la validación (ficha vieja con schema antiguo),
 * muestra un mensaje claro pero no la desecha: es historia.
 *
 * ## El import de `ficha.print.css` faltaba (encontrado en la tarea 13.6)
 *
 * Esta pantalla tiene su propio botón "Imprimir" (`./boton-imprimir.tsx`)
 * desde que se escribió, pero nunca importó
 * `app/(app)/(sin-nav)/ficha/ficha.print.css` -ese import es local al módulo
 * de `../../page.tsx` (`/ficha`), y Next.js no lo arrastra a una ruta
 * hermana solo porque comparten el componente `HojaConsulta`-. El resultado:
 * imprimir una ficha GUARDADA sacaba la tarjeta tal cual se ve en pantalla
 * -bordes redondeados, sombra, colores del tema activo, sin el tamaño de
 * fuente A4- en vez de la hoja print-safe que sí produce `/ficha`. Se
 * encontró recién ahora porque abrir una ficha guardada requiere haber
 * generado una antes (cuota de Gemini), así que nadie había ejercitado este
 * botón en un dispositivo real todavía. Import agregado, mismo criterio que
 * `page.tsx`.
 */

import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { Alerta } from "@/components/base/alerta"
import { HojaConsulta } from "@/components/ficha/hoja-consulta"
import { createClient } from "@/lib/supabase/server"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { calcularEdad } from "@/lib/perfiles/edad"
import { validarFichaGenerada } from "@/lib/gemini/schemas"

import { BotonImprimir } from "./boton-imprimir"
import "../../ficha.print.css"


export const metadata = {
  title: "Ficha guardada — Historial Médico",
}

function formatearFechaDetalle(fecha: string): string {
  const d = new Date(fecha)
  return d.toLocaleDateString("es-AR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

interface PaginaFichaHistorialProps {
  params: Promise<{ id: string }>
}

export default async function PaginaFichaHistorial({ params }: PaginaFichaHistorialProps) {
  const { id } = await params
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const perfilId = activo.perfil.id
  const supabase = await createClient()

  // Leer la ficha específica.
  // El `.eq("profile_id", ...)` acota la consulta al perfil activo, además de
  // lo que ya filtra RLS (`puede_ver_perfil`, que autoriza TODOS los perfiles
  // que la sesión puede ver, no solo el activo). La comprobación explícita de
  // más abajo se conserva a propósito: es barata y deja el invariante escrito
  // en la pantalla que lo necesita, en vez de repartido entre esta línea y una
  // política de la base.
  const { data: ficha, error } = await supabase
    .from("consultation_sheets")
    .select("id, profile_id, content, created_at")
    .eq("id", id)
    .eq("profile_id", perfilId)
    .maybeSingle()

  if (error || !ficha) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <div className="flex items-center gap-3">
          <Boton
            render={<Link href="/ficha/historial" aria-label="Volver al historial" />}
            nativeButton={false}
            variant="ghost"
            size="icon"
          >
            <ArrowLeftIcon aria-hidden="true" />
          </Boton>
          <h1 className="text-2xl font-semibold tracking-tight">Ficha guardada</h1>
        </div>
        <Alerta variante="error">No pudimos cargar esta ficha. Probá desde el historial.</Alerta>
      </div>
    )
  }

  // Verificación de permisos: solo puedo ver fichas de mi perfil (puede_ver_perfil).
  if (ficha.profile_id !== perfilId) {
    redirect("/ficha/historial")
  }

  // Validar el content contra el schema actual.
  const validacion = validarFichaGenerada(ficha.content)

  if (!validacion.ok) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <div className="flex items-center gap-3">
          <Boton
            render={<Link href="/ficha/historial" aria-label="Volver al historial" />}
            nativeButton={false}
            variant="ghost"
            size="icon"
          >
            <ArrowLeftIcon aria-hidden="true" />
          </Boton>
          <h1 className="text-2xl font-semibold tracking-tight">Ficha guardada</h1>
        </div>
        <Alerta variante="advertencia">
          Esta ficha se generó hace un tiempo y el formato ha cambiado. Generá una ficha nueva con los datos
          actualizados.
        </Alerta>
        <Boton render={<Link href="/ficha" />} nativeButton={false}>
          Generar ficha nueva
        </Boton>
      </div>
    )
  }

  const fichaValidada = validacion.datos
  const fechaFormateada = formatearFechaDetalle(ficha.created_at)

  return (
    // `not-print:chica:` en vez de `chica:` (Sprint 13, tarea 13.6): mismo
    // motivo que `app/(app)/(sin-nav)/ficha/page.tsx` -este árbol también
    // contiene la `HojaConsulta` que se imprime-.
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 not-print:chica:gap-4 not-print:chica:px-3 not-print:chica:py-4 print:max-w-none print:gap-0 print:p-0">
      <div className="flex items-center gap-3 not-print:chica:gap-2 print:hidden">
        <Boton
          render={<Link href="/ficha/historial" aria-label="Volver al historial" />}
          nativeButton={false}
          variant="ghost"
          size="icon"
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Boton>
        <h1 className="text-2xl font-semibold tracking-tight">Ficha guardada</h1>
      </div>

      <div className="flex gap-3 sm:flex-row print:hidden">
        <BotonImprimir />
      </div>

      <HojaConsulta
        ficha={fichaValidada}
        nombreCompleto={activo.perfil.full_name}
        edadAnios={calcularEdad(activo.perfil.date_of_birth)}
        fechaGeneracion={fechaFormateada}
      />
    </div>
  )
}
