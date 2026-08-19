import "server-only"

/**
 * Estado y resultado de la LECTURA AUTOMÁTICA de un documento — EXCLUSIVAMENTE
 * SERVIDOR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. Mismo contrato que
 *      `lib/documentos/huella-admin.ts`, `lib/gmail/mensajes-admin.ts` y
 *      `lib/storage-admin.ts`: jamás se importa desde código cliente, y aborta
 *      al cargarse si detecta un navegador.
 *
 *      **ESTE MÓDULO NO AUTORIZA NADA.** Recibe un `documentoId` y el
 *      `perfilId` de ESE documento, y hace lo que le piden. Quien llama
 *      -`app/api/documentos/extraer/route.ts`, que ANTES resolvió la fila con
 *      el cliente del usuario (RLS decide si puede verla) y exigió
 *      `requerirPermiso(perfilId, "upload")`- es responsable de haber
 *      comprobado el permiso. Toda escritura de acá abajo lleva
 *      `.eq("profile_id", perfilId)` además del id de la fila, y ninguna toca
 *      un documento ya confirmado.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué existe (el bug que arregla)
 *
 * Reporte del dueño, 19/08/2026, usando la app en su teléfono: *"cuando está
 * analizando un archivo y se bloquea el celular o se cambia de aplicación se
 * corta y larga error"*.
 *
 * Hasta hoy el resultado de la lectura viajaba SÓLO en el cuerpo de la
 * respuesta de `POST /api/documentos/extraer`. De la extracción entera -título,
 * fecha, categoría, institución, especialidad, médico, número de orden,
 * métricas de laboratorio, duplicado semántico- la fila guardaba únicamente
 * `ai_summary` y `raw_ocr_text`. Si Android congelaba la pestaña, el `fetch`
 * del cliente moría y con él se perdía todo el trabajo: el servidor terminaba
 * bien, la cuota de Gemini se gastaba igual, y la persona veía un error
 * terminal. Reproducido en local abortando el `fetch` del cliente a los 400 ms:
 * la fila quedaba con `ai_summary` escrito y la pantalla mostraba el
 * formulario vacío.
 *
 * Desde esta migración (`20260819210000_extraccion_recuperable.sql`) el
 * resultado vive en la BASE (`documents.ai_extraction`,
 * `.ai_extraction_duplicate`) junto con el estado de la lectura
 * (`.ai_extraction_status`, `.ai_extraction_error`,
 * `.ai_extraction_started_at`). El cliente ya no depende de recibir una
 * respuesta larga: pregunta.
 *
 * ## Por qué `service_role` y no el cliente del usuario
 *
 * Exactamente el mismo motivo que `lib/documentos/huella-admin.ts`:
 * `documents_update_administrador` (`20260812220000_rls.sql`) exige
 * `puede_administrar_perfil` -`can_manage`, no `can_upload`- para CUALQUIER
 * `UPDATE` sobre `documents`. Una cuidadora con sólo `can_upload` sobre un
 * perfil compartido no puede escribir esas columnas con su propio cliente: el
 * `UPDATE` no afecta ninguna fila y RLS lo deja pasar en silencio (así
 * responde Postgres a un `USING` que no matchea). Eso era tolerable cuando lo
 * único que se perdía era `ai_summary`; ahora que de esa escritura depende
 * poder RECUPERAR la lectura, un no-op silencioso dejaría el arreglo manco
 * justo para quien más lo necesita.
 *
 * Y, como la huella, esto NO es un dato que dicte el cliente: es 100 %
 * derivado por el servidor a partir de bytes que ya estaban en el bucket bajo
 * ese mismo `profile_id`.
 *
 * ## La reserva (`reclamarLectura`) existe para no pagar Gemini dos veces
 *
 * Con el cliente reintentando al volver del bloqueo de pantalla, dos `POST`
 * pueden llegar casi juntos. `reclamarLectura` hace la transición
 * `pendiente|error → procesando` en UN SOLO `UPDATE` condicional: en
 * `READ COMMITTED`, el segundo `UPDATE` vuelve a evaluar el `WHERE` después de
 * que el primero commiteó, no matchea, y devuelve cero filas. Sólo una corrida
 * llama a Gemini; la otra recibe "ya hay una en curso" y se pone a esperar.
 *
 * `ai_extraction_started_at` es la contracara: una corrida que se toma la
 * reserva y nunca la suelta -la función serverless murió a mitad de camino-
 * dejaría el documento clavado para siempre. Pasada `VENTANA_RECLAMO_MS`, otra
 * corrida puede retomarla.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  TEXTO_MOTIVO_DUPLICADO_SEMANTICO,
  type DuplicadoSemanticoParaCliente,
  type MotivoDuplicadoSemantico,
} from "@/lib/documentos/duplicados-semanticos"
import type { DocumentoMedicoExtraido } from "@/lib/gemini/schemas"
import { validarExtraccion } from "@/lib/validacion/documento.schema"
import type { Database, Json } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/documentos/extraccion-admin.ts se importó desde el navegador. Este módulo usa la " +
      "SERVICE_ROLE_KEY: sólo puede ejecutarse en el servidor.",
  )
}

/** Los cuatro valores de `documents.ai_extraction_status` (CHECK de la migración). */
export type EstadoLectura = "pendiente" | "procesando" | "listo" | "error"

