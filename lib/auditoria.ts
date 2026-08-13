import "server-only"

/**
 * Auditoría de accesos a datos de salud (`access_logs`).
 *
 * Ley 25.326 y `docs/modelo-permisos.md` §4.1: todo acceso a datos de salud de
 * un tercero tiene que quedar registrado y ser consultable por el titular del
 * perfil. Este módulo es la ÚNICA puerta de escritura de esa tabla desde la
 * aplicación.
 *
 * ## Tres decisiones que este archivo no negocia
 *
 * **1. Se escribe con el cliente del USUARIO, nunca con `service_role`.**
 * La política `access_logs_insert_actor_propio`
 * (`supabase/migrations/20260812220000_rls.sql`) exige
 * `actor_user_id = auth.uid()`: quien decide si la fila entra es RLS, no este
 * código. Con `service_role` la auditoría podría firmar a nombre de cualquiera
 * y dejaría de ser prueba de nada.
 *
 * **2. La tabla es APPEND-ONLY.** No hay `actualizarAcceso` ni `borrarAcceso`
 * y no los va a haber: `authenticated` no tiene privilegio de `UPDATE` ni de
 * `DELETE` sobre `access_logs` (sección 4 de la migración de RLS) y tampoco
 * existe política para esas dos operaciones. Las dos capas dicen lo mismo a
 * propósito.
 *
 * **3. Auditar NUNCA rompe el flujo que audita.** `registrarAcceso` captura
 * cualquier error -de red, de RLS, de headers, de sesión- lo escribe en la
 * consola del servidor y devuelve normalmente. La decisión es deliberada y
 * tiene un costo que conviene tener a la vista:
 *
 * - A favor: si la auditoría falla, bloquear el login (o el cambio de perfil)
 *   deja a la persona AFUERA de su propio historial médico por un problema de
 *   registro. En una app que un adulto mayor puede necesitar en una guardia,
 *   eso es peor que un renglón de auditoría perdido.
 * - En contra: un fallo sistemático de escritura se vuelve invisible para el
 *   usuario. Por eso el error se loguea con un prefijo estable
 *   (`[auditoria]`) que sirve de patrón de alerta cuando haya observabilidad
 *   de servidor (Sprint 10).
 * - Lo que esta decisión NO hace: no relaja ninguna política. Una escritura
 *   rechazada por RLS se traga igual que un timeout, pero sigue sin
 *   escribirse. "No romper el flujo" es sobre el manejo del error, no sobre
 *   el permiso.
 *
 * Si algún día aparece una acción cuya auditoría sea condición de la
 * operación misma (por ejemplo una exportación completa de la ficha con
 * requisito legal de constancia previa), esa acción necesita su propia
 * función que SÍ propague el error. No se cambia el contrato de esta.
 *
 * ## Dónde se llama (contrato con los sprints siguientes)
 *
 * | Acción | Dónde se registra | Estado |
 * |---|---|---|
 * | `login`              | `iniciarSesion` — `app/(auth)/actions.ts`, tras la sesión exitosa | ✅ Sprint 2 |
 * | `ver_perfil`         | `fijarPerfilActivo` — `lib/perfil-activo.ts`, SOLO al elegir/cambiar perfil | ✅ Sprint 2 |
 * | `ver_documento`      | Detalle de estudio (`app/(app)/documentos/[id]`), una fila por apertura | Sprint 4 |
 * | `descargar_archivo`  | Emisión de signed URL del bucket `documentos-medicos` | Sprint 4 |
 * | `ver_credencial`     | Apertura de la foto de una credencial de cobertura | Sprint 8 |
 * | `exportar_ficha`     | Generación de la ficha SOS imprimible | Sprint 6 |
 * | `otorgar_permiso` / `revocar_permiso` | `app/(app)/(con-nav)/familia/actions.ts` | pendiente (fuera del alcance de esta tarea) |
 *
 * `ver_perfil` se registra en `fijarPerfilActivo` y NO en `obtenerPerfilActivo`
 * a propósito: `obtenerPerfilActivo` corre en cada request de cada página bajo
 * `app/(app)`, así que auditarlo ahí generaría una fila por request y volvería
 * la lista del titular ilegible -que es exactamente lo que la granularidad del
 * enum `access_action` viene a evitar (`docs/modelo-permisos.md` §4.1, último
 * párrafo)-. La granularidad elegida es "entró al perfil", no "renderizó una
 * pantalla".
 */

import { headers } from "next/headers"

import { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database.types"
import type { AccionAcceso } from "@/types/dominio"

/**
 * Los literales del enum `public.access_action`, tipados desde
 * `types/database.types.ts`. Se exportan como objeto para que los llamadores
 * escriban `ACCION.ver_documento` en vez de un string suelto: si mañana se
 * agrega o renombra un literal en la migración y se regeneran los tipos, el
 * compilador marca acá y en cada uso, no en runtime contra un `22P02` de
 * Postgres.
 */
export const ACCION = {
  login: "login",
  logout: "logout",
  ver_perfil: "ver_perfil",
  ver_documento: "ver_documento",
  descargar_archivo: "descargar_archivo",
  ver_credencial: "ver_credencial",
  exportar_ficha: "exportar_ficha",
  otorgar_permiso: "otorgar_permiso",
  revocar_permiso: "revocar_permiso",
} as const satisfies Record<AccionAcceso, AccionAcceso>

/** Acción auditada. Alias del enum de la base (`public.access_action`). */
export type { AccionAcceso }

export interface EntradaAuditoria {
  /**
   * Perfil cuyos datos se accedieron (`access_logs.profile_id`).
   *
   * Se puede omitir cuando la acción no es sobre datos de un tercero -el caso
   * de `login`-: en ese caso se completa con el perfil del propio actor, o
   * queda `null` si la cuenta todavía no creó su perfil (estado válido: recién
   * registrada). Nunca se infiere el perfil de un tercero.
   */
  perfilId?: string | null
  accion: AccionAcceso
  /** Tabla o recurso afectado ("documents", "insurance_cards", "ficha"). */
  recursoTipo?: string | null
  /** Id del recurso accedido. Sin FK: el registro sobrevive al borrado del recurso. */
  recursoId?: string | null
  /**
   * Contexto adicional del evento. NO debe contener datos de salud ni
   * identificatorios (comentario de la columna en el esquema inicial).
   */
  metadata?: Json | null
}

function esIpv4(valor: string): boolean {
  const octetos = valor.split(".")
  return (
    octetos.length === 4 &&
    octetos.every((octeto) => /^\d{1,3}$/.test(octeto) && Number(octeto) <= 255)
  )
}

/**
 * IPv6, **incluida la forma "mapeada"** `::ffff:127.0.0.1`, que es
 * exactamente la que manda el servidor de desarrollo de Next para una
 * conexión desde localhost. Validar con un simple `[0-9a-f:]+` la rechazaría
 * por los puntos, y toda la auditoría local quedaría sin IP sin que nada
 * fallara de forma visible.
 */
function esIpv6(valor: string): boolean {
  if (!valor.includes(":")) {
    return false
  }
  const mapeada = /^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(valor)
  if (mapeada) {
    return /^[0-9a-f:]+$/i.test(mapeada[1]) && esIpv4(mapeada[2])
  }
  return /^[0-9a-f:]+$/i.test(valor)
}

/**
 * Extrae una dirección utilizable de un header `x-forwarded-for` /
 * `x-real-ip`, y **la valida antes de mandarla**: la columna es `inet`, así
 * que un valor con basura haría fallar el INSERT entero y perderíamos la fila
 * de auditoría completa por el dato menos importante que lleva. Si no parsea,
 * se manda `null` y todo lo demás se guarda igual.
 *
 * No se reescribe la dirección (una `::ffff:127.0.0.1` se guarda tal cual):
 * la auditoría registra lo que llegó, no una interpretación.
 */
function normalizarIp(valor: string | null): string | null {
  if (!valor) {
    return null
  }

  // `x-forwarded-for` puede traer la cadena de proxies: el primero es el
  // cliente original.
  const primera = valor.split(",")[0]?.trim()
  if (!primera) {
    return null
  }

  // IPv6 entre corchetes, con puerto opcional (`[::1]:54321`).
  const sinCorchetes = /^\[(.+)\](?::\d+)?$/.exec(primera)?.[1] ?? primera

  // IPv4 con puerto (`186.22.1.5:54321`). Solo IPv4: en IPv6 los `:` son
  // parte de la dirección y recortar por el último rompería la dirección.
  const candidato =
    /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(sinCorchetes)?.[1] ?? sinCorchetes

  if (esIpv4(candidato) || esIpv6(candidato)) {
    return candidato
  }
  return null
}

/** Tope defensivo: un `user-agent` es corto, y `text` no tiene por qué recibir un payload. */
const MAX_USER_AGENT = 512

/**
 * Registra una fila en `access_logs` con el cliente del usuario.
 *
 * Completa por su cuenta -y no acepta que se los pasen- los cuatro campos que
 * hacen confiable al registro: `actor_user_id` (la sesión), `actor_profile_id`
 * (el perfil desde el que se opera, vía `perfil_actor()`), `ip` y
 * `user_agent` (headers de la request). Firmar a nombre de otro es
 * precisamente lo que la política de INSERT rechaza.
 *
 * **No lanza nunca.** Ver la decisión 3 del encabezado del archivo.
 *
 * ```ts
 * await registrarAcceso({ perfilId, accion: ACCION.ver_perfil })
 * ```
 */
export async function registrarAcceso(entrada: EntradaAuditoria): Promise<void> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      // Sin sesión no hay nada que auditar y la política de INSERT lo
      // rechazaría igual (`actor_user_id = auth.uid()` contra NULL no es
      // TRUE). Es el caso de un login FALLIDO: no genera fila, y tampoco
      // rompe el flujo ni ensucia la consola con un error que no lo es.
      return
    }

    // El perfil actor sale de la misma función SECURITY DEFINER que usan las
    // políticas RLS, para que "desde qué perfil se operaba" no pueda divergir
    // entre la app y la base. Devuelve NULL si la cuenta aún no tiene perfil.
    const { data: perfilActor } = await supabase.rpc("perfil_actor")

    const encabezados = await headers()
    const ip =
      normalizarIp(encabezados.get("x-forwarded-for")) ??
      normalizarIp(encabezados.get("x-real-ip"))
    const userAgent = encabezados.get("user-agent")?.slice(0, MAX_USER_AGENT) ?? null

    const { error } = await supabase.from("access_logs").insert({
      actor_user_id: user.id,
      actor_profile_id: perfilActor ?? null,
      // `login` no lleva perfil de terceros: se cae al perfil propio.
      profile_id: entrada.perfilId ?? perfilActor ?? null,
      action: entrada.accion,
      resource_type: entrada.recursoTipo ?? null,
      resource_id: entrada.recursoId ?? null,
      ip,
      user_agent: userAgent,
      metadata: entrada.metadata ?? null,
    })

    if (error) {
      console.error(
        `[auditoria] No se pudo registrar "${entrada.accion}": ${error.message}`,
      )
    }
  } catch (error) {
    // Cualquier cosa: headers() fuera de una request, la base caída, un
    // cliente que no se pudo construir. Se registra y se sigue.
    console.error(`[auditoria] Fallo al registrar "${entrada.accion}":`, error)
  }
}
