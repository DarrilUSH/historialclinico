/**
 * `POST /api/documentos/extraer` — dispara la lectura automática de un
 * documento médico ya subido con Gemini y guarda la extracción CRUDA.
 *
 * Es un Route Handler (no una Server Action) a propósito: la pantalla
 * `/estudios/nuevo/procesando` necesita poder invocarlo desde un Client
 * Component vía `fetch` y mostrar un estado de carga mientras la llamada a
 * Gemini está en curso (hasta 30s + 1 reintento, ver `lib/gemini/client.ts`),
 * algo que una Server Action invocada como `<form action>` no ofrece igual de
 * simple.
 *
 * ## Guardas, en orden (mismo criterio que `subirDocumento`, `estudios/actions.ts`)
 *
 * 1. **Sesión** (`requerirSesion({ siNoHaySesion: "lanzar" })`) — sin cookie
 *    válida, 401.
 * 2. **Cargar la fila de `documents` con el cliente del USUARIO.** RLS decide
 *    si la persona puede verla (`documents_select_puede_ver`,
 *    `puede_ver_perfil`). Si RLS la filtra, este handler NO puede distinguir
 *    "no existe" de "no tenés permiso" -principio 3 de
 *    `docs/modelo-permisos.md`- y contesta el mismo 404 genérico en los dos
 *    casos.
 * 3. **`requerirPermiso(profile_id_del_documento, "upload")`.** Extraer es
 *    parte del flujo de carga, no de la simple visualización: dispara una
 *    llamada real a la API de Gemini (consumo de cuota), así que un
 *    `can_view` -que puede ABRIR el documento pero no subió nada- no puede
 *    gatillarla. Se reutiliza la sesión ya resuelta en el paso 1
 *    (`opciones.sesion`) para no pagar un `auth.getUser()` de más.
 *
 * ## Por qué la descarga del archivo va con el cliente del USUARIO
 *
 * `documento.storage_path` ya pasó el filtro de RLS de la tabla en el paso 2,
 * pero el ARCHIVO en Storage es un recurso aparte con su propia política
 * (`objetos_select_puede_ver_perfil`, `supabase/migrations/20260812230000_storage.sql`).
 * Descargar con `supabase.storage.download()` del cliente del usuario hace que
 * esa política vuelva a decidir -exactamente el mismo criterio que
 * `lib/storage-admin.ts` documenta en su encabezado ("quien llama es
 * responsable de haber verificado el permiso antes"): acá NO hace falta el
 * cliente admin porque el permiso ya se verificó dos veces (fila + upload) y
 * el path sale de la propia fila, nunca del cliente.
 *
 * ## Qué persiste este handler y qué NO
 *
 * Guarda `ai_summary` y `raw_ocr_text` -la extracción CRUDA, tal como la
 * devolvió Gemini-. La CONFIRMACIÓN del usuario (título/fecha/categoría
 * finales editados a mano + `lab_metrics`) es de las tareas 4.5/4.6 del
 * roadmap y este handler no la implementa: no toca `title`, `category`,
 * `document_date`, `specialty`, `institution` ni `doctor_name`, y no inserta
 * en `lab_metrics`.
 *
 * **El `UPDATE` de persistencia va con el cliente del USUARIO, nunca con
 * `service_role`, y puede no aplicarse.** La política
 * `documents_update_administrador` (`20260812220000_rls.sql`) exige
 * `puede_administrar_perfil` (`can_manage`) para CUALQUIER `UPDATE` sobre
 * `documents` -deliberado, ver el comentario de esa política ("Si la
 * extracción de IA quedó mal, NO puede corregirlo después: eso es una edición
 * y requiere `can_manage`") y el caso "3. can_upload" de
 * `scripts/test-rls.sql` ("no corrige ni su propia carga")-. Un actor con
 * `can_upload` pero SIN `can_manage` puede disparar la extracción -Gemini
 * cuesta cuota igual- y esta respuesta le devuelve el JSON completo para que
 * la pantalla lo muestre, pero el `UPDATE` no afecta ninguna fila: RLS lo deja
 * pasar en silencio (0 filas, sin error) porque así es como Postgres responde
 * a un `USING` que no matchea, no como un permiso rechazado explícito. Este
 * handler no lo trata como una falla -la extracción en sí funcionó-, solo lo
 * deja anotado en el log del servidor (prefijo `[extraccion]`, mismo criterio
 * que `[auditoria]` e `[ingesta]`) para que no sea un silencio invisible. Con
 * los datos de prueba de `supabase/seed.sql`, María administra a Roberto
 * (`can_manage` incluido), así que el `UPDATE` sí se aplica en el flujo real
 * de verificación de esta tarea.
 *
 * ## Errores de Gemini: mensajes en español, nunca un 500 sin cuerpo
 *
 * `extraerJson` (`lib/gemini/client.ts`) ya resuelve el timeout y el único
 * reintento; acá solo queda traducir sus excepciones tipadas a un mensaje
 * mostrable. El caso de cuota (HTTP 429) tiene mensaje propio por la regla de
 * costo cero del proyecto: NUNCA se le sugiere a la persona pagar por más
 * cuota, se la manda a cargar los datos a mano -la pantalla de edición manual
 * es la tarea 4.5, pero el mensaje ya la anticipa-.
 */

