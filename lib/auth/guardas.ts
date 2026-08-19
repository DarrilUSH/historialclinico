import "server-only"

/**
 * Guardas de servidor: el punto donde una pantalla o una Server Action exige
 * sesión y permiso **antes** de tocar datos de salud.
 *
 * Reparto de responsabilidades (importa no confundirlo):
 *
 * - `proxy.ts` decide **a dónde va la persona**. Corre en el borde, mira la
 *   cookie y redirige. No autoriza nada.
 * - Estas guardas deciden **si la operación puede ocurrir**. Corren en el
 *   servidor, dentro del render o de la acción, y fallan con un error tipado.
 * - **RLS decide qué filas existen.** Es la última palabra y la única que no
 *   se puede saltear: aunque una guarda tuviera un bug, la base sigue
 *   filtrando (supabase/migrations/20260812220000_rls.sql).
 *
 * `requerirPermiso` no reimplementa la matriz de `docs/modelo-permisos.md`:
 * llama a las mismas funciones `SECURITY DEFINER` que usan las políticas RLS
 * (`puede_ver_perfil`, `puede_cargar_en_perfil`, `puede_administrar_perfil`).
 * Reescribir el predicado en TypeScript garantizaría que algún día la app y
 * la base opinen distinto; delegarlo hace imposible esa divergencia.
 *
 * Por qué existe la guarda si RLS ya filtra: RLS devuelve **cero filas**, que
 * es indistinguible de "no hay datos todavía". La guarda convierte eso en un
 * error claro y en español antes de gastar la consulta, y le da a la interfaz
 * algo que mostrar que no sea una pantalla vacía y ambigua.
 */

import { cache } from "react"
import { redirect } from "next/navigation"
import type { User } from "@supabase/supabase-js"

import { rutaDeLoginCon } from "@/lib/auth/rutas"
import { createClient } from "@/lib/supabase/server"
import type { VerboPermiso } from "@/types/dominio"

/** Cliente de Supabase de servidor, ya autenticado con las cookies de la request. */
export type ClienteSupabaseServidor = Awaited<ReturnType<typeof createClient>>

/** Qué hacer cuando la request no trae sesión. */
export type EstrategiaSinSesion =
  /** Interrumpe el render y manda a `/login` (Server Components). */
  | "redirigir"
  /** Lanza `ErrorSesionRequerida` para devolver un mensaje al formulario (Server Actions). */
  | "lanzar"

export type CodigoErrorGuarda =
  | "sesion_requerida"
  | "perfil_invalido"
  | "permiso_denegado"
  | "fallo_de_verificacion"

/** Error base de las guardas. Todos traen un mensaje mostrable en español. */
export class ErrorGuarda extends Error {
  readonly codigo: CodigoErrorGuarda

  constructor(codigo: CodigoErrorGuarda, mensaje: string) {
    super(mensaje)
    this.name = "ErrorGuarda"
    this.codigo = codigo
  }
}

export class ErrorSesionRequerida extends ErrorGuarda {
  constructor(mensaje = "Necesitás iniciar sesión para continuar.") {
    super("sesion_requerida", mensaje)
    this.name = "ErrorSesionRequerida"
  }
}

export class ErrorPerfilInvalido extends ErrorGuarda {
  constructor(mensaje = "El perfil indicado no es válido.") {
    super("perfil_invalido", mensaje)
    this.name = "ErrorPerfilInvalido"
  }
}

/**
 * Permiso denegado.
 *
 * **No distingue "el perfil no existe" de "no tenés permiso"**, por el
 * principio 3 de `docs/modelo-permisos.md`: contestar distinto convertiría a
 * esta guarda en un oráculo para averiguar qué perfiles existen en el
 * sistema. Las dos situaciones dan el mismo mensaje.
 */
export class ErrorPermisoDenegado extends ErrorGuarda {
  readonly verbo: VerboPermiso
  readonly perfilId: string

  constructor(verbo: VerboPermiso, perfilId: string) {
    super("permiso_denegado", MENSAJE_POR_VERBO[verbo])
    this.name = "ErrorPermisoDenegado"
    this.verbo = verbo
    this.perfilId = perfilId
  }
}

/** La base no pudo responder si hay permiso (red caída, función ausente, etc.). */
export class ErrorVerificacionPermiso extends ErrorGuarda {
  readonly causa?: string
  /**
   * `true` cuando el fallo es de los que se arreglan solos con el tiempo (red
   * caída, 5xx, desfasaje de reloj) y ya se reintentó una vez sin suerte.
   * `false` cuando es un fallo que reintentar no iba a arreglar (la función no
   * existe, la firma del token no valida).
   */
  readonly transitorio: boolean

