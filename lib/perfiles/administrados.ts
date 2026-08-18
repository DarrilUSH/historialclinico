import "server-only"

/**
 * Los perfiles que la CUENTA en sesión administra (Sprint 17, auto-carga).
 *
 * Se lee con el cliente del USUARIO, por RLS, y con exactamente el mismo patrón
 * de dos consultas que ya usa el selector de perfiles
 * (`app/(app)/(sin-nav)/perfiles/page.tsx`): la política `profiles_select_visible`
 * filtra "el propio + los que el actor puede ver", y una segunda consulta a
 * `family_permissions` trae los flags para saber cuáles de esos, además, se
 * administran. No se reimplementa el filtro de RLS acá —hacerlo sería la clase
 * de duplicación que `lib/auth/guardas.ts` evita a propósito—.
 *
 * ## Por qué ADMINISTRA y no "puede cargar"
 *
 * Esta lista alimenta un único selector: el del perfil de destino de la carga
 * automática. Ese destino tiene que ser un perfil que la persona pueda
 * ADMINISTRAR, no solo uno donde pueda subir, porque "Deshacer" borra el
 * documento y `documents_delete_administrador` exige `can_manage`. Una
 * auto-carga que no se puede deshacer sería peor que no tenerla. El
 * razonamiento completo está en el encabezado de
 * `supabase/migrations/20260818160000_gmail_auto_ingesta.sql`.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

export interface PerfilAdministrado {
  id: string
  nombre: string
  /** `true` si es el perfil propio de la cuenta (el titular con cuenta). */
  esPropio: boolean
}

/**
 * Los perfiles que `userId` administra, ordenados por nombre y con el propio
 * primero.
 *
 * Devuelve lista vacía ante cualquier error de la base: la pantalla muestra
 * "no hay perfiles para elegir" y el interruptor no se puede encender, que es
 * el modo seguro de fallar (jamás ofrecer un destino que no se pudo verificar).
 */
export async function listarPerfilesAdministrados(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<PerfilAdministrado[]> {
  const { data: perfiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, user_id")
    .order("full_name", { ascending: true })

  if (error || !perfiles) {
    console.error("[perfiles] no se pudieron listar los perfiles administrados:", error?.message)
    return []
  }

  const perfilPropio = perfiles.find((perfil) => perfil.user_id === userId) ?? null

  const { data: permisos } = perfilPropio
    ? await supabase
        .from("family_permissions")
        .select("owner_profile_id, can_manage")
        .eq("granted_profile_id", perfilPropio.id)
    : { data: null }

  const administrados = new Set(
    (permisos ?? []).filter((permiso) => permiso.can_manage).map((permiso) => permiso.owner_profile_id),
  )

  return perfiles
    .filter((perfil) => perfil.id === perfilPropio?.id || administrados.has(perfil.id))
    .map((perfil) => ({
      id: perfil.id,
      nombre: perfil.full_name,
      esPropio: perfil.id === perfilPropio?.id,
    }))
    .sort((a, b) => {
      if (a.esPropio !== b.esPropio) return a.esPropio ? -1 : 1
      return a.nombre.localeCompare(b.nombre, "es")
    })
}
