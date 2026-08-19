import "server-only"

/**
 * Sincronización POR TANDAS del catálogo REFES (Sprint 16, tarea 16.3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO USA LA SERVICE_ROLE_KEY. Solo lo importa
 *      `app/api/lugares/sincronizar/route.ts`, que YA verificó la sesión.
 *      Valen todas las advertencias del encabezado de `lib/storage-admin.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## El problema: 36.046 filas no entran en una función serverless
 *
 * Vercel Hobby le pone un techo de duración corto a cada invocación. Medido
 * en local sobre esta misma tabla: parsear los 9 MB del CSV cuesta ~180 ms,
 * pero el `upsert` de las 36.046 filas cuesta ~1,8 s **contra una base en la
 * misma máquina**; contra Supabase por internet, con el ida y vuelta de cada
 * lote, es varias veces eso. Sumado a los ~2,6 s que tarda la descarga desde
 * el Ministerio, un solo request no alcanza y, peor, cortarse a la mitad
 * dejaría el catálogo incompleto sin forma de saber por dónde iba.
 *
 * ## La solución: el cliente orquesta, el servidor procesa una ventana
 *
 * 1. **Preparación** (`prepararSincronizacion`): toma el lock, le pregunta al
 *    portal cuál es la edición más nueva, y si ya es la vigente contesta "al
 *    día" **sin descargar nada**. Si no, baja el CSV una sola vez, cuenta sus
 *    filas y lo deja en el bucket privado `refes-sync`.
 * 2. **Tandas** (`procesarTanda`), en un bucle que maneja el navegador: cada
 *    una lee UNA VENTANA de bytes del archivo guardado (HTTP `Range` contra
 *    Storage, que sí lo honra — el portal del Ministerio NO, ver
 *    `lib/storage-admin.ts#descargarRangoDeObjeto`), parsea las filas
 *    completas, las escribe con `upsert` y guarda el byte donde quedó.
 * 3. **Cierre**: cuando el offset llega al final, borra los centros que la
 *    edición nueva ya no trae, cuenta el total, marca la edición como vigente
 *    y borra el CSV temporal.
 *
 * ## Por qué el estado vive en la base y no en memoria
 *
 * Dos razones, las dos medidas contra la realidad y no supuestas:
 *
 * - **Cada request puede caer en otra instancia.** Una variable de módulo en
 *   una función serverless no sobrevive de forma confiable entre
 *   invocaciones: la tanda 4 puede no ver nada de lo que dejó la 3.
 * - **La corrida tiene que ser REANUDABLE.** Si la persona cierra la pestaña
 *   en la tanda 5 de 9, la próxima vez que apriete "Actualizar" se retoma
 *   desde el byte 5.242.880 en vez de empezar de cero y volver a bajar 9 MB.
 *
 * ## El lock
 *
 * `public.reclamar_sincronizacion_refes()` (ver la migración) lo resuelve en
 * una sola sentencia atómica, y caduca por falta de latido. Además, cada
 * tanda trae un TOKEN (`run_started_at` de la corrida que la preparó): si
 * mientras un navegador dormía otro tomó el lock y empezó una corrida nueva,
 * las tandas viejas se rechazan en vez de avanzar el offset de la corrida
 * ajena.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { contarFilasCsv, parsearVentanaCsv } from "@/lib/lugares/csv"
import { descargarCsvRefes, descubrirEdicionMasNueva, huellaDelCsv } from "@/lib/lugares/descarga"
import { filaAcentro, verificarEncabezado, type CentroParaGuardar } from "@/lib/lugares/refes"
import {
  BUCKETS,
  borrarObjeto,
  descargarRangoDeObjeto,
  subirObjeto,
} from "@/lib/storage-admin"
import type { Database } from "@/types/database.types"

if (typeof window !== "undefined") {
  throw new Error(
    "lib/lugares/sincronizacion.ts se importó desde el navegador. Este módulo usa la " +
      "SERVICE_ROLE_KEY: sólo puede ejecutarse en el servidor.",
  )
}

/**
 * Bytes que procesa cada tanda.
 *
 * Elegido midiendo, no a ojo. Con las filas del REFES promediando 249 bytes,
 * 1 MiB son unas **4.200 filas**, es decir tres lotes de `upsert`. Sobre el
 * stack local eso es ~0,25 s de lectura de Storage + ~0,03 s de parseo +
 * ~0,2 s de escritura; contra Supabase por internet, con el ida y vuelta por
 * lote, sigue holgadamente abajo de 10 segundos, que es el techo conservador
 * con el que se diseñó (el `maxDuration` declarado es 60, pero una tanda que
 * necesita 60 segundos es una tanda mal dimensionada).
 *
 * Ventanas más grandes reducen los viajes desde el navegador -9 tandas para
 * el archivo entero- pero acercan el techo de duración; más chicas dan una
 * barra de progreso más fina a costa de más latencia acumulada. 1 MiB es el
 * punto donde el archivo entra en ~9 pasos visibles sin que ninguno se
 * arrime al límite.
 */