  constructor(causa?: string, transitorio = false) {
    super(
      "fallo_de_verificacion",
      "No pudimos verificar tus permisos. Probá de nuevo en unos minutos.",
    )
    this.name = "ErrorVerificacionPermiso"
    this.causa = causa
    this.transitorio = transitorio
  }
}

const MENSAJE_POR_VERBO: Record<VerboPermiso, string> = {
  view: "No tenés permiso para ver los datos de este perfil.",
  upload: "No tenés permiso para cargar datos en este perfil.",
  manage: "No tenés permiso para administrar este perfil.",
}

/**
 * Función de la base que evalúa cada verbo. Son las mismas que usan las
 * políticas RLS como predicado, así que app y base no pueden divergir.
 */
const FUNCION_POR_VERBO = {
  view: "puede_ver_perfil",
  upload: "puede_cargar_en_perfil",
  manage: "puede_administrar_perfil",
} as const satisfies Record<VerboPermiso, string>

const PATRON_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ────────────────────────────────────────────────────────────────────────
 * Fallos transitorios de verificación
 *
 * ## Quién valida el token, y contra qué reloj (medido, no supuesto)
 *
 * El 2026-08-19 a las 13:22 `/estudios` devolvió un 500 en producción con
 * `causa: 'JWT issued at future'`. Ese mensaje NO lo emite ni
 * `@supabase/auth-js` ni el servidor de Auth: lo emite **PostgREST**, el
 * servicio que está atrás de `supabase.rpc(...)` y de cualquier `.from(...)`.
 *
 * La cadena de una request tiene DOS validadores de JWT, y solo uno mira el
 * `iat`:
 *
 *   1. `sesionDeLaRequest()` → `auth.getUser()` → `GET /auth/v1/user`.
 *      Lo valida **el servidor de Auth**, que NO chequea `iat`. Verificado
 *      contra el stack local (GoTrue v2.195.0): un token con `iat` una hora
 *      en el futuro pasa la validación y llega a consultar la base; uno con
 *      la firma rota corta antes con `403 bad_jwt`. Por eso el incidente NO
 *      terminó en un redirect a `/login`: la sesión se resolvió bien.
 *   2. `requerirPermiso()` → `supabase.rpc('puede_ver_perfil')` → PostgREST.
 *      Acá SÍ se comparan las claims temporales (`iat`, `nbf`, `exp`) contra
 *      **el reloj de PostgREST**, y acá fue donde reventó.
 *
 * ## Cuánta tolerancia hay, y por qué no la podemos subir
 *
 * Medido contra el PostgREST del stack local (v16.1, el mismo motor que
 * corre la Data API de Supabase Cloud), firmando tokens con `iat` desplazado
 * y bisecando el límite:
 *
 *   iat = ahora +30 s → 200
 *   iat = ahora +31 s → 401 `PGRST303` "JWT issued at future"
 *   exp = ahora −30 s → 200
 *   exp = ahora −31 s → 401 `PGRST303` "JWT expired"
 *
 * O sea: **PostgREST ya aplica exactamente 30 segundos de tolerancia de
 * reloj, en ambas direcciones.** No hay ningún `clockSkew` / `leeway` que
 * configurar del lado de la aplicación —la validación no ocurre en nuestro
 * proceso, ocurre dentro de un servicio administrado por Supabase— y el
 * margen que se pediría (30-60 s) ya está concedido en su mayor parte. Que
 * el error igual aparezca significa que el desfasaje real superó esos 30 s:
 * es un reloj que se corrigió de golpe del lado del servidor, no un
 * redondeo. Medido el 2026-08-19 con los headers `Date`, ya pasado el
 * incidente, Auth y Data API estaban a menos de 300 ms uno del otro y
 * ambos dentro de ~100 ms de dos referencias externas: el desfasaje es
 * TRANSITORIO, no una condición estable del proyecto.
 *
 * ## Lo que NO se hace, a propósito
 *
 * Forzar `auth.refreshSession()` al ver este error parece la solución
 * obvia —un token nuevo traería un `iat` nuevo— y es una trampa. Primero,
 * solo ayudaría si el reloj adelantado fuera el de Auth; si el atrasado es
 * el de PostgREST, un token más nuevo está MÁS en el futuro y empeora el
 * caso. Segundo, y decisivo: un Server Component no puede escribir cookies
 * (`lib/supabase/server.ts`), así que el refresh token rotado se perdería y
 * la próxima request presentaría el viejo. Arriesgar deslogueos para tapar
 * un hipo de reloj es peor que el hipo.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Código con el que PostgREST reporta que las claims TEMPORALES del JWT no
 * validan (`iat`/`nbf`/`exp`). Su primo `PGRST301` es el de las claims
 * estructurales —firma que no valida, token mal formado— y ese no se
 * reintenta: no se arregla esperando.
 */
