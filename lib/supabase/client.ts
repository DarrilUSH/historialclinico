/**
 * Cliente de Supabase para Client Components (navegador).
 *
 * Usa `createBrowserClient` de `@supabase/ssr` — NUNCA los paquetes de
 * integración de Supabase Auth por framework (Next.js, React, Remix,
 * SvelteKit) que quedaron deprecados en favor de `@supabase/ssr`.
 *
 * Este cliente maneja la sesión vía cookies del navegador, lo que permite
 * que el servidor (Server Components / middleware) la comparta.
 *
 * Uso: solo desde archivos con `"use client"`.
 *
 *   import { createClient } from "@/lib/supabase/client";
 *   const supabase = createClient();
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
