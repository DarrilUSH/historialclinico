/**
 * `GET /api/signos/export?tipo=tension|glucemia|peso&periodo=30d|90d|todo` —
 * descarga CSV de signos vitales filtrado por tipo y período, con UTF-8 BOM
 * para Excel de Windows (Sprint 9, tarea 9.5).
 *
 * Autenticación: sesión + permiso `view` del perfil activo (cookie
 * `perfil_activo`). El CSV contiene datos del perfil activo únicamente, nunca
 * de un perfil distinto que viaje en el `?perfilId` (no existe ese parámetro:
 * el perfil es la cookie, no la query).
 *
 * Respuesta: `text/csv; charset=utf-8` con `Content-Disposition: attachment`
 * y nombre `signos-{tipo}-{nombre-slug}-{fecha-actual}.csv`.
 */

import { NextResponse } from "next/server"

import { type ErrorGuarda, esErrorDeGuarda, requerirPermiso } from "@/lib/auth/guardas"
import { generarCSVSignos, type MedicionParaCSV } from "@/lib/signos/csv"
import { calcularCorteSignos, parsearPeriodoSignos, type PeriodoSignos } from "@/lib/signos/periodo"
import { obtenerHistorialSigno } from "@/lib/signos/consultas"
import { esSignoTipo, type SignoTipo } from "@/lib/signos/tipos"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { fechaIsoUshuaia, horaUshuaia } from "@/lib/turnos/fecha"

const MENSAJE_TIPO_INVALIDO = "Tipo de signo no válido."
const MENSAJE_PERFIL_REQUERIDO =
  "No hay perfil activo. Elegí uno y probá de nuevo."
const MENSAJE_INESPERADO =
  "Ocurrió un problema y no pudimos generar el archivo. Probá de nuevo en unos minutos."

/**
 * Mapeo de estado HTTP para errores de guarda. Mismo patrón que
 * `app/api/sos/[perfilId]/route.ts`.
 */
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

function json(cuerpo: unknown, status: number): Response {
  return NextResponse.json(cuerpo, {
    status,
    headers: { "Cache-Control": "private, no-cache" },
  })
}

/**
 * Simplifica un nombre para el filename: quita acentos, caracteres especiales,
 * espacios múltiples. No es un slugifier multibyte-aware completo, solo lo
 * bastante simple para sacar tildes y caracteres raros de un nombre.
 */
function slugificarNombre(nombre: string): string {
  return (
    nombre
      // Normaliza a NFD (descompone los acentos), luego filtra los diacríticos.
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      // Convierte a minúsculas y reemplaza espacios/guiones por guión.
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      // Limpia guiones múltiples y finales.
      .replace(/\-+/g, "-")
      .replace(/^\-|\-$/g, "")
  )
}

export async function GET(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url)
  const tipoRaw = url.searchParams.get("tipo")
  const periodoRaw = url.searchParams.get("periodo")

  // Valida tipo.
  if (!esSignoTipo(tipoRaw)) {
    return json({ error: MENSAJE_TIPO_INVALIDO }, 400)
  }
  const tipo: SignoTipo = tipoRaw

  // Valida período (parsearPeriodoSignos hace default a "30d", así que acá
  // simplemente parseamos).
  const periodo: PeriodoSignos = parsearPeriodoSignos(periodoRaw)

  try {
    // Obtiene el perfil activo y valida permiso "view".
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return json({ error: MENSAJE_PERFIL_REQUERIDO }, 403)
    }

    const perfilId = activo.perfil.id
    const nombrePerfil = activo.perfil.full_name

    // Revalida con `requerirPermiso` (mismo patrón que
    // `app/api/sos/[perfilId]/route.ts`): aunque `obtenerPerfilActivo` ya lo
    // validó, lo volvemos a validar para estar 100% seguro, porque esta
    // función puede ejecutarse desde contextos distintos y la revalidación
    // es parte del contrato de seguridad.
    const { supabase } = await requerirPermiso(perfilId, "view", {
      siNoHaySesion: "lanzar",
    })

    // Obtiene el historial completo del tipo (sin corte de fecha en la
    // consulta; el corte lo aplica la función pura de construcción de CSV).
    const mediciones = await obtenerHistorialSigno(supabase, perfilId, tipo)

    if (mediciones.length === 0) {
      // CSV vacío: solo encabezados.
      const vacio = generarCSVSignos(tipo, [])
      return responderCSV(vacio, tipo, nombrePerfil)
    }

    // Aplica corte de período (función pura).
    const ahora = new Date()
    const corte = calcularCorteSignos(periodo, ahora)
    const medicionesFiltradas = mediciones.filter((m) => {
      if (corte === null) return true // "todo" = sin corte
      return m.measuredAt >= corte
    })

    // Convierte a MedicionParaCSV: fecha/hora en zona Ushuaia, formato dd/mm/yyyy.
    const medicionesParaCSV: MedicionParaCSV[] = medicionesFiltradas.map((m) => {
      const fecha = new Date(m.measuredAt)
      const fechaISO = fechaIsoUshuaia(fecha) // "YYYY-MM-DD"
      const [anio, mes, dia] = fechaISO.split("-")
      const fechaEsAR = `${dia}/${mes}/${anio}` // "DD/MM/YYYY"
      const hora = horaUshuaia(fecha) // "HH:mm"

      return {
        fecha: fechaEsAR,
        hora,
        sistolica: m.systolic ?? undefined,
        diastolica: m.diastolic ?? undefined,
        pulso: undefined, // `pulse` no viaja en `obtenerHistorialSigno`
        valor: m.value ?? undefined,
      }
    })

    // Genera el CSV.
    const csv = generarCSVSignos(tipo, medicionesParaCSV)
    return responderCSV(csv, tipo, nombrePerfil)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return json({ error: error.message }, estadoDeErrorGuarda(error))
    }
    console.error("[signos/export] Fallo inesperado:", error)
    return json({ error: MENSAJE_INESPERADO }, 500)
  }
}

/**
 * Responde con el contenido del CSV como descarga de archivo.
 *
 * - Content-Type: `text/csv; charset=utf-8` (el BOM ya está en el contenido).
 * - Content-Disposition: `attachment` con nombre `signos-{tipo}-{nombre}-{fecha}.csv`.
 */
function responderCSV(contenido: string, tipo: SignoTipo, nombrePerfil: string): Response {
  const nombreSlug = slugificarNombre(nombrePerfil)
  const hoy = new Date().toISOString().split("T")[0] // "YYYY-MM-DD"
  const filename = `signos-${tipo}-${nombreSlug}-${hoy}.csv`

  return new Response(contenido, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-cache",
    },
  })
}
