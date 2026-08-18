import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"

/**
 * Ciudad y provincia más recientes que cargó el perfil, para PRECARGAR (no
 * imponer) el formulario de alta de turno o médico (Sprint 16, tarea 16.1).
 *
 * Es el reemplazo explícito del viejo default fijo -"Ushuaia" hardcodeado en
 * `lib/logistica/deep-links.ts#linkComoLlegar`, ver el comentario de cabecera
 * de ese archivo-: en vez de asumir una ciudad fija para TODO el mundo, se
 * sugiere la última que ESE perfil efectivamente usó, siempre editable, y si
 * el perfil nunca cargó ninguna, el formulario arranca vacío -nunca con un
 * valor inventado-.
 *
 * Mira, en paralelo, el turno más reciente con `location_city` cargada y el
 * médico más reciente con `city` cargada, y devuelve el más nuevo de los dos
 * que exista (por `created_at`). `null` si ninguno de los dos existe.
 */
export interface UbicacionConocida {
  ciudad: string
  provincia: string
}

interface CandidatoUbicacion extends UbicacionConocida {
  creadoEn: string
}

export async function obtenerUltimaUbicacionConocida(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
): Promise<UbicacionConocida | null> {
  const [{ data: turno }, { data: medico }] = await Promise.all([
    supabase
      .from("appointments")
      .select("location_city, location_province, created_at")
      .eq("profile_id", perfilId)
      .not("location_city", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("doctors")
      .select("city, province, created_at")
      .eq("profile_id", perfilId)
      .not("city", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const candidatos: CandidatoUbicacion[] = []
  if (turno?.location_city) {
    candidatos.push({
      ciudad: turno.location_city,
      provincia: turno.location_province ?? "",
      creadoEn: turno.created_at,
    })
  }
  if (medico?.city) {
    candidatos.push({
      ciudad: medico.city,
      provincia: medico.province ?? "",
      creadoEn: medico.created_at,
    })
  }

  if (candidatos.length === 0) return null

  candidatos.sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1))
  const { ciudad, provincia } = candidatos[0]
  return { ciudad, provincia }
}