export const VENTANA_BYTES = 1_048_576

/**
 * Filas por `upsert`. Medido con la tabla real: lotes de 500 dan 16.573
 * filas/s, de 1.000 dan 18.086, de 2.000 dan 19.981 y de 4.000 dan 21.649. La
 * curva se aplana después de 2.000 y los lotes grandes crecen el cuerpo del
 * request (2.000 filas ≈ 700 KB de JSON), así que 2.000 es donde el
 * rendimiento ya está y el riesgo de rebotar contra un límite de tamaño
 * todavía no.
 */
export const LOTE_UPSERT = 2_000

/**
 * Segundos que un lock sobrevive sin latido. Cada tanda late, y una tanda
 * dura segundos: dos minutos de silencio significan que quien sincronizaba se
 * fue.
 */
export const TTL_LOCK_SEGUNDOS = 120

/** Path del CSV dentro del bucket privado, derivado de la identidad de la edición. */
export function rutaStaging(resourceId: string): string {
  return `refes/${resourceId.replace(/[^a-zA-Z0-9._-]/g, "_")}.csv`
}

export type EtapaSincronizacion = "al-dia" | "en-curso" | "completo" | "ocupado"

/** Lo que la API le devuelve al navegador después de cada paso. */
export interface ProgresoSincronizacion {
  etapa: EtapaSincronizacion
  /** Token de la corrida. Hay que mandarlo de vuelta en cada tanda. `null` si no hay corrida. */
  token: string | null
  filasProcesadas: number
  filasTotales: number | null
  bytesProcesados: number
  bytesTotales: number | null
  /** Nombre de la edición del REFES que se está sincronizando. */
  edicion: string | null
  /** Centros que hay en el catálogo (solo al terminar). */
  centrosEnCatalogo: number | null
  /** Cuándo terminó la última sincronización completa, en ISO. */
  ultimaActualizacion: string | null
}

export class ErrorSincronizacion extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = "ErrorSincronizacion"
  }
}

type ClienteAdmin = SupabaseClient<Database>

let clienteCache: ClienteAdmin | null = null

function clienteAdmin(): ClienteAdmin {
  if (clienteCache) return clienteCache

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error("Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL.")
  if (!serviceRoleKey) throw new Error("Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY.")

  clienteCache = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  return clienteCache
}

type FilaSync = Database["public"]["Tables"]["health_centers_sync"]["Row"]

async function leerFila(cliente: ClienteAdmin): Promise<FilaSync> {
  const { data, error } = await cliente.from("health_centers_sync").select("*").single()

  if (error || !data) {
    throw new ErrorSincronizacion(
      `No se pudo leer el estado de la sincronización: ${error?.message ?? "sin fila"}.`,
    )
  }
  return data
}

function progresoDe(fila: FilaSync, etapa: EtapaSincronizacion): ProgresoSincronizacion {
  return {
    etapa,
    token: fila.run_started_at,
    filasProcesadas: fila.run_rows_processed,
    filasTotales: fila.run_total_rows,
    bytesProcesados: Number(fila.run_byte_offset ?? 0),
    bytesTotales: fila.run_total_bytes === null ? null : Number(fila.run_total_bytes),
    edicion: fila.run_resource_id ?? fila.current_resource_id,
    centrosEnCatalogo: fila.current_row_count,
    ultimaActualizacion: fila.current_synced_at,
  }
}