const CODIGO_CLAIMS_TEMPORALES = "PGRST303"

/**
 * Los dos mensajes de `PGRST303` en los que **esperar sirve**: el token es
 * válido pero todavía no "empezó" para el reloj de PostgREST. `JWT expired`
 * comparte código y no entra acá: ese ya pasó, esperar solo lo empeora.
 */
const MENSAJES_DE_TOKEN_ADELANTADO = /JWT (issued at future|not yet valid)/i

export type MotivoTransitorio = "reloj" | "red" | "servidor"

/** Forma mínima de un error de PostgREST, para no atarse al tipo generado. */
interface ErrorConsulta {
  code?: string | null
  message?: string | null
}

/**
 * ¿Este fallo de la RPC de permisos se arregla solo con el tiempo?
 *
 * Se exporta para `tests/unit/guardas.test.ts`: es la frontera entre "esto
 * hay que reintentarlo" y "esto es un problema de verdad", y una frontera que
 * se ensancha sin querer convierte un bug real en un reintento silencioso.
 *
 * @param status Estado HTTP que devuelve `supabase.rpc(...)`. Es `0` cuando
 *   `fetch` ni siquiera llegó a tener respuesta (DNS, TCP, timeout).
 */
export function motivoTransitorio(
  error: ErrorConsulta | null | undefined,
  status?: number,
): MotivoTransitorio | null {
  if (!error) {
    return null
  }
  if (
    error.code === CODIGO_CLAIMS_TEMPORALES &&
    MENSAJES_DE_TOKEN_ADELANTADO.test(error.message ?? "")
  ) {
    return "reloj"
  }
  // `status: 0` es lo que pone `@supabase/postgrest-js` cuando el `fetch`
  // falló antes de haber respuesta (ver su `PostgrestBuilder`).
  if (status === 0) {
    return "red"
  }
  if (typeof status === "number" && status >= 500) {
    return "servidor"
  }
  return null
}

/**
 * Respiro entre el intento que falló y el único reintento.
 *
 * 400 ms es un número elegido por lo que cuesta, no por lo que cura: es el
 * tope de lo que se le puede sumar a una pantalla que ya está tardando sin
 * que la persona sienta que se colgó, y solo se paga en el camino de error
 * (el camino feliz no espera ni un milisegundo, así que la optimización de
 * ingreso del commit `fc6f4dc` queda intacta).
 *
 * Honestidad sobre qué cubre: para un hipo de red o un 5xx suelto, 400 ms
 * alcanzan de sobra. Para el desfasaje de reloj NO alcanzan casi nunca
 * —PostgREST ya perdona 30 s, así que un rechazo implica más de 30 s de
 * diferencia—, y por eso el arreglo de ese caso no es el reintento sino la
 * degradación digna: `app/(app)/error.tsx`. El reintento igual se hace,
 * porque es gratis y sí gana el borde (el desfasaje justo cruzando el
 * umbral mientras se corrige).
 *
 * Esperar más sería peor: cada segundo acá es un segundo de pantalla en
 * blanco para alguien que ya vio que algo no anda.
 */
const ESPERA_ANTES_DEL_REINTENTO_MS = 400

const dormir = (ms: number) => new Promise<void>((listo) => setTimeout(listo, ms))

/**
 * Decodifica el `iat` del access token y lo compara contra NUESTRO reloj.
 *
 * No participa de ninguna decisión: existe **solo para el log**. Cuando esto
 * vuelva a pasar, la línea de error va a traer el número exacto de segundos
 * de adelanto en vez de obligar a adivinar, que es justo lo que faltó para
 * diagnosticar el incidente del 2026-08-19. Nunca lanza y nunca imprime el
 * token.
 *
 * `getSession()` acá no sale a la red ni emite el aviso de "storage inseguro":
 * `sesionDeLaRequest()` ya corrió `getUser()` contra el servidor de Auth en
 * este mismo request, y `@supabase/auth-js` silencia el aviso después de eso.
 */
async function adelantoDelTokenEnSegundos(
  supabase: ClienteSupabaseServidor,
): Promise<number | null> {
  try {
    const { data } = await supabase.auth.getSession()
    const cuerpo = data.session?.access_token?.split(".")[1]
    if (!cuerpo) {
      return null
    }
    // `atob` en vez de `Buffer`: funciona igual en el runtime de Node y en el
    // del borde. El JWT viene en base64url, que hay que traducir a base64.
    const base64 = cuerpo.replace(/-/g, "+").replace(/_/g, "/")
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as {
      iat?: unknown
    }
    if (typeof claims.iat !== "number") {
      return null
    }
    return claims.iat - Math.floor(Date.now() / 1000)
  } catch {
    return null
  }
}

