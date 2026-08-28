"use client"

/**
 * Lectura automática del documento: le pide al servidor que ARRANQUE
 * (`POST /api/documentos/extraer`), después pregunta en qué anda
 * (`GET /api/documentos/extraer?doc=…`) hasta que termina, y pase lo que
 * pase -éxito, falla de Gemini, respuesta vacía o inválida- termina mostrando
 * `FormularioRevision` (`components/documentos/formulario-revision.tsx`), la
 * pantalla de revisión real de la tarea 4.5. Vive aparte de `page.tsx` por el
 * mismo motivo que `pantalla-carga.tsx` en `/estudios/nuevo`: `page.tsx` es un
 * Server Component (usa `cookies()` para el guard) y esto necesita `useEffect`
 * y estado de React.
 *
 * REGLA DE ORO (ROADMAP_SPRINTS.md, Sprint 4): la subida NUNCA queda
 * bloqueada por la IA. CUALQUIER desenlace de la lectura lleva al mismo
 * formulario: con `extraccion` si Gemini devolvió algo válido, con
 * `extraccion: null` (+ el mensaje de error) si no.
 *
 * ## El bloqueo de pantalla ya no mata la lectura (hotfix del 19/08/2026)
 *
 * Reporte del dueño, usando la app en su teléfono: *"cuando está analizando un
 * archivo y se bloquea el celular o se cambia de aplicación se corta y larga
 * error, ¿no se puede hacer que quede en segundo plano y finalice?"*.
 *
 * Antes esta pantalla mantenía UN `fetch` abierto durante toda la extracción
 * -hasta un minuto y medio-, y deducía el desenlace del resultado de ese
 * `fetch`. Cuando Android congela la pestaña, un `fetch` en vuelo muere; el
 * `catch` de acá lo leía como "la lectura falló" y pintaba el error terminal
 * ENCIMA de un trabajo que el servidor había terminado bien. Reproducido en
 * local abortando el `fetch` a los 400 ms: la fila quedaba con `ai_summary`
 * escrito y la pantalla mostraba el formulario vacío con el cartel de error.
 *
 * Tres cambios, y el problema deja de existir:
 *
 * 1. **Ninguna request dura más que unos milisegundos.** El `POST` sólo
 *    arranca la lectura (el trabajo pesado corre en `after()` del lado del
 *    servidor); las consultas siguientes son `GET` cortos. Ya no hay una
 *    conexión larga que congelar.
 * 2. **Una request muerta no dice NADA sobre la lectura.** Un `AbortError` o
 *    un `TypeError: Failed to fetch` -que es exactamente lo que produce una
 *    pestaña congelada- se trata como "no pude preguntar ahora", no como "la
 *    lectura falló": se vuelve a preguntar. El desenlace real viaja SIEMPRE en
 *    el cuerpo (`estado`), nunca en el éxito del `fetch`
 *    (`lib/documentos/lectura-automatica.ts`).
 * 3. **Al volver a primer plano se pregunta enseguida.** `visibilitychange` y
 *    `pageshow` (el evento del bfcache, el que dispara Android al restaurar
 *    una pestaña congelada) despiertan la espera en vez de esperar el próximo
 *    tic: si mientras el teléfono estaba bloqueado la lectura terminó, la
 *    persona se encuentra el formulario ya lleno.
 *
 * Sólo se ofrece la carga a mano cuando la lectura falló DE VERDAD (el
 * servidor dice `estado: "error"`) o cuando se agotó `ESPERA_MAXIMA_MS`. Ese
 * es el camino de reintento que ya existía desde el Sprint 4 y que el Sprint
 * 19 afinó: el MISMO formulario, con la `<Alerta>` explicando qué pasó y todos
 * los campos editables -recargar la pantalla vuelve a intentar la lectura, y
 * el `POST` de arranque no le vuelve a pagar a Gemini si el resultado ya está
 * guardado-.
 *
 * ## Adiós al `useRef` de "ya disparé": el efecto por fin es idempotente
 *
 * Este componente tenía un `disparado = useRef(false)` para que el efecto no
 * llamara DOS VECES a Gemini cuando React 19 lo corre dos veces en desarrollo
 * (Strict Mode, para detectar efectos no idempotentes). Ese truco no convive
 * con un efecto que además tiene función de limpieza: la limpieza de la
 * primera corrida cancelaba el bucle, y la segunda corrida se iba enseguida
 * por el `if (disparado.current) return` -resultado: cero bucles vivos y la
 * pantalla clavada en "leyendo" para siempre-. Se encontró justo así,
 * verificando este arreglo.
 *
 * Ya no hace falta, y ésa es una consecuencia linda del rediseño: la
 * exclusión mutua ahora vive donde corresponde, en el servidor
 * (`reclamarLectura` reserva la lectura con un `UPDATE` condicional), así que
 * disparar dos veces cuesta un `POST` de más y NINGUNA llamada de más a
 * Gemini. El efecto vuelve a ser lo que React espera: cada corrida arranca su
 * propio bucle y su limpieza lo cancela, así que hay exactamente uno vivo.
 *
 * ## Velo de espera (Sprint 14, "Feedback de espera global")
 *
 * "La inteligencia artificial está leyendo tu estudio…" es la segunda etapa
 * REAL de la ingesta -ver el comentario equivalente en
 * `../pantalla-carga.tsx` para las otras dos-.
 */

