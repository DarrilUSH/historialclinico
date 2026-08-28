/**
 * Deep links y URLs para logística de turnos.
 *
 * Genera URLs normalizadas para:
 * - Google Maps: navegación con lat/lng o dirección
 * - Pedir un viaje: un único atajo, ver el bloque de abajo
 * - Google Calendar: evento con TEMPLATE
 *
 * Todas las funciones retornan `null` si no hay datos suficientes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  NEUTRALIDAD GEOGRÁFICA (Sprint 20, adenda) — regla del producto
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Decisión del dueño, textual: *"no te concentres en Ushuaia, la idea es que
 * esta app funcione en todo el mundo, donde se quiera utilizar."*
 *
 * **Ninguna lógica de este archivo -ni de la app- se condiciona por ciudad,
 * provincia o país.** No hay tablas de cobertura, no hay listas de "acá sí, allá
 * no", no hay una localidad por defecto. Los textos siguen en castellano
 * rioplatense porque es una decisión de producto; el COMPORTAMIENTO es neutro.
 * Las fuentes regionales que ya existen -el catálogo REFES, el formato de fecha
 * `dd/mm/aaaa` que el prompt de turnos le explica al modelo- son DATOS y
 * EJEMPLOS, no supuestos del código: `linkComoLlegar` no asume ninguna
 * localidad (ver su propio comentario y el bug que lo motivó), y el analizador
 * de mensajes sigue leyendo cualquier fecha que le llegue.
 *
 * ## Qué le hizo esa regla a "Pedir viaje"
 *
 * Había tres atajos fijos -Uber, DiDi y Cabify- y una usuaria notó que en su
 * ciudad no operan todos. El arreglo NO es filtrar por ciudad: eso sería volver
 * a asumir geografía, con una tabla que envejecería en silencio y se
 * equivocaría para los dos lados. El arreglo es que **cualquier lista fija de
 * apps de transporte está mal en algún lugar del mundo**, así que la lista se
 * reduce a lo que sirve en todas partes.
 *
 * Se conserva UN atajo, y el criterio para elegirlo no es comercial sino
 * mecánico: `https://m.uber.com/ul/...` es una URL HTTPS común, así que tocarla
 * SIEMPRE abre algo -la app si está instalada, y si no una página web real con
 * el destino cargado-. Los otros dos eran esquemas propios (`didisdk://`,
 * `cabify://`) que, sin la app instalada, no hacen absolutamente nada: un botón
 * muerto, que es justo lo que este sprint vino a sacar de la aplicación.
 *
 * Y el protagonista es el mapa, no esto: `linkComoLlegar` funciona en todo el
 * planeta, sin depender de ninguna aplicación de terceros, y la vista de
 * direcciones del mapa ya ofrece por su cuenta las opciones de transporte que
 * existan en ESE lugar — mantenidas por alguien que sí puede saberlo.
 */

/**
 * Construye el link para "Cómo llegar" (Google Maps).
 * - Con lat/lng: `https://www.google.com/maps/dir/?api=1&destination=lat,lng`
 * - Sin coords pero con dirección: la codifica y la manda tal cual
 * - Sin nada: `null`
 *
 * ## El bug de Ushuaia que corrige esta versión (Sprint 16, tarea 16.1)
 *
 * Antes de esta tarea, la rama "sin coords" agregaba ", Ushuaia, Tierra del
 * Fuego" HARDCODEADO a cualquier dirección -Ushuaia es la sede real del
 * desarrollo, pero la familia del usuario carga turnos en La Plata, CABA, y
 * otras localidades: el link terminaba apuntando a un lugar equivocado, o
 * Google Maps no encontraba nada porque buscaba, por ejemplo, "Avenida 51 Nº
 * 315, Ushuaia, Tierra del Fuego" en vez de "..., La Plata, Buenos Aires"-.
 * Bug reportado por el usuario con uso real (ROADMAP_SPRINTS.md §Sprint 16,
 * ítem 1).
 *
 * La corrección NO agrega un parámetro de ciudad/provincia acá: el `direccion`
 * que recibe esta función ya viene armado por el LLAMADOR con
 * `lib/ubicacion/formato.ts#direccionCompleta` -calle + ciudad + provincia,
 * las partes que estén cargadas-, así que esta función se queda simple y toda
 * la lógica de "qué partes hay" vive en un solo lugar (`direccionCompleta`), no
 * duplicada acá. Un turno viejo sin ciudad cargada sigue funcionando
 * exactamente igual que antes -mismo `direccion` de siempre, solo que ya no se
 * le pega una localidad ajena-.
 *
 * ## Sprint 20 (adenda): tampoco se le pega un PAÍS
 *
 * El arreglo del Sprint 16 dejó de asumir la localidad pero siguió agregando
 * `", Argentina"` "para acotar la búsqueda al país". Eso es la MISMA clase de
 * error, un nivel más arriba, y la regla de neutralidad geográfica del producto
 * lo deja sin excusa: una dirección de Madrid o de Montevideo terminaba
 * buscándose en Argentina, es decir, no encontrándose. La app tiene que
 * funcionar donde se la quiera usar.
 *
 * Ahora se manda la dirección TAL COMO la cargó la persona. El mapa resuelve la
 * ambigüedad mucho mejor que nosotros -usa la ubicación de quien busca-, y si
 * la dirección no alcanza, la persona agrega la ciudad en el campo del turno,
 * que es donde ese dato tiene que estar. Ver el bloque "NEUTRALIDAD
 * GEOGRÁFICA" del encabezado del archivo.
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

  // Sin coords pero con dirección: buscar por texto, tal como se cargó. Sin
  // localidad asumida y sin país asumido -ver el encabezado de la función-.
  if (direccion && direccion.trim()) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(direccion.trim())}`
  }

  // Sin información: no mostrar botón
  return null
}

/**
 * El atajo para pedir un viaje al destino del turno, o `null` cuando no se
 * puede armar.
 *
 * UNO solo, y en HTTPS. Ver el bloque "NEUTRALIDAD GEOGRÁFICA" del encabezado
 * para por qué dejó de ser una lista de tres: cualquier lista fija de apps de
 * transporte está mal en algún lugar del mundo, y dos de las tres producían un
 * botón muerto donde la app no estuviera instalada.
 *
 * Necesita coordenadas: ninguna app de viaje acepta un destino en texto libre,
 * y mandar a la persona a tipear la dirección de nuevo no es un atajo. Sin
 * coordenadas devuelve `null` y la pantalla no ofrece nada — "Cómo llegar", que
 * sí acepta una dirección, sigue estando.
 */
export function linkPedirViaje(args: {
  latitude?: number | null
  longitude?: number | null
  nombreLugar?: string | null
}): string | null {
  const { latitude, longitude, nombreLugar } = args

  if (latitude == null || longitude == null) {
    return null
  }

  // `https://m.uber.com/ul/...` abre la app si está instalada y, si no, una
  // página web real con el destino cargado. Es una URL común: nunca queda un
  // toque sin respuesta, en ningún dispositivo ni en ningún país.
  const destino = nombreLugar ? encodeURIComponent(nombreLugar) : `${latitude},${longitude}`
  return `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${latitude}&dropoff[longitude]=${longitude}&dropoff[nickname]=${destino}`
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
