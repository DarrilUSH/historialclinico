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
