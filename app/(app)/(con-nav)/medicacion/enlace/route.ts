/**
 * GET /medicacion/enlace — punto de entrada de los deep links a `/medicacion`
 * que necesitan cambiar el perfil activo antes de mostrar la lista (Sprint 7.4).
 *
 * Es la tercera pieza del patrón que `docs/recordatorios.md` §10 dejó descripto
 * al cerrar el Sprint 6.6, anticipando textualmente este caso: *"cuando el
 * Sprint 7 (medicación) o el Sprint 9 (alertas) necesiten su propio deep link
 * con cambio de perfil, el patrón es un Route Handler así de chico —fuera de
 * `/api`— más `cambiarPerfilDesdeParametro`"*. Este archivo es exactamente eso;
 * el gemelo es `app/(app)/(con-nav)/turnos/enlace/route.ts`, donde están
 * argumentados en detalle los tres porqués que se resumen acá:
 *
 * - **Por qué no vive en `medicacion/page.tsx`**: `fijarPerfilActivo` escribe
 *   una cookie, y Next.js solo lo permite en un Server Action o un Route
 *   Handler, nunca durante el render de un Server Component —aunque después
 *   llame a `redirect()`—.
 * - **Por qué no vive bajo `/api`**: `esRutaDeApi()` hace que `proxy.ts`
 *   responda un `401` JSON sin sesión. Eso es correcto para `pg_cron`, pero acá
 *   quien llega es una PERSONA tocando una notificación en el celular: si la
 *   sesión venció merece la pantalla de login con `?desde=` de vuelta a este
 *   mismo enlace.
 * - **Por qué siempre redirige igual**: si el uuid no tiene forma de uuid, no
 *   existe, o la sesión no tiene permiso `view` sobre él, la respuesta es
 *   idéntica a la del caso feliz. Contestar distinto convertiría el enlace en
 *   un oráculo para adivinar ids de perfiles ajenos.
 *
 * Sin este handler, María tocando el aviso de "a Roberto le quedan 4 días de
 * Enalapril" aterrizaría en SU propia medicación —una lista donde el remedio
 * del que le acaban de avisar no está—, que es el bug que la tarea correctiva
 * 6.6 resolvió para los turnos.
 */

import { responderEnlaceDePerfil } from "@/lib/perfil-activo"

export async function GET(request: Request) {
  return responderEnlaceDePerfil(request, "/medicacion")
}
