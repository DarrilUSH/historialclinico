import "server-only"

/**
 * Escritura del archivo temporal del Web Share Target — EXCLUSIVAMENTE
 * SERVIDOR (Sprint 11, tarea 11.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. Mismo contrato que
 *      `lib/storage-admin.ts` y `lib/medicacion/generar-tomas-admin.ts`:
 *      jamás se importa desde código cliente.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Por qué hace falta `service_role` acá y en ningún otro punto del flujo: en
 * el momento del POST a `/api/compartir` la sesión todavía no eligió un
 * PERFIL de destino (ver el encabezado de
 * `supabase/migrations/20260814100000_share_target_temporal.sql`), así que no
 * hay ningún `profile_id` contra el que evaluar `puede_cargar_en_perfil`. La
 * política de `shared_uploads_temp` ni siquiera ofrece INSERT para
 * `authenticated` a propósito -ver esa migración-: la única puerta de entrada
 * es este módulo, después de que `app/api/compartir/route.ts` ya verificó la
 * sesión con `supabase.auth.getUser()`.
 *
 * Todo lo que pasa DESPUÉS de esto -leer la fila en `/compartir`, elegir
 * perfil, descartar, purgar las propias filas vencidas- usa el cliente NORMAL
 * del usuario (`lib/supabase/server.ts`): la política `..._select_propio` /
 * `..._delete_propio` ya alcanza para esas operaciones, y usar el cliente del
 * usuario ahí es la regla general del proyecto (RLS decide, no una excepción
 * más de `service_role`).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { validarArchivo } from "@/lib/archivos/validacion"
import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import { construirPathCompartido, TTL_COMPARTIDO_MINUTOS } from "@/lib/documentos/compartir-temporal"
import { BUCKETS, borrarObjeto, subirObjeto } from "@/lib/storage-admin"
import type { Database } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/documentos/compartir-temporal-admin.ts se importó desde el navegador. Este módulo usa " +
      "la SERVICE_ROLE_KEY y sólo puede ejecutarse en el servidor.",
  )
}

export type CodigoErrorGuardadoCompartido = "archivo_ausente" | "archivo_invalido" | "subida_fallida" | "registro_fallido"

/** Error de la escritura temporal. Mensaje en español, mostrable tal cual (mismo contrato que `ErrorIngesta`). */
export class ErrorGuardadoCompartido extends Error {
  readonly codigo: CodigoErrorGuardadoCompartido

  constructor(codigo: CodigoErrorGuardadoCompartido, mensaje: string) {
    super(mensaje)
    this.name = "ErrorGuardadoCompartido"
    this.codigo = codigo
  }
}

