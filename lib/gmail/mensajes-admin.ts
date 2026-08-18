import "server-only"

/**
 * Persistencia del registro de correos de Gmail — EXCLUSIVAMENTE SERVIDOR
 * (Sprint 17, tarea 17.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. Mismo contrato que
 *      `lib/gmail/conexiones-admin.ts`, `lib/storage-admin.ts` y
 *      `lib/auth/cuentas-admin.ts`: jamás se importa desde código cliente, y
 *      aborta al cargarse si detecta un navegador.
 *
 *      **ESTE MÓDULO NO AUTORIZA NADA.** Recibe un `userId` y hace lo que le
 *      piden. Quien llama es responsable de haber comprobado que ese `userId`
 *      es el de la sesión en curso. Para que esa responsabilidad no dependa
 *      solo de la disciplina de quien llame, TODAS las escrituras de acá
 *      abajo llevan `.eq("user_id", userId)` además del id de la fila: aunque
 *      alguien pasara un id de mensaje ajeno, la escritura no afecta ninguna
 *      fila.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué service_role y no el cliente del usuario
 *
 * `authenticated` tiene SELECT sobre sus propias filas y ningún privilegio de
 * escritura (`20260818140000_gmail_mensajes.sql` §3). La decisión está
 * argumentada ahí: la fila lleva punteros (`document_id`, `appointment_id`) que
 * el cliente no debe poder escribir a mano, y un solo camino de escritura es un
 * solo lugar que auditar.
 *
 * La LECTURA para las pantallas NO pasa por acá: va con el cliente del usuario
 * y por RLS, en `lib/gmail/mensajes.ts` — la regla de siempre del proyecto.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { AdjuntoGmail } from "@/lib/gmail/mensaje"
import type { Database, Json } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/gmail/mensajes-admin.ts se importó desde el navegador. Este módulo usa la " +
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

export type ClaseMensajeGmail = "documento" | "turno" | "nada"
export type EstadoMensajeGmail = "pendiente_revision" | "ingresado" | "descartado"

export interface MensajeParaRegistrar {
  userId: string
  gmailMessageId: string
  connectionEmail: string
  remitenteEmail: string
  remitenteNombre: string | null
  asunto: string | null
  fechaIso: string | null
  clase: ClaseMensajeGmail
  pareceTurno: boolean
  adjuntos: AdjuntoGmail[]
}

/**
 * Deja constancia de un correo recién mirado.
 *
 * Los de clase `nada` entran directamente como `descartado`: no hay nada que
 * ofrecerle a nadie, pero la fila TIENE que existir igual — es lo que impide
 * que la próxima pasada lo vuelva a bajar y a analizar. Los otros dos entran
 * como `pendiente_revision`.
 *
 * `onConflict` + `ignoreDuplicates`: dos pasadas simultáneas (el cron y un
 * "Buscar ahora" al mismo tiempo) pueden intentar registrar el mismo mensaje.
 * El UNIQUE `(user_id, gmail_message_id)` lo resuelve en la base y acá se
 * ignora en silencio, que es exactamente lo correcto: el registro ya está.
 */
export async function registrarMensajeProcesado(datos: MensajeParaRegistrar): Promise<void> {
  const resuelto = datos.clase === "nada"

  const { error } = await clienteAdmin()
    .from("gmail_messages")
    .upsert(
      {
        user_id: datos.userId,
        gmail_message_id: datos.gmailMessageId,
        connection_email: datos.connectionEmail,
        from_email: datos.remitenteEmail.length > 0 ? datos.remitenteEmail : "(sin remitente)",
        from_name: datos.remitenteNombre,
        subject: datos.asunto,
        message_date: datos.fechaIso,
        kind: datos.clase,
        looks_like_appointment: datos.pareceTurno,
        attachments: datos.adjuntos as unknown as Json,
        status: resuelto ? "descartado" : "pendiente_revision",
        resolved_at: resuelto ? new Date().toISOString() : null,
      },
      { onConflict: "user_id,gmail_message_id", ignoreDuplicates: true },
    )

  if (error) {
    throw new Error(`No se pudo registrar el correo ${datos.gmailMessageId}: ${error.message}`)
  }
}

