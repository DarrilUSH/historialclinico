/**
 * Helper de middleware: refresca el token de sesión de Supabase en cada
 * request antes de que llegue a Server Components / Route Handlers.
 *
 * Server Components no pueden escribir cookies (son de solo lectura durante
 * el render), así que el refresco del access token tiene que pasar por acá.
 * Sin esto, la sesión expira silenciosamente y `auth.getUser()` en el
 * servidor empieza a devolver `null` aunque el usuario siga "logueado" en
 * el navegador.
 *
 * Nota: en el Sprint 1 este helper SOLO refresca la sesión. Los redirects de
 * rutas privadas/públicas (proteger `/`, mandar a `/login`, etc.) se agregan
 * recién en el Sprint 2.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database.types";

export async function actualizarSesion(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Hay que escribir las cookies tanto en el `request` (para que las
          // vean los Server Components de esta misma request) como en el
          // `response` (para que el navegador las reciba).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // No ejecutar código entre `createServerClient` y `auth.getUser()`: un
  // error acá es muy difícil de debuggear (usuarios deslogueados al azar).
  //
  // IMPORTANTE: `getUser()` (no `getSession()`) porque valida el token
  // contra el servidor de Auth en cada llamada, en vez de confiar en lo que
  // vino en la cookie sin verificar.
  await supabase.auth.getUser();

  // IMPORTANTE: hay que devolver el `supabaseResponse` tal cual. Si se crea
  // un `NextResponse` nuevo acá, se pierden las cookies que se acaban de
  // setear y la sesión se corta.
  return supabaseResponse;
}
