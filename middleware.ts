/**
 * Middleware raíz: refresca la sesión de Supabase en cada request que no sea
 * un estático (JS/CSS de `_next`, imágenes optimizadas, favicon, etc.).
 *
 * Sprint 1: solo refresco de token, sin redirects de auth. Las rutas
 * privadas (redirigir a `/login` si no hay sesión, o a `/` si ya está
 * logueado) se agregan en el Sprint 2, dentro de este mismo middleware.
 */

import { type NextRequest } from "next/server";
import { actualizarSesion } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await actualizarSesion(request);
}

export const config = {
  matcher: [
    /*
     * Corré el middleware en todas las rutas EXCEPTO:
     * - _next/static (archivos estáticos del build)
     * - _next/image (imágenes optimizadas por Next.js)
     * - favicon.ico
     * - archivos de imagen (svg, png, jpg, jpeg, gif, webp)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
