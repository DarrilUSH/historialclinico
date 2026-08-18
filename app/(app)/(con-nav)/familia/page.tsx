/**
 * Pantalla "Familia" del PERFIL ACTIVO: lista quién tiene acceso otorgado
 * sobre este perfil, permite invitar por email, editar flags de un acceso
 * existente y revocarlo.
 *
 * Autoridad para ENTRAR y OPERAR la sección de accesos (docs/modelo-permisos.md
 * §4.4, "regla de la autoridad de otorgamiento"): el DUEÑO del perfil
 * (`esPropio`), o -SOLO si el perfil es gestionado (`user_id IS NULL`)- un
 * `can_manage` sobre él. Un `can_manage` sobre un perfil CON cuenta
 * administra contenido pero NO tiene autoridad de otorgamiento: ni siquiera
 * puede entrar acá. RLS es el backstop real (las políticas de
 * `family_permissions` rechazarían igual cualquier escritura), pero esta
 * pantalla no ofrece un formulario que la base va a negar.
 *
 * Los nombres de los autorizados salen de `nombres_de_perfiles_vinculados()`
 * (supabase/migrations/20260812240000_rpc_permisos.sql): cierra la
 * limitación de `profiles_select_visible` documentada en
 * docs/seguridad-rls.md §5 ("Limitación conocida que hereda el Sprint 2")
 * sin relajar esa política.
 *
 * ## "Crear un perfil para un familiar sin cuenta" (Sprint 15, tarea 15.1)
 *
 * Vive en esta misma pantalla pero es una sección INDEPENDIENTE del perfil
 * activo: crear un perfil gestionado nuevo no es una operación sobre
 * `perfil` (el activo), es una operación de la CUENTA -cualquiera con su
 * propio perfil puede crear uno-. Por eso se renderiza SIEMPRE, antes del
 * gate de `autorizado` (que solo protege la administración de accesos DEL
 * perfil activo) y sin depender de `esGestionado`/`permisos` de ese perfil
 * en absoluto.
 *
 * ## "Darle su propia cuenta" (Sprint 15, tarea 15.2)
 *
 * Al revés que la anterior, la GRADUACIÓN sí es una operación sobre el perfil
 * ACTIVO: es "este perfil pasa a tener dueño". Por eso esta pantalla es su
 * lugar natural -para graduar a Lucas hay que estar mirando a Lucas, igual
 * que para administrar sus accesos- y no hace falta inventar una pantalla de
 * detalle por perfil, que el producto no tiene.
 *
 * Quién la ve: **solo el CREADOR** del perfil gestionado, y la pregunta la
 * contesta la BASE (`puede_graduar_perfil()`,
 * `supabase/migrations/20260817230000_graduacion.sql`), no una comparación
 * hecha acá. Es MÁS estricta que `autorizado` -que sobre un gestionado
 * alcanza a cualquier `can_manage`-, a propósito: darle una cuenta a una
 * persona es decidir sobre su identidad, no sobre sus datos. Esconder la
 * sección no es el control: `graduarPerfilGestionado` vuelve a consultar la
 * misma función antes de crear nada.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import {
  ArrowLeftIcon,
  KeyRoundIcon,
  ScrollTextIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react"

import { FormularioCrearGestionado } from "@/components/familia/formulario-crear-gestionado"
import { FormularioGraduacion } from "@/components/familia/formulario-graduacion"
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
              Familia
            </h1>
            <p className="text-base text-muted-foreground">
              Quién puede ver, cargar o administrar cada historial, y a quién gestionás vos.
            </p>
          </div>
        </div>
      </div>

      {/*
        Sección de creación de perfiles gestionados (Sprint 15, tarea 15.1):
        siempre visible, sin relación con `autorizado` de abajo -ver el
        comentario de cabecera del archivo-.
      */}
      {/* `id="crear-perfil-gestionado"`: destino del consejo "¿Un hijo o un
          padre sin celular?" del tutorial de bienvenida (tarea #14,
          `lib/consejos/contenido.ts`). Esta sección ya es independiente del
          perfil activo (ver el comentario de cabecera del archivo), así que
          el CTA es un `<Link>` directo, sin pasar por `/familia/enlace`. */}
      <section id="crear-perfil-gestionado" className="flex flex-col gap-4 chica:gap-3">
        <div className="flex items-center gap-3 chica:gap-2">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserPlusIcon className="size-5" aria-hidden="true" />
          </span>
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold text-foreground">
              Crear un perfil para un familiar sin cuenta
            </h2>
            <p className="text-sm text-muted-foreground">
              Sirve para un hijo o una hija, o para una persona mayor sin email: vos administrás
              su historial desde tu cuenta.
            </p>
          </div>
        </div>
        <FormularioCrearGestionado />
      </section>

      {/*
        Graduación (Sprint 15, tarea 15.2). Solo tiene sentido preguntarle a
        la base cuando el perfil activo es gestionado: para uno con cuenta la
        respuesta es siempre `false` y el viaje sería puro costo.
      */}
      {esGestionado && (
        <SeccionGraduacion perfilId={perfil.id} perfilNombre={perfil.full_name} />
      )}

      {!autorizado ? (
        <AccesoDenegadoInline nombrePerfil={perfil.full_name} />
      ) : (
        <SeccionAccesosDelPerfilActivo perfilId={perfil.id} perfilNombre={perfil.full_name} esPropio={permisos.esPropio} />
      )}
    </div>
  )
}