import * as React from "react"

import { FormularioRevision } from "@/components/documentos/formulario-revision"
import { VeloEspera } from "@/components/base/velo-espera"
import type { DuplicadoSemanticoParaCliente } from "@/lib/documentos/duplicados-semanticos"
import {
  ESPERA_MAXIMA_MS,
  INTERVALO_CONSULTA_MS,
  PARAM_DOCUMENTO,
  type RespuestaLectura,
} from "@/lib/documentos/lectura-automatica"
import type { DocumentoMedicoExtraido } from "@/lib/gemini/schemas"
import type { MedicoParaAutocompletar } from "@/lib/turnos/autocompletar-medico"
import type { CategoriaDocumento } from "@/types/dominio"

export interface PantallaProcesandoProps {
  documentoId: string
  /** Título ya guardado en `documents.title` (provisional, derivado del nombre de archivo). */
  tituloProvisional: string
  /** Categoría ya guardada en `documents.category` (default `"other"`). */
  categoriaProvisional: CategoriaDocumento
  /** Fecha ya guardada en `documents.document_date` (default: hoy). */
  fechaProvisional: string
  /** Fecha de hoy en `YYYY-MM-DD`, hora de pared de Ushuaia — tope del input date del formulario. */
  fechaMaximaIso: string
  /** Médicos activos del directorio del perfil DESTINO (cruces inteligentes, agosto 2026) — pasa tal cual a `FormularioRevision`. */
  medicos: MedicoParaAutocompletar[]
  /** `true` si el catálogo REFES tiene centros cargados (cruces inteligentes, agosto 2026). */
  catalogoDisponible: boolean
  /** Títulos que el perfil DESTINO ya usa, para avisar cuando el propuesto se repite (Sprint 19). Pasa tal cual a `FormularioRevision`. */
  titulosExistentes: readonly string[]
  /** Medicamentos recién cargados desde este documento (Sprint 20), al volver de la cola de `/medicacion/nuevo`. Pasa tal cual a `FormularioRevision`. */
  medicamentosCargados?: number
}

type Estado = "leyendo" | "revisando"

/**
 * Lo que puede pasar al preguntarle al servidor.
 *
 * `red` es la clave del arreglo: agrupa TODO lo que impide preguntar ahora
 * -pestaña congelada, `AbortError`, sin señal, un 5xx transitorio- y no dice
 * nada sobre la lectura en sí. `rechazo` es un 4xx: ahí el servidor sí opinó
 * (sesión vencida, documento inexistente, permiso perdido) y no tiene sentido
 * insistir.
 */
type Consulta =
  | { tipo: "ok"; lectura: RespuestaLectura }
  | { tipo: "red" }
  | { tipo: "rechazo"; mensaje: string }

const MENSAJE_ERROR_RED =
  "No pudimos conectarnos para leer el documento. Revisá tu conexión: podés cargar los datos a mano igual."

const MENSAJE_TARDO_DEMASIADO =
  "La lectura automática está tardando más de lo esperado. Podés cargar los datos a mano; el archivo que subiste no se perdió."

/**
 * Cuántas consultas seguidas pueden fallar POR RED, con la pantalla a la
 * vista, antes de rendirse. Con la pantalla oculta no se cuenta ninguna: ahí
 * fallar es lo esperable, no una señal de nada. Seis intentos ≈ 15 segundos de
 * conexión realmente caída.
 */
const MAX_FALLOS_DE_RED = 6

