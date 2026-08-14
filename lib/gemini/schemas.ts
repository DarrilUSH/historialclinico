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
import { z } from 'zod';

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

/* ═══════════════════════════════════════════════════════════════════════════
 * Schema de la ficha de resumen para consulta (Sprint 10, tarea 10.3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A diferencia de `SCHEMA_DOCUMENTO_MEDICO` de arriba, acá el espejo Zod
 *  **vive en este mismo archivo** en vez de en `lib/validacion/`. Es una
 *  excepción deliberada: `FichaGeneradaSchema` no valida el input de una
 *  Server Action ni de un formulario -no hay nada que una persona tipee-,
 *  sino la ÚNICA salida de un ÚNICO Route Handler
 *  (`app/api/ficha/generar/route.ts`), y esa salida está definida en función
 *  del mismo `SCHEMA_FICHA_CONSULTA` de acá abajo: mantener las dos
 *  definiciones en el mismo archivo, con los mismos títulos de sección como
 *  única fuente (`TITULOS_SECCION_FICHA`), es lo que hace imposible que
 *  diverjan con el tiempo.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué cada sección lleva un `titulo` FIJO, generado por Gemini
 *
 * El criterio de aceptación del roadmap pide que "una segunda generación con
 * los mismos datos produzca secciones EQUIVALENTES EN ESTRUCTURA". La forma
 * más simple de garantizarlo -sin comparar el CONTENIDO, que varía en cada
 * llamada por diseño (Gemini no es determinista)- es que cada sección
 * declare su propio título contra un `enum` de UN solo valor: si Gemini no
 * devuelve exactamente ese string, `responseSchema` ya lo rechaza del lado de
 * Google, y si igual lo dejara pasar, `FichaGeneradaSchema` (con `z.literal`)
 * lo rechaza acá. El título nunca es libre, así que la estructura de la
 * ficha no puede "derivar" entre generaciones: son siempre las mismas seis
 * secciones, con el mismo rótulo, con contenido distinto.
 *
 * ## Por qué `preguntasSugeridas` es la única sección con un array
 *
 * El roadmap las describe como una lista ("3 a 5"), no un párrafo: forzar un
 * array en el schema (`.min(3).max(5)`) hace que la CANTIDAD sea una
 * propiedad verificable de la respuesta, no una instrucción del prompt que
 * Gemini puede ignorar.
 *
 * ## Por qué `aviso` se valida con `.refine`, no solo con el prompt
 *
 * El criterio de aceptación exige que el aviso "resumen asistido por IA, no
 * sustituye criterio médico" **aparezca en la salida**. El prompt
 * (`lib/gemini/prompt-ficha.ts`) ya se lo pide a Gemini de forma explícita
 * -incluso le sugiere el texto completo-, pero un prompt es una petición, no
 * una garantía: un modelo de lenguaje puede omitirla o parafrasearla fuera de
 * los límites esperados. El `.refine` convierte el criterio del roadmap en
 * una comprobación que corre en TODAS las respuestas: si Gemini alguna vez
 * la omite, la ficha se rechaza como inválida y `lib/gemini/reintento.ts`
 * (usado por `lib/ficha/generar.ts`) pide una segunda respuesta antes de
 * fallar. El criterio del roadmap es así una validación, no una esperanza.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Títulos FIJOS de cada sección de la ficha. Única fuente: tanto
 * `SCHEMA_FICHA_CONSULTA` (como `enum` de un valor) como `FichaGeneradaSchema`
 * (como `z.literal`) como `lib/gemini/prompt-ficha.ts` (como texto del
 * prompt) importan estas constantes en vez de repetir los strings.
 */
export const TITULOS_SECCION_FICHA = {
  motivoConsulta: 'Motivo de consulta sugerido',
  antecedentesRelevantes: 'Antecedentes relevantes',
  medicacionActual: 'Medicación actual',
  estudiosRecientes: 'Estudios recientes',
  valoresFueraDeRango: 'Valores fuera de rango',
  preguntasSugeridas: 'Preguntas sugeridas para el médico',
} as const;

/** Construye el `Schema` de una sección "simple" (título fijo + contenido en texto libre). */
function schemaSeccionFicha(titulo: string, descripcionContenido: string): Schema {
  return {
    type: Type.OBJECT,
    properties: {
      titulo: {
        type: Type.STRING,
        format: 'enum',
        enum: [titulo],
        description: `Título fijo de la sección. Tiene que ser EXACTAMENTE: "${titulo}".`,
      },
      contenido: {
        type: Type.STRING,
        description: descripcionContenido,
      },
    },
    required: ['titulo', 'contenido'],
    propertyOrdering: ['titulo', 'contenido'],
  };
}

/**
 * `responseSchema` de la ficha de resumen para consulta: seis secciones de
 * tamaño acotado -pensadas para entrar en UNA hoja impresa- más un aviso
 * obligatorio. Ver el bloque de comentarios de arriba para el porqué de cada
 * decisión de forma.
 */
