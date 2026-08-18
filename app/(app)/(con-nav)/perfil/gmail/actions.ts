"use server"

/**
 * Server Actions de la pantalla de Gmail: desconectar (Sprint 17, tarea 17.1)
 * y toda la bandeja "Llegaron por Gmail" (tarea 17.2).
 *
 * Conectar es un Route Handler porque termina en una navegación a otro
 * dominio; el resto no sale de la aplicación, así que son Server Actions
 * como el resto de las operaciones del proyecto: autenticación por cookie sin
 * escribir un handler, tipos de punta a punta y ninguna URL nueva que
 * proteger.
 *
 * ## Las seis acciones de la 17.2 y su guarda
 *
 * | Acción | Qué exige |
 * |---|---|
 * | `buscarCorreosAhora` | Sesión. La casilla es de la cuenta. |
 * | `ingerirAdjuntoDeCorreo` | Sesión **+ `upload` sobre el perfil ACTIVO**: crea un documento en su historial. |
 * | `descartarCorreo` / `reabrirCorreo` | Sesión. Solo tocan el registro propio. |
 * | `aprenderRemitente` / `sacarFiltroAprendido` | Sesión. Tocan la configuración de la casilla propia. |
 *
 * Ninguna recibe un `userId` ni un `perfilId` del formulario: la cuenta sale
 * de `requerirSesion()` y el perfil de `obtenerPerfilActivo()`. Lo único que
 * viaja en el `FormData` es QUÉ correo o QUÉ filtro, y las funciones de
 * `lib/gmail/mensajes-admin.ts` acotan cada escritura con
 * `.eq("user_id", …)` además del id — un id de otra cuenta no afecta ninguna
 * fila.
 *
 * ## Los dos pasos, y por qué el segundo se hace igual si falla el primero
 *
 * 1. **Revocar contra Google.** Es lo que de verdad apaga el permiso: borrar
 *    la fila local dejaría el token vivo del lado de Google hasta que la
 *    persona lo saque a mano de su cuenta.
 * 2. **Borrar la fila y el secreto del Vault** (`borrar_conexion_gmail`).
 *
 * Si el paso 1 falla -Google caído, o el token ya revocado desde la propia
 * cuenta de Google, que devuelve `400`-, el paso 2 se hace igual. Dejar la
 * conexión puesta "por las dudas" le mostraría a la persona una casilla
 * conectada que ella ya pidió cortar, y le ocultaría que el permiso sigue
 * listado en su cuenta de Google. La pantalla se lo dice con todas las letras
 * en ese caso, con el enlace para sacarlo desde ahí.
 */

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { esErrorDeGuarda, requerirPermiso, requerirSesion } from "@/lib/auth/guardas"
import type {
  EstadoAutoCargaGmail,
  EstadoBusquedaGmail,
  EstadoCorreoGmail,
} from "@/lib/gmail/acciones"
import { configurarAutoIngesta, revertirCargaAutomatica } from "@/lib/gmail/auto-ingesta-admin"
import { ingerirAdjuntoDeGmail, ErrorAdjuntoGmail } from "@/lib/gmail/adjunto"
import { barrerConexion, fraseDeResultado } from "@/lib/gmail/barrido"
import type { EstadoGmailAccion } from "@/lib/gmail/conexion"
import { obtenerConexionGmail } from "@/lib/gmail/conexion"
import {
  borrarConexionGmail,
  ErrorConexionGmailVencida,
  ErrorGmailSinConfigurar,
  ErrorSinConexionGmail,
  leerRefreshTokenGmail,
  olvidarAccessTokenGmail,
} from "@/lib/gmail/conexiones-admin"
import { aprenderRemitente as aprenderRemitenteEnGmail, olvidarFiltro } from "@/lib/gmail/filtros"
import { ErrorGmail, revocarToken } from "@/lib/gmail/google-api"
import { contarCorreosPendientes } from "@/lib/gmail/mensajes"
import {
  devolverMensajeAPendiente,
  marcarMensajeResuelto,
  obtenerMensajeRegistrado,
} from "@/lib/gmail/mensajes-admin"
import { ErrorIngesta, formatearFechaDuplicado } from "@/lib/documentos/ingesta"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

