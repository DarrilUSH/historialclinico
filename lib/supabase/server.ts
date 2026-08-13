/**
 * Cliente de Supabase para contexto de servidor (Server Components, Server
 * Actions, Route Handlers).
 *
 * Usa `createServerClient` de `@supabase/ssr` con el store de cookies de
 * `next/headers`. NUNCA los paquetes de integración de Supabase Auth por
 * framework que quedaron deprecados en favor de `@supabase/ssr`.
 *
 * Importante: `cookies()` de Next.js es de solo lectura dentro de un Server
 * Component — por eso `setAll` va envuelto en try/catch. Si este cliente
 * intenta refrescar el token desde un Server Component, el `set` falla
 * silenciosamente ahí, pero el proxy (`lib/supabase/proxy.ts`, invocado desde
 * `proxy.ts` en la raíz) ya se encarga de refrescar y persistir la sesión en
 * cada request, así que no hace falta que Server Components puedan escribir
 * cookies.
 *
 * Uso: solo desde código de servidor (sin `"use client"`).
 *
 *   import { createClient } from "@/lib/supabase/server";
 *   const supabase = await createClient();
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` fue llamado desde un Server Component: se puede
            // ignorar porque el middleware ya refresca la sesión en cada
            // request (ver lib/supabase/middleware.ts).
          }
        },
      },
    },
  );
}
