/**
 * Deep links y URLs para logística de turnos.
 *
 * Genera URLs normalizadas para:
 * - Google Maps: navegación con lat/lng o dirección
 * - Uber: deep link si la app está, fallback web
 * - DiDi: deep link si la app está, fallback web
 * - Cabify: deep link si la app está, fallback web
 * - Google Calendar: evento con TEMPLATE
 *
 * Todas las funciones retornan `null` si no hay datos suficientes.
 */

/**
 * Construye el link para "Cómo llegar" (Google Maps).
 * - Con lat/lng: `https://www.google.com/maps/dir/?api=1&destination=lat,lng`
 * - Sin coords pero con dirección: agrega ", Ushuaia, Tierra del Fuego" y codifica
 * - Sin nada: `null`
 */
export function linkComoLlegar(args: {
  latitude?: number | null
  longitude?: number | null
  direccion?: string | null
}): string | null {
  const { latitude, longitude, direccion } = args

  // Con coordenadas: usar la API de Maps con `destination=lat,lng`
  if (latitude != null && longitude != null) {
    const destination = `${latitude},${longitude}`
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
  }

  // Sin coords pero con dirección: geocodificar por dirección
  if (direccion && direccion.trim()) {
    const lugarCompleto = `${direccion}, Ushuaia, Tierra del Fuego`
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lugarCompleto)}`
  }

  // Sin información: no mostrar botón
  return null
}

/**
 * Construye los deep links para pedir viaje (Uber, DiDi, Cabify).
 * Solo funciona con coordenadas del destino; sin ellas, retorna objeto vacío.
 */
export function linksPedirViaje(args: {
  latitude?: number | null
  longitude?: number | null
  nombreLugar?: string | null
}): {
  uber: string | null
  didi: string | null
  cabify: string | null
} {
  const { latitude, longitude, nombreLugar } = args

  // Sin coordenadas: no se puede pedir viaje
  if (latitude == null || longitude == null) {
    return { uber: null, didi: null, cabify: null }
  }

  // Uber deep link: app si está instalada, fallback web
  // Formato: https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=..&dropoff[longitude]=..&dropoff[nickname]=...
  const uberNickname = nombreLugar ? encodeURIComponent(nombreLugar) : `${latitude},${longitude}`
  const uber = `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${latitude}&dropoff[longitude]=${longitude}&dropoff[nickname]=${uberNickname}`

  // DiDi deep link: app o web
  // Formato: didisdk://web/dispatch?targetLat=..&targetLng=..&targetNickname=..
  // Fallback: https://web.didiglobal.com/
  const didiNickname = nombreLugar ? encodeURIComponent(nombreLugar) : `${latitude},${longitude}`
  const didi = `didisdk://web/dispatch?targetLat=${latitude}&targetLng=${longitude}&targetNickname=${didiNickname}`

  // Cabify deep link: app o web
  // Formato: cabify://book?destinationLat=..&destinationLng=..&destinationLabel=..
  // Fallback: https://cabify.com/es/
  const cabifyLabel = nombreLugar ? encodeURIComponent(nombreLugar) : `${latitude},${longitude}`
  const cabify = `cabify://book?destinationLat=${latitude}&destinationLng=${longitude}&destinationLabel=${cabifyLabel}`

  return { uber, didi, cabify }
}

/**
 * Construye el link a Google Calendar con el evento del turno.
 * Formato: https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=UTC/UTC&details=...&location=...
 */
export function linkGoogleCalendar(args: {
  especialidad?: string | null
  nombreMedico?: string | null
  apellidoMedico?: string | null
  fechaHora?: string | null // ISO 8601: "2026-08-15T14:00:00Z" (UTC)
  direccion?: string | null
  notas?: string | null
}): string | null {
  const { especialidad, nombreMedico, apellidoMedico, fechaHora, direccion, notas } = args

  if (!fechaHora) {
    return null
  }

  // Construir SUMMARY: "Turno: {especialidad} — {médico}"
  let titulo = "Turno"
  if (especialidad) {
    titulo += `: ${especialidad}`
  }
  if (nombreMedico || apellidoMedico) {
    const medico = [nombreMedico, apellidoMedico].filter(Boolean).join(" ")
    titulo += ` — ${medico}`
  }

  // Parsear la fecha ISO para extraer inicio/fin
  const fechaObj = new Date(fechaHora)
  // Sumar 1 hora por defecto como duración
  const duracion = 60 * 60 * 1000 // 1 hora en ms
  const fechaFin = new Date(fechaObj.getTime() + duracion)

  // Formatear en ISO 8601 para Google Calendar
  // EJEMPLO: "2026-08-15T14:00:00Z/2026-08-15T15:00:00Z"
  const formatoIso = (d: Date) => d.toISOString().replace(/[:-]/g, "").split(".")[0] + "Z"
  const inicio = formatoIso(fechaObj)
  const fin = formatoIso(fechaFin)
  const dates = `${inicio}/${fin}`

  // Detalles: notas de preparación + dirección
  const details = []
  if (notas) {
    details.push(`Preparación: ${notas}`)
  }
  if (direccion) {
    details.push(`Dirección: ${direccion}`)
  }
  const detailsStr = details.join("\n")

  // Construir parámetros
  const params = new URLSearchParams()
  params.set("action", "TEMPLATE")
  params.set("text", titulo)
  params.set("dates", dates)
  if (detailsStr) {
    params.set("details", detailsStr)
  }
  if (direccion) {
    params.set("location", direccion)
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
