import "server-only"

/**
 * EL BARRIDO: mirar la etiqueta `historialmedico` y anotar lo que llegó
 * (Sprint 17, tarea 17.2).
 *
 * Lo corren dos disparadores y hacen exactamente lo mismo:
 *
 * - **"Buscar ahora"** — la Server Action de `/perfil/gmail`, sobre UNA
 *   conexión: la de quien tocó el botón.
 * - **El cron de cada 30 minutos** — `POST /api/gmail/procesar-barrido`,
 *   llamado por `pg_cron` a través de `pg_net`, sobre todas las conexiones
 *   vivas (`disparar_barrido_gmail()`, `20260818140000` §5).
 *
 * ## Qué hace exactamente una pasada
 *
 * 1. Pide un access token fresco (`obtenerAccessTokenGmail`, tarea 17.1).
 * 2. Lista los mensajes **de la etiqueta** (nunca de la casilla entera).
 * 3. Descarta los que ya están en `gmail_messages` — el dedup, con UNA
 *    consulta por página.
 * 4. De cada mensaje nuevo baja el `format=full`, lo interpreta con
 *    `lib/gmail/mensaje.ts` y lo clasifica:
 *    · trae un adjunto apto → `documento`
 *    · si no, y el cuerpo pasa la heurística → `turno`
 *    · si no → `nada` (queda registrado y descartado: no se vuelve a mirar)
 * 5. Registra la fila. **No baja ni un byte de adjunto y no persiste ni una
 *    línea del cuerpo**: eso pasa recién cuando una persona toca el ítem.
 *
 * ## Las tres reglas de robustez, y por qué
 *
 * - **Un mensaje que explota no aborta la pasada.** Se cuenta como error, se
 *   sigue con el siguiente, y como NO se registró, la próxima pasada lo vuelve
 *   a intentar. Un 500 transitorio de Google en el tercero de veinte no puede
 *   costar los diecisiete que faltaban.
 * - **`invalid_grant` (o un 401 a mitad de camino) corta ESA conexión y sigue
 *   con las demás.** La conexión queda marcada `vencida` y la pantalla ofrece
 *   reconectar. En una familia con dos cuentas conectadas, que a una se le
 *   venza el permiso no puede dejar a la otra sin barrido.
 * - **Tandas.** Como mucho `LIMITE_MENSAJES_POR_PASADA` mensajes por conexión y
 *   por pasada. Lo que sobra se lo lleva la pasada siguiente (o el "Buscar
 *   ahora", que lo dice en pantalla). Es lo que mantiene la función serverless
 *   corta —requisito de costo cero— y lo que impide que la primera conexión de
 *   alguien con 400 correos viejos en la etiqueta se convierta en una corrida
 *   de minutos.
 *
 * ## Inyección de dependencias, para probarlo de verdad
 *
 * Las llamadas HTTP se hacen con las funciones REALES de
 * `lib/gmail/google-api.ts`, que aceptan `bases` inyectables: el test las
 * apunta a un servidor `node:http` local (`tests/unit/gmail-barrido.test.ts`,
 * mismo patrón que la 17.1). Lo único que se sustituye es la persistencia y el
 * token, que son la base de datos y el Vault. Así lo que se prueba es el
 * código, no un mock.
 */

import {
  ErrorConexionGmailVencida,
  marcarConexionVencida,
  obtenerAccessTokenGmail,
} from "@/lib/gmail/conexiones-admin"
import {
  ErrorGmail,
  listarMensajesDeEtiqueta,
  obtenerMensajeCompleto,
  type OpcionesBases,
} from "@/lib/gmail/google-api"
import { pareceAvisoDeTurno } from "@/lib/gmail/heuristica-turno"
import { parsearMensajeGmail } from "@/lib/gmail/mensaje"
import {
  idsYaProcesados,
  registrarMensajeProcesado,
  type ClaseMensajeGmail,
  type MensajeParaRegistrar,
} from "@/lib/gmail/mensajes-admin"

/** Nombre estable para grepear los logs, mismo criterio que `[recordatorios]`. */
const PREFIJO = "[gmail-barrido]"

