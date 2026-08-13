/**
 * "Quién entró a este historial": los últimos 50 accesos registrados sobre el
 * PERFIL ACTIVO, en lenguaje humano.
 *
 * ## Quién puede ver esta pantalla
 *
 * La misma autoridad que `/familia` (docs/modelo-permisos.md §4.1 y §4.3): el
 * TITULAR del perfil, o -SOLO si el perfil es gestionado (`user_id IS NULL`)-
 * un `can_manage` sobre él. Un `can_view` NO entra acá aunque vea todos los
 * datos de salud del perfil: la lista de accesos es el instrumento con el que
 * el titular controla a sus propios autorizados, y dársela a un autorizado la
 * vacía de sentido y le expone la composición del grupo familiar.
 *
 * La guarda de esta página no es la protección real: la política
 * `access_logs_select_propias_o_titular`
 * (supabase/migrations/20260812220000_rls.sql) usa `puede_otorgar_permisos`,
 * el mismo predicado, así que un `can_view` que llegue igual a esta URL no
 * obtiene filas de otros -solo las suyas propias, que son dato suyo-. La
 * guarda existe para dar un mensaje claro en vez de una pantalla vacía y
 * ambigua.
 *
 * ## Qué filas se muestran
 *
 * `profile_id = perfil activo`: los accesos A ESTE historial. Una fila de
 * `login` queda a nombre del perfil propio de quien inició sesión (iniciar
 * sesión no es un acceso a datos de un tercero), así que aparece en la lista
 * de accesos de ESE perfil y no en la del adulto mayor. Es la lectura
 * correcta: "quién entró a mi historial" no es "qué hizo esta persona en la
 * aplicación".
 *
 * ## Nombres
 *
 * Salen de `nombres_de_perfiles_vinculados()` (los autorizados sobre este
 * perfil), más el perfil propio del actor y el perfil activo. Si un actor no
 * resuelve -su permiso fue revocado y ya no está en la lista de vinculados, o
 * su perfil fue borrado y la FK quedó en NULL por `ON DELETE SET NULL`- se
 * muestra "Alguien con acceso (revocado)": el rastro no se pierde ni se
 * inventa un nombre.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon, ScrollTextIcon } from "lucide-react"

import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import type { AccionAcceso } from "@/types/dominio"

export const metadata: Metadata = {
  title: "Accesos — Historial Médico",
}

/**
 * Sin paginación a propósito: 50 filas entran en una pantalla larga y se leen
 * de un scroll. Cuando el volumen lo pida (Sprint 4 en adelante, con
 * `ver_documento` y `descargar_archivo` cableados, la tabla crece bastante más
 * rápido que ahora), lo que corresponde no es un "cargar más" infinito sino
 * filtros por fecha y por persona: la pregunta real del titular es "¿quién
 * entró la semana pasada?", no "¿cuál fue el acceso número 380?".
 */
const MAXIMO_ACCESOS = 50

const NOMBRE_ACTOR_DESCONOCIDO = "Alguien con acceso (revocado)"

/**
 * Cada acción del enum `public.access_action` en lenguaje humano. Es un
 * `Record` sobre el tipo del enum y no un `switch` con `default`: si una
 * migración agrega un literal y se regeneran los tipos, esto no compila hasta
 * que alguien escriba la frase. Una acción auditada que la vista no sabe
 * nombrar sería un acceso invisible para el titular.
 */
const FRASE_POR_ACCION: Record<AccionAcceso, (titular: string) => string> = {
  login: () => "inició sesión",
  logout: () => "cerró sesión",
  ver_perfil: (titular) => `entró al perfil de ${titular}`,
  ver_documento: (titular) => `vio un estudio de ${titular}`,
  descargar_archivo: (titular) => `descargó un archivo de ${titular}`,
  ver_credencial: (titular) => `vio una credencial de ${titular}`,
  exportar_ficha: (titular) => `exportó la ficha de ${titular}`,
  otorgar_permiso: (titular) => `otorgó un acceso al perfil de ${titular}`,
  revocar_permiso: (titular) => `revocó un acceso al perfil de ${titular}`,
}

/**
 * Hora de pared de Ushuaia, siempre. El servidor puede estar en cualquier
 * zona y `created_at` es `timestamptz`: la conversión se hace acá, en el
 * borde, como fija la convención del proyecto (comentario de
 * `appointments.appointment_date` en el esquema inicial).
 */
const FORMATO_FECHA_HORA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Ushuaia",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

