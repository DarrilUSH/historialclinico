# Mensajes de turno reales (anonimizados) — casos de prueba del Sprint 16

Mensajes que clínicas y hospitales argentinos mandan por WhatsApp al asignar o
recordar un turno, aportados por el usuario desde conversaciones reales
(2026-08-17). Son la materia prima de la función "pegar el mensaje de la
clínica" de `/turnos/nuevo`: la IA los analiza y PRE-CARGA el formulario para
revisión humana — nunca guarda sola.

**Anonimización:** el repo es público, así que nombres de pacientes y DNI se
reemplazaron por datos de fantasía ANTES de entrar acá. Todo lo demás
(estructura, asteriscos de WhatsApp, emojis, mayúsculas, espaciado raro,
importes, sedes, teléfonos públicos de la institución) quedó byte a byte como
llegó: esa fidelidad es exactamente lo que se está probando. No agregar
ejemplos nuevos sin pasar por la misma limpieza.

## Qué enseña cada caso

| Archivo | Origen | Trampas que debe superar el parser |
|---|---|---|
| `clinica-san-jorge-ecografia.txt` | Clínica San Jorge (Ushuaia) | Formato `Campo : valor` con anchos fijos; fecha `07/10/2024 14:15 HS` (DD/MM); coseguro con monto; PREPARACION extensa e IMPORTANTE que van juntos a las notas; dirección real en "Lugar Aten." (geocodificable) |
| `hospital-britanico-estudio.txt` | Hospital Británico (Buenos Aires) | Prosa con `*negritas*` de WhatsApp y emojis; **"profesional MAMOGRAFIA MAMOGRAFIA" NO es una persona**: es el estudio — el parser tiene que detectarlo y mapearlo a especialidad/estudio SIN inventar un médico; sede "MICROCEN" sin dirección (location_name sin geocoding); checklist de documentación → notas |
| `hospital-britanico-profesional.txt` | Hospital Británico (Buenos Aires) | Mismo template pero "VIDALES VALERIA" SÍ es una persona, en orden APELLIDO NOMBRE; el resto idéntico al caso anterior — sirve de par mínimo para distinguir estudio vs. profesional |
| `instituto-medico-platense-traumatologia.txt` | Instituto Médico Platense (La Plata) | Emojis como marcadores de campo; fecha con día de semana abreviado y sin tilde ("Mie 08/10/2025 a las 09:45 hs"); médico "DEMARCHI, EDGARDO (C)" — coma apellido/nombre + sufijo "(C)" a descartar; dirección COMPLETA con ciudad y provincia ("Avenida 51 Nº 315 La Plata, Buenos Aires") — el caso ideal para los campos ciudad/provincia del ítem 1 del Sprint 16 y para geocodificar |
| `casa-salud-ginecologia.txt` | Casa Salud | **El caso INCOMPLETO — el más importante.** Fecha "martes 14/7": sin año y SIN HORA → la IA debe dejar la hora VACÍA y marcar el año como inferido (el próximo 14/7 futuro, cotejando que caiga martes), JAMÁS inventar datos que el mensaje no trae. Sin especialidad explícita (inferible de "prácticas ginecológicas", con cautela) y sin dirección. "Dra. Rosario Diulio" en orden natural con tratamiento. Tarifario largo + copago en EFECTIVO + pedido de confirmar asistencia → todo a notas |

| `casa-salud-confirmacion.txt` | Casa Salud (2.º mensaje, tras confirmar) | Mensaje de datos finales, cortísimo: "Día: 26/5" (sin año), "Horario: 18.10hs" (**hora con PUNTO, no dos puntos**), "Profesional: Ardans" (solo apellido). Aislado casi no alcanza; su valor es el par con el mensaje largo |
| `centro-loria-sin-anio.txt` | Sede Lorìa (red TCba, prob.) | "Fecha: 28/04" sin año + hora en campo aparte; "Centro: LORIA" a secas (nombre en clave, sin dirección); **"Preparación: No requiere."** — preparación explícitamente vacía (no volcarla como si fuera una indicación); el recordatorio genérico (DNI, orden, credencial, estudios anteriores) sí va a notas; paciente en orden NOMBRES + APELLIDO |
| `tcba-salguero-puncion.txt` | TCba Salguero (Buenos Aires) | LA MISMA paciente que el caso anterior pero "SOSA , CARLA MARIA INES" — apellido primero y **coma con espacios raros**: par ideal para normalización de nombres; "Fecha del turno: 13/11/2025 Hora del turno: 15:21" — dos campos en UNA línea, minuto no redondo; dirección con rango "554/560" + teléfono del centro "4860-1000" (sin característica) → notas; **"Práctica:"** como nombre de campo del estudio (tercer sinónimo: Especialidad/profesional-que-es-estudio/Práctica); "Profesional: Acha Agustina" — probablemente APELLIDO NOMBRE sin coma: ambigüedad real a resolver con cautela |