/**
 * Cuánto vale una reserva de lectura antes de que otra corrida pueda
 * retomarla. Tiene que ser CÓMODAMENTE mayor que el peor caso real de
 * `extraerJson` (3 intentos × 30 s + 1 s + 3 s de espera ≈ 94 s, ver
 * `lib/gemini/client.ts`) más la descarga del archivo: si fuera más corto, una
 * corrida viva y sana podría ser "robada" por otra y pagaríamos Gemini dos
 * veces por el mismo documento. Tres minutos deja margen sin que un documento
 * abandonado quede bloqueado un tiempo que se note.
 */
export const VENTANA_RECLAMO_MS = 3 * 60 * 1000

/** Lo que sabe la base sobre la lectura automática de un documento. */
export interface LecturaDocumento {
  estado: EstadoLectura
  /** La extracción validada, si `estado === "listo"`. */
  extraccion: DocumentoMedicoExtraido | null
  /** El duplicado semántico cotejado junto con la extracción, o `null`. */
  duplicadoSemantico: DuplicadoSemanticoParaCliente | null
  /** Mensaje en español, listo para mostrar, si `estado === "error"`. */
  error: string | null
}

const LECTURA_PENDIENTE: LecturaDocumento = {
  estado: "pendiente",
  extraccion: null,
  duplicadoSemantico: null,
  error: null,
}

const COLUMNAS_LECTURA =
  "ai_extraction, ai_extraction_duplicate, ai_extraction_status, ai_extraction_error"

let clienteCache: SupabaseClient<Database> | null = null

function clienteAdmin(): SupabaseClient<Database> {
  if (clienteCache) return clienteCache

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error("Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL.")
  if (!serviceRoleKey) {
    throw new Error("Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY.")
  }

  clienteCache = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return clienteCache
}

function esEstadoValido(valor: unknown): valor is EstadoLectura {
  return valor === "pendiente" || valor === "procesando" || valor === "listo" || valor === "error"
}

/**
 * Reconstruye un `DuplicadoSemanticoParaCliente` de lo que hay en la columna.
 * Defensivo a propósito: la fila se escribió en OTRA request (quizás con una
 * versión anterior del código), así que se comprueba la forma en vez de
 * confiar en el `jsonb`.
 */
function esMotivoValido(valor: unknown): valor is MotivoDuplicadoSemantico {
  // Se pregunta contra el MAPA de textos y no contra una lista escrita a mano:
  // así, si mañana aparece un tercer motivo, esta guarda lo acepta sola.
  return typeof valor === "string" && Object.hasOwn(TEXTO_MOTIVO_DUPLICADO_SEMANTICO, valor)
}

