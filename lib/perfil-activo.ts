import "server-only"

/**
 * Perfil activo: el perfil sobre el que la sesión está operando ahora mismo.
 *
 * Vive en una cookie httpOnly (`perfil_activo`), pero la cookie es
 * **contexto de interfaz, no una credencial** (docs/modelo-permisos.md §1.6
 * y §6.2, último punto: "aunque se fuerce la cookie de perfil activo"). Por
 * eso `obtenerPerfilActivo` no se limita a leerla: revalida
 * `requerirPermiso(perfilId, "view")` contra la base en **cada** llamada, la
 * misma guarda que usa cualquier Server Action. Si la cookie apunta a un
 * perfil sobre el que ya no hay permiso -revocado, o directamente forjada-,
 * se limpia acá mismo y se trata como si no hubiera perfil activo. Nunca se
 * sirve una página con datos de un perfil no autorizado, ni por un instante.
 *
 * Reparto con `lib/auth/guardas.ts`: estas funciones no reimplementan la
 * verificación de permiso, la delegan en `requerirPermiso`. Lo único que
 * agregan es el ciclo de vida de la cookie (fijar / leer y limpiar) y la
 * resolución de los flags de permiso que necesita la interfaz (¿es su
 * perfil?, ¿puede cargar?, ¿puede administrar?) para pintar el badge de
 * relación correcto en `/inicio` y en el selector.
 */

import { cookies } from "next/headers"

import {
  type PermisoConcedido,
  ErrorPerfilInvalido,
  ErrorPermisoDenegado,
  ErrorSesionRequerida,
  esErrorDeGuarda,
  requerirPermiso,
} from "@/lib/auth/guardas"
import type { Perfil } from "@/types/dominio"

/** Nombre de la cookie httpOnly que guarda el perfil activo. */
export const COOKIE_PERFIL_ACTIVO = "perfil_activo"

/** Tope real de un `Set-Cookie` en Chrome/Firefox: no tiene sentido pedir más. */
const MAX_AGE_COOKIE_SEGUNDOS = 400 * 24 * 60 * 60

const PATRON_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Permisos vigentes del actor sobre el perfil activo, ya revalidados contra la base. */
export interface PermisosPerfilActivo {
  /** El actor es el titular con cuenta de este perfil (docs/modelo-permisos.md §3.1). */
  esPropio: boolean
  /** Siempre `true`: si `obtenerPerfilActivo` devuelve algo, ya pasó `requerirPermiso(..., "view")`. */
  canView: boolean
  canUpload: boolean
  canManage: boolean
}

export interface PerfilActivo {
  perfil: Perfil
  permisos: PermisosPerfilActivo
}

/**
 * Fija el perfil activo en una cookie httpOnly.
 *
 * Valida `requerirPermiso(perfilId, "view")` **antes** de escribir la
 * cookie: nunca se persiste, ni transitoriamente, un perfil que la sesión no
 * puede ver. Si la validación falla, lanza `ErrorGuarda` (sesión ausente o
 * permiso denegado) y no toca la cookie.
 */
export async function fijarPerfilActivo(perfilId: string): Promise<void> {
  await requerirPermiso(perfilId, "view", { siNoHaySesion: "lanzar" })

  const cookieStore = await cookies()
  cookieStore.set(COOKIE_PERFIL_ACTIVO, perfilId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_COOKIE_SEGUNDOS,
  })
}

/**
 * Borra la cookie del perfil activo. La usan el logout, "Cambiar de perfil"
 * y la revalidación fallida dentro de `obtenerPerfilActivo`.
 *
 * Ese último caso es el motivo del try/catch: Next.js solo permite escribir
 * cookies desde una Server Action o un Route Handler, y `obtenerPerfilActivo`
 * puede terminar llamando a esta función durante el render de un Server
 * Component (por ejemplo, `/inicio` detectando ahí mismo que el permiso se
 * perdió). En ese contexto de solo lectura, `delete()` lanza
 * `Error: Cookies can only be modified in a Server Action or Route Handler`
 * -el mismo límite que ya documenta `lib/supabase/server.ts` para su
 * `setAll`-. No es un agujero de seguridad: la página igual va a redirigir
 * sin servir ningún dato, porque `obtenerPerfilActivo` ya devolvió `null`
 * antes de intentar esto. La cookie vieja queda huérfana en el navegador
 * hasta el próximo contexto que sí pueda escribir cookies (la siguiente
 * Server Action, típicamente `elegirPerfil` al elegir un perfil real), y
 * mientras tanto sigue revalidándose -y rechazándose- en cada request.
 */
