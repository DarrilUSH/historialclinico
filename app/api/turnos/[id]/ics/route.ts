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
 */

import { createClient } from "@/lib/supabase/server"
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

  // LOCATION
  const location = [turno.location_name, turno.location_address]
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

    // 2. Obtener el turno (RLS aplicada automáticamente)
    const { data: turno, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("id", turnoId)
      .single<Turno>()

    if (error || !turno) {
      return new Response(JSON.stringify({ error: "Turno no encontrado" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    }

    // 3. Generar .ics
    const ics = generarIcs(turno)

    // 4. Retornar con headers correctos (UTF-8, attachment)
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
