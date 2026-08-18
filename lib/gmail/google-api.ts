/**
 * Cliente REST de Google OAuth 2.0 + Gmail API (Sprint 17, tarea 17.1).
 *
 * ## Sin SDK, a propósito
 *
 * `googleapis` pesa decenas de megabytes y arrastra un generador de clientes
 * para 300 APIs que este proyecto no usa; `google-auth-library` es más chico
 * pero igual trae su propio manejo de credenciales, de reintentos y de cache.
 * Todo lo que hace falta acá son seis llamadas HTTP con `fetch`, que es
 * exactamente el criterio con el que ya se hablan Gemini
 * (`lib/gemini/`), FCM (`lib/push/`) y el portal del Ministerio
 * (`lib/lugares/`). Menos bundle, menos superficie y ninguna dependencia
 * nueva en un proyecto de costo cero.
 *
 * ## Módulo sin estado y sin secretos propios
 *
 * No lee `process.env`: las credenciales llegan por parámetro
 * (`lib/gmail/credenciales.ts` las resuelve). Y las URLs base son inyectables
 * -`OpcionesBases`- para que `tests/unit/gmail-oauth.test.ts` pueda apuntar
 * todo a un servidor `node:http` local y probar de verdad el éxito, el
 * `invalid_grant`, la etiqueta que ya existe y el color rechazado, sin tocar
 * internet ni la cuenta de nadie.
 */

/**
 * Los tres permisos que se piden, TODOS en la primera conexión.
 *
 * Pedirlos juntos es una decisión de producto: sumar un scope más adelante
 * obliga a mandar a la persona otra vez a la pantalla de consentimiento de
 * Google, y una segunda pantalla de permisos -en una app para adultos
 * mayores- es una oportunidad más de abandonar el flujo. La tarea 17.2 va a
 * necesitar los tres y no va a volver a pedir nada.
 *
 * - `gmail.readonly` — leer los mensajes de la etiqueta (17.2). Es el más
 *   amplio de los tres y el único que preocupa: técnicamente habilita a leer
 *   TODA la casilla. El compromiso del producto es leer solo la etiqueta, y
 *   se cumple en el código (`labelIds` en cada consulta) y está declarado en
 *   `docs/minimizacion-datos.md` §9. Google no ofrece un scope "solo esta
 *   etiqueta": `gmail.metadata` no deja ver el cuerpo ni los adjuntos, que es
 *   justo lo que hay que importar.
 * - `gmail.labels` — crear y consultar la etiqueta `historialmedico`. No da
 *   acceso a ningún mensaje.
 * - `gmail.settings.basic` — crear el filtro por remitente que archiva y
 *   etiqueta solo lo de las clínicas (17.2). No da acceso a ningún mensaje.
 */
export const SCOPES_GMAIL = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.settings.basic",
] as const

/** Nombre de la etiqueta que la app crea sola al conectar (pedido explícito del usuario). */
export const NOMBRE_ETIQUETA = "historialmedico"

/**
 * Color de la etiqueta. Gmail **no acepta cualquier hexadecimal**: la API
 * valida contra una paleta cerrada y devuelve `400 Invalid label color` con
 * cualquier valor de afuera. Este par (`#b6cff5` sobre `#0d3472`) es el azul
 * suave de la propia paleta de Gmail — discreto, legible, y no compite con las
 * etiquetas que la persona ya tenga. Aun así, `asegurarEtiqueta` reintenta sin
 * color si Google lo rechaza: la etiqueta importa, el color no.
 */
const COLOR_ETIQUETA = { backgroundColor: "#b6cff5", textColor: "#0d3472" } as const

/** URLs base. Se inyectan en las pruebas; en producción son las de Google. */
export interface OpcionesBases {
  /** `https://accounts.google.com` — la pantalla de consentimiento. */
  baseCuentas?: string
  /** `https://oauth2.googleapis.com` — token y revoke. */
  baseOauth?: string
  /** `https://gmail.googleapis.com` — la API de Gmail. */
  baseGmail?: string
}

const BASES_REALES = {
  baseCuentas: "https://accounts.google.com",
  baseOauth: "https://oauth2.googleapis.com",
  baseGmail: "https://gmail.googleapis.com",
} as const

function bases(opciones: OpcionesBases | undefined) {
  return {
    baseCuentas: opciones?.baseCuentas ?? BASES_REALES.baseCuentas,
    baseOauth: opciones?.baseOauth ?? BASES_REALES.baseOauth,
    baseGmail: opciones?.baseGmail ?? BASES_REALES.baseGmail,
  }
}

