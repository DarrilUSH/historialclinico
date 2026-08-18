/**
 * Lectura de la bandeja "Llegaron por Gmail" para la interfaz (Sprint 17,
 * tarea 17.2).
 *
 * Se lee con el cliente del USUARIO -el de `lib/supabase/server.ts`, que pasa
 * por RLS- y no con `service_role`, siguiendo la regla del proyecto: si la
 * base la deja pasar, el permiso está verificado. La política
 * `gmail_messages_select_propios` acota a las filas de la cuenta en sesión.
 * Mismo criterio y misma división de responsabilidades que
 * `lib/gmail/conexion.ts` (lee) contra `lib/gmail/conexiones-admin.ts`
 * (escribe).
 *
 * Ninguna función de este archivo lanza ante un error de la base: devuelven
 * vacío y lo dejan en los logs. La pantalla de Gmail no puede romperse porque
 * una consulta accesoria falló.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import type { AdjuntoGmail } from "@/lib/gmail/mensaje"
import type { ClaseMensajeGmail, EstadoMensajeGmail } from "@/lib/gmail/mensajes-admin"
import type { Database, Json } from "@/types/database.types"

const COLUMNAS =
  "id, gmail_message_id, from_email, from_name, subject, message_date, kind, status, looks_like_appointment, attachments, document_id, appointment_id, detected_at, resolved_at, auto_ingested_at, auto_review_reason"

/** Cuántos correos ya resueltos se muestran. Es historia reciente, no un archivo. */
const LIMITE_RESUELTOS = 20

/** Tope de pendientes que se listan de una vez. Con la tanda de 15 por pasada, es holgado. */
const LIMITE_PENDIENTES = 60

/** Tope de la sección "Cargados automáticamente". Es lo reciente, no un archivo. */
const LIMITE_AUTO_CARGADOS = 20

/**
 * Ventana del contador de auto-cargados de `/inicio`. Una semana: cubre de
 * sobra el tiempo que alguien puede pasar sin abrir la app y sigue siendo una
 * novedad y no una estadística.
 */
const DIAS_AUTO_CARGA_RECIENTE = 7

export interface CorreoDeGmail {
  id: string
  gmailMessageId: string
  remitenteEmail: string
  remitenteNombre: string | null
  asunto: string | null
  fechaIso: string | null
  clase: ClaseMensajeGmail
  estado: EstadoMensajeGmail
  pareceTurno: boolean
  adjuntos: AdjuntoGmail[]
  documentId: string | null
  appointmentId: string | null
  detectadoEl: string
  resueltoEl: string | null
  /** Cuándo entró SOLO al historial (Sprint 17). `null` = lo trajo una persona. */
  autoCargadoEl: string | null
  /** Por qué NO se cargó solo, ya en castellano. `null` si no se evaluó o si sí se cargó. */
  motivoRevision: string | null
}

interface FilaCruda {
  id: string
  gmail_message_id: string
  from_email: string
  from_name: string | null
  subject: string | null
  message_date: string | null
  kind: string
  status: string
  looks_like_appointment: boolean
  attachments: Json
  document_id: string | null
  appointment_id: string | null
  detected_at: string
  resolved_at: string | null
  auto_ingested_at: string | null
  auto_review_reason: string | null
}

function aCorreo(fila: FilaCruda): CorreoDeGmail {
  return {
    id: fila.id,
    gmailMessageId: fila.gmail_message_id,
    remitenteEmail: fila.from_email,
    remitenteNombre: fila.from_name,
    asunto: fila.subject,
    fechaIso: fila.message_date,
    clase: fila.kind as ClaseMensajeGmail,
    estado: fila.status as EstadoMensajeGmail,
    pareceTurno: fila.looks_like_appointment,
    adjuntos: Array.isArray(fila.attachments) ? (fila.attachments as unknown as AdjuntoGmail[]) : [],
    documentId: fila.document_id,
    appointmentId: fila.appointment_id,
    detectadoEl: fila.detected_at,
    resueltoEl: fila.resolved_at,
    autoCargadoEl: fila.auto_ingested_at,
    motivoRevision: fila.auto_review_reason,
  }
}