import { NextResponse } from "next/server"

import {
  GeminiApiError,
  GeminiConfigError,
  GeminiParseError,
  GeminiTimeoutError,
  extraerJson,
} from "@/lib/gemini/client"
import { PROMPT_DOCUMENTO_MEDICO } from "@/lib/gemini/prompt-documento"
import { SCHEMA_DOCUMENTO_MEDICO, type DocumentoMedicoExtraido } from "@/lib/gemini/schemas"
import { type ErrorGuarda, esErrorDeGuarda, requerirPermiso, requerirSesion } from "@/lib/auth/guardas"
import { BUCKETS } from "@/lib/storage-admin"

export interface RespuestaExtraccionOk {
  extraccion: DocumentoMedicoExtraido
}

export interface RespuestaExtraccionError {
  error: string
}

const PATRON_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** MIME reales que puede haber subido `lib/documentos/ingesta.ts` — los únicos que `extraerJson` sabe interpretar como `inlineData`. */
const MIME_SOPORTADOS = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"])

/** Tope del extracto opcional `texto_completo` al persistir, espejo del límite pedido en el prompt (defensivo: el modelo no siempre lo respeta). */
const MAX_TEXTO_COMPLETO = 500

const MENSAJE_SIN_DOCUMENTO_ID =
  "Falta indicar qué documento leer."
const MENSAJE_DOCUMENTO_NO_ENCONTRADO =
  "No encontramos ese documento. Es posible que no exista o que no tengas acceso."
const MENSAJE_ARCHIVO_NO_DISPONIBLE =
  "No pudimos abrir el archivo guardado. Probá de nuevo en unos minutos."
const MENSAJE_TIPO_NO_SOPORTADO =
  "Este documento no tiene un formato que podamos leer automáticamente. Podés cargar los datos a mano."
const MENSAJE_CUOTA =
  "El servicio de lectura automática alcanzó su límite por hoy; podés cargar los datos a mano."
const MENSAJE_TIMEOUT =
  "La lectura automática está tardando más de lo esperado. Probá de nuevo en un momento, o cargá los datos a mano."
const MENSAJE_RESPUESTA_INVALIDA =
  "No pudimos interpretar lo que devolvió el lector automático. Podés cargar los datos a mano."
const MENSAJE_SERVICIO_NO_DISPONIBLE =
  "El servicio de lectura automática no está disponible en este momento. Podés cargar los datos a mano."
const MENSAJE_LECTURA_FALLIDA =
  "No pudimos leer el documento automáticamente. Podés cargar los datos a mano."
const MENSAJE_INESPERADO =
  "Ocurrió un problema y no pudimos leer el documento. Podés cargar los datos a mano."

function json(body: RespuestaExtraccionOk | RespuestaExtraccionError, status: number) {
  return NextResponse.json(body, { status })
}

/** Mapea el código de `ErrorGuarda` al HTTP status correspondiente. */
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
 * Traduce las excepciones tipadas de `lib/gemini/client.ts` a `{ status, mensaje }`.
 * Todos los mensajes en español y todos terminan sugiriendo la carga manual:
 * la subida NUNCA queda bloqueada por la IA (ROADMAP_SPRINTS.md, Sprint 4).
 */
function respuestaDeErrorGemini(error: unknown): { status: number; mensaje: string } {
  if (error instanceof GeminiApiError && error.status === 429) {
    return { status: 429, mensaje: MENSAJE_CUOTA }
  }
  if (error instanceof GeminiTimeoutError) {
    console.error("[extraccion] Timeout llamando a Gemini:", error.message)
    return { status: 504, mensaje: MENSAJE_TIMEOUT }
  }
  if (error instanceof GeminiParseError) {
    console.error("[extraccion] Respuesta de Gemini no parseable:", error.message)
    return { status: 502, mensaje: MENSAJE_RESPUESTA_INVALIDA }
  }
  if (error instanceof GeminiConfigError) {
    // No es culpa de la persona ni transitorio: falta configuración del
    // servidor (típicamente GEMINI_API_KEY). Se loguea completo porque el
    // mensaje de este error nunca contiene la clave en sí.
    console.error("[extraccion] Gemini mal configurado:", error.message)
    return { status: 500, mensaje: MENSAJE_SERVICIO_NO_DISPONIBLE }
  }
  if (error instanceof GeminiApiError) {
    // Incluye el caso "modelo inexistente" (GEMINI_MODEL_ID mal seteada):
    // Gemini responde 404/400 y `extraerJson` ya no reintenta un 4xx.
    console.error(`[extraccion] Gemini devolvió un error HTTP ${error.status ?? "?"}:`, error.message)
    return { status: 502, mensaje: MENSAJE_LECTURA_FALLIDA }
  }
  console.error("[extraccion] Error inesperado al extraer el documento:", error)
  return { status: 500, mensaje: MENSAJE_INESPERADO }
}

