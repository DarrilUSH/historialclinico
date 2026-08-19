/**
 * Prompt de generación de la ficha de resumen para consulta (Sprint 10, tarea
 * 10.3 — Route Handler `app/api/ficha/generar/route.ts`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A diferencia de `PROMPT_DOCUMENTO_MEDICO` (`lib/gemini/prompt-documento.ts`),
 *  que es un texto FIJO porque no tiene nada que parametrizar por request,
 *  este prompt SÍ varía: `construirPromptFicha` recibe el `ContextoClinico`
 *  ya armado por `lib/ficha/armado.ts` (Sprint 10, tarea 10.2, ya con la
 *  minimización de datos aplicada — `docs/minimizacion-datos.md`) y lo
 *  serializa dentro del texto que se manda a Gemini. Es la ÚNICA función de
 *  este archivo, y es PURA: sin E/S, sin red, sin cliente de Supabase — igual
 *  que `lib/ficha/armado.ts`, el reloj y la base nunca entran por la puerta
 *  de atrás.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Los seis títulos de sección son un contrato, no una sugerencia
 *
 * El prompt lista los seis títulos EXACTOS de `TITULOS_SECCION_FICHA`
 * (`lib/gemini/schemas.ts`) y le pide a Gemini que los devuelva tal cual,
 * carácter por carácter, porque `responseSchema` (`SCHEMA_FICHA_CONSULTA`) ya
 * los fuerza con un `enum` de un solo valor por sección: si el prompt y el
 * schema dijeran títulos distintos, CUALQUIER respuesta sería rechazada. Los
 * títulos viven en un solo lugar (`schemas.ts`) e importarlos acá es lo que
 * hace imposible que diverjan.
 *
 * ## Por qué el prompt PROHÍBE el membrete
 *
 * El dueño del producto reportó el defecto con precisión: la ficha "traía la
 * fecha y los datos del sanatorio en vez de lo que realmente había pasado en
 * esa fecha". Es un modo de fallo muy propio de un resumen automático: ante un
 * documento del que no tiene nada que contar, un modelo de lenguaje **llena**
 * la línea con lo único que sí tiene -la fecha, el tipo de estudio, dónde se
 * hizo- y produce una entrada que parece información y no lo es.
 *
 * Se ataca en dos lugares a la vez, porque uno solo no alcanza:
 *
 * 1. **En la entrada** (`lib/ficha/armado.ts`): los documentos cuyo resumen no
 *    cuenta ningún hecho clínico ya no llegan hasta acá. Si el modelo no ve la
 *    placa, no puede describirla.
 * 2. **Acá**: una regla explícita de "cada línea cuenta un hecho clínico", con
 *    la instrucción de OMITIR el documento en vez de describirlo cuando no hay
 *    nada que decir, y la prohibición de nombrar instituciones (que además no
 *    vienen en el contexto: si aparecieran, serían inventadas).
 *
 * ## Por qué los antecedentes se piden de TODO el historial
 *
 * La misma auditoría encontró que la epicrisis de una internación real decía
 * "ANTECEDENTES PATOLÓGICOS: Niega" cuando la nota de ingreso de esa misma
 * internación registraba una vasectomía, confirmada además por un estudio
 * posterior. Un antecedente perdido en un documento y negado en otro es la
 * situación normal, no la excepción: los papeles médicos se contradicen. Por
 * eso la sección 2 no lee solo los campos que la persona cargó a mano en su
 * perfil -que en un perfil recién creado están vacíos- sino todo lo que los
 * resúmenes registren, con una regla de desempate escrita: gana el documento
 * que APORTA el dato concreto, nunca el que no lo menciona.
 *
 * ## Por qué el prompt es tan explícito con "no diagnostiques, no cambies medicación"
 *
 * El público del producto son adultos mayores y quienes los cuidan
 * (`ROADMAP_SPRINTS.md`), y la ficha se imprime y se lleva a la consulta: una
 * sugerencia de la IA que suene a indicación médica ("deberías dejar de
 * tomar X") puesta en papel es exactamente el riesgo que el roadmap busca
 * evitar al pedir el descargo. El prompt traza la misma frontera que ya usa
 * `PROMPT_DOCUMENTO_MEDICO`: es un resumen de lo que los datos DICEN, nunca
 * una opinión clínica sobre qué hacer con ellos.
 *
 * ## Por qué el aviso se pide con la frase exacta
 *
 * `FichaGeneradaSchema.aviso` (`lib/gemini/schemas.ts`) valida con `.refine`
 * que el texto contenga "no sustituye" o "no reemplaza el criterio médico".
 * El prompt le da a Gemini el texto sugerido completo para reducir al mínimo
 * la chance de que lo parafrasee fuera de esos límites — y si igual lo hace,
 * `lib/gemini/reintento.ts` (usado por `lib/ficha/generar.ts`) pide una
 * segunda respuesta antes de fallar.
 *
 * ## Qué NO hace esta función
 *
 * No decide qué datos viajan (eso ya lo decidió `lib/ficha/armado.ts`, la
 * lista blanca de la tarea 10.2) y no valida la respuesta (eso lo hace
 * `FichaGeneradaSchema` en `lib/gemini/schemas.ts`). Solo redacta la petición.
 */

