/**
 * Cookie de SESIÓN del tutorial de bienvenida (tarea #14) — la pieza que
 * hace que "Ahora no" reaparezca recién en la próxima sesión y nunca en la
 * próxima navegación.
 *
 * ## El mecanismo, y por qué vive en el proxy
 *
 * "Sesión" se define acá con el significado más literal que tiene en la
 * web: el tramo de vida de una cookie de sesión del navegador (sin
 * `maxAge`/`Expires`), que el navegador borra al cerrarse del todo. La
 * cookie `consejos_sesion` no guarda nada más que el instante en que se
 * creó; `lib/consejos/logica.ts#pospuestoSigueActivo` compara ese instante
 * contra `updated_at` de la fila pospuesta, y si la sesión es MÁS NUEVA que
 * la postergación, esta ya quedó atrás.
 *
 * Se elige la duración de la SESIÓN DE LOGIN de Supabase (atada a la
 * cookie `perfil_activo`/`tamano`, que sí sobreviven al cierre del
 * navegador) a propósito: en esta app la persona casi nunca cierra sesión
 * explícitamente (`docs/tutorial-bienvenida.md` §3 desarrolla el porqué), así
 * que atar "sesión" al login/logout habría hecho que "Ahora no" equivaliera,
 * en la práctica, a "para siempre" — exactamente lo que la tarea pide evitar.
 * Atarlo al cierre del NAVEGADOR es lo que hace que el consejo vuelva a
 * aparecer la próxima vez que la persona abre la aplicación después de un
 * rato, que es el sentido común de "en la próxima sesión" para quien usa una
 * PWA instalada. `cerrarSesion` (`app/(auth)/actions.ts`) además la borra
 * explícitamente -mismo tratamiento que `perfil_activo` y `tamano`-, así que
 * un logout consciente TAMBIÉN cuenta como frontera de sesión, aunque no sea
 * el mecanismo principal.
 *
 * **Límite declarado**: en Android, un Chrome/WebAPK que el sistema mantiene
 * vivo en segundo plano (sin que el proceso muera del todo) puede conservar
 * la cookie de sesión más tiempo del que alguien esperaría de "cerré la
 * app". El peor caso posible es que un consejo pospuesto tarde un poco más
 * en reaparecer, nunca que desaparezca para siempre — no hay downside de
 * seguridad ni de datos, es una preferencia de UI.
 *
 * ## Por qué esto vive en el proxy y no se crea perezosamente en `/inicio`
 *
 * Un Server Component (como `/inicio`) NO puede escribir cookies durante su
 * render (`lib/perfil-activo.ts` documenta el mismo límite de Next.js). Si
 * la cookie se creara ahí "la primera vez que falta", el `set()` fallaría en
 * silencio en CADA render (try/catch de no-op) y la cookie nunca llegaría a
 * persistir — cada navegación a `/inicio` volvería a ver "sin cookie" y
 * generaría un instante nuevo cada vez, lo que haría que CUALQUIER
 * postergación pareciera "de una sesión vieja" de inmediato: "Ahora no"
 * dejaría de posponer nada.
 *
 * El proxy (`proxy.ts`, Next 16 — antes `middleware.ts`) sí puede escribir
 * cookies de verdad, y corre en TODA request no estática (incluida la
 * primera de cada sesión), así que es la única pieza que puede garantizar
 * que la cookie exista antes de que cualquier Server Component la lea. El
 * patrón -escribir tanto en `request.cookies` (para que la vean los Server
 * Components de ESTA MISMA request) como en la respuesta (para que el
 * navegador la reciba)- es el mismo que ya usa `lib/supabase/proxy.ts` para
 * refrescar el token de Supabase.
 */

import { NextResponse, type NextRequest } from "next/server"

import { COOKIE_SESION_CONSEJOS } from "@/lib/consejos/tipos"

/**
 * Si la request ya trae la cookie de sesión, no hace nada (devuelve
 * `respuesta` tal cual). Si no la trae, la crea con el instante actual —
 * tanto en el `request` mutado (para esta misma request) como en la
 * respuesta que ve el navegador (para las próximas) — y devuelve una
 * respuesta nueva que conserva TODAS las cookies que `respuesta` ya traía
 * (típicamente el token de sesión refrescado por `actualizarSesion`).
 *
 * Se llama únicamente cuando hay sesión (`proxy.ts` la gatea con
 * `usuario !== null`): el tutorial de bienvenida no existe para nadie
 * anónimo, y no tiene sentido sembrar una cookie más en cada visita a
 * `/login` o a las páginas legales.
 */
export function asegurarSesionConsejos(
  request: NextRequest,
  respuesta: NextResponse,
): NextResponse {
  if (request.cookies.get(COOKIE_SESION_CONSEJOS)) {
    return respuesta
  }

  const inicioDeSesion = new Date().toISOString()
  request.cookies.set(COOKIE_SESION_CONSEJOS, inicioDeSesion)

  const conCookieDeSesion = NextResponse.next({ request })
  for (const cookie of respuesta.cookies.getAll()) {
    conCookieDeSesion.cookies.set(cookie)
  }
  conCookieDeSesion.cookies.set(COOKIE_SESION_CONSEJOS, inicioDeSesion, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // SIN maxAge/expires: cookie de SESIÓN del navegador. Es el mecanismo en
    // sí, no un descuido — ver el encabezado de este archivo.
  })
  return conCookieDeSesion
}
