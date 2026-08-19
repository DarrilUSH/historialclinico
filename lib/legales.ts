import "server-only"

/**
 * Consentimiento legal (Ley 25.326, Sprint 12, tarea 12.1).
 *
 * `consents` (`supabase/migrations/20260814130000_consents.sql`) es el
 * registro probatorio de que una CUENTA aceptó un documento legal en un
 * momento dado, con qué versión de ese documento y desde qué IP. Es
 * append-only -mismo tratamiento que `access_logs`-, porque su valor
 * probatorio depende de que nadie, ni siquiera su propio titular, pueda
 * reescribir lo que ya se firmó.
 *
 * ## El consentimiento del ALTA no se registra desde acá
 *
 * Hasta el hotfix de `supabase/migrations/20260814140000_alta_de_cuenta.sql`,
 * este archivo exportaba además `registrarConsentimientosDeAlta`, que
 * insertaba las filas de `privacidad` y `terminos` desde `registrarse`
 * (`app/(auth)/actions.ts`) con la sesión que devolvía `signUp`. En producción
 * esa sesión NO existe —la confirmación por correo está encendida y la sesión
 * llega recién al confirmar—, así que las dos filas nunca se escribían: la
 * cuenta quedaba creada, sin perfil y sin prueba de consentimiento.
 *
 * Ese registro pasó a ser responsabilidad de la base, en el trigger
 * `auth_users_crear_perfil_de_cuenta`, que corre en la misma transacción que
 * el alta y lee la versión aceptada de `auth.users.raw_user_meta_data`. Lo
 * único que sigue viniendo de este archivo para ese flujo es la constante
 * `VERSION_LEGALES`, que `registrarse` manda en `options.data`.
 *
 * ## La excepción: el primer ingreso de una cuenta GRADUADA
 *
 * `cuentaAceptoLegalesDeAlta` y `registrarLegalesDeAlta` (al final de este
 * archivo, Sprint 15 tarea 15.2) parecen contradecir el párrafo anterior y no
 * lo hacen. La graduación de un perfil gestionado abre el primer camino de
 * alta en el que el trigger **deliberadamente NO firma nada**: la cuenta la
 * crea el representante desde la Admin API y su titular todavía no aceptó
 * ningún documento -hasta ese momento regía el consentimiento del
 * representante, que habla de él y no se transfiere-.
 *
 * La diferencia con el bug que motivó el hotfix es el requisito, no el
 * mecanismo: allá había que registrar una aceptación que YA había ocurrido en
 * un formulario, sin sesión con la cual escribirla; acá la aceptación ocurre
 * DESPUÉS, en el primer ingreso, con la sesión del propio titular abierta y
 * los documentos delante. Por eso este par de funciones puede vivir en la
 * aplicación -y escribir con el cliente del usuario, bajo
 * `consents_insert_propio`- sin reabrir nada.
 *
 * ## Lo que sí queda acá: el consentimiento de acceso familiar
 *
 * `registrarConsentimiento` cubre el otorgamiento de acceso familiar
 * (`invitarFamiliar`, `app/(app)/(con-nav)/familia/actions.ts`), donde la fila
 * de `consents` es la CONSTANCIA de una acción que ya ocurrió (el `INSERT` en
 * `family_permissions` ya se hizo): es auditoría, no condición. Por eso
 * **nunca lanza** -mismo contrato que `registrarAcceso` en `lib/auditoria.ts`-
 * y un fallo de red no debe dejar a quien otorgó el acceso sin saber si el
 * otorgamiento en sí funcionó.
 *
 * Escribe con el cliente del USUARIO, nunca con `service_role`: la política
 * `consents_insert_propio` exige `user_id = auth.uid()`, así que quien decide
 * si la fila entra es RLS, no este archivo. (El trigger del alta es la única
 * excepción posible y por eso vive en la base, como `SECURITY DEFINER`, y no
 * como una clave de servicio en manos de la aplicación web.)
 */

