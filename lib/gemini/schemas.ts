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
    numero_orden: {
      type: Type.STRING,
      description:
        'OPCIONAL — el número de orden, protocolo o identificador del estudio tal como lo imprime ' +
        'el laboratorio o la institución (por ejemplo "N° de Orden: 1446188", "Protocolo 24601", ' +
        '"OP-3391"). Copiá solo el número/código, sin el rótulo ("1446188", no "N° de Orden: ' +
        '1446188"). Es el dato que el detector de duplicados usa para reconocer el MISMO estudio ' +
        'aunque el PDF se haya vuelto a generar con otros bytes -no lo confundas con el número de ' +
        'afiliado, el DNI, ni ningún otro código del documento-. Cadena vacía si el documento no trae ' +
        'ningún número de orden visible — no lo inventes.',
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
    'numero_orden',
  ],
};

/**
 * Variante de `SCHEMA_DOCUMENTO_MEDICO` que además pregunta **a nombre de
 * quién está emitido el documento** (auto-carga sin dudas, Sprint 17).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE SCHEMA ES EXCLUSIVO DEL CAMINO AUTOMÁTICO. La subida a mano, el
 *      Web Share Target y el "Revisar este estudio" de la bandeja siguen
 *      usando `SCHEMA_DOCUMENTO_MEDICO` de arriba, SIN el campo `paciente`:
 *      su contrato de privacidad no cambia en nada.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué existe un schema aparte y no un campo más en el de siempre
 *
 * Agregar `paciente` al schema único haría que TODAS las extracciones del
 * producto -incluidas las que una persona está mirando en pantalla y va a
 * confirmar a mano- devolvieran el nombre del paciente, un dato identificatorio
 * que hoy no sale de ningún documento (`docs/minimizacion-datos.md` §4.1). El
 * camino automático es el único que lo NECESITA, y lo necesita por un motivo
 * de seguridad, no de producto: sin cotejar el nombre, una casilla que recibe
 * los estudios de la madre podría cargárselos solos al historial del hijo. Un
 * schema derivado deja el dato acotado a ese único camino y hace imposible que
 * los dos se separen: las siete propiedades y el `required` del base se
 * reutilizan tal cual, no se copian.
 *
 * ## Qué se hace con el nombre y qué NO
 *
 * Se compara en memoria contra `profiles.full_name` del perfil de destino
 * (`lib/gmail/coincidencia-nombre.ts`) y se descarta. **No se persiste en
 * ninguna tabla, no se escribe en ningún log y no vuelve al navegador.** Lo
 * único que sobrevive a la comparación es un booleano. Ver
 * `docs/minimizacion-datos.md` §10.7.
 */
export const SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE: Schema = {
  ...SCHEMA_DOCUMENTO_MEDICO,
  description:
    'Datos estructurados extraídos de un documento médico, incluyendo a nombre de qué persona ' +
    'está emitido (para verificar que corresponde al historial al que se lo va a agregar).',
  properties: {
    ...SCHEMA_DOCUMENTO_MEDICO.properties,
    paciente: {
      type: Type.STRING,
      description:
        'Nombre y apellido de la PERSONA PACIENTE a cuyo nombre está emitido el documento, tal como ' +
        'figura impreso (por ejemplo en "Paciente:", "Apellido y Nombre:", el encabezado del informe o ' +
        'la carátula del laboratorio). NO es el médico que firma ni quien solicitó el estudio. Copialo ' +
        'literal, sin reordenar ni completar: si dice "GOMEZ, ROBERTO CARLOS" devolvé eso mismo. ' +
        'Cadena vacía si el documento no trae ningún nombre de paciente — no lo deduzcas de nada.',
    },
  },
  required: [...(SCHEMA_DOCUMENTO_MEDICO.required ?? []), 'paciente'],
  propertyOrdering: ['paciente', ...(SCHEMA_DOCUMENTO_MEDICO.propertyOrdering ?? [])],
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
  /**
   * Resultado CUALITATIVO cuando el estudio no produce un valor numérico
   * ("Negativo", "No reactivo", "No se observan espermatozoides") — Sprint
   * 18, tarea de resultados cualitativos. Espejo de `lab_metrics.value_text`
   * (`supabase/migrations/20260819190000_lab_metrics_resultados_cualitativos.sql`).
   *
   * OPCIONAL y ADITIVO a propósito: ni `SCHEMA_DOCUMENTO_MEDICO` (arriba, el
   * `responseSchema` real que Gemini recibe) ni
   * `lib/validacion/documento.schema.ts` piden o aceptan todavía este campo
   * -los dos siguen exigiendo `valor` numérico en cada métrica-, así que
   * agregarlo acá no cambia en nada el contrato de la extracción en vivo.
   * Sirve hoy para que `lib/laboratorio/normalizacion.ts#prepararMetricas`
   * (y sus tests) tengan un campo tipado con el que trabajar; cablear la
   * extracción real (prompt + `responseSchema` + validación Zod) es una
   * ampliación pendiente, documentada como deuda en el Resumen de Entrega
   * del Sprint 18 -esos tres archivos quedaron fuera del alcance de esa
   * tarea por trabajo en paralelo sobre `lib/gemini/prompt-documento.ts` y
   * `lib/validacion/documento.schema.ts`-.
   */
  valorTexto?: string;
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
  /**
   * Número de orden/protocolo del estudio, tal como lo imprime el laboratorio
   * (hotfix de duplicados semánticos). `?` porque NO está en `required` del
   * schema -no todo documento lo trae (una receta o un informe de imágenes
   * rara vez tiene uno)-, mismo criterio que `texto_completo`.
   */
  numero_orden?: string;
}

