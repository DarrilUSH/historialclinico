/**
 * `/api/documentos/extraer` — la lectura automática de un documento médico ya
 * subido, con Gemini.
 *
 * Dos métodos, un solo recurso: "el estado de la lectura de este documento".
 *
 * - **`POST { documentoId }`** — pide que la lectura ARRANQUE. Contesta
 *   enseguida (no espera a Gemini) con el estado en el que quedó el documento.
 * - **`GET ?doc={id}`** — pregunta en qué anda. Es lo que usa la pantalla de
 *   revisión al volver del bloqueo de pantalla.
 *
 * ## Por qué el `POST` ya no espera a Gemini (hotfix del 19/08/2026)
 *
 * Reporte del dueño, usando la app en su teléfono: *"cuando está analizando un
 * archivo y se bloquea el celular o se cambia de aplicación se corta y larga
 * error, ¿no se puede hacer que quede en segundo plano y finalice?"*.
 *
 * Antes este handler hacía TODO adentro de la request -descarga, hasta tres
 * intentos contra Gemini (peor caso ≈ 94 s), cotejo de duplicados- y devolvía
 * la extracción entera en el cuerpo. La pantalla, del otro lado, mantenía ese
 * `fetch` abierto durante todo ese tiempo. Cuando Android congela la pestaña
 * -bloqueo de pantalla, cambio de app- ese `fetch` muere, y con él moría el
 * trabajo: el servidor terminaba bien, la cuota de Gemini se gastaba igual, y
 * la persona veía "No pudimos conectarnos para leer el documento" con el
 * formulario vacío. Reproducido en local abortando el `fetch` del cliente a
 * los 400 ms: la fila quedaba con `ai_summary` escrito (el servidor SÍ había
 * terminado) y la pantalla mostraba el error terminal.
 *
 * Ahora el trabajo pesado va en `after()` (`next/server`), que ejecuta después
 * de que la respuesta se terminó de mandar y que -según su propia
 * documentación- **corre aunque la respuesta no haya llegado bien**. En Vercel
 * se apoya en `waitUntil`, que extiende la vida de la invocación hasta que la
 * promesa termina; `maxDuration` sigue acotando el total. El resultado se
 * guarda en la fila (`lib/documentos/extraccion-admin.ts`), así que:
 *
 * - el `POST` del cliente dura milisegundos en vez de un minuto y medio: la
 *   ventana en la que congelar la pestaña puede romper algo se vuelve
 *   minúscula;
 * - y aunque se rompa, no se pierde nada: la lectura sigue del lado del
 *   servidor y el `GET` la entrega cuando la persona vuelve.
 *
 * ## Un `fetch` muerto ya no significa "la lectura falló"
 *
 * Ver `lib/documentos/lectura-automatica.ts`: el ÉXITO DE LA REQUEST lo dice
 * el status HTTP; el ESTADO DE LA LECTURA lo dice `estado`, dentro del cuerpo,
 * y sale de la base. Son dos cosas distintas y ahora se leen por separado.
 *
 * ## Nunca dos llamadas a Gemini por el mismo documento
 *
 * Con el cliente reintentando al volver a primer plano, dos `POST` pueden
 * llegar casi juntos. `reclamarLectura` (`extraccion-admin.ts`) hace la
 * transición `pendiente|error → procesando` en un solo `UPDATE` condicional:
 * gana uno solo. El que pierde recibe `procesando` y se pone a esperar; si la
 * lectura ya estaba `listo`, la respuesta trae el resultado guardado sin
 * pasar por Gemini.
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
 * 3. **`requerirPermiso(profile_id_del_documento, "upload")` en el `POST`,
 *    `"view"` en el `GET`.** Arrancar una lectura es parte del flujo de carga
 *    y dispara una llamada real a la API de Gemini (consumo de cuota), así que
 *    un `can_view` -que puede ABRIR el documento pero no subió nada- no puede
 *    gatillarla. PREGUNTAR en qué anda, en cambio, no gasta nada y no muestra
 *    ningún dato que quien tiene `view` no pueda ver igual abriendo el
 *    documento. Se reutiliza la sesión ya resuelta en el paso 1
 *    (`opciones.sesion`) para no pagar un `auth.getUser()` de más.
 *
 * ## Por qué la descarga del archivo va con el cliente del USUARIO
 *
 * `documento.storage_path` ya pasó el filtro de RLS de la tabla en el paso 2,
 * pero el ARCHIVO en Storage es un recurso aparte con su propia política
 * (`objetos_select_puede_ver_perfil`, `supabase/migrations/20260812230000_storage.sql`).
 * Descargar con `supabase.storage.download()` del cliente del usuario hace que
 * esa política vuelva a decidir. Esto NO cambió con el hotfix: lo único que
 * pasó a `service_role` es la ESCRITURA del resultado, y el porqué está
 * documentado en el encabezado de `lib/documentos/extraccion-admin.ts` (es el
 * mismo motivo por el que `lib/documentos/huella-admin.ts` escribe
 * `content_sha256` con `service_role`: `documents_update_administrador` exige
 * `can_manage`, que quien sube no necesariamente tiene).
 *
 * ## Qué persiste y qué NO
 *
 * Guarda la extracción CRUDA validada (`ai_extraction`), el duplicado
 * semántico cotejado (`ai_extraction_duplicate`), el resumen (`ai_summary`) y
 * el extracto de texto (`raw_ocr_text`). La CONFIRMACIÓN del usuario
 * -título/fecha/categoría finales editados a mano + `lab_metrics`- sigue
 * siendo del RPC `confirmar_documento_recien_subido`: este handler no toca
 * `title`, `category`, `document_date`, `specialty`, `institution`,
 * `doctor_name` ni `doctor_id`, y no inserta en `lab_metrics`. La IA nunca
 * guarda sola.
 *
 * ## Duplicados SEMÁNTICOS (Capas 2 y 3, hotfix sobre la huella byte-a-byte)
 *
 * Justo después de validar la extracción, esta lectura coteja los datos recién
 * leídos contra los documentos YA CONFIRMADOS del mismo perfil
 * (`lib/documentos/duplicados-semanticos-consulta.ts`): mismo laboratorio +
 * mismo N° de orden (Capa 2), o TODOS los datos extraídos exactamente iguales
 * -fecha primero, es condición necesaria- (Capa 3). Es el único momento del
 * flujo humano en el que existen datos estructurados con los que comparar: la
 * huella (Capa 1) corre ANTES, dentro de `ingestarDocumento`, sobre los bytes
 * crudos. Si encuentra uno, viaja con la fecha YA FORMATEADA
 * (`formatearFechaDuplicado`, servidor) para que `FormularioRevision` sólo
 * tenga que mostrarla. Es best-effort: un error en el cotejo se loguea y no
 * bloquea la extracción ya conseguida.
 *
 * ## Errores de Gemini: mensajes en español, nunca un 500 sin cuerpo
 *
 * `extraerJson` (`lib/gemini/client.ts`) ya resuelve el timeout y los dos
 * reintentos; acá sólo queda traducir sus excepciones tipadas a un mensaje
 * mostrable, que ahora se GUARDA en `ai_extraction_error` en vez de viajar
 * suelto. El caso de cuota (HTTP 429) tiene mensaje propio por la regla de
 * costo cero del proyecto: NUNCA se le sugiere a la persona pagar por más
 * cuota, se la manda a cargar los datos a mano.
 */

