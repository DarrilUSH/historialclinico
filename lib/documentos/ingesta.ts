import "server-only"

/**
 * Ingesta de un documento médico: el camino único por el que un archivo entra
 * al producto.
 *
 * Este módulo es el NÚCLEO REUTILIZABLE que pide el roadmap (Sprint 4,
 * "Pipeline de subida a Storage privado con path determinístico"): hoy lo
 * llama la Server Action `subirDocumento`
 * (`app/(app)/(con-nav)/estudios/actions.ts`) y en el Sprint 11 lo va a llamar
 * el Web Share Target -que recibe archivos compartidos desde la galería o
 * desde WhatsApp exactamente igual, como un `File` dentro de un `FormData`-.
 * Por eso la función no sabe nada de rutas, ni de `redirect()`, ni de
 * formularios: recibe el perfil, el cliente del usuario y el archivo, y
 * devuelve el documento creado o lanza `ErrorIngesta`.
 *
 * ## El orden de las cuatro operaciones no es negociable
 *
 * 1. **Permiso** (`requerirPermiso(perfilId, "upload")`) — lo hace QUIEN LLAMA,
 *    antes de invocar a `ingestarDocumento`, y este módulo lo asume hecho.
 *    Igual no es la única barrera: los pasos 3 y 4 van con el cliente del
 *    usuario, así que las políticas de `storage.objects` y de `documents`
 *    vuelven a decidir en la base (docs/seguridad-rls.md §7.3).
 * 2. **Validación server-side del archivo, de nuevo.** El cargador ya validó
 *    en el navegador (`components/documentos/cargador-documento.tsx`), y eso
 *    es UX, no seguridad: un POST a la Server Action puede llegar con
 *    cualquier cosa adentro. Se revalidan tamaño y MIME real por magic bytes
 *    con el MISMO módulo isomórfico que usa el cliente
 *    (`lib/archivos/validacion.ts`), para que las dos puntas no puedan opinar
 *    distinto.
 * 3. **Subida al bucket con el cliente del USUARIO** -jamás con
 *    `service_role`-. La política `objetos_insert_puede_cargar_en_perfil`
 *    deriva el perfil del primer segmento del path y exige
 *    `puede_cargar_en_perfil`. Subir con el cliente admin saltearía RLS y
 *    convertiría la política de Storage en decoración.
 * 4. **`INSERT` en `documents`, también con el cliente del usuario**
 *    (`documents_insert_puede_cargar`). `created_by_profile_id` NO se manda:
 *    lo sella el trigger `documents_sellar_created_by_profile_id`
 *    (`20260812220000_rls.sql`), que además lo vuelve inmutable.
 *
 * ## Compensación: por qué el paso 4 puede borrar lo que subió el paso 3
 *
 * Los pasos 3 y 4 son dos servicios distintos (Storage y Postgres) y no hay
 * transacción que los abarque. Si el `INSERT` falla después de que el objeto
 * ya está en el bucket, queda un **huérfano**: un archivo con datos de salud
 * dentro de un bucket privado, sin ninguna fila que lo referencie. Eso es
 * grave por dos motivos acumulativos:
 *
 * - Nadie lo puede borrar desde la app -el borrado se ofrece desde el
 *   documento, y el documento no existe-, así que vive para siempre.
 * - El trigger `documents_encolar_purga_storage` encola en
 *   `storage_purge_queue` a partir del **DELETE de la fila**. Sin fila no hay
 *   DELETE, y sin DELETE no hay encolado: el huérfano queda **fuera de la red
 *   de seguridad de la purga** y por lo tanto fuera del derecho de supresión
 *   de la Ley 25.326 (art. 16).
 *
 * Por eso, ante un `INSERT` fallido, se borra el objeto recién subido. **La
 * compensación usa `borrarObjeto()` de `lib/storage-admin.ts`
 * (`service_role`) y no el cliente del usuario**, y eso es deliberado: borrar
 * en Storage exige `can_manage` (política `objetos_delete_administrador`),
 * mientras que subir exige `can_upload`. Una cuidadora con `can_upload` y sin
 * `can_manage` -el caso típico- no podría limpiar su propia subida fallida, y
 * el huérfano quedaría igual. El uso de `service_role` acá cumple la regla del
 * encabezado de `storage-admin.ts` ("quien llama es responsable de haber
 * verificado el permiso antes"): el permiso se verificó en el paso 1, el
 * objeto lo acabamos de crear nosotros mismos en esta misma request, y el path
 * lo generamos nosotros -no viene del cliente-, así que no hay ninguna
 * decisión de autorización delegada al usuario.
 *
 * Si además falla la compensación, se registra con el prefijo estable
 * `[ingesta]` (mismo criterio que `[auditoria]`) y se le devuelve igual el
 * error al usuario. No hay tercer intento: el huérfano queda anotado en el log
 * del servidor para la observabilidad del Sprint 10.
 *
 * ## Auditoría: deuda declarada
 *
 * El enum `public.access_action` NO tiene un literal para "subió un
 * documento": sus nueve valores son `login`, `logout`, `ver_perfil`,
 * `ver_documento`, `descargar_archivo`, `ver_credencial`, `exportar_ficha`,
 * `otorgar_permiso` y `revocar_permiso` (ver `lib/auditoria.ts`). Registrar
 * esta subida como `ver_documento` sería mentirle a la auditoría, que es
 * justamente la evidencia con la que el titular controla quién toca sus datos,
 * así que **no se registra ninguna fila en `access_logs`** y queda como deuda:
 * agregar `subir_documento` al enum en una migración del sprint que toque el
 * modelo. Mientras tanto la carga NO queda sin rastro: la propia fila de
 * `documents` guarda `created_by_profile_id` (sellado por trigger) y
 * `created_at`, que responden "quién subió esto y cuándo".
 *
 * ## EL COTEJO, PASO A PASO (hotfix de producto, Sprint 17 en vivo)
 *
 * Motivado por un caso real: dos correos DISTINTOS con el mismo PDF adjunto
 * (un reenvío "RV:" sobre el original) llegaron a la bandeja de Gmail, y nada
 * avisó que el estudio ya estaba. El dedup por `gmail_message_id` funcionaba
 * bien -eran mensajes distintos de verdad-, pero nada comparaba el ARCHIVO.
 *
 * Este es el único lugar del código que hace falta tocar para tapar el hueco
 * en las TRES puertas de entrada (subida manual, Web Share Target, adjunto de
 * Gmail): las tres llaman a esta función con el archivo YA EN MANOS DEL
 * SERVIDOR y NINGÚN documento creado todavía, que es exactamente el momento en
 * que el cotejo tiene que correr.
 *
 * 1. Se valida el archivo (como siempre) y se calculan sus bytes UNA vez
 *    (`archivo.arrayBuffer()`; un `File`/`Blob` se puede leer más de una vez,
 *    así que subir después con el `File` original no vuelve a copiar nada).
 * 2. Se calcula la huella SHA-256 (`lib/documentos/huella.ts`).
 * 3. Si NO se pidió `forzar`: se backfillea perezosamente el perfil
 *    (`lib/documentos/huella-admin.ts`, best-effort, acotado) y se cotejan
 *    los documentos del perfil por huella. Si hay uno con la misma huella,
 *    la función devuelve `{ duplicado: true, existente }` **sin subir nada a
 *    Storage y sin tocar `documents`**: quien llama le muestra a la persona
 *    "Este archivo es idéntico a «título» cargado el fecha" con dos acciones,
 *    "Ver ese estudio" y "Cargar igual" -esta última vuelve a llamar acá con
 *    `forzar: true`-.
 * 4. Si se pidió `forzar`, o no hubo coincidencia: se sigue el camino de
 *    siempre (subida + INSERT), y la fila nueva se guarda CON su huella —así
 *    la próxima carga que coincida con ESTA la va a encontrar, se haya forzado
 *    o no-.
 *
 * El cotejo es una ayuda, nunca un candado: `content_sha256` no es UNIQUE
 * (`20260818150000_huella_documentos.sql`), y detecta archivos byte a byte
 * IDÉNTICOS -un PDF que la clínica regenera con el mismo contenido pero bytes
 * distintos no matchea; límite declarado en `docs/gmail-ingesta.md`-.
 */

