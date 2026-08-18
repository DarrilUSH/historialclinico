import "server-only"

/**
 * Persistencia del camino AUTOMÁTICO de Gmail — EXCLUSIVAMENTE SERVIDOR
 * (Sprint 17, auto-carga sin dudas).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. Mismo contrato que
 *      `lib/gmail/mensajes-admin.ts`, `lib/gmail/conexiones-admin.ts` y
 *      `lib/documentos/huella-admin.ts`: jamás se importa desde código
 *      cliente, y aborta al cargarse si detecta un navegador.
 *
 *      **ESTE MÓDULO NO AUTORIZA NADA, Y ESTA VEZ NO ES SOLO UNA FÓRMULA.**
 *      Todas las funciones de acá abajo llaman a RPC que verifican las guardas
 *      EN LA BASE (`20260818160000_gmail_auto_ingesta.sql` §5): que el
 *      interruptor esté encendido, que la cuenta administre el perfil de
 *      destino en ESE momento, que el correo sea suyo y siga pendiente, y que
 *      no haya huella duplicada. Si este archivo tuviera un bug y le pidiera a
 *      la base cargar algo que no corresponde, la base contesta que no.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué las decisiones NO están acá
 *
 * El barrido corre sin nadie mirando. La diferencia entre "el circuito de
 * ingesta con una persona revisando" y "el circuito automático" es que en el
 * segundo no hay un segundo par de ojos entre la decisión y la escritura. Por
 * eso la decisión de SI cargar vive en un módulo puro y probado
 * (`lib/gmail/auto-ingesta.ts`), la autorización vive en la base, y este
 * archivo solo transporta: lee la configuración, llama a la RPC, traduce el
 * resultado. No tiene ni un `if` que decida si algo entra al historial.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { CategoriaDocumentoExtraida } from "@/lib/gemini/schemas"
import type { Database } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/gmail/auto-ingesta-admin.ts se importó desde el navegador. Este módulo usa la " +
      "SERVICE_ROLE_KEY: sólo puede ejecutarse en el servidor.",
  )
}

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

/* ------------------------------------------------------------------ *
 *  El interruptor
 * ------------------------------------------------------------------ */

/** A dónde van las cargas automáticas de una cuenta, si es que van a algún lado. */
export interface DestinoAutoIngesta {
  perfilId: string
  /** `profiles.full_name` — es contra esto que se coteja el nombre del paciente. */
  perfilNombre: string
}

/**
 * El destino de auto-carga de una cuenta, o `null` si no hay auto-carga.
 *
 * Devuelve `null` en los tres casos que significan lo mismo para el barrido
 * ("acá no se carga nada solo"): sin conexión, interruptor apagado, o perfil de
 * destino que ya no existe. Quien llama no necesita distinguirlos.
 *
 * Va con `service_role` y no con el cliente del usuario porque quien pregunta
 * es el cron, que no tiene sesión de nadie. La lectura está acotada a la fila
 * de esa cuenta y a dos columnas del perfil.
 */
export async function obtenerDestinoAutoIngesta(
  userId: string,
): Promise<DestinoAutoIngesta | null> {
  const { data, error } = await clienteAdmin()
    .from("gmail_connections")
    .select("auto_ingest_enabled, auto_ingest_profile_id")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    // No se propaga: que no se pueda leer la configuración de auto-carga no
    // puede tumbar el barrido entero. Sin destino, la pasada se comporta como
    // la 17.2 de siempre —registrar y esperar a una persona—, que es el modo
    // seguro de fallar.
    console.error("[gmail-auto] no se pudo leer la configuración de auto-carga:", error.message)
    return null
  }

  if (!data || !data.auto_ingest_enabled || !data.auto_ingest_profile_id) return null

  const { data: perfil, error: errorPerfil } = await clienteAdmin()
    .from("profiles")
    .select("id, full_name")
    .eq("id", data.auto_ingest_profile_id)
    .maybeSingle()

  if (errorPerfil || !perfil) {
    console.error(
      "[gmail-auto] el perfil de destino de la auto-carga no se pudo leer:",
      errorPerfil?.message ?? "no existe",
    )
    return null
  }

  return { perfilId: perfil.id, perfilNombre: perfil.full_name }
}

