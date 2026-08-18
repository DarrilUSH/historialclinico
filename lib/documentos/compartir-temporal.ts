/**
 * Helpers puros del Web Share Target (Sprint 11, tarea 11.2): todo lo que se
 * puede calcular sin tocar la red, para que sea testeable sin mocks de
 * Supabase. La escritura real -subir el archivo, insertar la fila, purgar-
 * vive en `lib/documentos/compartir-temporal-admin.ts` (server-only, usa
 * `service_role`) y en `app/(app)/(sin-nav)/compartir/actions.ts` (cliente
 * del usuario). Mismo reparto que `lib/documentos/sugerir-titulo.ts` vs.
 * `lib/documentos/ingesta.ts`.
 *
 * Contexto completo del flujo y de las alternativas evaluadas para el
 * almacenamiento temporal: encabezado de
 * `supabase/migrations/20260814100000_share_target_temporal.sql` y
 * `docs/share-target.md`.
 */

import { EXTENSION_POR_MIME, type MimeValidado } from "@/lib/archivos/validacion"

/**
 * Vida de un archivo en `shared_uploads_temp` antes de considerarse
 * abandonado. Igual que el `default` de `expires_at` en la migración
 * (`now() + interval '1 hour'`) y que la ventana de
 * `confirmar_documento_recien_subido` — un solo número mental para "cuánto
 * dura una subida sin confirmar" en toda la app.
 */
export const TTL_COMPARTIDO_MINUTOS = 60

/**
 * Path del objeto temporal dentro del bucket `compartidos-temp`:
 * `{user_id}/{uuid}.{ext}`. Deliberadamente MÁS CHICO que
 * `construirStoragePath` de `lib/documentos/ingesta.ts` (que además mete el
 * año): acá no hay archivo del año pasado por definición, vive como mucho
 * `TTL_COMPARTIDO_MINUTOS`.
 *
 * Primer segmento `userId`, no `perfilId`: en este punto del flujo todavía no
 * se eligió perfil (ver el encabezado de la migración, punto 3 de
 * "ALTERNATIVAS EVALUADAS").
 */
export function construirPathCompartido(
  userId: string,
  mimeType: MimeValidado,
  uuid: string = crypto.randomUUID(),
): string {
  return `${userId}/${uuid}.${EXTENSION_POR_MIME[mimeType]}`
}

/** Etiqueta corta en español para la vista previa de `/compartir`. */
export function etiquetaMime(mimeType: string): string {
  switch (mimeType) {
    case "application/pdf":
      return "PDF"
    case "image/jpeg":
      return "Foto JPG"
    case "image/png":
      return "Foto PNG"
    case "image/webp":
      return "Foto WebP"
    default:
      return "Archivo"
  }
}

/** ¿El MIME empieza a mostrarse con una miniatura (es una imagen)? */
export function esImagen(mimeType: string): boolean {
  return mimeType.startsWith("image/")
}

const PATRON_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Valida el `?archivo=` de `/compartir`: tiene que tener forma de uuid antes
 * de gastar una consulta. Mismo criterio que el `PATRON_UUID` de
 * `app/api/documentos/extraer/route.ts` y de
 * `app/(app)/(con-nav)/estudios/nuevo/procesando/page.tsx`.
 */
export function esTokenCompartidoValido(valor: string | null | undefined): valor is string {
  return typeof valor === "string" && PATRON_UUID.test(valor)
}

/** ¿Ya venció `expiresAtIso`? Recibe `ahora` para que los tests no dependan del reloj real. */
export function yaVencio(expiresAtIso: string, ahora: Date = new Date()): boolean {
  return new Date(expiresAtIso).getTime() <= ahora.getTime()
}

/**
 * Códigos de error que puede mostrar `/compartir` vía `?error=`. Se viaja por
 * código, nunca por texto libre en la URL: un mensaje en español en la query
 * string es una superficie de inyección de contenido gratuita (alguien podría
 * armar un link `/compartir?error=<texto arbitrario>`) y además no sobrevive
 * bien al encoding. `MENSAJE_ERROR_COMPARTIDO` traduce cada código a texto
 * fijo, elegido por el servidor.
 */
export const CODIGOS_ERROR_COMPARTIDO = [
  "sin_archivo",
  "archivo_invalido",
  "no_encontrado",
  "permiso_denegado",
  "duplicado",
  "inesperado",
] as const

export type CodigoErrorCompartido = (typeof CODIGOS_ERROR_COMPARTIDO)[number]

export function esCodigoErrorCompartido(valor: string): valor is CodigoErrorCompartido {
  return (CODIGOS_ERROR_COMPARTIDO as readonly string[]).includes(valor)
}

const MENSAJE_ERROR_COMPARTIDO: Record<CodigoErrorCompartido, string> = {
  sin_archivo:
    "No recibimos ningún archivo compartido. Probá compartir de nuevo desde la otra app.",
  archivo_invalido:
    "El archivo compartido no es un PDF ni una imagen válida (JPG, PNG o WebP), o pesa más de 25 MB.",
  no_encontrado:
    "No encontramos ese archivo compartido. Puede que ya haya pasado más de una hora: probá compartir de nuevo.",
  permiso_denegado:
    "Ya no tenés permiso para cargar documentos en ese perfil. Elegí otro perfil o pedí que te lo den de nuevo.",
  // Hotfix de huella digital (Sprint 17 en vivo): mensaje genérico -sin
  // título ni fecha, a diferencia del aviso de `/estudios/nuevo` y de la
  // bandeja de Gmail- porque este código viaja SOLO por `?error=`, y esta
  // pantalla nunca mete texto libre en la URL (ver el comentario de arriba).
  // Cuando el archivo temporal sigue existiendo, la pantalla complementa este
  // mensaje con "Ver ese estudio" y "Cargar igual" a partir de `?doc=`/`?perfil=`
  // -dos ids opacos, no texto-.
  duplicado: "Ya tenés un archivo idéntico cargado en el historial de ese perfil.",
  inesperado:
    "Ocurrió un problema y no pudimos recibir el archivo compartido. Probá de nuevo en unos minutos.",
}

/** Mensaje en español, listo para mostrar, para un `?error=` de `/compartir`. */
export function mensajeErrorCompartido(codigo: string): string {
  return esCodigoErrorCompartido(codigo)
    ? MENSAJE_ERROR_COMPARTIDO[codigo]
    : MENSAJE_ERROR_COMPARTIDO.inesperado
}
