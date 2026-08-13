/**
 * POST /api/push/procesar-recordatorios — barrido de la cola de recordatorios
 * de turnos (Sprint 6, tarea 6.4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Lo llama `pg_cron` cada 15 minutos vía `pg_net`, no un navegador. No hay
 *  sesión, no hay cookies: la única credencial es el header `x-cron-secret`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué el drenado vive en Next y no en una Edge Function
 *
 * Está argumentado en el encabezado de
 * `supabase/migrations/20260813050000_recordatorios_turnos.sql`, en una línea:
 * el envío Web Push del proyecto es `web-push`, que es **Node**, y una Edge
 * Function de Supabase corre en **Deno**. Mover la entrega allá obligaría a
 * reimplementar RFC 8291 con `SubtleCrypto` o a duplicar la clave privada VAPID
 * en un segundo sistema de secretos. Acá se reutiliza `lib/push/servidor.ts`
 * tal cual, con su política de bajas por 404/410 ya verificada contra un
 * teléfono real.
 *
 * El reparto de responsabilidades es estricto:
 *
 * | Decide | Dónde |
 * |---|---|
 * | **Cuándo** corresponde avisar | SQL (`generar_recordatorios_pendientes`) |
 * | **A quién** | SQL (`destinatarios_de_avisos`, sobre `family_permissions`) |
 * | **Qué dice** | `lib/turnos/recordatorios.ts` (puro, con tests) |
 * | **Cómo se entrega** | `lib/push/servidor.ts` |
 *
 * Este archivo no contiene ninguna de esas cuatro cosas: las orquesta.
 *
 * ## La autenticación es un secreto compartido, y alcanza
 *
 * El endpoint no expone ningún dato -devuelve tres números- y no acepta ningún
 * parámetro: no se le puede pedir "mandale una notificación a fulano". Lo peor
 * que logra quien adivine el secreto es adelantar el barrido de una cola que se
 * iba a drenar igual en los próximos 15 minutos, sin duplicar nada (el UNIQUE y
 * el estado de la fila lo impiden). La comparación es de tiempo constante
 * igual, porque un endpoint que responde más rápido ante un prefijo incorrecto
 * regala el secreto de a un byte por vez.
 *
 * Sin `CRON_SECRET` en el entorno el endpoint responde 503 y **no** hace nada:
 * un despliegue al que le falta la variable tiene que verse como roto, no
 * quedarse abierto.
 */

import { createHash, timingSafeEqual } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { enviarPushAUsuario } from "@/lib/push/servidor"
import {
  construirRecordatorio,
  VENTANAS_RECORDATORIO,
  type TurnoParaRecordatorio,
  type VentanaRecordatorio,
} from "@/lib/turnos/recordatorios"
import type { Database } from "@/types/database.types"

/** `web-push` usa `crypto` y `https` de Node. Igual que `/api/push/probar`. */
export const runtime = "nodejs"

/** Nada de esto se puede prerenderizar: el resultado depende del reloj. */
export const dynamic = "force-dynamic"

/** Nombre estable para grepear los logs. */
const PREFIJO = "[recordatorios]"

/**
 * Cuántos avisos toma un barrido.
 *
 * Con 4 ventanas y una familia, la cola real nunca pasa de un puñado; el tope
 * existe para que una base con datos raros -mil turnos importados de golpe- no
 * convierta una corrida del cron en una request de varios minutos que Vercel
 * corta a la mitad. Lo que sobra se lleva la corrida siguiente, 15 minutos
 * después.
 */
const LIMITE_POR_CORRIDA = 50

/** Fila que devuelve `reclamar_recordatorios_turnos()`. */
interface RecordatorioReclamado {
  recordatorio_id: string
  ventana: string
  appointment_id: string
  profile_id: string
  especialidad: string
  medico: string | null
  fecha: string
  lugar: string | null
  preparacion: string | null
}

function json(cuerpo: unknown, status: number) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

/**
 * Comparación de tiempo constante entre dos secretos de largo arbitrario.
 *
 * `timingSafeEqual` exige buffers del mismo largo -y tirar por longitud
 * distinta ya sería una filtración-, así que se comparan los SHA-256, que
 * siempre miden 32 bytes.
 */
function secretoCoincide(recibido: string, esperado: string): boolean {
  const a = createHash("sha256").update(recibido).digest()
  const b = createHash("sha256").update(esperado).digest()
  return timingSafeEqual(a, b)
}

let clienteCache: SupabaseClient<Database> | null = null

/**
 * Cliente `service_role`.
 *
 * Es obligatorio y no una comodidad: `appointment_reminders` no tiene ninguna
 * política RLS (es infraestructura, como `storage_purge_queue`) y las cuatro
 * funciones que se usan acá solo tienen `EXECUTE` para `service_role`. Un
 * barrido que corre sin sesión no tiene ningún JWT que presentar.
 */
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

function esVentana(valor: string): valor is VentanaRecordatorio {
  return (VENTANAS_RECORDATORIO as readonly string[]).includes(valor)
}