/**
 * Enciende o apaga la carga automática. La autorización -que la cuenta
 * ADMINISTRE ese perfil- la verifica la RPC, no este archivo.
 *
 * Propaga el error de Postgres con su mensaje, que ya viene en castellano y
 * mostrable ("No podés elegir ese perfil: no lo administrás.").
 */
export async function configurarAutoIngesta(parametros: {
  userId: string
  activar: boolean
  perfilId: string | null
}): Promise<void> {
  const { error } = await clienteAdmin().rpc("configurar_auto_ingesta_gmail", {
    p_usuario: parametros.userId,
    p_activar: parametros.activar,
    // `supabase gen types` declara los parámetros de RPC como no-nulos aunque
    // Postgres acepte NULL en cualquiera de ellos: no hay forma de expresar
    // "uuid nullable" en el tipo generado. Apagar la auto-carga es exactamente
    // el caso de mandar NULL a propósito, y la función lo contempla (§5.1 de
    // la migración: al apagar ni siquiera mira `p_perfil`).
    p_perfil: parametros.perfilId as string,
  })

  if (error) {
    throw new Error(error.message)
  }
}

/* ------------------------------------------------------------------ *
 *  Las cargas
 * ------------------------------------------------------------------ */

/**
 * Qué pasó con un intento de carga automática.
 *
 * - `creado` — entró. Trae el id de lo que se creó.
 * - `ya_resuelto` — el correo ya no estaba pendiente (replay de dos pasadas
 *   simultáneas, o un reintento). **No se escribió nada.**
 * - `duplicado` — el perfil ya tenía ese mismo archivo (o ese mismo turno).
 *   **No se escribió nada.**
 */
export type ResultadoIngresoAutomatico =
  | { estado: "creado"; id: string }
  | { estado: "ya_resuelto" }
  | { estado: "duplicado" }

/**
 * Interpreta el `jsonb` que devuelven las dos RPC.
 *
 * Cualquier forma que no reconozca se trata como `ya_resuelto`, que es el
 * resultado que NO crea nada y NO borra nada: ante una respuesta que no
 * entendemos, lo correcto es no tocar el historial de nadie.
 */
function interpretar(crudo: unknown, clave: "documento_id" | "turno_id"): ResultadoIngresoAutomatico {
  if (!crudo || typeof crudo !== "object") return { estado: "ya_resuelto" }

  const objeto = crudo as Record<string, unknown>
  if (objeto.estado === "duplicado") return { estado: "duplicado" }
  if (objeto.estado === "creado" && typeof objeto[clave] === "string") {
    return { estado: "creado", id: objeto[clave] as string }
  }
  return { estado: "ya_resuelto" }
}

export interface DocumentoAutomaticoParaIngresar {
  userId: string
  /** `gmail_messages.id`. */
  correoId: string
  storagePath: string
  mimeType: string
  bytes: number
  /** SHA-256 hex de 64 caracteres. */
  huella: string
  titulo: string
  categoria: CategoriaDocumentoExtraida
  /** `YYYY-MM-DD`. */
  fecha: string
  resumen: string
  /** Extracto acotado del documento (`raw_ocr_text`). Puede ir vacío. */
  textoOcr: string
}

/**
 * Crea el documento de una carga automática. El archivo YA tiene que estar en
 * Storage: si esta llamada no devuelve `creado`, quien llama tiene que borrar
 * el objeto (compensación).
 *
 * **El nombre del paciente NO se pasa acá.** Se usó para abrir la compuerta y
 * se descartó; no hay ningún parámetro donde ponerlo, que es la forma de que
 * no pueda persistirse por descuido (`docs/minimizacion-datos.md` §10.7, misma
 * técnica de "el tipo es la lista blanca" que `ContextoClinico`).
 */