// `EstadoGmailAccion` y `ESTADO_GMAIL_INICIAL` viven en `lib/gmail/conexion.ts`
// y NO acá: un archivo `"use server"` solo puede exportar funciones asíncronas,
// y exportar el objeto de estado inicial desde acá rompe la acción EN TIEMPO DE
// EJECUCIÓN (`A "use server" file can only export async functions, found
// object`) sin que el build lo detecte. El porqué completo está en el comentario
// de ese archivo.

/**
 * Sin parámetros a propósito. `useActionState` la invoca con
 * `(estadoPrevio, formData)` y JavaScript ignora los argumentos de más, así
 * que declararlos solo para no usarlos sería ruido: desconectar no depende ni
 * del estado anterior ni de ningún campo del formulario — la única entrada que
 * necesita es de quién es la sesión, y eso lo resuelve `requerirSesion`.
 */
export async function desconectarGmail(): Promise<EstadoGmailAccion> {
  let usuarioId: string
  try {
    const { usuario } = await requerirSesion({ siNoHaySesion: "lanzar" })
    usuarioId = usuario.id
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message, mensaje: null, revocacionPendiente: false }
    }
    throw error
  }

  let revocado = false
  try {
    const refreshToken = await leerRefreshTokenGmail(usuarioId)
    if (refreshToken) {
      revocado = await revocarToken(refreshToken)
    } else {
      // No hay token que revocar: o nunca conectó, o el secreto ya no está.
      // La desconexión se completa igual (es idempotente) y no hay nada
      // pendiente del lado de Google.
      revocado = true
    }
  } catch (error) {
    console.error(
      "[gmail] no se pudo leer el token para revocarlo:",
      error instanceof Error ? error.message : error,
    )
  }

  try {
    await borrarConexionGmail(usuarioId)
  } catch (error) {
    console.error(
      "[gmail] no se pudo borrar la conexión:",
      error instanceof Error ? error.message : error,
    )
    return {
      error: "No pudimos desconectar tu Gmail. Probá de nuevo en un rato.",
      mensaje: null,
      revocacionPendiente: false,
    }
  }

  olvidarAccessTokenGmail(usuarioId)
  revalidatePath("/perfil/gmail")

  return {
    error: null,
    mensaje: "Desconectamos tu Gmail. La app ya no puede leer ningún correo tuyo.",
    revocacionPendiente: !revocado,
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  TAREA 17.2 — la bandeja "Llegaron por Gmail"
 * ═══════════════════════════════════════════════════════════════════════════ */

const SIN_CONEXION = "Todavía no conectaste tu Gmail."
const SIN_ETIQUETA =
  "No pudimos encontrar la etiqueta en tu Gmail. Tocá «Volver a conectar» y probamos de nuevo."
const VENCIDA = "Se venció el permiso para leer tu Gmail. Volvé a conectarlo cuando quieras."
const SIN_CONFIGURAR = "La conexión con Gmail todavía no está configurada en este servidor."
const ERROR_BUSQUEDA = "No pudimos revisar tu Gmail ahora mismo. Probá de nuevo en un rato."
const SIN_CORREO = "No encontramos ese correo."
const SIN_PERFIL_ACTIVO =
  "No hay un perfil activo. Elegí a quién le estás sumando el estudio y probá de nuevo."

/** Un id de fila del registro que llegó por `FormData`. */
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function idDelFormulario(formData: FormData, campo: string): string | null {
  const valor = formData.get(campo)
  return typeof valor === "string" && PATRON_UUID.test(valor) ? valor : null
}

/**
 * Traduce los errores del circuito de Gmail a una frase mostrable. Ninguna de
 * las acciones de abajo le muestra a la persona un mensaje técnico, y ninguna
 * loguea contenido de correo -a lo sumo, ids-.
 */
function mensajeDeError(error: unknown, porDefecto: string): string {
  if (error instanceof ErrorSinConexionGmail) return SIN_CONEXION
  if (error instanceof ErrorConexionGmailVencida) return VENCIDA
  if (error instanceof ErrorGmailSinConfigurar) return SIN_CONFIGURAR
  if (error instanceof ErrorGmail) return error.message
  if (error instanceof ErrorAdjuntoGmail) return error.message
  if (error instanceof ErrorIngesta) return error.message
  if (esErrorDeGuarda(error)) return error.message
  return porDefecto
}

/**
 * "Buscar ahora": una pasada del barrido sobre la casilla de quien toca el
 * botón.
 *
 * Es la MISMA `barrerConexion` que corre el cron —no una versión "manual"—,
 * así que lo que la persona ve al tocar el botón es exactamente lo que va a
 * pasar solo cada media hora. Devuelve la frase de `fraseDeResultado` y el
 * total de pendientes, para que la pantalla no tenga que adivinar si vale la
 * pena mirar la lista.
 */
export async function buscarCorreosAhora(): Promise<EstadoBusquedaGmail> {
  try {
    const { usuario, supabase } = await requerirSesion({ siNoHaySesion: "lanzar" })

    const conexion = await obtenerConexionGmail(supabase, usuario.id)
    if (!conexion) {
      return { error: SIN_CONEXION, mensaje: null, pendientes: 0 }
    }
    if (conexion.estado === "vencida") {
      return { error: VENCIDA, mensaje: null, pendientes: 0 }
    }
    if (!conexion.labelId) {
      return { error: SIN_ETIQUETA, mensaje: null, pendientes: 0 }
    }

    const resultado = await barrerConexion({
      userId: usuario.id,
      email: conexion.email,
      labelId: conexion.labelId,
    })

    const pendientes = await contarCorreosPendientes(supabase)

    revalidatePath("/perfil/gmail")
    revalidatePath("/inicio")

    return {
      error: resultado.vencida && resultado.nuevos === 0 ? VENCIDA : null,
      mensaje: fraseDeResultado(resultado),
      pendientes,
    }
  } catch (error) {
    console.error(
      "[gmail] falló la búsqueda manual:",
      error instanceof Error ? error.message : error,
    )
    return { error: mensajeDeError(error, ERROR_BUSQUEDA), mensaje: null, pendientes: 0 }
  }
}

/**
 * "Revisar este estudio": baja el adjunto, lo mete por el pipeline de siempre
 * y **redirige a la pantalla de revisión existente**.
 *
 * El documento se crea sobre el PERFIL ACTIVO y exige `upload` sobre él: es
 * una carga en el historial de esa persona, con el mismo permiso que exige
 * subir una foto a mano. El perfil sale de la cookie, nunca del formulario
 * (mismo criterio que `subirDocumento`).
 *
 * El `redirect` va FUERA del `try/catch`: funciona lanzando `NEXT_REDIRECT` y
 * un `catch` que se lo trague deja la navegación colgada.
 *
 * ## Duplicado (hotfix de huella digital, Sprint 17 en vivo)
 *
 * Si `ingerirAdjuntoDeGmail` encuentra un documento idéntico ya cargado en el
 * perfil, esta acción NO redirige: devuelve `duplicado` con `correoId` y
 * `adjuntoId` incluidos (la bandeja los necesita para armar el botón "Cargar
 * igual", que reenvía este mismo formulario con `forzar=1`). El campo oculto
 * `forzar` viaja SIEMPRE en `0`/ausente salvo en ese reintento.
 */
export async function ingerirAdjuntoDeCorreo(
  _estadoPrevio: EstadoCorreoGmail,
  formData: FormData,
): Promise<EstadoCorreoGmail> {
  const correoId = idDelFormulario(formData, "correoId")
  const adjuntoId = formData.get("adjuntoId")
  const forzar = formData.get("forzar") === "1"

  if (!correoId || typeof adjuntoId !== "string" || adjuntoId.length === 0) {
    return { error: SIN_CORREO, mensaje: null, duplicado: null }
  }

  let documentoId: string

  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO, mensaje: null, duplicado: null }
    }

    const { supabase, usuario } = await requerirPermiso(activo.perfil.id, "upload", {
      siNoHaySesion: "lanzar",
    })

    const resultado = await ingerirAdjuntoDeGmail({
      supabase,
      userId: usuario.id,
      perfilId: activo.perfil.id,
      correoId,
      adjuntoId,
      forzar,
    })

    if (resultado.duplicado) {
      return {
        error: null,
        mensaje: null,
        duplicado: {
          correoId,
          adjuntoId,
          documentoId: resultado.existente.documentoId,
          titulo: resultado.existente.titulo,
          fechaTexto: formatearFechaDuplicado(resultado.existente.fecha),
        },
      }
    }

    documentoId = resultado.documento.documentoId
  } catch (error) {
    console.error(
      `[gmail] no se pudo ingerir el adjunto del correo ${correoId}:`,
      error instanceof Error ? error.message : error,
    )
    return {
      error: mensajeDeError(error, "No pudimos traer ese archivo. Probá de nuevo en un rato."),
      mensaje: null,
      duplicado: null,
    }
  }

  revalidatePath("/estudios")
  revalidatePath("/perfil/gmail")
  revalidatePath("/inicio")

  // La misma pantalla de siempre: la que ve quien acaba de sacarle una foto a
  // un estudio. Ahí corre la lectura con IA y ahí se confirma o se descarta.
  redirect(`/estudios/nuevo/procesando?doc=${documentoId}`)
}

