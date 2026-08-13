/**
 * `/estudios/nuevo`: la pantalla de carga de un documento.
 *
 * Dos guardas, no una:
 *
 * 1. **Perfil activo válido** -mismo patrón que `/inicio`, `/familia`,
 *    `/estudios` y `/turnos`: se revalida `obtenerPerfilActivo()` aunque el
 *    layout ya lo haya hecho (memoizado con `cache()`, sin costo extra de
 *    red), porque esta página tiene que ser correcta sola.
 * 2. **`can_upload`** (docs/modelo-permisos.md §4.2). Sin ese permiso la
 *    pantalla NO ofrece subir: no se monta el cargador. Es la contraparte
 *    visible de la guarda de la Server Action, que es la que realmente
 *    autoriza -y de las políticas RLS de `storage.objects` y `documents`, que
 *    son la última palabra-. No ofrecerle a alguien un formulario que la base
 *    va a rechazar es una decisión de interfaz, no de seguridad: las tres
 *    capas dicen lo mismo, y sacar cualquiera de ellas no habilita nada.
 *
 * El pipeline de extracción con IA llega en las tareas siguientes del Sprint 4
 * (ROADMAP_SPRINTS.md): esta pantalla sube el archivo y redirige a
 * `/estudios/nuevo/procesando`, que hoy es un placeholder con el hook listo.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon, EyeIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

import { PantallaNuevoEstudio } from "./pantalla-carga"

export const metadata: Metadata = {
  title: "Subir estudio — Historial Médico",
}

export default async function PaginaNuevoEstudio() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canUpload) {
    return <SinPermisoDeCarga nombrePerfil={activo.perfil.full_name} />
  }

  return <PantallaNuevoEstudio />
}

function SinPermisoDeCarga({ nombrePerfil }: { nombrePerfil: string }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <span
        className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <EyeIcon className="size-8" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">
        No podés subir estudios acá
      </h1>
      <p className="max-w-md text-base text-muted-foreground">
        Tenés acceso de solo lectura al historial de <strong>{nombrePerfil}</strong>: podés ver
        sus estudios, pero no cargar documentos nuevos. Si necesitás hacerlo, pedile permiso a
        quien administra el perfil.
      </p>
      {/* `nativeButton={false}`: el `render` es un `<Link>` (navegación real),
          no un `<button>` nativo. */}
      <Boton
        render={<Link href="/estudios" />}
        nativeButton={false}
        variant="outline"
        size="lg"
        className="mt-2"
      >
        <ArrowLeftIcon aria-hidden="true" />
        Volver a Estudios
      </Boton>
    </div>
  )
}
