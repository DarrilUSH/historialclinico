import "server-only"

/**
 * Evalúa una medición recién cargada contra los umbrales del perfil y persiste
 * las alertas — EXCLUSIVAMENTE SERVIDOR (Sprint 9, tarea 9.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. Mismo contrato que
 *      `lib/medicacion/generar-tomas-admin.ts`, `lib/storage-admin.ts` y
 *      `lib/push/servidor.ts`: jamás se importa desde código cliente.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué el servicio y no el cliente de la sesión
 *
 * `vital_sign_alerts` no tiene política de `INSERT` y `authenticated` no tiene
 * el privilegio: un `insert` con el cliente del usuario devolvería `42501`. La
 * decisión y sus tres motivos están argumentados en el encabezado de
 * `supabase/migrations/20260814080000_signos_umbrales.sql`; el resumen es que
 * RLS puede autorizar a un autor pero no puede verificar que la alerta describa
 * de verdad a su medición, y esta tabla se convierte en un push a la familia.
 *
 * ## Por qué recibe un id y relee todo
 *
 * `registrarSigno` tiene los valores validados en la mano y podría pasarlos.
 * No lo hace a propósito: la alerta es un registro clínico sobre lo que quedó
 * PERSISTIDO —después de los `CHECK` de `vital_signs` y del `measured_at` que
 * la base efectivamente guardó—, no sobre lo que había en memoria antes del
 * viaje. Releer cuesta una consulta y elimina de raíz la clase de bug "la
 * alerta dice 170 pero la fila guardó otra cosa". De paso vuelve al módulo
 * reutilizable por un backfill: cualquier `vital_signs.id` sirve.
 *
 * ## Best-effort, siempre
 *
 * Quien llama (`registrarSigno`) envuelve esta función en un `try/catch` y NO
 * bloquea la carga si falla, igual que `crearMedicacion` con
 * `generarTomasDelDiaComoServicio()`. Una medición guardada sin su alerta es un
 * problema; una medición que no se guarda porque la alerta falló es peor: la
 * persona vuelve a intentar, no entiende el error y termina sin el dato.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { evaluarSigno, type PesoPrevio } from "@/lib/signos/evaluar"
import { DB_A_TIPO, TIPO_A_DB } from "@/lib/signos/tipos"
import { combinarUmbrales } from "@/lib/signos/umbrales"
import type { Database } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/signos/registrar-alertas.ts se importó desde el navegador. Este módulo usa la " +
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
 * Cuántas mediciones de peso anteriores se traen para armar la ventana. El
 * corte por fecha lo hace el motor (`pesosEnVentana`), no la consulta: así la
 * regla de la ventana es una sola y está en el módulo puro que los tests
 * ejercitan. 30 filas cubren con holgura una ventana de 7 días incluso para
 * quien se pesa varias veces por día, y acota el peor caso de un perfil con
 * años de historial.
 */
const PESOS_A_CONSIDERAR = 30

/**
 * Evalúa la medición `signoId` y persiste una fila de `vital_sign_alerts` por
 * cada regla violada. Devuelve cuántas alertas quedaron creadas de verdad.
 *
 * Idempotente: el `upsert` con `ignoreDuplicates` se apoya en el índice único
 * `vital_sign_alerts_una_por_regla (vital_sign_id, regla)`, así que reevaluar
 * la misma medición no duplica nada (un doble submit, una corrida manual de
 * reparación, un reintento del runtime).
 *
 * Lanza si la base responde con error — quien llama la trata como best-effort.
 */
export async function registrarAlertasDeSigno(signoId: string): Promise<number> {
  const supabase = clienteAdmin()

  const { data: signo, error: errorSigno } = await supabase
    .from("vital_signs")
    .select("id, profile_id, type, systolic, diastolic, value, measured_at")
    .eq("id", signoId)
    .maybeSingle()

  if (errorSigno) {
    throw new Error(`No se pudo leer la medición ${signoId}: ${errorSigno.message}`)
  }
  if (!signo) {
    // La medición se borró entre el INSERT y la evaluación. No es un error del
    // sistema: no hay nada que alertar sobre una fila que ya no existe.
    return 0
  }

  const { data: fila, error: errorUmbrales } = await supabase
    .from("vital_sign_thresholds")
    .select("sistolica_max, diastolica_max, glucemia_min, glucemia_max, peso_variacion_kg, peso_ventana_dias")
    .eq("profile_id", signo.profile_id)
    .maybeSingle()

  if (errorUmbrales) {
    // Silenciar esto y seguir con los defaults sería aplicar un umbral que
    // nadie configuró: si el perfil tiene umbrales propios y no se pudieron
    // leer, la alerta correcta es NINGUNA alerta y un log arriba.
    throw new Error(
      `No se pudieron leer los umbrales del perfil ${signo.profile_id}: ${errorUmbrales.message}`,
    )
  }

  const umbrales = combinarUmbrales(fila)
  const tipo = DB_A_TIPO[signo.type]

  let historialPeso: PesoPrevio[] = []
  if (tipo === "peso") {
    const { data: previos, error: errorPesos } = await supabase
      .from("vital_signs")
      .select("value, measured_at")
      .eq("profile_id", signo.profile_id)
      .eq("type", TIPO_A_DB.peso)
      .lt("measured_at", signo.measured_at)
      .order("measured_at", { ascending: false })
      .limit(PESOS_A_CONSIDERAR)

    if (errorPesos) {
      throw new Error(
        `No se pudo leer el historial de peso del perfil ${signo.profile_id}: ${errorPesos.message}`,
      )
    }

    historialPeso = (previos ?? [])
      .filter((previo): previo is { value: number; measured_at: string } => previo.value != null)
      .map((previo) => ({ valor: previo.value, measuredAt: previo.measured_at }))
  }

  const violadas = evaluarSigno(
    {
      tipo,
      systolic: signo.systolic,
      diastolic: signo.diastolic,
      value: signo.value,
      measuredAt: signo.measured_at,
    },
    umbrales,
    historialPeso,
  )

  if (violadas.length === 0) return 0

  const { data: creadas, error: errorAlta } = await supabase
    .from("vital_sign_alerts")
    .upsert(
      violadas.map((violada) => ({
        vital_sign_id: signo.id,
        // El trigger `vital_sign_alerts_sellar_perfil` lo deriva igual de la
        // medición e ignora lo que llegue: va acá solo porque la columna es
        // NOT NULL sin default y el tipo generado la exige.
        profile_id: signo.profile_id,
        tipo: signo.type,
        regla: violada.regla,
        valor: violada.valor,
        umbral: violada.umbral,
        referencia: violada.referencia,
        mensaje: violada.mensaje,
      })),
      { onConflict: "vital_sign_id,regla", ignoreDuplicates: true },
    )
    .select("id")

  if (errorAlta) {
    throw new Error(`No se pudieron registrar las alertas de la medición ${signoId}: ${errorAlta.message}`)
  }

  return creadas?.length ?? 0
}