import {
  EXTENSION_POR_MIME,
  detectarMimeReal,
  formatearBytes,
  LIMITE_BYTES,
} from "@/lib/archivos/validacion"
import type { MimeValidado } from "@/lib/archivos/validacion"
import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import { backfillHuellasFaltantes } from "@/lib/documentos/huella-admin"
import { buscarDuplicadoPorHuella, calcularHuellaSha256 } from "@/lib/documentos/huella"
import type { DuplicadoDetectado } from "@/lib/documentos/huella"
import { BUCKETS, borrarObjeto } from "@/lib/storage-admin"

export type { DuplicadoDetectado } from "@/lib/documentos/huella"
export { formatearFechaDuplicado } from "@/lib/documentos/huella"

/** Tope del título provisional. `documents.title` es `text` sin límite, pero un nombre de archivo absurdo no tiene por qué llegar entero a la interfaz. */
const MAX_TITULO = 120

/** Título de reserva cuando el nombre del archivo no aporta nada usable ("", ".pdf", "   "). */
const TITULO_POR_DEFECTO = "Documento sin nombre"

/**
 * Hora de pared de Ushuaia, igual que en `familia/accesos`. El servidor puede
 * estar en cualquier zona horaria: sin fijarla, un documento subido a las 22 h
 * de Ushuaia se guardaría con la fecha del día siguiente (UTC) y hasta podría
 * caer en la carpeta del año siguiente un 31 de diciembre.
 */
