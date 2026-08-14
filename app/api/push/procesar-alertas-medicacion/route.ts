/**
 * POST /api/push/procesar-alertas-medicacion — barrido de la cola de alertas de
 * renovación de receta (Sprint 7, tarea 7.4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Lo llama `pg_cron` dos veces por día vía `pg_net`, no un navegador. No hay
 *  sesión, no hay cookies: la única credencial es el header `x-cron-secret`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué es un endpoint nuevo y no una extensión de `/procesar-recordatorios`
 *
 * Se evaluó drenar las dos colas desde el barrido de turnos. Se descartó por
 * tres motivos concretos:
 *
 * 1. **Los leases son independientes.** Cada cola tiene su propio
 *    `reclamar_*` con `FOR UPDATE SKIP LOCKED` y su propio tope por corrida.
 *    Mezclarlas haría que una cola de mil recordatorios consuma el presupuesto
 *    de las alertas de medicación y las deje para la corrida siguiente — que
 *    acá es 12 horas después, no 15 minutos.
 * 2. **Las frecuencias son distintas por diseño** (cada 15 minutos los turnos,
 *    dos veces por día las alertas): un endpoint único obligaría a la
 *    frecuencia más alta a barrer una cola que casi siempre está vacía, o a la
 *    más baja a atrasar los recordatorios de turnos.
 * 3. **`/api/push/procesar-recordatorios` es el único camino verificado contra
 *    un teléfono real** (`docs/recordatorios.md` §8). No hay ninguna razón para
 *    tocarlo al agregar una funcionalidad nueva.
 *
 * Lo que sí se comparte es todo lo que ya estaba resuelto: la autenticación por
 * secreto en tiempo constante, `destinatarios_de_avisos()` (la misma función de
 * 6.4, que se llamó "de avisos" justamente previendo esto) y
 * `enviarPushAUsuario()` con su política de bajas 404/410.
 *
 * El reparto de responsabilidades es el mismo de siempre:
 *
 * | Decide | Dónde |
 * |---|---|
 * | **Cuándo** corresponde avisar (umbral + antidup 48hs) | SQL (`generar_alertas_medicacion`) |
 * | **A quién** | SQL (`destinatarios_de_avisos`) |
 * | **Qué dice** | `lib/medicacion/alertas.ts` (puro, con tests) |
 * | **Cómo se entrega** | `lib/push/servidor.ts` |
 *
 * Este archivo no contiene ninguna de esas cuatro cosas: las orquesta.
 */

import { createHash, timingSafeEqual } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { construirAlertaRenovacion, type MedicacionParaAlerta } from "@/lib/medicacion/alertas"
import { enviarPushAUsuario } from "@/lib/push/servidor"
import type { Database } from "@/types/database.types"

/** `web-push` usa `crypto` y `https` de Node. Igual que `/api/push/procesar-recordatorios`. */
export const runtime = "nodejs"

/** Nada de esto se puede prerenderizar: el resultado depende del estado de la base. */
export const dynamic = "force-dynamic"

/** Nombre estable para grepear los logs. */
const PREFIJO = "[alertas-medicacion]"

/**
 * Cuántas alertas toma un barrido.
 *
 * Con el antidup de 48 horas, una familia real genera como mucho un puñado de
 * filas por corrida. El tope existe para que una base con datos raros no
 * convierta una corrida del cron en una request de varios minutos que Vercel
 * corta a la mitad; lo que sobra se lleva la corrida siguiente.
 */
const LIMITE_POR_CORRIDA = 50

