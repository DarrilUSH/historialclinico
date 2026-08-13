/**
 * Validación de archivos por MIME real (magic bytes), no por extensión ni por
 * `File.type` -que el navegador arma leyendo la extensión del nombre o la
 * metadata que declaró el sistema operativo, y por lo tanto es trivial de
 * falsificar renombrando un archivo. Ver ROADMAP_SPRINTS.md, Sprint 4,
 * criterio de aceptación: "un `.exe` renombrado a `.pdf` es rechazado por
 * MIME".
 *
 * El límite de tamaño y los cuatro tipos aceptados son EXACTAMENTE los mismos
 * que `allowed_mime_types` / `file_size_limit` del bucket `documentos-medicos`
 * (`supabase/migrations/20260812230000_storage.sql`): el servidor los vuelve a
 * exigir de todas formas al subir, así que esta validación es UX -rechazar
 * temprano, en el dispositivo, sin gastar tiempo ni datos móviles en subir
 * algo que igual va a rebotar-, nunca la única barrera de seguridad.
 */

export type MimeValidado = "application/pdf" | "image/jpeg" | "image/png" | "image/webp"

export interface ResultadoValidacion {
  valido: boolean
  /** MIME real detectado por los magic bytes, o `null` si no coincide con ninguno de los cuatro soportados. */
  tipo: MimeValidado | null
  /** Mensaje en español, listo para mostrar en una `<Alerta variante="error">`. Presente solo si `valido` es `false`. */
  error?: string
}

/**
 * 25 MiB — idéntico al `file_size_limit` del bucket `documentos-medicos`
 * (26214400 bytes, ver la migración de Storage). No tiene sentido dejar pasar
 * acá un archivo que el servidor va a rechazar igual: el usuario se entera al
 * toque, no después de esperar a que termine de subir.
 */
export const LIMITE_BYTES = 25 * 1024 * 1024

const FIRMA_JPEG = [0xff, 0xd8, 0xff] as const

// Firma PNG completa de 8 bytes (no solo los 4 de "\x89PNG"): los 4 bytes
// siguientes (`\r\n\x1a\n`) además detectan corrupción por transferencia en
// modo texto (que traduce \n solo), exactamente el tipo de problema que un
// chequeo de magic bytes tiene que atrapar.
const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

const FIRMA_RIFF = [0x52, 0x49, 0x46, 0x46] as const // "RIFF"
const FIRMA_WEBP = [0x57, 0x45, 0x42, 0x50] as const // "WEBP", en el offset 8 del contenedor RIFF

const FIRMA_PDF = [0x25, 0x50, 0x44, 0x46] as const // "%PDF"

// Alcanza con leer los primeros 16 bytes: es más que suficiente para las
// cuatro firmas (WEBP, la más profunda, empieza en el offset 8 y mide 4
// bytes más).
const BYTES_DE_CABECERA = 16

function coincideEn(bytes: Uint8Array, firma: readonly number[], offset: number): boolean {
  if (bytes.length < offset + firma.length) return false
  for (let i = 0; i < firma.length; i++) {
    if (bytes[offset + i] !== firma[i]) return false
  }
  return true
}

/**
 * Lee solo la cabecera del archivo (nunca hace falta el archivo completo) y
 * la compara contra las firmas reales de cada formato soportado, siempre
 * desde el byte 0. Devuelve `null` si no coincide con ninguna -esto es lo
 * que atrapa un `.exe`, un `.html` de phishing o cualquier otra cosa
 * renombrada a `.pdf`/`.jpg`-.
 *
 * A propósito NO se tolera la firma `%PDF` corrida más allá del byte 0 -la
 * especificación ISO 32000-2 permite que un lector la busque dentro del
 * primer KiB para tolerar basura de escáneres viejos, pero abrir esa
 * ventana convierte la validación en un falso positivo fácil de gatillar:
 * un `.txt` cualquiera que simplemente MENCIONE la cadena "%PDF" en su
 * contenido (por ejemplo, esta misma documentación) pasaría la validación
 * sin ser un PDF. Se comprobó en la verificación manual de esta tarea con
 * un archivo de prueba `malicioso.pdf` cuyo texto explicativo contenía
 * "%PDF-" en una oración: exigir la firma exactamente en el byte 0 es la
 * postura correcta para una validación anti-spoofing.
 */
export async function detectarMimeReal(archivo: Blob): Promise<MimeValidado | null> {
  const cabecera = new Uint8Array(await archivo.slice(0, BYTES_DE_CABECERA).arrayBuffer())

  if (coincideEn(cabecera, FIRMA_PNG, 0)) return "image/png"
  if (coincideEn(cabecera, FIRMA_JPEG, 0)) return "image/jpeg"
  if (coincideEn(cabecera, FIRMA_RIFF, 0) && coincideEn(cabecera, FIRMA_WEBP, 8)) return "image/webp"
  if (coincideEn(cabecera, FIRMA_PDF, 0)) return "application/pdf"

  return null
}

/** Formatea bytes en es-AR con coma decimal: "8,4 MB", "512 KB". */
export function formatearBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`

  const unidades = ["KB", "MB", "GB"] as const
  let valor = bytes / 1024
  let indice = 0
  while (valor >= 1024 && indice < unidades.length - 1) {
    valor /= 1024
    indice++
  }

  const formateado = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(valor)
  return `${formateado} ${unidades[indice]}`
}

/**
 * Valida un archivo elegido por el usuario antes de comprimirlo y subirlo:
 * tamaño y MIME real. No valida nada relacionado a permisos ni a Storage
 * -eso lo hace la Server Action de la tarea siguiente del roadmap
 * ("Pipeline de subida a Storage privado con path determinístico")-.
 */
export async function validarArchivo(archivo: File): Promise<ResultadoValidacion> {
  if (archivo.size === 0) {
    return { valido: false, tipo: null, error: "El archivo está vacío." }
  }

  if (archivo.size > LIMITE_BYTES) {
    return {
      valido: false,
      tipo: null,
      error: `El archivo pesa ${formatearBytes(archivo.size)} y el límite es 25 MB. Elegí un archivo más liviano o sacá la foto de nuevo con menos calidad.`,
    }
  }

  const tipo = await detectarMimeReal(archivo)

  if (!tipo) {
    return {
      valido: false,
      tipo: null,
      error: "El archivo no es un PDF ni una imagen válida (JPEG, PNG o WebP).",
    }
  }

  return { valido: true, tipo }
}
