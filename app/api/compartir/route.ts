/**
 * `POST /api/compartir` — receptor del Web Share Target (Sprint 11, tarea
 * 11.2). `share_target.action` de `app/manifest.ts`: el sistema operativo
 * llega acá con un POST `multipart/form-data` cuando alguien elige "Historial
 * Médico" en la hoja de compartir de Android al compartir un PDF o una foto
 * desde cualquier otra app.
 *
 * ## Es una NAVEGACIÓN, no un `fetch`
 *
 * El navegador trata este POST como top-level -abre (o enfoca) la PWA y
 * renderiza lo que este handler devuelva-, no como una llamada de script.
 * Por eso cada camino termina en un `NextResponse.redirect(..., 303)`: `303
 * See Other` le pide al navegador repetir la navegación con `GET`, así que la
 * persona nunca ve un reenvío accidental del mismo POST al recargar la
 * pantalla de destino.
 *
 * ## Por qué esta ruta es "pública" en `lib/auth/rutas.ts` y aun así exige sesión
 *
 * Ver el comentario completo de `RUTA_COMPARTIR` en `lib/auth/rutas.ts`: sin
 * esa excepción, `proxy.ts` le devolvería un 401 JSON crudo a la persona
 * -nada que reintentar, nada que loguear- en lugar de la redirección amable
 * que arma este handler. La AUTENTICACIÓN real sigue siendo la cookie de
 * sesión de Supabase: el primer paso acá abajo es exactamente
 * `supabase.auth.getUser()`, igual que cualquier pantalla privada.
 *
 * ## Guardas y flujo, en orden
 *
 * 1. **Sesión.** Sin ella, `303 → /login?desde=/compartir`. El archivo que el
 *    sistema operativo acaba de entregar en este POST **se pierde**: no hay
 *    forma de retenerlo a través de un login sin la complejidad de un
 *    almacenamiento anónimo (más superficie de abuso, para un caso raro).
 *    Volver a compartir desde la otra app después de loguearse es un gesto de
 *    dos toques; se documenta en `docs/share-target.md` §5.
 * 2. **Purga perezosa** de las propias filas vencidas de la cuenta
 *    (`purgarCompartidosVencidos`, best-effort, nunca bloquea).
 * 3. **Extraer el primer archivo** del campo `archivos` (nombre que fija
 *    `share_target.params.files[0].name` en `app/manifest.ts`). Si el sistema
 *    operativo compartió varios a la vez, solo se toma el primero -el resto
 *    se ignora a propósito: el pipeline de ingesta entero (extracción,
 *    revisión, confirmación) es de UN documento por vez, y ofrecer una cola
 *    de varios es alcance para otro sprint-. Sin ningún archivo válido,
 *    `303 → /compartir?error=sin_archivo`.
 * 4. **Validar y guardar** con `guardarArchivoCompartido`
 *    (`lib/documentos/compartir-temporal-admin.ts`): magic bytes, tamaño,
 *    subida al área de espera, fila de seguimiento. Un archivo inválido
 *    -`.exe` renombrado, más de 25 MB- termina en
 *    `303 → /compartir?error=archivo_invalido`.
 * 5. **Éxito:** `303 → /compartir?archivo={id}`. `/compartir` (Server
 *    Component) resuelve ese id con el cliente del USUARIO -RLS decide si es
 *    su propia fila-, nunca con este handler ni con `service_role`.
 */

import { NextResponse } from "next/server"

import { rutaDeLoginCon } from "@/lib/auth/rutas"
import {
  ErrorGuardadoCompartido,
  guardarArchivoCompartido,
  purgarCompartidosVencidos,
} from "@/lib/documentos/compartir-temporal-admin"
import { createClient } from "@/lib/supabase/server"

const RUTA_COMPARTIR_PANTALLA = "/compartir"

function redirigirA(request: Request, destino: string): NextResponse {
  return NextResponse.redirect(new URL(destino, request.url), 303)
}

function redirigirConError(
  request: Request,
  codigo: "sin_archivo" | "archivo_invalido" | "inesperado",
): NextResponse {
  return redirigirA(request, `${RUTA_COMPARTIR_PANTALLA}?error=${codigo}`)
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return redirigirA(request, rutaDeLoginCon(RUTA_COMPARTIR_PANTALLA))
  }

  // Best-effort, nunca bloquea: ver el comentario de purgarCompartidosVencidos.
  await purgarCompartidosVencidos(supabase, user.id)

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (error) {
    console.error("[compartir] No se pudo leer el multipart entrante:", error)
    return redirigirConError(request, "sin_archivo")
  }

  // Nombre de campo fijado por `share_target.params.files[].name` en
  // app/manifest.ts. `getAll` porque el sistema operativo puede mandar varios
  // archivos bajo el mismo nombre de campo — ver el punto 3 del encabezado.
  const archivo = formData.getAll("archivos").find((valor): valor is File => valor instanceof File)

  if (!archivo) {
    return redirigirConError(request, "sin_archivo")
  }

  try {
    const guardado = await guardarArchivoCompartido(user.id, archivo)
    return redirigirA(request, `${RUTA_COMPARTIR_PANTALLA}?archivo=${guardado.id}`)
  } catch (error) {
    if (error instanceof ErrorGuardadoCompartido) {
      if (error.codigo === "archivo_invalido") {
        return redirigirConError(request, "archivo_invalido")
      }
      console.error(`[compartir] ${error.codigo}: ${error.message}`)
      return redirigirConError(request, "inesperado")
    }
    console.error("[compartir] Fallo inesperado recibiendo un archivo compartido:", error)
    return redirigirConError(request, "inesperado")
  }
}
