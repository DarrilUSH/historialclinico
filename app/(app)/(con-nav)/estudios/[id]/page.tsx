/**
 * `/estudios/{id}`: STUB de navegación (Sprint 5, tarea 5.1).
 *
 * `components/estudios/tarjeta-estudio.tsx` ya navega acá desde la galería
 * -cada tarjeta es un `<Link>` real a esta ruta-, pero el visor de verdad
 * (metadatos completos, resumen de la IA, métricas, archivo embebido por
 * signed URL) es la tarea 5.3 del roadmap, con su propia auditoría
 * `ver_documento`. Esta pantalla existe únicamente para que ese `<Link>`
 * tenga un destino digno en vez de un 404: confirma que el documento existe
 * y es del perfil activo, muestra el título, y avisa que el visor llega en
 * el próximo paso. NO registra `ver_documento` -abrir el stub no es "ver el
 * documento" en el sentido que audita `lib/auditoria.ts`, ese registro
 * arranca recién con el visor real-.
 *
 * `.eq("profile_id", activo.perfil.id)`: mismo patrón que `/estudios`
 * -acotación de la consulta, no la barrera de seguridad-. La política
 * `documents_select_puede_ver` (RLS) es la que de verdad decide qué fila
 * existe para esta sesión; acotar acá además evita que un enlace a un
 * documento de OTRO perfil (uno al que la sesión también tiene acceso, pero
 * que no es el perfil activo ahora mismo) resuelva por accidente: el destino
 * de una tarjeta de esta galería siempre es un documento del perfil que se
 * está viendo.
 *
 * Si el `id` no tiene forma de uuid o la fila no aparece -no existe, es de
 * otro perfil, o RLS la filtró-, se redirige a `/estudios` sin distinguir
 * el motivo (principio 3 de docs/modelo-permisos.md).
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon, HourglassIcon } from "lucide-react"

import { Tarjeta } from "@/components/base/tarjeta"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Estudio — Historial Médico",
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaDetalleEstudio({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { id } = await params

  if (!PATRON_UUID.test(id)) {
    redirect("/estudios")
  }

  const { supabase } = await requerirSesion({ desde: "/estudios" })

  const { data: documento } = await supabase
    .from("documents")
    .select("title")
    .eq("id", id)
    .eq("profile_id", activo.perfil.id)
    .maybeSingle()

  if (!documento) {
    redirect("/estudios")
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <Link
        href="/estudios"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a estudios
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-balance">{documento.title}</h1>

      <Tarjeta className="items-center gap-3 px-(--card-spacing) py-10 text-center">
        <span
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <HourglassIcon className="size-7" />
        </span>
        <p className="text-lg font-semibold text-foreground">El visor llega en el próximo paso</p>
        <p className="max-w-sm text-base text-muted-foreground">
          Estamos construyendo la pantalla para ver el archivo completo, el resumen y las métricas
          de este estudio.
        </p>
      </Tarjeta>
    </div>
  )
}