import type { ContextoClinico } from "@/lib/ficha/armado"
import { TITULOS_SECCION_FICHA } from "@/lib/gemini/schemas"

/**
 * Texto sugerido para el campo `aviso`. Se le ofrece a Gemini tal cual en el
 * prompt para reducir la chance de que lo parafrasee fuera de los límites que
 * exige `FichaGeneradaSchema.aviso` — Gemini puede usarlo literal o adaptarlo,
 * mientras conserve la frase exigida.
 */
const AVISO_SUGERIDO =
  "Este resumen fue generado con inteligencia artificial a partir de los datos cargados en la " +
  "aplicación. Es una ayuda para organizar la consulta: no sustituye ni reemplaza el criterio " +
  "médico ni una evaluación profesional presencial."

/**
 * Arma el prompt completo (instrucciones + contexto serializado) para
 * pedirle a Gemini la ficha de resumen de `contexto`.
 *
 * `contexto` viaja DENTRO del prompt como el único dato variable: es el
 * mismo objeto que arma `construirContextoClinico` (`lib/ficha/contexto.ts`),
 * ya pasado por la minimización de `lib/ficha/armado.ts`. Esta función no
 * vuelve a filtrar nada -no es su responsabilidad-, solo lo serializa tal
 * cual con `JSON.stringify`.
 */