export interface ArchivoCompartidoGuardado {
  id: string
  storagePath: string
  mimeType: string
  originalFilename: string
  bytes: number
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
 * Valida, sube y registra un archivo compartido en el área de espera. Espeja
 * el orden y la lógica de compensación de `ingestarDocumento`
 * (`lib/documentos/ingesta.ts`): valida server-side por magic bytes (nunca
 * confía en el `type` que declaró el navegador), sube al bucket, inserta la
 * fila de seguimiento y, si el INSERT falla después de subir, borra el objeto
 * recién creado para no dejar un huérfano.
 *
 * @param userId Cuenta de Supabase Auth dueña del archivo (`auth.uid()` ya
 *   verificado por quien llama — este módulo no autoriza nada, ver el
 *   encabezado).
 */
export async function guardarArchivoCompartido(
  userId: string,
  archivo: File,
): Promise<ArchivoCompartidoGuardado> {
  if (archivo.size === 0) {
    throw new ErrorGuardadoCompartido("archivo_invalido", "El archivo compartido está vacío.")
  }

  const validacion = await validarArchivo(archivo)
  if (!validacion.valido || !validacion.tipo) {
    throw new ErrorGuardadoCompartido(
      "archivo_invalido",
      validacion.error ?? "El archivo compartido no es válido.",
    )
  }

  const storagePath = construirPathCompartido(userId, validacion.tipo)

  try {
    await subirObjeto(BUCKETS.compartidosTemp, storagePath, archivo, validacion.tipo)
  } catch (error) {
    console.error("[compartir] Falló la subida al área de espera:", error)
    throw new ErrorGuardadoCompartido(
      "subida_fallida",
      "No pudimos guardar el archivo compartido. Probá compartirlo de nuevo.",
    )
  }

  const expiresAt = new Date(Date.now() + TTL_COMPARTIDO_MINUTOS * 60_000).toISOString()

  const { data: fila, error: errorInsert } = await clienteAdmin()
    .from("shared_uploads_temp")
    .insert({
      user_id: userId,
      storage_path: storagePath,
      mime_type: validacion.tipo,
      original_filename: archivo.name || "Documento compartido",
      file_size_bytes: archivo.size,
      expires_at: expiresAt,
    })
    .select("id")
    .single()

  if (errorInsert || !fila) {
    // Compensación: mismo criterio que ErrorIngesta en lib/documentos/ingesta.ts.
    try {
      await borrarObjeto(BUCKETS.compartidosTemp, storagePath)
    } catch (errorBorrado) {
      console.error(
        `[compartir] Quedó un objeto huérfano en ${BUCKETS.compartidosTemp}/${storagePath}: ` +
          `falló el INSERT en shared_uploads_temp y también su compensación.`,
        errorBorrado,
      )
    }

    throw new ErrorGuardadoCompartido(
      "registro_fallido",
      "Guardamos el archivo pero no pudimos registrarlo. Probá compartirlo de nuevo.",
    )
  }

  return {
    id: fila.id,
    storagePath,
    mimeType: validacion.tipo,
    originalFilename: archivo.name || "Documento compartido",
    bytes: archivo.size,
  }
}

/**
 * Purga perezosa: borra las filas VENCIDAS de `shared_uploads_temp` que
 * pertenecen a `userId`, junto con sus objetos en `compartidos-temp`.
 *
 * NO usa el cliente admin para la tabla — usa `supabase`, el cliente NORMAL
 * de la sesión que llama, apoyado en la política `shared_uploads_temp_
 * delete_propio` (`user_id = auth.uid()`). Es la parte "admin" mínima
 * indispensable: `borrarObjeto` (`lib/storage-admin.ts`) es la única forma de
 * tocar el objeto en Storage, porque `compartidos-temp` no tiene ninguna
 * política de cliente (ver el encabezado de la migración).
 *
 * Se llama desde dos puntos (`app/api/compartir/route.ts` antes de aceptar un
 * archivo nuevo, y `app/(app)/(sin-nav)/compartir/page.tsx` al abrir la
 * pantalla): cubre el caso común de "alguien vuelve a tocar la función" sin
 * necesitar un job en segundo plano. El caso que NO cubre -una cuenta que
 * comparte una vez y nunca vuelve- queda documentado como deuda en
 * `docs/share-target.md` §6, con el mismo alcance que la purga de
 * `storage_purge_queue`.
 *
 * Best-effort: un fallo acá NUNCA bloquea el flujo principal (recibir un
 * archivo nuevo, o mostrar la pantalla de recepción). Se registra con el
 * prefijo `[compartir]`, mismo criterio que `[ingesta]` y `[extraccion]`.
 */
export async function purgarCompartidosVencidos(
  supabase: ClienteSupabaseServidor,
  userId: string,
): Promise<void> {
  try {
    const { data: vencidos, error } = await supabase
      .from("shared_uploads_temp")
      .select("id, storage_path")
      .eq("user_id", userId)
      .lte("expires_at", new Date().toISOString())

    if (error) {
      console.error("[compartir] No se pudo leer la cola de purga perezosa:", error.message)
      return
    }
    if (!vencidos || vencidos.length === 0) return

    for (const fila of vencidos) {
      try {
        await borrarObjeto(BUCKETS.compartidosTemp, fila.storage_path)
      } catch (errorBorrado) {
        // Se sigue igual con el DELETE de la fila: mejor una fila borrada con
        // un objeto huérfano ocasional -bucket privado, sin política de
        // cliente, nadie más lo puede leer- que una fila vencida que se
        // vuelve a intentar en cada visita para siempre.
        console.error(
          `[compartir] No se pudo borrar el objeto vencido ${BUCKETS.compartidosTemp}/${fila.storage_path}:`,
          errorBorrado,
        )
      }
    }

    const { error: errorDelete } = await supabase
      .from("shared_uploads_temp")
      .delete()
      .in(
        "id",
        vencidos.map((fila) => fila.id),
      )

    if (errorDelete) {
      console.error("[compartir] No se pudieron borrar las filas vencidas:", errorDelete.message)
    }
  } catch (error) {
    console.error("[compartir] Fallo inesperado en la purga perezosa:", error)
  }
}