/** "Esto no me sirve": saca el correo de la bandeja sin tocar Gmail. */
export async function descartarCorreo(
  _estadoPrevio: EstadoCorreoGmail,
  formData: FormData,
): Promise<EstadoCorreoGmail> {
  const correoId = idDelFormulario(formData, "correoId")
  if (!correoId) return { error: SIN_CORREO, mensaje: null }

  try {
    const { usuario } = await requerirSesion({ siNoHaySesion: "lanzar" })
    await marcarMensajeResuelto(usuario.id, correoId, { estado: "descartado" })
  } catch (error) {
    console.error(
      `[gmail] no se pudo descartar el correo ${correoId}:`,
      error instanceof Error ? error.message : error,
    )
    return { error: mensajeDeError(error, "No pudimos descartar ese correo."), mensaje: null }
  }

  revalidatePath("/perfil/gmail")
  revalidatePath("/inicio")

  return {
    error: null,
    // Se aclara que el correo sigue en Gmail: la app no borra correos, y quien
    // toca "descartar" tiene que saber que descarta el AVISO, no el mensaje.
    mensaje: "Listo, lo sacamos de la lista. El correo sigue en tu Gmail como siempre.",
  }
}

/**
 * "Volver a la lista": devuelve a pendientes un correo ya resuelto.
 *
 * El caso real: la persona tocó "Revisar", llegó a la pantalla de revisión del
 * documento y ahí lo descartó. El documento se borró -y con él el puntero, por
 * el `ON DELETE SET NULL`-, así que sin esto el adjunto quedaría fuera del
 * alcance de la app para siempre aunque siga en su casilla.
 */
