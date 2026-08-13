/**
 * Proxy raíz (Next 16 — antes `middleware.ts`, convención deprecada en la
 * 16.0 y migrada con `npx @next/codemod middleware-to-proxy .`).
 *
 * Hace dos cosas en cada request no estática:
 *
 * 1. **Refresca la sesión de Supabase** (`lib/supabase/proxy.ts`). Es el único
 *    lugar de la app que puede escribir las cookies del token refrescado.
 * 2. **Aplica la matriz de rutas** de `lib/auth/rutas.ts`:
 *    - sin sesión + ruta privada → `307` a `/login?desde=<ruta original>`
 *      (o `401` JSON si la ruta es un Route Handler bajo `/api`);
 *    - con sesión + `/login` o `/registro` → `307` a `/perfiles`.
 *
 * **El proxy no es la única defensa, es la primera.** Corre en el borde y
 * decide con la cookie: sirve para no renderizar pantallas privadas y para
 * mandar a la persona al lugar correcto, pero no autoriza nada. La
 * autorización real vive en RLS (base) y en `lib/auth/guardas.ts`
 * (`requerirSesion` / `requerirPermiso`), que revalidan del lado del servidor
 * en cada Server Component y en cada Server Action. La documentación de Next
 * es explícita al respecto: las Server Functions son POST a la ruta donde se
 * usan, así que un cambio de `matcher` puede sacarles la cobertura del proxy
 * sin que nadie lo note.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  PARAM_DESDE,
  RUTA_LOGIN,
  RUTA_POST_LOGIN,
  esRutaDeApi,
  esRutaPublica,
  esRutaSoloAnonima,
} from "@/lib/auth/rutas";
import { actualizarSesion } from "@/lib/supabase/proxy";

/**
 * Redirige sin perder las cookies que acaba de escribir el refresco de
 * sesión. `NextResponse.redirect` crea una respuesta nueva y vacía: si no se
 * le copian las cookies, el token refrescado se pierde y la persona termina
 * rebotando entre `/login` y `/perfiles`.
 */
function redirigirConservandoCookies(
  destino: URL,
  respuestaConCookies: NextResponse,
): NextResponse {
  const redireccion = NextResponse.redirect(destino);
  for (const cookie of respuestaConCookies.cookies.getAll()) {
    redireccion.cookies.set(cookie);
  }
  return redireccion;
}

export async function proxy(request: NextRequest) {
  const { respuesta, usuario } = await actualizarSesion(request);
  const { pathname, search } = request.nextUrl;

  // Sin sesión en ruta privada.
  if (!usuario && !esRutaPublica(pathname)) {
    // Un Route Handler no se redirige a una pantalla de login: quien lo
    // consume es código (fetch, curl, el service worker), y necesita un
    // estado HTTP que pueda interpretar.
    if (esRutaDeApi(pathname)) {
      return NextResponse.json(
        { error: "Necesitás iniciar sesión para acceder a este recurso." },
        { status: 401 },
      );
    }

    const destino = request.nextUrl.clone();
    destino.pathname = RUTA_LOGIN;
    destino.search = "";
    // Se guarda la ruta completa (con su query) para poder devolver a la
    // persona exactamente a donde quería ir. `destinoSeguro` valida el valor
    // del otro lado, antes de usarlo para redirigir.
    destino.searchParams.set(PARAM_DESDE, `${pathname}${search}`);
    return redirigirConservandoCookies(destino, respuesta);
  }

  // Con sesión en una pantalla que solo tiene sentido sin sesión.
  if (usuario && esRutaSoloAnonima(pathname)) {
    const destino = request.nextUrl.clone();
    destino.pathname = RUTA_POST_LOGIN;
    destino.search = "";
    return redirigirConservandoCookies(destino, respuesta);
  }

  return respuesta;
}

export const config = {
  matcher: [
    /*
     * Corré el proxy en todas las rutas EXCEPTO:
     * - _next/static (archivos estáticos del build)
     * - _next/image (imágenes optimizadas por Next.js)
     * - favicon.ico
     * - archivos de imagen (svg, png, jpg, jpeg, gif, webp)
     *
     * OJO: `/api` NO se excluye. Los Route Handlers privados tienen que
     * pasar por acá para responder 401 sin cookie (ver `esRutaDeApi`).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
