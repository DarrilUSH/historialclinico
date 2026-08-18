import "server-only"

/**
 * Alta de cuentas por la Admin API de Supabase Auth — EXCLUSIVAMENTE SERVIDOR
 * (Sprint 15, tarea 15.2: graduación de perfiles gestionados).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. Mismo contrato que
 *      `lib/storage-admin.ts` y `lib/medicacion/generar-tomas-admin.ts`:
 *      jamás se importa desde código cliente -ni un Client Component, ni un
 *      hook, ni un archivo con "use client", ni nada que termine en el bundle
 *      del navegador-. El módulo aborta al cargarse si detecta que corre en un
 *      navegador (guarda de abajo).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  ESTE MÓDULO NO AUTORIZA NADA. `service_role` tiene BYPASSRLS: para ella no
 *  existe ninguna política de `20260812220000_rls.sql`. **Quien llama es
 *  responsable de haber verificado la autoridad antes**, y en este caso esa
 *  verificación es concreta y no negociable: `graduarPerfilGestionado`
 *  (`app/(app)/(con-nav)/familia/actions.ts`) exige
 *  `puede_graduar_perfil(perfilId)` -la función SECURITY DEFINER de
 *  `20260817230000_graduacion.sql`, evaluada EN LA BASE con la sesión del
 *  actor- antes de llamar acá.
 *
 * ## Por qué la Admin API y no `signUp`
 *
 * `signUp` crea la cuenta a nombre de quien la invoca y, con la confirmación
 * por correo encendida (producción), la deja pendiente hasta que alguien
 * toque el enlace. Ninguna de las dos cosas sirve para la graduación:
 *
 * 1. **La cuenta la crea un tercero.** Es la madre la que le da a su hijo su
 *    primera contraseña; el hijo todavía no tiene forma de recibir ni de
 *    confirmar nada por sí mismo (puede que ni siquiera tenga ese correo
 *    configurado en el teléfono todavía).
 * 2. **`signUp` desde el servidor pisaría la sesión en curso.** El cliente de
 *    `lib/supabase/server.ts` escribe cookies: un `signUp` con él dejaría a
 *    la madre logueada como su hijo, en el medio de la operación.
 * 3. **`options.data` de `signUp` no puede escribir `app_metadata`**, que es
 *    justamente de donde el trigger de alta lee el perfil a vincular (ver
 *    abajo).
 *
 * ## `app_metadata`, no `user_metadata`: el punto de seguridad
 *
 * El claim `perfil_existente` viaja en **`app_metadata`**. Es la única
 * metadata de GoTrue que el usuario NO puede escribir: solo la puebla la
 * Admin API (esta), `signUp` no la acepta y `updateUser` no la toca. Si el
 * trigger leyera el claim de `user_metadata` -que sí viaja en `options.data`
 * de `signUp`, o sea que la escribe cualquiera desde el navegador con la
 * clave anónima-, un `signUp` preparado con el uuid de un perfil gestionado
 * ajeno bastaría para adueñarse de su historial médico. El razonamiento
 * completo está en el encabezado de
 * `supabase/migrations/20260817230000_graduacion.sql`, y el BLOQUE 21 de
 * `scripts/test-rls.sql` prueba el intento hostil.
 *
 * ## Cuándo llega ese claim a la base (importa, y no es lo que parece)
 *
 * `createUser` **no** escribe el `app_metadata` propio en el mismo `INSERT`
 * que crea la fila de `auth.users`: lo agrega en un `UPDATE` posterior,
 * dentro de la misma transacción. Está medido —con triggers de diagnóstico
 * sobre `auth.users` que registraron `tg_op`, `txid_current()` y las dos
 * metadatas—; la traza completa está en el encabezado de la migración.
 *
 * La consecuencia de diseño es toda de la base y no cambia nada de este
 * módulo, pero conviene saberla antes de "simplificar" algo acá: la
 * graduación NO puede engancharse en el `AFTER INSERT` de `auth.users`,
 * porque en ese momento el claim todavía no está. Se engancha en el
 * `AFTER UPDATE OF raw_app_meta_data`. La primera versión de esta tarea
 * asumió lo contrario y el resultado, probado en un teléfono real, fue que la
 * cuenta se creaba, el perfil gestionado seguía sin dueño y la pantalla decía
 * "listo".
 *
 * ## `email_confirm: true`
 *
 * La cuenta nace con el correo dado por confirmado. Es deliberado y hace que
 * local y producción se comporten igual:
 *
 * - **Nadie tiene que confirmar nada.** La contraseña inicial la entrega en
 *   mano quien graduó; no hay ningún enlace que esperar, ni una cuenta que
 *   quede inutilizable si el correo cae en spam. Es la diferencia entre "tu
 *   hijo ya puede entrar" y "tu hijo va a poder entrar cuando encuentre un
 *   correo".
 * - **La verificación del correo no aporta acá lo que aporta en el registro
 *   público.** En `/registro` sirve para probar que quien dice ser dueño de
 *   una casilla lo es. Acá el vínculo con el perfil no lo establece el
 *   correo: lo establece el creador del perfil, que ya declaró ser el
 *   representante legal de esa persona al crearlo (consentimiento
 *   `acceso_familiar_representante`, tarea 15.1) y cuya autoridad la base
 *   revalida en `puede_graduar_perfil`.
 * - Si el correo estuviera mal escrito, el remedio existe y es el de
 *   siempre: la persona no puede entrar, avisa, y quien la graduó lo
 *   resuelve. Nada quedó comprometido, porque el perfil sigue siendo el
 *   mismo y los accesos previos se mantuvieron.
 *
 * ## Lo que NO se le manda a la cuenta nueva
 *
 * **`legales_version` no viaja.** El nuevo titular todavía no aceptó nada:
 * hasta este momento regía el consentimiento de su representante, y los
 * documentos los tiene que aceptar él en su primer ingreso
 * (`/aceptar-terminos`). Guardar en `auth.users` la versión "vigente al
 * graduar" dejaría a mano un dato con el que alguien, más adelante, podría
 * sellar un consentimiento que su titular nunca dio.
 */

