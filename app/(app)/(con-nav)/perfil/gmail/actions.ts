"use server"

/**
 * Server Action de DESCONEXIÓN de la casilla de Gmail (Sprint 17, tarea 17.1).
 *
 * Conectar es un Route Handler porque termina en una navegación a otro
 * dominio; desconectar no sale de la aplicación, así que es una Server Action
 * como el resto de las operaciones del proyecto: autenticación por cookie sin
 * escribir un handler, tipos de punta a punta y ninguna URL nueva que
 * proteger.
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

import { revalidatePath } from "next/cache"

import { esErrorDeGuarda, requerirSesion } from "@/lib/auth/guardas"
import type { EstadoGmailAccion } from "@/lib/gmail/conexion"
import {
  borrarConexionGmail,
  leerRefreshTokenGmail,
  olvidarAccessTokenGmail,
} from "@/lib/gmail/conexiones-admin"
import { revocarToken } from "@/lib/gmail/google-api"

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