const FORMATO_FECHA_ISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Ushuaia",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export type CodigoErrorIngesta =
  | "archivo_ausente"
  | "archivo_invalido"
  | "subida_fallida"
  | "registro_fallido"

/** Error de ingesta. Todos traen un mensaje en español, mostrable tal cual. */
export class ErrorIngesta extends Error {
  readonly codigo: CodigoErrorIngesta

  constructor(codigo: CodigoErrorIngesta, mensaje: string) {
    super(mensaje)
    this.name = "ErrorIngesta"
    this.codigo = codigo
  }
}

export interface DocumentoIngestado {
  documentoId: string
  storagePath: string
  mimeType: MimeValidado
  bytes: number
  /** Fecha (`YYYY-MM-DD`) con la que quedó el documento. Provisional: la extracción con IA la corrige. */
  fecha: string
}

/**
 * Lo que devuelve `ingestarDocumento`: o se creó el documento, o se encontró
 * uno idéntico y NO se creó nada (ver "EL COTEJO, PASO A PASO" arriba).
 */
export type ResultadoIngesta =
  | { duplicado: false; documento: DocumentoIngestado }
  | { duplicado: true; existente: DuplicadoDetectado }

export interface OpcionesIngesta {
  /**
   * `true` para saltear el cotejo de huella y crear el documento igual -es lo
   * que dispara "Cargar igual" después de que la persona ya vio el aviso de
   * duplicado-. `false`/ausente: se cotejan documentos del mismo perfil por
   * huella antes de crear nada.
   */
  forzar?: boolean
}

/** Fecha de hoy en `YYYY-MM-DD`, hora de pared de Ushuaia. */
export function fechaDeHoy(ahora: Date = new Date()): string {
  return FORMATO_FECHA_ISO.format(ahora)
}

/**
 * Path determinístico del objeto: `{profile_id}/{anio}/{uuid}.{ext}`.
 *
 * El primer segmento es el `profile_id` porque de ahí lo saca
 * `public.perfil_de_objeto_storage()` para evaluar las políticas del bucket
 * (docs/seguridad-rls.md §7.2): el path no es una ruta cualquiera, es **el
 * puente entre el archivo y la matriz de permisos**.
 *
 * El nombre del archivo NO participa: es un uuid generado en el servidor. Un
 * nombre elegido por el cliente traería path traversal (`../`), colisiones,
 * caracteres que Storage rechaza y, sobre todo, información de salud en el
 * propio path ("biopsia-mama-2026.pdf" es un dato sensible legible en
 * cualquier log). El vínculo con el nombre original queda en `documents.title`,
 * que sí está protegido por RLS.
 */
export function construirStoragePath(
  perfilId: string,
  mimeType: MimeValidado,
  fechaIso: string,
  uuid: string = crypto.randomUUID(),
): string {
  const anio = fechaIso.slice(0, 4)
  return `${perfilId}/${anio}/${uuid}.${EXTENSION_POR_MIME[mimeType]}`
}

/**
 * Título provisional: el nombre del archivo sin la extensión. Es lo que la
 * persona reconoce en la lista mientras la extracción de la tarea siguiente
 * (Gemini) no le puso un título real. Nunca vacío: el CHECK
 * `documents_title_no_vacio` rechaza un título en blanco.
 */
export function tituloDesdeNombre(nombre: string): string {
  const base = nombre
    .replace(/\.[^./\\]+$/, "")
    .replace(/\s+/g, " ")
    .trim()

  return base.length === 0 ? TITULO_POR_DEFECTO : base.slice(0, MAX_TITULO)
}

/**
 * Valida el archivo **en el servidor**, sin confiar en nada de lo que dijo el
 * cliente: ni el `type` del `File` (lo arma el navegador con la extensión), ni
 * el tamaño declarado, ni que el cargador haya corrido siquiera.
 */