function leerDuplicado(crudo: unknown): DuplicadoSemanticoParaCliente | null {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null
  const posible = crudo as Record<string, unknown>
  if (
    typeof posible.documentoId !== "string" ||
    typeof posible.titulo !== "string" ||
    typeof posible.fechaTexto !== "string" ||
    !esMotivoValido(posible.motivo)
  ) {
    return null
  }
  return {
    documentoId: posible.documentoId,
    titulo: posible.titulo,
    fechaTexto: posible.fechaTexto,
    motivo: posible.motivo,
  }
}

interface FilaLectura {
  ai_extraction: Json | null
  ai_extraction_duplicate: Json | null
  ai_extraction_status: string
  ai_extraction_error: string | null
}

/**
 * Traduce la fila cruda a `LecturaDocumento`.
 *
 * La extracción se vuelve a pasar por `validarExtraccion` -el MISMO validador
 * Zod que usó el route handler antes de guardarla-: es barato y garantiza que
 * lo que sale de acá tiene de verdad la forma de `DocumentoMedicoExtraido`, sin
 * ningún `as` a ciegas sobre un `jsonb`. Si no valida (una fila vieja, una
 * escritura a mano), se degrada a "pendiente": mejor volver a leer el
 * documento que servir algo que el formulario no sabe interpretar.
 */
function aLectura(fila: FilaLectura): LecturaDocumento {
  const estado = esEstadoValido(fila.ai_extraction_status)
    ? fila.ai_extraction_status
    : "pendiente"

  if (estado === "listo") {
    const validacion = validarExtraccion(fila.ai_extraction)
    if (!validacion.ok) {
      console.warn(
        "[extraccion] La extracción guardada no pasó la validación; se trata como pendiente:",
        validacion.errores.join(" | "),
      )
      return LECTURA_PENDIENTE
    }
    return {
      estado: "listo",
      extraccion: validacion.datos,
      duplicadoSemantico: leerDuplicado(fila.ai_extraction_duplicate),
      error: null,
    }
  }

  return {
    estado,
    extraccion: null,
    duplicadoSemantico: null,
    error: estado === "error" ? fila.ai_extraction_error : null,
  }
}

/**
 * Lee el estado de la lectura automática de `documentoId`.
 *
 * Devuelve `null` si la fila no existe o ya no pertenece a `perfilId` -quien
 * llama contesta el mismo 404 genérico que para "no tenés permiso", principio
 * 3 de `docs/modelo-permisos.md`-.
 */
export async function leerLectura(
  documentoId: string,
  perfilId: string,
): Promise<LecturaDocumento | null> {
  const { data, error } = await clienteAdmin()
    .from("documents")
    .select(COLUMNAS_LECTURA)
    .eq("id", documentoId)
    .eq("profile_id", perfilId)
    .maybeSingle()

  if (error) {
    console.error(`[extraccion] No se pudo leer el estado de ${documentoId}:`, error.message)
    throw new Error(error.message)
  }
  if (!data) return null

  return aLectura(data)
}

export interface ResultadoReclamo {
  /** `true` si ESTA corrida se quedó con la reserva y le toca llamar a Gemini. */
  reclamada: boolean
  /** El estado resultante: el que quedó reservado, o el que ya había. */
  lectura: LecturaDocumento
}

/**
 * Intenta reservar la lectura de `documentoId` para esta corrida.
 *
 * Reserva si el estado es `pendiente`, `error`, o un `procesando` cuya reserva
 * ya venció (`VENTANA_RECLAMO_MS`). NO reserva si ya está `listo` -no tiene
 * sentido volver a pagarle a Gemini por algo que ya está- ni si hay una
 * corrida viva en curso.
 *
 * El `UPDATE` condicional de una sola sentencia ES la exclusión mutua: ver el
 * bloque "La reserva" del encabezado.
 */
