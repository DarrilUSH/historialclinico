import "server-only"

/**
 * Lectura de las fuentes clínicas y armado del contexto que se le manda a
 * Gemini para generar la ficha de resumen (Sprint 10, tarea 10.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Este archivo hace la E/S. **La decisión de qué datos personales salen del
 *  servidor NO está acá**: está en el tipo `ContextoClinico` de
 *  `lib/ficha/armado.ts`, y su justificación campo por campo en
 *  `docs/minimizacion-datos.md`. Acá lo único que se agrega a esa decisión es
 *  una segunda capa: cada `select` nombra exactamente las columnas de la lista
 *  blanca, así el DNI, el teléfono y el OCR crudo **ni siquiera salen de la
 *  base**.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## La separación lectura / armado
 *
 * `leerFuentesClinicas` toca Supabase; `armarContexto` (en `armado.ts`) es
 * puro. Esa frontera es lo que hace que el criterio de privacidad se pueda
 * verificar de verdad: el test le pasa al armado las filas COMPLETAS de la
 * base -con DNI, teléfono, nombre y OCR adentro- y comprueba por búsqueda de
 * texto que ninguno sobrevive. Con la lectura y el armado en una sola función
 * habría que mockear el cliente de Supabase entero para probar exactamente lo
 * mismo, y el test terminaría verificando el mock. Mismo criterio de
 * separación que `lib/estudios/filtros.ts` vs. `lib/estudios/consultas.ts` y
 * que `lib/sos/payload.ts` vs. su Route Handler.
 *
 * ## Permisos
 *
 * Estas funciones **no verifican permisos**: reciben un cliente ya autenticado
 * y autorizado por quien las llama (el Route Handler de la tarea 10.3, que es
 * el que decide con qué verbo se entra y el que registra `exportar_ficha` en
 * `access_logs`). RLS es la última palabra: cada consulta corre con la sesión
 * de quien pide y devuelve exactamente lo que la base ya le deja ver -para
 * `vital_sign_alerts` eso significa que un `can_view` sin `can_manage` recibe
 * `[]` y su ficha se genera sin la sección de alertas, igual que hoy no ve el
 * banner (`docs/modelo-permisos.md` §4.3)-.
 *
 * ## El contexto es efímero
 *
 * Lo que devuelve `construirContextoClinico` se arma, se manda y se descarta.
 * No se persiste, no se cachea y no se loguea: lo que se guarda (tarea 10.5)
 * es la FICHA generada, no su entrada. Ver `docs/minimizacion-datos.md` §6.
 */

import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import {
  armarContexto,
  MAXIMO_ESTUDIOS,
  type ContextoClinico,
  type FilaAlertaFuente,
  type FilaDocumentoFuente,
  type FilaMedicacionFuente,
  type FilaPerfilFuente,
  type FilaSignoFuente,
  type FuentesClinicas,
} from "@/lib/ficha/armado"
import type { FilaLabMetrica } from "@/lib/laboratorio/series"

export type {
  AlertaContexto,
  ContextoClinico,
  EstudioContexto,
  FuentesClinicas,
  MedicacionContexto,
  MetricaContexto,
  PacienteContexto,
  SignoContexto,
} from "@/lib/ficha/armado"
export { armarContexto, VERSION_CONTEXTO_CLINICO } from "@/lib/ficha/armado"

/**
 * Las columnas de cada `select`, escritas UNA vez y al lado de su tabla.
 *
 * Ninguna es `*`. Es la segunda capa de minimización: aunque el armado ya
 * descarta lo que no está en la lista blanca, acá se evita que `national_id`,
 * `phone`, `full_name`, `emergency_contact*`, `doctor_name`, `institution`,
 * `storage_path` o `raw_ocr_text` viajen siquiera por la red interna hasta el
 * proceso de Next. Un `select("*")` funcionaría igual de bien y sería un error
 * silencioso: la próxima columna sensible entraría sola al proceso que arma el
 * payload de un tercero.
 */
const COLUMNAS_PERFIL =
  "date_of_birth, blood_type, allergies, chronic_conditions, critical_medication, sos_notes"

const COLUMNAS_MEDICACION =
  "name, active_ingredient, presentation, dose_amount, dose_unit, frequency, schedule_times, interval_hours, start_date, notes, dias_restantes, necesita_renovacion, vigente_hoy"

/** `doctor_name`, `institution`, `storage_path` y `raw_ocr_text` quedan afuera a propósito: `docs/minimizacion-datos.md` §4. */
const COLUMNAS_DOCUMENTO = "document_date, category, title, specialty, ai_summary"

const COLUMNAS_METRICA =
  "metric_name, metric_canonical, value, unit, reference_range, reference_min, reference_max, measurement_date, document_id"

const COLUMNAS_SIGNO = "type, systolic, diastolic, pulse, value, measured_at, notes"