/**
 * "Darle su propia cuenta". Se renderiza únicamente para el CREADOR del
 * perfil gestionado, y quien lo decide es `puede_graduar_perfil()` en la
 * base: acá no se recalcula el predicado -mismo criterio que
 * `lib/auth/guardas.ts`, "reescribirlo en TypeScript garantizaría que algún
 * día la app y la base opinen distinto"-.
 *
 * Función `async` propia, como `SeccionAccesosDelPerfilActivo`, para que la
 * consulta no se dispare cuando el perfil activo no es gestionado.
 */
async function SeccionGraduacion({
  perfilId,
  perfilNombre,
}: {
  perfilId: string
  perfilNombre: string
}) {
  const { supabase } = await requerirSesion({ desde: "/familia" })

  const { data: puedeGraduar } = await supabase.rpc("puede_graduar_perfil", {
    perfil: perfilId,
  })

  if (puedeGraduar !== true) {
    return null
  }

  return (
    <section className="flex flex-col gap-4 chica:gap-3">
      <div className="flex items-center gap-3 chica:gap-2">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRoundIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold text-foreground">Darle su propia cuenta</h2>
          <p className="text-sm text-muted-foreground">
            Si {perfilNombre} ya puede manejar su historial, dale un correo y una contraseña
            para entrar por su cuenta.
          </p>
        </div>
      </div>
      <FormularioGraduacion perfilId={perfilId} perfilNombre={perfilNombre} />
    </section>
  )
}

/**
 * Accesos del perfil ACTIVO: link a la lista de accesos, accesos otorgados
 * e "invitar a alguien". Separado en su propia función `async` -en vez de
 * quedar inline en `PaginaFamilia`- para que las consultas que solo hacen
 * falta cuando `autorizado === true` no se disparen cuando no lo es.
 */
async function SeccionAccesosDelPerfilActivo({
  perfilId,
  perfilNombre,
  esPropio,
}: {
  perfilId: string
  perfilNombre: string
  esPropio: boolean
}) {
  const { usuario, supabase } = await requerirSesion({ desde: "/perfiles" })

  const perfilActorId = esPropio
    ? perfilId
    : ((await supabase.from("profiles").select("id").eq("user_id", usuario.id).maybeSingle())
        .data?.id ?? null)

  const [{ data: filasPermiso, error: errorPermisos }, { data: nombres }] = await Promise.all([
    supabase
      .from("family_permissions")
      .select("id, granted_profile_id, can_upload, can_manage, created_at")
      .eq("owner_profile_id", perfilId)
      .order("created_at", { ascending: true }),
    supabase.rpc("nombres_de_perfiles_vinculados"),
  ])

  if (errorPermisos) {
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <h2 className="text-xl font-semibold">No pudimos cargar los accesos</h2>
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
    <>
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
            Quién entró a los datos de {perfilNombre} y cuándo.
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
                perfilId={perfilId}
                permiso={fila}
                // Nota ⑥ de docs/seguridad-rls.md §3.2, con su alcance exacto:
                // la prohibición de destituir a OTRO administrador rige para
                // los administradores de un perfil gestionado, **no para el
                // titular**. Las dos políticas lo dicen igual —
                // `family_permissions_update_autoridad` y
                // `family_permissions_delete_autoridad` arrancan las dos con
                // `es_titular(owner_profile_id) or (...)`—: el titular revoca
                // y edita cualquier acceso a SUS datos, sin excepción.
                //
                // El `!esPropio` faltaba y se detectó probando la graduación
                // en el teléfono (Sprint 15, tarea 15.2): recién graduado,
                // Lucas entraba a su propia Familia y veía "no podés editar ni
                // revocar su acceso" sobre quien lo había administrado hasta
                // ese día — justo lo contrario de la decisión de producto del
                // sprint ("el nuevo titular puede revocarlos desde Familia") y
                // de lo que la base permite. Sin la condición, `esPropio`
                // fijaba `perfilActorId = perfilId` (el perfil dueño), y como
                // nadie puede tener acceso sobre sí mismo (CHECK de no
                // autorreferencia) la comparación daba `true` siempre: TODA
                // fila `can_manage` quedaba bloqueada para el titular.
                bloqueadaPorOtroAdministrador={
                  !esPropio && fila.canManage && fila.perfilVinculadoId !== perfilActorId
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* `id="invitar"`: destino de `/familia/enlace` -el CTA del consejo
          "Compartí con tu familia" del tutorial de bienvenida, tarea #14-.
          Ver el encabezado de ese Route Handler. */}
      <section id="invitar" className="flex flex-col gap-4 chica:gap-3">
        <h2 className="text-lg font-semibold text-foreground">Invitar a alguien</h2>
        <FormularioInvitar perfilId={perfilId} perfilNombre={perfilNombre} />
      </section>
    </>
  )
}

function AccesoDenegadoInline({ nombrePerfil }: { nombrePerfil: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-6 text-center">
      <h2 className="text-lg font-semibold text-foreground">
        No podés administrar los accesos de {nombrePerfil}
      </h2>
      <p className="text-sm text-muted-foreground">
        Solo quien es dueño de este perfil, o quien lo administra cuando es un perfil gestionado,
        puede ver y cambiar quién tiene acceso. Podés cambiar de perfil activo desde el
        encabezado.
      </p>
    </div>
  )
}
