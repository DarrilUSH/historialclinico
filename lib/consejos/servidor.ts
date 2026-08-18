import "server-only"

/**
 * Resolución SERVER-SIDE del tutorial de bienvenida (tarea #14): qué
 * consejo, de los cuatro que el servidor puede evaluar, le corresponde a
 * esta cuenta; y el estado de descarte/postergación de los seis, para que el
 * cliente pueda combinarlo con lo que solo él sabe (PWA instalada, permiso
 * de notificaciones). Contrato completo: `docs/tutorial-bienvenida.md`.
 *
 * ## Las cuatro condiciones "server-conocibles"
 *
 * | Consejo | Pendiente cuando... |
 * |---|---|
 * | `ficha_sos` | el perfil PROPIO de la cuenta no tiene grupo sanguíneo NI contacto de emergencia |
 * | `gmail` | la cuenta no tiene fila en `gmail_connections` (conectada o vencida, cualquiera cuenta como "ya lo hizo") |
 * | `compartir_familia` | el perfil propio no otorgó NINGÚN permiso (`family_permissions` vacía para `owner_profile_id = propio`) |
 * | `perfil_gestionado` | la cuenta ve un ÚNICO perfil (`profiles` filtrada por RLS, que ya es "el propio + los que tiene acceso") |
 *
 * Las cuatro dependen de que exista un perfil PROPIO (`profiles.user_id =
 * auth.uid()`) — el caso límite de una cuenta sin perfil (alta rota, ver
 * `docs/estado-proyecto.md` "HOTFIX... el alta de cuenta no creaba perfil")
 * se resuelve tratando las cuatro como "no pendiente": no tiene sentido
 * proponer completar la ficha SOS de un perfil que no existe.
 *
 * `instalar_app` y `notificaciones` (PWA instalada, permiso de
 * notificaciones) NO se evalúan acá: son "client-conocibles" y las resuelve
 * `components/inicio/consejo.tsx` tras montar. Acá entran igual en
 * `elegirConsejo` con `pendiente: false` — nunca ganan del lado servidor, es
 * literalmente "el servidor no sabe, no propone esto todavía" (ver el
 * encabezado de `lib/consejos/logica.ts`).
 */

import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"

import { obtenerConexionGmail } from "@/lib/gmail/conexion"
import {
  elegirConsejo,
  estaDescartado,
  pospuestoSigueActivo,
  type EstadoConsejo,
  type FilaConsejo,
} from "@/lib/consejos/logica"
import {
  CONSEJO_IDS,
  COOKIE_SESION_CONSEJOS,
  esConsejoId,
  esEstadoFilaConsejo,
  type ConsejoId,
} from "@/lib/consejos/tipos"
import type { Database } from "@/types/database.types"

/** Descarte/postergación de UN consejo, ya resuelto contra la sesión vigente. */
export interface DescarteConsejo {
  descartado: boolean
  pospuestoActivo: boolean
}

export interface ResumenConsejos {
  /** El mejor consejo entre los cuatro "server-conocibles", o `null` si ninguno aplica (o todos están descartados/pospuestos). */
  elegidoServidor: ConsejoId | null
  /** Descarte/postergación de los SEIS consejos — el cliente necesita el de `instalar_app` y `notificaciones` para su propia decisión. */
  descarte: Record<ConsejoId, DescarteConsejo>
  /**
   * Id del perfil PROPIO de la cuenta, o `null` si no tiene (alta rota). Lo
   * necesitan las CTA de `ficha_sos` y `compartir_familia` para aterrizar
   * siempre en el perfil propio sin importar cuál esté activo — ver
   * `app/(app)/(con-nav)/perfil/sos/enlace/route.ts` y
   * `app/(app)/(con-nav)/familia/enlace/route.ts`.
   */
  perfilPropioId: string | null
}

function descarteVacio(): Record<ConsejoId, DescarteConsejo> {
  return Object.fromEntries(
    CONSEJO_IDS.map((id) => [id, { descartado: false, pospuestoActivo: false }]),
  ) as Record<ConsejoId, DescarteConsejo>
}

const RESUMEN_VACIO: ResumenConsejos = {
  elegidoServidor: null,
  descarte: descarteVacio(),
  perfilPropioId: null,
}

