import "server-only"

/**
 * Puente con el portal de datos abiertos del Ministerio de Salud de la Nación
 * (Sprint 16, tarea 16.3): descubre cuál es la edición más nueva del REFES y
 * descarga su CSV.
 *
 * ── POR QUÉ `node:https` Y NO `fetch`
 *
 * `fetch` global de Node no acepta configurar el almacén de certificados por
 * request: hay que pasarle un `dispatcher` de `undici`, que no es una
 * dependencia de este proyecto y no vale la pena sumar para una sola llamada.
 * `node:https` es núcleo, acepta `ca` directo y además entrega la respuesta
 * como stream, que es lo que hace falta para bajar 9 MB sin cargarlos dos
 * veces en memoria. Ver `lib/lugares/ca-ministerio.ts` para el porqué del
 * almacén extendido -y para el porqué de NO apagar la verificación-.
 *
 * ── EL PORTAL Y SU API
 *
 * `datos.salud.gob.ar` corre CKAN, así que la lista de recursos del dataset
 * se pide con `GET /api/3/action/package_show?id=<slug>` (31 KB, ~120 ms
 * medidos). De ahí sale la URL del CSV vigente, sin scrapear HTML.
 *
 * ⚠️ El dataset publica varios formatos y NO siempre el más nuevo está en
 * CSV: al 2026-08-18 el recurso más reciente es un XLSX de enero de 2026 y el
 * CSV más nuevo es el de diciembre de 2025. Esta función devuelve el CSV más
 * nuevo, a propósito: leer XLSX exigiría una librería de parseo de Office
 * (dependencia nueva, decenas de KB en el bundle de una función serverless)
 * para un formato que la fuente publica de forma intermitente. Queda
 * declarado como deuda, no como olvido.
 */

import https from "node:https"
import tls from "node:tls"

import { CERTIFICADO_INTERMEDIO_MINISTERIO } from "@/lib/lugares/ca-ministerio"

/** Único host al que se le aplica el almacén de confianza extendido. */
export const HOST_MINISTERIO = "datos.salud.gob.ar"

/**
 * Slug del dataset REFES en el portal. Estable desde 2018 (las ediciones
 * nuevas se suman como RECURSOS de este mismo dataset, no como datasets
 * nuevos), y por eso se puede fijar acá en vez de buscarlo cada vez.
 */
export const DATASET_REFES = "listado-establecimientos-de-salud-asentados-en-el-registro-federal-refes"

/** Tope de bytes que se acepta descargar. Espeja el `file_size_limit` del bucket `refes-sync`. */
export const TOPE_BYTES_CSV = 12_582_912

/** Almacén de confianza: las raíces que Node ya trae MÁS el intermedio que el portal no manda. */
const AUTORIDADES = [...tls.rootCertificates, CERTIFICADO_INTERMEDIO_MINISTERIO]

export class ErrorPortalMinisterio extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = "ErrorPortalMinisterio"
  }
}

/** Una edición del REFES publicada como CSV. */
export interface EdicionRefes {
  /** `id` del recurso en CKAN: la identidad estable de esta edición. */
  resourceId: string
  resourceUrl: string
  /** Nombre del recurso tal como lo publica el portal. */
  nombre: string
  /** Fecha que el portal reporta como última modificación del recurso, en ISO. */
  lastModified: string | null
  /** Tamaño declarado por el portal, o `null` si no lo declara. */
  bytes: number | null
}

interface RespuestaHttp {
  status: number
  headers: Record<string, string | string[] | undefined>
  cuerpo: Buffer
}

/**
 * Traduce un fallo de red o de TLS a un mensaje que la persona pueda leer.
 * El caso del certificado se nombra explícitamente porque es el único que
 * exige una acción de mantenimiento concreta (ver `ca-ministerio.ts`).
 */
function traducirErrorDeRed(error: unknown): ErrorPortalMinisterio {
  const codigo =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : ""

  if (codigo.includes("CERT") || codigo.includes("VERIFY") || codigo.includes("SELF_SIGNED")) {
    return new ErrorPortalMinisterio(
      "El certificado del portal del Ministerio cambió y ya no se puede verificar " +
        `(${codigo}). Hay que actualizar lib/lugares/ca-ministerio.ts con el certificado ` +
        "intermedio nuevo antes de volver a sincronizar.",
    )
  }

  const mensaje = error instanceof Error ? error.message : String(error)
  return new ErrorPortalMinisterio(
    `No se pudo contactar al portal del Ministerio de Salud (${codigo || "red"}): ${mensaje}`,
  )
}

