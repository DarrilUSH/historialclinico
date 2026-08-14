import "server-only"

/**
 * Notificación INMEDIATA al perfil administrador cuando una medición violó un
 * umbral clínico — EXCLUSIVAMENTE SERVIDOR (Sprint 9, tarea 9.3 —
 * ROADMAP_SPRINTS.md; contrato: `docs/modelo-signos.md` §10).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY (indirectamente, para
 *      `destinatarios_de_avisos`) Y LLAMA A `lib/push/servidor.ts`. Mismo
 *      contrato que `lib/signos/registrar-alertas.ts`: jamás se importa desde
 *      código cliente.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué es SÍNCRONO y no una cola (a diferencia de la 7.4)
 *
 * `lib/medicacion/alertas.ts` + `/api/push/procesar-alertas-medicacion` drenan
 * `medication_renewal_alerts` con `pg_cron` dos veces por día: el evento
 * "quedan pocos días de stock" tolera horas de demora. El ROADMAP de ESTA
 * tarea pide lo contrario, textual: *"hace llegar el push al familiar
 * administrador EN MENOS DE 30 SEGUNDOS"*. Una cola con `pg_cron` no puede
 * prometer eso —el intervalo más corto que ya existe en el proyecto es cada 15
 * minutos, para los recordatorios de turno—, así que `vital_sign_alerts` no
 * tiene columnas de cola (`estado`, `claimed_at`, `sent_at`) a propósito: el
 * envío ocurre DENTRO de la Server Action `registrarSigno`, en la misma
 * cadena síncrona que el `INSERT` de la medición y el `INSERT` de la alerta.
 * Es la decisión que `docs/modelo-signos.md` §10 dejaba pendiente para esta
 * tarea, y queda resuelta acá.
 *
 * ## UN push por carga, no uno por regla violada
 *
 * 170/110 viola `sistolica_alta` Y `diastolica_alta`: son dos filas en
 * `vital_sign_alerts` (§7.1 del modelo — "una fila por regla, no por
 * medición") pero la persona que carga apretó un solo botón "Guardar" una
 * sola vez. Mandarle dos notificaciones por ese único gesto es ruido, y en
 * Android además se APILAN si no comparten `tag`. Por eso este módulo agrupa
 * TODAS las alertas de una misma carga en un solo `PayloadPush` antes de
 * mandar nada — ver `armarTextoAlertaSignos`, la única función pura del
 * archivo y la que cubre `tests/unit/notificar-signos.test.ts`.
 *
 * ## Por qué el texto del push NO es `vital_sign_alerts.mensaje`
 *
 * `mensaje` es la línea del BANNER (`docs/modelo-signos.md` §10): una por
 * regla, redactada por `lib/signos/evaluar.ts` ("Presión sistólica alta: 170
 * mmHg..."). Un push con dos cuerpos de `mensaje` pegados leería como dos
 * avisos que casualmente comparten notificación. El texto del push es propio
 * de este módulo, agrupado desde el principio: "170/110 (umbral 160/100)".
 *
 * ## Best-effort — la carga nunca se rompe porque el push falle
 *
 * Mismo contrato que `registrarAlertasDeSigno`: quien llama
 * (`app/(app)/(con-nav)/signos/actions.ts#registrarSigno`) envuelve la llamada
 * en su propio `try/catch` y sigue. La medición y sus alertas YA están
 * guardadas cuando este módulo se ejecuta; si el Push Service está caído o
 * `destinatarios_de_avisos` no responde, el banner de la 9.3 sigue siendo la
 * red de contención —la familia lo ve la próxima vez que abre la app— y el
 * <30s del push es un plus, no la única vía.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { DESCARGO_CLINICO, type ReglaAlerta } from "@/lib/signos/evaluar"
import type { AlertaSignoPersistida } from "@/lib/signos/registrar-alertas"
import { enviarPushAUsuario, type PayloadPush } from "@/lib/push/servidor"
import type { Database } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/signos/notificar.ts se importó desde el navegador. Este módulo usa la " +
      "SERVICE_ROLE_KEY y sólo puede ejecutarse en el servidor.",
  )
}

/** Nombre estable para grepear los logs del servidor. */
const PREFIJO = "[signos-alertas]"

