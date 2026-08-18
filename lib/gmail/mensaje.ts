/**
 * Lectura PURA de un mensaje de la API de Gmail (Sprint 17, tarea 17.2).
 *
 * Recibe el JSON crudo de `users.messages.get?format=full` -real o SIMULADO en
 * un test- y devuelve lo único que le interesa al producto: quién lo mandó,
 * con qué asunto, de cuándo es, qué adjuntos trae y qué dice el texto. Sin
 * red, sin `server-only`, sin estado: se prueba con objetos literales
 * (`tests/unit/gmail-mensaje.test.ts`), igual que
 * `lib/turnos/construir-propuestas.ts` se prueba con respuestas de Gemini
 * simuladas.
 *
 * ## Por qué el cuerpo se devuelve pero no se guarda
 *
 * `cuerpoTexto` sale de esta función porque hay dos cosas que hacer con él en
 * memoria: pasarlo por la heurística de "¿esto parece un aviso de turno?"
 * (`lib/gmail/heuristica-turno.ts`) y, si la persona lo pide, mandárselo al
 * analizador de la tarea 16.4. Ninguna de las dos lo persiste: la fila de
 * `gmail_messages` guarda metadatos del sobre y nunca el contenido (ver el
 * encabezado de `20260818140000_gmail_mensajes.sql`). El `snippet` que
 * devuelve la API se ignora por completo, porque un snippet ES cuerpo.
 *
 * ## Los adjuntos se describen, no se bajan
 *
 * De cada parte con nombre de archivo queda un DESCRIPTOR: nombre, tipo,
 * tamaño y el `attachmentId` con el que Gmail entrega los bytes después. Bajar
 * el archivo es otra llamada HTTP y ocurre recién cuando una persona toca
 * "revisar" — no durante el barrido.
 */

import { EXTENSION_POR_MIME, LIMITE_BYTES, type MimeValidado } from "@/lib/archivos/validacion"

/** Tope del asunto que se guarda. Un asunto real nunca se acerca; el corte es defensivo. */
const MAX_ASUNTO = 300

/**
 * Tope del texto que se extrae del cuerpo.
 *
 * Es el mismo `MAX_LARGO_MENSAJE` de `app/api/turnos/analizar-mensaje/route.ts`:
 * lo que salga de acá puede terminar en ese analizador, y no tiene sentido
 * arrastrar 400 KB de firma corporativa y aviso de confidencialidad para
 * después rebotar contra el límite del otro lado.
 */
export const MAX_CUERPO = 8000

/** Los cuatro tipos que el pipeline de documentos sabe ingerir (`lib/archivos/validacion.ts`). */
const MIMES_SOPORTADOS: MimeValidado[] = ["application/pdf", "image/jpeg", "image/png", "image/webp"]

/**
 * Extensión → MIME, para el caso MUY común de la clínica que manda el PDF
 * declarado como `application/octet-stream`.
 *
 * Confiar en la extensión sería inaceptable si fuera la última palabra, pero no
 * lo es: `ingestarDocumento` vuelve a detectar el MIME REAL por magic bytes
 * (`detectarMimeReal`) antes de subir nada, y rechaza el archivo si no coincide
 * con ninguno de los cuatro. Acá la extensión solo decide si vale la pena
 * OFRECER el adjunto; mentir en el nombre no alcanza para que entre algo que
 * no sea un PDF o una imagen.
 */
const MIME_POR_EXTENSION: Record<string, MimeValidado> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

export type MotivoAdjuntoNoApto = "demasiado_grande" | "tipo_no_soportado"

export interface AdjuntoGmail {
  /** Id con el que Gmail entrega los bytes (`users.messages.attachments.get`). */
  attachmentId: string
  filename: string
  /** MIME resuelto (declarado, o deducido de la extensión si el declarado era genérico). `null` si no es ninguno de los cuatro soportados. */
  mimeType: MimeValidado | null
  /** Lo que declaró el correo, tal cual. Se conserva para diagnóstico. */
  mimeDeclarado: string
  size: number
  /** `true` si se puede ofrecer para importar. */
  apto: boolean
  motivo: MotivoAdjuntoNoApto | null
}