async function validarEnServidor(archivo: File): Promise<MimeValidado> {
  if (archivo.size === 0) {
    throw new ErrorIngesta("archivo_invalido", "El archivo está vacío.")
  }

  if (archivo.size > LIMITE_BYTES) {
    throw new ErrorIngesta(
      "archivo_invalido",
      `El archivo pesa ${formatearBytes(archivo.size)} y el límite es ${formatearBytes(LIMITE_BYTES)}.`,
    )
  }

  const mimeReal = await detectarMimeReal(archivo)

  if (!mimeReal) {
    throw new ErrorIngesta(
      "archivo_invalido",
      "El archivo no es un PDF ni una imagen válida (JPEG, PNG o WebP).",
    )
  }

  return mimeReal
}

/**
 * Sube el archivo al bucket privado y registra el documento — o, si ya hay
 * uno idéntico en el perfil y no se pidió `forzar`, no crea nada y avisa
 * (ver "EL COTEJO, PASO A PASO" en el encabezado del archivo).
 *
 * @param supabase Cliente del USUARIO (el de `lib/supabase/server.ts`). No
 *   acepta el cliente admin a propósito: las dos escrituras tienen que pasar
 *   por RLS.
 * @param perfilId Perfil titular de los datos. Quien llama ya verificó
 *   `requerirPermiso(perfilId, "upload")`.
 * @param archivo Archivo tal como llegó en el `FormData`.
 * @param opciones `{ forzar }` — ver `OpcionesIngesta`.
 */
export async function ingestarDocumento(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
  archivo: File,
  opciones: OpcionesIngesta = {},
): Promise<ResultadoIngesta> {
  const mimeType = await validarEnServidor(archivo)

  // Una sola lectura de los bytes: `File`/`Blob` son inmutables y releíbles,
  // así que `.upload(archivo, …)` más abajo no vuelve a copiar nada -sigue
  // pasándole el `File` original, que Storage puede transmitir en streaming-.
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  const huella = calcularHuellaSha256(bytes)

  if (!opciones.forzar) {
    // Mejor-esfuerzo: si el backfill falla, el cotejo de abajo simplemente no
    // ve los documentos viejos de este perfil. Nunca bloquea la carga.
    await backfillHuellasFaltantes(perfilId).catch((error) => {
      console.error(`[ingesta] Backfill de huellas de ${perfilId} no se pudo completar:`, error)
    })

    const existente = await buscarDuplicadoPorHuella(supabase, perfilId, huella)
    if (existente) {
      return { duplicado: true, existente }
    }
  }

  const fecha = fechaDeHoy()
  const storagePath = construirStoragePath(perfilId, mimeType, fecha)

  const { error: errorSubida } = await supabase.storage
    .from(BUCKETS.documentos)
    .upload(storagePath, archivo, {
      contentType: mimeType,
      // El path lleva un uuid recién generado, así que no puede existir. Si
      // existiera, sobrescribir sería destruir el archivo de otro documento:
      // que falle.
      upsert: false,
    })

  if (errorSubida) {
    throw new ErrorIngesta(
      "subida_fallida",
      "No pudimos guardar el archivo. Revisá tu conexión y probá de nuevo.",
    )
  }

  const { data: documento, error: errorInsert } = await supabase
    .from("documents")
    .insert({
      profile_id: perfilId,
      // Provisionales los tres: la extracción con Gemini (tarea siguiente del
      // Sprint 4) los reemplaza por lo que diga el documento.
      title: tituloDesdeNombre(archivo.name),
      category: "other",
      document_date: fecha,
      storage_path: storagePath,
      mime_type: mimeType,
      file_size_bytes: archivo.size,
      // Se guarda SIEMPRE, se haya cotejado o forzado: es lo que permite que
      // una carga futura -de este archivo o de un tercero- encuentre a ESTA.
      content_sha256: huella,
      // `created_by_profile_id` va sellado por el trigger, no se manda.
    })
    .select("id")
    .single()

  if (errorInsert || !documento) {
    // Compensación: ver el bloque "Compensación" del encabezado.
    try {
      await borrarObjeto(BUCKETS.documentos, storagePath)
    } catch (errorBorrado) {
      console.error(
        `[ingesta] Quedó un objeto huérfano en ${BUCKETS.documentos}/${storagePath}: ` +
          `falló el INSERT en documents y también su compensación.`,
        errorBorrado,
      )
    }

    throw new ErrorIngesta(
      "registro_fallido",
      "Guardamos el archivo pero no pudimos registrar el estudio, así que lo deshicimos. Probá de nuevo.",
    )
  }

  return {
    duplicado: false,
    documento: {
      documentoId: documento.id,
      storagePath,
      mimeType,
      bytes: archivo.size,
      fecha,
    },
  }
}
