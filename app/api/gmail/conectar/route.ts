/**
 * `GET /api/gmail/conectar` — arranque del consentimiento de Google
 * (Sprint 17, tarea 17.1).
 *
 * Es lo que hay detrás del botón "Conectar mi Gmail". Hace tres cosas y
 * ninguna más: exige sesión, prepara el `state` anti-CSRF, y manda a la
 * persona a la pantalla de Google.
 *
 * ## Por qué un Route Handler y no una Server Action
 *
 * El final de esta operación es una navegación de nivel superior a otro
 * dominio (`accounts.google.com`). Un `redirect()` de Server Action viaja
 * como respuesta del protocolo de acciones y el cliente de Next lo resuelve
 * navegando dentro de la aplicación; para salir del origen hace falta un
 * `Location` de verdad, que es lo que devuelve esto. Además la cookie del
 * `state` tiene que escribirse en la MISMA respuesta que redirige, y un Route
 * Handler puede hacerlo sin la ceremonia de la fase action.
 *
 * ## Todas las salidas vuelven a `/perfil/gmail` con un motivo
 *
 * Ninguna rama de este archivo termina en un JSON crudo ni en un stack trace.
 * Quien llega acá viene de tocar un botón grande que dice "Conectar mi
 * Gmail": si algo no está, tiene que volver a la misma pantalla con una frase
 * en castellano, no a una página de error. Los motivos son el dominio cerrado
 * `ResultadoConexion` de `lib/gmail/conexion.ts`.
 */

import { NextResponse } from "next/server"

import { requerirSesion } from "@/lib/auth/guardas"
import { rutaDeLoginCon } from "@/lib/auth/rutas"
import { COOKIE_ESTADO_GMAIL, crearEstadoOauth, VIDA_ESTADO_MS } from "@/lib/gmail/estado-oauth"
import { obtenerCredencialesGoogle } from "@/lib/gmail/credenciales"
import { origenDeLaRequest, redirectUriPara, urlDeConsentimiento } from "@/lib/gmail/google-api"
import type { ResultadoConexion } from "@/lib/gmail/conexion"

/** `node:crypto` para firmar el `state`: es Node, no Edge. */
export const runtime = "nodejs"

/** Pantalla de configuración a la que se vuelve siempre. */
export const RUTA_PANTALLA_GMAIL = "/perfil/gmail"

function volverA(request: Request, resultado: ResultadoConexion): NextResponse {
  const destino = new URL(RUTA_PANTALLA_GMAIL, request.url)
  destino.searchParams.set("resultado", resultado)
  const respuesta = NextResponse.redirect(destino, 303)
  respuesta.headers.set("Cache-Control", "no-store")
  return respuesta
}

export async function GET(request: Request) {
  // Sin sesión no hay a qué cuenta conectar la casilla. El proxy no llega a
  // frenar esto -`/api/gmail/conectar` está declarada como excepción en
  // `lib/auth/rutas.ts` justamente para poder redirigir con amabilidad en vez
  // de contestar un 401 en JSON-, así que la comprobación es de verdad acá.
  const { usuario } = await requerirSesion({
    siNoHaySesion: "lanzar",
    desde: RUTA_PANTALLA_GMAIL,
  }).catch(() => ({ usuario: null }))

  if (!usuario) {
    const respuesta = NextResponse.redirect(
      new URL(rutaDeLoginCon(RUTA_PANTALLA_GMAIL), request.url),
      303,
    )
    respuesta.headers.set("Cache-Control", "no-store")
    return respuesta
  }

  const credenciales = obtenerCredencialesGoogle()
  if (!credenciales) {
    return volverA(request, "sin_configurar")
  }

  // Lista blanca: el `redirect_uri` sale de los dos valores registrados en
  // Google, no del `Host` que traiga la request (ver `redirectUriPara`).
  const redirectUri = redirectUriPara(origenDeLaRequest(request))
  if (!redirectUri) {
    return volverA(request, "origen_no_registrado")
  }

  const estado = crearEstadoOauth({
    userId: usuario.id,
    redirectUri,
    secreto: credenciales.clientSecret,
  })

  const respuesta = NextResponse.redirect(
    urlDeConsentimiento({
      clientId: credenciales.clientId,
      redirectUri,
      state: estado.nonce,
    }),
    302,
  )

  respuesta.cookies.set(COOKIE_ESTADO_GMAIL, estado.cookie, {
    httpOnly: true,
    // `lax` y no `strict`: la vuelta desde Google es una navegación de nivel
    // superior desde OTRO sitio, y `strict` no manda la cookie en ese caso —
    // el callback nunca vería el sobre y la conexión sería imposible. `lax`
    // sigue cubriendo el ataque que importa (esto es un GET idempotente que no
    // escribe nada; lo que escribe es el callback, y ahí la validación es la
    // firma más el nonce más la sesión).
    sameSite: "lax",
    // En producción el origen es HTTPS; en local es `http://localhost`, donde
    // `Secure` haría que el navegador descartara la cookie en silencio.
    secure: redirectUri.startsWith("https://"),
    // Acotada a la rama del callback: no viaja en ninguna otra request de la
    // aplicación.
    path: "/api/gmail",
    maxAge: Math.floor(VIDA_ESTADO_MS / 1000),
  })
  respuesta.headers.set("Cache-Control", "no-store")

  return respuesta
}