**Lección de red:** estos dos últimos son con toda probabilidad de la MISMA red
(TCba) y aún así usan templates distintos — no alcanza con "aprender el
formato de una institución"; cada mensaje se analiza por su contenido.

## Un solo mensaje con MUCHAS citas (agosto 2026)

Los ocho casos de arriba son todos de UNA cita. Faltaba el caso que rompió en
producción: **un solo mensaje que asigna una serie entera de sesiones.** Una
usuaria pegó el mensaje de sus diez sesiones de kinesiología y se cargó UN
turno — las otras nueve no existieron para ningún recordatorio.

El primero de estos cuatro es real (anonimizado con el mismo criterio que los
de arriba); los otros tres son **sintéticos**, escritos para cubrir formatos de
enumeración distintos y provincias distintas, y están marcados como tales para
que nadie los lea como evidencia de campo.

| Archivo | Origen | Qué enseña |
|---|---|---|
| `hb-central-kinesiologia-10-sesiones.txt` | **REAL** (HB Central) | **El caso que motivó todo.** Encabezado con profesional/especialidad/centro/consultorio/dirección UNA sola vez, y debajo diez bloques `Sesión N/10` + `<Día> <fecha> - <hora>` separados por líneas de ruido ("Cancelar turno"). Debe dar **10 turnos**, cada uno con SU fecha y hora, todos heredando el encabezado, y cada uno etiquetado `Sesión N/10`. Las horas cambian entre sesiones (11:00, 12:30, 09:30, 08:30): copiar la del encabezado sería tan malo como perder las sesiones |
| `instituto-comahue-6-sesiones.txt` | Sintético (Neuquén) | La MISMA idea con otra sintaxis de numeración (`Sesión Nº 1 de 6 -> 08/09/2026 09:15`, flecha y fecha+hora en la misma línea) y otro formato de nombre (`LIC. RUIZ DIAZ, GABRIELA`). Debe dar **6 turnos** — prueba que la detección no está atada al literal "Sesión N/M" |
| `centro-parana-lista-de-fechas.txt` | Sintético (Entre Ríos) | Enumeración **sin numerar**: `Próximos turnos:` y cuatro viñetas de fecha + hora, con el profesional y el domicilio en prosa alrededor. Debe dar **4 turnos** SIN etiqueta de sesión inventada — el analizador no numera lo que el mensaje no numeró |
| `sanatorio-cuyo-reprogramado.txt` | Sintético (Mendoza) | **El contraejemplo, tan importante como los otros tres.** Dos fechas escritas (la original y la nueva) y UNA sola cita: debe dar **1 turno**, con la fecha NUEVA. Es el caso que impide que "ante la duda, dividí" se convierta en "cualquier texto con dos fechas son dos turnos" |

**La regla que los cuatro fijan juntos** (y que está escrita en el punto 8 de
`lib/gemini/prompt-turno.ts`): lo que se cuenta no son fechas escritas sino
citas que **van a ocurrir**. Diez fechas que CONVIVEN son diez turnos; dos
fechas donde una PISA a la otra son un turno. `scripts/test-analizar-mensaje.mjs`
verifica la cantidad exacta de cada uno contra el Gemini real, y es uno de los
dos chequeos con veredicto duro de ese script.

## La fecha escrita en palabras y sin año (agosto 2026)

Segundo bug real de campo, reportado por el dueño con captura. Los dos casos de
arriba tenían la fecha en números; este la trae **en palabras y sin año** —que
es la forma más común de escribir una fecha en castellano—. El análisis detectó
las diez sesiones y hasta el piso y el departamento de la dirección, pero las
diez salieron **sin fecha**: los formatos que el parser sabía leer eran
`DD/MM/AAAA` y `DD/MM`, nada más. Peor todavía, la pantalla mostraba las diez
tildadas bajo un botón que ofrecía "Crear los 10 turnos".

