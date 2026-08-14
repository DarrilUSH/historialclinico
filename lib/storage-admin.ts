/**
 * Acceso administrativo a Supabase Storage — EXCLUSIVAMENTE SERVIDOR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. JAMÁS SE IMPORTA DESDE CÓDIGO
 *      CLIENTE: ni un Client Component, ni un hook, ni un archivo con
 *      "use client", ni nada que termine en el bundle del navegador.
 *
 *      La `SUPABASE_SERVICE_ROLE_KEY` tiene el atributo BYPASSRLS: para ella no
 *      existe ninguna de las políticas de `20260812220000_rls.sql` ni de
 *      `20260812230000_storage.sql`. Filtrarla al cliente no es "una fuga de una
 *      clave": es entregar el historial médico completo de todas las familias.
 *
 *      Por eso el archivo se llama `storage-admin` y no `storage`: que el nombre
 *      del import grite lo que es. El módulo además aborta al cargarse si
 *      detecta que está corriendo en un navegador (ver guarda de abajo).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  ESTE MÓDULO NO AUTORIZA NADA. Saltea RLS por diseño, así que `crearSignedUrl`
 *  firma cualquier path que se le pase. **Quien llama es responsable de haber
 *  verificado el permiso antes**, con el guarda `requerirPermiso` del Sprint 2 o
 *  consultando la fila correspondiente con el cliente del usuario (que sí pasa
 *  por RLS). El orden correcto es siempre:
 *
 *      1. leer la fila de `documents` / `insurance_cards` con el cliente del
 *         USUARIO  → si RLS la deja pasar, el permiso está verificado;
 *      2. recién entonces pedir la signed URL con este módulo;
 *      3. registrar el acceso en `access_logs` (`descargar_archivo`).
 *
 *  Ver `docs/seguridad-rls.md` §7 y `docs/modelo-permisos.md` §7.4.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/storage-admin.ts se importó desde el navegador. Este módulo usa la ' +
      'SERVICE_ROLE_KEY y sólo puede ejecutarse en el servidor.',
  );
}

/**
 * Buckets privados del producto. Los literales tienen que coincidir con los de
 * `20260812230000_storage.sql` y con los que encola `public.encolar_purga_storage()`.
 */
export const BUCKETS = {
  documentos: 'documentos-medicos',
  credenciales: 'credenciales-cobertura',
  avatares: 'avatares',
} as const;

export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

/**
 * Vida de una signed URL, en segundos.
 *
 * El máximo es 300 y no es arbitrario: es la única ventana real de exposición
 * después de revocar un permiso. Borrar la fila de `family_permissions` corta el
 * acceso a las tablas de inmediato, pero una signed URL ya emitida sigue
 * sirviendo el archivo hasta que expira, sin volver a consultar la base
 * (`docs/modelo-permisos.md` §8.1). Cuanto más corta, menor la ventana.
 */
export const TTL_MINIMO_SEGUNDOS = 1;
export const TTL_DEFAULT_SEGUNDOS = 60;
export const TTL_MAXIMO_SEGUNDOS = 300;

let clienteCache: SupabaseClient | null = null;