export interface SesionServidor {
  usuario: User
  supabase: ClienteSupabaseServidor
}

/**
 * La sesión de **esta** request, resuelta UNA sola vez.
 *
 * ## Por qué existe (P0 de rendimiento, 2026-08-18)
 *
 * `supabase.auth.getUser()` **siempre sale a la red**: `@supabase/auth-js`
 * lo implementa como un `GET /auth/v1/user` contra GoTrue en cada llamada,
 * a propósito, para no confiar en el JWT que vino en la cookie sin
 * verificarlo (ver `_getUser` en `node_modules/@supabase/auth-js`). No hay
 * ninguna caché adentro del cliente: dos `createClient()` distintos en el
 * mismo request son dos viajes de ida y vuelta.
 *
 * Y en este proyecto había cuatro por pantalla. Un `GET /inicio` resolvía la
 * misma sesión, contra el mismo token, cuatro veces:
 *
 * 1. `app/layout.tsx` → `obtenerTamano()`
 * 2. `app/(app)/layout.tsx` → `cuentaAceptoLegalesDeAlta()`
 * 3. `app/(app)/(con-nav)/layout.tsx` → `obtenerPerfilActivo()` → `requerirPermiso` → `requerirSesion()`
 * 4. `app/(app)/(con-nav)/inicio/page.tsx` → `requerirSesion()`
 *
 * Los layouts se resuelven en cadena (cada uno `await`ea antes de renderizar
 * al siguiente), así que los cuatro viajes eran **serie pura**. Medido contra
 * producción el 2026-08-18: la función de Vercel corre en `iad1` (Virginia) y
 * el proyecto de Supabase vive en `us-west-2` (Oregón) — costa a costa, entre
 * 90 y 150 ms por viaje. Cuatro `getUser()` idénticos eran ~440 ms de reloj
 * en cada navegación, y nadie los veía porque no fallan: solo tardan.
 *
 * Memoizar acá los colapsa a uno. Los otros tres pasan a costar cero.
 *
 * ## Por qué es correcto, y no solo rápido
 *
 * `cache()` de React es **por request**: Next.js lo aísla con
 * `AsyncLocalStorage`, así que dos personas navegando al mismo tiempo nunca
 * comparten esta entrada. No es un mecanismo nuevo ni una apuesta: es
 * exactamente el que ya usan `obtenerPerfilActivo` (`lib/perfil-activo.ts`) y
 * `cuentaAceptoLegalesDeAlta` (`lib/legales.ts`), que memoizan datos MÁS
 * sensibles que este —el perfil de otra persona, con sus permisos— desde el
 * Sprint 3.
 *
 * Dentro de un mismo request tampoco se pierde nada: el token es el mismo
 * (`proxy.ts` ya lo refrescó y lo fijó en `request.cookies` **antes** de que
 * cualquier Server Component corra), así que preguntar cuatro veces no podía
 * dar cuatro respuestas distintas. Lo único que agregaba era latencia.
 *
 * No memoiza autorización: `requerirPermiso` sigue consultando la base
 * (`puede_ver_perfil` y compañía) en cada llamada. Lo que se comparte es
 * "quién sos", no "qué podés hacer".
 */
export const sesionDeLaRequest = cache(
  async (): Promise<{ usuario: User | null; supabase: ClienteSupabaseServidor }> => {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    return { usuario: user, supabase }
  },
)

export interface OpcionesRequerirSesion {
  /** Por defecto `"redirigir"`. Las Server Actions suelen querer `"lanzar"`. */
  siNoHaySesion?: EstrategiaSinSesion
  /** Ruta a la que volver después del login. Se valida contra open redirect. */
  desde?: string
}

/**
 * Exige sesión y devuelve el usuario junto con el cliente de Supabase ya
 * autenticado, para que quien llama no tenga que instanciarlo de nuevo.
 *
 * ```ts
 * // Server Component
 * const { usuario, supabase } = await requerirSesion()
 *
 * // Server Action que quiere devolverle el error al formulario
 * const { supabase } = await requerirSesion({ siNoHaySesion: "lanzar" })
 * ```
 *
 * CUIDADO con `"redirigir"` dentro de un `try/catch`: `redirect()` funciona
 * lanzando una excepción interna de Next (`NEXT_REDIRECT`) que el framework
 * tiene que poder ver. Un `catch` que la trague deja la navegación colgada.
 * En bloques con `try/catch`, usá `"lanzar"`.
 */