/** Ruta base del deep link: el banner persistente vive arriba de `/signos`. */
const RUTA_BANNER_ALERTAS = "/signos"

/**
 * Lo que `armarTextoAlertaSignos` necesita de cada alerta persistida. Es un
 * subconjunto deliberado de `AlertaSignoPersistida` -sin `id` ni `tipo`, que
 * el armado del texto no usa: la rama se decide por `regla`, no por `tipo`
 * (son redundantes, `vital_sign_alerts_regla_coherente_con_tipo` los mantiene
 * coherentes)- para que la función pura no tenga que importar el tipo
 * completo de la fila de la base.
 */
export type AlertaParaNotificar = Pick<AlertaSignoPersistida, "regla" | "valor" | "umbral" | "referencia">

const FORMATO = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 })

/**
 * Coma decimal y sin ceros de relleno: "160", "82,5". Duplicado a propósito
 * de `lib/signos/evaluar.ts#n` -mismo criterio que `campo()` en cada
 * `actions.ts`-: son dos módulos con motivos de existir distintos (uno arma
 * el mensaje del banner, este arma el del push) y la única alternativa era un
 * tercer módulo compartido para dos líneas de código.
 */
function n(valor: number): string {
  return FORMATO.format(valor)
}

/** Primer nombre, para el título — mismo criterio y mismo motivo que `lib/medicacion/alertas.ts#primerNombre`: Android corta el título en una línea y el apellido desplaza lo importante. */
function primerNombre(nombreCompleto: string): string {
  return nombreCompleto.trim().split(/\s+/)[0] ?? ""
}

function conNombre(base: string, nombre: string): string {
  return nombre ? `${base} para ${nombre}` : base
}

function porRegla(
  alertas: readonly AlertaParaNotificar[],
  regla: ReglaAlerta,
): AlertaParaNotificar | undefined {
  return alertas.find((alerta) => alerta.regla === regla)
}

/**
 * Arma título y cuerpo del push agrupando TODAS las alertas de una misma
 * carga en un solo mensaje. Pura: sin IO, sin reloj -mismo espíritu que
 * `lib/signos/evaluar.ts` y `lib/medicacion/alertas.ts`-, y es la única
 * función de este archivo que se prueba directo
 * (`tests/unit/notificar-signos.test.ts`); el resto es orquestación de red
 * que ya verifica el dispositivo real (`docs/capturas/dispositivo-real/README.md`).
 *
 * La tensión es el único tipo con más de una regla posible por carga
 * (`sistolica_alta` y/o `diastolica_alta`): con las dos presentes arma el par
 * "170/110 (umbral 160/100)" -el ejemplo literal del criterio de aceptación
 * del ROADMAP-; con una sola, nombra cuál. Glucemia y peso tienen como mucho
 * una regla por medición (`evaluarSigno` las hace mutuamente excluyentes), así
 * que ahí no hay nada que agrupar.
 *
 * Lanza con lista vacía: llamar a esto sin alertas es un bug de quien invoca
 * -`notificarAlertasDeSigno` ya filtra antes de llegar acá-, no un caso de
 * negocio a degradar en silencio.
 */