export async function reclamarLectura(
  documentoId: string,
  perfilId: string,
): Promise<ResultadoReclamo | null> {
  const corte = new Date(Date.now() - VENTANA_RECLAMO_MS).toISOString()

  const { data, error } = await clienteAdmin()
    .from("documents")
    .update({
      ai_extraction_status: "procesando",
      ai_extraction_started_at: new Date().toISOString(),
      ai_extraction_error: null,
    })
    .eq("id", documentoId)
    .eq("profile_id", perfilId)
    .is("confirmed_at", null)
    .or(
      "ai_extraction_status.in.(pendiente,error)," +
        `and(ai_extraction_status.eq.procesando,ai_extraction_started_at.lt.${corte}),` +
        "and(ai_extraction_status.eq.procesando,ai_extraction_started_at.is.null)",
    )
    .select(COLUMNAS_LECTURA)
    .maybeSingle()

  if (error) {
    console.error(`[extraccion] No se pudo reservar la lectura de ${documentoId}:`, error.message)
    throw new Error(error.message)
  }

  if (data) {
    return { reclamada: true, lectura: aLectura(data) }
  }

  // No se reservó: o ya está `listo`, o hay una corrida viva, o la fila ya no
  // está (confirmada, descartada, otro perfil).
  const lectura = await leerLectura(documentoId, perfilId)
  if (!lectura) return null
  return { reclamada: false, lectura }
}

export interface ExtraccionParaGuardar {
  extraccion: DocumentoMedicoExtraido
  duplicadoSemantico: DuplicadoSemanticoParaCliente | null
  /** `documents.ai_summary` — el resumen que ya se persistía antes de este arreglo. */
  resumen: string | null
  /** `documents.raw_ocr_text` — el extracto de texto, ya recortado por quien llama. */
  textoOcr: string | null
}

/**
 * Guarda el resultado de una lectura exitosa y deja el estado en `listo`.
 *
 * Escribe también `ai_summary` y `raw_ocr_text` -las dos columnas que el route
 * handler ya persistía-, ahora por esta vía: con el cliente del usuario ese
 * `UPDATE` no se aplicaba cuando quien subía tenía sólo `can_upload` (ver el
 * encabezado).
 */
export async function guardarLectura(
  documentoId: string,
  perfilId: string,
  datos: ExtraccionParaGuardar,
): Promise<void> {
  const { error } = await clienteAdmin()
    .from("documents")
    .update({
      ai_extraction: datos.extraccion as unknown as Json,
      ai_extraction_duplicate: (datos.duplicadoSemantico ?? null) as unknown as Json | null,
      ai_extraction_status: "listo",
      ai_extraction_error: null,
      ai_summary: datos.resumen,
      raw_ocr_text: datos.textoOcr,
    })
    .eq("id", documentoId)
    .eq("profile_id", perfilId)
    .is("confirmed_at", null)

  if (error) {
    console.error(`[extraccion] No se pudo guardar la lectura de ${documentoId}:`, error.message)
    throw new Error(error.message)
  }
}

/**
 * Deja anotado que la lectura falló DE VERDAD, con el mensaje en español que
 * corresponde mostrar.
 *
 * Que esto exista es lo que le permite al cliente distinguir "el teléfono se
 * bloqueó y mi `fetch` murió" -donde la lectura sigue viva o ya terminó- de
 * "Gemini no pudo leer este documento", que es el único caso en el que
 * corresponde ofrecer la carga a mano.
 */
export async function registrarFalloLectura(
  documentoId: string,
  perfilId: string,
  mensaje: string,
): Promise<void> {
  const { error } = await clienteAdmin()
    .from("documents")
    .update({
      ai_extraction_status: "error",
      ai_extraction_error: mensaje,
    })
    .eq("id", documentoId)
    .eq("profile_id", perfilId)
    .is("confirmed_at", null)

  if (error) {
    console.error(
      `[extraccion] No se pudo registrar el fallo de lectura de ${documentoId}:`,
      error.message,
    )
  }
}