/**
 * De una lista de ids de Gmail, cuáles YA están registrados para esa cuenta.
 *
 * Es el corazón del dedup y se resuelve con UNA consulta por pasada, no una
 * por mensaje: `in (...)` sobre el índice `gmail_messages_dedup_idx`.
 */
export async function idsYaProcesados(userId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()

  const { data, error } = await clienteAdmin()
    .from("gmail_messages")
    .select("gmail_message_id")
    .eq("user_id", userId)
    .in("gmail_message_id", ids)

  if (error) {
    throw new Error(`No se pudo consultar el registro de correos: ${error.message}`)
  }

  return new Set((data ?? []).map((fila) => fila.gmail_message_id))
}

/** La fila del registro, para las acciones que operan sobre un ítem concreto. */
export interface MensajeRegistrado {
  id: string
  gmailMessageId: string
  remitenteEmail: string
  remitenteNombre: string | null
  asunto: string | null
  clase: ClaseMensajeGmail
  estado: EstadoMensajeGmail
  pareceTurno: boolean
  adjuntos: AdjuntoGmail[]
  documentId: string | null
  appointmentId: string | null
}

function adjuntosDesdeJson(valor: Json | null): AdjuntoGmail[] {
  return Array.isArray(valor) ? (valor as unknown as AdjuntoGmail[]) : []
}

/**
 * Un mensaje del registro, **acotado a su dueño**. Devuelve `null` si no existe
 * o si es de otra cuenta: quien llama no puede distinguir los dos casos, mismo
 * principio 3 de `docs/modelo-permisos.md`.
 */
export async function obtenerMensajeRegistrado(
  userId: string,
  mensajeId: string,
): Promise<MensajeRegistrado | null> {
  const { data, error } = await clienteAdmin()
    .from("gmail_messages")
    .select(
      "id, gmail_message_id, from_email, from_name, subject, kind, status, looks_like_appointment, attachments, document_id, appointment_id",
    )
    .eq("id", mensajeId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`No se pudo leer el correo registrado: ${error.message}`)
  }
  if (!data) return null

  return {
    id: data.id,
    gmailMessageId: data.gmail_message_id,
    remitenteEmail: data.from_email,
    remitenteNombre: data.from_name,
    asunto: data.subject,
    clase: data.kind as ClaseMensajeGmail,
    estado: data.status as EstadoMensajeGmail,
    pareceTurno: data.looks_like_appointment,
    adjuntos: adjuntosDesdeJson(data.attachments),
    documentId: data.document_id,
    appointmentId: data.appointment_id,
  }
}

/**
 * Marca un correo como resuelto y, si corresponde, deja el puntero a lo que
 * produjo.
 *
 * Es idempotente y no pisa un puntero anterior con `null`: un correo que ya
 * había producido un documento y después se marca "descartado" conserva el
 * `document_id` -que es historia, no estado-.
 */
export async function marcarMensajeResuelto(
  userId: string,
  mensajeId: string,
  resultado: { estado: "ingresado" | "descartado"; documentId?: string; appointmentId?: string },
): Promise<void> {
  const cambios: Database["public"]["Tables"]["gmail_messages"]["Update"] = {
    status: resultado.estado,
    resolved_at: new Date().toISOString(),
    ...(resultado.documentId ? { document_id: resultado.documentId } : {}),
    ...(resultado.appointmentId ? { appointment_id: resultado.appointmentId } : {}),
  }

  const { error } = await clienteAdmin()
    .from("gmail_messages")
    .update(cambios)
    .eq("id", mensajeId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`No se pudo actualizar el correo: ${error.message}`)
  }
}

