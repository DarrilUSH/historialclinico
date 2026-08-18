/**
 * Pie con los links a Privacidad, Términos y Ayuda (Sprint 12, tarea 12.1;
 * "¿Cómo empiezo?" sumado en la tarea #14, tutorial de bienvenida).
 *
 * Dos usos, con dos criterios distintos de dónde tienen que verse:
 *
 * - `app/(auth)/layout.tsx`: el criterio de aceptación del ROADMAP exige que
 *   las dos páginas legales sean "accesibles desde el pie sin sesión" — este
 *   pie va debajo de la tarjeta en las cuatro pantallas de `/login`,
 *   `/registro`, `/recuperar` y `/recuperar/confirmar`. `/ayuda` exige
 *   sesión (vive bajo `app/(app)/(con-nav)/`), así que en este uso el link
 *   sigue sin mostrarse -ver `esRutaSoloAnonima`/matriz de `lib/auth/rutas.ts`,
 *   nadie sin sesión puede aterrizar ahí igual-.
 * - `app/(app)/(con-nav)/layout.tsx`: no hay todavía una pantalla de
 *   configuración de cuenta en la app, así que "un lugar razonable no
 *   invasivo" es el pie de cada pantalla — una sola línea chica y muted,
 *   después de todo el contenido, antes del espacio reservado para la
 *   bottom nav fija. Acá SÍ corresponde el tercer link: es la guía completa
 *   de los seis pasos del tutorial, siempre consultable desde cualquier
 *   pantalla, no solo desde `/inicio` (que además tiene su propio link
 *   dentro del contenido — ver el comentario de esa pantalla para por qué
 *   uno no reemplaza al otro).
 *
 * `mostrarAyuda` (default `true`) es lo que permite reusar este mismo
 * componente en `app/(auth)/layout.tsx` sin duplicar el marcado de los dos
 * links legales: ese layout lo pasa en `false` en vez de que este archivo
 * intente adivinar en qué route group está montado.
 *
 * Es un Server Component (no necesita interactividad): los `<Link>` alcanzan.
 */

import Link from "next/link"

export function PiePaginasLegales({ mostrarAyuda = true }: { mostrarAyuda?: boolean }) {
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
      {mostrarAyuda && (
        <>
          {" · "}
          <Link href="/ayuda" className="underline-offset-4 hover:text-foreground hover:underline">
            ¿Cómo empiezo?
          </Link>
        </>
      )}
    </p>
  )
}