/** Suelta el lock dejando anotado el motivo (o ninguno, si terminó bien). */
async function soltarLock(cliente: ClienteAdmin, motivo: string | null): Promise<void> {
  await cliente
    .from("health_centers_sync")
    .update({ status: motivo ? "error" : "idle", run_error: motivo })
    .eq("id", true)
}

/**
 * Paso 1: toma el lock, decide si hay algo que sincronizar y deja el CSV
 * listo en Storage.
 *
 * `forzar` re-descarga aunque la edición vigente ya sea la más nueva. Existe
 * para el caso en que el catálogo local quedó a medias por un motivo que la
 * comparación de ediciones no puede ver (una corrida abandonada hace meses,
 * una restauración de la base).
 */
export async function prepararSincronizacion(
  usuarioId: string,
  opciones: { forzar?: boolean } = {},
): Promise<ProgresoSincronizacion> {
  const cliente = clienteAdmin()

  const { data: tomado, error: errorLock } = await cliente.rpc("reclamar_sincronizacion_refes", {
    p_usuario: usuarioId,
    p_ttl_segundos: TTL_LOCK_SEGUNDOS,
  })

  if (errorLock) {
    throw new ErrorSincronizacion(`No se pudo tomar el lock de sincronización: ${errorLock.message}.`)
  }
  if (tomado !== true) {
    const fila = await leerFila(cliente)
    return progresoDe(fila, "ocupado")
  }

  try {
    const fila = await leerFila(cliente)

    // ── Reanudación: hay una corrida a medio hacer sobre un CSV que sigue
    // guardado. No se vuelve a descargar nada; se sigue desde el byte donde
    // quedó. Este es el caso "se cortó a la mitad" del criterio de la tarea.
    const puedeReanudar =
      fila.run_storage_path !== null &&
      fila.run_total_bytes !== null &&
      Number(fila.run_byte_offset) < Number(fila.run_total_bytes)

    if (puedeReanudar && !opciones.forzar) {
      return progresoDe(fila, "en-curso")
    }

    // ── ¿Hay una edición nueva?
    //
    // Primero la API del portal (120 ms) dice cuál es el recurso CSV más
    // nuevo. Si es EL MISMO que ya está vigente, un HEAD al archivo (350 ms)
    // alcanza para saber si su contenido cambió, sin bajar los 9 MB ni
    // reprocesar 36.046 filas. Ese es todo el camino de "ya estás al día":
    // menos de medio segundo contra el portal y cero escritura en la base.
    const edicion = await descubrirEdicionMasNueva()

    if (
      !opciones.forzar &&
      fila.current_resource_id === edicion.resourceId &&
      (fila.current_row_count ?? 0) > 0
    ) {
      const huella = await huellaDelCsv(edicion.resourceUrl)

      // Se comparan CABECERA contra CABECERA -las dos guardadas de una
      // descarga anterior, las dos leídas del mismo servidor-, nunca la
      // cabecera contra la fecha de la API: CKAN publica su `last_modified`
      // sin zona horaria y `Date.parse` la interpreta en la hora local del
      // servidor, así que esa comparación jamás da igual. Ver el comentario
      // de `huellaDelCsv`.
      const mismoArchivo =
        (huella.etag !== null && huella.etag === fila.current_etag) ||
        mismaFecha(fila.current_last_modified, huella.lastModified)

      if (mismoArchivo) {
        await soltarLock(cliente, null)
        return progresoDe(await leerFila(cliente), "al-dia")
      }
    }

    // ── Descarga única y copia al bucket privado.
    const csv = await descargarCsvRefes(edicion.resourceUrl)
    const texto = csv.contenido.toString("utf8")
    const filasTotales = contarFilasCsv(texto)

    if (filasTotales === 0) {
      throw new ErrorSincronizacion(
        "El CSV del REFES llegó sin ninguna fila de datos. No se toca el catálogo.",
      )
    }

    const path = rutaStaging(edicion.resourceId)
    await subirObjeto(
      BUCKETS.refesSync,
      path,
      new Blob([new Uint8Array(csv.contenido)], { type: "text/csv" }),
      "text/csv",
      { sobrescribir: true },
    )

    const ahora = new Date().toISOString()
    const { error } = await cliente
      .from("health_centers_sync")
      .update({
        run_resource_id: edicion.resourceId,
        run_resource_url: edicion.resourceUrl,
        run_last_modified: csv.lastModified ?? edicion.lastModified,
        run_etag: csv.etag,
        run_storage_path: path,
        run_total_bytes: csv.contenido.length,
        run_total_rows: filasTotales,
        run_byte_offset: 0,
        run_rows_processed: 0,
        run_data_since: ahora,
        run_error: null,
      })
      .eq("id", true)

    if (error) {
      throw new ErrorSincronizacion(`No se pudo anotar el arranque de la corrida: ${error.message}.`)
    }

    return progresoDe(await leerFila(cliente), "en-curso")
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    await soltarLock(cliente, mensaje)
    throw error
  }
}