import { NextResponse } from "next/server"
import { after } from "next/server"

import {
  GeminiApiError,
  GeminiConfigError,
  GeminiParseError,
  GeminiTimeoutError,
  extraerJson,
} from "@/lib/gemini/client"
import { PROMPT_DOCUMENTO_MEDICO } from "@/lib/gemini/prompt-documento"
import { SCHEMA_DOCUMENTO_MEDICO, type DocumentoMedicoExtraido } from "@/lib/gemini/schemas"
import {
  type ErrorGuarda,
  type SesionServidor,
  esErrorDeGuarda,
  requerirPermiso,
  requerirSesion,
} from "@/lib/auth/guardas"
import { formatearFechaDuplicado } from "@/lib/documentos/huella"
import { buscarDuplicadoSemantico } from "@/lib/documentos/duplicados-semanticos-consulta"
import type { DuplicadoSemanticoParaCliente } from "@/lib/documentos/duplicados-semanticos"
import {
  guardarLectura,
  leerLectura,
  reclamarLectura,
  registrarFalloLectura,
  type LecturaDocumento,
} from "@/lib/documentos/extraccion-admin"
import {
  PARAM_DOCUMENTO,
  type RespuestaLectura,
  type RespuestaLecturaFallida,
} from "@/lib/documentos/lectura-automatica"
import { BUCKETS } from "@/lib/storage-admin"
import { validarExtraccion } from "@/lib/validacion/documento.schema"

