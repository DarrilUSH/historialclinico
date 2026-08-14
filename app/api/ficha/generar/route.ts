/**
 * `POST /api/ficha/generar` — genera la ficha de resumen para consulta del
 * perfil activo con Gemini (Sprint 10, tarea 10.3).
 *
 * ## Perfil: SIEMPRE el de la cookie, nunca el del cliente
 *
 * A diferencia de `app/api/documentos/extraer` (que recibe un `documentoId`
 * y resuelve el perfil dueño desde la fila), esta ruta no acepta ningún
 * `perfilId` en el cuerpo -no tiene cuerpo en absoluto-: el perfil es
 * siempre `obtenerPerfilActivo()` (`lib/perfil-activo.ts`), que ya lee la
 * cookie httpOnly `perfil_activo` y la revalida contra la base en cada
 * llamada. Aceptar un `perfilId` del cliente abriría la puerta a pedir la
 * ficha de un perfil ajeno con solo cambiar el body de la request -
 * exactamente lo que `docs/modelo-permisos.md` §1.6 prohíbe: "el servidor no
 * confía en el cliente".
 *
 * ## Por qué el verbo es `upload`, no `view` (docs/modelo-permisos.md)
 *
 * Generar la ficha dispara una llamada real a Gemini -consumo de cuota- y
 * PRODUCE un dato nuevo (aunque todavía no se persista: eso es la tarea
 * 10.5). Es el mismo criterio que ya aplica
 * `app/api/documentos/extraer/route.ts` a la extracción: un `can_view` puede
 * ABRIR lo que ya existe, pero no puede GATILLAR una operación que cuesta
 * cuota y genera contenido nuevo. `can_upload` (o `can_manage`, que lo
 * incluye) es el piso mínimo.
 *
 * Igual que en `app/api/signos/export/route.ts`: se obtiene el perfil activo
 * con `obtenerPerfilActivo()` (que ya exige `view`) y se REVALIDA con
 * `requerirPermiso(perfilId, "upload")` antes de gastar la llamada a Gemini.
 * Las dos verificaciones no son redundantes: la cookie puede pertenecer a un
 * perfil que el actor puede VER pero no CARGAR (un `can_view` puro, por
 * ejemplo Diego en `docs/modelo-permisos.md` §3.3), y ese caso tiene que
 * cortar acá, antes de gastar cuota, no después.
 *
 * ## El contexto nunca se loguea (ni en errores)
 *
 * `construirContextoClinico` arma el `ContextoClinico` en memoria
 * (`docs/minimizacion-datos.md` §6: es efímero, no se persiste ni se
 * cachea). Este Route Handler respeta la misma regla del lado del log: en
 * NINGÚN `console.error` de acá aparece `contexto`, ni siquiera
 * parcialmente. Los únicos textos que se logean son `error.message` de las
 * excepciones tipadas de `lib/gemini/client.ts` (sobre el ESTADO de la
 * llamada, nunca su contenido) y `FichaInvalidaError.errores`
 * (`lib/ficha/generar.ts`, sobre la ESTRUCTURA de la respuesta rechazada,
 * nunca el contenido recibido).
 *
 * ## Errores de Gemini: mismo criterio que `/api/documentos/extraer`
 *
 * `respuestaDeErrorGemini` traduce las excepciones tipadas de
 * `lib/gemini/client.ts` a mensajes en español, con el mismo mapeo de status
 * que la ruta de extracción (429 cuota, timeout, parse inválido, config no
 * disponible). Se agrega un caso nuevo: `FichaInvalidaError`
 * (`lib/ficha/generar.ts`), que ocurre cuando DOS respuestas seguidas de
 * Gemini no pasan `FichaGeneradaSchema` -ya se reintentó una vez adentro de
 * `generarFichaConsulta`, así que acá no hay una tercera oportunidad-.
 *
 * ## Auditoría: `exportar_ficha`, agregada en la tarea 10.4
 *
 * La tarea 10.3 (este archivo, en su forma original) no escribía en
 * `access_logs`: su criterio de aceptación no lo pedía. El criterio que SÍ lo
 * exige es el de la tarea 10.4 ("generar la ficha registra `exportar_ficha`
 * en `access_logs`", ROADMAP_SPRINTS.md línea 647), así que la llamada a
 * `registrarAcceso` se agrega acá, no en `lib/ficha/generar.ts` -ese módulo
 * no toca cookies ni auditoría, ver su propio encabezado-. Mismo criterio que
 * `ver_credencial` en `app/api/credenciales/[id]/url/route.ts`: se audita
 * DESPUÉS de generar con éxito, nunca un intento fallido ni un permiso
 * denegado, y es best-effort -`registrarAcceso` nunca lanza (cabecera de
 * `lib/auditoria.ts`), así que un fallo de auditoría no le esconde la ficha
 * recién generada a la persona.
 */