export function armarTextoAlertaSignos(
  nombrePerfil: string,
  alertas: readonly AlertaParaNotificar[],
): { titulo: string; cuerpo: string } {
  if (alertas.length === 0) {
    throw new Error("armarTextoAlertaSignos: se llamó sin ninguna alerta que notificar.")
  }

  const nombre = primerNombre(nombrePerfil)

  const sistolica = porRegla(alertas, "sistolica_alta")
  const diastolica = porRegla(alertas, "diastolica_alta")

  if (sistolica && diastolica) {
    return {
      titulo: conNombre("Tensión alta registrada", nombre),
      cuerpo:
        `${n(sistolica.valor)}/${n(diastolica.valor)} ` +
        `(umbral ${n(sistolica.umbral)}/${n(diastolica.umbral)}). ${DESCARGO_CLINICO}`,
    }
  }
  if (sistolica) {
    return {
      titulo: conNombre("Presión sistólica alta registrada", nombre),
      cuerpo: `${n(sistolica.valor)} mmHg (umbral ${n(sistolica.umbral)}). ${DESCARGO_CLINICO}`,
    }
  }
  if (diastolica) {
    return {
      titulo: conNombre("Presión diastólica alta registrada", nombre),
      cuerpo: `${n(diastolica.valor)} mmHg (umbral ${n(diastolica.umbral)}). ${DESCARGO_CLINICO}`,
    }
  }

  const glucemiaBaja = porRegla(alertas, "glucemia_baja")
  if (glucemiaBaja) {
    return {
      titulo: conNombre("Glucemia baja registrada", nombre),
      cuerpo: `${n(glucemiaBaja.valor)} mg/dL (umbral ${n(glucemiaBaja.umbral)}). ${DESCARGO_CLINICO}`,
    }
  }
  const glucemiaAlta = porRegla(alertas, "glucemia_alta")
  if (glucemiaAlta) {
    return {
      titulo: conNombre("Glucemia alta registrada", nombre),
      cuerpo: `${n(glucemiaAlta.valor)} mg/dL (umbral ${n(glucemiaAlta.umbral)}). ${DESCARGO_CLINICO}`,
    }
  }

  const peso = porRegla(alertas, "peso_variacion")
  if (peso) {
    // `referencia` no debería ser null acá: `vital_sign_alerts_referencia_solo_en_peso`
    // la exige exactamente en `peso_variacion` y en ninguna otra regla. Si
    // igual llega null -una fila armada a mano, un bug de quien la persistió-
    // se prefiere explotar fuerte antes que mandar un push que invente "0 kg
    // de variación" con un dato que no tiene.
    if (peso.referencia === null) {
      throw new Error(
        "armarTextoAlertaSignos: la alerta de peso_variacion no trae 'referencia' (debería ser NOT NULL para esta regla).",
      )
    }
    const referencia = peso.referencia
    const delta = peso.valor - referencia
    const direccion = delta >= 0 ? "más" : "menos"
    return {
      titulo: conNombre("Variación de peso registrada", nombre),
      cuerpo:
        `${n(peso.valor)} kg: ${n(Math.abs(delta))} kg ${direccion} que la referencia ` +
        `(${n(referencia)} kg; umbral ${n(peso.umbral)} kg). ${DESCARGO_CLINICO}`,
    }
  }

  // Invariante: las cinco reglas de `ReglaAlerta` están cubiertas arriba. Solo
  // se llega acá si `alertas` trae una `regla` que el enum de la base no
  // conoce -un desalineamiento entre `types/database.types.ts` y la
  // migración-, y ahí conviene explotar fuerte en vez de mandar un push vacío.
  throw new Error(
    `armarTextoAlertaSignos: ninguna de las ${alertas.length} alertas tiene una regla reconocida.`,
  )
}

/**
 * Deep link del push: cambia el perfil activo a `profileId` y aterriza en
 * `/signos`, donde vive el banner persistente. Mismo patrón que
 * `lib/medicacion/alertas.ts#urlDeAlerta` -documentado en detalle ahí-: sin
 * esto, María con su propio perfil activo tocando la notificación de Roberto
 * vería SU lista de signos vitales, sin el banner que le acaban de avisar.
 * `/signos/enlace` (calcado de `/medicacion/enlace`) es quien procesa el
 * parámetro.
 */
function urlDeAlerta(profileId: string): string {
  return `${RUTA_BANNER_ALERTAS}/enlace?perfil=${encodeURIComponent(profileId)}`
}

