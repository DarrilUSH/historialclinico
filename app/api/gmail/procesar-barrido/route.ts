/**
 * POST /api/gmail/procesar-barrido — la pasada periódica sobre la etiqueta
 * `historialmedico` de todas las casillas conectadas (Sprint 17, tarea 17.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Lo llama `pg_cron` cada 30 minutos vía `pg_net`, no un navegador. No hay
 *  sesión, no hay cookies: la única credencial es el header `x-cron-secret`,
 *  el MISMO `CRON_SECRET` que ya usan los recordatorios de turnos y las
 *  alertas de medicación (`supabase/migrations/20260818140000` §5).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Es el gemelo de `app/api/push/procesar-recordatorios/route.ts` y copia su
 * contrato entero, a propósito: mismo header, misma comparación en tiempo
 * constante, mismo `503` cuando falta la variable -un despliegue al que le
 * falta el secreto tiene que verse ROTO, no quedarse abierto-, mismo criterio
 * de "el endpoint no acepta parámetros y no devuelve datos, solo números".
 *
 * ## Lo que este handler NO decide
 *
 * Nada del barrido en sí: eso vive en `lib/gmail/barrido.ts`, que es lo que
 * corre también detrás del botón "Buscar ahora". Acá solo se resuelve quién
 * está conectado, se llama al barrido y se cuentan los resultados. El reparto
 * es el mismo que documenta el handler de recordatorios: este archivo
 * orquesta, no implementa.
 *
 * ## Por qué devuelve 200 aunque alguna conexión falle
 *
 * Una conexión con el permiso vencido no es una falla del barrido: es el ciclo
 * de vida normal mientras la pantalla de consentimiento de Google siga "En
 * prueba" (7 días). Queda contada en `vencidas`, la fila ya quedó marcada y la
 * persona ve "volvé a conectar" en su pantalla. Un `500` acá haría que
 * `net._http_response` se llenara de errores para algo que no hay que
 * arreglar.
 */

import { createHash, timingSafeEqual } from "node:crypto"

import { barrerConexiones, type ConexionParaBarrer } from "@/lib/gmail/barrido"
import { listarConexionesConectadas } from "@/lib/gmail/conexiones-admin"

/** `Buffer` y `node:crypto`: Node, no Edge. Igual que los otros dos barridos. */
export const runtime = "nodejs"

/** Nada de esto se puede prerenderizar: el resultado depende de la casilla de cada quien. */
export const dynamic = "force-dynamic"

/** Nombre estable para grepear los logs. */
const PREFIJO = "[gmail-cron]"

/**
 * Cuántas casillas toma una corrida.
 *
 * En esta instalación son una o dos; el tope existe para que una base con
 * cincuenta cuentas conectadas no convierta la corrida en una request de
 * varios minutos. Lo que sobra se lo lleva la corrida siguiente, media hora
 * después, y como `listarConexionesConectadas` ordena por `last_ok_at` con los
 * nulos primero, la que quedó afuera es la primera de la próxima.
 */
const LIMITE_CONEXIONES_POR_CORRIDA = 25

function json(cuerpo: unknown, status: number) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

/**
 * Comparación de tiempo constante entre dos secretos de largo arbitrario.
 * Idéntica a la de `procesar-recordatorios`: se comparan los SHA-256 porque
 * `timingSafeEqual` exige buffers del mismo largo, y tirar por longitud
 * distinta ya sería una filtración.
 */
function secretoCoincide(recibido: string, esperado: string): boolean {
  const a = createHash("sha256").update(recibido).digest()
  const b = createHash("sha256").update(esperado).digest()
  return timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const esperado = process.env.CRON_SECRET
  if (!esperado) {
    console.error(
      `${PREFIJO} Falta CRON_SECRET en el entorno: el barrido no puede autenticarse. Ver docs/gmail-ingesta.md §5.`,
    )
    return json({ error: "El barrido de Gmail no está configurado." }, 503)
  }

  const recibido = request.headers.get("x-cron-secret")
  if (!recibido || !secretoCoincide(recibido, esperado)) {
    return json({ error: "No autorizado" }, 401)
  }

  let conexiones: ConexionParaBarrer[]
  try {
    const vivas = await listarConexionesConectadas(LIMITE_CONEXIONES_POR_CORRIDA)
    conexiones = vivas
      // Sin etiqueta no hay barrido posible, y NO se cae a leer la casilla
      // entera: es el compromiso de docs/minimizacion-datos.md §10.3.
      .filter((conexion) => conexion.labelId !== null)
      .map((conexion) => ({
        userId: conexion.userId,
        email: conexion.email,
        labelId: conexion.labelId as string,
      }))
  } catch (error) {
    console.error(
      `${PREFIJO} No se pudieron listar las conexiones:`,
      error instanceof Error ? error.message : error,
    )
    return json({ error: "No se pudieron leer las conexiones de Gmail." }, 500)
  }

  if (conexiones.length === 0) {
    return json({ conexiones: 0, nuevos: 0, documentos: 0, turnos: 0, errores: 0 }, 200)
  }

  const resumen = await barrerConexiones(conexiones)

  console.info(
    `${PREFIJO} conexiones=${resumen.conexiones} nuevos=${resumen.nuevos} ` +
      `documentos=${resumen.documentos} turnos=${resumen.turnos} descartados=${resumen.descartados} ` +
      `errores=${resumen.errores} vencidas=${resumen.vencidas} fallos=${resumen.conexionesConFallo}`,
  )

  return json(
    {
      conexiones: resumen.conexiones,
      nuevos: resumen.nuevos,
      documentos: resumen.documentos,
      turnos: resumen.turnos,
      descartados: resumen.descartados,
      errores: resumen.errores,
      vencidas: resumen.vencidas,
      conexionesConFallo: resumen.conexionesConFallo,
      hayMas: resumen.hayMas,
    },
    200,
  )
}
