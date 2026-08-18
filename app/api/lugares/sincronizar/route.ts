/**
 * POST /api/lugares/sincronizar — una TANDA de la sincronización del catálogo
 * REFES (Sprint 16, tarea 16.3).
 *
 * El navegador llama a este endpoint en bucle: primero con `{ paso:
 * "preparar" }` y después con `{ paso: "procesar", token }` hasta que la
 * respuesta dice `etapa: "completo"`. El porqué de partir el trabajo así -y
 * el dimensionamiento medido de cada ventana- está en el encabezado de
 * `lib/lugares/sincronizacion.ts`.
 *
 * ## Quién puede sincronizar: cualquier cuenta con sesión
 *
 * Decidido a propósito, y documentado acá porque es la clase de decisión que
 * seis meses después nadie recuerda haber tomado:
 *
 * - **El catálogo es GLOBAL y público.** No cuelga de ningún perfil, no tiene
 *   un dato de salud de nadie y su contenido es un archivo del Estado bajo
 *   CC-BY-4.0. La matriz de `docs/modelo-permisos.md` -que decide sobre datos
 *   DE UN PACIENTE- no tiene nada que decir sobre esto: no existe el "perfil
 *   dueño del catálogo" al que preguntarle si esta persona puede escribirlo.
 * - **No hay roles en este proyecto, y es deliberado.** `scripts/test-rls.sql`
 *   (BLOQUE 7) tiene un invariante que FALLA si alguna política llega a leer
 *   `profiles.role`. Inventar un rol "administrador del catálogo" para este
 *   botón sería introducir el mismo mecanismo de escalada de privilegios que
 *   el proyecto viene cuidando de no tener, por una pantalla que solo copia
 *   un archivo público.
 * - **El daño posible es nulo y el abuso está acotado.** Lo peor que logra
 *   quien apriete el botón sin motivo es re-copiar el mismo archivo: el
 *   `upsert` es idempotente. Y el lock de
 *   `public.reclamar_sincronizacion_refes()` hace que dos personas apretando
 *   a la vez no produzcan dos descargas, sino una corrida y un "ya hay una
 *   sincronización en curso".
 * - **Queda auditado.** `health_centers_sync.run_started_by` guarda qué
 *   cuenta la disparó y `run_started_at` cuándo.
 *
 * Sin sesión no se entra: el proxy responde `401` antes de llegar acá
 * (`esRutaDeApi` en `proxy.ts`), y este handler igual vuelve a exigirla —una
 * ruta tiene que ser correcta por sí sola, sin confiar en el borde—.
 */

import { NextResponse } from "next/server"

import { ErrorSesionRequerida, requerirSesion } from "@/lib/auth/guardas"
import {
  prepararSincronizacion,
  procesarTanda,
  type ProgresoSincronizacion,
} from "@/lib/lugares/sincronizacion"

/**
 * La sincronización usa `node:https` (`lib/lugares/descarga.ts`) para poder
 * completar la cadena de certificados del portal del Ministerio: es Node, no
 * Edge.
 */
export const runtime = "nodejs"

/**
 * Techo de duración declarado. **No es el objetivo**: cada tanda está
 * dimensionada para terminar en pocos segundos (ver `VENTANA_BYTES` en
 * `lib/lugares/sincronizacion.ts`). Los 60 segundos son el margen para el
 * peor caso real del paso de PREPARACIÓN, que es el único que baja los 9 MB
 * desde un servidor público sin garantías de velocidad.
 */
export const maxDuration = 60

interface CuerpoPedido {
  paso?: unknown
  token?: unknown
  forzar?: unknown
}

function respuestaDeError(mensaje: string, estado: number) {
  return NextResponse.json({ error: mensaje }, { status: estado })
}

export async function POST(request: Request) {
  let usuarioId: string

  try {
    const { usuario } = await requerirSesion({ siNoHaySesion: "lanzar" })
    usuarioId = usuario.id
  } catch (error) {
    if (error instanceof ErrorSesionRequerida) {
      return respuestaDeError(error.message, 401)
    }
    throw error
  }

  let cuerpo: CuerpoPedido
  try {
    cuerpo = (await request.json()) as CuerpoPedido
  } catch {
    return respuestaDeError("El cuerpo del pedido no es JSON válido.", 400)
  }

  const paso = typeof cuerpo.paso === "string" ? cuerpo.paso : ""

  try {
    let progreso: ProgresoSincronizacion

    if (paso === "preparar") {
      progreso = await prepararSincronizacion(usuarioId, { forzar: cuerpo.forzar === true })
    } else if (paso === "procesar") {
      const token = typeof cuerpo.token === "string" ? cuerpo.token : ""
      if (token.length === 0) {
        return respuestaDeError(
          "Falta el identificador de la sincronización en curso. Volvé a tocar Actualizar.",
          400,
        )
      }
      progreso = await procesarTanda(usuarioId, token)
    } else {
      return respuestaDeError(`Paso desconocido: "${paso}".`, 400)
    }

    return NextResponse.json(progreso)
  } catch (error) {
    // El mensaje de estos errores está escrito para que lo lea una persona
    // (`ErrorPortalMinisterio`, `ErrorSincronizacion`, `ErrorFormatoRefes`), y
    // no expone nada del sistema: son "el portal no respondió", "el formato
    // del archivo cambió", "no se pudo escribir un lote".
    const mensaje =
      error instanceof Error
        ? error.message
        : "No pudimos sincronizar el catálogo. Probá de nuevo en un rato."
    console.error("[lugares/sincronizar] fallo la tanda:", error)
    return respuestaDeError(mensaje, 502)
  }
}
