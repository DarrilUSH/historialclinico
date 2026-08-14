/**
 * Pantalla "Familia" del PERFIL ACTIVO: lista quién tiene acceso otorgado
 * sobre este perfil, permite invitar por email, editar flags de un acceso
 * existente y revocarlo.
 *
 * Autoridad para ENTRAR y OPERAR acá (docs/modelo-permisos.md §4.4, "regla
 * de la autoridad de otorgamiento"): el DUEÑO del perfil (`esPropio`), o
 * -SOLO si el perfil es gestionado (`user_id IS NULL`)- un `can_manage`
 * sobre él. Un `can_manage` sobre un perfil CON cuenta administra contenido
 * pero NO tiene autoridad de otorgamiento: ni siquiera puede entrar acá. RLS
 * es el backstop real (las políticas de `family_permissions` rechazarían
 * igual cualquier escritura), pero esta pantalla no ofrece un formulario que
 * la base va a negar.
 *
 * Los nombres de los autorizados salen de `nombres_de_perfiles_vinculados()`
 * (supabase/migrations/20260812240000_rpc_permisos.sql): cierra la
 * limitación de `profiles_select_visible` documentada en
 * docs/seguridad-rls.md §5 ("Limitación conocida que hereda el Sprint 2")
 * sin relajar esa política.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon, ScrollTextIcon, UsersIcon } from "lucide-react"

import { FormularioInvitar } from "@/components/familia/formulario-invitar"
import { TarjetaPermiso, type FilaPermiso } from "@/components/familia/tarjeta-permiso"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Familia — Historial Médico",
}

export default async function PaginaFamilia() {
  const perfilActivo = await obtenerPerfilActivo()

  if (!perfilActivo) {
    redirect("/perfiles")
  }

  const { perfil, permisos } = perfilActivo
  const esGestionado = perfil.user_id === null
  // Regla de la autoridad de otorgamiento (docs/modelo-permisos.md §4.4):
  // dueño, o can_manage SOLO cuando el perfil es gestionado.
  const autorizado = permisos.esPropio || (esGestionado && permisos.canManage)

  if (!autorizado) {
    return <AccesoDenegado nombrePerfil={perfil.full_name} />
  }

  const { usuario, supabase } = await requerirSesion({ desde: "/perfiles" })

  const perfilActorId = permisos.esPropio
    ? perfil.id
    : ((await supabase.from("profiles").select("id").eq("user_id", usuario.id).maybeSingle())
        .data?.id ?? null)

  const [{ data: filasPermiso, error: errorPermisos }, { data: nombres }] = await Promise.all([
    supabase
      .from("family_permissions")
      .select("id, granted_profile_id, can_upload, can_manage, created_at")
      .eq("owner_profile_id", perfil.id)
      .order("created_at", { ascending: true }),
    supabase.rpc("nombres_de_perfiles_vinculados"),
  ])

  if (errorPermisos) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold">No pudimos cargar los accesos</h1>
        <p className="max-w-md text-base text-muted-foreground">
          Probá recargar la página en unos segundos. Si el problema sigue, escribinos.
        </p>
      </div>
    )
  }

  const nombrePorPerfilId = new Map(
    (nombres ?? []).map((fila) => [fila.perfil_id, fila.full_name]),
  )

  const filas: FilaPermiso[] = (filasPermiso ?? []).map((fila) => ({
    id: fila.id,
    perfilVinculadoId: fila.granted_profile_id,
    nombre: nombrePorPerfilId.get(fila.granted_profile_id) ?? "Perfil sin nombre",
    canUpload: fila.can_upload,
    canManage: fila.can_manage,
  }))

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-10 sm:py-14 chica:gap-6 chica:py-6">
      <div className="flex flex-col gap-4 chica:gap-3">
        <Link
          href="/inicio"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          Volver
        </Link>

        <div className="flex items-center gap-3 chica:gap-2">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UsersIcon className="size-5" aria-hidden="true" />
          </span>
          <div className="flex flex-col">
            <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Familia de {perfil.full_name}
            </h1>
            <p className="text-base text-muted-foreground">
              Quién puede ver, cargar o administrar este historial.
            </p>
          </div>
        </div>
      </div>

      {/*
        Entrada a la lista de accesos (app/(app)/(con-nav)/familia/accesos). Vive acá y
        no en el inicio porque la autoridad para verla es exactamente la misma
        que la de esta pantalla (docs/modelo-permisos.md §4.1: un can_view no
        ve la lista de accesos), así que quien puede ver este enlace es
        siempre quien puede abrirlo.
      */}
      <Link
        href="/familia/accesos"
        className="flex items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background chica:gap-2 chica:p-3"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ScrollTextIcon className="size-5" aria-hidden="true" />
        </span>
        <span className="flex flex-col">
          <span className="text-base font-medium text-foreground">Ver accesos al historial</span>
          <span className="text-sm text-muted-foreground">
            Quién entró a los datos de {perfil.full_name} y cuándo.
          </span>
        </span>
      </Link>

      <section className="flex flex-col gap-4 chica:gap-3">
        <h2 className="text-lg font-semibold text-foreground">Accesos otorgados</h2>

        {filas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-base text-muted-foreground chica:p-4">
            Todavía no le diste acceso a nadie sobre este perfil.
          </p>
        ) : (
          <ul className="flex flex-col gap-3 chica:gap-2">
            {filas.map((fila) => (
              <TarjetaPermiso
                key={fila.id}
                perfilId={perfil.id}
                permiso={fila}
                bloqueadaPorOtroAdministrador={
                  fila.canManage && fila.perfilVinculadoId !== perfilActorId
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4 chica:gap-3">
        <h2 className="text-lg font-semibold text-foreground">Invitar a alguien</h2>
        <FormularioInvitar perfilId={perfil.id} />
      </section>
    </div>
  )
}

function AccesoDenegado({ nombrePerfil }: { nombrePerfil: string }) {
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold">No podés administrar estos accesos</h1>
      <p className="max-w-md text-base text-muted-foreground">
        Solo quien es dueño de <strong>{nombrePerfil}</strong>, o quien lo administra cuando es un
        perfil gestionado, puede ver y cambiar quién tiene acceso.
      </p>
      <Link
        href="/inicio"
        className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-4 text-base font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a inicio
      </Link>
    </div>
  )
}
