/**
 * `GET /api/gmail/callback` — la vuelta desde la pantalla de consentimiento de
 * Google (Sprint 17, tarea 17.1).
 *
 * **Esta ruta no se puede renombrar.** Está registrada, con esta cadena exacta,
 * en el cliente OAuth del proyecto Google `gen-lang-client-0873820464`
 * (`https://www.historialmedico.com.ar/api/gmail/callback` y
 * `http://localhost:3000/api/gmail/callback`). Cambiarla acá sin cambiarla en
 * la consola de Google produce `redirect_uri_mismatch` y ninguna otra pista.
 *
 * ## El orden de las comprobaciones importa
 *
 * 1. **¿La persona canceló?** Google vuelve con `error=access_denied`. No es
 *    un fallo: es una respuesta legítima y se trata como tal, sin logs de
 *    error y sin stack traces.
 * 2. **¿Hay sesión?** Sin ella no hay cuenta a la que atar la casilla.
 * 3. **¿El `state` valida?** Firma, vencimiento y nonce
 *    (`lib/gmail/estado-oauth.ts`). Un `state` que no matchea se rechaza acá,
 *    ANTES de gastar el `code` contra Google.
 * 4. **¿El `state` es de ESTA cuenta?** Aunque la firma valide, el sobre
 *    podría ser de otra sesión: se coteja contra `auth.getUser()`. Es la
 *    última puerta del login CSRF.
 *
 * Recién después se intercambia el `code`. El `client_secret` va en ese POST
 * de servidor a servidor y jamás toca el navegador.
 *
 * ## La cookie del `state` se borra SIEMPRE
 *
 * En las once salidas de este archivo, incluida la de éxito. Un sobre que
 * sobrevive a su intento es un sobre reutilizable.
 *
 * ## Si la etiqueta falla, la conexión se guarda igual
 *
 * Deliberado. El `refresh_token` es lo caro de conseguir -exige que la persona
 * vuelva a pasar por la pantalla de Google-; la etiqueta es un `POST` que se
 * puede reintentar tocando "Conectar" de nuevo, porque conectar es idempotente.
 * Tirar la conexión entera porque `labels.create` contestó 503 sería cobrarle a
 * la persona el error más caro por el problema más barato. La pantalla muestra
 * el estado real: conectada, etiqueta pendiente.
 */

import { NextResponse } from "next/server"

import { requerirSesion } from "@/lib/auth/guardas"
import { rutaDeLoginCon } from "@/lib/auth/rutas"
import type { ResultadoConexion } from "@/lib/gmail/conexion"
import { guardarConexionGmail } from "@/lib/gmail/conexiones-admin"
import { obtenerCredencialesGoogle } from "@/lib/gmail/credenciales"
import { COOKIE_ESTADO_GMAIL, verificarEstadoOauth } from "@/lib/gmail/estado-oauth"
import {
  asegurarEtiqueta,
  ErrorGmail,
  intercambiarCodigo,
  NOMBRE_ETIQUETA,
  obtenerCorreoConectado,
} from "@/lib/gmail/google-api"

/** `node:crypto` para verificar la firma del `state`, y `fetch` a Google: Node, no Edge. */
export const runtime = "nodejs"

const RUTA_PANTALLA_GMAIL = "/perfil/gmail"

/**
 * Vuelve a la pantalla de configuración con el motivo, borrando la cookie del
 * intento. El `path` del borrado tiene que ser el MISMO con el que se escribió
 * (`/api/gmail`): con otro, el navegador crea una cookie vacía distinta y deja
 * la original viva.
 */
