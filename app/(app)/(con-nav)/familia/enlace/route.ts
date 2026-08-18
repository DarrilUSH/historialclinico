/**
 * GET /familia/enlace — deep link a `/familia` que primero fija el perfil
 * PROPIO de la cuenta como activo, y aterriza directo en la sección
 * "Invitar a alguien" (tarea #14, tutorial de bienvenida).
 *
 * ## Por qué hace falta
 *
 * La sección de accesos de `/familia` opera sobre el perfil ACTIVO
 * (`SeccionAccesosDelPerfilActivo`), pero el consejo "Compartí con tu
 * familia" (`lib/consejos/servidor.ts`) evalúa si el perfil PROPIO de la
 * cuenta otorgó algún permiso -nunca el activo-, con el mismo criterio que
 * el resto del tutorial: los consejos son de la cuenta, no de a quién se
 * está mirando. Sin este enlace, alguien viendo el historial de otra
 * persona que tocara el CTA terminaría invitando gente al perfil AJENO que
 * tenía activo, no al propio -mismo problema, mismo motivo y misma solución
 * que `/perfil/sos/enlace`, cuyo encabezado tiene el detalle completo-.
 *
 * El consejo "¿Un hijo o un padre sin celular?" (crear un perfil gestionado)
 * NO pasa por acá: esa sección de `/familia` es independiente del perfil
 * activo -se renderiza siempre, para cualquiera- así que su CTA es un
 * `<Link href="/familia#crear-perfil-gestionado">` directo
 * (`lib/consejos/contenido.ts`).
 *
 * `#invitar` es el `id` de esa sección en `app/(app)/(con-nav)/familia/page.tsx`.
 */

import { redirect } from "next/navigation"

import { cambiarPerfilDesdeParametro, obtenerPerfilActivo } from "@/lib/perfil-activo"

export async function GET(request: Request) {
  const perfilParam = new URL(request.url).searchParams.get("perfil")

  if (perfilParam) {
    const activo = await obtenerPerfilActivo()
    await cambiarPerfilDesdeParametro(perfilParam, activo?.perfil.id ?? null)
  }

  redirect("/familia#invitar")
}