import { cache } from "react"

import { headers } from "next/headers"

import { normalizarIp } from "@/lib/auditoria"
import { sesionDeLaRequest, type ClienteSupabaseServidor } from "@/lib/auth/guardas"

/**
 * Versión vigente de los documentos legales. Cambia cuando el TEXTO de
 * Privacidad o de Términos cambia de forma sustancial -no en cada typo-: es
 * lo que permite, más adelante, saber si el consentimiento que guarda una
 * cuenta corresponde a la versión vigente o a una anterior.
 *
 * Formato `AAAA-MM-DD-vN`: fecha de publicación + número de versión de ese
 * día, para poder publicar más de una revisión el mismo día sin ambigüedad.
 *
 * **Tiene un espejo en SQL.** `completar_alta_de_cuenta`
 * (`supabase/migrations/20260814140000_alta_de_cuenta.sql`) repite este valor
 * como constante, para poder fechar el consentimiento de una cuenta que no
 * nació del formulario de registro y por lo tanto no trae `legales_version` en
 * su metadata. La base no puede importar TypeScript; al cambiar esta constante
 * hay que escribir una migración que actualice la otra.
 * `tests/unit/alta-de-cuenta.test.ts` falla si las dos se separan.
 */
export const VERSION_LEGALES = "2026-08-14-v1"

/**
 * Los cuatro documentos que este proyecto hace firmar, calcados 1:1 del
 * CHECK `consents_document_valido` de la migración. `'privacidad'` y
 * `'terminos'` se firman juntos al registrarse; `'acceso_familiar'` se firma
 * cada vez que una cuenta otorga acceso sobre un perfil EXISTENTE a otra
 * cuenta (`docs/modelo-permisos.md` §4.4); `'acceso_familiar_representante'`
 * se firma al CREAR un perfil gestionado nuevo (Sprint 15, tarea 15.1;
 * `docs/modelo-permisos.md` §8.4/§9.4, deuda D6) — declara que quien lo crea
 * tiene el consentimiento del titular o su representación legal (Ley
 * 25.326, patria potestad/tutela). A diferencia de `'acceso_familiar'`, ese
 * cuarto documento no lo firma esta función: lo firma el RPC
 * `crear_perfil_gestionado` (`supabase/migrations/20260817220000_perfiles_
 * gestionados.sql`), en la misma transacción que crea el perfil y su fila de
 * arranque — se lista igual acá porque el CHECK de la base y este tipo
 * tienen que coincidir siempre.
 */
export type DocumentoLegal =
  | "privacidad"
  | "terminos"
  | "acceso_familiar"
  | "acceso_familiar_representante"

/**
 * Los dos documentos que TODA cuenta tiene que haber aceptado para poder usar
 * la aplicación. Se firman juntos, siempre: no existe "acepté la privacidad
 * pero no los términos".
 *
 * Es la misma lista que insertan `completar_alta_de_cuenta`
 * (`supabase/migrations/20260814140000_alta_de_cuenta.sql`) en el alta normal
 * y el gate de `/aceptar-terminos` en el primer ingreso de una cuenta
 * graduada. Vive acá para que las dos vías la lean del mismo lugar.
 */
export const DOCUMENTOS_DE_ALTA = ["privacidad", "terminos"] as const satisfies
  readonly DocumentoLegal[]

/** IP del cliente actual, o `null` si no hay ninguna cabecera utilizable. Ver `normalizarIp`. */
async function obtenerIpActual(): Promise<string | null> {
  const encabezados = await headers()
  return (
    normalizarIp(encabezados.get("x-forwarded-for")) ??
    normalizarIp(encabezados.get("x-real-ip"))
  )
}

/**
 * Registra el consentimiento de UN documento puntual. Hoy el único llamador
 * es `invitarFamiliar` con `documento: "acceso_familiar"`.
 *
 * **No lanza nunca** -ver el porqué en el encabezado del archivo-: cualquier
 * error se deja en la consola del servidor con el prefijo estable
 * `[legales]`, igual que `[auditoria]` en `registrarAcceso`.
 */