export async function POST(request: Request) {
  const esperado = process.env.CRON_SECRET
  if (!esperado) {
    console.error(
      `${PREFIJO} Falta CRON_SECRET en el entorno: el barrido no puede autenticarse. Ver docs/recordatorios.md §4.`,
    )
    return json({ error: "El barrido de recordatorios no está configurado." }, 503)
  }

  const recibido = request.headers.get("x-cron-secret")
  if (!recibido || !secretoCoincide(recibido, esperado)) {
    return json({ error: "No autorizado" }, 401)
  }

  const supabase = clienteAdmin()

  const { data: reclamados, error: errorReclamo } = await supabase.rpc(
    "reclamar_recordatorios_turnos",
    { p_limite: LIMITE_POR_CORRIDA },
  )

  if (errorReclamo) {
    console.error(`${PREFIJO} No se pudo reclamar la cola: ${errorReclamo.message}`)
    return json({ error: "No se pudo leer la cola de recordatorios." }, 500)
  }

  const cola = (reclamados ?? []) as RecordatorioReclamado[]
  if (cola.length === 0) {
    return json({ procesados: 0, entregas: 0, fallos: 0 }, 200)
  }

  const ahora = new Date()

  /**
   * Los destinatarios se resuelven por PERFIL, no por recordatorio: los cuatro
   * avisos de un mismo turno -y los de dos turnos de la misma persona que caen
   * en la misma corrida- van exactamente a la misma gente.
   */
  const destinatariosPorPerfil = new Map<string, string[]>()

  /**
   * **Lanza si el RPC falla, y eso es deliberado.**
   *
   * La tentación es devolver `[]` y seguir. Sería un error grave: "no pude
   * preguntar quién recibe" quedaría indistinguible de "no recibe nadie", el
   * aviso se cerraría como `enviado` con 0 entregas y 0 fallos, y el
   * `UNIQUE (appointment_id, ventana)` haría que **esa ventana no se pueda
   * regenerar nunca más**. Un hipo de red de un segundo silenciaría para
   * siempre el recordatorio de un turno, dejando en la tabla un rastro
   * idéntico al del caso legítimo.
   *
   * Lanzando, el `try/catch` de cada fila deja el recordatorio en `enviando` y
   * el lease de 10 minutos lo vuelve a poner en la cola — el mismo camino que
   * cualquier otro fallo a mitad de procesamiento.
   */
  async function destinatariosDe(profileId: string): Promise<string[]> {
    const cacheado = destinatariosPorPerfil.get(profileId)
    if (cacheado) return cacheado

    const { data, error } = await supabase.rpc("destinatarios_de_avisos", {
      p_profile_id: profileId,
    })

    if (error) {
      throw new Error(
        `No se pudieron resolver los destinatarios del perfil ${profileId}: ${error.message}`,
      )
    }

    // `setof uuid` llega como array plano de strings. Un array vacío SÍ se
    // cachea y sí es una respuesta válida: significa que ese perfil no tiene
    // titular con cuenta ni ningún can_manage.
    const userIds = data ?? []
    destinatariosPorPerfil.set(profileId, userIds)
    return userIds
  }

  let procesados = 0
  let entregasTotales = 0
  let fallosTotales = 0

  for (const fila of cola) {
    try {
      if (!esVentana(fila.ventana)) {
        // Imposible con el CHECK de la tabla; si pasara, es preferible saltearlo
        // que mandar un texto inventado.
        console.error(
          `${PREFIJO} Ventana desconocida "${fila.ventana}" en el recordatorio ${fila.recordatorio_id}.`,
        )
        continue
      }

      const turno: TurnoParaRecordatorio = {
        id: fila.appointment_id,
        especialidad: fila.especialidad,
        fechaIso: fila.fecha,
        medico: fila.medico,
        lugar: fila.lugar,
        preparacion: fila.preparacion,
        // Sprint 6.6: la url del payload lleva `?perfil={profileId}` para que
        // tocar la notificación aterrice en el perfil DEL TURNO, no en el
        // perfil activo de quien la toca. Ver `TurnoParaRecordatorio.profileId`.
        profileId: fila.profile_id,
      }

      const payload = construirRecordatorio(turno, fila.ventana, ahora)
      const usuarios = await destinatariosDe(fila.profile_id)

      const resultados = (
        await Promise.all(usuarios.map((userId) => enviarPushAUsuario(userId, payload)))
      ).flat()

      const entregas = resultados.filter((r) => r.estado === "entregado").length
      const fallos = resultados.length - entregas

      console.info(
        `${PREFIJO} ${fila.ventana} turno=${fila.appointment_id} destinatarios=${usuarios.length} ` +
          `entregas=${entregas} fallos=${fallos} · "${payload.titulo}"`,
      )

      // Se cierra SIEMPRE, aunque no haya habido ninguna entrega: la política
      // está documentada en `cerrar_recordatorio_turno()`. Un aviso se
      // considera dado si se intentó con todos los destinatarios; las
      // suscripciones muertas ya se dieron de baja solas por el 410.
      const { error: errorCierre } = await supabase.rpc("cerrar_recordatorio_turno", {
        p_id: fila.recordatorio_id,
        p_entregas: entregas,
        p_fallos: fallos,
      })

      if (errorCierre) {
        // Grave: el aviso salió y no quedó anotado. El lease de 10 minutos lo
        // va a hacer reintentable, así que como mucho se repite una vez.
        console.error(
          `${PREFIJO} El recordatorio ${fila.recordatorio_id} se envió pero no se pudo cerrar: ${errorCierre.message}`,
        )
      }

      procesados += 1
      entregasTotales += entregas
      fallosTotales += fallos
    } catch (error) {
      // Un aviso que explota no puede tumbar los otros nueve de la corrida.
      // La fila queda en `enviando` -no se cierra- y el lease de 10 minutos la
      // devuelve a la cola: es preferible un aviso repetido a uno perdido.
      console.error(
        `${PREFIJO} Fallo procesando ${fila.recordatorio_id} (queda en la cola para el próximo barrido):`,
        error,
      )
    }
  }

  return json({ procesados, entregas: entregasTotales, fallos: fallosTotales }, 200)
}
