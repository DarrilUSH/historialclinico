/**
 * Título sugerido para la pantalla de revisión (Sprint 4, tarea 4.5;
 * reescrito en el Sprint 19 cuando la medición lo puso en números).
 *
 * ## El defecto que este archivo tenía, medido
 *
 * Hasta el Sprint 18 `SCHEMA_DOCUMENTO_MEDICO` no incluía ningún campo de
 * "título": Gemini devolvía `fecha`, `especialidad`, `institucion`, `medico`,
 * `resumen`, `categoria` y `metricas`, y el título lo COMPONÍA esta función
 * con la etiqueta de la categoría más el primer dato de contexto que hubiera.
 * El resultado, pasado por el camino real con 19 documentos del dueño:
 *
 * - **0 de 19 títulos acertados.** El título nunca decía QUÉ estudio era:
 *   "Estudio por imágenes — SANATORIO SAN JORGE S.R.L." tanto para una
 *   colangio-RMN como para una radiografía de tórax.
 * - **15 de 25 documentos compartían título con otro.** Cinco documentos
 *   distintos se llamaban "Estudio por imágenes — SANATORIO SAN JORGE
 *   S.R.L."; tres, "Consulta — …". Un historial así no se puede leer.
 * - Y como institución hay casi siempre, `detectado` daba `true` casi
 *   siempre, así que la pantalla decía "Detectado automáticamente" — que es
 *   una invitación a NO corregirlo.
 *
 * ## Lo que hace ahora
 *
 * El nombre del estudio lo dice el modelo (`DocumentoMedicoExtraido.titulo`,
 * regla 1 de `lib/gemini/prompt-documento.ts`): es el único que leyó el
 * documento y puede saber que es "Ecografía abdominal" y no "Estudio por
 * imágenes". Esta función pasa a USARLO, y el genérico
 * `<categoría> — <institución>` queda como ÚLTIMO RECURSO.
 *
 * `origen` dice de dónde salió el título, y es lo que la pantalla de revisión
 * usa para hablar con honestidad (`formulario-revision.tsx`):
 *
 * | `origen`     | de dónde salió                          | qué dice la UI                          |
 * |--------------|------------------------------------------|-----------------------------------------|
 * | `"modelo"`   | el nombre del estudio que leyó Gemini     | "Sugerido a partir de lo que detectamos"|
 * | `"compuesto"`| `<categoría> — <institución>` (fallback)  | "Poné un nombre para reconocerlo" + foco|
 * | `"categoria"`| solo la etiqueta de la categoría          | "Poné un nombre para reconocerlo" + foco|
 *
 * `detectado` se conserva -es lo que consume la compuerta de auto-carga,
 * `lib/gmail/auto-carga.ts`- pero cambia de significado, a propósito: ahora es
 * `true` SOLO cuando el modelo nombró el estudio. Que el camino automático se
 * ponga más exigente en esto es correcto: si en pantalla hace falta una
 * persona para poner el nombre, en la casilla de correo también.
 *
 * Módulo puro, isomórfico (sin `server-only`): se usa tanto en el Server
 * Component de `/estudios/nuevo/procesando` como en el Client Component
 * `formulario-revision.tsx`. El `import type` de `lib/gemini/schemas` es a
 * propósito -ese archivo importa `@google/genai` en tiempo de ejecución para
 * construir `SCHEMA_DOCUMENTO_MEDICO`, y un `import type` se elide del bundle
 * del cliente (mismo patrón ya usado en `pantalla-procesando.tsx`)-.
 */

import type { CategoriaDocumentoExtraida, DocumentoMedicoExtraido } from "@/lib/gemini/schemas"

const ETIQUETA_CATEGORIA: Record<CategoriaDocumentoExtraida, string> = {
  laboratory: "Análisis de laboratorio",
  imaging: "Estudio por imágenes",
  prescription: "Receta",
  consultation: "Consulta",
  other: "Documento",
}

/** De dónde salió el título sugerido. Ver la tabla del encabezado del archivo. */
export type OrigenTitulo = "modelo" | "compuesto" | "categoria"

