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

1. "${TITULOS_SECCION_FICHA.motivoConsulta}": una o dos oraciones que sugieren de qué podría tratarse la consulta, a partir de alertas activas ("alertasActivas"), medicación por renovar ("necesitaRenovacion") o valores fuera de rango. Si no hay ningún disparador claro en los datos, decilo explícitamente ("Consulta de control, sin motivo urgente detectado en los datos cargados") — NUNCA inventes un motivo que los datos no respaldan.

2. "${TITULOS_SECCION_FICHA.antecedentesRelevantes}": listado breve, con guiones ("- " uno por línea), de grupo sanguíneo, alergias, condiciones crónicas, medicación crítica y notas de la ficha SOS (todo dentro de "paciente"). Si un campo está vacío, omitilo del listado sin comentarlo. Si TODO está vacío, decilo explícitamente.

3. "${TITULOS_SECCION_FICHA.medicacionActual}": listado breve, con guiones, de cada medicamento de "medicacionActiva": nombre, dosis y frecuencia. Agregá "(quedan pocos días — conviene pedir receta)" al final de la línea si "necesitaRenovacion" es true para ese medicamento. Si no hay medicación activa, decilo explícitamente.

4. "${TITULOS_SECCION_FICHA.estudiosRecientes}": listado breve, con guiones, de "estudiosRecientes": fecha, categoría, y una frase con lo que dice "resumenIa" (si lo tiene). Si no hay estudios, decilo explícitamente.

5. "${TITULOS_SECCION_FICHA.valoresFueraDeRango}": listado breve, con guiones, de las mediciones de "metricasLaboratorio" y "signosVitales" cuya última medición esté fuera de rango (marcada como "fueraDeRango: true" en métricas de laboratorio), o de lo que reporte "alertasActivas". Indicá el valor y la fecha. Si no hay ninguna, decilo explícitamente ("Sin valores fuera de rango en los últimos registros").

6. "${TITULOS_SECCION_FICHA.preguntasSugeridas}": entre 3 y 5 preguntas CONCRETAS para hacerle al médico en esta consulta puntual, basadas en los datos recibidos (por ejemplo, sobre un valor fuera de rango, una medicación por renovar o un estudio reciente). Nunca preguntas genéricas de relleno ("¿cómo estoy?").

REGLAS QUE NO PODÉS ROMPER:
- NO diagnostiques. NO opines sobre gravedad. Contá lo que los datos dicen, no lo que significan.
- NO recomiendes empezar, cambiar, suspender ni ajustar ninguna dosis o medicación. Si algo necesita renovarse, planteálo como un trámite ("conviene pedir receta"), nunca como una indicación clínica.
- NO inventes datos que no estén en el JSON. Si una sección no tiene información, decilo explícitamente en esa misma sección — nunca la dejes con contenido genérico ni inventado.
- Cada "contenido" tiene que ser breve: pensá que las seis secciones juntas tienen que entrar en UNA hoja A4 impresa.

AVISO OBLIGATORIO (campo "aviso" del JSON de salida): tiene que declarar, en español, que la ficha fue generada con inteligencia artificial a partir de los datos cargados en la aplicación, y tiene que contener LITERALMENTE la frase "no sustituye" o "no reemplaza el criterio médico". Podés usar este texto tal cual:

"${AVISO_SUGERIDO}"

DATOS DE LA PERSONA (JSON, ya minimizado):

${JSON.stringify(contexto)}

Devolvé exclusivamente el JSON pedido por el schema, en español, sin texto adicional fuera del JSON.
`.trim()
}