export async function registrarConsentimiento(
  supabase: ClienteSupabaseServidor,
  userId: string,
  documento: DocumentoLegal,
): Promise<void> {
  try {
    const ip = await obtenerIpActual()

    const { error } = await supabase.from("consents").insert({
      user_id: userId,
      document: documento,
      version: VERSION_LEGALES,
      ip,
    })

    if (error) {
      console.error(`[legales] No se pudo registrar el consentimiento "${documento}": ${error.message}`)
    }
  } catch (error) {
    console.error(`[legales] Fallo al registrar el consentimiento "${documento}":`, error)
  }
}

/**
 * ¿La cuenta de esta sesión ya firmó los DOS documentos de alta?
 *
 * ## Por qué esto existe (Sprint 15, tarea 15.2)
 *
 * Hasta la graduación de perfiles gestionados, la pregunta no tenía sentido:
 * el único camino de alta era `/registro`, y desde el hotfix de
 * `20260814140000_alta_de_cuenta.sql` el trigger de la base le escribe las
 * dos filas de `consents` a toda cuenta nueva, en la misma transacción. Toda
 * cuenta que existía, había firmado.
 *
 * La graduación abre el primer camino de alta que NO firma nada: la cuenta la
 * crea el representante desde la Admin API, y hasta ese momento lo que regía
 * era SU consentimiento (`acceso_familiar_representante`, tarea 15.1), que
 * dice algo sobre él y no se transfiere. El nuevo titular tiene que aceptar
 * los documentos **él mismo**, y esta función es la pregunta que decide si ya
 * lo hizo.
 *
 * ## Dónde se pregunta
 *
 * - `app/(app)/layout.tsx` — la puerta de toda la sección autenticada. Manda
 *   a `/aceptar-terminos` a quien no firmó, en cada navegación (ese layout es
 *   dinámico: llama a `cookies()`, así que el Client Router Cache de Next no
 *   lo saltea).
 * - `elegirPerfil` (`app/(app)/(sin-nav)/perfiles/actions.ts`) — el otro
 *   extremo: sin haber firmado no se fija la cookie de perfil activo, y sin
 *   perfil activo ninguna pantalla de `(con-nav)` renderiza un solo dato.
 *
 * **Es un gate de navegación, no una capa de autorización.** La autoridad
 * sobre los datos sigue siendo RLS, que no lee `consents` ni tiene por qué:
 * una cuenta graduada es titular de su perfil desde el instante de la
 * vinculación, y lo que este gate garantiza es que no OPERE la aplicación
 * antes de aceptar, no que la base le esconda sus propias filas.
 *
 * ## Ante un error de la base contesta `true` (deja pasar)
 *
 * Es la misma familia de decisión que "auditar nunca rompe el flujo"
 * (`lib/auditoria.ts`), y por dos motivos concretos:
 *
 * 1. **Fallar cerrado no protegería nada y ensuciaría la prueba.** Quien
 *    quedara del lado de afuera por un hipo de red vería el gate, aceptaría
 *    otra vez y entraría igual — con una fila de `consents` de más en una
 *    tabla append-only cuyo valor es probatorio. Cambiar "un render sin gate"
 *    por "un consentimiento duplicado que nadie dio dos veces" es un mal
 *    negocio.
 * 2. **El gate se vuelve a evaluar en la navegación siguiente.** Un fallo
 *    transitorio se corrige solo; no hay ventana que se quede abierta.
 *
 * El error se deja en la consola del servidor con el prefijo estable
 * `[legales]`, igual que el resto de este archivo.
 *
 * Envuelta en `cache()` de React: `app/(app)/layout.tsx` y la pantalla que
 * cuelga de él corren en el mismo request, y no tiene sentido preguntarle dos
 * veces a la base (mismo criterio que `obtenerPerfilActivo`).
 */
