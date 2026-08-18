/**
 * Prompt de extracción de documentos médicos (Sprint 4 — Route Handler de
 * extracción con Gemini).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Este archivo NO ejecuta nada ni toca red: es texto plano en español que
 *  `app/api/documentos/extraer/route.ts` le pasa a `extraerJson` junto con
 *  `SCHEMA_DOCUMENTO_MEDICO` (`lib/gemini/schemas.ts`) y el archivo como
 *  `inlineData`. Se puede importar desde servidor o desde tests sin ningún
 *  riesgo de credenciales.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Por qué el prompt es específico de Argentina y no un genérico "extraé los
 * datos de este documento médico":
 *
 * - **Fechas `dd/mm/aaaa`.** Es el formato universal en Argentina, y es
 *   AMBIGUO para un modelo entrenado mayormente con documentos en inglés: sin
 *   la instrucción explícita, "03/04/2026" se puede leer como 3 de abril o
 *   como 4 de marzo. El prompt lo fija sin dejarlo a la inferencia del modelo.
 * - **Matrícula profesional (MP/MN).** Es el dato que en Argentina identifica
 *   a un profesional de la salud de forma verificable (a diferencia de un
 *   nombre, que puede repetirse). El schema no tiene un campo separado para
 *   la matrícula -agregar uno partiría el campo `medico` en dos sin necesidad
 *   real todavía-, así que el prompt le pide al modelo que la incluya DENTRO
 *   del texto de `medico` cuando aparezca impresa (ej. "Dr. Pérez (MP 1234)").
 * - **Lenguaje claro, no técnico.** El público del producto son adultos
 *   mayores y quienes los cuidan (ROADMAP_SPRINTS.md, propósito del
 *   documento): un resumen que repita la jerga del informe ("hallazgos
 *   compatibles con proceso inflamatorio inespecífico") no cumple su función.
 *   El prompt pide explícitamente que el resumen se pueda leer en voz alta y
 *   entender sin formación médica.
 *
 * Lo que el prompt NO hace: no le pide al modelo que diagnostique, evalúe
 * gravedad ni dé recomendaciones clínicas. Es un resumen de lo que el
 * documento DICE, no una opinión sobre lo que significa -la misma frontera
 * que ya traza `documents.ai_summary` en el esquema ("Es asistencia, no
 * diagnóstico: la UI debe declararlo").
 */

/**
 * Prompt de extracción, listo para concatenar con el documento (como
 * `inlineData`, nunca como texto -no hace falta transcribirlo a mano-).
 *
 * `extraerJson` no acepta placeholders: es un texto fijo porque no hay nada
 * que parametrizar por request (ni fecha "de hoy" ni nombre de perfil -eso
 * sería mandarle al modelo datos que no necesita para leer el documento-).
 */
