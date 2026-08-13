/**
 * Título sugerido para la pantalla de revisión (Sprint 4, tarea 4.5).
 *
 * `SCHEMA_DOCUMENTO_MEDICO` (`lib/gemini/schemas.ts`) no incluye un campo de
 * "título": Gemini devuelve `fecha`, `especialidad`, `institucion`, `medico`,
 * `resumen`, `categoria` y `metricas`. El título que ve la persona en la
 * pantalla de revisión y en la lista de `/estudios` lo arma esta función,
 * componiendo la etiqueta de la categoría con el primer dato de contexto real
 * que haya (institución, especialidad o médico, en ese orden).
 *
 * `detectado: false` cuando no hay ningún dato de contexto -el título quedó
 * en la etiqueta genérica de la categoría- es la señal que usa
 * `formulario-revision.tsx` para marcar el campo Título con la ayuda "No se
 * detectó — completalo vos" en vez de "Detectado automáticamente".
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

export interface TituloSugerido {
  titulo: string
  /**
   * `true` si el título se armó con un dato real de la extracción
   * (institución, especialidad o médico). `false` si es solo la etiqueta
   * genérica de la categoría: la extracción no trajo ningún dato de
   * contexto y conviene que la persona lo complete a mano.
   */
  detectado: boolean
}

/** Etiqueta de categoría en español, con fallback si llegara un valor fuera del enum (defensivo). */
export function etiquetaCategoria(categoria: CategoriaDocumentoExtraida): string {
  return ETIQUETA_CATEGORIA[categoria] ?? ETIQUETA_CATEGORIA.other
}

/**
 * Sugiere un título legible a partir de la extracción de Gemini.
 *
 * Prioridad del complemento: institución (el dato más identificable — "quién
 * me lo hizo") > especialidad > médico. Cadenas vacías o solo espacios no
 * cuentan como dato real.
 */
export function sugerirTitulo(extraccion: DocumentoMedicoExtraido): TituloSugerido {
  const etiqueta = etiquetaCategoria(extraccion.categoria)

  const complemento = [extraccion.institucion, extraccion.especialidad, extraccion.medico]
    .map((valor) => valor?.trim())
    .find((valor): valor is string => Boolean(valor && valor.length > 0))

  if (!complemento) {
    return { titulo: etiqueta, detectado: false }
  }

  return { titulo: `${etiqueta} — ${complemento}`, detectado: true }
}
