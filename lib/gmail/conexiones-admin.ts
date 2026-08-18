import "server-only"

/**
 * Persistencia de la conexión de Gmail — EXCLUSIVAMENTE SERVIDOR
 * (Sprint 17, tarea 17.1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. Mismo contrato que
 *      `lib/storage-admin.ts`, `lib/auth/cuentas-admin.ts` y
 *      `lib/medicacion/generar-tomas-admin.ts`: jamás se importa desde código
 *      cliente. El módulo aborta al cargarse si detecta un navegador.
 *
 *      Acá el motivo es todavía más directo que en los otros tres: este
 *      archivo es el único lugar del proyecto por el que pasa, en texto claro
 *      y en memoria, el `refresh_token` de la casilla de una persona.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué service_role y no el cliente del usuario
 *
 * `authenticated` no tiene -y no debe tener- EXECUTE sobre
 * `guardar_conexion_gmail` / `leer_refresh_token_gmail` ni escritura sobre
 * `gmail_connections` (`20260818130000_gmail_conexiones.sql` §2 y §3). El
 * token vive en el Vault, que ni `anon` ni `authenticated` pueden mirar. La
 * única forma de tocarlo es esta, desde el servidor, después de que el Route
 * Handler o la Server Action ya verificaron la sesión.
 *
 * **ESTE MÓDULO NO AUTORIZA NADA**: recibe un `userId` y hace lo que le
 * piden. Quien llama es responsable de haber comprobado que ese `userId` es
 * el de la sesión en curso — nunca uno que venga de un formulario, de una
 * query o del `state` sin cotejar contra `auth.getUser()`.
 *
 * ## El access token no se guarda
 *
 * Dura una hora. Se pide fresco cada vez y se recuerda en memoria del proceso
 * hasta un minuto antes de vencer (`cacheAccessTokens`): en un barrido que
 * hace varias llamadas seguidas eso ahorra viajes, y si la instancia se
 * recicla no se pierde nada porque el refresh token sigue en el Vault.
 * Escribirlo en la base sería sumar una copia más de una credencial viva a
 * cambio de nada.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { obtenerCredencialesGoogle } from "@/lib/gmail/credenciales"
import { ErrorGmail, refrescarAccessToken, type OpcionesBases } from "@/lib/gmail/google-api"
import type { Database } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/gmail/conexiones-admin.ts se importó desde el navegador. Este módulo usa la " +
      "SERVICE_ROLE_KEY y el refresh token de Gmail: sólo puede ejecutarse en el servidor.",
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

export interface DatosDeConexion {
  userId: string
  email: string
  refreshToken: string
  labelId: string | null
  labelName: string
  scopes: string | null
}

/**
 * Guarda (o reconecta) la casilla. Cifra el token en el Vault y deja el estado
 * en `gmail_connections`, todo en la misma transacción de la base.
 */
export async function guardarConexionGmail(datos: DatosDeConexion): Promise<void> {
  const { error } = await clienteAdmin().rpc("guardar_conexion_gmail", {
    p_usuario: datos.userId,
    p_email: datos.email,
    p_refresh_token: datos.refreshToken,
    p_label_id: datos.labelId ?? "",
    p_label_name: datos.labelName,
    p_scopes: datos.scopes ?? "",
  })

  if (error) {
    // El mensaje de Postgres puede traer el nombre del secreto; nunca su
    // contenido (la función no lo devuelve ni lo imprime). Aun así se resume.
    throw new Error(`No se pudo guardar la conexión de Gmail: ${error.message}`)
  }
}

/** Borra la fila y el secreto del Vault. Idempotente. */
export async function borrarConexionGmail(userId: string): Promise<void> {
  const { error } = await clienteAdmin().rpc("borrar_conexion_gmail", { p_usuario: userId })
  if (error) {
    throw new Error(`No se pudo borrar la conexión de Gmail: ${error.message}`)
  }
}

/** Descifra el refresh token. `null` si esa cuenta no tiene conexión. */
export async function leerRefreshTokenGmail(userId: string): Promise<string | null> {
  const { data, error } = await clienteAdmin().rpc("leer_refresh_token_gmail", {
    p_usuario: userId,
  })
  if (error) {
    throw new Error(`No se pudo leer la conexión de Gmail: ${error.message}`)
  }
  return typeof data === "string" && data.length > 0 ? data : null
}

export interface ConexionConectada {
  userId: string
  email: string
  /** `null` si la etiqueta no se pudo resolver al conectar: esa conexión no se puede barrer. */
  labelId: string | null
}

/**
 * Las conexiones VIVAS, para el barrido periódico (Sprint 17, tarea 17.2).
 *
 * Va con `service_role` porque el cron no tiene sesión de nadie: lo llama
 * `pg_cron` y este proceso resuelve todas las casillas conectadas de la
 * instalación. Es la única lectura del proyecto que cruza cuentas, y por eso
 * está acotada a las tres columnas que el barrido necesita —ni `granted_scopes`
 * ni `token_secret_id`— y ordenada por `last_ok_at` con los nulos primero: si
 * una corrida no llegara a todas, la próxima empieza por las que hace más que
 * no se revisan.
 *
 * Las `vencidas` quedan afuera: sin refresh token válido, intentarlas sería
 * gastar una llamada a Google para que conteste `invalid_grant` otra vez.
 */
