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

import { cache } from "react"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"

import { ACCION, registrarAcceso } from "@/lib/auditoria"
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
 *
 * **Es el único punto que audita `ver_perfil`** (lib/auditoria.ts), porque es
 * el único que corresponde a la acción "entró al perfil de X": se ejecuta al
 * ELEGIR o CAMBIAR de perfil, no en cada request. Auditarlo en
 * `obtenerPerfilActivo` -que corre en cada render de cada pantalla de
 * `app/(app)`- produciría una fila por request y volvería ilegible la lista
 * que el titular usa para controlar quién entra a sus datos. El registro
 * ocurre DESPUÉS de que el permiso fue concedido: nunca se audita como acceso
 * un intento rechazado.
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

  purgarCacheDeCliente()

  await registrarAcceso({ perfilId, accion: ACCION.ver_perfil })
}

/**
 * Tira a la basura TODO lo que el navegador tenga cacheado de la aplicación.
 *
 * ## Por qué hace falta, si el perfil activo ya se revalida en cada request
 *
 * Porque la revalidación solo corre cuando la pantalla LLEGA al servidor. El
 * Client Cache de Next.js 16 (el ex "Router Cache";
 * `node_modules/next/dist/docs/01-app/04-glossary.md`) guarda en memoria del
 * navegador el payload RSC de las rutas visitadas y prefetcheadas —layouts
 * incluidos, y el layout de `(con-nav)` es el que pinta "Viendo a Roberto
 * Gómez"—. Una pantalla servida desde ahí NUNCA vuelve a pasar por
 * `obtenerPerfilActivo`: se dibuja con los datos del perfil que estaba activo
 * cuando se guardó. Cambiar la cookie no borra por sí solo lo que ya está en
 * esa memoria.
 *
 * En el camino feliz, Next.js hoy hace lo correcto solo: ese mismo glosario
 * lista `cookies.set` entre las cosas que invalidan el Client Cache, y
 * `fijarPerfilActivo` justamente acaba de escribir una cookie. **El problema
 * es que esa garantía es implícita y no está escrita en ningún lado de este
 * código.** Depende de un detalle interno del framework, y NO cubre a los
 * Route Handlers de deep link (`app/(app)/(con-nav)/turnos/enlace/route.ts` y
 * sus tres hermanos), que también cambian el perfil activo pero desde fuera de
 * una Server Action.
 *
 * `revalidatePath("/", "layout")` es la forma DOCUMENTADA de purgar todo:
 * *"This will purge the Client Cache, and invalidate all cached data for
 * revalidation on the next page visit"*
 * (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`,
 * "Revalidating all data"). Se llama acá —en el único punto por el que pasa
 * todo cambio de perfil— y no en cada uno de los seis lugares que lo invocan:
 * el que agregue el séptimo camino no tiene que acordarse de nada.
 *
 * Cuesta una revalidación de más por cambio de perfil. Es exactamente lo que
 * se quiere: cambiar de perfil es, por definición, el momento en que todo lo
 * que había en pantalla dejó de corresponder.
 *
 * El try/catch es el mismo caso que documenta `limpiarPerfilActivo`:
 * `revalidatePath` solo es válida en una Server Action o un Route Handler, y
 * `limpiarPerfilActivo` puede terminar corriendo durante el render de un
 * Server Component. Ahí no hay nada que purgar —esa request no cambió ningún
 * perfil, solo detectó que el permiso se perdió y va a redirigir a
 * `/perfiles`— así que tragarse el error es la conducta correcta, no un
 * parche.
 */