/**
 * `true` si las dos marcas de tiempo apuntan al MISMO instante.
 *
 * Se comparan como instantes y no como cadenas porque la misma fecha llega
 * escrita de dos formas (ISO desde Postgres, ISO desde la cabecera HTTP ya
 * normalizada), y se tolera un segundo de diferencia: la cabecera HTTP no
 * lleva milisegundos y la columna de Postgres sí.
 *
 * `null` de un lado nunca es igual a una fecha del otro: sin dato no se puede
 * afirmar que el archivo es el mismo, y ante la duda se re-descarga —perder
 * unos segundos es mejor que quedarse con un catálogo viejo creyendo que está
 * al día—.
 */
function mismaFecha(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false

  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b

  return Math.abs(ta - tb) < 1_000
}

/**
 * Paso 2: procesa UNA ventana de bytes del CSV guardado.
 *
 * `token` es el `run_started_at` que devolvió la preparación. Si no coincide
 * con el de la base, otra corrida se llevó el lock mientras tanto y esta
 * tanda se rechaza sin tocar nada.
 */
export async function procesarTanda(
  usuarioId: string,
  token: string,
): Promise<ProgresoSincronizacion> {
  const cliente = clienteAdmin()
  const fila = await leerFila(cliente)

  if (fila.status !== "running" || fila.run_started_at !== token) {
    // No es un error del sistema: es "tu corrida ya no es la vigente".
    return progresoDe(fila, "ocupado")
  }

  if (fila.run_storage_path === null || fila.run_total_bytes === null) {
    await soltarLock(cliente, "La corrida no tiene un archivo preparado.")
    throw new ErrorSincronizacion(
      "La corrida no tiene un archivo preparado. Volvé a tocar Actualizar para empezar de nuevo.",
    )
  }

  try {
    const totalBytes = Number(fila.run_total_bytes)
    const offset = Number(fila.run_byte_offset)
    const restantes = totalBytes - offset

    if (restantes <= 0) {
      return await cerrarCorrida(cliente, fila)
    }

    const cantidad = Math.min(VENTANA_BYTES, restantes)
    const crudo = await descargarRangoDeObjeto(
      BUCKETS.refesSync,
      fila.run_storage_path,
      offset,
      cantidad,
    )

    // `fatal: false`: la ventana puede cortar un carácter multibyte al final
    // (el CSV está lleno de tildes). El carácter partido cae siempre en la
    // fila incompleta del final, que se descarta igual — ver `parsearVentanaCsv`.
    const texto = new TextDecoder("utf-8", { fatal: false }).decode(crudo)
    const esUltima = offset + cantidad >= totalBytes
    const ventana = parsearVentanaCsv(texto, { ultimaVentana: esUltima })

    if (ventana.filas.length === 0) {
      throw new ErrorSincronizacion(
        `La ventana de ${cantidad} bytes desde el offset ${offset} no contiene ninguna fila ` +
          "completa. El archivo no tiene el formato esperado.",
      )
    }

    let filas = ventana.filas
    // La primera ventana arranca con el encabezado: se verifica y se saltea.
    if (offset === 0) {
      verificarEncabezado(filas[0])
      filas = filas.slice(1)
    }

    const marca = new Date().toISOString()
    const centros: (CentroParaGuardar & { synced_at: string })[] = []
    for (const cruda of filas) {
      const centro = filaAcentro(cruda)
      // `synced_at` va explícito: el DEFAULT de la columna solo corre en el
      // INSERT, y la mayoría de estas filas son UPDATE. Sin esto, un centro
      // que existe desde una edición anterior conservaría su synced_at viejo
      // y la limpieza final lo borraría por creerlo dado de baja.
      if (centro) centros.push({ ...centro, synced_at: marca })
    }

    for (let i = 0; i < centros.length; i += LOTE_UPSERT) {
      const lote = centros.slice(i, i + LOTE_UPSERT)
      const { error } = await cliente
        .from("health_centers")
        .upsert(lote, { onConflict: "refes_id" })
      if (error) {
        throw new ErrorSincronizacion(`Falló la escritura de un lote de centros: ${error.message}.`)
      }
    }

    const offsetNuevo = offset + ventana.bytesConsumidos
    const { error: errorAvance } = await cliente
      .from("health_centers_sync")
      .update({
        run_byte_offset: offsetNuevo,
        run_rows_processed: fila.run_rows_processed + centros.length,
        run_heartbeat_at: new Date().toISOString(),
      })
      .eq("id", true)
      .eq("run_started_at", token)

    if (errorAvance) {
      throw new ErrorSincronizacion(`No se pudo anotar el avance de la tanda: ${errorAvance.message}.`)
    }

    const actualizada = await leerFila(cliente)

    if (Number(actualizada.run_byte_offset) >= totalBytes) {
      return await cerrarCorrida(cliente, actualizada)
    }

    return progresoDe(actualizada, "en-curso")
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    await soltarLock(cliente, mensaje)
    throw error
  }
}

