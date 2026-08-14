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
 * Copia a `destino` las cookies que escribió el refresco de sesión.
 * `NextResponse.redirect` y `NextResponse.json` crean respuestas nuevas y
 * vacías: si no se les copian las cookies, se pierde lo que `actualizarSesion`
 * acaba de decidir sobre la sesión.
 *
 * Son DOS cosas distintas las que se pierden, y las dos importan:
 *
 * 1. El **token refrescado**. Sin esto la persona termina rebotando entre
 *    `/login` y `/perfiles`.
 * 2. El **borrado de una cookie inservible**. Cuando el refresh token ya no
 *    existe (cerró sesión en otra pestaña), `@supabase/auth-js` borra la
 *    cookie: es un `Set-Cookie` con `Max-Age=0` que viaja por el mismo canal.
 */
function conCookiesDe(destino: NextResponse, respuestaConCookies: NextResponse): NextResponse {
  for (const cookie of respuestaConCookies.cookies.getAll()) {
    destino.cookies.set(cookie);
  }
  return destino;
}

function redirigirConservandoCookies(
  destino: URL,
  respuestaConCookies: NextResponse,
): NextResponse {
  return conCookiesDe(NextResponse.redirect(destino), respuestaConCookies);
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
      // `conCookiesDe` no es decorativo acá (auditoría de seguridad 11.4,
      // hallazgo A-03): esta rama devolvía un `NextResponse` nuevo y tiraba
      // las cookies de `respuesta`. Cuando la cookie que llegó ya no sirve
      // —una pestaña abierta desde antes del logout—, `@supabase/auth-js` la
      // borra y ese borrado viajaba solo en las redirecciones. Un cliente que
      // pega contra `/api` (el service worker, un `fetch` en reintento)
      // conservaba la cookie muerta y volvía a pedirle a GoTrue que la
      // refrescara en CADA request, para siempre: tráfico al servidor de Auth
      // sin ningún propósito y dos stack traces por request en el log,
      // tapando errores de verdad.
      return conCookiesDe(
        NextResponse.json(
          { error: "Necesitás iniciar sesión para acceder a este recurso." },
          { status: 401 },
        ),
        respuesta,
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