/** Tope por request. Ninguna de las dos debería tardar más que esto: el trabajo pesado ya no vive adentro de la request. */
const TIMEOUT_REQUEST_MS = 15_000

function mensajeDeCuerpo(cuerpo: unknown, porDefecto: string): string {
  if (
    cuerpo &&
    typeof cuerpo === "object" &&
    "error" in cuerpo &&
    typeof (cuerpo as { error: unknown }).error === "string"
  ) {
    return (cuerpo as { error: string }).error
  }
  return porDefecto
}

/** Reconoce la forma de `RespuestaLectura` sin confiar en el `any` de `response.json()`. */
function comoLectura(cuerpo: unknown): RespuestaLectura | null {
  if (!cuerpo || typeof cuerpo !== "object") return null
  const posible = cuerpo as Record<string, unknown>
  const estado = posible.estado
  if (
    estado !== "pendiente" &&
    estado !== "procesando" &&
    estado !== "listo" &&
    estado !== "error"
  ) {
    return null
  }
  return {
    estado,
    extraccion: (posible.extraccion ?? null) as DocumentoMedicoExtraido | null,
    duplicadoSemantico: (posible.duplicadoSemantico ?? null) as DuplicadoSemanticoParaCliente | null,
    error: typeof posible.error === "string" ? posible.error : null,
  }
}

async function pedir(url: string, opciones: RequestInit): Promise<Consulta> {
  const abortador = new AbortController()
  const reloj = setTimeout(() => abortador.abort(), TIMEOUT_REQUEST_MS)

  try {
    const respuesta = await fetch(url, { ...opciones, signal: abortador.signal })
    const cuerpo: unknown = await respuesta.json().catch(() => null)

    if (respuesta.ok || respuesta.status === 202) {
      const lectura = comoLectura(cuerpo)
      // Un 2xx con un cuerpo que no entendemos no es un fallo de la lectura:
      // es un problema de esta request. Se vuelve a preguntar.
      return lectura ? { tipo: "ok", lectura } : { tipo: "red" }
    }

    // 5xx: transitorio del servidor, se reintenta como cualquier hipo de red.
    if (respuesta.status >= 500) return { tipo: "red" }

    return { tipo: "rechazo", mensaje: mensajeDeCuerpo(cuerpo, MENSAJE_ERROR_RED) }
  } catch {
    // `AbortError`, `TypeError: Failed to fetch`, pestaña congelada por
    // Android: nada de esto dice algo sobre la lectura. Ver el encabezado.
    return { tipo: "red" }
  } finally {
    clearTimeout(reloj)
  }
}