export async function listarConexionesConectadas(limite = 100): Promise<ConexionConectada[]> {
  const { data, error } = await clienteAdmin()
    .from("gmail_connections")
    .select("user_id, email, label_id")
    .eq("status", "conectada")
    .order("last_ok_at", { ascending: true, nullsFirst: true })
    .limit(limite)

  if (error) {
    throw new Error(`No se pudieron listar las conexiones de Gmail: ${error.message}`)
  }

  return (data ?? []).map((fila) => ({
    userId: fila.user_id,
    email: fila.email,
    labelId: fila.label_id,
  }))
}

/** Marca la conexión como vencida (Google contestó `invalid_grant`). */
export async function marcarConexionVencida(userId: string): Promise<void> {
  const { error } = await clienteAdmin().rpc("marcar_conexion_gmail_vencida", {
    p_usuario: userId,
  })
  if (error) {
    // No se propaga: quien llama ya está manejando un vencimiento y lo que
    // importa es que la persona vea "reconectá", no que además se rompa.
    console.error("[gmail] no se pudo marcar la conexión como vencida:", error.message)
  }
}

/** Deja constancia de que Google respondió bien recién. */
export async function marcarConexionActiva(userId: string): Promise<void> {
  const { error } = await clienteAdmin().rpc("marcar_conexion_gmail_activa", {
    p_usuario: userId,
  })
  if (error) {
    console.error("[gmail] no se pudo actualizar el latido de la conexión:", error.message)
  }
}

/** No hay ninguna casilla conectada para esa cuenta. */
export class ErrorSinConexionGmail extends Error {
  constructor() {
    super("Todavía no conectaste tu Gmail.")
    this.name = "ErrorSinConexionGmail"
  }
}

/**
 * El permiso venció o fue revocado. La conexión ya quedó marcada `vencida` en
 * la base: la pantalla ofrece reconectar de un toque.
 */
export class ErrorConexionGmailVencida extends Error {
  constructor() {
    super("Se venció el permiso para leer tu Gmail. Volvé a conectarlo cuando quieras.")
    this.name = "ErrorConexionGmailVencida"
  }
}

/** Las credenciales de Google no están cargadas en este entorno. */
export class ErrorGmailSinConfigurar extends Error {
  constructor() {
    super("La conexión con Gmail todavía no está configurada en este entorno.")
    this.name = "ErrorGmailSinConfigurar"
  }
}

interface EntradaCache {
  accessToken: string
  /** Momento (epoch ms) a partir del cual esta entrada deja de servir. */
  venceEnMs: number
}

/**
 * Cache de access tokens por cuenta, en memoria del proceso.
 *
 * Es a propósito un `Map` y no una tabla: los access tokens duran una hora y
 * no sobreviven a un reciclado de la instancia, que es exactamente lo que se
 * quiere de una credencial viva. El margen de 60 segundos evita el caso feo de
 * usar un token que vence en el viaje.
 */
const cacheAccessTokens = new Map<string, EntradaCache>()
const MARGEN_VENCIMIENTO_MS = 60_000

/**
 * Devuelve un access token de Gmail listo para usar, refrescándolo si hace
 * falta. **Es el punto de entrada de la tarea 17.2.**
 *
 * Modos de falla, todos tipados y todos en castellano:
 *
 * - `ErrorGmailSinConfigurar` — faltan `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
 * - `ErrorSinConexionGmail` — esa cuenta nunca conectó (o ya desconectó).
 * - `ErrorConexionGmailVencida` — Google dijo `invalid_grant`. **Antes de
 *   lanzar, deja la conexión marcada `vencida`**, que es lo que hace que la
 *   pantalla pueda decir "se venció, tocá acá" en vez de "no tenés nada".
 *   Este es el caso ESPERADO mientras la pantalla de consentimiento siga "En
 *   prueba": Google caduca los refresh tokens a los 7 días. No es un bug, es
 *   el modo prueba, y se maneja con gracia hasta que el usuario toque
 *   "Publicar aplicación".
 * - `ErrorGmail` — cualquier otro problema de red o de respuesta de Google.
 */
export async function obtenerAccessTokenGmail(
  userId: string,
  opciones?: OpcionesBases & { ahoraMs?: number },
): Promise<string> {
  const ahora = opciones?.ahoraMs ?? Date.now()

  const enCache = cacheAccessTokens.get(userId)
  if (enCache && enCache.venceEnMs > ahora) {
    return enCache.accessToken
  }

  const credenciales = obtenerCredencialesGoogle()
  if (!credenciales) {
    throw new ErrorGmailSinConfigurar()
  }

  const refreshToken = await leerRefreshTokenGmail(userId)
  if (!refreshToken) {
    throw new ErrorSinConexionGmail()
  }

  let fresco
  try {
    fresco = await refrescarAccessToken(
      {
        refreshToken,
        clientId: credenciales.clientId,
        clientSecret: credenciales.clientSecret,
      },
      opciones,
    )
  } catch (error) {
    if (error instanceof ErrorGmail && error.codigo === "permiso_vencido") {
      cacheAccessTokens.delete(userId)
      await marcarConexionVencida(userId)
      throw new ErrorConexionGmailVencida()
    }
    throw error
  }

  cacheAccessTokens.set(userId, {
    accessToken: fresco.accessToken,
    venceEnMs: ahora + Math.max(fresco.expiraEn * 1000 - MARGEN_VENCIMIENTO_MS, 0),
  })

  await marcarConexionActiva(userId)

  return fresco.accessToken
}

/**
 * Olvida el access token cacheado de una cuenta. La llama la desconexión: si
 * la persona desconecta y vuelve a conectar en el mismo minuto, no tiene que
 * quedar un token de la conexión anterior dando vueltas en memoria.
 */
export function olvidarAccessTokenGmail(userId: string): void {
  cacheAccessTokens.delete(userId)
}
