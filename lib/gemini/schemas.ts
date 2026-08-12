/**
 * Schemas de `responseSchema` para las llamadas estructuradas a Gemini.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Este archivo NO ejecuta nada: son solo definiciones de datos (`Schema` de
 *  `@google/genai`) más los tipos TypeScript espejo que describen la forma del
 *  JSON que Gemini va a devolver. Se puede importar tanto desde servidor como
 *  desde código compartido sin ningún riesgo de exponer credenciales.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Type, type Schema } from '@google/genai';

/**
 * Schema del documento médico (Sprint 4 — ingesta de documentos).
 *
 * Modela la extracción que hace Gemini a partir de una foto o PDF de un
 * documento médico (análisis de laboratorio, informe de imágenes, receta o
 * resumen de consulta). Los nombres de campo son los mismos que usa el
 * roadmap (`fecha`, `especialidad`, `institucion`, `medico`, `resumen`,
 * `categoria`, `metricas[]`) para que el Route Handler del Sprint 4
 * (`app/api/documentos/extraer/route.ts`) pueda mapearlos directo a
 * `public.documents` / `public.lab_metrics` sin renombres intermedios.
 *
 * Ver `supabase/migrations/20260812200000_schema_inicial.sql`:
 * - `documents.category` es el enum `public.doc_category`, de ahí los cinco
 *   valores fijos de `categoria`.
 * - `lab_metrics` guarda `metric_name` / `value` / `unit` / `reference_range`,
 *   de ahí los cuatro campos de cada elemento de `metricas`.
 */
export const SCHEMA_DOCUMENTO_MEDICO: Schema = {
  type: Type.OBJECT,
  description:
    'Datos estructurados extraídos de un documento médico (análisis de laboratorio, ' +
    'informe de imágenes, receta o resumen de consulta).',
  properties: {
    fecha: {
      type: Type.STRING,
      format: 'date',
      description:
        'Fecha del documento en formato YYYY-MM-DD. Si el documento no trae fecha explícita, ' +
        'usar la fecha más probable mencionada en el texto; si no hay ninguna pista, usar cadena vacía.',
    },
    especialidad: {
      type: Type.STRING,
      description:
        'Especialidad médica relacionada (por ejemplo "Cardiología", "Clínica médica", ' +
        '"Endocrinología"). Cadena vacía si no se puede determinar.',
    },
    institucion: {
      type: Type.STRING,
      description:
        'Nombre del laboratorio, clínica, sanatorio o institución que emitió el documento. ' +
        'Cadena vacía si no figura.',
    },
    medico: {
      type: Type.STRING,
      description:
        'Nombre del profesional que firma, solicita o atiende (según corresponda al tipo de ' +
        'documento). Cadena vacía si no figura.',
    },
    resumen: {
      type: Type.STRING,
      description:
        'Resumen breve (2 a 4 oraciones) en español, en lenguaje claro para la persona paciente, ' +
        'de lo que dice el documento.',
    },
    categoria: {
      type: Type.STRING,
      format: 'enum',
      enum: ['laboratory', 'imaging', 'prescription', 'consultation', 'other'],
      description:
        'Categoría del documento — debe ser exactamente uno de estos valores: ' +
        '"laboratory" (análisis de laboratorio), "imaging" (imágenes o estudios como ' +
        'radiografía/ecografía/resonancia), "prescription" (receta médica), ' +
        '"consultation" (resumen o epicrisis de una consulta), "other" (cualquier otro caso).',
    },
    metricas: {
      type: Type.ARRAY,
      description:
        'Métricas numéricas de laboratorio detectadas en el documento (por ejemplo valores de un ' +
        'análisis de sangre). Lista vacía si el documento no es de laboratorio o no trae valores numéricos.',
      items: {
        type: Type.OBJECT,
        properties: {
          nombre: {
            type: Type.STRING,
            description: 'Nombre de la métrica tal como figura en el estudio (ej: "Glucemia en ayunas", "GLU").',
          },
          valor: {
            type: Type.NUMBER,
            description: 'Valor numérico medido, sin unidad ni texto adicional.',
          },
          unidad: {
            type: Type.STRING,
            description: 'Unidad de medida (ej: "mg/dl", "g/dl", "%"). Cadena vacía si no figura.',
          },
          rango: {
            type: Type.STRING,
            description:
              'Rango de referencia tal como aparece impreso en el estudio (ej: "70 - 110 mg/dl"). ' +
              'Cadena vacía si no figura.',
          },
        },
        required: ['nombre', 'valor', 'unidad', 'rango'],
        propertyOrdering: ['nombre', 'valor', 'unidad', 'rango'],
      },
    },
  },
  required: ['fecha', 'especialidad', 'institucion', 'medico', 'resumen', 'categoria', 'metricas'],
  propertyOrdering: ['fecha', 'especialidad', 'institucion', 'medico', 'resumen', 'categoria', 'metricas'],
};

/** Categorías válidas de documento médico — espejo de `public.doc_category`. */
export type CategoriaDocumentoExtraida =
  | 'laboratory'
  | 'imaging'
  | 'prescription'
  | 'consultation'
  | 'other';

/** Una métrica de laboratorio extraída de un documento (espejo de `public.lab_metrics`). */
export interface MetricaExtraida {
  nombre: string;
  valor: number;
  unidad: string;
  rango: string;
}

/**
 * Forma exacta del JSON que devuelve Gemini al usar `SCHEMA_DOCUMENTO_MEDICO`
 * como `responseSchema`. Es el tipo genérico `T` a pasarle a `extraerJson`.
 */
export interface DocumentoMedicoExtraido {
  fecha: string;
  especialidad: string;
  institucion: string;
  medico: string;
  resumen: string;
  categoria: CategoriaDocumentoExtraida;
  metricas: MetricaExtraida[];
}
