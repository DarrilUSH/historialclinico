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
  "id, gmail_message_id, from_email, from_name, subject, message_date, kind, status, looks_like_appointment, attachments, document_id, appointment_id, detected_at, resolved_at"

/** Cuántos correos ya resueltos se muestran. Es historia reciente, no un archivo. */
const LIMITE_RESUELTOS = 20

/** Tope de pendientes que se listan de una vez. Con la tanda de 15 por pasada, es holgado. */
const LIMITE_PENDIENTES = 60

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
