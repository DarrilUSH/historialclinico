/**
 * Lectura del ESTADO de la conexión de Gmail para la interfaz (Sprint 17,
 * tarea 17.1).
 *
 * Se lee con el cliente del USUARIO -el de `lib/supabase/server.ts`, que pasa
 * por RLS- y no con `service_role`, siguiendo la regla del proyecto: si la
 * base la deja pasar, el permiso está verificado. La política
 * `gmail_connections_select_propia` acota a la fila propia, y el GRANT por
 * columna de `20260818130000_gmail_conexiones.sql` §2 hace el resto.
 *
 * ## Las columnas se nombran una por una, y no es estilo
 *
 * `granted_scopes` y `token_secret_id` están FUERA del privilegio de
 * `authenticated`. Un `select("*")` desde acá no devolvería menos columnas:
 * fallaría entero con `42501 permission denied`. La lista explícita de abajo
 * es lo que hace que esta consulta funcione, y también lo que hace que
 * agregar mañana una columna sensible a la tabla no se filtre sola a la
 * pantalla.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/** Columnas que `authenticated` tiene permitido leer. Espeja el GRANT de la migración. */
const COLUMNAS_VISIBLES =
  "user_id, email, status, label_id, label_name, connected_at, last_ok_at, expired_at"

export type EstadoGmail = "conectada" | "vencida"

export interface ConexionGmail {
  email: string
  estado: EstadoGmail
  /** Id de la etiqueta en Gmail, o `null` si no se pudo resolver al conectar. */
  labelId: string | null
  /** Nombre visible de la etiqueta (casi siempre `historialmedico`). */
  labelName: string
  conectadaEl: string
  ultimoOk: string | null
  vencidaEl: string | null
}

/**
 * La conexión de la cuenta en sesión, o `null` si no conectó nunca.
 *
 * No lanza ante un error de la base: devuelve `null` y lo deja en los logs. La
 * pantalla de configuración no puede romperse porque una consulta accesoria
 * falló — el peor resultado aceptable es ofrecer "Conectar" a alguien que ya
 * está conectado, y esa pantalla lo resuelve reconectando.
 */
export async function obtenerConexionGmail(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<ConexionGmail | null> {
  const { data, error } = await supabase
    .from("gmail_connections")
    .select(COLUMNAS_VISIBLES)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    console.error("[gmail] no se pudo leer el estado de la conexión:", error.message)
    return null
  }
  if (!data) return null

  return {
    email: data.email,
    estado: data.status === "vencida" ? "vencida" : "conectada",
    labelId: data.label_id,
    labelName: data.label_name,
    conectadaEl: data.connected_at,
    ultimoOk: data.last_ok_at,
    vencidaEl: data.expired_at,
  }
}

/**
 * Resultado del intento de conexión, tal como viaja en el `?resultado=` con el
 * que el callback vuelve a la pantalla.
 *
 * Es un dominio CERRADO a propósito: la pantalla tiene que redactar una frase
 * en castellano por cada caso, y si mañana aparece uno nuevo el compilador
 * marca el mapa incompleto en vez de dejarlo caer en un genérico. Mismo
 * criterio que `FalloDeGraduacion` (`lib/auth/cuentas-admin.ts`).
 */
export const RESULTADOS_CONEXION = [
  /** Quedó conectada y la etiqueta lista. */
  "conectada",
  /** La persona tocó "Cancelar" en la pantalla de Google. No es un error. */
  "cancelada",
  /** El `state` no validó: sobre vencido, alterado, o de otro intento. */
  "estado_invalido",
  /** Google no mandó `refresh_token` (no debería pasar con prompt=consent). */
  "sin_refresh_token",
  /** Google rechazó el intercambio, o la API de Gmail falló. */
  "fallo_google",
  /** Este entorno no tiene cargadas GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. */
  "sin_configurar",
  /** El host desde el que se entró no es ninguno de los dos registrados en Google. */
  "origen_no_registrado",
  /** Se desconectó a pedido de la persona. */
  "desconectada",
] as const

export type ResultadoConexion = (typeof RESULTADOS_CONEXION)[number]

export function esResultadoConexion(valor: unknown): valor is ResultadoConexion {
  return typeof valor === "string" && (RESULTADOS_CONEXION as readonly string[]).includes(valor)
}

/**
 * Estado de la Server Action de desconexión.
 *
 * **Vive acá y no en `app/(app)/(con-nav)/perfil/gmail/actions.ts`, y no es
 * una cuestión de orden.** Un archivo con `"use server"` solo puede exportar
 * funciones asíncronas: cualquier otra cosa -un objeto de estado inicial, una
 * constante, un enum- hace que Next falle **en tiempo de ejecución**, con
 * `A "use server" file can only export async functions, found object`, cuando
 * se invoca la acción. El `build` de producción NO lo detecta: compila
 * limpio y explota recién al tocar el botón. Se descubrió justamente así, en
 * el Galaxy real, tocando "Sí, desconectar" (Sprint 17, tarea 17.1).
 *
 * Los `type`/`interface` sí pueden declararse en el archivo de acciones
 * -TypeScript los borra al compilar-, pero se dejan acá junto al valor para
 * que no queden a un import de distancia el uno del otro.
 */
export interface EstadoGmailAccion {
  error: string | null
  mensaje: string | null
  /**
   * `true` cuando la conexión local se borró pero Google no confirmó la
   * revocación. La pantalla lo explica y enlaza a la página de permisos de la
   * cuenta de Google.
   */
  revocacionPendiente: boolean
}

export const ESTADO_GMAIL_INICIAL: EstadoGmailAccion = {
  error: null,
  mensaje: null,
  revocacionPendiente: false,
}
