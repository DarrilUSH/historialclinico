/**
 * `/estudios/nuevo/procesando?doc={id}`: pantalla de aterrizaje después de una
 * subida exitosa, y punto donde arranca la lectura automática con Gemini.
 *
 * Server Component: guarda (perfil activo + sesión) y resuelve el título del
 * documento para el encabezado, con el cliente del USUARIO -si RLS lo
 * devuelve, el permiso está verificado, y si no aparece (id inventado, perfil
 * cambiado en otra pestaña) la pantalla simplemente no lo nombra. No se
 * distingue "no existe" de "no tenés permiso", por el principio 3 de
 * docs/modelo-permisos.md.
 *
 * La extracción en sí -el `fetch` a `POST /api/documentos/extraer`, los
 * estados de carga y el resultado- vive en `PantallaProcesando`
 * (`./pantalla-procesando.tsx`), un Client Component: necesita `useEffect`
 * para dispararse al montar y estado de React para las tres fases (leyendo /
 * listo / error), igual que `pantalla-carga.tsx` en `/estudios/nuevo`.
 *
 * Si `doc` falta o no tiene forma de uuid (alguien entró a la URL a mano, sin
 * pasar por la subida) no se intenta ninguna extracción: no tiene sentido
 * gastar cuota de Gemini por un id que ni siquiera es válido.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { CircleCheckIcon, FlaskConicalIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

import { PantallaProcesando } from "./pantalla-procesando"

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
  const documentoId = doc && PATRON_UUID.test(doc) ? doc : null
  let titulo: string | null = null

  if (documentoId) {
    const { supabase } = await requerirSesion({ desde: "/estudios" })
    const { data } = await supabase
      .from("documents")
      .select("title")
      .eq("id", documentoId)
      .maybeSingle()

    titulo = data?.title ?? null
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-4 py-12">
      <div className="flex flex-col items-center gap-4 text-center">
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
      </div>

      {documentoId ? (
        <PantallaProcesando documentoId={documentoId} />
      ) : (
        /* `nativeButton={false}`: el `render` es un `<Link>` (navegación
           real), no un `<button>` nativo -mismo caso que en `/estudios`-. */
        <Boton render={<Link href="/estudios" />} nativeButton={false} size="lg">
          <FlaskConicalIcon aria-hidden="true" />
          Ver mis estudios
        </Boton>
      )}
    </div>
  )
}