/**
 * Cuántos mensajes NUEVOS procesa una pasada por conexión.
 *
 * Cada uno cuesta una llamada HTTP a Gmail (`messages.get`, ~5 unidades de
 * cuota). Quince deja la pasada en unos pocos segundos en el peor caso, con
 * margen de sobra dentro de una función serverless del plan gratuito, y cubre
 * de una sola vez cualquier día normal —una familia no recibe quince correos
 * médicos por día—. La primera conexión de alguien que ya tenía cien correos
 * etiquetados se resuelve en varias pasadas de media hora, o tocando "Buscar
 * ahora" unas cuantas veces; la pantalla lo dice cuando quedó algo.
 */
export const LIMITE_MENSAJES_POR_PASADA = 15

/** Tope de páginas del listado por pasada. Evita paginar para siempre en una etiqueta enorme y ya toda procesada. */
const MAX_PAGINAS = 4

/** Cuántos ids pide cada página del listado. Es barato: `messages.list` solo devuelve ids. */
const IDS_POR_PAGINA = 50

export interface ConexionParaBarrer {
  userId: string
  /** La casilla, para dejar anotado a dónde llegó cada correo. */
  email: string
  /** El id de la etiqueta en ESA casilla. Sin esto no hay barrido posible. */
  labelId: string
}

export interface ResultadoBarrido {
  /** Correos nuevos registrados en esta pasada. */
  nuevos: number
  /** De esos, cuántos tienen un adjunto para revisar. */
  documentos: number
  /** De esos, cuántos parecen un aviso de turno. */
  turnos: number
  /** De esos, cuántos no traían nada aprovechable (quedan descartados solos). */
  descartados: number
  /** Mensajes que fallaron y quedaron para la próxima pasada. */
  errores: number
  /** `true` si el permiso venció durante la pasada: la conexión quedó marcada. */
  vencida: boolean
  /** `true` si quedaron correos nuevos sin procesar por el límite de la tanda. */
  hayMas: boolean
}

const RESULTADO_VACIO: ResultadoBarrido = {
  nuevos: 0,
  documentos: 0,
  turnos: 0,
  descartados: 0,
  errores: 0,
  vencida: false,
  hayMas: false,
}

/**
 * Todo lo que el barrido necesita del mundo exterior. En producción son las
 * funciones reales; los tests reemplazan solo la persistencia y el token.
 */
export interface DependenciasBarrido {
  obtenerAccessToken: (userId: string) => Promise<string>
  yaProcesados: (userId: string, ids: string[]) => Promise<Set<string>>
  registrar: (datos: MensajeParaRegistrar) => Promise<void>
  marcarVencida: (userId: string) => Promise<void>
}

const DEPENDENCIAS_REALES: DependenciasBarrido = {
  obtenerAccessToken: (userId) => obtenerAccessTokenGmail(userId),
  yaProcesados: idsYaProcesados,
  registrar: registrarMensajeProcesado,
  marcarVencida: marcarConexionVencida,
}

export interface OpcionesBarrido {
  /** URLs de Google. Los tests las apuntan a un servidor local. */
  bases?: OpcionesBases
  /** Tope de mensajes nuevos por pasada. Por defecto `LIMITE_MENSAJES_POR_PASADA`. */
  limite?: number
  /** Persistencia y token. Por defecto, los módulos reales. */
  dependencias?: Partial<DependenciasBarrido>
}

/** ¿Este error significa "el permiso ya no vale"? */
function esPermisoVencido(error: unknown): boolean {
  return (
    error instanceof ErrorConexionGmailVencida ||
    (error instanceof ErrorGmail && error.codigo === "permiso_vencido")
  )
}

/** La clasificación, en un solo lugar y sin efectos: adjunto gana, después turno, después nada. */
export function clasificarMensaje(
  tieneAdjuntoApto: boolean,
  pareceTurno: boolean,
): ClaseMensajeGmail {
  if (tieneAdjuntoApto) return "documento"
  if (pareceTurno) return "turno"
  return "nada"
}

/**
 * Junta hasta `limite` ids de mensajes NUEVOS (no registrados), paginando el
 * listado de la etiqueta.
 *
 * Devuelve además si quedó algo afuera, que es lo que la pantalla usa para
 * decir "todavía quedan correos por revisar".
 */
