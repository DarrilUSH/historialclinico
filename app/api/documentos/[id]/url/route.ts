/**
 * `GET /api/documentos/{id}/url` — emite una signed URL de vida corta para
 * ver (o descargar) un documento médico, y audita la apertura (Sprint 5,
 * tarea 5.3).
 *
 * Lo consume `components/estudios/visor-documento.tsx` (Client Component:
 * necesita `fetch` para poder reintentar cuando la URL anterior expiró sin
 * recargar toda la página) y también el propio botón "Descargar" del mismo
 * componente, con `?descargar=1`.
 *
 * ## Guardas, en el ORDEN que exige `lib/storage-admin.ts` (encabezado, y
 * `docs/seguridad-rls.md` §7.5)
 *
 * 1. **Sesión** (`requerirSesion({ siNoHaySesion: "lanzar" })`) — sin cookie
 *    válida, 401.
 * 2. **Leer la fila de `documents` con el cliente del USUARIO.** RLS decide
 *    si la persona puede verla (`documents_select_puede_ver`, que exige
 *    `puede_ver_perfil(profile_id)`). Si RLS la filtra, este handler no puede
 *    distinguir "no existe" de "no tenés permiso" -principio 3 de
 *    `docs/modelo-permisos.md`- y devuelve el mismo 404 genérico en los dos
 *    casos.
 * 3. **NO se exige `can_upload` ni `can_manage`.** Ver un documento es lectura
 *    pura: alcanza con el `can_view` que la política de `SELECT` de
 *    `documents` ya validó en el paso 2. A diferencia de
 *    `POST /api/documentos/extraer` (que sí exige `upload` porque dispara una
 *    llamada real y paga cuota de Gemini), acá no hay ningún verbo adicional
 *    que verificar.
 * 4. **Recién ahora, `crearSignedUrl` con `lib/storage-admin.ts`
 *    (`service_role`).** El permiso ya está verificado por el paso 2 -es
 *    exactamente la garantía que documenta el encabezado de ese módulo-, así
 *    que saltear RLS acá no es un agujero: es la única forma de generar una
 *    URL firmada, porque el usuario final nunca tiene ni puede tener
 *    `service_role`.
 * 5. **Auditar DESPUÉS de firmar, nunca antes.** Si `crearSignedUrl` lanza
 *    (el objeto no existe en el bucket -el caso real de los documentos del
 *    seed, que tienen `storage_path` ficticios sin objeto subido-), no hay
 *    nada que auditar como "visto": la persona no llegó a ver nada. Se
 *    devuelve un error claro y `access_logs` queda sin una fila que mentiría
 *    sobre lo que pasó.
 *
 * ## `?descargar=1`: mismo endpoint, literal de auditoría distinto
 *
 * El roadmap solo agrega `descargar_archivo` al enum (ya existe, ver
 * `lib/auditoria.ts`) y pide "un segundo endpoint o query param auditado".
 * Se eligió el query param: es la misma fila de `documents`, el mismo
 * permiso, el mismo bucket -solo cambia qué literal se audita y si la signed
 * URL lleva `download=`, así que separarlo en dos archivos hubiera duplicado
 * las cuatro guardas de arriba sin ganar nada.
 *
 * `download=` es un parámetro de la URL YA FIRMADA
 * (`@supabase/storage-js`, `StorageFileApi#createSignedUrl`): se agrega
 * DESPUÉS de que Storage firma el `path` y el `expiresIn`, así que no forma
 * parte del JWT de la URL y se puede anexar acá sin volver a firmar nada.
 * Con él, el navegador recibe `Content-Disposition: attachment` y el archivo
 * se descarga con un nombre legible en vez de abrirse inline con un uuid
 * como nombre.
 *
 * ## Por qué la respuesta nunca se cachea
 *
 * Cada signed URL es de un solo uso conceptual -vive 300s y lleva un token
 * distinto cada vez-: una respuesta cacheada por el navegador o por un proxy
 * intermedio serviría una URL vieja que ya expiró, o peor, la compartiría
 * entre pestañas/usuarios detrás del mismo caché. `Cache-Control: no-store`
 * en cada respuesta (éxito o error) corta esa posibilidad de raíz.
 */

import { NextResponse } from "next/server"

import { ACCION, registrarAcceso } from "@/lib/auditoria"
import { type ErrorGuarda, esErrorDeGuarda, requerirSesion } from "@/lib/auth/guardas"
import { BUCKETS, TTL_MAXIMO_SEGUNDOS, crearSignedUrl } from "@/lib/storage-admin"

export interface RespuestaUrlOk {
  url: string
  /** Segundos de vida de la URL, para que el visor programe el aviso de expiración. */
  expiraEn: number
}