import { NextResponse } from "next/server"

import { ACCION, registrarAcceso } from "@/lib/auditoria"
import { type ErrorGuarda, esErrorDeGuarda, requerirPermiso } from "@/lib/auth/guardas"
import { construirContextoClinico } from "@/lib/ficha/contexto"
import { FichaInvalidaError, generarFichaConsulta } from "@/lib/ficha/generar"
import {
  GeminiApiError,
  GeminiConfigError,
  GeminiParseError,
  GeminiTimeoutError,
} from "@/lib/gemini/client"
import type { FichaGenerada } from "@/lib/gemini/schemas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export interface RespuestaFichaOk {
  ficha: FichaGenerada
}

export interface RespuestaFichaError {
  error: string
}

const MENSAJE_PERFIL_REQUERIDO = "No hay perfil activo. Elegí uno y probá de nuevo."
const MENSAJE_CUOTA =
  "El servicio de generación de fichas alcanzó su límite por hoy. Probá de nuevo más tarde."
const MENSAJE_TIMEOUT =
  "La generación de la ficha está tardando más de lo esperado. Probá de nuevo en un momento."
const MENSAJE_RESPUESTA_INVALIDA = "No pudimos generar la ficha correctamente. Probá de nuevo en unos minutos."
const MENSAJE_SERVICIO_NO_DISPONIBLE =
  "El servicio de generación de fichas no está disponible en este momento. Probá de nuevo más tarde."
const MENSAJE_GENERACION_FALLIDA = "No pudimos generar la ficha. Probá de nuevo en unos minutos."
const MENSAJE_INESPERADO =
  "Ocurrió un problema y no pudimos generar la ficha. Probá de nuevo en unos minutos."

function json(cuerpo: RespuestaFichaOk | RespuestaFichaError, status: number): Response {
  return NextResponse.json(cuerpo, {
    status,
    headers: { "Cache-Control": "private, no-cache" },
  })
}

/** Mapeo de estado HTTP para errores de guarda. Mismo patrón que `app/api/documentos/extraer/route.ts`. */
function estadoDeErrorGuarda(error: ErrorGuarda): number {
  switch (error.codigo) {
    case "sesion_requerida":
      return 401
    case "perfil_invalido":
      return 400
    case "permiso_denegado":
      return 403
    case "fallo_de_verificacion":
      return 503
  }
}

/**
 * Traduce las excepciones de `lib/gemini/client.ts` y `lib/ficha/generar.ts`
 * a `{ status, mensaje }`. Mismo criterio que
 * `app/api/documentos/extraer/route.ts#respuestaDeErrorGemini`: mensajes en
 * español, nunca sugieren pagar por más cuota (regla de costo cero del
 * proyecto).
 */