export interface TituloSugerido {
  titulo: string
  /**
   * `true` SOLO si el título es el nombre del estudio que devolvió el modelo.
   * `false` para los dos fallbacks (`"compuesto"` y `"categoria"`): en los dos
   * casos el título no dice qué estudio es y conviene que lo escriba una
   * persona. Es la señal que consume la compuerta de auto-carga.
   */
  detectado: boolean
  origen: OrigenTitulo
}

/** Etiqueta de categoría en español, con fallback si llegara un valor fuera del enum (defensivo). */
export function etiquetaCategoria(categoria: CategoriaDocumentoExtraida): string {
  return ETIQUETA_CATEGORIA[categoria] ?? ETIQUETA_CATEGORIA.other
}

/**
 * Tope del título: el mismo `maxLength` del campo del formulario y de
 * `documents.title`. El schema Zod ya recorta a 200, así que acá es una
 * segunda red para los llamadores que no pasan por él.
 */
const MAX_LARGO_TITULO = 200

/**
 * ¿El título que devolvió el modelo sirve como título?
 *
 * Solo se descarta lo que no aporta NADA sobre qué estudio es: vacío, o la
 * etiqueta genérica de la categoría repetida tal cual ("Estudio por
 * imágenes"). Ese caso es exactamente el título que este sprint vino a
 * eliminar, y devolverlo como `"modelo"` sería mentirle a la pantalla: cae al
 * fallback, que al menos suma la institución y se marca como no detectado.
 */
function tituloDelModeloSirve(titulo: string, categoria: CategoriaDocumentoExtraida): boolean {
  if (titulo.length === 0) return false
  return normalizarTituloParaCotejo(titulo) !== normalizarTituloParaCotejo(etiquetaCategoria(categoria))
}

/**
 * Sugiere un título legible a partir de la extracción de Gemini.
 *
 * 1. El nombre del estudio que devolvió el modelo, si lo devolvió y sirve.
 * 2. Si no: `<categoría> — <institución|especialidad|médico>` (el genérico de
 *    siempre, ahora marcado como NO detectado).
 * 3. Si no hay ni eso: la etiqueta de la categoría, sola.
 */
export function sugerirTitulo(extraccion: DocumentoMedicoExtraido): TituloSugerido {
  const etiqueta = etiquetaCategoria(extraccion.categoria)

  const delModelo = (extraccion.titulo ?? "").trim().slice(0, MAX_LARGO_TITULO).trimEnd()
  if (tituloDelModeloSirve(delModelo, extraccion.categoria)) {
    return { titulo: delModelo, detectado: true, origen: "modelo" }
  }

  const complemento = [extraccion.institucion, extraccion.especialidad, extraccion.medico]
    .map((valor) => valor?.trim())
    .find((valor): valor is string => Boolean(valor && valor.length > 0))

  if (!complemento) {
    return { titulo: etiqueta, detectado: false, origen: "categoria" }
  }

  return { titulo: `${etiqueta} — ${complemento}`, detectado: false, origen: "compuesto" }
}

/** Marcas diacríticas combinantes que deja el `normalize("NFD")`. */
const DIACRITICOS = /[̀-ͯ]/g

/**
 * Clave de comparación de títulos: sin tildes, en minúsculas, sin puntuación
 * y con los espacios colapsados. "Ecografía Abdominal." y "ecografia
 * abdominal" son el mismo título para una persona que mira su lista, así que
 * también lo son para el aviso de repetido.
 */
export function normalizarTituloParaCotejo(titulo: string): string {
  return titulo
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * ¿Este título ya lo usa otro documento del MISMO perfil?
 *
 * Sirve al aviso de la pantalla de revisión ("Ya tenés un estudio con este
 * nombre"): se avisa, nunca se bloquea — dos estudios del mismo tipo el mismo
 * año pueden llamarse igual con todo derecho, y quien decide es la persona.
 * Un título vacío nunca cuenta como repetido.
 */
export function tituloYaUsado(titulo: string, titulosDelPerfil: readonly string[]): boolean {
  const clave = normalizarTituloParaCotejo(titulo)
  if (clave.length === 0) return false
  return titulosDelPerfil.some((existente) => normalizarTituloParaCotejo(existente) === clave)
}
