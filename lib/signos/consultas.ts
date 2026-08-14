import "server-only"

/**
 * Lecturas de `vital_signs` para `/signos` y `/signos/nuevo` (Sprint 9, tarea
 * 9.1). Dos funciones, las dos defensivas -devuelven `[]`/`null` ante
 * cualquier error de lectura, mismo criterio "defensivo, no bloqueante" que
 * `lib/medicacion/tomas-de-hoy.ts` y `lib/turnos/obtener-proximo.ts`-, porque
 * ninguna es el contenido principal de la pantalla: el listado de `/signos`
 * puede mostrarse vacío y los tres botones de carga seguir andando, y el
 * prefill de `/signos/nuevo` puede faltar sin que eso bloquee cargar una
 * medición nueva.
 *
 * RLS (`vital_signs_select_puede_ver`) sigue siendo la última palabra: estas
 * funciones no filtran por permiso, corren con el cliente de la sesión y
 * devuelven exactamente lo que la base ya le deja ver a quien llama.
 */

import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import { DB_A_TIPO, TIPO_A_DB, TIPOS_SIGNO, type SignoTipo } from "@/lib/signos/tipos"

export interface MedicionSigno {
  id: string
  tipo: SignoTipo
  systolic: number | null
  diastolic: number | null
  pulse: number | null
  value: number | null
  /** `measured_at`, ISO con offset -listo para `lib/turnos/formato.ts` y `lib/turnos/tiempo-relativo.ts`, que son de zona horaria, no de dominio de turnos. */
  measuredAt: string
}

const COLUMNAS = "id, type, systolic, diastolic, pulse, value, measured_at"

interface FilaVitalSign {
  id: string
  type: string
  systolic: number | null
  diastolic: number | null
  pulse: number | null
  value: number | null
  measured_at: string
}

function filaAMedicion(fila: FilaVitalSign): MedicionSigno {
  return {
    id: fila.id,
    tipo: DB_A_TIPO[fila.type as keyof typeof DB_A_TIPO],
    systolic: fila.systolic,
    diastolic: fila.diastolic,
    pulse: fila.pulse,
    value: fila.value,
    measuredAt: fila.measured_at,
  }
}

/**
 * La medición más reciente de `tipo` para `perfilId`, o `null` si nunca se
 * cargó ninguna. Fuente del prefill de `/signos/nuevo` -criterio de
 * aceptación del roadmap: "valores por defecto tomados de la última carga"-.
 */
export async function obtenerUltimaMedicion(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
  tipo: SignoTipo,
): Promise<MedicionSigno | null> {
  const { data, error } = await supabase
    .from("vital_signs")
    .select(COLUMNAS)
    .eq("profile_id", perfilId)
    .eq("type", TIPO_A_DB[tipo])
    .order("measured_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error(`[signos] Fallo al leer la última medición de ${tipo}:`, error)
    return null
  }
  return data ? filaAMedicion(data) : null
}

/**
 * Últimas `porTipo` mediciones de CADA tipo para `perfilId`, ya agrupadas y
 * ordenadas de más reciente a más vieja -la lista de `/signos`, "últimos
 * valores primero" por el criterio de aceptación-.
 *
 * Tres consultas en paralelo filtradas por tipo (usa el índice
 * `vital_signs_profile_tipo_fecha_idx (profile_id, type, measured_at desc)`
 * de la migración), en vez de una sola consulta ordenada global: así un tipo
 * con muchas cargas recientes no puede desplazar a otro de la primera
 * página, cada tipo siempre trae SUS últimas `porTipo` mediciones.
 */
export async function obtenerUltimasMedicionesPorTipo(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
  porTipo = 5,
): Promise<Record<SignoTipo, MedicionSigno[]>> {
  const resultados = await Promise.all(
    TIPOS_SIGNO.map((tipo) =>
      supabase
        .from("vital_signs")
        .select(COLUMNAS)
        .eq("profile_id", perfilId)
        .eq("type", TIPO_A_DB[tipo])
        .order("measured_at", { ascending: false })
        .limit(porTipo),
    ),
  )

  const agrupado = {} as Record<SignoTipo, MedicionSigno[]>
  TIPOS_SIGNO.forEach((tipo, indice) => {
    const { data, error } = resultados[indice]!
    if (error) {
      console.error(`[signos] Fallo al leer las últimas mediciones de ${tipo}:`, error)
    }
    agrupado[tipo] = data ? data.map(filaAMedicion) : []
  })
  return agrupado
}