export const cuentaAceptoLegalesDeAlta = cache(async (): Promise<boolean> => {
  // `sesionDeLaRequest()` en vez de `createClient()` + `getUser()` propios:
  // los dos `cache()` se suman, así que este gate comparte el único viaje a
  // GoTrue del request con las guardas y con `obtenerTamano` en vez de abrir
  // el suyo (ver el encabezado de `sesionDeLaRequest` en lib/auth/guardas.ts).
  const { usuario: user, supabase } = await sesionDeLaRequest()

  // Sin sesión no hay cuenta a la que exigirle nada: de la ruta privada ya se
  // ocupan `proxy.ts` y las guardas.
  if (!user) {
    return true
  }

  const { data, error } = await supabase
    .from("consents")
    .select("document")
    .eq("user_id", user.id)
    .in("document", [...DOCUMENTOS_DE_ALTA])

  if (error) {
    console.error(
      `[legales] No se pudo verificar el consentimiento de alta de la cuenta: ${error.message}`,
    )
    return true
  }

  const firmados = new Set((data ?? []).map((fila) => fila.document))
  return DOCUMENTOS_DE_ALTA.every((documento) => firmados.has(documento))
})

/**
 * Sella los documentos de alta que le falten a `userId`. Es lo que ejecuta el
 * gate `/aceptar-terminos` cuando el nuevo titular acepta.
 *
 * **A diferencia de `registrarConsentimiento`, esta función SÍ informa el
 * error.** No es una contradicción: es exactamente el caso que el encabezado
 * de `lib/auditoria.ts` anticipa. Allá la fila es la CONSTANCIA de una acción
 * que ya ocurrió (el acceso ya se otorgó), así que perderla no puede
 * bloquear nada. Acá la fila **es** la acción: si no se escribe, la persona
 * no aceptó, y dejarla entrar igual mientras la pantalla le dice "listo"
 * sería declarar cumplido el art. 5 de la Ley 25.326 sin ninguna prueba.
 * Devolver `false` es lo que le permite al formulario decir la verdad y
 * ofrecer reintentar.
 *
 * Escribe con el cliente del USUARIO, nunca con `service_role`: la política
 * `consents_insert_propio` exige `user_id = auth.uid()`, o sea que quien
 * decide si las filas entran es RLS. Un consentimiento que la aplicación
 * puede firmar a nombre de cualquiera no es un consentimiento.
 *
 * Inserta solo los documentos FALTANTES. La tabla no tiene constraint única
 * -firmar una versión nueva del mismo documento es una fila más, legítima
 * (`20260814130000_consents.sql`)-, así que la deduplicación tiene que
 * hacerla quien escribe.
 */
export async function registrarLegalesDeAlta(
  supabase: ClienteSupabaseServidor,
  userId: string,
): Promise<boolean> {
  const { data: yaFirmados, error: errorLectura } = await supabase
    .from("consents")
    .select("document")
    .eq("user_id", userId)
    .in("document", [...DOCUMENTOS_DE_ALTA])

  if (errorLectura) {
    console.error(
      `[legales] No se pudieron leer los consentimientos de alta antes de firmarlos: ${errorLectura.message}`,
    )
    return false
  }

  const firmados = new Set((yaFirmados ?? []).map((fila) => fila.document))
  const faltantes = DOCUMENTOS_DE_ALTA.filter((documento) => !firmados.has(documento))

  if (faltantes.length === 0) {
    return true
  }

  const ip = await obtenerIpActual()

  const { error } = await supabase.from("consents").insert(
    faltantes.map((documento) => ({
      user_id: userId,
      document: documento,
      version: VERSION_LEGALES,
      ip,
    })),
  )

  if (error) {
    console.error(`[legales] No se pudieron registrar los consentimientos de alta: ${error.message}`)
    return false
  }

  return true
}
