/**
 * `GET /api/sos/{perfilId}` — el payload JSON que el service worker guarda
 * para que la ficha de emergencia se pueda leer sin señal (Sprint 8, tarea
 * 8.4). **Contrato de la respuesta: `docs/modelo-sos.md` §7.** Estrategia de
 * caché: `docs/offline.md` §3 (red-primero con caída al caché).
 *
 * ## `perfilId` en la ruta, no "el perfil activo"
 *
 * Es la regla dura 4 del contrato y la única forma de que el caché sirva: una
 * hija que administra dos perfiles necesita las dos fichas guardadas por
 * separado, y una clave de caché que dijera "la ficha del perfil activo" le
 * mostraría la de su papá cuando quería la de su mamá. La URL lleva el id, así
 * que la clave de caché es distinta para cada perfil sin que el worker tenga
 * que saber nada de cookies.
 *
 * Que el id venga de la URL **no lo convierte en una credencial**:
 * `requerirPermiso(perfilId, "view")` ejecuta la misma función
 * `puede_ver_perfil` que usa la política RLS, y la lectura posterior va con el
 * cliente del USUARIO, así que RLS vuelve a filtrar. Pedir el id de un perfil
 * ajeno devuelve 403 con el mismo mensaje que un perfil inexistente
 * (`ErrorPermisoDenegado` no distingue los dos casos, `docs/modelo-permisos.md`
 * principio 3).
 *
 * ## Solo lectura
 *
 * No hay `POST`: editar la ficha sin conexión no está en el alcance del
 * sprint, y una edición offline de datos vitales que se sincroniza tarde y
 * pisa una más nueva es peor que no poder editar (regla dura 5).
 *
 * ## Ninguna signed URL adentro
 *
 * Las fotos de la credencial viajan como URL **estable**
 * (`/api/credenciales/{id}/imagen`), nunca firmada: este JSON tiene que seguir
 * sirviendo dentro de una semana y una signed URL vive 300 segundos (regla
 * dura 1). Ver `lib/sos/payload.ts#urlImagenCredencial`.
 */

import { NextResponse } from "next/server"

import { type ErrorGuarda, esErrorDeGuarda, requerirPermiso } from "@/lib/auth/guardas"
import { type CoberturaPrincipalCruda, construirPayloadSos } from "@/lib/sos/payload"

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MENSAJE_PERFIL_INVALIDO = "Ese perfil no es válido."
const MENSAJE_NO_ENCONTRADO =
  "No encontramos ese perfil. Es posible que no exista o que no tengas acceso."
const MENSAJE_INESPERADO =
  "Ocurrió un problema y no pudimos preparar la ficha. Probá de nuevo en unos minutos."

/**
 * `private`: la respuesta es de UNA persona, ningún proxy compartido puede
 * guardarla. `no-cache`: el HTTP cache del navegador tiene que revalidar
 * siempre, porque el único caché que debe servir esto sin preguntar es el del
 * service worker, que es explícito, versionado y se purga al cerrar sesión
 * (`docs/offline.md` §6). Dos cachés opinando sobre el mismo recurso es la
 * receta para que una ficha vieja aparezca sin que nadie sepa de dónde salió.
 */
const CACHE_CONTROL = "private, no-cache"

function json(cuerpo: unknown, status: number): Response {
  return NextResponse.json(cuerpo, {
    status,
    headers: { "Cache-Control": CACHE_CONTROL },
  })
}

/** Mismo mapeo que el resto de los Route Handlers del proyecto. */
function estadoDeErrorGuarda(error: ErrorGuarda): number {
  switch (error.codigo) {
    case "sesion_requerida":
      return 401
    case "perfil_invalido":
      return 400
    case "permiso_denegado":
      return 403
    case "fallo_de_verificacion":
      return 503
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ perfilId: string }> },
): Promise<Response> {
  const { perfilId } = await params

  if (!PATRON_UUID.test(perfilId)) {
    return json({ error: MENSAJE_PERFIL_INVALIDO }, 400)
  }

  try {
    // Guarda de permiso: la MISMA función que el predicado de la política RLS.
    const { supabase } = await requerirPermiso(perfilId, "view", {
      siNoHaySesion: "lanzar",
    })

    // Las dos consultas del contrato de lectura (§5), acá en paralelo: no
    // dependen una de la otra y esta ruta se pide al abrir la app.
    const [{ data: perfil, error: errorPerfil }, { data: cobertura, error: errorCobertura }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", perfilId).maybeSingle(),
        supabase
          .from("insurance_cards")
          .select("id, provider, plan, member_number, front_storage_path, back_storage_path")
          .eq("profile_id", perfilId)
          .eq("is_primary", true)
          .maybeSingle(),
      ])

    if (errorPerfil) {
      console.error("[sos] Fallo al leer el perfil:", errorPerfil.message)
      return json({ error: MENSAJE_INESPERADO }, 500)
    }
    if (!perfil) {
      // `requerirPermiso` dijo que sí pero la fila no aparece: se contesta lo
      // mismo que ante un perfil ajeno, nunca un detalle que sirva de oráculo.
      return json({ error: MENSAJE_NO_ENCONTRADO }, 404)
    }

    // Que falle la cobertura NO invalida la ficha: es el único dato que vive
    // fuera de `profiles` (§4.3) y una ficha sin cobertura sigue teniendo el
    // grupo sanguíneo, las alergias y el contacto de emergencia, que es lo que
    // importa en una guardia.
    if (errorCobertura) {
      console.error("[sos] Fallo al leer la cobertura principal:", errorCobertura.message)
    }

    const payload = construirPayloadSos(
      perfil,
      errorCobertura ? null : ((cobertura as CoberturaPrincipalCruda | null) ?? null),
      new Date(),
    )

    return json(payload, 200)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return json({ error: error.message }, estadoDeErrorGuarda(error))
    }
    console.error("[sos] Fallo inesperado al armar el payload:", error)
    return json({ error: MENSAJE_INESPERADO }, 500)
  }
}
