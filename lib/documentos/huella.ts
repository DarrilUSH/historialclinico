import "server-only"

/**
 * La huella digital de un documento: hash de sus BYTES y cotejo contra lo que
 * el perfil ya tiene cargado (hotfix de producto, Sprint 17 en vivo).
 *
 * ## Por qué existe
 *
 * El dedup de la ingesta de Gmail (`gmail_messages_unico_por_cuenta`,
 * `20260818140000`) compara MENSAJES, no ARCHIVOS: dos correos genuinamente
 * distintos -un reenvío "RV:" con segundos de diferencia sobre el original-
 * pueden traer exactamente el mismo PDF adjunto, y nada avisaba. Este módulo
 * es la capa que faltaba: compara CONTENIDO, no metadatos de sobre.
 *
 * ## Qué SÍ detecta y qué NO (léase antes de prometer nada en pantalla)
 *
 * `calcularHuellaSha256` hashea los bytes tal cual llegan. Dos archivos
 * BYTE A BYTE IDÉNTICOS -el mismo PDF adjunto dos veces, la misma foto
 * compartida dos veces- dan la misma huella. Un PDF que la clínica
 * REGENERA -mismo estudio, mismo texto, pero el motor que arma el PDF le puso
 * otra fecha de generación en los metadatos, o lo comprimió distinto- tiene
 * bytes distintos y NO matchea. No es un defecto que se pueda arreglar sin
 * cambiar de técnica (habría que comparar contenido semántico, no bytes), así
 * que se declara como límite y no como bug: `docs/gmail-ingesta.md`.
 *
 * ## Dónde vive el cotejo en cada camino de entrada
 *
 * Las tres puertas de `ingestarDocumento` (subida manual, Web Share Target,
 * adjunto de Gmail) llaman a `buscarDuplicadoPorHuella` DESDE ADENTRO de
 * `ingestarDocumento`, ANTES de subir nada a Storage y ANTES del `INSERT` en
 * `documents` -ver el bloque "EL COTEJO, PASO A PASO" en el encabezado de
 * `lib/documentos/ingesta.ts`-. Es el único punto en el que las tres puertas
 * ya tienen los bytes en la mano y todavía no crearon nada, así que es el
 * único lugar que hace falta tocar.
 */

import { createHash } from "node:crypto"

import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"

/** Un documento existente que coincide en huella con el archivo que se está por cargar. */
export interface DuplicadoDetectado {
  documentoId: string
  /** Título tal como está guardado hoy (puede ser el provisional, o el que la persona confirmó). */
  titulo: string
  /** `document_date`, formato `YYYY-MM-DD`. */
  fecha: string
}

/**
 * `document_date` en UTC a propósito -mismo motivo que
 * `lib/estudios/agrupacion.ts#FORMATO_PERIODO`-: es un `date` de Postgres sin
 * hora, y formatearlo en la zona de Ushuaia (-03) movería la fecha un día.
 */
const FORMATO_FECHA_DUPLICADO = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
})

/** "2026-08-18" -> "18 de agosto de 2026", para el aviso "cargado el …" de la franja de duplicado. */
export function formatearFechaDuplicado(fechaIso: string): string {
  return FORMATO_FECHA_DUPLICADO.format(new Date(`${fechaIso}T00:00:00Z`))
}

/**
 * SHA-256 de `bytes`, en hexadecimal minúscula (64 caracteres) — la misma
 * forma que exige el CHECK `documents_content_sha256_valido`
 * (`20260818150000_huella_documentos.sql`).
 *
 * Pura y sincrónica: `createHash().update().digest()` no vuelve a la red ni al
 * disco, así que no hace falta streaming aunque el archivo pese los 25 MB del
 * tope de `lib/archivos/validacion.ts#LIMITE_BYTES` — es la misma cantidad de
 * bytes que `ingestarDocumento` ya tiene enteros en memoria para subirlos a
 * Storage, un `Hash` de Node no agrega una copia significativa arriba de eso.
 */
export function calcularHuellaSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/**
 * ¿El perfil `perfilId` ya tiene un documento con la huella `huella`?
 *
 * Va con el cliente del USUARIO -no el admin-: es una lectura de
 * `documents`, y la política `documents_select_puede_ver` (`puede_ver_perfil`)
 * ya es exactamente la autorización que corresponde acá. No hace falta ninguna
 * política nueva (ver el encabezado de la migración).
 *
 * "NO descartados": en este esquema un documento descartado ES una fila
 * borrada (`descartar_documento_recien_subido`, `20260813010000`) — no hay una
 * columna de estado que filtrar. Toda fila que SELECT devuelve ya es, por
 * construcción, un documento vigente.
 *
 * Si hay más de un documento con la misma huella (la persona ya cargó el
 * mismo archivo dos veces antes de que existiera este cotejo, o lo cargó a
 * propósito con "Cargar igual"), se ofrece el MÁS VIEJO: es el que con más
 * probabilidad la persona reconoce como "el original".
 */
export async function buscarDuplicadoPorHuella(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
  huella: string,
): Promise<DuplicadoDetectado | null> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, document_date")
    .eq("profile_id", perfilId)
    .eq("content_sha256", huella)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`No se pudo cotejar la huella del archivo: ${error.message}`)
  }
  if (!data) return null

  return { documentoId: data.id, titulo: data.title, fecha: data.document_date }
}
