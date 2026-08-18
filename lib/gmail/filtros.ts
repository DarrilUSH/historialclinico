import "server-only"

/**
 * Filtros aprendidos por remitente (Sprint 17, tarea 17.2).
 *
 * ## El problema real que resuelve
 *
 * El catálogo REFES (tarea 16.3) tiene los centros de salud del país con su
 * dirección y su teléfono, pero **no tiene las direcciones de correo desde las
 * que cada uno manda los turnos**: no existe una lista de "remitentes médicos"
 * que se pueda precargar. Así que la app no puede adivinar de antemano qué
 * correos etiquetar — pero SÍ puede aprender del uso: cuando alguien revisa un
 * correo que vino de `turnos@sanjorge.com.ar`, ese remitente ya demostró ser
 * de los que interesan, y la app ofrece, de UN TOQUE, que los próximos entren
 * solos a la etiqueta.
 *
 * ## Qué hace el filtro, exactamente
 *
 * Una regla en el Gmail de la persona: "correo de X → agregar etiqueta
 * historialmedico". **Nada más.** No archiva, no marca como leído, no borra
 * (ver `crearFiltroPorRemitente` en `lib/gmail/google-api.ts`). El correo sigue
 * llegando a su bandeja de entrada igual que siempre; lo único que cambia es
 * que además queda etiquetado, y por lo tanto visible para el barrido.
 *
 * ## Y se puede deshacer
 *
 * Cada filtro creado queda anotado en `gmail_filters`, y la pantalla los lista
 * con su botón de sacar. Crear reglas invisibles en la casilla de alguien sin
 * darle forma de encontrarlas y borrarlas sería lo contrario del compromiso de
 * `docs/minimizacion-datos.md` §10.
 */

import { obtenerAccessTokenGmail } from "@/lib/gmail/conexiones-admin"
import { borrarFiltro, crearFiltroPorRemitente, type OpcionesBases } from "@/lib/gmail/google-api"
import {
  borrarFiltroRegistrado,
  obtenerFiltroRegistrado,
  registrarFiltroAprendido,
} from "@/lib/gmail/mensajes-admin"

export interface ResultadoAprendizaje {
  remitente: string
  /** `true` si el filtro ya existía en Gmail (la persona lo había creado, o se tocó dos veces). */
  yaExistia: boolean
}

export interface OpcionesFiltros {
  bases?: OpcionesBases
  obtenerAccessToken?: (userId: string) => Promise<string>
}

/**
 * Crea (o reconoce) el filtro para un remitente y lo deja anotado.
 *
 * Idempotente por partida doble: Gmail responde "ya existe" si estaba, y el
 * registro es un `upsert` por `(user_id, from_email)`. Tocar el botón dos veces
 * no crea dos reglas.
 */
export async function aprenderRemitente(
  parametros: { userId: string; remitente: string; labelId: string; labelName: string },
  opciones: OpcionesFiltros = {},
): Promise<ResultadoAprendizaje> {
  const remitente = parametros.remitente.trim().toLowerCase()
  const obtenerToken = opciones.obtenerAccessToken ?? obtenerAccessTokenGmail

  const accessToken = await obtenerToken(parametros.userId)

  const { filtro, yaExistia } = await crearFiltroPorRemitente(
    accessToken,
    { remitente, labelId: parametros.labelId },
    opciones.bases,
  )

  await registrarFiltroAprendido({
    userId: parametros.userId,
    gmailFilterId: filtro.id,
    remitente,
    labelId: parametros.labelId,
    labelName: parametros.labelName,
  })

  return { remitente, yaExistia }
}

/**
 * Saca el filtro de Gmail y del registro.
 *
 * El orden importa: primero Gmail, después la fila. Si se borrara la fila
 * primero y Gmail fallara, quedaría una regla activa en la casilla de la
 * persona sin ninguna forma de encontrarla desde la app — justo lo que este
 * registro existe para evitar. Al revés, si Gmail borra y la fila no, lo peor
 * que pasa es que la pantalla siga listando un filtro que ya no existe, y
 * volver a tocar "sacar" lo resuelve (`borrarFiltro` no falla ante un 404).
 */
export async function olvidarFiltro(
  parametros: { userId: string; filtroId: string },
  opciones: OpcionesFiltros = {},
): Promise<{ remitente: string } | null> {
  const registrado = await obtenerFiltroRegistrado(parametros.userId, parametros.filtroId)
  if (!registrado) return null

  const obtenerToken = opciones.obtenerAccessToken ?? obtenerAccessTokenGmail
  const accessToken = await obtenerToken(parametros.userId)

  await borrarFiltro(accessToken, registrado.gmailFilterId, opciones.bases)
  await borrarFiltroRegistrado(parametros.userId, registrado.id)

  return { remitente: registrado.remitente }
}
