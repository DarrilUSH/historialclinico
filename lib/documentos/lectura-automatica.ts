/**
 * Contrato de `/api/documentos/extraer`, compartido por las dos puntas.
 *
 * Isomórfico a propósito -sin `server-only`, sin claves, sin dependencias de
 * Node-: lo importan el Route Handler (`app/api/documentos/extraer/route.ts`) y
 * el Client Component que lo consulta
 * (`app/(app)/(con-nav)/estudios/nuevo/procesando/pantalla-procesando.tsx`).
 * Mismo reparto que `lib/documentos/compartir-temporal.ts` (isomórfico) frente
 * a `lib/documentos/compartir-temporal-admin.ts` (servidor).
 *
 * ## Por qué el estado viaja en el CUERPO y no en el status HTTP
 *
 * Este es el corazón del arreglo del 19/08/2026 ("se bloquea el celular y se
 * corta y larga error"). Antes, la pantalla deducía el desenlace de la
 * extracción del resultado del `fetch`: si el `fetch` fallaba -y un `fetch`
 * falla, sin más, cuando Android congela la pestaña- eso se leía como "la
 * lectura falló", cuando en realidad el servidor la estaba terminando bien.
 *
 * Ahora las dos cosas están separadas: el ÉXITO DE LA REQUEST lo dice el
 * status HTTP (y sólo puede fallar por sesión, permiso o red), y el ESTADO DE
 * LA LECTURA lo dice `estado` dentro del cuerpo, que sale de la base. Un
 * `fetch` muerto ya no significa nada sobre la lectura: se vuelve a preguntar
 * y listo.
 */

import type { DuplicadoSemanticoParaCliente } from "@/lib/documentos/duplicados-semanticos"
import type { DocumentoMedicoExtraido } from "@/lib/gemini/schemas"

/**
 * En qué anda la lectura automática, tal como la ve el cliente.
 *
 * - `procesando`: hay una corrida en curso (ésta u otra). Hay que volver a
 *   preguntar.
 * - `listo`: `extraccion` trae el resultado.
 * - `error`: la lectura falló DE VERDAD (cuota, timeout de Gemini, formato no
 *   soportado). `error` trae el mensaje en español y corresponde ofrecer la
 *   carga a mano.
 *
 * `pendiente` -el cuarto valor de `documents.ai_extraction_status`- no aparece
 * acá: el `GET` lo traduce a `procesando` en cuanto el `POST` la dispara, y
 * un `POST` siempre deja el documento en uno de estos tres.
 */
export type EstadoLecturaCliente = "pendiente" | "procesando" | "listo" | "error"

export interface RespuestaLectura {
  estado: EstadoLecturaCliente
  /** Presente sólo con `estado === "listo"`. */
  extraccion: DocumentoMedicoExtraido | null
  /** Duplicado semántico cotejado junto con la extracción (Capas 2/3), o `null`. */
  duplicadoSemantico: DuplicadoSemanticoParaCliente | null
  /** Mensaje en español, listo para mostrar, sólo con `estado === "error"`. */
  error: string | null
}

/** Cuerpo de una respuesta que NO pudo ni mirar la lectura (sesión, permiso, documento inexistente). */
export interface RespuestaLecturaFallida {
  error: string
}

/** Nombre del parámetro de query del `GET` (el `POST` manda `documentoId` en el JSON). */
export const PARAM_DOCUMENTO = "doc"

/**
 * Cada cuánto vuelve a preguntar la pantalla mientras la lectura está en
 * curso. Dos segundos y medio: lo bastante seguido para que terminar se sienta
 * inmediato, lo bastante espaciado para que una lectura larga (el peor caso de
 * Gemini ronda los 94 s, ver `lib/gemini/client.ts`) no dispare cientos de
 * consultas. El navegador además ralentiza los timers de una pestaña en
 * segundo plano, así que mientras el teléfono está bloqueado esto consulta
 * mucho menos todavía.
 */
export const INTERVALO_CONSULTA_MS = 2_500

/**
 * Cuánto espera la pantalla antes de rendirse y ofrecer la carga a mano.
 *
 * Tiene que ser mayor que `maxDuration` del Route Handler (120 s) más el
 * margen de arranque de la función: si fuera menor, la pantalla se rendiría
 * mientras la lectura todavía puede terminar. Si se agota, no se pierde nada:
 * el archivo ya está guardado y el formulario permite cargar los datos a mano
 * -la regla de oro del roadmap-.
 */
export const ESPERA_MAXIMA_MS = 150_000
