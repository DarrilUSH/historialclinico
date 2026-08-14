/**
 * Lectura de `vital_sign_alerts` sin ver, para el banner persistente de la
 * tarea 9.3 (`components/signos/banner-alerta.tsx`).
 *
 * Mismo espíritu defensivo que `lib/signos/consultas.ts`: devuelve `[]` ante
 * cualquier error de lectura en vez de lanzar, porque el banner nunca puede
 * ser la razón por la que `/signos` o `/inicio` dejan de renderizar el resto
 * de la pantalla.
 *
 * La consulta es literal la que documenta `docs/modelo-signos.md` §10:
 * `where profile_id = :perfil and acknowledged_at is null`, servida por el
 * índice parcial `vital_sign_alerts_sin_ver_idx (profile_id, created_at desc)
 * where acknowledged_at is null`. RLS (`vital_sign_alerts_select_administrador`)
 * es la última palabra: esta función no filtra por permiso, así que quien la
 * llama sin `can_manage` sobre el perfil simplemente recibe `[]` -y por eso
 * las pantallas igual guardan la llamada detrás de `activo.permisos.canManage`,
 * para no gastar una consulta que la base va a vaciar de todos modos-.
 */

import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import type { ReglaAlerta } from "@/lib/signos/evaluar"

/** Lo mínimo que el banner necesita de cada alerta: el texto ya redactado (con el descargo) y el `id` para marcarla vista. */
export interface AlertaSinVer {
  id: string
  mensaje: string
  regla: ReglaAlerta
  createdAt: string
}

const COLUMNAS = "id, mensaje, regla, created_at"

/**
 * Todas las alertas sin ver de `perfilId`, más recientes primero -mismo orden
 * que documenta el modelo-. Sin límite: el volumen real está acotado por el
 * antidup `(vital_sign_id, regla)` y por el hecho de que cada carga notifica
 * de inmediato, así que acumular decenas de alertas sin ver exigiría que
 * nadie abriera la app en días.
 */
export async function obtenerAlertasSinVer(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
): Promise<AlertaSinVer[]> {
  const { data, error } = await supabase
    .from("vital_sign_alerts")
    .select(COLUMNAS)
    .eq("profile_id", perfilId)
    .is("acknowledged_at", null)
    .order("created_at", { ascending: false })

  if (error) {
    console.error(`[signos] Fallo al leer las alertas sin ver del perfil ${perfilId}:`, error)
    return []
  }

  return (data ?? []).map((fila) => ({
    id: fila.id,
    mensaje: fila.mensaje,
    regla: fila.regla,
    createdAt: fila.created_at,
  }))
}
