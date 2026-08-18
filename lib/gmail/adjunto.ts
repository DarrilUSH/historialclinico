import "server-only"

/**
 * De un adjunto de Gmail a un estudio pendiente de revisión (Sprint 17, tarea
 * 17.2).
 *
 * **Este archivo es el puente, y a propósito es corto.** No reimplementa nada
 * del pipeline de ingesta: baja los bytes del adjunto, arma un `File` con
 * ellos y llama a `ingestarDocumento` (`lib/documentos/ingesta.ts`) — la MISMA
 * función que usa la subida a mano desde `/estudios/nuevo` y el Web Share
 * Target del Sprint 11. Todo lo que ese módulo garantiza vale igual acá:
 *
 * - revalidación del MIME REAL por magic bytes (un `.pdf` que en realidad es
 *   otra cosa se rechaza acá, aunque el correo lo declarara bien),
 * - tope de 25 MB,
 * - path determinístico `{profile_id}/{año}/{uuid}.{ext}` en el bucket privado,
 * - subida y `INSERT` con el cliente del USUARIO -o sea, pasando por RLS-,
 * - compensación si el `INSERT` falla después de subir el objeto.
 *
 * ## Por qué el documento se crea ACÁ y no durante el barrido
 *
 * Está argumentado en el encabezado de
 * `supabase/migrations/20260818140000_gmail_mensajes.sql`. En una línea: la
 * pantalla de revisión existente exige que quien confirma sea el CREADOR del
 * documento y que no haya pasado una hora desde que se subió
 * (`confirmar_documento_recien_subido`). Creando el documento en el momento en
 * que la persona toca "revisar", con su sesión y sobre el perfil activo, las
 * dos guardas se cumplen solas y no hubo que tocar ninguna.
 *
 * El resultado para quien usa la app: toca "Revisar" en la bandeja de Gmail y
 * aterriza en `/estudios/nuevo/procesando?doc=…`, exactamente la misma
 * pantalla que ve después de sacarle una foto a un estudio.
 *
 * ## El cotejo de huella (hotfix de producto, Sprint 17 en vivo)
 *
 * `ingestarDocumento` coteja si el adjunto ya descargado coincide, por
 * contenido, con un documento que el perfil ya tiene (`lib/documentos/
 * huella.ts`). Acá es donde ese cotejo entra en juego para el camino de
 * Gmail: los bytes YA están en manos del servidor (recién bajados de Google)
 * y todavía no se creó ningún documento ni se marcó el correo como resuelto,
 * que es exactamente el momento en el que hace falta cotejar. Si hay un
 * duplicado y no se pidió `forzar`, esta función devuelve `{ duplicado: true,
 * existente, correo }` **sin ingerir nada y sin tocar el estado del
 * correo** -sigue `pendiente_revision`, tal como estaba-, para que la persona
 * pueda decidir "Ver ese estudio" o "Cargar igual" (que vuelve a llamar acá
 * con `forzar: true`, bajando el mismo adjunto de nuevo: es una llamada HTTP
 * más a Gmail, no un costo que valga la pena evitar guardando el archivo en
 * memoria entre requests).
 */

import { ingestarDocumento, type DocumentoIngestado } from "@/lib/documentos/ingesta"
import type { DuplicadoDetectado } from "@/lib/documentos/huella"
import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import { obtenerAccessTokenGmail } from "@/lib/gmail/conexiones-admin"
import { descargarAdjunto, type OpcionesBases } from "@/lib/gmail/google-api"
import { nombreSeguroDeAdjunto } from "@/lib/gmail/mensaje"
import {
  marcarMensajeResuelto,
  obtenerMensajeRegistrado,
  type MensajeRegistrado,
} from "@/lib/gmail/mensajes-admin"

export type CodigoErrorAdjunto =
  /** El correo no está en el registro de esta cuenta (o nunca estuvo). */
  | "correo_no_encontrado"
  /** Ese adjunto no existe en ese correo, o no es de un tipo que se pueda importar. */
  | "adjunto_no_disponible"
  /** Gmail no entregó el archivo. */
  | "descarga_fallida"

export class ErrorAdjuntoGmail extends Error {
  readonly codigo: CodigoErrorAdjunto

  constructor(codigo: CodigoErrorAdjunto, mensaje: string) {
    super(mensaje)
    this.name = "ErrorAdjuntoGmail"
    this.codigo = codigo
  }
}

export interface DependenciasAdjunto {
  obtenerAccessToken: (userId: string) => Promise<string>
  obtenerCorreo: (userId: string, mensajeId: string) => Promise<MensajeRegistrado | null>
  marcarResuelto: typeof marcarMensajeResuelto
}

const DEPENDENCIAS_REALES: DependenciasAdjunto = {
  obtenerAccessToken: (userId) => obtenerAccessTokenGmail(userId),
  obtenerCorreo: obtenerMensajeRegistrado,
  marcarResuelto: marcarMensajeResuelto,
}

