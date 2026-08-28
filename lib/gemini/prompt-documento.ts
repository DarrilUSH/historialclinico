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
 *
 * ## Sprint 19 — las cuatro reglas que salieron de medir el pipeline
 *
 * La medición honesta del camino completo con 19 documentos reales (0 de 19
 * salieron perfectos sin corrección humana) mostró que cuatro de los defectos
 * más caros no eran del modelo sino de lo que este texto le pedía. De ahí
 * salen, con su evidencia, las reglas 1, 2, 8 y 10:
 *
 * - **1. TÍTULO (nueva).** Antes el título no se le pedía al modelo: lo
 *   componía `sugerirTitulo` como `<categoría> — <institución>`, y 15 de 25
 *   documentos terminaron compartiendo título con otro. Ahora el nombre del
 *   estudio lo dice quien leyó el documento.
 * - **2. FECHA (reescrita).** Antes decía "usá la fecha más probable que
 *   puedas inferir del texto". Eso es exactamente lo que produjo las fechas
 *   inventadas (`2024-03-12`, `2024-02-14`) y la fecha robada a otro estudio
 *   citado (`2025-10-29` en una colangio-RMN que es del 3 de noviembre).
 *   Ahora: si el documento no imprime su propia fecha, `null`.
 * - **8. MÉTRICAS (ampliada).** Antes pedía solo valores NUMÉRICOS, así que
 *   los 5 resultados cualitativos del corpus ("VDRL / HBsAg / Hepatitis C: No
 *   Reactivo", el espermograma) no tenían dónde entrar y se perdieron enteros.
 * - **10. NÚMERO DE ORDEN (ampliada).** Antes pedía "solo el número, sin el
 *   rótulo", y el saneador del Sprint 18 -que desconfía de toda tira de
 *   dígitos corridos, porque es indistinguible de un DNI- terminaba
 *   descartando los 5 números de orden REALES del laboratorio del dueño. Ahora
 *   se pide el rótulo en un campo aparte, y el saneador acredita por él.
 *
 * ## Sprint 20 — "una foto, el lugar correcto": el papel deja de ser siempre un estudio
 *
 * El pedido salió de un usuario real de ~70 años, con dos quejas concretas:
 * subió tres capturas de turnos y quedaron "en el limbo" (la app las trató como
 * estudios sin clasificar), y chocó con "la fecha no puede ser futura" al subir
 * cosas que son futuras por naturaleza. *"Si es solo para guardar cosas que
 * pasaron, es un archivo, no una ayuda médica."*
 *
 * De ahí salen las reglas **1.b** (INTENCIÓN) y **11** (MEDICAMENTOS), y la
 * reescritura de la **9** (TEXTO ADICIONAL). Tres decisiones que vale la pena
 * dejar escritas:
 *
 * - **Es la MISMA llamada.** No hay un segundo pedido a Gemini para clasificar:
 *   la cuota del free tier es sagrada (ROADMAP_SPRINTS.md), así que la
 *   intención viaja en la extracción que ya se pagaba. El precio son unos
 *   cientos de tokens de prompt y dos campos más de salida.
 * - **El sesgo del desempate está declarado y apunta al camino viejo.** "Ante
 *   cualquier duda, `estudio_realizado`" no es prudencia genérica: es que los
 *   dos errores no cuestan lo mismo. Clasificar de más manda a la persona a un
 *   cartel que no corresponde; clasificar de menos la deja exactamente donde
 *   estaba antes de este sprint, revisando a mano.
 * - **La dosis no se completa nunca.** `dosis_texto` y `frecuencia_texto` son
 *   texto LITERAL, no número + unidad + esquema, precisamente para que no haya
 *   ningún hueco tipado donde al modelo le resulte natural rellenar lo que el
 *   papel no dice. El caso real es un papelito manuscrito de tres renglones sin
 *   ninguna dosis: la respuesta correcta ahí es tres veces la cadena vacía.
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
Sos un asistente que lee PAPELES MÉDICOS y extrae datos estructurados. Puede ser cualquier cosa que una persona fotografíe en el consultorio o en su casa: un análisis de laboratorio, un informe de imágenes, una receta, un papelito manuscrito con la lista de remedios que toma, la captura de pantalla de la agenda de turnos de una clínica, una orden para hacerse un estudio, o el resumen de una consulta. El documento adjunto puede ser una foto o un PDF, a veces de calidad irregular (poca luz, papel arrugado, escaneo torcido, letra manuscrita). Hacé tu mejor lectura posible y seguí estas reglas:

1. TÍTULO: un nombre CORTO y ESPECÍFICO de QUÉ estudio es este documento, en castellano, como lo nombraría quien lo pidió: "Ecografía abdominal", "Radiografía de tórax", "Colangio-RMN de abdomen", "TAC de cuello con contraste", "Análisis de laboratorio — hemograma y hepatograma", "Epicrisis de internación", "Parte quirúrgico — drenaje de absceso hepático", "Espermograma", "Receta de amoxicilina". Reglas del título:
   - NO pongas la institución ni la fecha: van en sus propios campos y se muestran solas al lado del título. "Ecografía abdominal", no "Ecografía abdominal — Sanatorio San Jorge 29/10/2025".
   - NO devuelvas la etiqueta genérica de la categoría ("Estudio por imágenes", "Consulta", "Análisis de laboratorio" a secas) si el documento permite saber qué estudio es. Ese es justamente el título que no sirve: dos estudios distintos de la misma clínica terminan llamándose igual y no se distinguen en la lista.
   - Fijate en el CUERPO del informe, no solo en el rótulo del encabezado: si el pedido dice "TAC PELVIS" pero el informe describe tórax, abdomen y pelvis, el título es "TAC de tórax, abdomen y pelvis".
   - Si es una placa o una hoja de imágenes sin informe escrito, decilo en el título: "Radiografía de tórax — placa", "Ecografía abdominal — hoja de imágenes".
   - Como máximo unos 80 caracteres. Si el estudio tiene un hallazgo principal muy corto, podés agregarlo después de un guion ("Ecografía abdominal — absceso hepático"), pero nunca a costa de que se entienda qué estudio es.
   - Cadena vacía SOLO si el documento es ilegible o no permite saber de qué se trata.

1.b. INTENCIÓN — PARA QUÉ SIRVE ESTE PAPEL: es lo MÁS importante de esta lectura, porque decide adónde va a parar lo que la persona fotografió. No es lo mismo que la categoría. Elegí exactamente uno de estos cinco valores en el campo "intencion":
   - "estudio_realizado": algo que YA se hizo y trae su resultado o su informe. Señal decisiva: hay HALLAZGOS, valores medidos, una descripción de lo que se vio, una conclusión. Un análisis de laboratorio con sus valores, una ecografía con su informe, una epicrisis, un parte quirúrgico, una placa.
   - "receta_o_medicacion": una receta médica, o simplemente una LISTA DE REMEDIOS. Señal decisiva: uno o más nombres de medicamentos que la persona tiene que tomar. Cuenta el papelito manuscrito de puño y letra con tres renglones ("COVERAM 5/5", "LIPOMAX 105", "ROSUVASTATINA 10") aunque no tenga membrete, ni firma, ni dosis: sigue siendo la lista de lo que toma. También cuenta la foto de las cajas de los remedios.
   - "turno_o_cita": un turno YA ASIGNADO o confirmado. Señal decisiva: día y hora FUTUROS, más un lugar donde presentarse. Cuenta la captura de pantalla de la agenda de una clínica o de su aplicación (con su listado de "próximos turnos"), el comprobante impreso de un turno, el papelito que le dan en la mesa de entradas, el mensaje de confirmación. Puede traer VARIOS turnos en la misma imagen: igual la intención es una sola, "turno_o_cita".
   - "orden_de_practica": un PEDIDO de un estudio que TODAVÍA NO SE HIZO. Señal decisiva: dice qué hay que hacerse y quién lo pide, y NO hay ningún resultado. Una orden, una solicitud de práctica, una derivación, un pedido de laboratorio o de imágenes.
   - "otro": cualquier otra cosa (un presupuesto, un carnet de la obra social, un papel ilegible).
   Y una regla de desempate que vale más que las cinco definiciones: ANTE CUALQUIER DUDA entre dos opciones, devolvé "estudio_realizado". Es el camino que una persona ya revisa a mano de todas formas, así que equivocarse hacia ahí no le cuesta nada; equivocarse hacia los otros le pone un cartel que no corresponde. En particular: si el papel muestra resultados, es "estudio_realizado" aunque también se lea quién lo solicitó, y si muestra una fecha futura pero no dice dónde presentarse, tampoco es un turno.

2. FECHA: la fecha DE ESTE documento — el día en que se hizo o se emitió ESTE estudio, tal como está impresa en él. En Argentina las fechas se escriben día/mes/año (dd/mm/aaaa): si el documento dice "15/03/2026", es el 15 de marzo de 2026 — NUNCA lo leas como 3 de mayo. Convertila siempre a formato ISO (aaaa-mm-dd) en el campo "fecha". Y dos prohibiciones que importan más que la conversión:
   - Si el documento NO imprime su propia fecha, devolvé null. null es una respuesta CORRECTA y esperada, no un error: una persona la va a completar en pantalla. NUNCA inventes una fecha plausible, ni la deduzcas de la edad del paciente, del número de orden ni de nada por el estilo.
   - NUNCA uses una fecha que el texto le atribuya a OTRO estudio. Los informes citan estudios previos todo el tiempo ("se compara con TC previa de fecha 29-10-2025", "control anterior del 14/02", "post-quirúrgico del 05/11"): esas son las fechas de ESOS estudios. Si la única fecha que aparece en el documento es la de otro estudio, la respuesta correcta sigue siendo null.

3. ESPECIALIDAD: inferí la especialidad médica relacionada con el documento a partir del tipo de estudio, del membrete o del profesional que firma (por ejemplo "Clínica médica", "Cardiología", "Endocrinología", "Ginecología"). Si no hay ninguna pista razonable, dejala vacía — no adivines al azar.

4. INSTITUCIÓN: el nombre del laboratorio, clínica, sanatorio, hospital u obra social que emitió el documento, tal como figura impreso.

5. MÉDICO Y MATRÍCULA: el nombre del profesional que solicita, firma o atiende, con su tratamiento si lo tiene (Dr./Dra.). Si en el documento aparece una matrícula profesional (MP, MN, u otra sigla seguida de un número), incluila entre paréntesis a continuación del nombre, por ejemplo "Dra. Gómez (MP 4567)". Si no hay matrícula visible, dejá solo el nombre.

6. RESUMEN: escribí 2 a 3 oraciones en español, en LENGUAJE CLARO Y COTIDIANO, como si se lo explicaras a una persona sin formación médica (el público de esta aplicación son adultos mayores y quienes los cuidan). Evitá jerga técnica sin explicarla: en vez de "hallazgos compatibles con proceso inflamatorio inespecífico" escribí algo como "se detectó una inflamación leve, sin datos de que sea algo grave". No diagnostiques ni des indicaciones médicas: contá qué dice el documento, no qué opinás sobre lo que significa.

6.b. RESUMEN DE UNA PÁGINA SIN CONTENIDO CLÍNICO: si el documento NO trae ningún hallazgo -es una placa o una hoja de imágenes sin informe escrito, o la hoja administrativa de un informe (datos del solicitante, horarios, firma)-, NO rellenes el resumen describiendo el membrete: no cuentes el nombre de la institución, ni la fecha impresa, ni el nombre del paciente, ni cuántas páginas tiene. Decilo de frente, con estas palabras: "Sin informe escrito" para una placa o una hoja de imágenes, "Sin hallazgos nuevos: solo trae los datos administrativos y la firma" para una hoja de firmas. Si sobre la imagen hay mediciones marcadas por el equipo, agregalas. Esas fórmulas no son un detalle de estilo: la ficha de consulta las reconoce para dejar esas páginas afuera, en vez de terminar diciendo "el 29/10 se hizo un estudio en tal sanatorio" en lugar de qué se encontró.

7. CATEGORÍA: clasificá el documento en exactamente una de estas cinco categorías: "laboratory" (análisis de laboratorio, con valores numéricos), "imaging" (radiografía, ecografía, tomografía, resonancia u otro estudio por imágenes), "prescription" (receta médica), "consultation" (resumen o epicrisis de una consulta), "other" (cualquier otro caso, incluido un documento ilegible o que no encaje en las anteriores).

8. RESULTADOS DE LABORATORIO: si (y solo si) el documento es un análisis de laboratorio, extraé CADA resultado con su nombre tal como figura impreso, la unidad de medida y el rango de referencia impreso (si figura). Cada resultado va con un valor numérico O con un resultado textual, nunca con ninguno de los dos:
   - Resultado NUMÉRICO: poné el número en "valor" (sin unidad ni texto adicional) y dejá "valorTexto" en cadena vacía.
   - Resultado CUALITATIVO: poné "valor" en null y copiá el resultado tal como está impreso en "valorTexto". Son resultados clínicamente importantes que NO producen un número y que hay que capturar igual: "VDRL: No Reactivo", "HBsAg: No Reactivo", "Hepatitis C: No Reactivo", "Strep A: Negativo", "Test de embarazo: Positivo", "Espermograma: No se observan espermatozoides", "Plaquetas aumentadas en el frotis", "Urocultivo: sin desarrollo". No los omitas por no tener número, y no les inventes un número que el estudio no imprime.
   Si el documento no trae ningún resultado de laboratorio, dejá la lista vacía — no inventes métricas que no estén en el texto.

9. TEXTO ADICIONAL: cuánto poner en "texto_completo" depende de la intención que elegiste en la regla 1.b.
   - Si la intención es "turno_o_cita" u "orden_de_practica": TRANSCRIBÍ LITERAL todo lo que se lee en el papel, hasta unos 1500 caracteres — cada fecha, cada hora, cada dirección, cada nombre de profesional, cada renglón de la lista de turnos, tal como están escritos. Este texto es lo ÚNICO con lo que después se arman los turnos: un dato que no transcribas acá se pierde para siempre. Si hay tres turnos en la captura, los tres tienen que estar en el texto.
   - Para cualquier otra intención, seguí como siempre: un extracto BREVE, no más de 500 caracteres, con lo relevante que no quedó en los otros campos (indicaciones textuales de una receta, observaciones de un informe). No es obligatorio: si el resumen ya cubre lo importante, dejalo sin usar.

10. NÚMERO DE ORDEN Y SU RÓTULO (opcional): si el documento imprime un número de orden, protocolo o identificador del estudio, copialo en dos campos separados:
   - "numero_orden": SOLO el número o código, sin el rótulo (por ejemplo "1446188", no "N° de Orden: 1446188").
   - "numero_orden_rotulo": el RÓTULO impreso al lado de ese número, copiado LITERAL y sin el número ("N° de Orden", "Protocolo", "N° de Solicitud", "Pedido Nro", "N° de Registro"). El rótulo es lo que nos permite saber que ese número identifica a ESTE estudio y no a la persona: un número de siete dígitos sin rótulo es indistinguible de un DNI y lo tenemos que descartar. Si el número está rotulado como OTRA cosa ("N° de Internación", "Historia Clínica", "Afiliado", "Accesión", "N° de Serie"), copiá ESE rótulo igual, tal como está impreso — nos sirve para descartarlo. Si el número aparece pelado, sin ningún rótulo al lado, dejá el rótulo en cadena vacía: no inventes un rótulo que el documento no imprime.
   Es el identificador administrativo que el laboratorio le puso a ESTE estudio, no el número de afiliado, no el DNI del paciente, no ningún otro código. Si el documento no trae un número de orden visible, dejá los dos campos vacíos — no lo inventes ni uses otro número como reemplazo.

11. MEDICAMENTOS: si (y solo si) la intención es "receta_o_medicacion", llená la lista "medicamentos" con UN elemento por cada remedio que el papel indica. Para cada uno:
   - "nombre": el nombre tal como está escrito, normalmente el comercial de la caja ("COVERAM", "LIPOMAX"). Si el papel solo nombra la droga ("Rosuvastatina 10"), poné eso mismo.
   - "droga": el principio activo SOLO si el papel lo imprime aparte ("perindopril/amlodipina" al lado de COVERAM, "ácido fenofíbrico" al lado de LIPOMAX). Cadena vacía si no figura: no lo completes con lo que vos sepas de ese medicamento.
   - "presentacion": la concentración o forma tal como está impresa ("5/5 mg", "105 mg", "solución 100 mg/ml"). Cadena vacía si no figura.
   - "dosis_texto": CUÁNTO se toma por vez, copiado LITERAL ("1 comprimido", "medio comprimido", "10 ml"). **Cadena vacía si el papel no lo dice.**
   - "frecuencia_texto": CADA CUÁNTO se toma, copiado LITERAL ("1 por día", "cada 12 horas", "en el desayuno"). **Cadena vacía si el papel no lo dice.**
   Y la regla que manda sobre todas las demás de este punto: NUNCA completes una dosis, una presentación o una frecuencia que el papel no imprima. Ni la deduzcas de la concentración, ni de lo que sepas del medicamento, ni de lo habitual. Un campo vacío es una respuesta correcta que una persona va a completar en pantalla; una dosis inventada en una aplicación médica puede hacer que alguien tome de más. Si la intención NO es "receta_o_medicacion", devolvé la lista vacía: un informe de laboratorio no indica medicación aunque nombre drogas en su texto.

Es un documento de prueba o real de una persona que usa la aplicación para su propio historial médico o el de un familiar a su cargo. Devolvé exclusivamente el JSON pedido por el schema, en español, sin texto adicional fuera del JSON.
`.trim()

/**
 * Regla extra del camino AUTOMÁTICO (auto-carga sin dudas, Sprint 17): además
 * de todo lo anterior, a nombre de quién está emitido el documento. Es la regla
 * **12** desde el Sprint 20 (la 11 pasó a ser MEDICAMENTOS).
 *
 * Se concatena al prompt de siempre en vez de duplicarlo, por el mismo motivo
 * por el que `SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE` se deriva de
 * `SCHEMA_DOCUMENTO_MEDICO`: las diez reglas de arriba tienen que ser
 * literalmente las mismas en los dos caminos, no dos copias que se van
 * separando con el tiempo.
 *
 * **Este prompt solo se usa cuando la persona encendió la carga automática.**
 * La subida a mano, el Web Share Target y el "Revisar este estudio" de la
 * bandeja siguen usando `PROMPT_DOCUMENTO_MEDICO` a secas.
 *
 * El énfasis del punto 11 no es decorativo: el error caro acá no es no
 * encontrar el nombre -eso manda el correo a revisión humana, que es lo
 * correcto- sino DEVOLVER UNO INVENTADO, porque un nombre inventado que por
 * casualidad se parezca al del perfil haría entrar al historial de alguien un
 * estudio que no es suyo.
 */
export const PROMPT_DOCUMENTO_MEDICO_CON_PACIENTE = `${PROMPT_DOCUMENTO_MEDICO}

12. PACIENTE: además de todo lo anterior, devolvé en el campo "paciente" el nombre y apellido de la persona A CUYO NOMBRE está emitido el documento, tal como figura impreso (suele estar rotulado "Paciente:", "Apellido y Nombre:", "Afiliado:", o en el encabezado del informe). NO pongas ahí el médico que firma, ni quien solicitó el estudio, ni el nombre de la obra social. Copialo LITERAL: no reordenes "Apellido, Nombre", no le agregues nombres que no estén, no le saques ninguno. Si el documento NO trae ningún nombre de paciente, o no podés leerlo con seguridad, devolvé cadena vacía — es preferible el campo vacío antes que un nombre supuesto.
`.trim()