function purgarCacheDeCliente(): void {
  try {
    revalidatePath("/", "layout")
  } catch {
    // Ver arriba: no-op esperado fuera de una Server Action / Route Handler.
  }
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

  // Salir de un perfil también tiene que dejar el navegador sin nada de ese
  // perfil en memoria: el logout es el caso más obvio, pero también cuenta la
  // revocación detectada a mitad de camino. Ver `purgarCacheDeCliente`.
  purgarCacheDeCliente()
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
 *
 * **Envuelta en `cache()` de React (Sprint 3, `app/(app)/(con-nav)/layout.tsx`).**
 * Desde que existe el shell con bottom nav, esta función se llama dos veces
 * por request: una vez en el layout (para armar el encabezado y decidir si
 * redirige a `/perfiles`) y otra vez en la página (que necesita el mismo
 * `perfil`/`permisos` para su propio contenido). `cache()` memoiza por
 * request de render de React Server Components: la segunda llamada devuelve
 * el mismo resultado sin repetir el viaje a la base, y las dos siempre ven
 * exactamente el mismo perfil -no hay ventana donde layout y página lean
 * datos de dos consultas distintas-. El scope de la memoización es el
 * request en curso: en el siguiente request (o la siguiente navegación
 * client-side, que en Next.js vuelve a ejecutar este segmento porque usa
 * `cookies()` y por lo tanto es dinámico) se vuelve a ejecutar entero,
 * revalidando el permiso contra la base como siempre.
 */
export const obtenerPerfilActivo = cache(async (): Promise<PerfilActivo | null> => {
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
})

/**
 * Cambia el perfil activo a partir de un parámetro de deep link (`?perfil=`),
 * el mecanismo que usa la notificación de un recordatorio de turno para
 * aterrizar en el perfil DEL TURNO en vez del perfil activo de quien toca el
 * aviso (Sprint 6.6, docs/recordatorios.md §9: María con su propio perfil
 * activo, notificación de un turno de Roberto, aterrizaba en una lista
 * vacía). Reutilizable por cualquier deep link futuro con el mismo problema
 * (Sprint 7 medicación, Sprint 9 alertas): quien la llama es siempre un
 * Route Handler fuera de `/api` -ver el comentario de
 * `app/(app)/(con-nav)/turnos/enlace/route.ts` sobre por qué tiene que ser
 * un Route Handler y no la página misma-, y esta función es la única pieza
 * que necesita reimplementar: el resto (leer el parámetro, redirigir a la
 * URL limpia) es el mismo molde chico.
 *
 * ## Por qué recibe `perfilActivoId` en vez de resolverlo por su cuenta
 *
 * Evita una llamada redundante a `obtenerPerfilActivo()` cuando quien llama
 * ya la hizo, y sobre todo evita ESCRIBIR cuando no hace falta:
 * `fijarPerfilActivo` audita `ver_perfil` (`lib/auditoria.ts`) en cada
 * llamada exitosa. Sin este chequeo, re-tocar la notificación de un turno
 * propio -perfil del turno == perfil ya activo- generaría una fila de
 * auditoría nueva por cada toque, en vez de la cero filas que corresponde a
 * "no cambió nada".
 *
 * ## La decisión de seguridad: nunca distinguir "no existe" de "sin permiso"
 *
 * Cualquier fallo de `fijarPerfilActivo` -uuid con forma inválida
 * (`ErrorPerfilInvalido`), perfil ajeno sin `view` (`ErrorPermisoDenegado`),
 * o incluso sesión ausente (`ErrorSesionRequerida`; no debería llegar a
 * pasar acá porque la ruta que invoca esto ya exige sesión en `proxy.ts`,
 * pero se cubre igual)- se trata EXACTAMENTE IGUAL: se ignora en silencio y
 * la función devuelve `false`. Quien llama SIEMPRE tiene que terminar en un
 * `redirect()` a la misma URL limpia que en el caso exitoso -nunca renderizar
 * con el `?perfil=` todavía puesto, nunca exponer un mensaje distinto-: la
 * alternativa -un 403, un `?error=`- convertiría este mecanismo en un
 * oráculo para adivinar ids de perfiles ajenos con solo mirar la respuesta,
 * el mismo principio que ya aplica `ErrorPermisoDenegado` en
 * `lib/auth/guardas.ts`.
 *
 * Un fallo TRANSITORIO (`ErrorVerificacionPermiso`: la base no respondió) se
 * propaga -igual que en `obtenerPerfilActivo`-: un hipo de red no es "sin
 * permiso" y no hay motivo para tratarlo en silencio como si lo fuera. OJO,
 * porque es una trampa real: `ErrorVerificacionPermiso` TAMBIÉN extiende
 * `ErrorGuarda` (`lib/auth/guardas.ts`), así que `esErrorDeGuarda()` -el
 * chequeo genérico que sí usan otras Server Actions, como
 * `app/(app)/(sin-nav)/perfiles/actions.ts`- lo atraparía igual que a los
 * otros tres. Por eso el `catch` de esta función no usa `esErrorDeGuarda()`:
 * lista a mano los tres tipos que sí corresponde silenciar, el mismo patrón
 * (y la misma lista) que ya usa `obtenerPerfilActivo` unas líneas más
 * arriba en este archivo.
 *
 * @param valor Valor crudo de leer `searchParams` (`string`, `string[]` si la
 *   key viene repetida en la URL -se toma el primero-, `null` o `undefined`).
 * @param perfilActivoId El perfil activo ANTES de procesar el parámetro, o
 *   `null` si no hay ninguno. Ausente, vacío o igual al activo → no-op.
 * @returns `true` si el perfil activo CAMBIÓ de verdad -quien llama debe
 *   `redirect()` a una URL fresca para que el resto del árbol (el layout con
 *   el encabezado, ya renderizado con la cookie VIEJA en este mismo
 *   request) vea la cookie nueva en el próximo request-. `false` si no hacía
 *   falta nada o si el cambio no se pudo hacer.
 */
export async function cambiarPerfilDesdeParametro(
  valor: string | string[] | null | undefined,
  perfilActivoId: string | null,
): Promise<boolean> {
  const perfilId = Array.isArray(valor) ? valor[0] : valor

  if (!perfilId || perfilId === perfilActivoId) {
    return false
  }

  try {
    await fijarPerfilActivo(perfilId)
    return true
  } catch (error) {
    // OJO: `esErrorDeGuarda` NO sirve acá -es un `instanceof ErrorGuarda`
    // genérico, y `ErrorVerificacionPermiso` (`lib/auth/guardas.ts`) TAMBIÉN
    // extiende `ErrorGuarda`-. Hay que listar a mano los tres casos que son
    // de verdad "esto no es válido", el mismo patrón (y la misma lista) que
    // ya usa `obtenerPerfilActivo` más arriba en este archivo.
    if (
      error instanceof ErrorPerfilInvalido ||
      error instanceof ErrorPermisoDenegado ||
      error instanceof ErrorSesionRequerida
    ) {
      return false
    }
    // `ErrorVerificacionPermiso` (la base no respondió) u otra cosa
    // inesperada: no es "sin permiso", se propaga.
    throw error
  }
}

// Re-exportado para que quien maneja el resultado de `fijarPerfilActivo` en
// una Server Action pueda distinguir "permiso denegado" sin importar directo
// de `lib/auth/guardas`.
export { esErrorDeGuarda }