export type CodigoErrorGmail =
  /**
   * Google dice que el permiso ya no vale: la persona lo revocó desde su
   * cuenta, o pasaron los 7 días que dura un refresh token mientras la
   * pantalla de consentimiento está "En prueba". Es el ÚNICO error de esta
   * lista que no es una falla: es el ciclo de vida normal del modo prueba, y
   * la aplicación lo trata ofreciendo reconectar de un toque.
   */
  | "permiso_vencido"
  /** El `code` del callback ya se usó, venció, o no es de esta aplicación. */
  | "codigo_invalido"
  /** Google contestó, pero con un error que no es ninguno de los de arriba. */
  | "respuesta_de_google"
  /** No se pudo llegar a Google (red, DNS, timeout). */
  | "sin_conexion"

/** Error del circuito de Gmail, con el motivo tipado y un mensaje en castellano. */
export class ErrorGmail extends Error {
  readonly codigo: CodigoErrorGmail
  /** Detalle técnico para los logs. NUNCA se le muestra a la persona ni lleva tokens. */
  readonly detalle?: string

  constructor(codigo: CodigoErrorGmail, mensaje: string, detalle?: string) {
    super(mensaje)
    this.name = "ErrorGmail"
    this.codigo = codigo
    this.detalle = detalle
  }
}

/**
 * Los DOS `redirect_uri` registrados en el cliente OAuth del proyecto Google
 * `gen-lang-client-0873820464`. Están escritos acá, literales, porque Google
 * compara la cadena EXACTA: una barra de más, un `http` donde va `https` o el
 * dominio sin `www` producen `redirect_uri_mismatch` y ninguna otra pista.
 *
 * La consecuencia deliberada: en un deploy de PREVIEW de Vercel -que tiene un
 * hostname aleatorio- conectar Gmail no funciona, y la app lo dice con todas
 * las letras en vez de mandar a la persona a una pantalla de error de Google.
 * Registrar hostnames aleatorios no es posible; el flujo se prueba en local y
 * en producción.
 */
export const REDIRECT_URIS_REGISTRADOS = [
  "https://www.historialmedico.com.ar/api/gmail/callback",
  "http://localhost:3000/api/gmail/callback",
] as const

/** Ruta del callback, tal cual quedó registrada en Google. No se puede cambiar sin tocar la consola. */
export const RUTA_CALLBACK_GMAIL = "/api/gmail/callback"

/**
 * Devuelve el `redirect_uri` registrado que corresponde a este origen, o
 * `null` si el origen no es ninguno de los dos.
 *
 * Se resuelve por LISTA BLANCA y no armando la URL con el `Host` de la
 * request: un `Host` falsificado no puede hacer que la app le declare a Google
 * un destino que no sea uno de estos dos.
 */
export function redirectUriPara(origen: string): string | null {
  const candidato = `${origen.replace(/\/+$/, "")}${RUTA_CALLBACK_GMAIL}`
  return REDIRECT_URIS_REGISTRADOS.find((uri) => uri === candidato) ?? null
}

/**
 * El origen (`esquema://host`) desde el que llegó una request.
 *
 * Detrás de Vercel la request llega al proceso por HTTP, así que
 * `new URL(request.url).origin` diría `http://` en producción y el
 * `redirect_uri` no coincidiría con el registrado. Los headers `x-forwarded-*`
 * son la fuente correcta ahí. En local no existen y se cae al `Host` de
 * siempre.
 *
 * Que estos headers sean falsificables no abre nada: lo que salga de acá tiene
 * que pasar igual por `redirectUriPara`, que solo admite los dos valores
 * registrados en Google.
 */
export function origenDeLaRequest(request: Request): string {
  const url = new URL(request.url)
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host
  const protocolo =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    url.protocol.replace(/:$/, "")
  return `${protocolo}://${host}`
}

/**
 * URL de la pantalla de consentimiento de Google.
 *
 * - `access_type=offline` + `prompt=consent`: las dos juntas son lo que
 *   garantiza que venga un `refresh_token`. Con solo `offline`, Google lo
 *   manda **una única vez** -la primera que esa persona autoriza esta app- y
 *   en las reconexiones devuelve solo un access token; entonces reconectar
 *   después de desconectar dejaría una conexión que muere en una hora. El
 *   `prompt=consent` fuerza la pantalla completa cada vez y con ella el
 *   refresh token.
 * - `include_granted_scopes=true`: acumula con lo que la persona ya le haya
 *   dado a esta aplicación en vez de reemplazarlo.
 * - `login_hint` no se manda: si tiene dos cuentas de Google, tiene que poder
 *   elegir cuál conecta.
 */