export const SCHEMA_FICHA_CONSULTA: Schema = {
  type: Type.OBJECT,
  description:
    'Ficha de resumen para llevar a una consulta médica: seis secciones de tamaño acotado, ' +
    'pensadas para entrar en una hoja impresa, más un aviso obligatorio sobre el origen del resumen.',
  properties: {
    motivoConsulta: schemaSeccionFicha(
      TITULOS_SECCION_FICHA.motivoConsulta,
      'Una o dos oraciones que sugieren de qué podría tratarse la consulta, basadas en alertas ' +
        'activas, medicación por renovar o valores fuera de rango. Si no hay ningún disparador ' +
        'claro en los datos, decilo explícitamente (ej: "Consulta de control, sin motivo urgente ' +
        'detectado en los datos cargados").',
    ),
    antecedentesRelevantes: schemaSeccionFicha(
      TITULOS_SECCION_FICHA.antecedentesRelevantes,
      'Listado breve (con guiones "- ", uno por línea) de grupo sanguíneo, alergias, condiciones ' +
        'crónicas, medicación crítica y notas de la ficha SOS. Si no hay antecedentes cargados, ' +
        'decilo explícitamente.',
    ),
    medicacionActual: schemaSeccionFicha(
      TITULOS_SECCION_FICHA.medicacionActual,
      'Listado breve (con guiones "- ", uno por línea) de la medicación activa: nombre, dosis y ' +
        'frecuencia. Marcá la que tenga poco stock. Si no toma medicación, decilo explícitamente.',
    ),
    estudiosRecientes: schemaSeccionFicha(
      TITULOS_SECCION_FICHA.estudiosRecientes,
      'Listado breve (con guiones "- ", uno por línea) de los estudios recientes: fecha, categoría ' +
        'y qué mostraron en una frase. Si no hay estudios, decilo explícitamente.',
    ),
    valoresFueraDeRango: schemaSeccionFicha(
      TITULOS_SECCION_FICHA.valoresFueraDeRango,
      'Listado breve (con guiones "- ", uno por línea) de las métricas de laboratorio o signos ' +
        'vitales cuyo último valor esté fuera del rango de referencia o haya disparado una alerta. ' +
        'Si no hay ninguno, decilo explícitamente (ej: "Sin valores fuera de rango en los últimos ' +
        'registros").',
    ),
    preguntasSugeridas: {
      type: Type.OBJECT,
      properties: {
        titulo: {
          type: Type.STRING,
          format: 'enum',
          enum: [TITULOS_SECCION_FICHA.preguntasSugeridas],
          description: `Título fijo. Tiene que ser EXACTAMENTE: "${TITULOS_SECCION_FICHA.preguntasSugeridas}".`,
        },
        preguntas: {
          type: Type.ARRAY,
          description:
            'Entre 3 y 5 preguntas concretas para hacerle al médico en esta consulta, basadas en ' +
            'los datos recibidos. Nunca preguntas genéricas de relleno.',
          items: { type: Type.STRING },
        },
      },
      required: ['titulo', 'preguntas'],
      propertyOrdering: ['titulo', 'preguntas'],
    },
    aviso: {
      type: Type.STRING,
      description:
        'Descargo obligatorio, en español, que declare que esta ficha fue generada con ' +
        'inteligencia artificial a partir de los datos cargados en la aplicación y que ' +
        'contenga LITERALMENTE la frase "no sustituye" o "no reemplaza el criterio médico".',
    },
  },
  required: [
    'motivoConsulta',
    'antecedentesRelevantes',
    'medicacionActual',
    'estudiosRecientes',
    'valoresFueraDeRango',
    'preguntasSugeridas',
    'aviso',
  ],
  propertyOrdering: [
    'motivoConsulta',
    'antecedentesRelevantes',
    'medicacionActual',
    'estudiosRecientes',
    'valoresFueraDeRango',
    'preguntasSugeridas',
    'aviso',
  ],
};

/** Una sección "simple" de la ficha: título fijo + contenido en texto libre. */
export interface SeccionFichaGenerada {
  titulo: string;
  contenido: string;
}

/** La sección de preguntas: título fijo + array de 3 a 5 preguntas. */
export interface PreguntasSugeridasGenerada {
  titulo: string;
  preguntas: string[];
}

/** Forma exacta del JSON que Gemini devuelve al usar `SCHEMA_FICHA_CONSULTA` como `responseSchema`. */
export interface FichaConsultaExtraida {
  motivoConsulta: SeccionFichaGenerada;
  antecedentesRelevantes: SeccionFichaGenerada;
  medicacionActual: SeccionFichaGenerada;
  estudiosRecientes: SeccionFichaGenerada;
  valoresFueraDeRango: SeccionFichaGenerada;
  preguntasSugeridas: PreguntasSugeridasGenerada;
  aviso: string;
}