export async function limpiarPerfilActivo(): Promise<void> {
  const cookieStore = await cookies()
  try {
    cookieStore.delete(COOKIE_PERFIL_ACTIVO)
  } catch {
    // Ver comentario de arriba: no-op esperado si esto corre durante el
    // render de un Server Component.
  }
}

/**
 * Lee el perfil activo y **revalida el permiso contra la base en cada
 * llamada**: nunca confía en el valor de la cookie por sí solo.
 *
 * Devuelve `null` cuando:
 * - no hay cookie, o su valor no tiene forma de uuid;
 * - no hay sesión (`ErrorSesionRequerida`) - no hay nada que limpiar, la
 *   cookie puede ser legítima y pertenecer a una sesión que ya expiró;
 * - el perfil no existe o la sesión perdió el permiso `view`
 *   (`ErrorPerfilInvalido` / `ErrorPermisoDenegado`) - acá SÍ se limpia la
 *   cookie, porque es la señal concreta de "esto ya no es válido, no lo
 *   vuelvas a intentar".
 *
 * Un fallo transitorio de verificación (`ErrorVerificacionPermiso`, p. ej.
 * la base no respondió) se propaga en vez de tratarse como "sin perfil
 * activo": un hiccup de red no tiene por qué forzar a elegir perfil de
 * nuevo, y mucho menos borrar la cookie por una falla que nada tiene que ver
 * con el permiso en sí.
 *
 * Quien llama (típicamente una página bajo `app/(app)`) decide qué hacer con
 * `null`; el patrón esperado es `redirect("/perfiles")`.
 */
export async function obtenerPerfilActivo(): Promise<PerfilActivo | null> {
  const cookieStore = await cookies()
  const perfilId = cookieStore.get(COOKIE_PERFIL_ACTIVO)?.value

  if (!perfilId || !PATRON_UUID.test(perfilId)) {
    return null
  }

  let concedido: PermisoConcedido
  try {
    concedido = await requerirPermiso(perfilId, "view", { siNoHaySesion: "lanzar" })
  } catch (error) {
    if (error instanceof ErrorSesionRequerida) {
      return null
    }
    if (error instanceof ErrorPermisoDenegado || error instanceof ErrorPerfilInvalido) {
      await limpiarPerfilActivo()
      return null
    }
    // ErrorVerificacionPermiso u otra cosa inesperada: no es una revocación,
    // así que no se borra la cookie. Se propaga.
    throw error
  }

  const { supabase, usuario } = concedido

  const { data: perfil, error: errorPerfil } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", perfilId)
    .maybeSingle()

  if (errorPerfil || !perfil) {
    // `requerirPermiso` dijo que sí, pero la fila no aparece (borrada entre
    // medio, por ejemplo). Se trata igual que un permiso perdido: se limpia
    // y se pide elegir de nuevo, en vez de servir una página a medio llenar.
    await limpiarPerfilActivo()
    return null
  }

  const esPropio = perfil.user_id === usuario.id

  if (esPropio) {
    return {
      perfil,
      permisos: { esPropio: true, canView: true, canUpload: true, canManage: true },
    }
  }

  const { data: perfilActor } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", usuario.id)
    .maybeSingle()

  let canUpload = false
  let canManage = false

  if (perfilActor) {
    const { data: permiso } = await supabase
      .from("family_permissions")
      .select("can_upload, can_manage")
      .eq("owner_profile_id", perfilId)
      .eq("granted_profile_id", perfilActor.id)
      .maybeSingle()

    canUpload = permiso?.can_upload ?? false
    canManage = permiso?.can_manage ?? false
  }

  return {
    perfil,
    permisos: { esPropio: false, canView: true, canUpload, canManage },
  }
}

// Re-exportado para que quien maneja el resultado de `fijarPerfilActivo` en
// una Server Action pueda distinguir "permiso denegado" sin importar directo
// de `lib/auth/guardas`.
export { esErrorDeGuarda }