export async function ingresarDocumentoAutomatico(
  datos: DocumentoAutomaticoParaIngresar,
): Promise<ResultadoIngresoAutomatico> {
  const { data, error } = await clienteAdmin().rpc("ingresar_documento_automatico", {
    p_usuario: datos.userId,
    p_correo: datos.correoId,
    p_storage_path: datos.storagePath,
    p_mime: datos.mimeType,
    p_bytes: datos.bytes,
    p_sha256: datos.huella,
    p_titulo: datos.titulo,
    p_categoria: datos.categoria,
    p_fecha: datos.fecha,
    p_resumen: datos.resumen,
    p_texto_ocr: datos.textoOcr,
  })

  if (error) {
    throw new Error(`No se pudo ingresar el documento automático: ${error.message}`)
  }

  return interpretar(data, "documento_id")
}

export interface TurnoAutomaticoParaIngresar {
  userId: string
  correoId: string
  especialidad: string
  medico: string
  /** ISO con zona, ya resuelto desde `fecha` + `hora` en hora de Ushuaia. */
  fechaHoraIso: string
  lugarNombre: string
  lugarDireccion: string
  lugarCiudad: string
  lugarProvincia: string
  notas: string
}

/** Crea el turno de una carga automática. Mismo contrato que el de documentos. */
export async function ingresarTurnoAutomatico(
  datos: TurnoAutomaticoParaIngresar,
): Promise<ResultadoIngresoAutomatico> {
  const { data, error } = await clienteAdmin().rpc("ingresar_turno_automatico", {
    p_usuario: datos.userId,
    p_correo: datos.correoId,
    p_especialidad: datos.especialidad,
    p_medico: datos.medico,
    p_fecha_hora: datos.fechaHoraIso,
    p_lugar_nombre: datos.lugarNombre,
    p_lugar_direccion: datos.lugarDireccion,
    p_lugar_ciudad: datos.lugarCiudad,
    p_lugar_provincia: datos.lugarProvincia,
    p_notas: datos.notas,
  })

  if (error) {
    throw new Error(`No se pudo ingresar el turno automático: ${error.message}`)
  }

  return interpretar(data, "turno_id")
}

/* ------------------------------------------------------------------ *
 *  El rastro de lo que NO se cargó, y el Deshacer
 * ------------------------------------------------------------------ */

/**
 * Deja anotado en el correo por qué la compuerta no se abrió.
 *
 * Nunca lanza: es información para la persona, no un requisito. Si esto falla,
 * el correo igual queda pendiente y visible en la bandeja —solo que sin la
 * explicación—, que es exactamente el comportamiento de la 17.2.
 */
export async function anotarMotivoDeRevision(
  userId: string,
  correoId: string,
  frase: string,
): Promise<void> {
  const { error } = await clienteAdmin()
    .from("gmail_messages")
    .update({ auto_review_reason: frase })
    .eq("id", correoId)
    .eq("user_id", userId)
    .eq("status", "pendiente_revision")

  if (error) {
    console.error(`[gmail-auto] no se pudo anotar el motivo de revisión de ${correoId}:`, error.message)
  }
}

/**
 * "Deshacer": devuelve un correo AUTO-CARGADO a la bandeja de pendientes.
 *
 * Es la segunda mitad del deshacer; la primera —borrar el documento o el
 * turno— la hace quien llama **con la sesión de la persona**, por las políticas
 * de borrado de siempre (`documents_delete_administrador`). Acá solo se limpia
 * el registro del correo.
 *
 * El `.eq("auto_ingested_at", …)` no se puede expresar como "no nulo" con el
 * builder de forma legible, así que se usa `.not("auto_ingested_at", "is", null)`:
 * esta función **solo** puede tocar correos que entraron SOLOS. Un correo que
 * una persona trajo a mano se reabre con `devolverMensajeAPendiente`, que es
 * otra función y otro botón.
 */
export async function revertirCargaAutomatica(userId: string, correoId: string): Promise<void> {
  const { error } = await clienteAdmin()
    .from("gmail_messages")
    .update({
      status: "pendiente_revision",
      resolved_at: null,
      document_id: null,
      appointment_id: null,
      auto_ingested_at: null,
      auto_review_reason: "Lo habíamos cargado solo y lo deshiciste. Queda acá para que decidas vos.",
    })
    .eq("id", correoId)
    .eq("user_id", userId)
    .not("auto_ingested_at", "is", null)

  if (error) {
    throw new Error(`No se pudo devolver el correo a la lista: ${error.message}`)
  }
}