export async function reabrirCorreo(
  _estadoPrevio: EstadoCorreoGmail,
  formData: FormData,
): Promise<EstadoCorreoGmail> {
  const correoId = idDelFormulario(formData, "correoId")
  if (!correoId) return { error: SIN_CORREO, mensaje: null }

  try {
    const { usuario } = await requerirSesion({ siNoHaySesion: "lanzar" })
    await devolverMensajeAPendiente(usuario.id, correoId)
  } catch (error) {
    console.error(
      `[gmail] no se pudo reabrir el correo ${correoId}:`,
      error instanceof Error ? error.message : error,
    )
    return { error: mensajeDeError(error, "No pudimos volver a abrir ese correo."), mensaje: null }
  }

  revalidatePath("/perfil/gmail")
  revalidatePath("/inicio")

  return { error: null, mensaje: "Lo devolvimos a la lista de correos por revisar." }
}

/**
 * "Que los próximos de este remitente vengan solos": crea el filtro en Gmail.
 *
 * El remitente NO viene del formulario: viene de la fila del correo que la
 * persona está mirando (`obtenerMensajeRegistrado`, acotado a su cuenta). Así,
 * lo único que el cliente puede elegir es CUÁL de sus propios correos usar
 * como ejemplo — no puede pedir un filtro para una dirección arbitraria.
 */