function clienteAdmin(): SupabaseClient {
  if (clienteCache) return clienteCache;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL.');
  }
  if (!serviceRoleKey) {
    throw new Error('Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY.');
  }

  clienteCache = createClient(url, serviceRoleKey, {
    auth: {
      // Un cliente de servidor no tiene sesión que persistir ni que refrescar,
      // y no debe intentar leer el fragmento de la URL.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return clienteCache;
}

/** Rechaza paths vacíos, absolutos o que sean una URL (mismo criterio que los CHECK de la base). */
function validarPath(path: string): string {
  const limpio = path.trim();

  if (limpio.length === 0) {
    throw new Error('El path del objeto no puede estar vacío.');
  }
  if (limpio.toLowerCase().startsWith('http')) {
    throw new Error(
      `El path del objeto no puede ser una URL ("${limpio}"). En la base se guarda ` +
        'siempre el path dentro del bucket; el acceso se hace por signed URL.',
    );
  }
  if (limpio.startsWith('/')) {
    throw new Error(`El path del objeto no puede empezar con "/" ("${limpio}").`);
  }
  return limpio;
}

/**
 * Emite una signed URL de vida corta para leer un objeto privado.
 *
 * No verifica permisos: ver la advertencia del encabezado del módulo.
 *
 * @param bucket   Bucket privado donde vive el objeto.
 * @param path     Path dentro del bucket, con el `profile_id` como primer segmento.
 * @param segundos Vida de la URL. Default 60, máximo 300.
 */
export async function crearSignedUrl(
  bucket: Bucket,
  path: string,
  segundos: number = TTL_DEFAULT_SEGUNDOS,
): Promise<string> {
  const rutaLimpia = validarPath(path);

  if (!Number.isInteger(segundos)) {
    throw new Error(`La expiración debe ser un entero de segundos (recibido: ${segundos}).`);
  }
  if (segundos < TTL_MINIMO_SEGUNDOS || segundos > TTL_MAXIMO_SEGUNDOS) {
    throw new Error(
      `La expiración debe estar entre ${TTL_MINIMO_SEGUNDOS} y ${TTL_MAXIMO_SEGUNDOS} segundos ` +
        `(recibido: ${segundos}). El techo acota la ventana de exposición posterior a una revocación.`,
    );
  }

  const { data, error } = await clienteAdmin()
    .storage.from(bucket)
    .createSignedUrl(rutaLimpia, segundos);

  if (error) {
    throw new Error(`No se pudo firmar "${bucket}/${rutaLimpia}": ${error.message}`);
  }
  if (!data?.signedUrl) {
    throw new Error(`Storage no devolvió una URL firmada para "${bucket}/${rutaLimpia}".`);
  }

  return data.signedUrl;
}

/** Objeto leído del bucket, listo para devolverlo por HTTP. */
export interface ObjetoDescargado {
  /** Contenido crudo. `Response` lo transmite en streaming, sin copiarlo a un string. */
  datos: Blob;
  /** MIME que reportó Storage, o `application/octet-stream` si no vino ninguno. */
  tipo: string;
}

/**
 * Lee el contenido de un objeto privado, para servirlo desde un Route Handler
 * con una URL propia del proyecto en vez de una signed URL.
 *
 * Existe por el modo offline (Sprint 8, tarea 8.4): una signed URL cambia en
 * cada emisión y expira a los 300 segundos, así que como clave de caché no
 * sirve —cada apertura crearía una entrada nueva que nace vencida—. Servir los
 * bytes desde una URL estable le da al service worker algo que puede guardar,
 * y mantiene la verificación de permiso en el servidor, request por request.
 * Ver `docs/offline.md` §4.
 *
 * No verifica permisos: vale la advertencia del encabezado del módulo. Quien
 * llama tiene que haber leído antes la fila correspondiente con el cliente del
 * USUARIO (que sí pasa por RLS).
 */
export async function descargarObjeto(bucket: Bucket, path: string): Promise<ObjetoDescargado> {
  const rutaLimpia = validarPath(path);

  const { data, error } = await clienteAdmin().storage.from(bucket).download(rutaLimpia);

  if (error) {
    throw new Error(`No se pudo descargar "${bucket}/${rutaLimpia}": ${error.message}`);
  }
  if (!data) {
    throw new Error(`Storage no devolvió contenido para "${bucket}/${rutaLimpia}".`);
  }

  return { datos: data, tipo: data.type || 'application/octet-stream' };
}

/**
 * Borra un objeto del bucket.
 *
 * Va por la Storage API a propósito: un `DELETE` por SQL contra
 * `storage.objects` deja el archivo físico huérfano en el backend, y de hecho
 * Supabase lo bloquea con el trigger `protect_objects_delete`. Es la misma razón
 * por la que el job que drene `storage_purge_queue` (Sprint 6) tiene que usar
 * esta función y no SQL.
 */
export async function borrarObjeto(bucket: Bucket, path: string): Promise<void> {
  const rutaLimpia = validarPath(path);

  const { error } = await clienteAdmin().storage.from(bucket).remove([rutaLimpia]);

  if (error) {
    throw new Error(`No se pudo borrar "${bucket}/${rutaLimpia}": ${error.message}`);
  }
}
