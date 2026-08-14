/**
 * `GET /api/credenciales/{id}/url?lado=front|back` — emite una signed URL de
 * vida corta para ver la foto de UNA cara de una credencial de cobertura, y
 * audita la apertura (Sprint 8, tarea 8.1). Calco de
 * `app/api/documentos/[id]/url/route.ts` -mismo orden de guardas, mismo
 * criterio de nunca cachear la respuesta-, adaptado a que `insurance_cards`
 * es una fila con DOS paths (`front_storage_path`/`back_storage_path`) en vez
 * de uno solo, así que acá hace falta el parámetro `lado` para saber cuál.
 *
 * ## Guardas, en el mismo orden que documentos
 *
 * 1. **Sesión.**
 * 2. **Leer la fila de `insurance_cards` con el cliente del USUARIO.** RLS
 *    decide (`insurance_cards` SELECT: dueño o `can_view`/`can_upload`/`can_manage`,
 *    docs/modelo-permisos.md §6, nota ⑮). Si RLS la filtra, 404 genérico —
 *    nunca se distingue "no existe" de "no tenés permiso".
 * 3. **No se exige `can_upload` ni `can_manage`**: ver una credencial es
 *    lectura pura, igual que ver un documento.
 * 4. **Recién ahora, `crearSignedUrl` con `service_role`.**
 * 5. **Auditar DESPUÉS de firmar con éxito** -salvo el caso de miniatura, ver
 *    abajo-.
 *
 * ## `?miniatura=1`: la MISMA signed URL, pero sin auditar
 *
 * La billetera (`/coberturas`) muestra una miniatura de cada cara en la
 * tarjeta (`components/coberturas/miniatura-credencial.tsx`), y esa
 * miniatura necesita su propia signed URL -el objeto es privado, no hay
 * otra forma de mostrar el `<img>`-. Pero nota ⑮ de `docs/modelo-permisos.md`
 * dice "ver una credencial se audita SIEMPRE", y el propio §6.3 aclara el
 * criterio de granularidad: los LISTADOS no generan una fila por render
 * ("el listado de turnos o de métricas no genera una fila cada uno"). Una
 * miniatura en una tarjeta de la billetera es exactamente eso -parte del
 * listado, no "alguien abrió la credencial a mirarla"-, así que auditarla
 * generaría una fila de `ver_credencial` por cada card en cada visita a
 * `/coberturas`, e inundaría la lista de accesos que el titular usa para
 * controlar quién mira sus datos. La apertura real -el visor a pantalla
 * completa, `components/coberturas/visor-credencial.tsx`- pide la MISMA URL
 * sin este parámetro y esa sí audita. Mismo patrón que ya usa este archivo
 * hermano con `?descargar=1` para variar el literal auditado con un query
 * param sobre el mismo endpoint.
 *
 * También se usa un TTL más corto para la miniatura (`TTL_DEFAULT_SEGUNDOS`,
 * 60s: alcanza de sobra para pintar un `<img>` de 64px) en vez del máximo
 * (`TTL_MAXIMO_SEGUNDOS`, 300s) que sí necesita el visor a pantalla completa,
 * donde la persona puede quedarse mirando la foto un rato.
 */

import { NextResponse } from "next/server"

import { ACCION, registrarAcceso } from "@/lib/auditoria"
import { type ErrorGuarda, esErrorDeGuarda, requerirSesion } from "@/lib/auth/guardas"
import {
  BUCKETS,
  TTL_DEFAULT_SEGUNDOS,
  TTL_MAXIMO_SEGUNDOS,
  crearSignedUrl,
} from "@/lib/storage-admin"

export interface RespuestaUrlOk {
  url: string
  /** Segundos de vida de la URL, para que el visor programe el aviso de expiración. */
  expiraEn: number
}

export interface RespuestaUrlError {
  error: string
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MENSAJE_ID_INVALIDO = "Ese enlace de credencial no es válido."
const MENSAJE_LADO_INVALIDO = 'Indicá qué lado de la credencial querés ver ("front" o "back").'
const MENSAJE_COBERTURA_NO_ENCONTRADA =
  "No encontramos esa cobertura. Es posible que no exista o que no tengas acceso."
const MENSAJE_LADO_SIN_FOTO = "Todavía no hay una foto cargada de ese lado de la credencial."
const MENSAJE_ARCHIVO_NO_DISPONIBLE =
  "No pudimos abrir la foto guardada. Puede que ya no esté disponible."
const MENSAJE_INESPERADO =
  "Ocurrió un problema y no pudimos abrir la credencial. Probá de nuevo en unos minutos."

function json(body: RespuestaUrlOk | RespuestaUrlError, status: number): Response {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

/** Mismo mapeo que `api/documentos/[id]/url/route.ts`. */
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
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params

  if (!PATRON_UUID.test(id)) {
    return json({ error: MENSAJE_ID_INVALIDO }, 400)
  }

  const { searchParams } = new URL(request.url)
  const lado = searchParams.get("lado")

  if (lado !== "front" && lado !== "back") {
    return json({ error: MENSAJE_LADO_INVALIDO }, 400)
  }

  // Ver el bloque "`?miniatura=1`" del encabezado.
  const esMiniatura = searchParams.get("miniatura") === "1"
  const ttl = esMiniatura ? TTL_DEFAULT_SEGUNDOS : TTL_MAXIMO_SEGUNDOS

  try {
    const { supabase } = await requerirSesion({ siNoHaySesion: "lanzar" })

    // Paso 2: la fila con el cliente del USUARIO. RLS decide.
    const { data: cobertura, error: errorCobertura } = await supabase
      .from("insurance_cards")
      .select("id, profile_id, front_storage_path, back_storage_path")
      .eq("id", id)
      .maybeSingle()

    if (errorCobertura) {
      console.error("[credenciales] Fallo al leer la fila de insurance_cards:", errorCobertura.message)
      return json({ error: MENSAJE_INESPERADO }, 500)
    }
    if (!cobertura) {
      return json({ error: MENSAJE_COBERTURA_NO_ENCONTRADA }, 404)
    }

    const path = lado === "front" ? cobertura.front_storage_path : cobertura.back_storage_path
    if (!path) {
      return json({ error: MENSAJE_LADO_SIN_FOTO }, 404)
    }

    // Paso 4: recién acá, con `service_role`. Ver el encabezado del archivo.
    let url: string
    try {
      url = await crearSignedUrl(BUCKETS.credenciales, path, ttl)
    } catch (errorFirma) {
      console.error(`[credenciales] No se pudo firmar el objeto de ${id} (${path}):`, errorFirma)
      return json({ error: MENSAJE_ARCHIVO_NO_DISPONIBLE }, 404)
    }

    // Paso 5: auditar DESPUÉS de firmar con éxito, y solo si NO es una
    // miniatura de listado (ver el bloque del encabezado).
    if (!esMiniatura) {
      await registrarAcceso({
        perfilId: cobertura.profile_id,
        accion: ACCION.ver_credencial,
        recursoTipo: "insurance_card",
        recursoId: cobertura.id,
      })
    }

    return json({ url, expiraEn: ttl }, 200)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return json({ error: error.message }, estadoDeErrorGuarda(error))
    }
    console.error("[credenciales] Fallo inesperado al generar la signed URL:", error)
    return json({ error: MENSAJE_INESPERADO }, 500)
  }
}