function respuestaDeErrorGemini(error: unknown): { status: number; mensaje: string } {
  if (error instanceof GeminiApiError && error.status === 429) {
    return { status: 429, mensaje: MENSAJE_CUOTA }
  }
  if (error instanceof GeminiTimeoutError) {
    console.error("[ficha] Timeout llamando a Gemini:", error.message)
    return { status: 504, mensaje: MENSAJE_TIMEOUT }
  }
  if (error instanceof GeminiParseError) {
    console.error("[ficha] Respuesta de Gemini no parseable:", error.message)
    return { status: 502, mensaje: MENSAJE_RESPUESTA_INVALIDA }
  }
  if (error instanceof GeminiConfigError) {
    // No es culpa de la persona ni transitorio: falta configuración del
    // servidor. El mensaje de este error nunca contiene la clave en sí.
    console.error("[ficha] Gemini mal configurado:", error.message)
    return { status: 500, mensaje: MENSAJE_SERVICIO_NO_DISPONIBLE }
  }
  if (error instanceof FichaInvalidaError) {
    // Dos intentos, dos respuestas que no pasaron FichaGeneradaSchema.
    // `error.errores` describe ESTRUCTURA ("falta la sección X", "el aviso
    // no menciona..."), nunca el contenido recibido de Gemini.
    console.error(
      "[ficha] La ficha no pasó la validación tras dos intentos:",
      error.errores.join(" | "),
    )
    return { status: 502, mensaje: MENSAJE_GENERACION_FALLIDA }
  }
  if (error instanceof GeminiApiError) {
    // Incluye "modelo inexistente" (GEMINI_MODEL_ID mal seteada): Gemini
    // responde 404/400 y `extraerJson` ya no reintenta un 4xx.
    console.error(`[ficha] Gemini devolvió un error HTTP ${error.status ?? "?"}:`, error.message)
    return { status: 502, mensaje: MENSAJE_GENERACION_FALLIDA }
  }
  console.error("[ficha] Error inesperado al generar la ficha:", error)
  return { status: 500, mensaje: MENSAJE_INESPERADO }
}

export async function POST(): Promise<Response> {
  try {
    // Perfil activo de la cookie httpOnly — nunca del cliente. Ya exige `view`.
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return json({ error: MENSAJE_PERFIL_REQUERIDO }, 403)
    }

    const perfilId = activo.perfil.id

    // Revalida con `upload`: generar la ficha gasta cuota y produce un dato
    // nuevo — ver el encabezado de este archivo.
    const { supabase } = await requerirPermiso(perfilId, "upload", {
      siNoHaySesion: "lanzar",
    })

    // Contexto clínico ya minimizado (Sprint 10, tarea 10.2). Efímero: no se
    // persiste, no se cachea, no se loguea.
    const contexto = await construirContextoClinico(supabase, perfilId)

    let ficha: FichaGenerada
    try {
      ficha = await generarFichaConsulta(contexto)
    } catch (error) {
      const { status, mensaje } = respuestaDeErrorGemini(error)
      return json({ error: mensaje }, status)
    }

    // Persistencia (Sprint 10, tarea 10.5): inserta en consultation_sheets.
    // Best-effort — un fallo de INSERT NO detiene la generación. El cliente
    // la recibe igual; si falla, queda el log.
    const fichaPeristidaOFallo = await supabase
      .from("consultation_sheets")
      .insert({
        profile_id: perfilId,
        generated_by_profile_id: perfilId,
        content: ficha,
      })
      .select("id")
      .single()

    if (!fichaPeristidaOFallo.error) {
      console.log(`[ficha] Ficha persistida: ${fichaPeristidaOFallo.data?.id}`)
    } else {
      console.error(
        "[ficha] Fallo al persistir la ficha (best-effort, continúa):",
        fichaPeristidaOFallo.error.message,
      )
    }

    // Auditoría (Sprint 10, tarea 10.4): ver el encabezado del archivo.
    await registrarAcceso({
      perfilId,
      accion: ACCION.exportar_ficha,
      recursoTipo: "ficha",
    })

    return json({ ficha }, 200)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return json({ error: error.message }, estadoDeErrorGuarda(error))
    }
    console.error("[ficha] Fallo inesperado en el Route Handler de generación:", error)
    return json({ error: MENSAJE_INESPERADO }, 500)
  }
}