export function urlDeConsentimiento(
  parametros: { clientId: string; redirectUri: string; state: string },
  opciones?: OpcionesBases,
): string {
  const url = new URL("/o/oauth2/v2/auth", bases(opciones).baseCuentas)
  url.searchParams.set("client_id", parametros.clientId)
  url.searchParams.set("redirect_uri", parametros.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", SCOPES_GMAIL.join(" "))
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("include_granted_scopes", "true")
  url.searchParams.set("state", parametros.state)
  return url.toString()
}

interface RespuestaToken {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function postearFormulario(
  url: string,
  campos: Record<string, string>,
): Promise<{ estado: number; cuerpo: RespuestaToken; texto: string }> {
  let respuesta: Response
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(campos).toString(),
      cache: "no-store",
    })
  } catch (causa) {
    throw new ErrorGmail(
      "sin_conexion",
      "No pudimos comunicarnos con Google. Fijate la conexión y probá de nuevo.",
      causa instanceof Error ? causa.message : String(causa),
    )
  }

  const texto = await respuesta.text()
  let cuerpo: RespuestaToken = {}
  try {
    cuerpo = texto.length > 0 ? (JSON.parse(texto) as RespuestaToken) : {}
  } catch {
    // Google contestó algo que no es JSON (una página de error del borde, por
    // ejemplo). Queda `cuerpo` vacío y el estado decide.
  }
  return { estado: respuesta.status, cuerpo, texto }
}

/**
 * Traduce el cuerpo de error del endpoint de token a un `ErrorGmail`.
 *
 * `invalid_grant` es el que importa: significa "ese permiso ya no vale". Google
 * lo usa para el `code` ya consumido, para el refresh token revocado y para el
 * refresh token vencido -los 7 días del modo prueba-. Quién llama sabe cuál de
 * los dos estaba mandando, así que el mapeo lo decide el parámetro `contexto`.
 */
function errorDeToken(
  cuerpo: RespuestaToken,
  estado: number,
  contexto: "intercambio" | "refresco",
): ErrorGmail {
  const codigoGoogle = cuerpo.error ?? `http_${estado}`
  const detalle = `${codigoGoogle}${cuerpo.error_description ? `: ${cuerpo.error_description}` : ""}`

  if (codigoGoogle === "invalid_grant") {
    return contexto === "refresco"
      ? new ErrorGmail(
          "permiso_vencido",
          "Se venció el permiso para leer tu Gmail. Volvé a conectarlo cuando quieras.",
          detalle,
        )
      : new ErrorGmail(
          "codigo_invalido",
          "El permiso que dio Google ya no es válido. Probá conectar de nuevo.",
          detalle,
        )
  }

  return new ErrorGmail(
    "respuesta_de_google",
    "Google no pudo completar la conexión. Probá de nuevo en un rato.",
    detalle,
  )
}

export interface TokensDeConexion {
  accessToken: string
  /**
   * `null` cuando Google no lo manda. No debería pasar con
   * `access_type=offline` + `prompt=consent`, pero si pasa hay que fallar
   * ruidosamente: guardar una conexión sin refresh token deja algo que
   * funciona una hora y después se rompe sin explicación.
   */
  refreshToken: string | null
  /** Segundos de vida del access token. */
  expiraEn: number
  /** Scopes concedidos de verdad, separados por espacios. */
  scopes: string | null
}

/** Intercambia el `code` del callback por tokens. El `client_secret` nunca sale del servidor. */
export async function intercambiarCodigo(
  parametros: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  opciones?: OpcionesBases,
): Promise<TokensDeConexion> {
  const { estado, cuerpo } = await postearFormulario(`${bases(opciones).baseOauth}/token`, {
    code: parametros.code,
    client_id: parametros.clientId,
    client_secret: parametros.clientSecret,
    redirect_uri: parametros.redirectUri,
    grant_type: "authorization_code",
  })

  if (estado < 200 || estado >= 300 || !cuerpo.access_token) {
    throw errorDeToken(cuerpo, estado, "intercambio")
  }

  return {
    accessToken: cuerpo.access_token,
    refreshToken: cuerpo.refresh_token ?? null,
    expiraEn: typeof cuerpo.expires_in === "number" ? cuerpo.expires_in : 3600,
    scopes: cuerpo.scope ?? null,
  }
}

