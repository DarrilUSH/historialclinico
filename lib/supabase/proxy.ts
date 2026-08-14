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
import type { AuthError, User } from "@supabase/supabase-js";
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

/**
 * Códigos de `AuthApiError` que significan **"la cookie que trajo esta request
 * ya no sirve"**, no "algo salió mal". Los tres los devuelve GoTrue al
 * intentar refrescar con un token que ya no existe del lado del servidor:
 * quedó revocado por un `signOut` (`refresh_token_not_found`), otra pestaña ya
 * lo canjeó (`refresh_token_already_used`) o la sesión caducó entera
 * (`session_expired`).
 *
 * `validation_failed` NO entra por código —es genérico de GoTrue y también
 * cubre cuerpos mal formados que sí querríamos ver—, pero sí entra cuando el
 * mensaje habla del refresh token: es lo que responde ante una cookie
 * corrupta o manipulada, que para nosotros es el mismo caso.
 *
 * Auditoría de seguridad 11.4 (`docs/auditoria-seguridad.md`, hallazgo A-03).
 */
const CODIGOS_DE_SESION_INSERVIBLE = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_expired",
]);

/**
 * Se exporta solo para `tests/unit/sesion-inservible.test.ts`: es la frontera
 * exacta entre "esto es ruido esperado" y "esto hay que mirarlo", y una
 * frontera de seguridad que se ensancha sin querer deja de avisar cuando algo
 * pasa de verdad.
 */
export function esSesionInservible(error: AuthError): boolean {
  if (error.code && CODIGOS_DE_SESION_INSERVIBLE.has(error.code)) {
    return true;
  }
  return error.code === "validation_failed" && /refresh token/i.test(error.message);
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
    error,
  } = await supabase.auth.getUser();

  // Una cookie vieja —de una pestaña que quedó abierta después de cerrar
  // sesión, típicamente— no es un error de la aplicación: es el flujo normal
  // de "esta request no tiene sesión". Se anota en una línea, a nivel info,
  // para que quien lea el log entienda de dónde salió el `AuthApiError` que
  // `@supabase/auth-js` imprime por su cuenta desde `_recoverAndRefresh()`
  // (dos veces por request, con stack completo) y no lo persiga como si
  // fuera un incidente.
  //
  // No se silencia ese stack: hacerlo exigiría parchear `console` —un global
  // compartido por todas las requests en vuelo— y el riesgo de tragarse un
  // error ajeno es peor que el ruido. Lo que sí se hace es que deje de
  // repetirse: `auth-js` borra la cookie inservible al detectarla, y
  // `proxy.ts` propaga ese borrado también en la respuesta `401` de los Route
  // Handlers (antes solo lo hacía en las redirecciones), así que la pestaña
  // vieja paga esto UNA vez y no en cada request.
  //
  // `AuthSessionMissingError` —simplemente no hay cookie— no se registra:
  // es el caso de cualquier visitante anónimo y llenaría el log.
  if (error && esSesionInservible(error)) {
    console.info(
      `[auth] Cookie de sesión inservible (${error.code}) en ${request.nextUrl.pathname}: ` +
        "se responde sin sesión y se limpia la cookie. Flujo normal, no es un error.",
    );
  }

  // IMPORTANTE: hay que devolver el `supabaseResponse` tal cual. Si se crea
  // un `NextResponse` nuevo acá, se pierden las cookies que se acaban de
  // setear y la sesión se corta. Cuando `proxy.ts` necesita redirigir, no
  // descarta esta respuesta: le copia las cookies a la redirección.
  return { respuesta: supabaseResponse, usuario: user };
}
