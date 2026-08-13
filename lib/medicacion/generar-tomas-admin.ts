import "server-only"

/**
 * Llama a `generar_tomas_del_dia()` — EXCLUSIVAMENTE SERVIDOR (Sprint 7,
 * tarea 7.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. Mismo contrato que
 *      `lib/storage-admin.ts` y `lib/push/servidor.ts`: jamás se importa
 *      desde código cliente.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `generar_tomas_del_dia(fecha)` está otorgada solo a `service_role`
 * (`supabase/migrations/20260813060000_medicacion_estado.sql` §5: "NO va
 * para `authenticated`: recorre todos los perfiles de la base, y esa no es
 * una operación de sesión de usuario"), así que el cliente normal del
 * usuario (`requerirPermiso` en `app/(app)/(con-nav)/medicacion/actions.ts`)
 * no puede llamarla — devolvería `42501`. Este módulo es el único punto de
 * la app que la invoca a demanda, cuando `crearMedicacion` necesita que las
 * tomas de HOY existan sin esperar al job de `pg_cron` de las 00:05 Ushuaia
 * (`docs/modelo-medicacion.md` §9, contrato de la tarea 7.2).
 *
 * No autoriza nada: es un barrido idempotente (`ON CONFLICT DO NOTHING`
 * sobre el UNIQUE de `medication_intakes`) que recorre TODAS las
 * medicaciones activas de TODOS los perfiles, no solo la recién creada —
 * llamarla de más nunca duplica una toma.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/medicacion/generar-tomas-admin.ts se importó desde el navegador. Este módulo usa la " +
      "SERVICE_ROLE_KEY y sólo puede ejecutarse en el servidor.",
  )
}

let clienteCache: SupabaseClient<Database> | null = null

function clienteAdmin(): SupabaseClient<Database> {
  if (clienteCache) return clienteCache

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error("Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL.")
  if (!serviceRoleKey) {
    throw new Error("Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY.")
  }

  clienteCache = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return clienteCache
}

/**
 * Materializa las tomas del día de pared de Ushuaia (default de la función
 * SQL) para todas las medicaciones activas y vigentes. Devuelve cuántas
 * filas creó de verdad. Lanza si la base responde con error — quien llama
 * (`crearMedicacion`) la trata como best-effort y no bloquea el alta por
 * esto: el cron nocturno la alcanza igual.
 */
export async function generarTomasDelDiaComoServicio(): Promise<number> {
  const { data, error } = await clienteAdmin().rpc("generar_tomas_del_dia")

  if (error) {
    throw new Error(`generar_tomas_del_dia() falló: ${error.message}`)
  }

  return data ?? 0
}
