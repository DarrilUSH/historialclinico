import "server-only"

/**
 * Geocodificación de direcciones vía Nominatim (OpenStreetMap) — costo cero,
 * sin API key (ROADMAP_SPRINTS.md §Costo cero: "Sin Google Maps API
 * (geocoding manual/Nominatim)"). Sprint 16, tarea 16.1.
 *
 * ## Qué resuelve y qué no reemplaza
 *
 * Antes de esta tarea, las coordenadas de un turno o un médico eran SIEMPRE
 * manuales: un campo avanzado colapsado con un link a Google Maps para que la
 * persona copie el pin a mano (`components/turnos/formulario-turno.tsx`,
 * comentario de cabecera). Ese flujo manual SIGUE existiendo -sigue siendo la
 * fuente de verdad si la persona lo completa-; este módulo solo agrega un
 * intento AUTOMÁTICO de mejor esfuerzo cuando calle+ciudad+provincia están
 * cargadas pero nadie pegó coordenadas a mano (`crearTurno`/`actualizarTurno`,
 * `crearMedico`/`actualizarMedico`). Nunca bloquea el guardado: cualquier
 * fallo -sin resultados, timeout, red caída- devuelve `null` y el turno o el
 * médico se guardan igual, sin coordenadas, exactamente como pasaba antes de
 * esta tarea.
 *
 * ## El sesgo a Ushuaia que esto ayuda a cerrar
 *
 * El bug reportado por el usuario (ROADMAP_SPRINTS.md §Sprint 16, ítem 1) no
 * estaba en ninguna llamada a Nominatim -no existía ninguna antes de esta
 * tarea-: estaba en `lib/logistica/deep-links.ts#linkComoLlegar`, que forzaba
 * ", Ushuaia, Tierra del Fuego" en el link de "Cómo llegar" cuando faltaban
 * coordenadas. Ese link ya se corrigió en el mismo commit de esta tarea. Este
 * módulo es el complemento: con calle+ciudad+provincia reales (ej. "Avenida
 * 51 Nº 315" + "La Plata" + "Buenos Aires"), ahora es posible resolver
 * coordenadas automáticamente SIN asumir ninguna ciudad fija -a diferencia
 * del link viejo, acá simplemente no hay ningún valor por defecto: sin
 * ciudad/provincia cargada, la consulta se manda solo con la calle y el país.
 *
 * ## Política de uso de Nominatim
 *
 * https://operations.osmfoundation.org/policies/nominatim/ exige, entre
 * otras cosas:
 * - Un `User-Agent` que identifique la aplicación (nunca el default de
 *   `fetch`) — ver `USER_AGENT` abajo, con un contacto real.
 * - Máximo 1 request por segundo. Este módulo lo asegura con un semáforo de
 *   proceso (`proximaLlamadaDisponibleEn`): si dos geocodificaciones caen en
 *   la misma ventana de 1s, la segunda espera lo que falta antes de salir a
 *   la red. Alcanza para el volumen real de esta app -una familia cargando
 *   turnos, nunca en paralelo real ni en lote-.
 * - Nada de geocodificación masiva: acá se geocodifica una dirección por vez,
 *   al guardar un turno o un médico, nunca un lote.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

/** Identifica la app ante Nominatim con un contacto real, como exige su política de uso. El mismo correo que ya publican `/privacidad` y `/terminos` como contacto del sitio. */
const USER_AGENT =
  "HistorialMedicoApp/1.0 (https://www.historialmedico.com.ar; contacto: claude2@legistdf.gob.ar)"

/** Nominatim puede tardar; 5s es margen suficiente para una búsqueda estructurada sin dejar la Server Action colgada si el servicio está lento. */
const TIMEOUT_MS = 5_000

/** Política de Nominatim: máximo 1 request/segundo. */
const INTERVALO_MINIMO_MS = 1_000

/** Instante (epoch ms) en el que la PRÓXIMA llamada puede salir sin violar el intervalo mínimo. Estado de proceso, a propósito: alcanza para una app de un solo servidor Node y bajo volumen; no pretende coordinar entre instancias. */
let proximaLlamadaDisponibleEn = 0

async function esperarTurno(): Promise<void> {
  const ahora = Date.now()
  const espera = proximaLlamadaDisponibleEn - ahora
  proximaLlamadaDisponibleEn = Math.max(ahora, proximaLlamadaDisponibleEn) + INTERVALO_MINIMO_MS
  if (espera > 0) {
    await new Promise((resolve) => setTimeout(resolve, espera))
  }
}

export interface DireccionParaGeocodificar {
  /** Calle y altura. Sin esto no hay nada que geocodificar: devuelve `null` sin llamar a Nominatim. */
  calle?: string | null
  ciudad?: string | null
  provincia?: string | null
}

export interface CoordenadasGeocodificadas {
  latitud: number
  longitud: number
}

interface ResultadoNominatim {
  lat: string
  lon: string
}

/**
 * Geocodifica calle+ciudad+provincia+Argentina contra Nominatim (consulta
 * estructurada: `street`/`city`/`state`/`country`, no una búsqueda de texto
 * libre — más precisa para direcciones argentinas con nomenclatura de calle y
 * altura). Mejor esfuerzo: devuelve `null` -nunca lanza- ante falta de calle,
 * sin resultados, timeout o cualquier error de red.
 */
export async function geocodificarDireccion(
  direccion: DireccionParaGeocodificar,
): Promise<CoordenadasGeocodificadas | null> {
  const calle = direccion.calle?.trim()
  if (!calle) return null

  const params = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    countrycodes: "ar",
    street: calle,
    country: "Argentina",
  })

  const ciudad = direccion.ciudad?.trim()
  if (ciudad) params.set("city", ciudad)

  const provincia = direccion.provincia?.trim()
  if (provincia) params.set("state", provincia)

  await esperarTurno()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const respuesta = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: controller.signal,
    })

    if (!respuesta.ok) {
      console.error(`[geocodificacion] Nominatim devolvió HTTP ${respuesta.status} para "${calle}".`)
      return null
    }

    const resultados = (await respuesta.json()) as ResultadoNominatim[]
    const primero = resultados[0]
    if (!primero) return null

    const latitud = Number(primero.lat)
    const longitud = Number(primero.lon)
    if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) return null

    return { latitud, longitud }
  } catch (error) {
    console.error(`[geocodificacion] Fallo al geocodificar "${calle}" contra Nominatim:`, error)
    return null
  } finally {
    clearTimeout(timer)
  }
}