export async function aprenderRemitente(
  _estadoPrevio: EstadoCorreoGmail,
  formData: FormData,
): Promise<EstadoCorreoGmail> {
  const correoId = idDelFormulario(formData, "correoId")
  if (!correoId) return { error: SIN_CORREO, mensaje: null }

  try {
    const { usuario, supabase } = await requerirSesion({ siNoHaySesion: "lanzar" })

    const conexion = await obtenerConexionGmail(supabase, usuario.id)
    if (!conexion) return { error: SIN_CONEXION, mensaje: null }
    if (conexion.estado === "vencida") return { error: VENCIDA, mensaje: null }
    if (!conexion.labelId) return { error: SIN_ETIQUETA, mensaje: null }

    const correo = await obtenerMensajeRegistrado(usuario.id, correoId)
    if (!correo) return { error: SIN_CORREO, mensaje: null }

    const { remitente, yaExistia } = await aprenderRemitenteEnGmail({
      userId: usuario.id,
      remitente: correo.remitenteEmail,
      labelId: conexion.labelId,
      labelName: conexion.labelName,
    })

    revalidatePath("/perfil/gmail")

    return {
      error: null,
      mensaje: yaExistia
        ? `Ya tenías puesto que los correos de ${remitente} vayan a la etiqueta.`
        : `Listo: los próximos correos de ${remitente} van a entrar solos a la etiqueta.`,
    }
  } catch (error) {
    console.error(
      `[gmail] no se pudo crear el filtro del correo ${correoId}:`,
      error instanceof Error ? error.message : error,
    )
    return {
      error: mensajeDeError(error, "No pudimos crear la regla en tu Gmail. Probá de nuevo."),
      mensaje: null,
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  CARGA AUTOMÁTICA (Sprint 17) — el interruptor y el Deshacer
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * "Carga automática: solo cuando la IA no tiene ninguna duda."
 *
 * El interruptor y el selector de perfil viajan en el MISMO formulario, así que
 * esta única acción resuelve los tres casos: prender con un destino, cambiar el
 * destino, y apagar.
 *
 * ## La guarda no está acá, y es a propósito
 *
 * Esta acción verifica la SESIÓN (de quién es la casilla) y nada más. Que el
 * perfil elegido sea uno que la cuenta administra lo decide
 * `configurar_auto_ingesta_gmail` **en la base**, con
 * `cuenta_administra_perfil`. Comprobarlo también acá sería tener dos
 * definiciones de la misma autorización que pueden separarse con el tiempo —y
 * la de acá sería la fácil de olvidar—. El mensaje de rechazo de la RPC ya
 * viene en castellano y mostrable.
 */
export async function guardarAutoCargaGmail(
  _estadoPrevio: EstadoAutoCargaGmail,
  formData: FormData,
): Promise<EstadoAutoCargaGmail> {
  const activar = formData.get("activar") === "1"
  const perfilId = idDelFormulario(formData, "perfilId")

  if (activar && !perfilId) {
    return {
      error: "Elegí a quién le vamos a sumar los estudios antes de prender la carga automática.",
      mensaje: null,
    }
  }

  try {
    const { usuario } = await requerirSesion({ siNoHaySesion: "lanzar" })
    await configurarAutoIngesta({ userId: usuario.id, activar, perfilId })
  } catch (error) {
    console.error(
      "[gmail] no se pudo configurar la carga automática:",
      error instanceof Error ? error.message : error,
    )
    return {
      error: mensajeDeError(
        error,
        "No pudimos guardar esa preferencia. Probá de nuevo en un rato.",
      ),
      mensaje: null,
    }
  }

  revalidatePath("/perfil/gmail")
  revalidatePath("/inicio")

  return {
    error: null,
    mensaje: activar
      ? "Listo. Los correos que se lean sin ninguna duda van a entrar solos, y los vas a ver acá abajo."
      : "Apagamos la carga automática. Todo vuelve a esperar tu revisión.",
  }
}

/**
 * "Deshacer": saca del historial algo que entró SOLO y devuelve el correo a la
 * lista de pendientes.
 *
 * ## Los dos pasos, y por qué el primero va con la sesión de la persona
 *
 * 1. **Borrar el documento (o el turno) con el cliente del USUARIO.** Pasa por
 *    `documents_delete_administrador` / `appointments_delete_administrador`,
 *    las políticas de siempre: si por lo que sea la cuenta ya no administra ese
 *    perfil, el borrado no afecta ninguna fila y esta acción lo dice en vez de
 *    fingir que salió. Borrar con `service_role` habría sido más simple y
 *    habría convertido esas políticas en decoración. El `DELETE` dispara además
 *    el trigger `documents_encolar_purga_storage`, así que el archivo entra en
 *    la cola de purga como en cualquier otro borrado.
 * 2. **Devolver el correo a pendientes**, con `service_role`
 *    (`revertirCargaAutomatica`), que es el único camino de escritura de
 *    `gmail_messages` desde que existe la 17.2.
 *
 * Si el paso 2 fallara después del 1, el estudio ya no está y el correo queda
 * marcado `ingresado` con el puntero en NULL por el `ON DELETE SET NULL` —que
 * es exactamente el estado que la bandeja ya sabe mostrar con "Volver a la
 * lista"—. Ningún orden deja algo peor que eso.
 */
export async function deshacerCargaAutomatica(
  _estadoPrevio: EstadoCorreoGmail,
  formData: FormData,
): Promise<EstadoCorreoGmail> {
  const correoId = idDelFormulario(formData, "correoId")
  const documentoId = idDelFormulario(formData, "documentoId")
  const turnoId = idDelFormulario(formData, "turnoId")

  if (!correoId) return { error: SIN_CORREO, mensaje: null }

  try {
    const { usuario, supabase } = await requerirSesion({ siNoHaySesion: "lanzar" })

    if (documentoId) {
      const { data: borrados, error } = await supabase
        .from("documents")
        .delete()
        .eq("id", documentoId)
        .select("id")

      if (error) throw error
      if (!borrados || borrados.length === 0) {
        return {
          error:
            "No pudimos sacar ese estudio: hace falta permiso de administración sobre ese perfil.",
          mensaje: null,
        }
      }
    } else if (turnoId) {
      const { data: borrados, error } = await supabase
        .from("appointments")
        .delete()
        .eq("id", turnoId)
        .select("id")

      if (error) throw error
      if (!borrados || borrados.length === 0) {
        return {
          error:
            "No pudimos sacar ese turno: hace falta permiso de administración sobre ese perfil.",
          mensaje: null,
        }
      }
    }

    await revertirCargaAutomatica(usuario.id, correoId)
  } catch (error) {
    console.error(
      `[gmail] no se pudo deshacer la carga automática del correo ${correoId}:`,
      error instanceof Error ? error.message : error,
    )
    return {
      error: mensajeDeError(error, "No pudimos deshacerlo. Probá de nuevo en un rato."),
      mensaje: null,
    }
  }

  revalidatePath("/perfil/gmail")
  revalidatePath("/estudios")
  revalidatePath("/turnos")
  revalidatePath("/inicio")

  return {
    error: null,
    mensaje: "Listo, lo sacamos del historial. El correo volvió a la lista para que decidas vos.",
  }
}

/** "Sacar esta regla": borra el filtro de Gmail y su fila. */
export async function sacarFiltroAprendido(
  _estadoPrevio: EstadoCorreoGmail,
  formData: FormData,
): Promise<EstadoCorreoGmail> {
  const filtroId = idDelFormulario(formData, "filtroId")
  if (!filtroId) return { error: "No encontramos esa regla.", mensaje: null }

  try {
    const { usuario } = await requerirSesion({ siNoHaySesion: "lanzar" })
    const sacado = await olvidarFiltro({ userId: usuario.id, filtroId })

    revalidatePath("/perfil/gmail")

    return sacado
      ? {
          error: null,
          mensaje: `Sacamos la regla: los correos de ${sacado.remitente} ya no se etiquetan solos.`,
        }
      : { error: "No encontramos esa regla.", mensaje: null }
  } catch (error) {
    console.error(
      `[gmail] no se pudo sacar el filtro ${filtroId}:`,
      error instanceof Error ? error.message : error,
    )
    return {
      error: mensajeDeError(error, "No pudimos sacar la regla de tu Gmail. Probá de nuevo."),
      mensaje: null,
    }
  }
}