/** Las cuatro condiciones "server-conocibles", ya evaluadas. Ver el encabezado del archivo. */
export interface CondicionesServidor {
  fichaSosVacia: boolean
  sinGmail: boolean
  sinPermisosOtorgados: boolean
  unSoloPerfilVisible: boolean
  perfilPropioId: string | null
}

const CONDICIONES_VACIAS: CondicionesServidor = {
  fichaSosVacia: false,
  sinGmail: false,
  sinPermisosOtorgados: false,
  unSoloPerfilVisible: false,
  perfilPropioId: null,
}

/**
 * Evalúa las cuatro condiciones "server-conocibles" contra la base. Factor
 * común de `resolverConsejos` (el consejo contextual de `/inicio`) y
 * `resolverEstadoPasos` (la lista completa de `/ayuda`, que necesita el
 * estado ✓/pendiente de cada paso SIN filtrar por descarte — "siempre
 * consultable" incluye a los que ya se descartaron como consejo).
 *
 * **Nunca lanza** — ver el criterio completo en el encabezado de
 * `resolverConsejos`. Ante cualquier error devuelve las cuatro en `false`.
 */
async function evaluarCondicionesServidor(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<CondicionesServidor> {
  try {
    const { data: perfilPropio } = await supabase
      .from("profiles")
      .select("id, blood_type, emergency_contact")
      .eq("user_id", userId)
      .maybeSingle()

    const perfilPropioId = perfilPropio?.id ?? null

    // Las cuatro solo tienen sentido con un perfil propio de verdad (ver el
    // encabezado del archivo). Sin él, quedan las cuatro en `false`.
    if (!perfilPropioId) {
      return CONDICIONES_VACIAS
    }

    const [conexionGmail, { count: permisosOtorgados }, { count: perfilesVisibles }] =
      await Promise.all([
        obtenerConexionGmail(supabase, userId),
        supabase
          .from("family_permissions")
          .select("id", { count: "exact", head: true })
          .eq("owner_profile_id", perfilPropioId),
        // Sin filtro: `profiles_select_visible` ya acota a "el propio + los
        // que la cuenta puede ver por family_permissions" (mismo criterio
        // que `app/(app)/(sin-nav)/perfiles/page.tsx`).
        supabase.from("profiles").select("id", { count: "exact", head: true }),
      ])

    return {
      fichaSosVacia: perfilPropio!.blood_type === null && perfilPropio!.emergency_contact === null,
      sinGmail: conexionGmail === null,
      sinPermisosOtorgados: (permisosOtorgados ?? 0) === 0,
      unSoloPerfilVisible: (perfilesVisibles ?? 0) === 1,
      perfilPropioId,
    }
  } catch (error) {
    console.error("[consejos] no se pudieron evaluar las condiciones del tutorial:", error)
    return CONDICIONES_VACIAS
  }
}

/**
 * El instante en que arrancó la sesión vigente del navegador (cookie
 * `consejos_sesion`, sin `maxAge` — ver `lib/consejos/sesion.ts`).
 *
 * Sin cookie -no debería pasar: `proxy.ts` la escribe en toda request no
 * estática con sesión, antes de que este código corra- se asume que la
 * sesión ACABA de arrancar (`new Date()`): cualquier postergación anterior
 * queda "vieja" frente a eso y el consejo vuelve a poder mostrarse.
 * Fail-open hacia MOSTRAR, nunca hacia esconder para siempre — el peor caso
 * es un consejo que reaparece una vez de más, nunca uno que se pierde.
 */
async function leerInicioDeSesion(): Promise<string> {
  const cookieStore = await cookies()
  return cookieStore.get(COOKIE_SESION_CONSEJOS)?.value ?? new Date().toISOString()
}

async function leerFilasDescarte(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Map<ConsejoId, FilaConsejo>> {
  const { data, error } = await supabase
    .from("consejos_estado")
    .select("consejo_id, estado, updated_at")
    .eq("user_id", userId)

  if (error) {
    console.error("[consejos] no se pudieron leer los descartes/postergaciones:", error.message)
    return new Map()
  }

  const filas = new Map<ConsejoId, FilaConsejo>()
  for (const fila of data ?? []) {
    if (esConsejoId(fila.consejo_id) && esEstadoFilaConsejo(fila.estado)) {
      filas.set(fila.consejo_id, { estado: fila.estado, actualizadoEl: fila.updated_at })
    }
  }
  return filas
}

/**
 * Resuelve el tutorial de bienvenida para la cuenta en sesión. Pensada para
 * llamarse una vez por render de `/inicio`, con el mismo `supabase` (cliente
 * del USUARIO, pasa por RLS) que ya resolvió `requerirSesion()` — mismo
 * patrón que `obtenerTomasDeHoy`/`obtenerAlertasSinVer` en esa misma
 * pantalla.
 *
 * **Nunca lanza.** Un fallo acá (la base no respondió, una consulta
 * accesoria falló) no puede tumbar `/inicio`: se registra en los logs y se
 * devuelve el resumen vacío, que hace que la pantalla se vea exactamente
 * como si todos los consejos ya se hubieran completado — el mismo criterio
 * de "nunca lanza" que `lib/densidad/servidor.ts#obtenerTamano`.
 */
export async function resolverConsejos(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<ResumenConsejos> {
  try {
    const [sesionIniciadaEn, filas, condiciones] = await Promise.all([
      leerInicioDeSesion(),
      leerFilasDescarte(supabase, userId),
      evaluarCondicionesServidor(supabase, userId),
    ])

    const descarte = Object.fromEntries(
      CONSEJO_IDS.map((id) => {
        const fila = filas.get(id) ?? null
        return [
          id,
          {
            descartado: estaDescartado(fila),
            pospuestoActivo: pospuestoSigueActivo(fila, sesionIniciadaEn),
          },
        ]
      }),
    ) as Record<ConsejoId, DescarteConsejo>

    const estadosServidor: EstadoConsejo[] = [
      { id: "ficha_sos", pendiente: condiciones.fichaSosVacia, ...descarte.ficha_sos },
      { id: "gmail", pendiente: condiciones.sinGmail, ...descarte.gmail },
      {
        id: "compartir_familia",
        pendiente: condiciones.sinPermisosOtorgados,
        ...descarte.compartir_familia,
      },
      {
        id: "perfil_gestionado",
        pendiente: condiciones.unSoloPerfilVisible,
        ...descarte.perfil_gestionado,
      },
      // El servidor no puede saber si estos dos aplican (ver encabezado):
      // entran con pendiente:false, nunca ganan acá.
      { id: "instalar_app", pendiente: false, ...descarte.instalar_app },
      { id: "notificaciones", pendiente: false, ...descarte.notificaciones },
    ]

    return {
      elegidoServidor: elegirConsejo(estadosServidor),
      descarte,
      perfilPropioId: condiciones.perfilPropioId,
    }
  } catch (error) {
    console.error("[consejos] no se pudo resolver el tutorial de bienvenida:", error)
    return RESUMEN_VACIO
  }
}

/**
 * El estado ✓/pendiente de los CUATRO pasos "server-conocibles", para la
 * lista completa de `/ayuda`. A propósito NO filtra por descarte -a
 * diferencia de `resolverConsejos`-: la pantalla "¿Cómo empiezo?" es
 * "siempre consultable" (criterio de la tarea), y un paso que la persona ya
 * descartó como consejo contextual tiene que seguir apareciendo acá con su
 * estado real, no desaparecer de la lista.
 */
export async function resolverEstadoPasos(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<CondicionesServidor> {
  return evaluarCondicionesServidor(supabase, userId)
}

/**
 * Borra la cookie de sesión del tutorial. La usa `cerrarSesion`
 * (`app/(auth)/actions.ts`): mismo tratamiento que `limpiarPerfilActivo` y
 * `limpiarCookieTamano` — un logout consciente también cuenta como frontera
 * de sesión, aunque el mecanismo principal sea el cierre del navegador (ver
 * el encabezado de `lib/consejos/sesion.ts`).
 *
 * El try/catch es el mismo caso, y por el mismo motivo, que
 * `limpiarCookieTamano`: si esto corriera durante el render de un Server
 * Component, `delete()` lanzaría. `cerrarSesion` es una Server Action, así
 * que en el camino real esto sí escribe.
 */
export async function limpiarSesionConsejos(): Promise<void> {
  const cookieStore = await cookies()
  try {
    cookieStore.delete(COOKIE_SESION_CONSEJOS)
  } catch {
    // No-op esperado. Ver el comentario de arriba.
  }
}
