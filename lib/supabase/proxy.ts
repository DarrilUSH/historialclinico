/**
 * Helper del proxy (Next 16): refresca el token de sesión de Supabase en cada
 * request antes de que llegue a Server Components / Route Handlers, y devuelve
 * el usuario ya resuelto para que `proxy.ts` decida redirects sin volver a
 * preguntarle a Auth.
 *
 * Server Components no pueden escribir cookies (son de solo lectura durante
 * el render), así que el refresco del access token tiene que pasar por acá.
 * Sin esto, la sesión expira silenciosamente y `auth.getUser()` en el
 * servidor empieza a devolver `null` aunque el usuario siga "logueado" en
 * el navegador.
 *
 * Nombre del archivo: hasta Next 15 esto se llamaba `lib/supabase/middleware.ts`
 * (es el nombre que usa la documentación de Supabase). En Next 16 la
 * convención `middleware` quedó deprecada en favor de `proxy`, así que el
 * helper acompaña el renombre para que el nombre del archivo siga diciendo
 * desde dónde se lo llama.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export interface SesionDelBorde {
  /**
   * Respuesta con las cookies de sesión ya escritas. Hay que devolverla tal
   * cual, o —si se redirige— copiarle las cookies a la redirección.
   */
  respuesta: NextResponse;
  /** Usuario autenticado, o `null` si la request no trae sesión válida. */
  usuario: User | null;
}

export async function actualizarSesion(request: NextRequest): Promise<SesionDelBorde> {
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // IMPORTANTE: hay que devolver el `supabaseResponse` tal cual. Si se crea
  // un `NextResponse` nuevo acá, se pierden las cookies que se acaban de
  // setear y la sesión se corta. Cuando `proxy.ts` necesita redirigir, no
  // descarta esta respuesta: le copia las cookies a la redirección.
  return { respuesta: supabaseResponse, usuario: user };
}