/** Pedido contra el portal, con el almacén de confianza extendido y tope de bytes. */
function pedirAlMinisterio(
  urlCruda: string,
  opciones: { topeBytes?: number; saltosRestantes?: number; metodo?: "GET" | "HEAD" } = {},
): Promise<RespuestaHttp> {
  const { topeBytes = TOPE_BYTES_CSV, saltosRestantes = 3, metodo = "GET" } = opciones

  let url: URL
  try {
    url = new URL(urlCruda)
  } catch {
    return Promise.reject(new ErrorPortalMinisterio(`URL inválida del portal: "${urlCruda}".`))
  }

  // El almacén extendido se aplica SOLO a este host, y solo se acepta https:
  // una redirección a otro dominio -o a http- se rechaza en vez de seguirse.
  if (url.protocol !== "https:" || url.hostname !== HOST_MINISTERIO) {
    return Promise.reject(
      new ErrorPortalMinisterio(
        `Solo se descarga desde https://${HOST_MINISTERIO} y esta URL apunta a "${url.protocol}//${url.hostname}".`,
      ),
    )
  }

  return new Promise<RespuestaHttp>((resolver, rechazar) => {
    const request = https.request(
      {
        host: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: metodo,
        servername: url.hostname,
        ca: AUTORIDADES,
        headers: { "User-Agent": "HistorialMedico/1.0 (sincronizacion REFES)" },
      },
      (respuesta) => {
        const estado = respuesta.statusCode ?? 0

        if (estado >= 300 && estado < 400 && respuesta.headers.location) {
          respuesta.resume()
          if (saltosRestantes <= 0) {
            rechazar(new ErrorPortalMinisterio("El portal encadenó demasiadas redirecciones."))
            return
          }
          const destino = new URL(respuesta.headers.location, url).toString()
          resolver(
            pedirAlMinisterio(destino, {
              topeBytes,
              metodo,
              saltosRestantes: saltosRestantes - 1,
            }),
          )
          return
        }

        const trozos: Buffer[] = []
        let recibidos = 0

        respuesta.on("data", (trozo: Buffer) => {
          recibidos += trozo.length
          if (recibidos > topeBytes) {
            respuesta.destroy()
            rechazar(
              new ErrorPortalMinisterio(
                `La descarga superó el tope de ${topeBytes} bytes. El archivo del portal creció ` +
                  "más de lo previsto (o la URL dejó de apuntar al CSV): revisar antes de subir el tope.",
              ),
            )
            return
          }
          trozos.push(trozo)
        })

        respuesta.on("end", () =>
          resolver({ status: estado, headers: respuesta.headers, cuerpo: Buffer.concat(trozos) }),
        )
        respuesta.on("error", (error) => rechazar(traducirErrorDeRed(error)))
      },
    )

    request.on("error", (error) => rechazar(traducirErrorDeRed(error)))
    // El portal es un servidor público sin garantías de disponibilidad: sin
    // este tope, una función serverless se quedaría colgada hasta que la
    // plataforma la mate, sin dejar ni un mensaje.
    request.setTimeout(20_000, () => {
      request.destroy(new Error("El portal del Ministerio no respondió en 20 segundos."))
    })
    request.end()
  })
}

interface RecursoCkan {
  id?: unknown
  url?: unknown
  name?: unknown
  format?: unknown
  size?: unknown
  last_modified?: unknown
  created?: unknown
}

function textoDe(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim().length > 0 ? valor.trim() : null
}

/**
 * Pregunta al portal cuál es la edición CSV más nueva del REFES.
 *
 * Ordena por `last_modified` (y `created` como respaldo, porque el recurso
 * más viejo del dataset no trae `last_modified`), no por la posición en el
 * arreglo: el orden de `resources` en CKAN es de carga, no cronológico.
 */
