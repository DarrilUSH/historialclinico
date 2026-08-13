/**
 * `/estudios/nuevo/procesando?doc={id}`: pantalla de aterrizaje después de una
 * subida exitosa.
 *
 * Es un PLACEHOLDER CON HOOK, no una pantalla terminada. La tarea siguiente
 * del Sprint 4 (ROADMAP_SPRINTS.md, "Route Handler de extracción con Gemini")
 * reemplaza el cartel por la lectura automática del documento: el `?doc={id}`
 * ya está acá justamente para que esa tarea tenga de dónde agarrarse -llama al
 * route handler con ese id, muestra el progreso y sigue a la pantalla de
 * revisión-. Por eso la subida redirige acá y no a `/estudios` directamente:
 * el paso intermedio del flujo existe desde ahora, aunque todavía no haga
 * nada.
 *
 * El título del documento se lee con el cliente del USUARIO: si RLS lo
 * devuelve, el permiso está verificado, y si no aparece (id inventado, perfil
 * cambiado en otra pestaña) la pantalla simplemente no lo nombra. No se
 * distingue "no existe" de "no tenés permiso", por el principio 3 de
 * docs/modelo-permisos.md.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { CircleCheckIcon, FlaskConicalIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Documento guardado — Historial Médico",
}

const PATRON_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaProcesando({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { doc } = await searchParams
  let titulo: string | null = null

  if (doc && PATRON_UUID.test(doc)) {
    const { supabase } = await requerirSesion({ desde: "/estudios" })
    const { data } = await supabase
      .from("documents")
      .select("title")
      .eq("id", doc)
      .maybeSingle()

    titulo = data?.title ?? null
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      <span
        className="flex size-16 shrink-0 items-center justify-center rounded-full bg-exito-suave text-exito-fuerte"
        aria-hidden="true"
      >
        <CircleCheckIcon className="size-8" />
      </span>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          Documento guardado
        </h1>
        {titulo && <p className="text-lg font-medium text-foreground">{titulo}</p>}
        <p className="text-base text-muted-foreground">
          Ya quedó guardado en el historial de {activo.perfil.full_name}.
        </p>
      </div>

      <Alerta variante="info" estatica className="text-left">
        La lectura automática llega en el próximo paso: vamos a leer el documento para completar
        solo la fecha, el tipo de estudio y los resultados.
      </Alerta>

      {/* `nativeButton={false}`: el `render` es un `<Link>` (navegación real),
          no un `<button>` nativo -mismo caso que en `/estudios`-. */}
      <Boton render={<Link href="/estudios" />} nativeButton={false} size="lg">
        <FlaskConicalIcon aria-hidden="true" />
        Ver mis estudios
      </Boton>
    </div>
  )
}