function formatearFechaHora(iso: string): string {
  // "12/08/2026, 14:30" -> "12/08/2026 14:30"
  return FORMATO_FECHA_HORA.format(new Date(iso)).replace(",", "")
}

export default async function PaginaAccesos() {
  const perfilActivo = await obtenerPerfilActivo()

  if (!perfilActivo) {
    redirect("/perfiles")
  }

  const { perfil, permisos } = perfilActivo
  const esGestionado = perfil.user_id === null
  const autorizado = permisos.esPropio || (esGestionado && permisos.canManage)

  if (!autorizado) {
    return <AccesoDenegado nombrePerfil={perfil.full_name} />
  }

  const { usuario, supabase } = await requerirSesion({ desde: "/perfiles" })

  const [{ data: accesos, error: errorAccesos }, { data: nombres }, { data: perfilPropio }] =
    await Promise.all([
      supabase
        .from("access_logs")
        .select("id, actor_profile_id, action, ip, created_at")
        .eq("profile_id", perfil.id)
        .order("created_at", { ascending: false })
        .limit(MAXIMO_ACCESOS),
      supabase.rpc("nombres_de_perfiles_vinculados"),
      supabase.from("profiles").select("id, full_name").eq("user_id", usuario.id).maybeSingle(),
    ])

  if (errorAccesos) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold">No pudimos cargar los accesos</h1>
        <p className="max-w-md text-base text-muted-foreground">
          Probá recargar la página en unos segundos. Si el problema sigue, escribinos.
        </p>
      </div>
    )
  }

  const nombrePorPerfilId = new Map<string, string>(
    (nombres ?? []).map((fila) => [fila.perfil_id, fila.full_name]),
  )
  // El perfil activo y el perfil propio del actor no están necesariamente en
  // `nombres_de_perfiles_vinculados()` (esa función devuelve los AUTORIZADOS
  // sobre lo que el actor administra), y los dos aparecen como actores.
  nombrePorPerfilId.set(perfil.id, perfil.full_name)
  if (perfilPropio) {
    nombrePorPerfilId.set(perfilPropio.id, perfilPropio.full_name)
  }

  const filas = (accesos ?? []).map((fila) => ({
    id: fila.id,
    nombreActor:
      (fila.actor_profile_id ? nombrePorPerfilId.get(fila.actor_profile_id) : null) ??
      NOMBRE_ACTOR_DESCONOCIDO,
    frase: FRASE_POR_ACCION[fila.action](perfil.full_name),
    // `ip` es `inet` en la base y los tipos generados la traen como `unknown`.
    ip: typeof fila.ip === "string" ? fila.ip : null,
    creadoEn: fila.created_at,
  }))

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-10 sm:py-14">
      <div className="flex flex-col gap-4">
        <Link
          href="/familia"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          Volver a Familia
        </Link>

        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ScrollTextIcon className="size-5" aria-hidden="true" />
          </span>
          <div className="flex flex-col">
            <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Accesos al historial de {perfil.full_name}
            </h1>
            <p className="text-base text-muted-foreground">
              Quién entró y qué hizo. Se muestran los últimos {MAXIMO_ACCESOS} registros.
            </p>
          </div>
        </div>
      </div>

      {filas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-base text-muted-foreground">
          Todavía no hay accesos registrados en este historial.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filas.map((fila) => (
            <li
              key={fila.id}
              className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4"
            >
              <p className="text-base text-card-foreground">
                <strong className="font-semibold">{fila.nombreActor}</strong> {fila.frase}{" "}
                <span className="text-muted-foreground">—</span>{" "}
                <time dateTime={fila.creadoEn} className="tabular-nums">
                  {formatearFechaHora(fila.creadoEn)}
                </time>
              </p>
              <p className="text-sm text-muted-foreground">
                {fila.ip ? `Desde la dirección IP ${fila.ip}` : "Sin dirección IP registrada"}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-muted-foreground">
        Este registro no se puede editar ni borrar, tampoco por vos: queda como constancia de
        quién accedió a estos datos de salud.
      </p>
    </div>
  )
}

function AccesoDenegado({ nombrePerfil }: { nombrePerfil: string }) {
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold">No podés ver estos accesos</h1>
      <p className="max-w-md text-base text-muted-foreground">
        La lista de quién entró al historial de <strong>{nombrePerfil}</strong> es solo para
        quien es dueño del perfil, o para quien lo administra cuando es un perfil gestionado.
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