/**
 * Cierre de la corrida: baja los centros que la edición nueva ya no trae,
 * cuenta el total, marca la edición como vigente, borra el CSV temporal y
 * suelta el lock.
 */
async function cerrarCorrida(cliente: ClienteAdmin, fila: FilaSync): Promise<ProgresoSincronizacion> {
  // Los que la edición nueva ya no lista: su `synced_at` quedó anterior a la
  // descarga de esta corrida. Se hace UNA sola sentencia al final y no tanda
  // por tanda, porque a mitad de camino "no lo tocó esta corrida" todavía
  // significa "no le tocó el turno", no "ya no existe".
  if (fila.run_data_since) {
    const { error } = await cliente
      .from("health_centers")
      .delete()
      .lt("synced_at", fila.run_data_since)
    if (error) {
      throw new ErrorSincronizacion(
        `No se pudieron dar de baja los centros que la edición nueva ya no trae: ${error.message}.`,
      )
    }
  }

  const { count, error: errorConteo } = await cliente
    .from("health_centers")
    .select("refes_id", { count: "exact", head: true })

  if (errorConteo) {
    throw new ErrorSincronizacion(`No se pudo contar el catálogo: ${errorConteo.message}.`)
  }

  if (fila.run_storage_path) {
    // Best-effort: si el borrado del temporal falla, la sincronización YA
    // terminó bien y no vale la pena tirarla abajo. El objeto se pisa solo en
    // la corrida siguiente (mismo path para la misma edición).
    try {
      await borrarObjeto(BUCKETS.refesSync, fila.run_storage_path)
    } catch {
      // Silencio deliberado: ver arriba.
    }
  }

  const ahora = new Date().toISOString()
  const { error } = await cliente
    .from("health_centers_sync")
    .update({
      current_resource_id: fila.run_resource_id,
      current_resource_url: fila.run_resource_url,
      current_last_modified: fila.run_last_modified,
      current_etag: fila.run_etag,
      current_row_count: count ?? 0,
      current_synced_at: ahora,
      status: "idle",
      run_error: null,
      run_storage_path: null,
    })
    .eq("id", true)

  if (error) {
    throw new ErrorSincronizacion(`No se pudo cerrar la sincronización: ${error.message}.`)
  }

  return progresoDe(await leerFila(cliente), "completo")
}