export interface AccessTokenFresco {
  accessToken: string
  expiraEn: number
  scopes: string | null
}

/** Cambia el refresh token por un access token nuevo. Lanza `permiso_vencido` ante `invalid_grant`. */
export async function refrescarAccessToken(
  parametros: { refreshToken: string; clientId: string; clientSecret: string },
  opciones?: OpcionesBases,
): Promise<AccessTokenFresco> {
  const { estado, cuerpo } = await postearFormulario(`${bases(opciones).baseOauth}/token`, {
    refresh_token: parametros.refreshToken,
    client_id: parametros.clientId,
    client_secret: parametros.clientSecret,
    grant_type: "refresh_token",
  })

  if (estado < 200 || estado >= 300 || !cuerpo.access_token) {
    throw errorDeToken(cuerpo, estado, "refresco")
  }

  return {
    accessToken: cuerpo.access_token,
    expiraEn: typeof cuerpo.expires_in === "number" ? cuerpo.expires_in : 3600,
    scopes: cuerpo.scope ?? null,
  }
}

/**
 * Revoca el permiso contra Google. **No lanza nunca**: devuelve si se pudo o
 * no.
 *
 * Desconectar tiene que borrar la conexión local pase lo que pase. Si Google
 * está caído, o si el token ya estaba revocado desde la cuenta de la persona
 * (el `400` habitual), dejar la fila puesta le mostraría una conexión que ella
 * ya pidió cortar — que es peor que un permiso huérfano del lado de Google,
 * el cual además queda listado en su propia cuenta para sacarlo a mano.
 */
export async function revocarToken(token: string, opciones?: OpcionesBases): Promise<boolean> {
  try {
    const respuesta = await fetch(`${bases(opciones).baseOauth}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      cache: "no-store",
    })
    return respuesta.ok
  } catch {
    return false
  }
}

async function pedirGmail(
  ruta: string,
  accessToken: string,
  opciones: OpcionesBases | undefined,
  init?: { method?: string; cuerpo?: unknown },
): Promise<{ estado: number; datos: unknown; texto: string }> {
  let respuesta: Response
  try {
    respuesta = await fetch(`${bases(opciones).baseGmail}${ruta}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.cuerpo === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init?.cuerpo === undefined ? undefined : JSON.stringify(init.cuerpo),
      cache: "no-store",
    })
  } catch (causa) {
    throw new ErrorGmail(
      "sin_conexion",
      "No pudimos comunicarnos con Gmail. Fijate la conexión y probá de nuevo.",
      causa instanceof Error ? causa.message : String(causa),
    )
  }

  const texto = await respuesta.text()
  let datos: unknown = null
  try {
    datos = texto.length > 0 ? JSON.parse(texto) : null
  } catch {
    // Igual que arriba: si no es JSON, decide el estado.
  }
  return { estado: respuesta.status, datos, texto }
}

/**
 * Qué casilla se conectó.
 *
 * Se pregunta al perfil de Gmail (`users.getProfile`) y no al endpoint
 * `userinfo` de OpenID: `getProfile` ya está cubierto por `gmail.readonly` y
 * devuelve la dirección de LA CASILLA. Pedir `userinfo.email` obligaría a
 * sumar un scope más -y por lo tanto un renglón más en la pantalla de
 * consentimiento- para averiguar algo que además podría no coincidir con la
 * casilla que la persona eligió conectar.
 */
export async function obtenerCorreoConectado(
  accessToken: string,
  opciones?: OpcionesBases,
): Promise<string> {
  const { estado, datos, texto } = await pedirGmail("/gmail/v1/users/me/profile", accessToken, opciones)

  if (estado < 200 || estado >= 300) {
    throw new ErrorGmail(
      "respuesta_de_google",
      "Gmail no nos dijo qué casilla se conectó. Probá de nuevo en un rato.",
      `perfil http ${estado}: ${texto.slice(0, 200)}`,
    )
  }

  const correo = (datos as { emailAddress?: unknown } | null)?.emailAddress
  if (typeof correo !== "string" || correo.length === 0) {
    throw new ErrorGmail(
      "respuesta_de_google",
      "Gmail no nos dijo qué casilla se conectó. Probá de nuevo en un rato.",
      "perfil sin emailAddress",
    )
  }
  return correo
}

