"use client"

/**
 * El boundary que de verdad importaba para el P0 del 2026-08-19.
 *
 * Toda la sección con sesión cuelga de acá, y el punto único por el que pasa
 * es `app/(app)/(con-nav)/layout.tsx` → `obtenerPerfilActivo()` →
 * `requerirPermiso(..., "view")`. Cuando esa verificación falla —el caso
 * medido fue un desfasaje de reloj del lado de Supabase, ver
 * `lib/auth/guardas.ts`— el error lo lanza un **layout**, y un `error.tsx`
 * nunca envuelve al layout de su propio segmento. Por eso este archivo vive
 * en `app/(app)/` y no en `app/(app)/(con-nav)/`: desde acá sí queda por
 * encima de ese layout, y con él quedan cubiertas de una sola vez las ~30
 * pantallas del grupo (`/inicio`, `/estudios`, `/turnos`, `/medicación`,
 * `/familia`, `/signos`, `/coberturas`, `/médicos`, `/lugares`, `/perfil`,
 * `/sos`, `/ayuda`, `/especialidades`…) más las de `(sin-nav)` (`/perfiles`,
 * `/ficha`, `/compartir`).
 *
 * Un `error.tsx` por pantalla habría sido treinta archivos con el mismo texto
 * y treinta oportunidades de olvidarse de uno.
 */

import { PantallaError } from "@/components/base/pantalla-error"

export default function ErrorSeccionConSesion({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <PantallaError error={error} alReintentar={retry} />
}