export interface MensajeParseado {
  /** Id del mensaje en Gmail. */
  id: string
  /** Dirección del remitente, en minúsculas. Cadena vacía si el header venía roto. */
  remitenteEmail: string
  /** Nombre visible del remitente, si el header lo traía. */
  remitenteNombre: string | null
  asunto: string | null
  /** Fecha del mensaje en ISO, derivada de `internalDate`. `null` si no vino. */
  fechaIso: string | null
  adjuntos: AdjuntoGmail[]
  /**
   * Texto del cuerpo, ya decodificado y recortado. **No se persiste**: vive en
   * memoria el tiempo de decidir si parece un turno y, si la persona lo pide,
   * de mandárselo al analizador de la 16.4.
   */
  cuerpoTexto: string
}

interface ParteCruda {
  partId?: unknown
  mimeType?: unknown
  filename?: unknown
  headers?: unknown
  body?: unknown
  parts?: unknown
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : ""
}

/** Busca un header por nombre, sin distinguir mayúsculas (el RFC 5322 no las distingue). */
function header(headers: unknown, nombre: string): string {
  if (!Array.isArray(headers)) return ""
  const objetivo = nombre.toLowerCase()
  for (const crudo of headers as { name?: unknown; value?: unknown }[]) {
    if (typeof crudo?.name === "string" && crudo.name.toLowerCase() === objetivo) {
      return texto(crudo.value)
    }
  }
  return ""
}

/**
 * Parte un header `From` en nombre y dirección.
 *
 * Las tres formas que llegan de verdad: `"Clínica San Jorge" <turnos@sj.com.ar>`,
 * `Clinica <turnos@sj.com.ar>` y `turnos@sj.com.ar` pelado. Se resuelve
 * buscando el par de ángulos y no con una expresión de RFC 5322 completa: esa
 * gramática admite comentarios anidados y grupos que ningún correo real de una
 * clínica usa, y una regex que los cubriera sería imposible de auditar.
 */
export function parsearRemitente(from: string): { email: string; nombre: string | null } {
  const crudo = from.trim()
  if (crudo.length === 0) return { email: "", nombre: null }

  const abre = crudo.lastIndexOf("<")
  const cierra = crudo.lastIndexOf(">")

  if (abre !== -1 && cierra > abre) {
    const email = crudo.slice(abre + 1, cierra).trim().toLowerCase()
    const nombre = crudo
      .slice(0, abre)
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .trim()
    return { email, nombre: nombre.length > 0 ? nombre : null }
  }

  return { email: crudo.toLowerCase(), nombre: null }
}

/**
 * Decodifica el `body.data` de Gmail, que viene en **base64url** (con `-` y
 * `_` en vez de `+` y `/`), respetando el `charset` que declare la parte.
 *
 * El charset importa de verdad: todavía hay sistemas de turnos que mandan
 * `text/plain; charset=ISO-8859-1`, y decodificar esos bytes como UTF-8
 * convierte cada tilde en un rombo — justo en el texto que se le va a mandar al
 * analizador de turnos, donde "Cardiología" o "Fernández" tienen que llegar
 * enteros. `TextDecoder` conoce las etiquetas del WHATWG (`iso-8859-1`,
 * `windows-1252`, `utf-8`, …); ante una etiqueta desconocida se cae a UTF-8,
 * que es lo correcto por defecto.
 */
export function decodificarParte(datosBase64Url: string, mimeType: string): string {
  if (datosBase64Url.length === 0) return ""

  let bytes: Buffer
  try {
    bytes = Buffer.from(datosBase64Url, "base64url")
  } catch {
    return ""
  }

  const declarado = /charset="?([\w-]+)"?/i.exec(mimeType)?.[1]?.toLowerCase()
  const etiqueta = declarado && declarado !== "us-ascii" ? declarado : "utf-8"

  try {
    return new TextDecoder(etiqueta).decode(bytes)
  } catch {
    return new TextDecoder("utf-8").decode(bytes)
  }
}

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

/**
 * HTML → texto plano, para el caso -frecuente- del aviso de turno que llega
 * solo en HTML.
 *
 * No es un parser: es un desarmado a propósito grosero, porque lo único que
 * tiene que sobrevivir es el texto que lee una persona. Se tiran `<style>` y
 * `<script>` enteros (su contenido no es texto para nadie), los cortes de
 * bloque se vuelven saltos de línea para que el analizador de turnos no reciba
 * "Dr. GómezMartes 14/7" pegado, y las entidades más comunes se traducen.
 */