export async function requerirSesion(
  opciones: OpcionesRequerirSesion = {},
): Promise<SesionServidor> {
  const { siNoHaySesion = "redirigir", desde } = opciones

  // Memoizada por request: ver `sesionDeLaRequest`. Antes esto abría un
  // cliente nuevo y salía a la red en cada llamada, y en una pantalla con
  // layout + página eso eran dos viajes idénticos a GoTrue.
  const { usuario: user, supabase } = await sesionDeLaRequest()

  if (!user) {
    if (siNoHaySesion === "lanzar") {
      throw new ErrorSesionRequerida()
    }
    redirect(rutaDeLoginCon(desde))
  }

  return { usuario: user, supabase }
}

export interface OpcionesRequerirPermiso extends OpcionesRequerirSesion {
  /**
   * Sesión ya resuelta por un `requerirSesion()` anterior. Pasarla evita un
   * `auth.getUser()` de más cuando una pantalla valida varios perfiles.
   */
  sesion?: SesionServidor
}

export interface PermisoConcedido extends SesionServidor {
  perfilId: string
  verbo: VerboPermiso
}

/**
 * Exige que la sesión actual pueda operar sobre `perfilId` con el verbo
 * pedido. Devuelve la sesión si puede; si no, lanza `ErrorPermisoDenegado`.
 *
 * ```ts
 * const { supabase } = await requerirPermiso(perfilId, "upload", {
 *   siNoHaySesion: "lanzar",
 * })
 * ```
 *
 * La ausencia de sesión sigue la estrategia de `opciones.siNoHaySesion`
 * (redirigir por defecto). La **denegación de permiso siempre lanza**: a
 * diferencia de "no iniciaste sesión", acá no hay una pantalla a la que
 * mandar a la persona que arregle la situación.
 */
export async function requerirPermiso(
  perfilId: string,
  verbo: VerboPermiso,
  opciones: OpcionesRequerirPermiso = {},
): Promise<PermisoConcedido> {
  // Se valida el formato antes de tocar la red: un `perfilId` que no es uuid
  // nunca va a existir en la base, y mandarlo produce un 400 de Postgres
  // (22P02) en vez de un error legible.
  if (!PATRON_UUID.test(perfilId)) {
    throw new ErrorPerfilInvalido()
  }

  const sesion =
    opciones.sesion ??
    (await requerirSesion({
      siNoHaySesion: opciones.siNoHaySesion,
      desde: opciones.desde,
    }))

  const preguntar = () =>
    sesion.supabase.rpc(FUNCION_POR_VERBO[verbo], { perfil: perfilId })

  let { data, error, status } = await preguntar()
  let motivo = motivoTransitorio(error, status)

  // Un fallo transitorio se reintenta UNA vez y nada más. Ver
  // `ESPERA_ANTES_DEL_REINTENTO_MS` para el porqué del número y para qué
  // cubre de verdad; el caso que no cubre lo atajan los `error.tsx`.
  if (motivo) {
    await dormir(ESPERA_ANTES_DEL_REINTENTO_MS)
    ;({ data, error, status } = await preguntar())
    motivo = motivoTransitorio(error, status)
  }

  if (error) {
    // Una sola línea con todo lo que hace falta para diagnosticar la próxima
    // vez: qué contestó PostgREST, si se reintentó, y —cuando el motivo es el
    // reloj— cuántos segundos de adelanto tenía el token contra nuestro reloj.
    // Nunca se registra el token ni ninguna claim más que `iat`.
    const adelanto = motivo === "reloj" ? await adelantoDelTokenEnSegundos(sesion.supabase) : null
    console.error(
      `[guardas] ${FUNCION_POR_VERBO[verbo]} no pudo responder ` +
        `(código ${error.code || "sin código"}, HTTP ${status}): ${error.message}` +
        (motivo ? ` — clasificado como transitorio (${motivo}), reintentado una vez sin suerte` : "") +
        (adelanto === null ? "" : ` — el iat del token está ${adelanto} s adelantado respecto de este servidor`),
    )
    throw new ErrorVerificacionPermiso(error.message, motivo !== null)
  }
  if (data !== true) {
    throw new ErrorPermisoDenegado(verbo, perfilId)
  }

  return { ...sesion, perfilId, verbo }
}

/** ¿El error viene de estas guardas? Útil en los `catch` de las Server Actions. */
export function esErrorDeGuarda(error: unknown): error is ErrorGuarda {
  return error instanceof ErrorGuarda
}