async function juntarIdsNuevos(
  conexion: ConexionParaBarrer,
  accessToken: string,
  limite: number,
  deps: DependenciasBarrido,
  bases: OpcionesBases | undefined,
): Promise<{ ids: string[]; hayMas: boolean }> {
  const nuevos: string[] = []
  let pageToken: string | null = null

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const respuesta = await listarMensajesDeEtiqueta(
      accessToken,
      { labelId: conexion.labelId, maxResults: IDS_POR_PAGINA, pageToken },
      bases,
    )

    if (respuesta.ids.length > 0) {
      const conocidos = await deps.yaProcesados(conexion.userId, respuesta.ids)
      for (const id of respuesta.ids) {
        if (!conocidos.has(id)) nuevos.push(id)
      }
    }

    if (nuevos.length > limite) {
      // Ya sabemos que sobra: no hace falta seguir paginando para contarlos.
      return { ids: nuevos.slice(0, limite), hayMas: true }
    }

    pageToken = respuesta.siguientePagina
    if (!pageToken) return { ids: nuevos, hayMas: false }
  }

  // Se agotaron las páginas permitidas y todavía había más listado por mirar.
  return { ids: nuevos.slice(0, limite), hayMas: true }
}

/**
 * Barre UNA conexión. No lanza por problemas de un mensaje ni por un permiso
 * vencido: los reporta en el resultado. Sí lanza si el listado entero falla por
 * algo que no es el permiso (Google caído), porque entonces no hay pasada que
 * reportar.
 */
export async function barrerConexion(
  conexion: ConexionParaBarrer,
  opciones: OpcionesBarrido = {},
): Promise<ResultadoBarrido> {
  const deps: DependenciasBarrido = { ...DEPENDENCIAS_REALES, ...opciones.dependencias }
  const limite = opciones.limite ?? LIMITE_MENSAJES_POR_PASADA
  const resultado: ResultadoBarrido = { ...RESULTADO_VACIO }

  if (conexion.labelId.trim().length === 0) {
    // Sin etiqueta no hay nada que leer, y NO se cae a leer la casilla entera:
    // ese es justamente el compromiso del §10.3 de minimización.
    console.warn(`${PREFIJO} la conexión de ${conexion.userId} no tiene etiqueta: no se barre nada.`)
    return resultado
  }

  let accessToken: string
  try {
    accessToken = await deps.obtenerAccessToken(conexion.userId)
  } catch (error) {
    if (esPermisoVencido(error)) {
      // `obtenerAccessTokenGmail` ya dejó la conexión marcada.
      return { ...resultado, vencida: true }
    }
    throw error
  }

  let nuevos: { ids: string[]; hayMas: boolean }
  try {
    nuevos = await juntarIdsNuevos(conexion, accessToken, limite, deps, opciones.bases)
  } catch (error) {
    if (esPermisoVencido(error)) {
      await deps.marcarVencida(conexion.userId)
      return { ...resultado, vencida: true }
    }
    throw error
  }

  resultado.hayMas = nuevos.hayMas

  for (const id of nuevos.ids) {
    try {
      const crudo = await obtenerMensajeCompleto(accessToken, id, opciones.bases)
      const mensaje = parsearMensajeGmail(crudo)

      if (!mensaje) {
        // Sin id no hay nada que registrar; se cuenta como error para que la
        // próxima pasada lo reintente en vez de perderlo en silencio.
        resultado.errores += 1
        console.error(`${PREFIJO} el mensaje ${id} llegó sin forma reconocible.`)
        continue
      }

      const tieneAdjuntoApto = mensaje.adjuntos.some((adjunto) => adjunto.apto)
      // La heurística corre SIEMPRE (es local y barata), pero el cuerpo no sale
      // de acá: lo único que se persiste es el booleano.
      const pareceTurno = pareceAvisoDeTurno(mensaje.cuerpoTexto)
      const clase = clasificarMensaje(tieneAdjuntoApto, pareceTurno)

      await deps.registrar({
        userId: conexion.userId,
        gmailMessageId: mensaje.id,
        connectionEmail: conexion.email,
        remitenteEmail: mensaje.remitenteEmail,
        remitenteNombre: mensaje.remitenteNombre,
        asunto: mensaje.asunto,
        fechaIso: mensaje.fechaIso,
        clase,
        pareceTurno,
        adjuntos: mensaje.adjuntos,
      })

      resultado.nuevos += 1
      if (clase === "documento") resultado.documentos += 1
      else if (clase === "turno") resultado.turnos += 1
      else resultado.descartados += 1
    } catch (error) {
      if (esPermisoVencido(error)) {
        // El permiso murió a mitad de la pasada: se marca la conexión y se
        // corta ACÁ. Lo ya registrado queda; lo que faltaba se hará cuando la
        // persona reconecte.
        await deps.marcarVencida(conexion.userId)
        resultado.vencida = true
        resultado.hayMas = true
        return resultado
      }

      resultado.errores += 1
      // El id de Gmail no es un dato de salud y es lo único que permite
      // diagnosticar; el contenido del mensaje NUNCA se loguea.
      console.error(
        `${PREFIJO} falló el mensaje ${id} (queda sin registrar, se reintenta en la próxima pasada):`,
        error instanceof Error ? error.message : error,
      )
    }
  }

  return resultado
}