export function htmlATexto(html: string): string {
  return html
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_todo, codigo: string) => String.fromCodePoint(Number(codigo)))
    .replace(/&#x([0-9a-f]+);/gi, (_todo, codigo: string) => String.fromCodePoint(parseInt(codigo, 16)))
    .replace(/&([a-z]+);/gi, (todo, nombre: string) => ENTIDADES[nombre.toLowerCase()] ?? todo)
    // Todo lo que sea espacio EXCEPTO el salto de línea (que se acaba de
    // ganar su lugar arriba): tabulaciones, espacios finos y el espacio duro
    // que dejó `&nbsp;`.
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((linea) => linea.trim())
    .join("\n")
    .trim()
}

/** Recorre el árbol de partes en profundidad, empezando por la raíz. */
function recorrerPartes(raiz: ParteCruda, visitar: (parte: ParteCruda) => void): void {
  visitar(raiz)
  const hijas = raiz.parts
  if (!Array.isArray(hijas)) return
  for (const hija of hijas as ParteCruda[]) {
    if (hija && typeof hija === "object") recorrerPartes(hija, visitar)
  }
}

/**
 * Texto del cuerpo. Prefiere `text/plain`; si el correo vino solo en HTML,
 * lo desarma con `htmlATexto`.
 *
 * Se concatenan TODAS las partes de texto del mismo tipo -un mensaje
 * `multipart/mixed` puede traer el aviso partido en dos- pero nunca se mezcla
 * el plano con el HTML: en un `multipart/alternative` los dos dicen lo mismo y
 * juntarlos duplicaría el texto que ve el analizador.
 */
export function extraerCuerpoTexto(payload: unknown): string {
  if (!payload || typeof payload !== "object") return ""

  const planos: string[] = []
  const htmls: string[] = []

  recorrerPartes(payload as ParteCruda, (parte) => {
    const mime = texto(parte.mimeType).toLowerCase()
    const body = (parte.body ?? {}) as { data?: unknown; attachmentId?: unknown }
    const datos = texto(body.data)
    if (datos.length === 0) return
    // Una parte con `attachmentId` es un archivo, no el cuerpo — aunque su
    // mimeType sea `text/plain` (un `.txt` adjunto).
    if (typeof body.attachmentId === "string" && body.attachmentId.length > 0) return

    if (mime.startsWith("text/plain")) {
      planos.push(decodificarParte(datos, texto(parte.mimeType)))
    } else if (mime.startsWith("text/html")) {
      htmls.push(decodificarParte(datos, texto(parte.mimeType)))
    }
  })

  const elegido = planos.length > 0 ? planos.join("\n\n") : htmls.map(htmlATexto).join("\n\n")
  const limpio = elegido.replace(/\r\n/g, "\n").trim()
  return limpio.length > MAX_CUERPO ? limpio.slice(0, MAX_CUERPO) : limpio
}

function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf(".")
  return punto === -1 ? "" : nombre.slice(punto + 1).toLowerCase()
}

/** Resuelve el MIME de un adjunto: el declarado si sirve, si no el que sugiere la extensión. */
export function resolverMimeAdjunto(mimeDeclarado: string, filename: string): MimeValidado | null {
  const declarado = mimeDeclarado.split(";")[0].trim().toLowerCase()
  if ((MIMES_SOPORTADOS as string[]).includes(declarado)) {
    return declarado as MimeValidado
  }
  return MIME_POR_EXTENSION[extensionDe(filename)] ?? null
}

/**
 * Descriptores de los adjuntos del mensaje.
 *
 * ## Las imágenes incrustadas NO son adjuntos
 *
 * El logo de la firma de una clínica llega como una parte con nombre de
 * archivo y `attachmentId`, igual que el estudio de verdad. Lo que las
 * distingue es que las incrustadas traen `Content-ID` (es lo que el HTML
 * referencia con `cid:`) y `Content-Disposition: inline`. Se descartan cuando
 * se cumplen LAS DOS cosas: descartar por `inline` solo dejaría afuera
 * adjuntos legítimos de clientes de correo que marcan todo como inline, y
 * descartar por `Content-ID` solo haría lo mismo con los que se lo ponen a
 * todo. Con las dos juntas, lo que queda afuera es el logo y no la radiografía.
 */