export interface ParametrosIngestaAdjunto {
  /** Cliente del USUARIO. No se acepta el admin: las dos escrituras tienen que pasar por RLS. */
  supabase: ClienteSupabaseServidor
  /** La cuenta en sesión. Quien llama ya la verificó con `requerirSesion`. */
  userId: string
  /** El perfil ACTIVO. Quien llama ya verificó `requerirPermiso(perfilId, "upload")`. */
  perfilId: string
  /** `gmail_messages.id` — la fila del registro, no el id de Gmail. */
  correoId: string
  /** `attachmentId` del adjunto elegido dentro de ese correo. */
  adjuntoId: string
  /**
   * `true` para saltear el cotejo de huella y crear el documento igual -lo
   * pide "Cargar igual" después de que la persona ya vio el aviso de
   * duplicado-. Default `false`.
   */
  forzar?: boolean
  bases?: OpcionesBases
  dependencias?: Partial<DependenciasAdjunto>
}

/** Lo que devuelve `ingerirAdjuntoDeGmail`: se ingirió, o se encontró un duplicado y no se tocó nada. */
export type ResultadoIngestaAdjunto =
  | { duplicado: false; documento: DocumentoIngestado; correo: MensajeRegistrado }
  | { duplicado: true; existente: DuplicadoDetectado; correo: MensajeRegistrado }

/**
 * Baja el adjunto y lo mete en el historial como documento PENDIENTE DE
 * CONFIRMAR. Devuelve el documento creado; quien llama redirige a la pantalla
 * de revisión.
 *
 * Si algo falla DESPUÉS de la ingesta -marcar el correo como resuelto-, el
 * documento ya existe y se devuelve igual: es preferible un correo que sigue
 * figurando como pendiente (la persona lo descarta de un toque) que un
 * documento subido que nadie sabe que existe.
 *
 * Si `ingestarDocumento` encuentra un duplicado y no se pidió `forzar`,
 * devuelve `{ duplicado: true, existente, correo }` SIN marcar el correo como
 * resuelto: sigue pendiente hasta que la persona elija "Ver ese estudio" o
 * "Cargar igual" (ver el encabezado del archivo).
 */
export async function ingerirAdjuntoDeGmail(
  parametros: ParametrosIngestaAdjunto,
): Promise<ResultadoIngestaAdjunto> {
  const deps: DependenciasAdjunto = { ...DEPENDENCIAS_REALES, ...parametros.dependencias }

  const correo = await deps.obtenerCorreo(parametros.userId, parametros.correoId)
  if (!correo) {
    throw new ErrorAdjuntoGmail(
      "correo_no_encontrado",
      "No encontramos ese correo. Puede que ya lo hayas revisado desde otro dispositivo.",
    )
  }

  const adjunto = correo.adjuntos.find((candidato) => candidato.attachmentId === parametros.adjuntoId)
  if (!adjunto || !adjunto.apto || !adjunto.mimeType) {
    throw new ErrorAdjuntoGmail(
      "adjunto_no_disponible",
      "Ese archivo no se puede importar. Podés abrirlo desde tu Gmail y subirlo a mano.",
    )
  }

  const accessToken = await deps.obtenerAccessToken(parametros.userId)

  const bytes = await descargarAdjunto(
    accessToken,
    { mensajeId: correo.gmailMessageId, adjuntoId: adjunto.attachmentId },
    parametros.bases,
  )

  if (bytes.length === 0) {
    throw new ErrorAdjuntoGmail(
      "descarga_fallida",
      "El archivo llegó vacío desde Gmail. Probá de nuevo en un rato.",
    )
  }

  // `new Uint8Array(bytes)` y no el `Buffer` directo: `File`/`Blob` aceptan las
  // dos formas, pero una copia limpia evita cualquier vista compartida sobre el
  // pool interno de Buffer de Node.
  const archivo = new File(
    [new Uint8Array(bytes)],
    nombreSeguroDeAdjunto(adjunto.filename, adjunto.mimeType),
    { type: adjunto.mimeType },
  )

  const resultado = await ingestarDocumento(parametros.supabase, parametros.perfilId, archivo, {
    forzar: parametros.forzar,
  })

  if (resultado.duplicado) {
    // Sin tocar el correo: sigue `pendiente_revision`, tal como estaba antes
    // de esta llamada. La persona decide desde la bandeja.
    return { duplicado: true, existente: resultado.existente, correo }
  }

  const documento = resultado.documento

  try {
    await deps.marcarResuelto(parametros.userId, correo.id, {
      estado: "ingresado",
      documentId: documento.documentoId,
    })
  } catch (error) {
    console.error(
      `[gmail] el adjunto de ${correo.id} se ingirió como ${documento.documentoId} pero el correo quedó sin marcar:`,
      error instanceof Error ? error.message : error,
    )
  }

  return { duplicado: false, documento, correo }
}
