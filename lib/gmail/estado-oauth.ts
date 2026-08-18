/**
 * `state` anti-CSRF del flujo OAuth de Gmail (Sprint 17, tarea 17.1).
 *
 * ## Qué ataque previene, exactamente
 *
 * Sin `state`, `GET /api/gmail/callback?code=...` acepta cualquier `code` que
 * le llegue. Un atacante que consiga un `code` de SU propia cuenta de Google
 * y logre que la víctima -con su sesión abierta en Historial Médico- visite
 * esa URL, deja la casilla del ATACANTE conectada a la cuenta de la víctima.
 * A partir de ahí, todo lo que la 17.2 importe "desde el Gmail de la persona"
 * sale en realidad de una casilla que controla otro. Es el login CSRF clásico
 * de OAuth, y es la razón por la que el parámetro existe en el estándar.
 *
 * ## Cómo se resuelve acá: cookie firmada + nonce opaco
 *
 * Al empezar (`/api/gmail/conectar`) se generan 32 bytes aleatorios (el
 * `nonce`) y se arma un sobre firmado con HMAC-SHA256 que lleva, además del
 * nonce, **de qué cuenta es este intento**, **a qué `redirect_uri` va** y
 * **cuándo caduca**. El sobre entero viaja en una cookie `httpOnly` y a
 * Google se le manda ÚNICAMENTE el nonce como `state`.
 *
 * Esa separación es deliberada: el `state` aparece en la barra de
 * direcciones, en el historial del navegador, en el `Referer` y en los logs
 * de Google. Un nonce opaco no dice nada ahí; un JSON con el `user_id` de la
 * persona, sí.
 *
 * Al volver, el callback exige las cuatro cosas: que la firma valide (nadie
 * fabricó el sobre), que no esté vencido, que el nonce del sobre sea igual al
 * `state` que trajo Google (la cookie y la vuelta son del MISMO intento) y
 * -esto ya fuera de este módulo- que la sesión activa sea la misma cuenta que
 * dice el sobre.
 *
 * ## Por qué la clave del HMAC es `GOOGLE_CLIENT_SECRET`
 *
 * Porque no introduce ningún secreto nuevo. Este flujo ya es imposible sin
 * `GOOGLE_CLIENT_SECRET` -sin él no hay intercambio de `code` por tokens-, así
 * que usarlo como clave de firma no agrega ni una variable de entorno más que
 * cargar en `.env.local` y en Vercel, ni un modo de falla nuevo: si falta, el
 * flujo entero ya estaba roto. La alternativa -una `GMAIL_STATE_SECRET`
 * aparte- daría separación criptográfica de manual pero viviría en el mismo
 * archivo y en el mismo panel que la que ya está, o sea que en la práctica
 * comparte exactamente el mismo destino si alguna se filtra.
 *
 * ## Módulo puro a propósito
 *
 * No importa `next/headers`, ni Supabase, ni toca la red: solo `node:crypto`.
 * Eso lo hace verificable sin levantar nada (`tests/unit/gmail-estado-oauth.test.ts`),
 * igual que `lib/auth/rutas.ts`.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

/** Nombre de la cookie que guarda el sobre firmado. */
export const COOKIE_ESTADO_GMAIL = "gmail_oauth_estado"

/**
 * Vida del intento, en milisegundos. Diez minutos alcanzan de sobra para leer
 * la pantalla de consentimiento de Google, elegir la cuenta y aceptar -incluso
 * despacio, que es el ritmo para el que está pensada esta app-, y son lo
 * bastante poco como para que un sobre robado del disco no sirva mañana.
 */
export const VIDA_ESTADO_MS = 10 * 60 * 1000

/** Bytes de aleatoriedad del nonce. 32 = 256 bits, el mismo piso que un token de sesión. */
const BYTES_NONCE = 32

/** Lo que el sobre firmado lleva adentro. Claves cortas: la cookie viaja en cada request de `/api/gmail`. */
interface CargaEstado {
  /** Nonce opaco. Es lo único que se le manda a Google como `state`. */
  n: string
  /** Cuenta (`auth.users.id`) que inició este intento. */
  u: string
  /** `redirect_uri` exacto con el que se pidió el consentimiento. */
  r: string
  /** Vencimiento, en milisegundos epoch. */
  e: number
}

export interface EstadoCreado {
  /** El valor que va como `state` en la URL de Google. */
  nonce: string
  /** El sobre firmado que va en la cookie `httpOnly`. */
  cookie: string
  /** Vencimiento en milisegundos epoch (para el `Max-Age` de la cookie). */
  venceEn: number
}

export type MotivoEstadoInvalido =
  /** No llegó la cookie (expiró, se limpió el navegador, o el callback se visitó a mano). */
  | "sin_cookie"
  /** El sobre no tiene la forma `carga.firma` o no es JSON con los campos esperados. */
  | "formato_invalido"
  /** La firma no valida: el sobre fue alterado o lo fabricó otro. */
  | "firma_invalida"
  /** Pasaron más de `VIDA_ESTADO_MS`. */
  | "vencido"
  /** El `state` que trajo Google no es el nonce del sobre: son dos intentos distintos. */
  | "nonce_no_coincide"

