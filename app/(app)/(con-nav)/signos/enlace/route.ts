/**
 * GET /signos/enlace — punto de entrada de los deep links a `/signos` que
 * necesitan cambiar el perfil activo antes de mostrar el banner de alertas
 * (Sprint 9, tarea 9.3).
 *
 * Calcado de `app/(app)/(con-nav)/medicacion/enlace/route.ts` (Sprint 7.4),
 * que a su vez es el patrón que `docs/recordatorios.md` §10 anticipó
 * textualmente para este caso: *"cuando el Sprint 9 (alertas) necesite su
 * propio deep link con cambio de perfil, el patrón es un Route Handler así de
 * chico —fuera de `/api`— más `cambiarPerfilDesdeParametro`"*. Los tres
 * porqués (por qué acá y no en `signos/page.tsx`, por qué fuera de `/api`,
 * por qué siempre redirige igual) están argumentados en detalle en el
 * gemelo de medicación; se resumen igual acá:
 *
 * - **Por qué no vive en `signos/page.tsx`**: `fijarPerfilActivo` escribe una
 *   cookie, y Next.js solo lo permite en un Server Action o un Route Handler,
 *   nunca durante el render de un Server Component —aunque después llame a
 *   `redirect()`—.
 * - **Por qué no vive bajo `/api`**: `esRutaDeApi()` hace que `proxy.ts`
 *   responda un `401` JSON sin sesión. Correcto para `pg_cron`, pero acá quien
 *   llega es una PERSONA tocando una notificación de push en el celular: si
 *   la sesión venció merece la pantalla de login con `?desde=` de vuelta a
 *   este mismo enlace.
 * - **Por qué siempre redirige igual**: uuid con forma inválida, perfil
 *   inexistente o sesión sin permiso `view` sobre él responden EXACTAMENTE
 *   igual que el caso feliz. Contestar distinto convertiría el enlace en un
 *   oráculo para adivinar ids de perfiles ajenos.
 *
 * Sin este handler, María con su propio perfil activo tocando el push de
 * "Tensión alta registrada para Roberto" aterrizaría en SUS PROPIOS signos
 * vitales — una pantalla sin el banner que le acaban de avisar.
 */

import { redirect } from "next/navigation"

import { cambiarPerfilDesdeParametro, obtenerPerfilActivo } from "@/lib/perfil-activo"

export async function GET(request: Request) {
  const perfilParam = new URL(request.url).searchParams.get("perfil")

  if (perfilParam) {
    // `obtenerPerfilActivo` revalida el perfil activo ACTUAL contra la base
    // (nunca confía en la cookie sola); su único uso acá es el id, para que
    // `cambiarPerfilDesdeParametro` pueda saltear el cambio -y la auditoría
    // que dispara- cuando el parámetro ya coincide con el perfil activo.
    const activo = await obtenerPerfilActivo()
    await cambiarPerfilDesdeParametro(perfilParam, activo?.perfil.id ?? null)
  }

  redirect("/signos")
}
