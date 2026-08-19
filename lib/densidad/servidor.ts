import "server-only"

/**
 * Resolución y persistencia del modo de letra (Sprint 13).
 *
 * ## La distinción que este archivo existe para no perder
 *
 * `lib/perfil-activo.ts` resuelve **a quién estoy mirando**. Este archivo
 * resuelve **quién está mirando**. Son dos preguntas distintas y las respuestas
 * viven en filas distintas de `profiles`:
 *
 *   · perfil activo → la fila del perfil elegido en el selector (puede ser
 *     ajeno; por eso allá cada lectura revalida el permiso contra la base).
 *   · modo de letra → la fila de la CUENTA logueada, o sea
 *     `profiles where user_id = auth.uid()`. Siempre la propia, nunca otra.
 *
 * Cuando María (que prefiere la letra chica) entra al perfil de Roberto (que
 * la prefiere grande), la app se ve CHICA: manda la de María, porque es la que
 * está mirando la pantalla. Confundir las dos cosas es el bug que este archivo
 * y el §5 de la migración están escritos para prevenir.
 *
 * ## Por qué NO hay guarda de permiso acá
 *
 * `lib/perfil-activo.ts` llama a `requerirPermiso` en cada lectura porque la
 * cookie apunta a datos de OTRA persona y una cookie forjada sería una fuga.
 * Acá no hay nada que autorizar: la consulta está anclada a `auth.uid()`, así
 * que el peor caso de una cookie forjada es que alguien se cambie a sí mismo
 * el tamaño de la letra. La escritura, además, está triplemente acotada —el
 * `.eq("user_id", ...)` de acá, la política `profiles_update_administrador` y
 * el trigger `profiles_proteger_densidad`—, y las tres capas dicen lo mismo.
 *
 * ## Orden de resolución
 *
 *   1. Cookie espejo válida → se usa, sin tocar la base. Es el camino del 99%
 *      de las requests y el que permite que el layout RAÍZ (que corre en todas
 *      las rutas, incluidas `/login` y `/offline`) no pague una consulta.
 *   2. Sin cookie (o con un valor que no es un modo) → se lee la fila de la
 *      cuenta. Sin sesión, `getUser()` corta sin salir a la red y esto termina
 *      en el default.
 *   3. Nada de lo anterior → `TAMANO_POR_DEFECTO`, que desde el Sprint 14 es
 *      `chica` (ver el porqué en `lib/densidad/tamano.ts`). Es lo que hace que
 *      `/login`, `/registro`, `/recuperar` y `/offline` —donde no hay fila que
 *      leer— salgan ya en la densidad nativa, sin que nadie tenga que elegir
 *      nada primero.
 */

import { cache } from "react"

import { cookies } from "next/headers"

import { sesionDeLaRequest } from "@/lib/auth/guardas"
import {
  COOKIE_TAMANO,
  TAMANO_POR_DEFECTO,
  type Tamano,
  esTamano,
} from "@/lib/densidad/tamano"

/** Mismo tope que la cookie de perfil activo: el máximo real de Chrome/Firefox. */
const MAX_AGE_COOKIE_SEGUNDOS = 400 * 24 * 60 * 60

/**
 * El modo con el que hay que pintar ESTA request.
 *
 * Envuelta en `cache()` de React por el mismo motivo que `obtenerPerfilActivo`:
 * memoiza por request de render. Hoy la llama un solo lugar (el layout raíz),
 * pero las tandas de rediseño van a querer consultarla desde componentes que
 * decidan estructura y no solo estilo -por ejemplo, cuántas columnas pedirle a
 * una grilla server-side-, y con `cache()` esas llamadas son gratis y ven todas
 * el mismo valor.
 *
 * **Nunca lanza.** Este valor gobierna el atributo del `<html>`: un fallo
 * leyendo una preferencia de interfaz no puede tumbar el render de una app de
 * salud. Cualquier problema termina en `TAMANO_POR_DEFECTO`, que es el modo que
 * ve todo el mundo mientras no elija otra cosa: la app se pinta igual que en el
 * camino feliz y la persona no se entera de que hubo un problema. (Hasta el
 * Sprint 14 ese fallback era además "el modo más accesible"; ahora el más
 * accesible es el otro, y sigue estando a un toque del botón A/a. Un fallback
 * que difiriera del default haría que un error de base se viera como un cambio
 * de tamaño espontáneo, que es peor.)
 */