export interface EtiquetaGmail {
  id: string
  nombre: string
  /** `true` si esta llamada la creó; `false` si ya existía en la casilla. */
  creada: boolean
}

interface LabelApi {
  id?: unknown
  name?: unknown
}

function buscarEtiqueta(datos: unknown, nombre: string): { id: string; nombre: string } | null {
  const lista = (datos as { labels?: unknown } | null)?.labels
  if (!Array.isArray(lista)) return null

  // Gmail no admite dos etiquetas cuyos nombres difieran solo en mayúsculas,
  // así que la comparación va en minúsculas: si la persona ya tenía
  // "HistorialMedico", esa ES la etiqueta y crear otra fallaría con 409.
  const objetivo = nombre.toLowerCase()
  for (const cruda of lista as LabelApi[]) {
    if (typeof cruda?.id === "string" && typeof cruda?.name === "string") {
      if (cruda.name.toLowerCase() === objetivo) {
        return { id: cruda.id, nombre: cruda.name }
      }
    }
  }
  return null
}

/**
 * Deja la etiqueta `historialmedico` lista en la casilla: la busca y, si no
 * está, la crea.
 *
 * Tres caminos posibles y los tres terminan con un id guardado:
 *
 * 1. **Ya existe** (la persona la creó a mano, o reconectó): se usa la que hay.
 * 2. **No existe**: se crea con color. Si Google rechaza el color -su paleta es
 *    cerrada y puede cambiar-, se reintenta SIN color: la etiqueta es lo que
 *    importa.
 * 3. **Carrera**: entre el listado y el alta, otra pestaña la creó. Google
 *    contesta `409`; se vuelve a listar y se usa la que apareció.
 */
export async function asegurarEtiqueta(
  accessToken: string,
  opciones?: OpcionesBases,
  nombre: string = NOMBRE_ETIQUETA,
): Promise<EtiquetaGmail> {
  const listado = await pedirGmail("/gmail/v1/users/me/labels", accessToken, opciones)
  if (listado.estado < 200 || listado.estado >= 300) {
    throw new ErrorGmail(
      "respuesta_de_google",
      "No pudimos revisar las etiquetas de tu Gmail. Probá de nuevo en un rato.",
      `labels.list http ${listado.estado}: ${listado.texto.slice(0, 200)}`,
    )
  }

  const existente = buscarEtiqueta(listado.datos, nombre)
  if (existente) {
    return { ...existente, creada: false }
  }

  const cuerpoBase = {
    name: nombre,
    labelListVisibility: "labelShow",
    messageListVisibility: "show",
  }

  let alta = await pedirGmail("/gmail/v1/users/me/labels", accessToken, opciones, {
    method: "POST",
    cuerpo: { ...cuerpoBase, color: COLOR_ETIQUETA },
  })

  // Color rechazado: la paleta de Gmail es cerrada y no está versionada.
  // Reintento sin color antes de dar la conexión por fallida.
  if (alta.estado === 400) {
    alta = await pedirGmail("/gmail/v1/users/me/labels", accessToken, opciones, {
      method: "POST",
      cuerpo: cuerpoBase,
    })
  }

  // Carrera con otra pestaña (o con la propia persona creándola en Gmail
  // mientras consiente): la etiqueta existe, solo hay que ir a buscarla.
  if (alta.estado === 409) {
    const relistado = await pedirGmail("/gmail/v1/users/me/labels", accessToken, opciones)
    const aparecida = buscarEtiqueta(relistado.datos, nombre)
    if (aparecida) {
      return { ...aparecida, creada: false }
    }
  }

  if (alta.estado < 200 || alta.estado >= 300) {
    throw new ErrorGmail(
      "respuesta_de_google",
      `No pudimos crear la etiqueta "${nombre}" en tu Gmail. Probá de nuevo en un rato.`,
      `labels.create http ${alta.estado}: ${alta.texto.slice(0, 200)}`,
    )
  }

  const creada = alta.datos as LabelApi | null
  if (typeof creada?.id !== "string" || typeof creada?.name !== "string") {
    throw new ErrorGmail(
      "respuesta_de_google",
      `No pudimos crear la etiqueta "${nombre}" en tu Gmail. Probá de nuevo en un rato.`,
      "labels.create sin id/name",
    )
  }

  return { id: creada.id, nombre: creada.name, creada: true }
}