import { createClient, type AuthError, type SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/auth/cuentas-admin.ts se importó desde el navegador. Este módulo usa la " +
      "SERVICE_ROLE_KEY y sólo puede ejecutarse en el servidor.",
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

/**
 * Motivo por el que una graduación no se pudo completar. Es un tipo cerrado
 * a propósito: quien llama tiene que redactar UN mensaje en español por cada
 * caso, y si mañana aparece un motivo nuevo el compilador marca el `switch`
 * incompleto en vez de dejarlo caer en un genérico.
 */
export type FalloDeGraduacion =
  /** Ya existe una cuenta con ese correo (código `email_exists` de GoTrue). */
  | "email_en_uso"
  /** GoTrue rechazó el correo por inválido. */
  | "email_invalido"
  /** GoTrue rechazó la contraseña por débil o corta. */
  | "contrasena_debil"
  /**
   * La base abortó el alta. Es el modo de falla del trigger de
   * `20260817230000_graduacion.sql`: el perfil no existe o ya tiene dueño
   * (una graduación que ganó la carrera entre la verificación y esta
   * llamada). La cuenta NO quedó creada: la excepción viaja en la misma
   * transacción del INSERT de `auth.users`.
   */
  | "vinculacion_rechazada"
  /** Cualquier otra cosa (red, rate limit, configuración). */
  | "desconocido"

export interface ResultadoGraduacion {
  /** `null` si salió todo bien; el motivo si no. */
  fallo: FalloDeGraduacion | null
  /** Id de la cuenta creada, solo cuando `fallo === null`. */
  userId: string | null
}

export interface DatosDeGraduacion {
  /** Correo con el que va a entrar el nuevo titular. Ya normalizado a minúsculas. */
  email: string
  /** Contraseña inicial, que después se cambia con el flujo de recupero existente. */
  password: string
  /** Nombre para `user_metadata.full_name` (lo muestra el panel de Supabase). */
  nombre: string
  /** Perfil gestionado que esta cuenta viene a tomar. Va a `app_metadata`. */
  perfilId: string
}

/**
 * Crea la cuenta del nuevo titular y la vincula al perfil gestionado.
 *
 * **La vinculación no la hace este código**: la hace el trigger
 * `auth_users_crear_perfil_de_cuenta`, en la MISMA transacción que el INSERT
 * de `auth.users`, leyendo `app_metadata.perfil_existente`. Por eso acá no
 * hay ningún `update` de `profiles` posterior: entre un `createUser` y una
 * segunda llamada habría una ventana de red en la que la cuenta ya existe y
 * el perfil todavía no está vinculado, y perder esa carrera deja a alguien
 * con una cuenta que entra y no ve nada — exactamente el bug de producción
 * que arregló `20260814140000_alta_de_cuenta.sql`.
 *
 * **No lanza nunca por un fallo esperable**: devuelve `fallo` para que la
 * Server Action lo traduzca a un mensaje en español. Sí propaga los errores
 * de configuración (falta una variable de entorno), que no son un caso de
 * uso sino un despliegue roto.
 */
export async function graduarPerfilConCuentaNueva(
  datos: DatosDeGraduacion,
): Promise<ResultadoGraduacion> {
  const { data, error } = await clienteAdmin().auth.admin.createUser({
    email: datos.email,
    password: datos.password,
    // Ver "email_confirm: true" en el encabezado del módulo.
    email_confirm: true,
    user_metadata: { full_name: datos.nombre },
    app_metadata: { perfil_existente: datos.perfilId },
  })

  if (error) {
    return { fallo: clasificarError(error), userId: null }
  }
  if (!data.user) {
    // No debería pasar (sin error, GoTrue siempre devuelve el usuario), pero
    // devolver "éxito" sin id dejaría a quien llama afirmando algo que no
    // puede verificar.
    return { fallo: "desconocido", userId: null }
  }

  return { fallo: null, userId: data.user.id }
}

/**
 * Traduce el error de GoTrue a un motivo del dominio.
 *
 * El caso `vinculacion_rechazada` merece una nota: cuando el trigger levanta
 * una excepción, GoTrue no propaga ni el SQLSTATE ni el mensaje de Postgres
 * —contesta un 500 con un texto genérico del tipo "Database error creating
 * new user"—, así que la única forma de reconocerlo es por ese par (status
 * 5xx + mención a la base). Es una heurística y se declara como tal: el
 * mensaje que ve la persona es igual de correcto en los dos casos que
 * podrían confundirse, porque la Server Action ya verificó la autoridad
 * contra la base antes de llegar acá y lo único que puede haber cambiado en
 * el medio es que el perfil dejara de estar disponible.
 */
function clasificarError(error: AuthError): FalloDeGraduacion {
  switch (error.code) {
    case "email_exists":
    case "user_already_exists":
      return "email_en_uso"
    case "email_address_invalid":
      return "email_invalido"
    case "weak_password":
      return "contrasena_debil"
    default:
      break
  }

  const status = error.status ?? 0
  if (status >= 500 && /database/i.test(error.message)) {
    return "vinculacion_rechazada"
  }

  return "desconocido"
}