export const obtenerTamano = cache(async (): Promise<Tamano> => {
  const cookieStore = await cookies()
  const enCookie = cookieStore.get(COOKIE_TAMANO)?.value

  if (esTamano(enCookie)) {
    return enCookie
  }

  const enBase = await leerTamanoDeLaCuenta()

  if (!enBase) {
    return TAMANO_POR_DEFECTO
  }

  // Oportunista: si esta request resultó ser una Server Action o un Route
  // Handler, la cookie queda escrita y las siguientes ya no consultan. Si es
  // el render de un Server Component, `fijarCookieTamano` no hace nada (ver su
  // try/catch) y se vuelve a consultar en la próxima —el mismo compromiso, y
  // el mismo motivo, que `limpiarPerfilActivo` en lib/perfil-activo.ts—.
  await fijarCookieTamano(enBase)

  return enBase
})

/**
 * Lee `display_density` de la fila de la cuenta logueada.
 *
 * Devuelve `null` -no el default- cuando no hay nada que leer, para que quien
 * llama pueda distinguir "no hay preferencia guardada" de "la preferencia
 * guardada es grande". Hoy las dos ramas terminan igual, pero la que decide
 * cuál es el default es una sola línea de `tamano.ts` y conviene que siga
 * siendo así.
 *
 * `maybeSingle()` y no `single()`: una cuenta recién registrada cuyo INSERT de
 * perfil falló (el caso que `registrarse` contempla en `app/(auth)/actions.ts`)
 * no tiene fila, y eso es un estado posible del sistema, no un error.
 */
async function leerTamanoDeLaCuenta(): Promise<Tamano | null> {
  try {
    // Sin sesión, `getUser()` devuelve `user: null` sin salir a la red
    // (`AuthSessionMissingError` se resuelve contra el storage de cookies), así
    // que las rutas anónimas -`/login`, `/registro`, `/offline`, `/`- no pagan
    // ningún viaje por esta función.
    //
    // CON sesión sí sale a la red, y esta función corre en el layout RAÍZ, o
    // sea en TODA pantalla autenticada. Por eso pide la sesión compartida del
    // request (`sesionDeLaRequest`, memoizada con `cache()`) en vez de abrir su
    // propio cliente: el viaje a GoTrue lo paga una sola vez el primero que
    // llegue, y acá ya está resuelto. Ver lib/auth/guardas.ts.
    const { usuario: user, supabase } = await sesionDeLaRequest()

    if (!user) {
      return null
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("display_density")
      .eq("user_id", user.id)
      .maybeSingle()

    if (error || !data) {
      return null
    }

    return esTamano(data.display_density) ? data.display_density : null
  } catch {
    // Ver el "nunca lanza" de `obtenerTamano`: la base caída no puede impedir
    // que la app se pinte.
    return null
  }
}

/**
 * Escribe la cookie espejo.
 *
 * El try/catch es el mismo caso -y por el mismo motivo- que el de
 * `limpiarPerfilActivo`: Next.js solo deja escribir cookies desde una Server
 * Action o un Route Handler, y esta función también se llama desde
 * `obtenerTamano`, que puede estar corriendo dentro del render de un Server
 * Component. Ahí el `set()` lanza y no pasa nada: la preferencia igual se
 * resolvió bien en esta request, solo que la próxima vuelve a consultarla.
 */
export async function fijarCookieTamano(tamano: Tamano): Promise<void> {
  const cookieStore = await cookies()
  try {
    cookieStore.set(COOKIE_TAMANO, tamano, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_COOKIE_SEGUNDOS,
    })
  } catch {
    // No-op esperado durante el render de un Server Component.
  }
}

/**
 * Borra la cookie espejo. La usa `cerrarSesion`: en un navegador compartido, la
 * próxima persona que inicie sesión no tiene por qué ver, ni siquiera por un
 * render, la preferencia que dejó la anterior. Sin esto, el modo de letra sería
 * el único resto de una sesión ajena que sobrevive al logout.
 */