function volverA(request: Request, resultado: ResultadoConexion): NextResponse {
  const destino = new URL(RUTA_PANTALLA_GMAIL, request.url)
  destino.searchParams.set("resultado", resultado)
  const respuesta = NextResponse.redirect(destino, 303)
  respuesta.cookies.set(COOKIE_ESTADO_GMAIL, "", { path: "/api/gmail", maxAge: 0 })
  respuesta.headers.set("Cache-Control", "no-store")
  return respuesta
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const errorDeGoogle = url.searchParams.get("error")

  // 1. La persona tocó "Cancelar" en la pantalla de Google.
  if (errorDeGoogle) {
    if (errorDeGoogle === "access_denied") {
      return volverA(request, "cancelada")
    }
    console.error("[gmail/callback] Google devolvió un error:", errorDeGoogle)
    return volverA(request, "fallo_google")
  }

  // 2. Sesión. Sin ella no hay cuenta a la que atar la casilla.
  const { usuario } = await requerirSesion({
    siNoHaySesion: "lanzar",
    desde: RUTA_PANTALLA_GMAIL,
  }).catch(() => ({ usuario: null }))

  if (!usuario) {
    const respuesta = NextResponse.redirect(
      new URL(rutaDeLoginCon(RUTA_PANTALLA_GMAIL), request.url),
      303,
    )
    respuesta.cookies.set(COOKIE_ESTADO_GMAIL, "", { path: "/api/gmail", maxAge: 0 })
    respuesta.headers.set("Cache-Control", "no-store")
    return respuesta
  }

  const credenciales = obtenerCredencialesGoogle()
  if (!credenciales) {
    return volverA(request, "sin_configurar")
  }

  // 3. El `state`: firma, vencimiento y nonce.
  const sobre = request.headers
    .get("cookie")
    ?.split(";")
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith(`${COOKIE_ESTADO_GMAIL}=`))
    ?.slice(COOKIE_ESTADO_GMAIL.length + 1)

  const estado = verificarEstadoOauth({
    cookie: sobre ? decodeURIComponent(sobre) : null,
    nonceRecibido: url.searchParams.get("state"),
    secreto: credenciales.clientSecret,
  })

  if (!estado.valido) {
    console.error("[gmail/callback] state rechazado:", estado.motivo)
    return volverA(request, "estado_invalido")
  }

  // 4. Y que ese `state` sea de ESTA cuenta. La firma prueba que el sobre lo
  //    hicimos nosotros; esto prueba que lo hicimos para quien está adelante.
  if (estado.userId !== usuario.id) {
    console.error("[gmail/callback] el state pertenece a otra cuenta")
    return volverA(request, "estado_invalido")
  }

  const code = url.searchParams.get("code")
  if (!code) {
    return volverA(request, "fallo_google")
  }

  try {
    const tokens = await intercambiarCodigo({
      code,
      clientId: credenciales.clientId,
      clientSecret: credenciales.clientSecret,
      redirectUri: estado.redirectUri,
    })

    // Sin refresh token la conexión duraría una hora y después se rompería sin
    // explicación. Se falla acá, ruidosamente, en vez de guardar algo que no
    // sirve. No debería ocurrir: `urlDeConsentimiento` manda
    // `access_type=offline` + `prompt=consent`.
    if (!tokens.refreshToken) {
      console.error("[gmail/callback] Google no devolvió refresh_token")
      return volverA(request, "sin_refresh_token")
    }

    const email = await obtenerCorreoConectado(tokens.accessToken)

    // La etiqueta: si falla, la conexión se guarda igual (ver el encabezado).
    let labelId: string | null = null
    let labelName = NOMBRE_ETIQUETA
    try {
      const etiqueta = await asegurarEtiqueta(tokens.accessToken)
      labelId = etiqueta.id
      labelName = etiqueta.nombre
    } catch (error) {
      console.error(
        "[gmail/callback] no se pudo asegurar la etiqueta:",
        error instanceof ErrorGmail ? error.detalle ?? error.message : error,
      )
    }

    await guardarConexionGmail({
      userId: usuario.id,
      email,
      refreshToken: tokens.refreshToken,
      labelId,
      labelName,
      scopes: tokens.scopes,
    })

    return volverA(request, "conectada")
  } catch (error) {
    // `ErrorGmail.detalle` trae el código de Google, nunca el token: los
    // cuerpos de `lib/gmail/google-api.ts` se recortan y solo se guarda el
    // `error`/`error_description`.
    console.error(
      "[gmail/callback] falló la conexión:",
      error instanceof ErrorGmail ? `${error.codigo} — ${error.detalle ?? error.message}` : error,
    )
    return volverA(request, "fallo_google")
  }
}
