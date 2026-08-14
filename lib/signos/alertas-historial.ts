import "server-only"

/**
 * Lectura de TODAS las `vital_sign_alerts` de un perfil -vistas o no- para
 * `/signos/historial` (Sprint 9, tarea 9.4).
 *
 * Distinta a propósito de `lib/signos/alertas-sin-ver.ts` (el banner de la
 * 9.3, que filtra `acknowledged_at is null`): el historial tiene que seguir
 * marcando como "fuera de umbral" una medición vieja aunque alguien ya haya
 * tocado "Ya lo vi" en su momento -`acknowledged_at` es del BANNER, no borra
 * el hecho clínico-. Mismo espíritu defensivo que el resto de `lib/signos/`:
 * devuelve `[]` ante cualquier error de lectura en vez de lanzar, porque el
 * historial puede mostrarse sin marcas antes que no mostrarse.
 *
 * RLS (`vital_sign_alerts_select_administrador`, titular o `can_manage`) es
 * la última palabra: quien entra con `can_upload` o `can_view` sin
 * `can_manage` recibe `[]` acá -mismo comportamiento que ya documenta
 * `alertas-sin-ver.ts`-, así que su gráfico se ve sin puntos marcados. Es
 * consistente con el resto del producto: `docs/modelo-permisos.md` §4.3,
 * "quien no recibe el aviso tampoco ve la fila que lo generó".
 */

import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import type { FilaAlertaParaSerie } from "@/lib/signos/series"

const COLUMNAS = "vital_sign_id, regla, valor, umbral, referencia"

/** Todas las alertas del perfil, sin filtrar por tipo ni por vista -`lib/signos/series.ts#construirSerieSigno` las cruza por `vital_sign_id`-. */
export async function obtenerAlertasDeSignos(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
): Promise<FilaAlertaParaSerie[]> {
  const { data, error } = await supabase.from("vital_sign_alerts").select(COLUMNAS).eq("profile_id", perfilId)

  if (error) {
    console.error(`[signos] Fallo al leer las alertas del historial del perfil ${perfilId}:`, error)
    return []
  }

  return (data ?? []).map((fila) => ({
    vitalSignId: fila.vital_sign_id,
    regla: fila.regla,
    valor: fila.valor,
    umbral: fila.umbral,
    referencia: fila.referencia,
  }))
}