export function construirPromptFicha(contexto: ContextoClinico): string {
  return `
Sos un asistente que arma, en castellano rioplatense, una FICHA DE UNA SOLA HOJA para que una persona (o quien la cuida) lleve impresa a una consulta médica en Argentina. La persona destinataria puede ser un adulto mayor o quien lo acompaña: escribí claro, en oraciones cortas, sin jerga médica sin explicar.

Recibís un JSON con el contexto clínico de la persona, ya minimizado (no incluye nombre, DNI, teléfono, domicilio ni email — no los menciones ni los inventes). Con ese JSON armá EXACTAMENTE las siguientes seis secciones, en este orden, cada una con su título FIJO tal cual está escrito acá (no lo traduzcas, no le cambies ni una tilde):

1. "${TITULOS_SECCION_FICHA.motivoConsulta}": una o dos oraciones que sugieren de qué podría tratarse la consulta. Disparadores válidos, en este orden de prioridad: (a) un hallazgo que el propio informe dejó PENDIENTE -"a valorar clínicamente", "se sugiere completar con", "control evolutivo"- y que ningún estudio posterior cerró; (b) un episodio reciente que sigue en seguimiento; (c) alertas activas ("alertasActivas"); (d) medicación por renovar ("necesitaRenovacion"); (e) valores fuera de rango. Si hay un hallazgo pendiente, ESE es el motivo, por encima de cualquier valor de laboratorio alterado: un análisis se repite en cualquier momento, un pendiente que nadie retoma se pierde para siempre. Si no hay ningún disparador claro en los datos, decilo explícitamente ("Consulta de control, sin motivo urgente detectado en los datos cargados") — NUNCA inventes un motivo que los datos no respaldan.

2. "${TITULOS_SECCION_FICHA.antecedentesRelevantes}": listado breve, con guiones ("- " uno por línea), de lo que un médico necesita saber ANTES de examinar a esta persona. Sale de DOS fuentes, no de una:
   (a) los campos cargados a mano en "paciente": grupo sanguíneo, alergias, condiciones crónicas, medicación crítica y notas de la ficha SOS;
   (b) todo lo que los resúmenes de "episodios" registren como antecedente que sigue vigente. De esta segunda fuente NO PUEDEN FALTAR, aunque haya que acortar el resto:
       · las cirugías y los procedimientos previos (una vasectomía, un drenaje, una cirugía de hace años);
       · las internaciones;
       · los hallazgos incidentales que nadie resolvió y que siguen ahí: una lesión benigna conocida (un hemangioma, un quiste), una alteración crónica de un órgano (esteatosis hepática, artrosis, osteofitos), una fractura consolidada, un desgaste articular;
       · **los pendientes**: todo hallazgo que un informe dejó "a valorar clínicamente", "a controlar" o "se sugiere completar con", y que ningún estudio posterior cerró. Marcalos como tales ("- Amígdalas agrandadas vistas en 2025, el informe pidió valorarlo — sin control posterior").
   Reglas de esta sección:
   - Un antecedente vale aunque aparezca en UN SOLO documento de todo el historial.
   - Si un documento dice "niega antecedentes" o "sin antecedentes" y OTRO registra una cirugía, una internación o una condición concreta, gana el que aporta el dato concreto: la ausencia de mención nunca borra un antecedente registrado en otro lado.
   - Una línea por antecedente, sin el detalle del episodio (eso va en la sección 4): "- Internación en 2025 por un absceso en el hígado, drenado y resuelto".
   - Antes de cerrar esta sección, repasá los episodios uno por uno y preguntate: ¿este resumen menciona alguna cirugía, algún hallazgo que siga ahí o algo que quedó pendiente? Si la respuesta es sí y no está en tu listado, agregalo. Un antecedente que la ficha omite es un antecedente que el médico no va a saber.
   - Si un campo de "paciente" está vacío, omitilo sin comentarlo. Si NO hay ningún antecedente en ninguna de las dos fuentes, decilo explícitamente.

3. "${TITULOS_SECCION_FICHA.medicacionActual}": listado breve, con guiones, de cada medicamento de "medicacionActiva": nombre, dosis y frecuencia. Agregá "(quedan pocos días — conviene pedir receta)" al final de la línea si "necesitaRenovacion" es true para ese medicamento. Si no hay medicación activa, decilo explícitamente.

4. "${TITULOS_SECCION_FICHA.estudiosRecientes}": el historial contado por EPISODIOS, con guiones ("- " uno por línea), del más reciente al más viejo. "episodios" ya viene agrupado: cada entrada junta los documentos de un mismo tramo de tiempo, que casi siempre son un mismo hecho.
   - UNA línea por episodio, no una línea por documento. Una internación con doce documentos es UNA línea que cuenta la internación, no doce líneas de estudios.
   - Cada línea tiene que contar HECHOS CLÍNICOS: qué le pasó, qué se le encontró, qué se le hizo y cómo terminó, con las fechas y las medidas concretas que digan los resúmenes.
   - Las fechas de lo que pasó salen de los resúmenes ("resumenIa"), no del rango "desde"/"hasta" del episodio: ese rango es cuándo se emitieron los ARCHIVOS, que no es lo mismo.
   - Priorizá los episodios que cambian una decisión clínica hoy: internaciones, cirugías y procedimientos, hallazgos vigentes o pendientes, controles del último año. Los estudios viejos y normales juntalos en una sola línea final ("- Controles previos entre 2009 y 2018: sin hallazgos relevantes") o dejalos afuera.
   - Si no hay episodios, decilo explícitamente.

5. "${TITULOS_SECCION_FICHA.valoresFueraDeRango}": listado breve, con guiones, de las mediciones de "metricasLaboratorio" y "signosVitales" cuya última medición esté fuera de rango (marcada como "fueraDeRango: true" en métricas de laboratorio), o de lo que reporte "alertasActivas". Indicá el valor y la fecha. Si no hay ninguna, decilo explícitamente ("Sin valores fuera de rango en los últimos registros").

6. "${TITULOS_SECCION_FICHA.preguntasSugeridas}": entre 3 y 5 preguntas CONCRETAS para hacerle al médico en esta consulta puntual, basadas en los datos recibidos (por ejemplo, sobre un hallazgo que quedó pendiente de valorar, el seguimiento de un episodio reciente, un valor fuera de rango o una medicación por renovar). Nunca preguntas genéricas de relleno ("¿cómo estoy?").

REGLAS QUE NO PODÉS ROMPER:
- NO diagnostiques. NO opines sobre gravedad. Contá lo que los datos dicen, no lo que significan.
- NO recomiendes empezar, cambiar, suspender ni ajustar ninguna dosis o medicación. Si algo necesita renovarse, planteálo como un trámite ("conviene pedir receta"), nunca como una indicación clínica.
- NO inventes datos que no estén en el JSON. Si una sección no tiene información, decilo explícitamente en esa misma sección — nunca la dejes con contenido genérico ni inventado.
- CADA LÍNEA TIENE QUE CONTAR UN HECHO CLÍNICO. Está PROHIBIDO describir el documento en lugar de su contenido. Nunca escribas líneas del tipo "el 29/10/2025 se realizó un estudio", "informe de 35 páginas", "hoja de imágenes", "placa de radiografía" ni "resumen de la historia clínica": eso es el membrete del papel, no lo que le pasó a la persona. Si de un documento lo único que podés decir es su fecha, su tipo o dónde se hizo, NO LO MENCIONES: omitilo y seguí con el siguiente.
- NUNCA nombres instituciones, sanatorios, clínicas, laboratorios ni profesionales. No vienen en el JSON, no le sirven al médico que lee la ficha, y ponerlos en lugar del hecho clínico es exactamente el error que la regla anterior prohíbe.
- Cada "contenido" tiene que ser breve: pensá que las seis secciones juntas tienen que entrar en UNA hoja A4 impresa. Ante la duda, sacrificá lo viejo y lo normal, nunca lo que sigue abierto.

AVISO OBLIGATORIO (campo "aviso" del JSON de salida): tiene que declarar, en español, que la ficha fue generada con inteligencia artificial a partir de los datos cargados en la aplicación, y tiene que contener LITERALMENTE la frase "no sustituye" o "no reemplaza el criterio médico". Podés usar este texto tal cual:

"${AVISO_SUGERIDO}"

CÓMO LEER EL JSON:
- "episodios": el historial agrupado. Cada episodio trae "documentos" (los que SÍ cuentan algo, en orden cronológico) y "adjuntosSinContenidoClinico" (cuántos archivos más del mismo episodio son solo imágenes o membretes). Ese número está para que sepas que esos archivos existen y no los cuentes como estudios distintos: no lo menciones en la ficha.
- "documentosSinContenidoClinico": lo mismo, en total. Tampoco se menciona.

DATOS DE LA PERSONA (JSON, ya minimizado):

${JSON.stringify(contexto)}

Devolvé exclusivamente el JSON pedido por el schema, en español, sin texto adicional fuera del JSON.
`.trim()
}
