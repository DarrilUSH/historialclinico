import "server-only"

/**
 * Tomas de HOY de un perfil, para las dos integraciones que pide la tarea
 * 7.3 (ROADMAP_SPRINTS.md): la sección "Tomas de hoy" de
 * `app/(app)/(con-nav)/medicacion/page.tsx` y el resumen mínimo de la card
 * de medicación en `app/(app)/(con-nav)/inicio/page.tsx`. Una sola función
 * compartida para que las dos pantallas usen exactamente el mismo criterio
 * de "hoy" — nunca dos consultas que puedan divergir en la zona horaria.
 *
 * "Hoy" es el día de pared en `America/Argentina/Ushuaia`, el mismo criterio
 * que `generar_tomas_del_dia()` usa para MATERIALIZAR las tomas
 * (`docs/modelo-medicacion.md` §7.1) y que `revertir_toma()` usa para decidir
 * si una toma todavía se puede deshacer (`docs/modelo-medicacion.md` §6). Se
 * calcula el rango `[00:00, 24:00)` de hoy en Ushuaia con
 * `lib/turnos/fecha.ts#combinarFechaHoraUshuaia` (el mismo borde fecha+hora
 * de pared → instante UTC que ya usa `turnos`) y se compara contra
 * `scheduled_at` — la app nunca reimplementa el cálculo de zona horaria a
 * mano.
 *
 * `medication_intakes` no trae el nombre ni la dosis de la medicación (esos
 * datos viven en `medications`), así que se resuelven con una segunda
 * consulta chica y se mergean en memoria — sin usar el embedding de
 * PostgREST porque el tipo generado (`types/database.types.ts`) declara DOS
 * relaciones con el mismo nombre de constraint para `medication_id` (una a
 * `medications`, otra a la vista `v_medicacion_estado`), lo que produciría un
 * embed ambiguo. Dos consultas explícitas son más simples que desambiguar
 * ese hint.
 */

import { combinarFechaHoraUshuaia, hoyIsoUshuaia } from "@/lib/turnos/fecha"
import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import type { EstadoIntakeToma } from "@/lib/medicacion/formato-toma"

export interface TomaDeHoy {
  id: string
  medicationId: string
  medicationName: string
  doseAmount: number | null
  doseUnit: string | null
  scheduledAt: string
  status: EstadoIntakeToma
  takenAt: string | null
}

/**
 * Tomas de `perfilId` con `scheduled_at` dentro del día de hoy en Ushuaia,
 * ordenadas por hora programada. RLS (`medication_intakes_select_puede_ver` /
 * `medications_select_puede_ver`) sigue siendo la última palabra: esta
 * función no filtra por permiso, corre con el cliente de la sesión y
 * devuelve exactamente lo que la base ya le deja ver a quien llama.
 *
 * Devuelve `[]` ante cualquier error de lectura -mismo criterio "defensivo,
 * no bloqueante" que `obtenerProximoTurno`- porque esta lista es siempre un
 * complemento (sección o resumen), nunca el contenido principal de la
 * pantalla que la llama.
 */
export async function obtenerTomasDeHoy(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
): Promise<TomaDeHoy[]> {
  const inicio = combinarFechaHoraUshuaia(hoyIsoUshuaia(), "00:00")
  if (!inicio) return []
  const fin = new Date(inicio.getTime() + 24 * 60 * 60 * 1000)

  const { data: tomas, error } = await supabase
    .from("medication_intakes")
    .select("id, medication_id, scheduled_at, status, taken_at")
    .eq("profile_id", perfilId)
    .gte("scheduled_at", inicio.toISOString())
    .lt("scheduled_at", fin.toISOString())
    .order("scheduled_at", { ascending: true })

  if (error) {
    console.error("[medicacion] Fallo al leer las tomas de hoy:", error)
    return []
  }
  if (!tomas || tomas.length === 0) {
    return []
  }

  const idsMedicacion = Array.from(new Set(tomas.map((toma) => toma.medication_id)))

  const { data: medicaciones, error: errorMedicaciones } = await supabase
    .from("medications")
    .select("id, name, dose_amount, dose_unit")
    .in("id", idsMedicacion)

  if (errorMedicaciones) {
    console.error(
      "[medicacion] Fallo al leer las medicaciones de las tomas de hoy:",
      errorMedicaciones,
    )
  }

  const medicacionPorId = new Map((medicaciones ?? []).map((med) => [med.id, med]))

  return tomas.map((toma) => {
    const medicacion = medicacionPorId.get(toma.medication_id)
    return {
      id: toma.id,
      medicationId: toma.medication_id,
      medicationName: medicacion?.name ?? "Medicación",
      doseAmount: medicacion?.dose_amount ?? null,
      doseUnit: medicacion?.dose_unit ?? null,
      scheduledAt: toma.scheduled_at,
      status: toma.status,
      takenAt: toma.taken_at,
    }
  })
}