// Necesita el runtime de Node (usa `Buffer`, no disponible en Edge) — mismo
// criterio explícito que el resto de las rutas que llaman a servicios
// externos lentos (`app/api/lugares/sincronizar/route.ts`).
export const runtime = "nodejs"

/**
 * Tope de duración de la función serverless, en segundos (Sprint 19). Con
 * `MAX_REINTENTOS = 2` y `TIMEOUT_MS = 30s` en `lib/gemini/client.ts`, el peor
 * caso de `extraerJson` solo (3 intentos + las dos esperas entre reintentos)
 * ronda los 94s; sumale la descarga del archivo y las escrituras a la base y
 * 120s deja margen real sin acercarse al límite.
 *
 * Sigue valiendo -y ahora es todavía más importante- con el trabajo movido a
 * `after()`: la documentación de `after` es explícita en que la tarea corre
 * "for the platform's default or configured max duration of your route". Este
 * número es lo que le da a Vercel permiso para mantener viva la invocación
 * mientras Gemini contesta, aunque la respuesta ya se haya mandado.
 */
export const maxDuration = 120

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

function json(body: RespuestaLectura | RespuestaLecturaFallida, status: number) {
  return NextResponse.json(body, { status })
}

/** `LecturaDocumento` (lo que sabe la base) → el cuerpo que espera el cliente. */
function respuestaDe(lectura: LecturaDocumento): RespuestaLectura {
  return {
    estado: lectura.estado,
    extraccion: lectura.extraccion,
    duplicadoSemantico: lectura.duplicadoSemantico,
    error: lectura.error,
  }
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
 * Traduce las excepciones tipadas de `lib/gemini/client.ts` al mensaje EN
 * ESPAÑOL que corresponde guardar en `ai_extraction_error`. Todos terminan
 * sugiriendo la carga manual: la subida NUNCA queda bloqueada por la IA
 * (ROADMAP_SPRINTS.md, Sprint 4).
 *
 * Ya no devuelve un status HTTP: el desenlace de la lectura viaja en el cuerpo
 * (ver el encabezado y `lib/documentos/lectura-automatica.ts`), y para cuando
 * esto corre la respuesta HTTP ya se mandó.
 */
function mensajeDeErrorGemini(error: unknown): string {
  if (error instanceof GeminiApiError && error.status === 429) {
    return MENSAJE_CUOTA
  }
  if (error instanceof GeminiTimeoutError) {
    console.error("[extraccion] Timeout llamando a Gemini:", error.message)
    return MENSAJE_TIMEOUT
  }
  if (error instanceof GeminiParseError) {
    console.error("[extraccion] Respuesta de Gemini no parseable:", error.message)
    return MENSAJE_RESPUESTA_INVALIDA
  }
  if (error instanceof GeminiConfigError) {
    // No es culpa de la persona ni transitorio: falta configuración del
    // servidor (típicamente GEMINI_API_KEY). Se loguea completo porque el
    // mensaje de este error nunca contiene la clave en sí.
    console.error("[extraccion] Gemini mal configurado:", error.message)
    return MENSAJE_SERVICIO_NO_DISPONIBLE
  }
  if (error instanceof GeminiApiError) {
    // Incluye el caso "modelo inexistente" (GEMINI_MODEL_ID mal seteada):
    // Gemini responde 404/400 y `extraerJson` ya no reintenta un 4xx.
    console.error(`[extraccion] Gemini devolvió un error HTTP ${error.status ?? "?"}:`, error.message)
    return MENSAJE_LECTURA_FALLIDA
  }
  console.error("[extraccion] Error inesperado al extraer el documento:", error)
  return MENSAJE_INESPERADO
}

interface DocumentoResuelto {
  sesion: SesionServidor
  documento: { id: string; profile_id: string; storage_path: string; mime_type: string | null }
}

/**
 * Guardas 1-3, compartidas por `GET` y `POST`. Devuelve la fila del documento
 * y la sesión ya resuelta, o una `Response` de error lista para devolver.
 */
async function resolverDocumento(
  documentoId: string,
  permiso: "view" | "upload",
): Promise<DocumentoResuelto | Response> {
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

  // Ver el encabezado: `upload` para arrancar la lectura, `view` para
  // preguntar en qué anda.
  await requerirPermiso(documento.profile_id, permiso, { sesion, siNoHaySesion: "lanzar" })

  return { sesion, documento }
}

/**
 * El trabajo pesado: descargar el archivo, leerlo con Gemini, validar, cotejar
 * duplicados y GUARDAR el resultado. Corre dentro de `after()`, después de que
 * la respuesta se mandó.
 *
 * No lanza nunca: cualquier desenlace -éxito o falla- termina escrito en la
 * fila, que es lo único que el cliente va a mirar después. Un `throw` que se
 * escapara acá dejaría el documento clavado en `procesando` hasta que venza la
 * reserva.
 */
async function correrLectura(
  sesion: SesionServidor,
  documento: DocumentoResuelto["documento"],
): Promise<void> {
  const { supabase } = sesion
  const documentoId = documento.id
  const perfilId = documento.profile_id

  try {
    const { data: archivo, error: errorDescarga } = await supabase.storage
      .from(BUCKETS.documentos)
      .download(documento.storage_path)

    if (errorDescarga || !archivo) {
      console.error(
        `[extraccion] No se pudo descargar ${BUCKETS.documentos}/${documento.storage_path}:`,
        errorDescarga?.message,
      )
      await registrarFalloLectura(documentoId, perfilId, MENSAJE_ARCHIVO_NO_DISPONIBLE)
      return
    }

    const base64 = Buffer.from(await archivo.arrayBuffer()).toString("base64")

    let extraccion: DocumentoMedicoExtraido
    try {
      const extraccionCruda = await extraerJson<DocumentoMedicoExtraido>({
        prompt: PROMPT_DOCUMENTO_MEDICO,
        // `mime_type` ya se verificó contra `MIME_SOPORTADOS` en el `POST`,
        // antes de reservar la lectura.
        media: { mimeType: documento.mime_type as string, data: base64 },
        schema: SCHEMA_DOCUMENTO_MEDICO,
      })

      // Validar la respuesta de Gemini contra el schema Zod espejo antes de persistir
      const validacion = validarExtraccion(extraccionCruda)
      if (!validacion.ok) {
        console.error(
          `[extraccion] Validación Zod fallida para ${documentoId}:`,
          validacion.errores.join(" | "),
        )
        await registrarFalloLectura(documentoId, perfilId, MENSAJE_RESPUESTA_INVALIDA)
        return
      }

      extraccion = validacion.datos
    } catch (error) {
      await registrarFalloLectura(documentoId, perfilId, mensajeDeErrorGemini(error))
      return
    }

    // Duplicados SEMÁNTICOS (Capas 2 y 3): recién acá existen datos
    // estructurados con los que cotejar. Best-effort -igual que el backfill de
    // huellas de `ingestarDocumento`-: si la consulta falla, la pantalla de
    // revisión simplemente no muestra la franja, nunca bloquea la extracción
    // ya conseguida.
    //
    // Si `extraccion.fecha` es `null` (Sprint 19: el modelo ya no inventa
    // fecha cuando el documento no imprime la suya, ver `lib/gemini/schemas.ts`),
    // directamente NO se cotejan duplicados: `coincidenTodosLosDatos` resuelve
    // `null` a "no hay con qué evaluar la condición necesaria de fecha", así
    // que preguntarle a la base acá sería una consulta que de antemano no
    // puede aportar nada.
    let duplicadoSemantico: DuplicadoSemanticoParaCliente | null = null
    if (extraccion.fecha) {
      try {
        const encontrado = await buscarDuplicadoSemantico(supabase, perfilId, documentoId, {
          fecha: extraccion.fecha,
          categoria: extraccion.categoria,
          institucion: extraccion.institucion,
          medico: extraccion.medico,
          numeroOrden: extraccion.numero_orden ?? "",
          // `valorTexto` viaja también (Sprint 19): un resultado CUALITATIVO
          // ("No Reactivo") es sustancia comparable igual que uno numérico
          // -ver `MetricaComparable` en `lib/documentos/duplicados-semanticos.ts`-,
          // así que ya no hace falta filtrarlo afuera de la comparación.
          metricas: extraccion.metricas.map((metrica) => ({
            nombre: metrica.nombre,
            valor: metrica.valor,
            valorTexto: metrica.valorTexto,
            unidad: metrica.unidad,
          })),
        })

        if (encontrado) {
          duplicadoSemantico = {
            documentoId: encontrado.documentoId,
            titulo: encontrado.titulo,
            fechaTexto: formatearFechaDuplicado(encontrado.fecha),
            motivo: encontrado.motivo,
          }
        }
      } catch (error) {
        console.error(
          `[extraccion] No se pudo cotejar duplicados semánticos de ${documentoId} (se sigue sin la franja de aviso):`,
          error instanceof Error ? error.message : error,
        )
      }
    }

    const textoCompleto = extraccion.texto_completo?.trim()
    const textoOcr =
      textoCompleto && textoCompleto.length > 0 ? textoCompleto.slice(0, MAX_TEXTO_COMPLETO) : null

    await guardarLectura(documentoId, perfilId, {
      extraccion,
      duplicadoSemantico,
      resumen: extraccion.resumen,
      textoOcr,
    })
  } catch (error) {
    console.error(`[extraccion] Fallo inesperado leyendo ${documentoId}:`, error)
    await registrarFalloLectura(documentoId, perfilId, MENSAJE_INESPERADO).catch(() => {
      // Si ni siquiera se pudo anotar el fallo, la reserva vence sola
      // (`VENTANA_RECLAMO_MS`) y la próxima consulta puede volver a intentar.
    })
  }
}

/** `GET /api/documentos/extraer?doc={id}` — ¿en qué anda la lectura? */
export async function GET(request: Request): Promise<Response> {
  const documentoId = new URL(request.url).searchParams.get(PARAM_DOCUMENTO)

  if (typeof documentoId !== "string" || !PATRON_UUID.test(documentoId)) {
    return json({ error: MENSAJE_SIN_DOCUMENTO_ID }, 400)
  }

  try {
    const resuelto = await resolverDocumento(documentoId, "view")
    if (resuelto instanceof Response) return resuelto

    const lectura = await leerLectura(documentoId, resuelto.documento.profile_id)
    if (!lectura) {
      return json({ error: MENSAJE_DOCUMENTO_NO_ENCONTRADO }, 404)
    }

    return json(respuestaDe(lectura), 200)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return json({ error: error.message }, estadoDeErrorGuarda(error))
    }
    console.error("[extraccion] Fallo inesperado consultando el estado de la lectura:", error)
    return json({ error: MENSAJE_INESPERADO }, 500)
  }
}