export function PantallaProcesando({
  documentoId,
  tituloProvisional,
  categoriaProvisional,
  fechaProvisional,
  fechaMaximaIso,
  medicos,
  catalogoDisponible,
  titulosExistentes,
  medicamentosCargados = 0,
}: PantallaProcesandoProps) {
  const [estado, setEstado] = React.useState<Estado>("leyendo")
  const [extraccion, setExtraccion] = React.useState<DocumentoMedicoExtraido | null>(null)
  const [mensajeError, setMensajeError] = React.useState<string | null>(null)
  const [duplicadoSemantico, setDuplicadoSemantico] = React.useState<DuplicadoSemanticoParaCliente | null>(
    null,
  )

  React.useEffect(() => {
    // Sin guardia de "ya disparé": ver el bloque del encabezado. Cada corrida
    // del efecto tiene SU bucle y su limpieza lo cancela, así que siempre hay
    // exactamente uno vivo; que el efecto corra dos veces en Strict Mode
    // cuesta un `POST` de más y ninguna llamada de más a Gemini.
    let cancelado = false
    const arranque = Date.now()

    // Espera interrumpible: el bucle duerme entre consultas, pero volver a
    // primer plano lo despierta al instante en vez de hacerle esperar el
    // próximo tic (que, además, el navegador ralentiza en pestañas ocultas).
    let despertar: (() => void) | null = null
    function dormir(ms: number): Promise<void> {
      return new Promise((resolver) => {
        const reloj = setTimeout(() => {
          despertar = null
          resolver()
        }, ms)
        despertar = () => {
          clearTimeout(reloj)
          despertar = null
          resolver()
        }
      })
    }

    function alVolverAlFrente() {
      if (document.visibilityState === "visible") despertar?.()
    }
    document.addEventListener("visibilitychange", alVolverAlFrente)
    // `pageshow` cubre la restauración desde el bfcache, que es lo que hace
    // Android al devolverle el foco a una pestaña que había congelado.
    window.addEventListener("pageshow", alVolverAlFrente)

    /** `POST`: arrancá la lectura (o devolveme la que ya está guardada). */
    function arrancarLectura(): Promise<Consulta> {
      return pedir("/api/documentos/extraer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentoId }),
      })
    }

    /** `GET`: ¿en qué anda? */
    function consultarLectura(): Promise<Consulta> {
      return pedir(
        `/api/documentos/extraer?${PARAM_DOCUMENTO}=${encodeURIComponent(documentoId)}`,
        { method: "GET", cache: "no-store" },
      )
    }

    function mostrarFormulario(datos: {
      extraccion: DocumentoMedicoExtraido | null
      duplicado: DuplicadoSemanticoParaCliente | null
      error: string | null
    }) {
      if (cancelado) return
      setExtraccion(datos.extraccion)
      setDuplicadoSemantico(datos.duplicado)
      setMensajeError(datos.error)
      setEstado("revisando")
    }

    async function bucle() {
      let fallosDeRedSeguidos = 0
      // El primer paso es el `POST`: arranca la lectura si hace falta y, si el
      // resultado ya estaba guardado (la persona volvió a esta pantalla), lo
      // devuelve ahí mismo sin pagarle a Gemini de nuevo.
      let consulta = await arrancarLectura()

      while (!cancelado) {
        if (consulta.tipo === "rechazo") {
          mostrarFormulario({ extraccion: null, duplicado: null, error: consulta.mensaje })
          return
        }

        if (consulta.tipo === "ok") {
          fallosDeRedSeguidos = 0
          const { lectura } = consulta

          if (lectura.estado === "listo" && lectura.extraccion) {
            mostrarFormulario({
              extraccion: lectura.extraccion,
              duplicado: lectura.duplicadoSemantico,
              error: null,
            })
            return
          }

          if (lectura.estado === "error") {
            mostrarFormulario({
              extraccion: null,
              duplicado: null,
              error: lectura.error ?? MENSAJE_ERROR_RED,
            })
            return
          }

          // `pendiente`: nadie tomó la lectura (el `POST` de arranque no llegó
          // a destino). Se vuelve a pedir en vez de esperar para siempre.
          if (lectura.estado === "pendiente") {
            consulta = await arrancarLectura()
            continue
          }
        } else {
          // `red`. Sólo cuenta como falla si la pantalla está A LA VISTA: con
          // la pestaña oculta, no poder preguntar es lo esperable.
          if (document.visibilityState === "visible") {
            fallosDeRedSeguidos += 1
            if (fallosDeRedSeguidos >= MAX_FALLOS_DE_RED) {
              mostrarFormulario({ extraccion: null, duplicado: null, error: MENSAJE_ERROR_RED })
              return
            }
          }
        }

        if (Date.now() - arranque > ESPERA_MAXIMA_MS) {
          mostrarFormulario({ extraccion: null, duplicado: null, error: MENSAJE_TARDO_DEMASIADO })
          return
        }

        await dormir(INTERVALO_CONSULTA_MS)
        if (cancelado) return
        consulta = await consultarLectura()
      }
    }

    void bucle()

    return () => {
      cancelado = true
      despertar?.()
      document.removeEventListener("visibilitychange", alVolverAlFrente)
      window.removeEventListener("pageshow", alVolverAlFrente)
    }
  }, [documentoId])

  if (estado === "leyendo") {
    return (
      <VeloEspera
        visible
        mensaje="La inteligencia artificial está leyendo tu estudio…"
        submensaje="Podés bloquear el teléfono o cambiar de aplicación: la lectura sigue y cuando vuelvas va a estar lista."
      />
    )
  }

  return (
    <FormularioRevision
      documentoId={documentoId}
      extraccion={extraccion}
      mensajeError={mensajeError}
      duplicadoSemantico={duplicadoSemantico}
      tituloProvisional={tituloProvisional}
      categoriaProvisional={categoriaProvisional}
      fechaProvisional={fechaProvisional}
      fechaMaximaIso={fechaMaximaIso}
      medicos={medicos}
      catalogoDisponible={catalogoDisponible}
      titulosExistentes={titulosExistentes}
      medicamentosCargados={medicamentosCargados}
    />
  )
}
