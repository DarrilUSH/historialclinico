/**
 * Obtener el próximo turno NO cancelado de un perfil.
 * Se usa en `components/inicio/proximo-turno.tsx` (Sprint 6, tarea 6.3).
 *
 * Función pura de consulta: no hace autenticación ni autorización — eso lo
 * resuelve el componente o su caller. Solo devuelve el turno más próximo,
 * ordenado por `appointment_date` ascendente y con `status != 'cancelled'`.
 *
 * Si no hay turno futuro, devuelve `null`.
 */

import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import type { TurnoParaTarjeta } from "@/components/turnos/tarjeta-turno"

export async function obtenerProximoTurno(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
): Promise<TurnoParaTarjeta | null> {
  const ahora = new Date().toISOString()

  const { data, error } = await supabase
    .from("appointments")
    .select("id, specialty, doctor_name, appointment_date, location_name, location_address, status, latitude, longitude, preparation_notes")
    .eq("profile_id", perfilId)
    .neq("status", "cancelled")
    .gt("appointment_date", ahora)
    .order("appointment_date", { ascending: true })
    .limit(1)
    .single()

  if (error) {
    // `single()` devuelve PGRST116 si no hay fila: no es un error, es "no hay turno"
    if (error.code === "PGRST116") {
      return null
    }
    throw error
  }

  return data as TurnoParaTarjeta
}
