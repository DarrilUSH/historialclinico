import "server-only"

/**
 * Ingesta de un documento SIN sesión de nadie: la carga automática desde Gmail
 * (Sprint 17).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO SUBE A STORAGE CON LA SERVICE_ROLE_KEY. Es la primera vez
 *      en el proyecto que un archivo entra al bucket sin pasar por
 *      `objetos_insert_puede_cargar_en_perfil`, así que el porqué está abajo
 *      con todas las letras.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué NO se puede reusar `lib/documentos/ingesta.ts`
 *
 * Esa función es -y tiene que seguir siendo- el camino de las tres puertas
 * HUMANAS (subida a mano, Web Share Target, "Revisar este estudio"), y su
 * primera línea de defensa es que **sube y escribe con el cliente del
 * USUARIO**: las políticas de Storage y de `documents` vuelven a decidir en la
 * base. Acá no hay usuario. El barrido lo dispara `pg_cron` a las 3 de la
 * mañana; no hay cookie, no hay `auth.uid()`, no hay `perfil_actor()`. Pasarle
 * a esa función un cliente admin sería convertir su garantía central en
 * decoración para todos sus llamadores, no solo para este.
 *
 * Entonces el camino automático es OTRO, y paga su propia autorización:
 *
 * | | Camino humano (`ingesta.ts`) | Camino automático (este archivo) |
 * |---|---|---|
 * | Quién autoriza | RLS, con el cliente del usuario | La RPC `ingresar_documento_automatico`, con sus cuatro guardas |
 * | Qué se valida del archivo | MIME real, 25 MB | **Lo mismo, con el mismo módulo** |
 * | Path | `{perfil}/{año}/{uuid}.{ext}` | **El mismo, con la misma función** |
 * | Quién decide el perfil | La persona, con el selector | El interruptor, elegido antes por la persona |
 * | Compensación si falla | Borrar el objeto subido | **La misma** |
 *
 * Lo único que cambia es de dónde viene la autoridad. Todo lo demás se
 * reutiliza literalmente -`validarEnServidor` está duplicada acá porque en
 * `ingesta.ts` es privada, pero llama al MISMO `detectarMimeReal` y al MISMO
 * `LIMITE_BYTES`-.
 *
 * ## El orden, y por qué la subida va ANTES que la RPC
 *
 * La fila de `documents` necesita el `storage_path`, así que el objeto tiene
 * que existir primero. Si después la RPC rechaza -el interruptor se apagó entre
 * medio, el permiso se revocó, otra pasada ya cargó el mismo archivo-, el
 * objeto queda huérfano: un archivo con datos de salud en un bucket privado sin
 * ninguna fila que lo referencie, fuera del alcance del trigger de purga y por
 * lo tanto fuera del derecho de supresión (el mismo razonamiento del bloque
 * "Compensación" de `ingesta.ts`). Por eso **todo camino que no termine en
 * `creado` borra el objeto**, incluido el `duplicado` y el `ya_resuelto`.
 */

import {
  EXTENSION_POR_MIME,
  detectarMimeReal,
  LIMITE_BYTES,
} from "@/lib/archivos/validacion"
import type { MimeValidado } from "@/lib/archivos/validacion"
import { calcularHuellaSha256 } from "@/lib/documentos/huella"
import { construirStoragePath, fechaDeHoy } from "@/lib/documentos/ingesta"
import {
  ingresarDocumentoAutomatico,
  type ResultadoIngresoAutomatico,
} from "@/lib/gmail/auto-ingesta-admin"
import type { CategoriaDocumentoExtraida } from "@/lib/gemini/schemas"
import { BUCKETS, borrarObjeto, subirObjeto } from "@/lib/storage-admin"

/** Nombre estable para grepear los logs, mismo criterio que `[gmail-barrido]`. */
const PREFIJO = "[gmail-auto]"

export interface ParametrosIngestaAutomatica {
  userId: string
  /** `gmail_messages.id`. */
  correoId: string
  /** El perfil de destino del interruptor. La RPC lo vuelve a resolver por su cuenta: acá solo se usa para el path. */
  perfilId: string
  /** Los bytes del adjunto, recién bajados de Gmail. */
  bytes: Uint8Array
  /** Lo que el correo declaró. Se revalida por magic bytes igual que siempre. */
  mimeDeclarado: string
  titulo: string
  categoria: CategoriaDocumentoExtraida
  /** `YYYY-MM-DD`. */
  fecha: string
  resumen: string
  textoOcr: string
  /** Número de orden/protocolo detectado por Gemini (hotfix de duplicados semánticos), o `""` si no traía. */
  numeroOrden: string
}