/**
 * Quita diacríticos y pasa a minúsculas, para que la validación del aviso no
 * dependa de que Gemini escriba "médico" con tilde. Mismo criterio de
 * normalización que `slugificarNombre` en `app/api/signos/export/route.ts`.
 */
function normalizarParaBusqueda(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Cualquiera de estas frases (normalizadas) alcanza para que el aviso cumpla el criterio del roadmap. */
const FRASES_AVISO_VALIDAS = ['no sustituye', 'no reemplaza el criterio medico'];

const MENSAJE_TITULO_SECCION = (titulo: string) =>
  `El título de esta sección tiene que ser exactamente "${titulo}".`;

/** Schema Zod de una sección "simple": título fijo (`z.literal`) + contenido no vacío. */
function seccionFichaSchema(titulo: string, maxContenido: number) {
  return z
    .object({
      titulo: z.literal(titulo, { message: MENSAJE_TITULO_SECCION(titulo) }),
      contenido: z
        .string({ message: 'El contenido de la sección debe ser texto.' })
        .trim()
        .min(1, 'El contenido de la sección no puede estar vacío.')
        .max(maxContenido, `El contenido de la sección es demasiado largo (máx. ${maxContenido} caracteres).`),
    })
    .strict();
}

/**
 * Schema Zod espejo de `SCHEMA_FICHA_CONSULTA`, EJECUTABLE: valida la
 * respuesta cruda de Gemini antes de devolverla desde
 * `app/api/ficha/generar/route.ts`. Usa `zod` v4 (`.issues`, no `.errors`).
 */
export const FichaGeneradaSchema = z
  .object({
    motivoConsulta: seccionFichaSchema(TITULOS_SECCION_FICHA.motivoConsulta, 400),
    antecedentesRelevantes: seccionFichaSchema(TITULOS_SECCION_FICHA.antecedentesRelevantes, 900),
    medicacionActual: seccionFichaSchema(TITULOS_SECCION_FICHA.medicacionActual, 900),
    estudiosRecientes: seccionFichaSchema(TITULOS_SECCION_FICHA.estudiosRecientes, 900),
    valoresFueraDeRango: seccionFichaSchema(TITULOS_SECCION_FICHA.valoresFueraDeRango, 600),

    preguntasSugeridas: z
      .object({
        titulo: z.literal(TITULOS_SECCION_FICHA.preguntasSugeridas, {
          message: MENSAJE_TITULO_SECCION(TITULOS_SECCION_FICHA.preguntasSugeridas),
        }),
        preguntas: z
          .array(
            z
              .string({ message: 'Cada pregunta debe ser texto.' })
              .trim()
              .min(1, 'Una pregunta sugerida no puede estar vacía.')
              .max(240, 'Una pregunta sugerida es demasiado larga (máx. 240 caracteres).'),
          )
          .min(3, 'Tiene que haber al menos 3 preguntas sugeridas.')
          .max(5, 'No puede haber más de 5 preguntas sugeridas.'),
      })
      .strict(),

    // DEBE contener el descargo del roadmap ("no sustituye"/"no reemplaza el
    // criterio médico") — ver el porqué en el bloque de comentarios de arriba.
    aviso: z
      .string({ message: 'El aviso debe ser texto.' })
      .trim()
      .min(1, 'El aviso no puede estar vacío.')
      .max(700, 'El aviso es demasiado largo (máx. 700 caracteres).')
      .refine(
        (valor) => {
          const normalizado = normalizarParaBusqueda(valor);
          return FRASES_AVISO_VALIDAS.some((frase) => normalizado.includes(frase));
        },
        {
          message:
            'El aviso debe advertir explícitamente que el resumen no sustituye ni reemplaza el ' +
            'criterio médico.',
        },
      ),
  })
  .strict();

/** Forma validada de la ficha generada — lo que devuelve `{ ficha }` en `app/api/ficha/generar/route.ts`. */
export type FichaGenerada = z.infer<typeof FichaGeneradaSchema>;

/**
 * Valida un objeto desconocido (la respuesta cruda de Gemini) contra
 * `FichaGeneradaSchema`.
 *
 * Mismo contrato que `validarExtraccion` (`lib/validacion/documento.schema.ts`):
 * `{ ok: true, datos }` o `{ ok: false, errores }`, con mensajes en español
 * listos para loguear. Los `errores` describen la ESTRUCTURA que falló
 * ("falta la sección X", "el aviso no menciona..."), nunca el contenido
 * recibido — así es seguro loguearlos sin violar la regla de "el contexto
 * nunca se loguea" (`docs/minimizacion-datos.md` §6).
 */
export function validarFichaGenerada(
  data: unknown,
): { ok: true; datos: FichaGenerada } | { ok: false; errores: string[] } {
  const resultado = FichaGeneradaSchema.safeParse(data);

  if (resultado.success) {
    return { ok: true, datos: resultado.data };
  }

  const errores = resultado.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(raíz)';
    return `[${path}] ${issue.message}`;
  });

  return { ok: false, errores };
}
