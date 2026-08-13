/**
 * Compresión client-side de imágenes antes de subirlas. Los PDF NUNCA se
 * comprimen acá (`comprimirArchivo` los devuelve intactos): un PDF ya viene
 * comprimido internamente y re-comprimirlo client-side sin una librería
 * pesada -que este sprint no trae- arriesga corromperlo sin ganar casi nada.
 *
 * PRIVACIDAD (documentado porque lo pide el criterio de esta tarea): al
 * re-encodear con `<canvas>`, el archivo resultante NO lleva metadata EXIF
 * -ni el GPS de dónde se sacó la foto, ni el modelo del dispositivo-, porque
 * `canvas.toBlob()` genera un archivo de imagen nuevo a partir de los píxeles
 * ya decodificados: no copia ningún bloque de metadata del original. Esto
 * pasa en la rama que efectivamente re-encodea (`necesitaProcesar` más
 * abajo); una imagen que ya entra liviana y con lado ≤2560px se devuelve
 * intacta, EXIF incluido. En la práctica esto casi no afecta al caso que
 * motiva la regla -una foto recién sacada con la cámara del celular-, porque
 * esas fotos prácticamente siempre superan 2MB o 2560px de lado mayor y
 * terminan pasando por el re-encode de todas formas.
 *
 * ORIENTACIÓN: `createImageBitmap(archivo, { imageOrientation: "from-image" })`
 * lee el tag EXIF `Orientation` y rota/refleja los píxeles ANTES de que el
 * resto del pipeline los toque, así que el archivo resultante ya viene
 * "derecho" sin importar cómo sostenía el teléfono quien sacó la foto -al
 * mismo tiempo que se descarta el resto del EXIF, como se explica arriba-.
 */

import type { MimeValidado } from "@/lib/archivos/validacion"

export interface ResultadoCompresion {
  blob: Blob
  mimeType: string
  /** `true` si se redujeron las dimensiones (lado mayor original > 2560px). */
  redimensionada: boolean
  bytesAntes: number
  bytesDespues: number
}

/** Lado mayor máximo tras redimensionar, en píxeles. */
const LADO_MAXIMO_PX = 2560

/** Por encima de este peso se re-encodea aunque las dimensiones ya entren en el máximo. */
const UMBRAL_BYTES = 2 * 1024 * 1024

/** Calidad de re-encode, tanto para JPEG como para WebP. */
const CALIDAD = 0.82

function esImagen(tipo: MimeValidado): tipo is Exclude<MimeValidado, "application/pdf"> {
  return tipo !== "application/pdf"
}

/** WebP se re-encodea como WebP; JPEG y PNG se re-encodean como JPEG (mejor ratio de compresión con pérdida). */
function mimeDeSalida(tipoOriginal: MimeValidado): "image/jpeg" | "image/webp" {
  return tipoOriginal === "image/webp" ? "image/webp" : "image/jpeg"
}

function sinCambios(archivo: File, tipo: MimeValidado): ResultadoCompresion {
  return {
    blob: archivo,
    mimeType: tipo,
    redimensionada: false,
    bytesAntes: archivo.size,
    bytesDespues: archivo.size,
  }
}

/**
 * Comprime (si hace falta) una imagen ya validada por `validarArchivo`. Los
 * PDF se devuelven intactos. Esta función NUNCA lanza: ante cualquier
 * problema del navegador (formato no soportado por `createImageBitmap`,
 * canvas sin contexto 2D, `toBlob` que devuelve `null`, etc.) devuelve el
 * archivo original sin procesar -la carga de un documento médico nunca debe
 * bloquearse porque la compresión, que es una optimización, falló-.
 */
export async function comprimirArchivo(
  archivo: File,
  tipo: MimeValidado,
): Promise<ResultadoCompresion> {
  if (!esImagen(tipo)) {
    return sinCambios(archivo, tipo)
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(archivo, { imageOrientation: "from-image" })
  } catch {
    return sinCambios(archivo, tipo)
  }

  try {
    const ladoMayor = Math.max(bitmap.width, bitmap.height)
    const necesitaRedimension = ladoMayor > LADO_MAXIMO_PX
    const necesitaProcesar = necesitaRedimension || archivo.size > UMBRAL_BYTES

    if (!necesitaProcesar) {
      return sinCambios(archivo, tipo)
    }

    const escala = necesitaRedimension ? LADO_MAXIMO_PX / ladoMayor : 1
    const ancho = Math.max(1, Math.round(bitmap.width * escala))
    const alto = Math.max(1, Math.round(bitmap.height * escala))

    const canvas = document.createElement("canvas")
    canvas.width = ancho
    canvas.height = alto
    const contexto = canvas.getContext("2d")

    if (!contexto) {
      return sinCambios(archivo, tipo)
    }

    contexto.drawImage(bitmap, 0, 0, ancho, alto)

    const mimeSalida = mimeDeSalida(tipo)
    const blobComprimido = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mimeSalida, CALIDAD)
    })

    if (!blobComprimido || blobComprimido.size >= archivo.size) {
      // Sin resultado, o el re-encode terminó pesando igual o más que el
      // original (pasa con fotos ya muy comprimidas o con poco detalle): el
      // re-encode nunca debería poder EMPEORAR el archivo, así que nos
      // quedamos con el original tal cual.
      return sinCambios(archivo, tipo)
    }

    return {
      blob: blobComprimido,
      mimeType: mimeSalida,
      redimensionada: necesitaRedimension,
      bytesAntes: archivo.size,
      bytesDespues: blobComprimido.size,
    }
  } finally {
    bitmap.close()
  }
}