export const PROMPT_DOCUMENTO_MEDICO = `
Sos un asistente que lee documentos médicos argentinos (análisis de laboratorio, informes de imágenes, recetas o resúmenes de consulta) y extrae datos estructurados. El documento adjunto puede ser una foto o un PDF, a veces de calidad irregular (poca luz, papel arrugado, escaneo torcido). Hacé tu mejor lectura posible y seguí estas reglas:

1. FECHA: en Argentina las fechas se escriben día/mes/año (dd/mm/aaaa). Si el documento dice "15/03/2026", es el 15 de marzo de 2026 — NUNCA lo leas como 3 de mayo. Convertila siempre a formato ISO (aaaa-mm-dd) en el campo "fecha". Si el documento no trae una fecha explícita, usá la fecha más probable que puedas inferir del texto (por ejemplo, la fecha de emisión de una receta); si no hay ninguna pista, dejá el campo como cadena vacía. Nunca inventes una fecha que no tenga respaldo en el documento.

2. ESPECIALIDAD: inferí la especialidad médica relacionada con el documento a partir del tipo de estudio, del membrete o del profesional que firma (por ejemplo "Clínica médica", "Cardiología", "Endocrinología", "Ginecología"). Si no hay ninguna pista razonable, dejala vacía — no adivines al azar.

3. INSTITUCIÓN: el nombre del laboratorio, clínica, sanatorio, hospital u obra social que emitió el documento, tal como figura impreso.

4. MÉDICO Y MATRÍCULA: el nombre del profesional que solicita, firma o atiende, con su tratamiento si lo tiene (Dr./Dra.). Si en el documento aparece una matrícula profesional (MP, MN, u otra sigla seguida de un número), incluila entre paréntesis a continuación del nombre, por ejemplo "Dra. Gómez (MP 4567)". Si no hay matrícula visible, dejá solo el nombre.

5. RESUMEN: escribí 2 a 3 oraciones en español, en LENGUAJE CLARO Y COTIDIANO, como si se lo explicaras a una persona sin formación médica (el público de esta aplicación son adultos mayores y quienes los cuidan). Evitá jerga técnica sin explicarla: en vez de "hallazgos compatibles con proceso inflamatorio inespecífico" escribí algo como "se detectó una inflamación leve, sin datos de que sea algo grave". No diagnostiques ni des indicaciones médicas: contá qué dice el documento, no qué opinás sobre lo que significa.

6. CATEGORÍA: clasificá el documento en exactamente una de estas cinco categorías: "laboratory" (análisis de laboratorio, con valores numéricos), "imaging" (radiografía, ecografía, tomografía, resonancia u otro estudio por imágenes), "prescription" (receta médica), "consultation" (resumen o epicrisis de una consulta), "other" (cualquier otro caso, incluido un documento ilegible o que no encaje en las anteriores).

7. MÉTRICAS DE LABORATORIO: si (y solo si) el documento es un análisis de laboratorio con valores numéricos, extraé cada métrica con su nombre tal como figura impreso, el valor numérico (sin unidad ni texto adicional), la unidad de medida y el rango de referencia impreso (si figura). Si el documento no trae valores de laboratorio, dejá la lista vacía — no inventes métricas que no estén en el texto.

8. TEXTO ADICIONAL (opcional): si hay texto relevante del documento que no quedó reflejado en los campos anteriores (por ejemplo indicaciones textuales de una receta, observaciones de un informe), podés incluir un extracto BREVE — no más de 500 caracteres — en el campo "texto_completo". No es obligatorio: si el resumen ya cubre lo importante, dejalo sin usar.

Es un documento de prueba o real de una persona que usa la aplicación para su propio historial médico o el de un familiar a su cargo. Devolvé exclusivamente el JSON pedido por el schema, en español, sin texto adicional fuera del JSON.
`.trim()

/**
 * Regla extra del camino AUTOMÁTICO (auto-carga sin dudas, Sprint 17): además
 * de todo lo anterior, a nombre de quién está emitido el documento.
 *
 * Se concatena al prompt de siempre en vez de duplicarlo, por el mismo motivo
 * por el que `SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE` se deriva de
 * `SCHEMA_DOCUMENTO_MEDICO`: las ocho reglas de arriba tienen que ser
 * literalmente las mismas en los dos caminos, no dos copias que se van
 * separando con el tiempo.
 *
 * **Este prompt solo se usa cuando la persona encendió la carga automática.**
 * La subida a mano, el Web Share Target y el "Revisar este estudio" de la
 * bandeja siguen usando `PROMPT_DOCUMENTO_MEDICO` a secas.
 *
 * El énfasis del punto 9 no es decorativo: el error caro acá no es no
 * encontrar el nombre -eso manda el correo a revisión humana, que es lo
 * correcto- sino DEVOLVER UNO INVENTADO, porque un nombre inventado que por
 * casualidad se parezca al del perfil haría entrar al historial de alguien un
 * estudio que no es suyo.
 */
export const PROMPT_DOCUMENTO_MEDICO_CON_PACIENTE = `${PROMPT_DOCUMENTO_MEDICO}

9. PACIENTE: además de todo lo anterior, devolvé en el campo "paciente" el nombre y apellido de la persona A CUYO NOMBRE está emitido el documento, tal como figura impreso (suele estar rotulado "Paciente:", "Apellido y Nombre:", "Afiliado:", o en el encabezado del informe). NO pongas ahí el médico que firma, ni quien solicitó el estudio, ni el nombre de la obra social. Copialo LITERAL: no reordenes "Apellido, Nombre", no le agregues nombres que no estén, no le saques ninguno. Si el documento NO trae ningún nombre de paciente, o no podés leerlo con seguridad, devolvé cadena vacía — es preferible el campo vacío antes que un nombre supuesto.
`.trim()