| Archivo | Origen | Qué enseña |
|---|---|---|
| `kinesiologia-fechas-en-palabras.txt` | **REAL** (consultorio de kinesiología) | **El caso que motivó el arreglo.** Diez líneas `<Día> <D> de <Mes> - <HH:MM> hs.`: mes EN PALABRAS, **sin año**, día de la semana pegado a la fecha, hora con `hs.` (con punto). El año de cada fecha se resuelve por congruencia con el día de la semana (las diez son 2026), sin pedirle la cuenta al modelo. Además: encabezado con la indicación de anunciarse en mesa, y dirección con piso y departamento en una línea con emojis (`📍 San Martín 1507, 1° piso dpto. 104`). Debe dar **10 turnos, los 10 con fecha y hora** |
| `centro-rehabilitacion-diciembre-enero.txt` | Sintético | La serie que **cruza el año nuevo**: dos fechas de diciembre y dos de enero, con los meses en minúscula y el día con tilde (`miércoles`, `sábado`), y la hora dicha sin minutos (`9 hs`). Cada fecha valida su propio año, así que la serie sale repartida entre dos años sin ninguna regla especial. Debe dar **4 turnos, los 4 con fecha** |

`scripts/test-analizar-mensaje.mjs` les aplica a estos dos un **segundo
veredicto duro** además de la cantidad: que ninguna de sus fechas quede vacía.
Detectar los diez turnos y no poder fechar ninguno es, para la persona, el
mismo resultado que no haber detectado nada.

**Nota de fidelidad sobre el fixture real:** el mensaje original seguía con más
condiciones del consultorio (tolerancia de espera, calzado, etc.) que no se
compartieron; el fixture llega hasta donde llega el texto que se aportó y no se
completó con nada inventado. Lo que sí está, está byte a byte —salvo el nombre
de la paciente, reemplazado por uno de fantasía como en todos los demás—.

**Lo que estos dos NO cambian:** los meses y días en castellano son el idioma
del producto, no una atadura geográfica. No hay ninguna zona horaria, feriado
ni convención de un país metida en el parser: la única regla es que la fecha
sin año se resuelve contra el día de la semana que declara el propio mensaje.

## Varios mensajes en un solo paste: ¿dividir o fusionar?

El usuario va a pegar más de un mensaje junto en dos escenarios REALES y
opuestos (confirmado por él el 2026-08-17):

- **Dos turnos distintos** (par del Británico: mismo template, 11:30 y 11:55
  del mismo día) → la IA debe DIVIDIR: avisar que hay más de un turno y
  cargarlos por separado, no fusionarlos.
- **Un turno en dos mensajes** (par de Casa Salud: el largo con tarifario y
  "martes 14/7" + el corto de confirmación con día/hora/profesional finales)
  → la IA debe FUSIONAR: los datos del mensaje de CONFIRMACIÓN ganan en los
  campos que se pisan (día, hora, profesional), el resto (tarifario, copago,
  avisos) se suma a las notas, y si detecta contradicción (14/7 vs 26/5) la
  MARCA para que la persona decida, en vez de resolverla en silencio.

Heurística: mismo remitente/institución + uno de los mensajes es claramente
de confirmación/datos finales → fusionar; mismo template repetido con
fecha+hora completas cada uno → dividir. Ante la duda, preguntar mostrando
lo que entendió.

**Importante para la fusión** (aprendido al generalizar el punto 8 del prompt
en agosto de 2026): en el caso de fusionar, el análisis tiene que devolver las
DOS lecturas -`relacion: "turno_mas_confirmacion"` con dos elementos-, no un
elemento ya fusionado. La fusión la hace
`lib/turnos/construir-propuestas.ts#construirFusion`, que es determinística y
además es la que AVISA cuando las dos fechas no coincidían ("el primer mensaje
decía 14/07 y la confirmación dice 26/05 — revisá cuál es"). Si el modelo
fusiona por su cuenta y devuelve un solo elemento, el resultado se ve bien
pero esa advertencia se pierde en silencio, que es justo lo que el par de Casa
Salud existe para impedir.