/** `POST /api/documentos/extraer` con `{ documentoId }` — arrancá la lectura. */
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
    const resuelto = await resolverDocumento(documentoId, "upload")
    if (resuelto instanceof Response) return resuelto

    const { sesion, documento } = resuelto

    if (!documento.mime_type || !MIME_SOPORTADOS.has(documento.mime_type)) {
      // No es transitorio: este archivo no se va a poder leer nunca. Se anota
      // como fallo de lectura para que la pantalla ofrezca la carga a mano y
      // no siga preguntando.
      await registrarFalloLectura(documentoId, documento.profile_id, MENSAJE_TIPO_NO_SOPORTADO)
      return json(
        {
          estado: "error",
          extraccion: null,
          duplicadoSemantico: null,
          error: MENSAJE_TIPO_NO_SOPORTADO,
        },
        200,
      )
    }

    const reclamo = await reclamarLectura(documentoId, documento.profile_id)
    if (!reclamo) {
      return json({ error: MENSAJE_DOCUMENTO_NO_ENCONTRADO }, 404)
    }

    // Ya estaba leído (o hay otra corrida en curso): no se le vuelve a pagar a
    // Gemini, se contesta lo que la base ya sabe.
    if (!reclamo.reclamada) {
      return json(respuestaDe(reclamo.lectura), 200)
    }

    // La reserva es nuestra: el trabajo pesado arranca DESPUÉS de contestar.
    // Ver el bloque "Por qué el POST ya no espera a Gemini" del encabezado.
    after(async () => {
      await correrLectura(sesion, documento)
    })

    return json(
      { estado: "procesando", extraccion: null, duplicadoSemantico: null, error: null },
      202,
    )
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return json({ error: error.message }, estadoDeErrorGuarda(error))
    }
    console.error("[extraccion] Fallo inesperado en el Route Handler de extracción:", error)
    return json({ error: MENSAJE_INESPERADO }, 500)
  }
}
