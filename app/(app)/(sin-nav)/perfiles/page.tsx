/**
 * Selector de perfiles ("estilo Netflix"): la pantalla posterior al login.
 * Lista los perfiles a los que la sesión tiene acceso -el propio más los
 * otorgados vía `family_permissions`- y, al elegir uno, lo fija como activo
 * y navega a `/inicio`.
 *
 * La consulta es deliberadamente simple: la política RLS
 * `profiles_select_visible` (supabase/migrations/20260812220000_rls.sql) ya
 * filtra `select * from profiles` a exactamente "el propio + los que el
 * actor puede ver por `family_permissions`". No hace falta -ni conviene-
 * reimplementar ese filtro acá; hacerlo sería la clase de duplicación que
 * `lib/auth/guardas.ts` evita a propósito (ver su comentario de cabecera).
 *
 * Lo que la RLS no devuelve son los flags de permiso por perfil (para saber
 * qué badge mostrar), así que se completan con una segunda consulta a
 * `family_permissions` filtrada por `granted_profile_id = perfil actor`
 * -la misma columna que habilita la política `family_permissions_select_
 * propia_o_administrada`, así que siempre devuelve algo, nunca cero filas
 * por RLS de más-.
 */

import type { Metadata } from "next"

import { LogOutIcon } from "lucide-react"

import { cerrarSesion } from "@/app/(auth)/actions"
import { Button } from "@/components/ui/button"
import { PreguntaTamano } from "@/components/perfiles/pregunta-tamano"
import { SelectorPerfiles, type PerfilConRelacion } from "@/components/perfiles/selector-perfiles"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerTamano } from "@/lib/densidad/servidor"

export const metadata: Metadata = {
  title: "Elegí un perfil — Historial Médico",
}

export default async function PaginaPerfiles() {
  const { usuario, supabase } = await requerirSesion({ desde: "/perfiles" })

  const { data: perfiles, error: errorPerfiles } = await supabase
    .from("profiles")
    .select("*")
    .order("full_name", { ascending: true })

  if (errorPerfiles) {
    return (
      <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold">No pudimos cargar tus perfiles</h1>
        <p className="max-w-md text-base text-muted-foreground">
          Probá recargar la página en unos segundos. Si el problema sigue,
          escribinos.
        </p>
        <form action={cerrarSesion}>
          <Button type="submit" variant="outline" className="h-11 text-base">
            Cerrar sesión
          </Button>
        </form>
      </div>
    )
  }

  const perfilPropioId = perfiles?.find((perfil) => perfil.user_id === usuario.id)?.id ?? null

  // Una sola consulta trae los flags de todos los perfiles ajenos a la vez:
  // "las filas donde a mí me otorgaron acceso", sin importar quién es el
  // dueño en cada una.
  const { data: permisosOtorgados } = perfilPropioId
    ? await supabase
        .from("family_permissions")
        .select("owner_profile_id, can_upload, can_manage")
        .eq("granted_profile_id", perfilPropioId)
    : { data: null }

  const permisoPorPerfil = new Map(
    (permisosOtorgados ?? []).map((permiso) => [permiso.owner_profile_id, permiso]),
  )

  const perfilesConRelacion: PerfilConRelacion[] = (perfiles ?? []).map((perfil) => {
    const esPropio = perfil.id === perfilPropioId
    const permiso = permisoPorPerfil.get(perfil.id)

    return {
      perfil,
      esPropio,
      canUpload: esPropio || permiso?.can_upload === true,
      canManage: esPropio || permiso?.can_manage === true,
    }
  })

  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-10 px-4 py-12 sm:py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          ¿Quién usa Historial Médico?
        </h1>
        <p className="text-lg text-muted-foreground">Elegí tu perfil para continuar.</p>
      </div>

      <SelectorPerfiles perfiles={perfilesConRelacion} />

      {/* Conmutador de tamaño (Sprint 13). Va DESPUÉS de la grilla de perfiles
          a propósito: la pregunta principal de esta pantalla es "¿quién sos?",
          y la del tamaño no puede competir con ella. La preferencia es de la
          CUENTA -`await obtenerTamano()`, que lee la fila de `auth.uid()`-, así
          que no cambia según el perfil que se termine eligiendo. */}
      <PreguntaTamano tamano={await obtenerTamano()} />

      <form action={cerrarSesion}>
        <Button
          type="submit"
          variant="ghost"
          className="h-10 gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <LogOutIcon className="size-4" aria-hidden="true" />
          Cerrar sesión
        </Button>
      </form>
    </div>
  )
}