export async function limpiarCookieTamano(): Promise<void> {
  const cookieStore = await cookies()
  try {
    cookieStore.delete(COOKIE_TAMANO)
  } catch {
    // Ídem `fijarCookieTamano`.
  }
}

/**
 * Relee la preferencia de la base y la vuelca a la cookie.
 *
 * Es el punto de sincronización que hace que la preferencia **viaje entre
 * dispositivos**: se llama al iniciar sesión y al registrarse, que son los dos
 * momentos en que una cuenta empieza a usar un navegador. Sin esto, María
 * entrando por primera vez desde la tablet vería el modo grande aunque tenga
 * guardada la letra chica, hasta que volviera a tocar el conmutador.
 *
 * Cubre además el caso feo del navegador compartido cuya sesión anterior
 * expiró sin logout: la cookie vieja se pisa con la preferencia de quien
 * acaba de entrar, no se hereda.
 */
export async function sincronizarCookieTamano(): Promise<void> {
  const enBase = await leerTamanoDeLaCuenta()
  await fijarCookieTamano(enBase ?? TAMANO_POR_DEFECTO)
}

/** Resultado de intentar guardar la preferencia. */
export interface ResultadoPersistencia {
  /** El modo que rige de acá en adelante para esta sesión (siempre el pedido). */
  tamano: Tamano
  /** `false` si la fila de la cuenta no se pudo actualizar (ver `persistirTamano`). */
  persistido: boolean
}

/**
 * Guarda la preferencia en la fila de la cuenta y actualiza la cookie.
 *
 * ## El `.eq("user_id", user.id)` no es una comodidad, es la primera cerradura
 *
 * Son tres capas independientes que dicen lo mismo, y ninguna sobra:
 *
 *   1. **Acá**: el `UPDATE` está anclado a la fila de la cuenta. Ni siquiera se
 *      acepta un id de perfil como parámetro —no hay forma de pedirle a esta
 *      función que escriba en otra fila—.
 *   2. **RLS** (`profiles_update_administrador`): filtra a titular o
 *      `can_manage`. Por sí sola dejaría pasar a un `can_manage`.
 *   3. **Trigger** (`profiles_proteger_densidad`): rechaza con 42501 el cambio
 *      de esta columna si quien escribe no es el titular de la fila. Es la
 *      única de las tres que expresa la regla completa, y por eso existe.
 *
 * ## Por qué un fallo de persistencia no es un fallo de la acción
 *
 * Si la cuenta todavía no tiene fila en `profiles` -el estado que
 * `registrarse` contempla cuando el INSERT del perfil falla-, el `UPDATE`
 * afecta cero filas. La cookie se escribe igual: la persona tocó un botón y
 * tiene derecho a ver el efecto. Lo que se pierde es que la elección la siga
 * en el próximo dispositivo, y eso se refleja en `persistido: false` para que
 * quien llame pueda decidir si vale la pena decirlo.
 *
 * **Sin sesión no se escribe ni la cookie.** No es una guarda de seguridad
 * -no hay nada que proteger en un tamaño de letra- sino de higiene: los dos
 * conmutadores viven en pantallas autenticadas, así que una llamada anónima a
 * esta función solo puede venir de un cliente inventado, y no hay motivo para
 * dejarle sembrar una cookie que después el layout raíz va a respetar en las
 * pantallas de login.
 */
export async function persistirTamano(tamano: Tamano): Promise<ResultadoPersistencia> {
  let hayCuenta = false
  let persistido = false

  try {
    // Misma sesión compartida del request que usa `leerTamanoDeLaCuenta`: esta
    // Server Action corre en el mismo request que ya resolvió quién es la
    // persona, y no hay motivo para volver a preguntárselo a GoTrue.
    const { usuario: user, supabase } = await sesionDeLaRequest()

    if (user) {
      hayCuenta = true

      const { data, error } = await supabase
        .from("profiles")
        .update({ display_density: tamano })
        .eq("user_id", user.id)
        .select("id")

      persistido = !error && (data?.length ?? 0) > 0
    }
  } catch {
    persistido = false
  }

  if (hayCuenta) {
    await fijarCookieTamano(tamano)
  }

  return { tamano, persistido }
}
