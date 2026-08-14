/**
 * Pie con los links a Privacidad y Términos (Sprint 12, tarea 12.1).
 *
 * Dos usos, con dos criterios distintos de dónde tienen que verse:
 *
 * - `app/(auth)/layout.tsx`: el criterio de aceptación del ROADMAP exige que
 *   las dos páginas sean "accesibles desde el pie sin sesión" — este pie va
 *   debajo de la tarjeta en las cuatro pantallas de `/login`, `/registro`,
 *   `/recuperar` y `/recuperar/confirmar`.
 * - `app/(app)/(con-nav)/layout.tsx`: no hay todavía una pantalla de
 *   configuración de cuenta en la app (Sprint 12 no la crea: sería agregar
 *   una sección entera fuera del alcance de esta tarea), así que "un lugar
 *   razonable no invasivo" es el pie de cada pantalla — una sola línea chica
 *   y muted, después de todo el contenido, antes del espacio reservado para
 *   la bottom nav fija.
 *
 * Es un Server Component (no necesita interactividad): los dos `<Link>`
 * alcanzan.
 */

import Link from "next/link"

export function PiePaginasLegales() {
  return (
    <p className="px-4 py-6 text-center text-sm text-muted-foreground chica:py-4">
      <Link
        href="/privacidad"
        className="underline-offset-4 hover:text-foreground hover:underline"
      >
        Política de privacidad
      </Link>
      {" · "}
      <Link
        href="/terminos"
        className="underline-offset-4 hover:text-foreground hover:underline"
      >
        Términos y condiciones
      </Link>
    </p>
  )
}
