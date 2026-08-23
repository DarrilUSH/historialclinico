/**
 * GET /api/turnos/[id]/ics
 *
 * Descarga el evento del turno en formato iCalendar (.ics).
 * Requiere sesión autenticada y permiso sobre el perfil.
 *
 * Retorna:
 * - 200: archivo .ics válido (VCALENDAR/VEVENT en UTF-8)
 * - 401: no autenticado
 * - 403: sin permisos RLS
 * - 404: turno no encontrado
 *
 * ## Por qué acota por perfil ACTIVO y no solo por RLS (arreglo del 2026-08-23)
 *
 * La versión anterior consultaba `appointments` solo por `id`, confiando en
 * que "RLS se aplica automáticamente". Se aplica, pero contesta otra pregunta:
 * `appointments_select_puede_ver` usa `puede_ver_perfil(profile_id)`, o sea
 * autoriza **cualquier perfil que la sesión pueda ver**, no el que la persona
 * está mirando. En una cuenta que administra dos o tres perfiles —el caso
 * normal de este producto— eso alcanzaba para que un `.ics` trajera la
 * especialidad, el médico y el lugar de un turno de OTRO perfil mientras en
 * pantalla decía "Viendo a Emma".
 *
 * Es exactamente la distinción que el resto de la app ya hacía en todos lados
 * (`.eq("profile_id", activo.perfil.id)` en cada consulta de detalle) y este
 * endpoint era el único que no. `obtenerPerfilActivo()` revalida el permiso
 * contra la base en cada llamada, así que sumarlo no reemplaza a RLS: la
 * acota a "lo del perfil que se está viendo", que es la regla del producto.
 *
 * Sin perfil activo o con un turno de otro perfil, la respuesta es **404**, la
 * misma que un id inexistente: nunca se distingue "no existe" de "no es de
 * este perfil" (principio 3 de `docs/modelo-permisos.md`).
 */

import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { createClient } from "@/lib/supabase/server"
import { direccionCompleta } from "@/lib/ubicacion/formato"
import type { Turno } from "@/types/dominio"

// Formato de línea VEVENT máx 75 octetos (RFC 5545)
function pliegarLinea(linea: string): string {
  if (linea.length <= 75) {
    return linea
  }
  const partes = []
  let parte = ""
  for (const char of linea) {
    if ((parte + char).length > 75) {
      partes.push(parte)
      parte = " " + char // Continuación con espacio
    } else {
      parte += char
    }
  }
  if (parte) partes.push(parte)
  return partes.join("\r\n")
}

function generarIcs(turno: Turno): string {
  const ahora = new Date().toISOString().replace(/[:-]/g, "").split(".")[0] + "Z"

  // Parsear appointment_date (puede ser ISO string o timestamp)
  const fechaObj = new Date(turno.appointment_date)
  const dtstart = fechaObj.toISOString().replace(/[:-]/g, "").split(".")[0] + "Z"

  // Fin: default 1 hora después
  const duracion = 60 * 60 * 1000
  const fechaFin = new Date(fechaObj.getTime() + duracion)
  const dtend = fechaFin.toISOString().replace(/[:-]/g, "").split(".")[0] + "Z"

  // Construir SUMMARY: "Turno: {especialidad} — {médico}"
  let summary = "Turno"
  if (turno.specialty) {
    summary += `: ${turno.specialty}`
  }
  if (turno.doctor_name) {
    summary += ` — ${turno.doctor_name}`
  }

  // LOCATION: calle + ciudad + provincia combinadas (Sprint 16, tarea 16.1) —
  // sin asumir ninguna localidad si el turno no las tiene cargadas.
  const location = [turno.location_name, direccionCompleta({
    direccion: turno.location_address,
    ciudad: turno.location_city,
    provincia: turno.location_province,
  })]
    .filter(Boolean)
    .join(" — ")

  // DESCRIPTION: notas de preparación + detalles del turno
  const descLines = []
  if (turno.preparation_notes) {
    descLines.push(`Preparación: ${turno.preparation_notes}`)
  }
  if (turno.specialty) {
    descLines.push(`Especialidad: ${turno.specialty}`)
  }
  if (turno.doctor_name) {
    descLines.push(`Médico: ${turno.doctor_name}`)
  }
  if (turno.location_name) {
    descLines.push(`Lugar: ${turno.location_name}`)
  }
  const description = descLines.join("\\n")

  // UID único: basado en turno ID + hash del timestamp
  const uid = `${turno.id}@historialmedico.com.ar`

  // Construir líneas VEVENT
  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Historial Médico//Turnos//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Historial Médico — Turnos",
    "X-WR-TIMEZONE:America/Argentina/Ushuaia",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${ahora}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${summary}`,
    ...(location ? [`LOCATION:${location}`] : []),
    ...(description ? [`DESCRIPTION:${description}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ]

  // Plegar líneas largas (RFC 5545: máx 75 octetos)
  const plegadas = lineas.map(pliegarLinea)

  // Retornar en UTF-8 con CRLF (RFC 5545 requiere CRLF)
  return plegadas.join("\r\n") + "\r\n"
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: turnoId } = await params
    const supabase = await createClient()

    // 1. Verificar sesión
    const {
      data: { user },
      error: sessionError,
    } = await supabase.auth.getUser()

    if (sessionError || !user) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }

    // 2. Perfil activo: el turno tiene que ser del perfil que se está viendo,
    //    no de cualquiera que esta sesión pueda ver (ver el encabezado).
    const activo = await obtenerPerfilActivo()

    if (!activo) {
      return new Response(JSON.stringify({ error: "Turno no encontrado" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    }

    // 3. Obtener el turno (RLS aplicada automáticamente; el `.eq` de perfil lo
    //    acota además al perfil activo)
    const { data: turno, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("id", turnoId)
      .eq("profile_id", activo.perfil.id)
      .maybeSingle<Turno>()

    if (error || !turno) {
      return new Response(JSON.stringify({ error: "Turno no encontrado" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    }

    // 4. Generar .ics
    const ics = generarIcs(turno)

    // 5. Retornar con headers correctos (UTF-8, attachment)
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="turno-${turno.specialty?.toLowerCase().replace(/\\s+/g, "-")}-${turnoId.slice(0, 8)}.ics"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    })
  } catch (err) {
    console.error("Error generando .ics:", err)
    return new Response(JSON.stringify({ error: "Error interno" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