export function recolectarAdjuntos(payload: unknown): AdjuntoGmail[] {
  if (!payload || typeof payload !== "object") return []

  const adjuntos: AdjuntoGmail[] = []

  recorrerPartes(payload as ParteCruda, (parte) => {
    const filename = texto(parte.filename).trim()
    if (filename.length === 0) return

    const body = (parte.body ?? {}) as { attachmentId?: unknown; size?: unknown }
    const attachmentId = texto(body.attachmentId)
    if (attachmentId.length === 0) return

    const contentId = header(parte.headers, "Content-ID")
    const disposicion = header(parte.headers, "Content-Disposition").toLowerCase()
    if (contentId.length > 0 && disposicion.includes("inline")) return

    const mimeDeclarado = texto(parte.mimeType)
    const size = typeof body.size === "number" && Number.isFinite(body.size) ? body.size : 0
    const mimeType = resolverMimeAdjunto(mimeDeclarado, filename)

    let motivo: MotivoAdjuntoNoApto | null = null
    if (mimeType === null) {
      motivo = "tipo_no_soportado"
    } else if (size > LIMITE_BYTES) {
      motivo = "demasiado_grande"
    }

    adjuntos.push({
      attachmentId,
      filename,
      mimeType,
      mimeDeclarado,
      size,
      apto: motivo === null,
      motivo,
    })
  })

  return adjuntos
}

/**
 * Convierte el JSON de `messages.get` en lo que necesita el barrido.
 * Devuelve `null` si el mensaje no trae ni siquiera un id: no hay nada que
 * registrar, y quien llama lo cuenta como error de ese mensaje sin abortar la
 * pasada.
 */
export function parsearMensajeGmail(crudo: unknown): MensajeParseado | null {
  if (!crudo || typeof crudo !== "object") return null

  const mensaje = crudo as { id?: unknown; internalDate?: unknown; payload?: unknown }
  const id = texto(mensaje.id)
  if (id.length === 0) return null

  const payload = mensaje.payload
  const headers = (payload as ParteCruda | undefined)?.headers

  const { email, nombre } = parsearRemitente(header(headers, "From"))
  const asuntoCrudo = header(headers, "Subject").trim()

  let fechaIso: string | null = null
  const internal = mensaje.internalDate
  const ms = typeof internal === "string" ? Number(internal) : typeof internal === "number" ? internal : NaN
  if (Number.isFinite(ms) && ms > 0) {
    fechaIso = new Date(ms).toISOString()
  }

  return {
    id,
    remitenteEmail: email,
    remitenteNombre: nombre,
    asunto: asuntoCrudo.length > 0 ? asuntoCrudo.slice(0, MAX_ASUNTO) : null,
    fechaIso,
    adjuntos: recolectarAdjuntos(payload),
    cuerpoTexto: extraerCuerpoTexto(payload),
  }
}

/**
 * Nombre de archivo seguro para el `File` que se le pasa a
 * `ingestarDocumento`.
 *
 * El nombre viaja a `documents.title` (vía `tituloDesdeNombre`) y a ningún
 * lado más -el path del objeto en Storage lo genera el servidor con un uuid,
 * ver `construirStoragePath`-, así que acá no hay riesgo de path traversal.
 * Igual se saca cualquier separador de directorio y se acota el largo: un
 * nombre con barras en el título de la lista se ve como un error, y un nombre
 * de 400 caracteres rompe la tarjeta.
 */
export function nombreSeguroDeAdjunto(filename: string, mimeType: MimeValidado): string {
  const base = filename
    .replace(/[\\/]+/g, " ")
    // Los caracteres de control se sacan recorriendo la cadena y no con una
    // regex: un carácter de control literal dentro de un `.ts` es justo lo
    // que rompe un diff o una auditoría de charset (mismo criterio que
    // `tieneCaracteresDeControl` en `lib/auth/rutas.ts`).
    .split("")
    .filter((caracter) => {
      const codigo = caracter.charCodeAt(0)
      return codigo >= 0x20 && codigo !== 0x7f
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)

  if (base.length === 0) return `adjunto.${EXTENSION_POR_MIME[mimeType]}`
  return base
}