/**
 * Arma el `PayloadPush` completo: título y cuerpo agrupados
 * (`armarTextoAlertaSignos`) más `url` y `tag`.
 *
 * `tag: signo-{vitalSignId}` -no `alerta-{id}`- porque el reemplazo tiene que
 * operar por MEDICIÓN, no por regla: si el mismo `vital_sign_id` disparara un
 * reenvío (un reintento del runtime, nunca debería pasar porque esto es
 * síncrono y no hay cola, pero la convención se define igual por prolijidad),
 * la notificación nueva reemplaza a la vieja en vez de apilarse, y las dos
 * describen la MISMA carga. `lib/push/servidor.ts` ya anticipaba
 * `presion-{id}`; acá se generaliza a `signo-{id}` porque esta tarea cubre
 * tensión, glucemia y peso, no solo presión.
 */
export function construirAlertaSignos(input: {
  nombrePerfil: string
  profileId: string
  vitalSignId: string
  alertas: readonly AlertaParaNotificar[]
}): PayloadPush {
  const { titulo, cuerpo } = armarTextoAlertaSignos(input.nombrePerfil, input.alertas)

  return {
    titulo,
    cuerpo,
    url: urlDeAlerta(input.profileId),
    tag: `signo-${input.vitalSignId}`,
  }
}

let clienteCache: SupabaseClient<Database> | null = null

/**
 * Cliente `service_role`, exclusivamente para `destinatarios_de_avisos`: esa
 * función tiene `EXECUTE` revocado de `public` y otorgado solo a
 * `service_role` (`20260813050000_recordatorios_turnos.sql` §4.4 y §4.5) — un
 * barrido sin sesión de usuario no tiene ningún JWT que presentar, y acá
 * tampoco lo hay: `registrarSigno` corre con el cliente de la SESIÓN para el
 * `INSERT`, pero notificar a la familia es una operación que excede el
 * permiso de quien cargó la medición (§8 del modelo: quien tiene `can_upload`
 * ni siquiera puede LEER la alerta que generó).
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

/**
 * Notifica por Web Push a los `destinatarios_de_avisos` del perfil sobre las
 * alertas que se acaban de crear. Es el enganche de `registrarSigno`
 * (Sprint 9.3): se llama INMEDIATAMENTE después de
 * `registrarAlertasDeSigno`, dentro de la misma cadena síncrona de la Server
 * Action, para cumplir el <30s del criterio de aceptación.
 *
 * No-op silencioso con lista vacía -"no hubo alertas" no es un error, es el
 * caso normal de una carga sin nada fuera de umbral-. Con al menos una
 * alerta, arma UN payload (`construirAlertaSignos`) y lo manda a cada
 * destinatario en paralelo, igual que
 * `/api/push/procesar-alertas-medicacion`.
 *
 * Lanza si `destinatarios_de_avisos` falla -quien llama (`registrarSigno`) lo
 * trata como best-effort, mismo contrato que `registrarAlertasDeSigno`-.
 * `enviarPushAUsuario` en sí NUNCA lanza (`lib/push/servidor.ts`): un endpoint
 * muerto o un Push Service caído quedan en el resultado, no en una excepción.
 */
export async function notificarAlertasDeSigno(input: {
  profileId: string
  nombrePerfil: string
  vitalSignId: string
  alertas: readonly AlertaParaNotificar[]
}): Promise<void> {
  if (input.alertas.length === 0) return

  const payload = construirAlertaSignos(input)

  const { data, error } = await clienteAdmin().rpc("destinatarios_de_avisos", {
    p_profile_id: input.profileId,
  })

  if (error) {
    throw new Error(
      `No se pudieron resolver los destinatarios del perfil ${input.profileId}: ${error.message}`,
    )
  }

  // `setof uuid` llega como array plano de strings. Vacío es una respuesta
  // válida: el perfil no tiene titular con cuenta ni ningún can_manage -el
  // banner sigue siendo el único aviso, para quien entre después-.
  const usuarios = data ?? []
  if (usuarios.length === 0) return

  const resultados = (
    await Promise.all(usuarios.map((userId) => enviarPushAUsuario(userId, payload)))
  ).flat()

  const entregas = resultados.filter((resultado) => resultado.estado === "entregado").length

  console.info(
    `${PREFIJO} perfil=${input.profileId} signo=${input.vitalSignId} ` +
      `alertas=${input.alertas.length} destinatarios=${usuarios.length} entregas=${entregas} · "${payload.titulo}"`,
  )
}
