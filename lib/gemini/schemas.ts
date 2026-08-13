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
 *
 * ## `texto_completo` — decisión de costo/beneficio (Route Handler del Sprint 4)
 *
 * `documents.raw_ocr_text` existe en el esquema desde la migración inicial
 * ("Texto crudo devuelto por el OCR/modelo. Se guarda para poder reprocesar
 * sin volver a leer el archivo"), pero hasta este Route Handler ningún campo
 * de `SCHEMA_DOCUMENTO_MEDICO` lo alimentaba. Se agrega `texto_completo` como
 * el noveno... (en realidad octavo) campo, pero **deliberadamente NO** en
 * `required`: pedirle a Gemini una transcripción completa en CADA documento
 * multiplicaría los tokens de salida (y el costo/latencia) de la llamada más
 * frecuente del producto, para un beneficio -reprocesar sin releer el
 * archivo- que hoy ningún sprint consume todavía. La solución intermedia:
 * un extracto ACOTADO (ver el límite en la descripción del campo más abajo)
 * que el modelo puede omitir si el documento no aporta texto adicional al
 * `resumen`. `app/api/documentos/extraer/route.ts` además lo trunca de nuevo
 * en el servidor antes de persistir, por si el modelo no respeta el límite.
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
    texto_completo: {
      type: Type.STRING,
      description:
        'OPCIONAL — extracto acotado (máximo ~500 caracteres) del texto más relevante del ' +
        'documento que no haya quedado ya cubierto por los demás campos (nombres, fechas, valores, ' +
        'diagnósticos textuales). Sirve para poder reprocesar el documento más adelante sin volver a ' +
        'leer el archivo. NO es una transcripción completa: omitir este campo si el documento es ' +
        'largo o si el resumen ya alcanza para representarlo.',
    },
  },
  required: ['fecha', 'especialidad', 'institucion', 'medico', 'resumen', 'categoria', 'metricas'],
  propertyOrdering: [
    'fecha',
    'especialidad',
    'institucion',
    'medico',
    'resumen',
    'categoria',
    'metricas',
    'texto_completo',
  ],
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
 *
 * `texto_completo` es `?` (y no `string`) porque NO está en `required` del
 * schema: ver el comentario de costo/beneficio sobre `SCHEMA_DOCUMENTO_MEDICO`
 * más arriba en este archivo.
 */
export interface DocumentoMedicoExtraido {
  fecha: string;
  especialidad: string;
  institucion: string;
  medico: string;
  resumen: string;
  categoria: CategoriaDocumentoExtraida;
  metricas: MetricaExtraida[];
  texto_completo?: string;
}