export async function POST(request: Request): Promise<Response> {
  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return json({ error: MENSAJE_SIN_DOCUMENTO_ID }, 400)
  }

  const documentoId =
    cuerpo && typeof cuerpo === "object" && "documentoId" in cuerpo
      ? (cuerpo as { documentoId: unknown }).documentoId
      : undefined

  if (typeof documentoId !== "string" || !PATRON_UUID.test(documentoId)) {
    return json({ error: MENSAJE_SIN_DOCUMENTO_ID }, 400)
  }

  try {
    const sesion = await requerirSesion({ siNoHaySesion: "lanzar" })
    const { supabase } = sesion

    const { data: documento, error: errorDocumento } = await supabase
      .from("documents")
      .select("id, profile_id, storage_path, mime_type")
      .eq("id", documentoId)
      .maybeSingle()

    if (errorDocumento) {
      console.error("[extraccion] Fallo al leer la fila de documents:", errorDocumento.message)
      return json({ error: MENSAJE_INESPERADO }, 500)
    }
    if (!documento) {
      return json({ error: MENSAJE_DOCUMENTO_NO_ENCONTRADO }, 404)
    }

    // Paso 3: `upload`, no `view` — ver el encabezado del archivo.
    await requerirPermiso(documento.profile_id, "upload", { sesion, siNoHaySesion: "lanzar" })

    if (!documento.mime_type || !MIME_SOPORTADOS.has(documento.mime_type)) {
      return json({ error: MENSAJE_TIPO_NO_SOPORTADO }, 422)
    }

    const { data: archivo, error: errorDescarga } = await supabase.storage
      .from(BUCKETS.documentos)
      .download(documento.storage_path)

    if (errorDescarga || !archivo) {
      console.error(
        `[extraccion] No se pudo descargar ${BUCKETS.documentos}/${documento.storage_path}:`,
        errorDescarga?.message,
      )
      return json({ error: MENSAJE_ARCHIVO_NO_DISPONIBLE }, 500)
    }

    const base64 = Buffer.from(await archivo.arrayBuffer()).toString("base64")

    let extraccion: DocumentoMedicoExtraido
    try {
      extraccion = await extraerJson<DocumentoMedicoExtraido>({
        prompt: PROMPT_DOCUMENTO_MEDICO,
        media: { mimeType: documento.mime_type, data: base64 },
        schema: SCHEMA_DOCUMENTO_MEDICO,
      })
    } catch (error) {
      const { status, mensaje } = respuestaDeErrorGemini(error)
      return json({ error: mensaje }, status)
    }

    // Persistencia de la extracción CRUDA (ai_summary + raw_ocr_text). Ver el
    // bloque "Qué persiste este handler y qué NO" del encabezado: puede no
    // aplicarse si el actor no tiene `can_manage`, y eso no es un error de
    // esta request.
    const textoCompleto = extraccion.texto_completo?.trim()
    const rawOcrText = textoCompleto && textoCompleto.length > 0 ? textoCompleto.slice(0, MAX_TEXTO_COMPLETO) : null

    try {
      const { data: filasActualizadas, error: errorUpdate } = await supabase
        .from("documents")
        .update({ ai_summary: extraccion.resumen, raw_ocr_text: rawOcrText })
        .eq("id", documentoId)
        .select("id")

      if (errorUpdate) {
        console.error(`[extraccion] No se pudo guardar la extracción de ${documentoId}:`, errorUpdate.message)
      } else if (!filasActualizadas || filasActualizadas.length === 0) {
        console.warn(
          `[extraccion] La extracción de ${documentoId} no se persistió: el actor no tiene can_manage ` +
            `sobre el perfil (documents_update_administrador). La extracción igual se devuelve en la respuesta.`,
        )
      }
    } catch (error) {
      console.error(`[extraccion] Fallo inesperado guardando la extracción de ${documentoId}:`, error)
    }

    return json({ extraccion }, 200)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return json({ error: error.message }, estadoDeErrorGuarda(error))
    }
    console.error("[extraccion] Fallo inesperado en el Route Handler de extracción:", error)
    return json({ error: MENSAJE_INESPERADO }, 500)
  }
}