/**
 * Lo que devuelve Gemini con `SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE`: la misma
 * extracción de siempre más el nombre del paciente.
 *
 * `paciente` es OPCIONAL en el tipo aunque el schema lo pida en `required`:
 * defensivo, porque un modelo puede omitir un campo pedido y la compuerta de
 * auto-carga tiene que poder tratar "no vino" exactamente igual que "vino
 * vacío" — como una DUDA, que manda el correo a revisión humana.
 *
 * Este tipo NUNCA se persiste con el campo puesto: ver el comentario de
 * `SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE`.
 */
export interface DocumentoMedicoConPacienteExtraido extends DocumentoMedicoExtraido {
  paciente?: string;
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
      'Historial clínico contado por episodios (con guiones "- ", uno por línea), del más reciente ' +
        'al más viejo: qué le pasó, qué se le encontró y qué se le hizo en cada uno. UNA línea por ' +
        'episodio, nunca una por documento, y nunca una línea que describa el papel (su fecha, su ' +
        'tipo o dónde se emitió) en lugar de lo que ocurrió. Si no hay episodios, decilo ' +
        'explícitamente.',
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
    // 1200, no 900 como las otras: desde la versión 2 del contexto
    // (`lib/ficha/armado.ts`) esta sección cuenta el historial AGRUPADO POR
    // EPISODIO -una internación entera en una línea- en vez de listar los
    // cinco archivos más nuevos. Es el techo de una sección que ahora abarca
    // años, no un permiso para escribir de más: el prompt le sigue pidiendo a
    // Gemini que todo entre en una hoja A4.
    estudiosRecientes: seccionFichaSchema(TITULOS_SECCION_FICHA.estudiosRecientes, 1200),
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

/* ═══════════════════════════════════════════════════════════════════════════
 * Schema del análisis de un mensaje de turno pegado desde WhatsApp (Sprint
 * 16, tarea 16.4 — "pegá el mensaje que te mandó la clínica").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Igual que `SCHEMA_DOCUMENTO_MEDICO`, este schema pide una EXTRACCIÓN
 *  literal, no un cálculo. La aritmética de calendario (año inferido, cotejo
 *  de día de la semana), la reordenación de nombres "Apellido, Nombre" y el
 *  mapeo al catálogo de especialidades NO se le piden a Gemini: viven en
 *  `lib/turnos/normalizacion-mensaje.ts` y
 *  `lib/especialidades/mapear-catalogo.ts`, código determinístico y
 *  testeado. Pedirle a un modelo de lenguaje que haga cuentas de fechas es
 *  exactamente el tipo de tarea donde puede errar con total confianza y sin
 *  avisar -acá el cálculo es verificable con casos fijos, ahí no-. El trabajo
 *  que SÍ le corresponde al modelo es el que un programa no puede hacer sin
 *  entender el texto: decidir si "MAMOGRAFIA MAMOGRAFIA" es una persona o un
 *  estudio, inferir "Ginecología" de un mensaje que solo habla de
 *  colposcopías, o decidir si dos mensajes pegados juntos son dos turnos
 *  distintos o un turno contado en dos partes.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué NO hay un campo de paciente/DNI
 *
 * El mensaje real de una clínica trae casi siempre el nombre y a veces el DNI
 * del paciente (`docs/minimizacion-datos.md` §10). Ningún campo de este
 * schema los pide: no es que se extraigan y se descarten después, es que
 * **no existe dónde ponerlos** -la lista blanca es el schema mismo, mismo
 * principio que `ContextoClinico` en `lib/ficha/armado.ts`
 * (`docs/minimizacion-datos.md` §1, regla 2: "el tipo es la lista blanca")-.
 * El prompt (`lib/gemini/prompt-turno.ts`) además le pide explícitamente al
 * modelo que los ignore.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Si el campo "Profesional"/"Prestador"/"Práctica" del mensaje nombra una persona, un estudio, o no aparece. */
export const TIPOS_PROFESIONAL_MENSAJE_TURNO = ['persona', 'estudio', 'ninguno'] as const;
export type TipoProfesionalMensajeTurno = (typeof TIPOS_PROFESIONAL_MENSAJE_TURNO)[number];

/**
 * Cómo se relacionan los turnos detectados en el texto pegado, cuando trae
 * más de un mensaje de WhatsApp concatenado (`tests/fixtures/mensajes-turno/README.md`
 * §"Varios mensajes en un solo paste"):
 * - `unico`: un solo turno, el caso más común.
 * - `varios_turnos`: DOS mensajes con el mismo template repetido, cada uno
 *   con su fecha/hora completas — son turnos DISTINTOS, hay que dividirlos.
 * - `turno_mas_confirmacion`: un mensaje largo con contexto + un segundo
 *   mensaje corto de confirmación con los datos finales — es UN turno, hay
 *   que fusionarlos (la confirmación gana en día/hora/profesional).
 */
export const RELACIONES_MENSAJE_TURNO = ['unico', 'varios_turnos', 'turno_mas_confirmacion'] as const;
export type RelacionMensajeTurno = (typeof RELACIONES_MENSAJE_TURNO)[number];

function schemaTurnoExtraidoCrudo(): Schema {
  return {
    type: Type.OBJECT,
    description: 'Datos de UN turno tal como aparecen en el mensaje, sin convertir ni completar nada.',
    properties: {
      fechaTexto: {
        type: Type.STRING,
        description:
          'La fecha EXACTAMENTE como aparece en el mensaje (ej: "07/10/2024", "14/7", "26/5"). NO le agregues ' +
          'el año si no está, NO la conviertas a otro formato. Cadena vacía si el mensaje no trae fecha.',
      },
      diaSemanaTexto: {
        type: Type.STRING,
        description:
          'El día de la semana tal como aparece junto a la fecha (ej: "martes", "Mie"), si el mensaje lo ' +
          'menciona. Cadena vacía si no lo menciona.',
      },
      horaTexto: {
        type: Type.STRING,
        description:
          'La hora EXACTAMENTE como aparece en el mensaje (ej: "14:15 HS", "18.10hs", "09:45 hs"). Cadena ' +
          'vacía si el mensaje NO menciona una hora — nunca inventes ni asumas una hora por defecto.',
      },
      tipoProfesional: {
        type: Type.STRING,
        format: 'enum',
        enum: [...TIPOS_PROFESIONAL_MENSAJE_TURNO],
        description:
          '"persona" si el campo de profesional/prestador/práctica nombra a una persona; "estudio" si en ' +
          'realidad nombra un estudio o práctica (ej: "MAMOGRAFIA MAMOGRAFIA", una punción); "ninguno" si el ' +
          'mensaje no trae ningún campo de este tipo.',
      },
      profesionalTexto: {
        type: Type.STRING,
        description:
          'El nombre de la persona o del estudio/práctica, ya limpio del rótulo del campo y de la parte del ' +
          'texto que describe el servicio si viene junto (de "SERV. DE ECOGRAFIA - DR. JUAREZ" extraé solo ' +
          '"Dr. Juárez"). Usá mayúscula/minúscula y tildes correctas del castellano si es una persona, pero NO ' +
          'reordenes "Apellido, Nombre" ni "Apellido Nombre" — conservá la coma y el orden tal como aparecen, ' +
          'eso se procesa aparte. Cadena vacía si tipoProfesional es "ninguno".',
      },
      especialidadTexto: {
        type: Type.STRING,
        description:
          'La especialidad médica, explícita o inferida del contexto (tipo de estudio, prácticas mencionadas). ' +
          'Cadena vacía si no hay ninguna pista razonable — no adivines al azar.',
      },
      especialidadInferida: {
        type: Type.BOOLEAN,
        description:
          '`true` si especialidadTexto NO estaba escrita explícitamente en el mensaje y la inferiste vos del ' +
          'contexto. `false` si el mensaje la menciona tal cual (o si especialidadTexto quedó vacía).',
      },
      lugarNombre: {
        type: Type.STRING,
        description: 'Nombre de la sede/institución/consultorio. Cadena vacía si no figura.',
      },
      lugarDireccion: {
        type: Type.STRING,
        description:
          'Calle y altura, SOLO si el mensaje la menciona explícitamente. Si el lugar aparece solo por su ' +
          'nombre en clave (ej: "Centro: LORIA") sin ninguna dirección, dejá este campo vacío — no inventes una.',
      },
      lugarCiudad: {
        type: Type.STRING,
        description: 'Localidad/ciudad del lugar, si el mensaje la menciona (por ejemplo dentro de una dirección completa). Cadena vacía si no figura.',
      },
      lugarProvincia: {
        type: Type.STRING,
        description: 'Provincia del lugar, si el mensaje la menciona. Cadena vacía si no figura.',
      },
      notas: {
        type: Type.ARRAY,
        description:
          'Un elemento de texto por cada aviso operativo del mensaje: preparación previa, qué llevar, montos/' +
          'coseguros/copagos, pedido de confirmar asistencia, checklist de documentación requerida, etc. NO ' +
          'agregues nada si el mensaje dice explícitamente que NO hace falta preparación (ej: "No requiere.") ' +
          '— una ausencia de preparación no es una nota. Lista vacía si el mensaje no trae ningún aviso de este tipo.',
        items: { type: Type.STRING },
      },
    },
    required: [
      'fechaTexto',
      'diaSemanaTexto',
      'horaTexto',
      'tipoProfesional',
      'profesionalTexto',
      'especialidadTexto',
      'especialidadInferida',
      'lugarNombre',
      'lugarDireccion',
      'lugarCiudad',
      'lugarProvincia',
      'notas',
    ],
    propertyOrdering: [
      'fechaTexto',
      'diaSemanaTexto',
      'horaTexto',
      'tipoProfesional',
      'profesionalTexto',
      'especialidadTexto',
      'especialidadInferida',
      'lugarNombre',
      'lugarDireccion',
      'lugarCiudad',
      'lugarProvincia',
      'notas',
    ],
  };
}

/**
 * `responseSchema` del análisis de un mensaje de turno. `turnos` es un array
 * (no un objeto único) porque un solo paste puede traer más de un mensaje
 * concatenado — ver `RELACIONES_MENSAJE_TURNO` arriba.
 */
export const SCHEMA_ANALISIS_MENSAJE_TURNO: Schema = {
  type: Type.OBJECT,
  description:
    'Análisis de un mensaje de WhatsApp de una clínica que asigna o recuerda uno o más turnos médicos.',
  properties: {
    turnos: {
      type: Type.ARRAY,
      description:
        'Un elemento por cada turno identificado, en el orden en que aparecen en el texto. Normalmente uno ' +
        'solo. Si relacion es "turno_mas_confirmacion", EXACTAMENTE dos elementos: primero el mensaje con más ' +
        'contexto, segundo el de confirmación.',
      items: schemaTurnoExtraidoCrudo(),
    },
    relacion: {
      type: Type.STRING,
      format: 'enum',
      enum: [...RELACIONES_MENSAJE_TURNO],
      description:
        '"unico" para un solo turno (el caso más común); "varios_turnos" si el texto trae dos turnos DISTINTOS ' +
        'pegados; "turno_mas_confirmacion" si trae un mensaje largo más su confirmación de datos finales.',
    },
    explicacion: {
      type: Type.STRING,
      description:
        'Una frase breve en español explicando por qué elegiste esa relación (ej: "Dos turnos con horarios ' +
        'distintos el mismo día"). Podés dejarla genérica ("Un solo turno") cuando relacion es "unico".',
    },
  },
  required: ['turnos', 'relacion', 'explicacion'],
  propertyOrdering: ['turnos', 'relacion', 'explicacion'],
};

/** Un turno tal como lo extrajo Gemini, sin normalizar — espejo de `schemaTurnoExtraidoCrudo()`. */
export interface TurnoExtraidoCrudo {
  fechaTexto: string;
  diaSemanaTexto: string;
  horaTexto: string;
  tipoProfesional: TipoProfesionalMensajeTurno;
  profesionalTexto: string;
  especialidadTexto: string;
  especialidadInferida: boolean;
  lugarNombre: string;
  lugarDireccion: string;
  lugarCiudad: string;
  lugarProvincia: string;
  notas: string[];
}

/** Forma exacta del JSON que Gemini devuelve al usar `SCHEMA_ANALISIS_MENSAJE_TURNO` como `responseSchema`. */
export interface AnalisisMensajeTurnoExtraido {
  turnos: TurnoExtraidoCrudo[];
  relacion: RelacionMensajeTurno;
  explicacion: string;
}