export interface RespuestaUrlError {
  error: string
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MENSAJE_ID_INVALIDO = "Ese enlace de documento no es válido."
const MENSAJE_DOCUMENTO_NO_ENCONTRADO =
  "No encontramos ese documento. Es posible que no exista o que no tengas acceso."
const MENSAJE_ARCHIVO_NO_DISPONIBLE =
  "No pudimos abrir el archivo guardado. Puede que ya no esté disponible."
const MENSAJE_INESPERADO =
  "Ocurrió un problema y no pudimos abrir el documento. Probá de nuevo en unos minutos."

function json(body: RespuestaUrlOk | RespuestaUrlError, status: number): Response {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

/** Mapea el código de `ErrorGuarda` al HTTP status correspondiente, mismo criterio que `api/documentos/extraer/route.ts`. */
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

/**
 * Extrae la extensión del `storage_path` (`{perfil}/{año}/{uuid}.pdf` →
 * `"pdf"`) para armar un nombre de descarga legible. `"pdf"` de reserva: los
 * cuatro MIME que acepta el bucket siempre dejan extensión (ver
 * `EXTENSION_POR_MIME` en `lib/documentos/ingesta.ts`), así que este default
 * solo cubriría un path que no siguiera esa convención.
 */
function extensionDePath(path: string): string {
  const coincidencia = /\.([a-z0-9]+)$/i.exec(path)
  return coincidencia ? coincidencia[1].toLowerCase() : "pdf"
}

/**
 * Nombre de archivo para `Content-Disposition`: el título del documento,
 * saneado de caracteres que rompen un nombre de archivo en Windows/Android
 * (`\ / : * ? " < > |`), recortado a un largo razonable, con la extensión
 * real del objeto. Nunca vacío: si el título saneado queda en blanco (un
 * título compuesto solo por esos caracteres, caso de borde), cae a
 * "documento".
 */
function nombreDeDescarga(titulo: string, storagePath: string): string {
  const extension = extensionDePath(storagePath)
  const base = titulo
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 100)
  return `${base.length > 0 ? base : "documento"}.${extension}`
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
  const esDescarga = searchParams.get("descargar") === "1"

  try {
    const { supabase } = await requerirSesion({ siNoHaySesion: "lanzar" })

    // Paso 2: la fila con el cliente del USUARIO. RLS decide.
    const { data: documento, error: errorDocumento } = await supabase
      .from("documents")
      .select("id, profile_id, storage_path, title")
      .eq("id", id)
      .maybeSingle()

    if (errorDocumento) {
      console.error("[visor] Fallo al leer la fila de documents:", errorDocumento.message)
      return json({ error: MENSAJE_INESPERADO }, 500)
    }
    if (!documento) {
      return json({ error: MENSAJE_DOCUMENTO_NO_ENCONTRADO }, 404)
    }

    // Paso 4: recién acá, con `service_role`. Ver el encabezado del archivo.
    let url: string
    try {
      url = await crearSignedUrl(BUCKETS.documentos, documento.storage_path, TTL_MAXIMO_SEGUNDOS)
    } catch (errorFirma) {
      // Típicamente "Object not found": el `storage_path` no tiene objeto
      // real en el bucket (los cinco documentos del seed, por ejemplo). No
      // es un error de programación, es un dato del mundo real -no se manda
      // el mensaje crudo de Storage al cliente (puede incluir el bucket y el
      // path), se traduce a algo mostrable en el visor.
      console.error(
        `[visor] No se pudo firmar el objeto de ${id} (${documento.storage_path}):`,
        errorFirma,
      )
      return json({ error: MENSAJE_ARCHIVO_NO_DISPONIBLE }, 404)
    }

    if (esDescarga) {
      // `download=` se agrega a la URL YA FIRMADA -no forma parte del JWT,
      // ver el encabezado del archivo-, así que alcanza con anexarlo acá.
      const nombre = nombreDeDescarga(documento.title, documento.storage_path)
      url += `&download=${encodeURIComponent(nombre)}`
    }

    // Paso 5: auditar DESPUÉS de firmar con éxito. `perfilId` es el dueño de
    // los datos (`documento.profile_id`), no el perfil activo de quien
    // mira -pueden diferir, por ejemplo si en el futuro este endpoint se
    // llama para un documento de otro perfil autorizado-.
    await registrarAcceso({
      perfilId: documento.profile_id,
      accion: esDescarga ? ACCION.descargar_archivo : ACCION.ver_documento,
      recursoTipo: "documento",
      recursoId: documento.id,
    })

    return json({ url, expiraEn: TTL_MAXIMO_SEGUNDOS }, 200)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return json({ error: error.message }, estadoDeErrorGuarda(error))
    }
    console.error("[visor] Fallo inesperado al generar la signed URL:", error)
    return json({ error: MENSAJE_INESPERADO }, 500)
  }
}