/** Los correos que esperan una decisión, del más nuevo al más viejo. */
export async function listarCorreosPendientes(
  supabase: SupabaseClient<Database>,
): Promise<CorreoDeGmail[]> {
  const { data, error } = await supabase
    .from("gmail_messages")
    .select(COLUMNAS)
    .eq("status", "pendiente_revision")
    .order("message_date", { ascending: false, nullsFirst: false })
    .limit(LIMITE_PENDIENTES)

  if (error) {
    console.error("[gmail] no se pudieron leer los correos pendientes:", error.message)
    return []
  }
  return (data ?? []).map((fila) => aCorreo(fila as FilaCruda))
}

/**
 * Los correos ya resueltos (ingresados o descartados), para que la persona
 * pueda ver en qué terminó cada cosa. Se muestran los últimos, no todos: es
 * una lista de "qué pasó", no un archivo histórico.
 */
export async function listarCorreosResueltos(
  supabase: SupabaseClient<Database>,
): Promise<CorreoDeGmail[]> {
  const { data, error } = await supabase
    .from("gmail_messages")
    .select(COLUMNAS)
    .neq("status", "pendiente_revision")
    .order("resolved_at", { ascending: false, nullsFirst: false })
    .limit(LIMITE_RESUELTOS)

  if (error) {
    console.error("[gmail] no se pudieron leer los correos ya procesados:", error.message)
    return []
  }
  return (data ?? []).map((fila) => aCorreo(fila as FilaCruda))
}

/**
 * Los correos que entraron SOLOS al historial (Sprint 17), del más reciente al
 * más viejo.
 *
 * Es una lista aparte de `listarCorreosResueltos` a propósito, aunque los dos
 * lean la misma tabla: lo que entró solo NO va plegado dentro de "correos que
 * ya revisaste" —porque la persona no los revisó— sino en su propia sección
 * visible, con el botón de deshacer al lado. Esconder detrás de un `<details>`
 * lo único que la app hizo por su cuenta sería exactamente al revés de lo que
 * corresponde.
 */
export async function listarCorreosAutoCargados(
  supabase: SupabaseClient<Database>,
): Promise<CorreoDeGmail[]> {
  const { data, error } = await supabase
    .from("gmail_messages")
    .select(COLUMNAS)
    .not("auto_ingested_at", "is", null)
    .order("auto_ingested_at", { ascending: false })
    .limit(LIMITE_AUTO_CARGADOS)

  if (error) {
    console.error("[gmail] no se pudieron leer los correos cargados solos:", error.message)
    return []
  }
  return (data ?? []).map((fila) => aCorreo(fila as FilaCruda))
}

/**
 * Cuántos estudios y turnos entraron solos en los últimos días. Lo usa la card
 * de `/inicio`.
 *
 * La ventana existe porque el contador responde a "¿qué pasó mientras no
 * miraba?", no a "¿cuántos entraron solos desde siempre": un número que solo
 * crece dejaría de ser una novedad a la semana de prender el interruptor.
 */
export async function contarAutoCargadosRecientes(
  supabase: SupabaseClient<Database>,
  dias = DIAS_AUTO_CARGA_RECIENTE,
): Promise<number> {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

  const { count, error } = await supabase
    .from("gmail_messages")
    .select("id", { count: "exact", head: true })
    .not("auto_ingested_at", "is", null)
    .gte("auto_ingested_at", desde)

  if (error) {
    console.error("[gmail] no se pudieron contar los correos cargados solos:", error.message)
    return 0
  }
  return count ?? 0
}

/**
 * Cuántos correos esperan revisión. Lo usa la card de `/inicio` para mostrar
 * el contador, con `head: true` para no traer ni una fila: en una pantalla que
 * ya hace varias consultas, esta tiene que costar lo mínimo.
 */
export async function contarCorreosPendientes(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { count, error } = await supabase
    .from("gmail_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "pendiente_revision")

  if (error) {
    console.error("[gmail] no se pudo contar los correos pendientes:", error.message)
    return 0
  }
  return count ?? 0
}

export interface FiltroAprendido {
  id: string
  remitente: string
  creadoEl: string
}

/** Los filtros que la app creó en el Gmail de esta cuenta. */
export async function listarFiltrosAprendidos(
  supabase: SupabaseClient<Database>,
): Promise<FiltroAprendido[]> {
  const { data, error } = await supabase
    .from("gmail_filters")
    .select("id, from_email, created_at")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[gmail] no se pudieron leer los filtros aprendidos:", error.message)
    return []
  }

  return (data ?? []).map((fila) => ({
    id: fila.id,
    remitente: fila.from_email,
    creadoEl: fila.created_at,
  }))
}
