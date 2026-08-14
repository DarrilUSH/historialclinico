/**
 * `GET /api/credenciales/{id}/imagen?lado=front|back` — devuelve **la foto**
 * de una cara de la credencial de cobertura por una URL **estable**, para que
 * el service worker pueda guardarla y mostrarla sin señal (Sprint 8, tarea
 * 8.4). Estrategia de caché: `docs/offline.md` §4.
 *
 * ## Por qué existe, si ya hay `/api/credenciales/{id}/url`
 *
 * Ese endpoint devuelve una **signed URL** de Supabase Storage, y una signed
 * URL es incacheable por construcción:
 *
 * - **Cambia en cada emisión.** La firma incluye el momento de creación, así
 *   que abrir la misma credencial dos veces produce dos URL distintas. Como
 *   clave de caché eso significa una entrada nueva por apertura, y ninguna que
 *   se pueda volver a encontrar.
 * - **Vive 300 segundos.** Una entrada de caché que nace vencida no sirve para
 *   modo avión: la gracia es abrir la credencial una semana después.
 * - **No lleva sesión.** Es un enlace que funciona para cualquiera que lo
 *   tenga. Guardarlo en el disco del teléfono sería peor que guardar la foto.
 *
 * Esta ruta, en cambio, es siempre la misma para la misma cara de la misma
 * credencial, y **verifica sesión y permiso en cada request que llega al
 * servidor**. Cuando hay red, el service worker la revalida en segundo plano;
 * si el permiso familiar se revocó, el servidor contesta 404 y el worker borra
 * la copia del teléfono (`public/sw.js#decidirDestinoDeCache`).
 *
 * **El visor online sigue usando signed URLs** (`components/coberturas/visor-credencial.tsx`):
 * ahí conviene que los bytes viajen directo desde Storage al navegador sin
 * pasar por el servidor de Node, y el TTL corto es una ventaja. Los dos
 * caminos conviven porque resuelven problemas distintos.
 *
 * ## Guardas: el mismo orden que el endpoint hermano
 *
 * 1. **Sesión.**
 * 2. **Leer la fila de `insurance_cards` con el cliente del USUARIO.** RLS
 *    decide. Si la filtra, 404 genérico: nunca se distingue "no existe" de "no
 *    tenés permiso".
 * 3. **Recién ahora, `service_role`**, y solo para leer el objeto cuyo path
 *    salió de una fila que RLS ya dejó pasar.
 *
 * ## Esta ruta NO audita `ver_credencial`, y es una decisión, no un olvido
 *
 * `docs/modelo-permisos.md` §6.3 distingue "alguien abrió la credencial a
 * mirarla" de "una pantalla renderizó una imagen". Esta ruta es lo segundo: la
 * pide el `<img>` de la ficha SOS en cada render, igual que `?miniatura=1` en
 * la billetera, y auditarla llenaría de filas automáticas la lista que el
 * titular usa para controlar quién mira sus datos.
 *
 * Hay además una razón estructural más fuerte: **offline la request no llega
 * al servidor**. La foto sale del caché del dispositivo sin que nadie se
 * entere, así que una auditoría por esta vía sería sistemáticamente
 * incompleta — y un registro incompleto que *parece* completo es peor que uno
 * que declara no cubrir ese camino. La apertura deliberada
 * (`visor-credencial.tsx` → `/api/credenciales/{id}/url`) sigue auditando
 * `ver_credencial` exactamente igual que antes, y ese es el evento que el
 * registro promete.
 */

import { NextResponse } from "next/server"

import { type ErrorGuarda, esErrorDeGuarda, requerirSesion } from "@/lib/auth/guardas"
import { BUCKETS, descargarObjeto } from "@/lib/storage-admin"

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MENSAJE_ID_INVALIDO = "Ese enlace de credencial no es válido."
const MENSAJE_LADO_INVALIDO = 'Indicá qué lado de la credencial querés ver ("front" o "back").'
const MENSAJE_NO_ENCONTRADA =
  "No encontramos esa cobertura. Es posible que no exista o que no tengas acceso."
const MENSAJE_SIN_FOTO = "Todavía no hay una foto cargada de ese lado de la credencial."
const MENSAJE_ARCHIVO_NO_DISPONIBLE =
  "No pudimos abrir la foto guardada. Puede que ya no esté disponible."
const MENSAJE_INESPERADO =
  "Ocurrió un problema y no pudimos abrir la credencial. Probá de nuevo en unos minutos."

/**
 * `private`: la foto es de UNA persona; ningún proxy compartido puede
 * guardarla. `no-cache`: el HTTP cache del navegador revalida siempre, y el
 * único caché que la sirve sin preguntar es el del service worker —explícito,
 * versionado y purgado al cerrar sesión (`docs/offline.md` §6)—. Que haya un
 * solo caché con autoridad sobre este recurso es lo que permite razonar sobre
 * cuánto puede sobrevivir una foto a la revocación de un permiso.
 */
const CACHE_CONTROL = "private, no-cache"

function jsonError(mensaje: string, status: number): Response {
  return NextResponse.json(
    { error: mensaje },
    { status, headers: { "Cache-Control": "no-store" } },
  )
}

/** Mismo mapeo que `app/api/credenciales/[id]/url/route.ts`. */
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
    return jsonError(MENSAJE_ID_INVALIDO, 400)
  }

  const lado = new URL(request.url).searchParams.get("lado")
  if (lado !== "front" && lado !== "back") {
    return jsonError(MENSAJE_LADO_INVALIDO, 400)
  }

  try {
    const { supabase } = await requerirSesion({ siNoHaySesion: "lanzar" })

    // Paso 2: la fila con el cliente del USUARIO. RLS decide.
    const { data: cobertura, error: errorCobertura } = await supabase
      .from("insurance_cards")
      .select("id, front_storage_path, back_storage_path")
      .eq("id", id)
      .maybeSingle()

    if (errorCobertura) {
      console.error(
        "[credenciales] Fallo al leer la fila de insurance_cards:",
        errorCobertura.message,
      )
      return jsonError(MENSAJE_INESPERADO, 500)
    }
    if (!cobertura) {
      return jsonError(MENSAJE_NO_ENCONTRADA, 404)
    }

    const path = lado === "front" ? cobertura.front_storage_path : cobertura.back_storage_path
    if (!path) {
      return jsonError(MENSAJE_SIN_FOTO, 404)
    }

    // Paso 3: recién acá, con `service_role`, sobre un path que salió de una
    // fila que RLS ya dejó pasar.
    let objeto
    try {
      objeto = await descargarObjeto(BUCKETS.credenciales, path)
    } catch (errorDescarga) {
      console.error(`[credenciales] No se pudo leer el objeto de ${id} (${path}):`, errorDescarga)
      return jsonError(MENSAJE_ARCHIVO_NO_DISPONIBLE, 404)
    }

    return new Response(objeto.datos, {
      status: 200,
      headers: {
        "Content-Type": objeto.tipo,
        "Cache-Control": CACHE_CONTROL,
        // `inline`: abrirla en una pestaña tiene que MOSTRAR la foto, no
        // descargarla. En una ventanilla de guardia, un archivo en la carpeta
        // de descargas no le sirve a nadie.
        "Content-Disposition": `inline; filename="credencial-${lado}"`,
        // El objeto es privado y ya se filtró por permiso: que ningún
        // intermediario ni el navegador intente adivinar otro tipo.
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return jsonError(error.message, estadoDeErrorGuarda(error))
    }
    console.error("[credenciales] Fallo inesperado al servir la imagen:", error)
    return jsonError(MENSAJE_INESPERADO, 500)
  }
}
