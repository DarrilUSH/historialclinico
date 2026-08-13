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

  constructor(causa?: string) {
    super(
      "fallo_de_verificacion",
      "No pudimos verificar tus permisos. Probá de nuevo en unos minutos.",
    )
    this.name = "ErrorVerificacionPermiso"
    this.causa = causa
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

export interface SesionServidor {
  usuario: User
  supabase: ClienteSupabaseServidor
}

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

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

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

  const { data, error } = await sesion.supabase.rpc(FUNCION_POR_VERBO[verbo], {
    perfil: perfilId,
  })

  if (error) {
    throw new ErrorVerificacionPermiso(error.message)
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