const COLUMNAS_ALERTA = "tipo, regla, valor, umbral, referencia, created_at"

/** Perfil vacío: la ficha se arma igual, sin datos basales, antes que no armarse. */
const PERFIL_VACIO: FilaPerfilFuente = {
  date_of_birth: null,
  blood_type: null,
  allergies: [],
  chronic_conditions: [],
  critical_medication: [],
  sos_notes: null,
}

/**
 * Cuántos signos vitales se traen. Se pide `MEDICIONES_POR_TIPO * 3 + margen`
 * en una sola consulta ordenada -no tres consultas filtradas por tipo como
 * `obtenerUltimasMedicionesPorTipo`- porque el recorte "3 por tipo" lo hace
 * `armarContexto`: acá alcanza con traer suficientes filas recientes para que
 * los tres tipos estén representados. El margen cubre el caso de una persona
 * que carga tensión todos los días y se pesa una vez por mes.
 */
const LIMITE_SIGNOS = 60

/**
 * Trae de la base todo lo que necesita el contexto clínico, sin transformar
 * nada.
 *
 * Las seis consultas van en paralelo (`Promise.all`): son independientes entre
 * sí y todas están servidas por índices sobre `profile_id`. Cada una es
 * **defensiva** -ante un error de lectura devuelve vacío en vez de lanzar-,
 * mismo criterio "defensivo, no bloqueante" que `lib/signos/consultas.ts` y
 * `lib/medicacion/tomas-de-hoy.ts`: una ficha sin la sección de laboratorio es
 * infinitamente más útil que un error en la pantalla cinco minutos antes de
 * entrar al consultorio.
 */
export async function leerFuentesClinicas(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
): Promise<FuentesClinicas> {
  const [perfil, medicaciones, documentos, metricas, signos, alertas] = await Promise.all([
    supabase.from("profiles").select(COLUMNAS_PERFIL).eq("id", perfilId).maybeSingle(),
    supabase.from("v_medicacion_estado").select(COLUMNAS_MEDICACION).eq("profile_id", perfilId),
    supabase
      .from("documents")
      .select(COLUMNAS_DOCUMENTO)
      .eq("profile_id", perfilId)
      .order("document_date", { ascending: false })
      .limit(MAXIMO_ESTUDIOS),
    supabase
      .from("lab_metrics")
      .select(COLUMNAS_METRICA)
      .eq("profile_id", perfilId)
      .order("measurement_date", { ascending: true }),
    supabase
      .from("vital_signs")
      .select(COLUMNAS_SIGNO)
      .eq("profile_id", perfilId)
      .order("measured_at", { ascending: false })
      .limit(LIMITE_SIGNOS),
    supabase
      .from("vital_sign_alerts")
      .select(COLUMNAS_ALERTA)
      .eq("profile_id", perfilId)
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false }),
  ])

  if (perfil.error) {
    console.error(`[ficha] Fallo al leer el perfil ${perfilId}:`, perfil.error)
  }
  if (medicaciones.error) {
    console.error(`[ficha] Fallo al leer la medicación del perfil ${perfilId}:`, medicaciones.error)
  }
  if (documentos.error) {
    console.error(`[ficha] Fallo al leer los estudios del perfil ${perfilId}:`, documentos.error)
  }
  if (metricas.error) {
    console.error(`[ficha] Fallo al leer las métricas del perfil ${perfilId}:`, metricas.error)
  }
  if (signos.error) {
    console.error(`[ficha] Fallo al leer los signos del perfil ${perfilId}:`, signos.error)
  }
  if (alertas.error) {
    console.error(`[ficha] Fallo al leer las alertas del perfil ${perfilId}:`, alertas.error)
  }

  return {
    perfil: (perfil.data as FilaPerfilFuente | null) ?? PERFIL_VACIO,
    medicaciones: (medicaciones.data as FilaMedicacionFuente[] | null) ?? [],
    documentos: (documentos.data as FilaDocumentoFuente[] | null) ?? [],
    metricas: (metricas.data as FilaLabMetrica[] | null) ?? [],
    signos: (signos.data as FilaSignoFuente[] | null) ?? [],
    alertas: (alertas.data as FilaAlertaFuente[] | null) ?? [],
  }
}

/**
 * El contexto clínico completo de un perfil, listo para mandar a Gemini.
 *
 * @param supabase Cliente de servidor **ya autenticado y ya autorizado** por
 *   quien llama. Esta función no verifica permisos; RLS filtra igual.
 * @param perfilId Perfil del que se arma la ficha.
 * @param generadoEn Momento del armado. Parámetro de test: en producción se
 *   omite y usa el reloj real.
 */
export async function construirContextoClinico(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
  generadoEn: Date = new Date(),
): Promise<ContextoClinico> {
  const fuentes = await leerFuentesClinicas(supabase, perfilId)
  return armarContexto(fuentes, generadoEn)
}
