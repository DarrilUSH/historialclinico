/**
 * GET /turnos/enlace — punto de entrada de los deep links a `/turnos` que
 * necesitan cambiar el perfil activo antes de mostrar la lista (Sprint 6.6,
 * docs/recordatorios.md §9).
 *
 * ## Por qué esto no vive directamente en `turnos/page.tsx`
 *
 * `fijarPerfilActivo` (`lib/perfil-activo.ts`) escribe una cookie, y Next.js
 * solo permite escribir cookies durante la fase `'action'` de un request -un
 * Server Action o un Route Handler-, nunca durante el render de un Server
 * Component (fase `'render'`), aunque ese componente llame a `redirect()`
 * después
 * (`node_modules/next/dist/server/web/spec-extension/adapters/request-cookies.js`,
 * `areCookiesMutableInCurrentPhase`). `turnos/page.tsx` es un Server
 * Component: si intentara `await fijarPerfilActivo(perfil)` ahí mismo,
 * lanzaría `Error: Cookies can only be modified in a Server Action or Route
 * Handler`. Por eso el cambio de perfil vive ACÁ, y `turnos/page.tsx` se
 * limita a redirigir para acá cuando ve un `?perfil=` que no puede procesar
 * él mismo.
 *
 * ## Por qué esto no vive bajo `/api`
 *
 * `esRutaDeApi()` (`lib/auth/rutas.ts`) hace que `proxy.ts` responda un `401`
 * JSON crudo cuando no hay sesión, en vez de mandar a `/login`. Eso está bien
 * para un Route Handler que consume código (`pg_cron`, `fetch`, como
 * `/api/push/procesar-recordatorios`), pero acá quien llega es una PERSONA
 * tocando una notificación en el celular: si la sesión expiró mientras tanto,
 * merece la pantalla de login con `?desde=` de vuelta a este mismo enlace
 * -exactamente como ya le pasa a `/turnos` pelado-, no un JSON en blanco. Por
 * eso el archivo vive en `turnos/enlace/`, fuera de `/api`, y no valida
 * sesión acá adentro: si llegó hasta este código es porque `proxy.ts` ya la
 * exigió antes.
 *
 * ## La decisión de seguridad: silencio total ante un uuid sin permiso
 *
 * Si `?perfil=` no tiene forma de uuid, no existe, o la sesión perdió el
 * permiso `view` sobre él, este handler NO informa nada distinto del caso
 * feliz: redirige exactamente igual, a `/turnos` pelado. Ver el comentario
 * de `cambiarPerfilDesdeParametro` (`lib/perfil-activo.ts`) para el porqué -
 * mismo principio que `ErrorPermisoDenegado` en `lib/auth/guardas.ts`, que
 * tampoco distingue "no existe" de "no tenés permiso".
 *
 * `cambiarPerfilDesdeParametro` es la pieza reutilizable: cuando el Sprint 7
 * (medicación) o el Sprint 9 (alertas) necesiten su propio deep link con
 * cambio de perfil, el patrón es un Route Handler así de chico -fuera de
 * `/api`- más esa función.
 */

import { responderEnlaceDePerfil } from "@/lib/perfil-activo"

export async function GET(request: Request) {
  return responderEnlaceDePerfil(request, "/turnos")
}