/**
 * Devuelve un correo ya resuelto a la bandeja de pendientes.
 *
 * Existe por un caso concreto: la persona toca "revisar", entra a la pantalla
 * de revisión del documento y ahí lo DESCARTA. El documento se borra y el
 * correo tiene que volver a la bandeja —si quedara marcado `ingresado`, el
 * adjunto sería irrecuperable desde la app sin volver a Gmail—.
 */
export async function devolverMensajeAPendiente(userId: string, mensajeId: string): Promise<void> {
  const { error } = await clienteAdmin()
    .from("gmail_messages")
    .update({ status: "pendiente_revision", resolved_at: null, document_id: null })
    .eq("id", mensajeId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`No se pudo devolver el correo a pendientes: ${error.message}`)
  }
}

/* ------------------------------------------------------------------ *
 *  Filtros aprendidos
 * ------------------------------------------------------------------ */

export interface FiltroParaRegistrar {
  userId: string
  gmailFilterId: string
  remitente: string
  labelId: string
  labelName: string
}

/**
 * Anota un filtro creado en Gmail. `upsert` por `(user_id, from_email)`: si la
 * persona toca dos veces "traer solos los de este remitente" -o si el filtro ya
 * existía en su Gmail y Google devolvió el que había-, la fila se pisa con el
 * id vigente en vez de fallar por el UNIQUE.
 */
export async function registrarFiltroAprendido(datos: FiltroParaRegistrar): Promise<void> {
  const { error } = await clienteAdmin()
    .from("gmail_filters")
    .upsert(
      {
        user_id: datos.userId,
        gmail_filter_id: datos.gmailFilterId,
        from_email: datos.remitente.trim().toLowerCase(),
        label_id: datos.labelId,
        label_name: datos.labelName,
      },
      { onConflict: "user_id,from_email" },
    )

  if (error) {
    throw new Error(`No se pudo registrar el filtro: ${error.message}`)
  }
}

export interface FiltroRegistrado {
  id: string
  gmailFilterId: string
  remitente: string
}

/** Un filtro propio por su id de fila. `null` si no existe o es de otra cuenta. */
export async function obtenerFiltroRegistrado(
  userId: string,
  filtroId: string,
): Promise<FiltroRegistrado | null> {
  const { data, error } = await clienteAdmin()
    .from("gmail_filters")
    .select("id, gmail_filter_id, from_email")
    .eq("id", filtroId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`No se pudo leer el filtro: ${error.message}`)
  }
  if (!data) return null

  return { id: data.id, gmailFilterId: data.gmail_filter_id, remitente: data.from_email }
}

/** Borra la fila del filtro. El borrado EN GMAIL lo hace quien llama, antes. */
export async function borrarFiltroRegistrado(userId: string, filtroId: string): Promise<void> {
  const { error } = await clienteAdmin()
    .from("gmail_filters")
    .delete()
    .eq("id", filtroId)
    .eq("user_id", userId)

  if (error) {
    throw new Error(`No se pudo borrar el filtro: ${error.message}`)
  }
}

/** Todos los filtros que la app creó para esa cuenta (los usa la desconexión). */
export async function listarFiltrosDeLaCuenta(userId: string): Promise<FiltroRegistrado[]> {
  const { data, error } = await clienteAdmin()
    .from("gmail_filters")
    .select("id, gmail_filter_id, from_email")
    .eq("user_id", userId)

  if (error) {
    throw new Error(`No se pudieron listar los filtros: ${error.message}`)
  }

  return (data ?? []).map((fila) => ({
    id: fila.id,
    gmailFilterId: fila.gmail_filter_id,
    remitente: fila.from_email,
  }))
}

/** ¿Ya hay un filtro aprendido para ese remitente? Lo usa la bandeja para no ofrecerlo de nuevo. */
export async function remitentesConFiltro(userId: string): Promise<Set<string>> {
  const filtros = await listarFiltrosDeLaCuenta(userId)
  return new Set(filtros.map((filtro) => filtro.remitente))
}