/** El archivo no se pudo ingerir por sí mismo (vacío, demasiado grande, tipo no soportado). */
export class ErrorIngestaAutomatica extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = "ErrorIngestaAutomatica"
  }
}

/**
 * Revalida el archivo con el MISMO módulo isomórfico que usan las tres puertas
 * humanas. Que el correo declare `application/pdf` no alcanza: se detecta el
 * MIME REAL por magic bytes.
 */
async function validarEnServidor(bytes: Uint8Array, mimeDeclarado: string): Promise<MimeValidado> {
  if (bytes.length === 0) {
    throw new ErrorIngestaAutomatica("El archivo llegó vacío desde Gmail.")
  }
  if (bytes.length > LIMITE_BYTES) {
    throw new ErrorIngestaAutomatica("El archivo supera el límite de 25 MB.")
  }

  // `detectarMimeReal` trabaja sobre un `Blob`/`File`: se arma uno con una
  // copia limpia de los bytes, mismo criterio que `lib/gmail/adjunto.ts`.
  const archivo = new File([new Uint8Array(bytes)], "adjunto", { type: mimeDeclarado })
  const mimeReal = await detectarMimeReal(archivo)

  if (!mimeReal) {
    throw new ErrorIngestaAutomatica(
      "El archivo no es un PDF ni una imagen válida (JPEG, PNG o WebP).",
    )
  }

  return mimeReal
}

/**
 * Sube el adjunto y crea el documento automático, o no crea nada y deja el
 * bucket como estaba.
 *
 * Nunca deja un objeto huérfano: ver el encabezado. Si la compensación
 * TAMBIÉN falla, se registra con el prefijo `[gmail-auto]` -mismo criterio que
 * `[ingesta]`- y se devuelve el resultado igual: no hay tercer intento, pero
 * tampoco se pierde el rastro.
 */
export async function ingestarDocumentoAutomatico(
  parametros: ParametrosIngestaAutomatica,
): Promise<ResultadoIngresoAutomatico> {
  const mimeType = await validarEnServidor(parametros.bytes, parametros.mimeDeclarado)
  const huella = calcularHuellaSha256(parametros.bytes)

  // El mismo path determinístico de siempre: el primer segmento es el
  // `profile_id`, que es de donde `perfil_de_objeto_storage()` lo saca para
  // evaluar las políticas del bucket. Que este archivo entre con
  // `service_role` no lo exime de quedar guardado donde corresponde -si mañana
  // alguien lo lee o lo borra desde la aplicación, lo hace con RLS-.
  const storagePath = construirStoragePath(parametros.perfilId, mimeType, fechaDeHoy())

  await subirObjeto(
    BUCKETS.documentos,
    storagePath,
    new Blob([new Uint8Array(parametros.bytes)], { type: mimeType }),
    mimeType,
  )

  let resultado: ResultadoIngresoAutomatico
  try {
    resultado = await ingresarDocumentoAutomatico({
      userId: parametros.userId,
      correoId: parametros.correoId,
      storagePath,
      mimeType,
      bytes: parametros.bytes.length,
      huella,
      titulo: parametros.titulo,
      categoria: parametros.categoria,
      fecha: parametros.fecha,
      resumen: parametros.resumen,
      textoOcr: parametros.textoOcr,
      numeroOrden: parametros.numeroOrden,
    })
  } catch (error) {
    await compensar(storagePath)
    throw error
  }

  if (resultado.estado !== "creado") {
    // `duplicado` o `ya_resuelto`: la base no escribió nada, así que el objeto
    // que acabamos de subir no lo referencia nadie.
    await compensar(storagePath)
  }

  return resultado
}

async function compensar(storagePath: string): Promise<void> {
  try {
    await borrarObjeto(BUCKETS.documentos, storagePath)
  } catch (error) {
    console.error(
      `${PREFIJO} quedó un objeto huérfano en ${BUCKETS.documentos}/${storagePath}: ` +
        `la carga automática no se completó y su compensación tampoco.`,
      error instanceof Error ? error.message : error,
    )
  }
}

/** Re-exportado para que quien arma el path no tenga que importar dos módulos. */
export { EXTENSION_POR_MIME }