export async function descubrirEdicionMasNueva(): Promise<EdicionRefes> {
  const respuesta = await pedirAlMinisterio(
    `https://${HOST_MINISTERIO}/api/3/action/package_show?id=${encodeURIComponent(DATASET_REFES)}`,
    { topeBytes: 4_194_304 },
  )

  if (respuesta.status !== 200) {
    throw new ErrorPortalMinisterio(
      `El portal respondió ${respuesta.status} al consultar el catálogo de ediciones del REFES.`,
    )
  }

  let cuerpo: { result?: { resources?: RecursoCkan[] } }
  try {
    cuerpo = JSON.parse(respuesta.cuerpo.toString("utf8"))
  } catch {
    throw new ErrorPortalMinisterio("El portal devolvió una respuesta que no es JSON válido.")
  }

  const candidatos = (cuerpo.result?.resources ?? [])
    .map((recurso) => {
      const url = textoDe(recurso.url)
      const id = textoDe(recurso.id)
      const formato = (textoDe(recurso.format) ?? "").toUpperCase()
      if (!url || !id || formato !== "CSV") return null

      const fecha = textoDe(recurso.last_modified) ?? textoDe(recurso.created)
      return {
        resourceId: id,
        resourceUrl: url,
        nombre: textoDe(recurso.name) ?? "Edición del REFES",
        lastModified: fecha,
        bytes: typeof recurso.size === "number" && Number.isFinite(recurso.size) ? recurso.size : null,
        orden: fecha ? Date.parse(fecha) : 0,
      }
    })
    .filter((candidato): candidato is NonNullable<typeof candidato> => candidato !== null)

  if (candidatos.length === 0) {
    throw new ErrorPortalMinisterio(
      "El dataset del REFES no publica ninguna edición en CSV. La app solo lee CSV " +
        "(ver el encabezado de lib/lugares/descarga.ts).",
    )
  }

  candidatos.sort((a, b) => b.orden - a.orden)
  const elegido = candidatos[0]

  return {
    resourceId: elegido.resourceId,
    resourceUrl: elegido.resourceUrl,
    nombre: elegido.nombre,
    lastModified: elegido.lastModified,
    bytes: elegido.bytes,
  }
}

export interface CsvDescargado {
  contenido: Buffer
  /** `Last-Modified` que reporta el servidor, en ISO, o `null`. */
  lastModified: string | null
  etag: string | null
}

/** Identidad de la versión del archivo, sin bajarlo. */
export interface HuellaCsv {
  lastModified: string | null
  etag: string | null
}

/**
 * Pide solo las CABECERAS del CSV (HTTP HEAD) para saber si el archivo cambió
 * **sin descargar los 9 MB**.
 *
 * Es lo que hace posible la respuesta "ya estás al día" del botón
 * "Actualizar": 350 ms contra el portal en vez de 2,6 s de descarga más el
 * reprocesamiento entero de 36.046 filas.
 *
 * ## Por qué no alcanza con la fecha que devuelve la API del portal
 *
 * CKAN publica `last_modified` como una fecha ISO **sin zona horaria**
 * ("2025-12-17T15:53:47.670000"), mientras que la cabecera HTTP
 * `Last-Modified` viene en RFC 1123 y siempre en GMT. Comparar una contra
 * otra hace que `Date.parse` interprete la primera en la hora LOCAL del
 * servidor y las dos nunca coincidan: en la primera versión de esta tarea
 * eso hacía que "Actualizar" volviera a bajar y reprocesar el archivo entero
 * cada vez, aun sin edición nueva (medido: 9 tandas y 9,3 s de trabajo
 * inútil). Comparar cabecera contra cabecera elimina el problema de raíz —
 * las dos puntas salen de la misma fuente y del mismo formato—.
 */
export async function huellaDelCsv(url: string): Promise<HuellaCsv> {
  const respuesta = await pedirAlMinisterio(url, { metodo: "HEAD", topeBytes: 1_048_576 })

  if (respuesta.status !== 200) {
    throw new ErrorPortalMinisterio(
      `El portal respondió ${respuesta.status} al consultar la versión del CSV del REFES.`,
    )
  }

  return leerHuella(respuesta)
}

/** Descarga el CSV de una edición. Lanza `ErrorPortalMinisterio` si algo sale mal. */
export async function descargarCsvRefes(url: string): Promise<CsvDescargado> {
  const respuesta = await pedirAlMinisterio(url)

  if (respuesta.status !== 200) {
    throw new ErrorPortalMinisterio(
      `El portal respondió ${respuesta.status} al descargar el CSV del REFES.`,
    )
  }
  if (respuesta.cuerpo.length === 0) {
    throw new ErrorPortalMinisterio("El portal devolvió un CSV vacío.")
  }

  return { contenido: respuesta.cuerpo, ...leerHuella(respuesta) }
}

/** `Last-Modified` (normalizado a ISO en UTC) y `ETag` de una respuesta del portal. */
function leerHuella(respuesta: RespuestaHttp): HuellaCsv {
  const cabecera = (nombre: string): string | null => {
    const valor = respuesta.headers[nombre]
    if (Array.isArray(valor)) return valor[0] ?? null
    return typeof valor === "string" ? valor : null
  }

  const lastModifiedCrudo = cabecera("last-modified")
  const lastModified = lastModifiedCrudo ? new Date(lastModifiedCrudo) : null

  return {
    lastModified:
      lastModified && !Number.isNaN(lastModified.getTime()) ? lastModified.toISOString() : null,
    etag: cabecera("etag"),
  }
}