export type ResultadoEstado =
  | { valido: true; userId: string; redirectUri: string }
  | { valido: false; motivo: MotivoEstadoInvalido }

function base64url(dato: Buffer): string {
  return dato.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function desdeBase64url(valor: string): Buffer {
  const normalizado = valor.replace(/-/g, "+").replace(/_/g, "/")
  return Buffer.from(normalizado, "base64")
}

function firmar(carga: string, secreto: string): string {
  return base64url(createHmac("sha256", secreto).update(carga).digest())
}

/**
 * Comparación en tiempo constante de dos cadenas.
 *
 * `timingSafeEqual` exige buffers del mismo largo -si difieren lanza-, así que
 * el largo se compara antes. Eso filtra el largo por temporización, que no es
 * un secreto acá (firma HMAC-SHA256: siempre 43 caracteres; nonce: siempre 43).
 */
function igualEnTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8")
  const bb = Buffer.from(b, "utf8")
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export interface OpcionesCrearEstado {
  /** Cuenta que inicia el intento. */
  userId: string
  /** `redirect_uri` exacto que se le va a declarar a Google. */
  redirectUri: string
  /** Clave del HMAC (`GOOGLE_CLIENT_SECRET`). */
  secreto: string
  /** Inyectable para las pruebas. Por defecto, ahora. */
  ahoraMs?: number
  /** Inyectable para las pruebas. Por defecto, `VIDA_ESTADO_MS`. */
  vidaMs?: number
}

/** Arma el par nonce (para Google) + sobre firmado (para la cookie). */
export function crearEstadoOauth(opciones: OpcionesCrearEstado): EstadoCreado {
  const { userId, redirectUri, secreto } = opciones
  const ahora = opciones.ahoraMs ?? Date.now()
  const vida = opciones.vidaMs ?? VIDA_ESTADO_MS
  const venceEn = ahora + vida

  const nonce = base64url(randomBytes(BYTES_NONCE))
  const carga: CargaEstado = { n: nonce, u: userId, r: redirectUri, e: venceEn }
  const cargaCodificada = base64url(Buffer.from(JSON.stringify(carga), "utf8"))

  return {
    nonce,
    cookie: `${cargaCodificada}.${firmar(cargaCodificada, secreto)}`,
    venceEn,
  }
}

export interface OpcionesVerificarEstado {
  /** Valor de la cookie `COOKIE_ESTADO_GMAIL`, o `null`/`undefined` si no llegó. */
  cookie: string | null | undefined
  /** El `state` que trajo Google en la query. */
  nonceRecibido: string | null | undefined
  /** Clave del HMAC (`GOOGLE_CLIENT_SECRET`). */
  secreto: string
  /** Inyectable para las pruebas. Por defecto, ahora. */
  ahoraMs?: number
}

/**
 * Valida el sobre contra el `state` que devolvió Google.
 *
 * Devuelve un motivo tipado en vez de lanzar: el callback tiene que poder
 * traducir cada caso a una frase en castellano y volver a la pantalla, no
 * imprimir un stack trace.
 */
export function verificarEstadoOauth(opciones: OpcionesVerificarEstado): ResultadoEstado {
  const { cookie, nonceRecibido, secreto } = opciones
  const ahora = opciones.ahoraMs ?? Date.now()

  if (typeof cookie !== "string" || cookie.length === 0) {
    return { valido: false, motivo: "sin_cookie" }
  }

  const separador = cookie.lastIndexOf(".")
  if (separador <= 0 || separador === cookie.length - 1) {
    return { valido: false, motivo: "formato_invalido" }
  }

  const cargaCodificada = cookie.slice(0, separador)
  const firmaRecibida = cookie.slice(separador + 1)

  // La firma se verifica ANTES de parsear la carga: nunca se le da de comer
  // JSON.parse a algo que no probó ser nuestro.
  if (!igualEnTiempoConstante(firmaRecibida, firmar(cargaCodificada, secreto))) {
    return { valido: false, motivo: "firma_invalida" }
  }

  let carga: CargaEstado
  try {
    const crudo: unknown = JSON.parse(desdeBase64url(cargaCodificada).toString("utf8"))
    if (typeof crudo !== "object" || crudo === null) {
      return { valido: false, motivo: "formato_invalido" }
    }
    const { n, u, r, e } = crudo as Partial<CargaEstado>
    if (
      typeof n !== "string" ||
      n.length === 0 ||
      typeof u !== "string" ||
      u.length === 0 ||
      typeof r !== "string" ||
      r.length === 0 ||
      typeof e !== "number" ||
      !Number.isFinite(e)
    ) {
      return { valido: false, motivo: "formato_invalido" }
    }
    carga = { n, u, r, e }
  } catch {
    return { valido: false, motivo: "formato_invalido" }
  }

  if (ahora > carga.e) {
    return { valido: false, motivo: "vencido" }
  }

  if (typeof nonceRecibido !== "string" || !igualEnTiempoConstante(nonceRecibido, carga.n)) {
    return { valido: false, motivo: "nonce_no_coincide" }
  }

  return { valido: true, userId: carga.u, redirectUri: carga.r }
}