/** Fila que devuelve `reclamar_alertas_medicacion()`. */
interface AlertaReclamada {
  alerta_id: string
  medication_id: string
  profile_id: string
  nombre_perfil: string
  nombre: string
  dias_restantes: number
  stock_units: number | null
  dose_unit: string | null
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
 * `timingSafeEqual` exige buffers del mismo largo —y tirar por longitud
 * distinta ya sería una filtración—, así que se comparan los SHA-256, que
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
 * Es obligatorio y no una comodidad: `medication_renewal_alerts` solo tiene una
 * política de SELECT para los administradores del perfil, y las tres funciones
 * que se usan acá tienen `EXECUTE` únicamente para `service_role`. Un barrido
 * que corre sin sesión no tiene ningún JWT que presentar.
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

export async function POST(request: Request) {
  const esperado = process.env.CRON_SECRET
  if (!esperado) {
    console.error(
      `${PREFIJO} Falta CRON_SECRET en el entorno: el barrido no puede autenticarse. Ver docs/modelo-medicacion.md §12.`,
    )
    return json({ error: "El barrido de alertas de medicación no está configurado." }, 503)
  }

  const recibido = request.headers.get("x-cron-secret")
  if (!recibido || !secretoCoincide(recibido, esperado)) {
    return json({ error: "No autorizado" }, 401)
  }

  const supabase = clienteAdmin()

  const { data: reclamadas, error: errorReclamo } = await supabase.rpc(
    "reclamar_alertas_medicacion",
    { p_limite: LIMITE_POR_CORRIDA },
  )

  if (errorReclamo) {
    console.error(`${PREFIJO} No se pudo reclamar la cola: ${errorReclamo.message}`)
    return json({ error: "No se pudo leer la cola de alertas de medicación." }, 500)
  }

  const cola = (reclamadas ?? []) as AlertaReclamada[]
  if (cola.length === 0) {
    return json({ procesados: 0, entregas: 0, fallos: 0 }, 200)
  }

  /**
   * Los destinatarios se resuelven por PERFIL, no por alerta: dos medicaciones
   * de la misma persona que caen en la misma corrida van exactamente a la misma
   * gente.
   */
  const destinatariosPorPerfil = new Map<string, string[]>()

  /**
   * **Lanza si el RPC falla, y eso es deliberado.**
   *
   * Es la misma lección que dejó escrita `/api/push/procesar-recordatorios`:
   * devolver `[]` haría que "no pude preguntar quién recibe" quedara
   * indistinguible de "no recibe nadie", la alerta se cerraría como `enviado`
   * con 0 entregas y 0 fallos, y el antidup de 48 horas la silenciaría durante
   * dos días enteros — sobre un stock que dura menos de cinco.
   *
   * Lanzando, el `try/catch` de cada fila deja la alerta en `enviando` y el
   * lease de 10 minutos la devuelve a la cola.
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
      const medicacion: MedicacionParaAlerta = {
        medicationId: fila.medication_id,
        profileId: fila.profile_id,
        nombrePerfil: fila.nombre_perfil,
        nombre: fila.nombre,
        diasRestantes: fila.dias_restantes,
        stockUnits: fila.stock_units,
        doseUnit: fila.dose_unit,
      }

      const payload = construirAlertaRenovacion(medicacion)
      const usuarios = await destinatariosDe(fila.profile_id)

      const resultados = (
        await Promise.all(usuarios.map((userId) => enviarPushAUsuario(userId, payload)))
      ).flat()

      const entregas = resultados.filter((r) => r.estado === "entregado").length
      const fallos = resultados.length - entregas

      console.info(
        `${PREFIJO} medicacion=${fila.medication_id} dias=${fila.dias_restantes} ` +
          `destinatarios=${usuarios.length} entregas=${entregas} fallos=${fallos} · "${payload.titulo}"`,
      )

      // Se cierra SIEMPRE, aunque no haya habido ninguna entrega: la política
      // está documentada en `cerrar_alerta_medicacion()`. Un aviso se considera
      // dado si se intentó con todos los destinatarios; las suscripciones
      // muertas ya se dieron de baja solas por el 410.
      const { error: errorCierre } = await supabase.rpc("cerrar_alerta_medicacion", {
        p_id: fila.alerta_id,
        p_entregas: entregas,
        p_fallos: fallos,
      })

      if (errorCierre) {
        // Grave: el aviso salió y no quedó anotado. El lease de 10 minutos lo
        // va a hacer reintentable, así que como mucho se repite una vez.
        console.error(
          `${PREFIJO} La alerta ${fila.alerta_id} se envió pero no se pudo cerrar: ${errorCierre.message}`,
        )
      }

      procesados += 1
      entregasTotales += entregas
      fallosTotales += fallos
    } catch (error) {
      // Una alerta que explota no puede tumbar las otras de la corrida. La fila
      // queda en `enviando` —no se cierra— y el lease de 10 minutos la devuelve
      // a la cola: es preferible un aviso repetido a uno perdido.
      console.error(
        `${PREFIJO} Fallo procesando ${fila.alerta_id} (queda en la cola para el próximo barrido):`,
        error,
      )
    }
  }

  return json({ procesados, entregas: entregasTotales, fallos: fallosTotales }, 200)
}