export interface ResumenBarridoGeneral extends ResultadoBarrido {
  /** Conexiones que se intentaron. */
  conexiones: number
  /** Conexiones que quedaron marcadas como vencidas en esta corrida. */
  vencidas: number
  /** Conexiones que fallaron enteras (Google caído para esa cuenta). */
  conexionesConFallo: number
}

/**
 * Barre TODAS las conexiones que le pasen, una después de la otra.
 *
 * En serie y no en paralelo a propósito: son llamadas a la misma API con la
 * misma cuota de proyecto, y el paralelismo solo agregaría picos de
 * concurrencia sin acortar de verdad una corrida que casi siempre tiene una o
 * dos conexiones. Lo que sí importa es que **una conexión rota no puede tumbar
 * a las otras**, y de eso se ocupa el `try/catch` de cada vuelta.
 */
export async function barrerConexiones(
  conexiones: ConexionParaBarrer[],
  opciones: OpcionesBarrido = {},
): Promise<ResumenBarridoGeneral> {
  const total: ResumenBarridoGeneral = {
    ...RESULTADO_VACIO,
    conexiones: conexiones.length,
    vencidas: 0,
    conexionesConFallo: 0,
  }

  for (const conexion of conexiones) {
    try {
      const parcial = await barrerConexion(conexion, opciones)
      total.nuevos += parcial.nuevos
      total.documentos += parcial.documentos
      total.turnos += parcial.turnos
      total.descartados += parcial.descartados
      total.errores += parcial.errores
      total.hayMas = total.hayMas || parcial.hayMas
      if (parcial.vencida) {
        total.vencidas += 1
        total.vencida = true
      }
    } catch (error) {
      total.conexionesConFallo += 1
      console.error(
        `${PREFIJO} la conexión de ${conexion.userId} falló entera (las demás siguen):`,
        error instanceof Error ? error.message : error,
      )
    }
  }

  return total
}

/**
 * La frase que ve la persona después de "Buscar ahora".
 *
 * Pura y probada aparte: el conteo es lo único que la persona lee para saber
 * si valió la pena tocar el botón, y una frase que diga "1 estudios" o que
 * cuente los descartados como si fueran hallazgos sería peor que no decir
 * nada. Los correos sin nada aprovechable NO se mencionan: son ruido que la
 * app resolvió sola.
 */
export function fraseDeResultado(resultado: ResultadoBarrido): string {
  if (resultado.vencida && resultado.nuevos === 0) {
    return "Se venció el permiso para leer tu Gmail. Volvé a conectarlo y probamos de nuevo."
  }

  const paraRevisar = resultado.documentos + resultado.turnos

  if (paraRevisar === 0) {
    if (resultado.nuevos > 0) {
      return resultado.nuevos === 1
        ? "Miramos 1 correo nuevo y no había nada para sumar al historial."
        : `Miramos ${resultado.nuevos} correos nuevos y no había nada para sumar al historial.`
    }
    return resultado.errores > 0
      ? "No pudimos leer los correos nuevos. Probá de nuevo en un rato."
      : "No llegó nada nuevo a la etiqueta. Ya estabas al día."
  }

  const partes: string[] = []
  if (resultado.documentos > 0) {
    partes.push(resultado.documentos === 1 ? "1 estudio" : `${resultado.documentos} estudios`)
  }
  if (resultado.turnos > 0) {
    partes.push(resultado.turnos === 1 ? "1 turno" : `${resultado.turnos} turnos`)
  }

  const encabezado =
    paraRevisar === 1 ? "1 correo nuevo" : `${paraRevisar} correos nuevos`
  const detalle = partes.join(" y ")
  const cola = resultado.hayMas ? " Todavía quedan más: tocá otra vez para seguir." : ""

  return `${encabezado}: ${detalle} para revisar.${cola}`
}
