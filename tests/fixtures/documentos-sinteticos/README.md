# Banco de pruebas sintético de documentos médicos

## Qué es esto

Un catálogo de 16 documentos médicos **inventados**, pensado para probar
las 4 reglas de validación endurecidas en el Sprint 18 (extracción con
Gemini de laboratorios, imágenes y consultas).

## Por qué existe

El dueño de la app cargó 47 documentos **reales** de una sola clínica
(Clínica/Sanatorio San Jorge, Ushuaia) y la IA cometió 37 errores sobre
ese lote. A partir de esos errores se endurecieron 4 reglas de
validación. El problema es que el dueño no tiene documentos de **ninguna
otra institución**: sin un segundo lote, no hay forma de comprobar que
las reglas nuevas son *generales* y no quedaron ajustadas al formato
particular de San Jorge (sus rótulos, su forma de fechar, su
numeración de órdenes).

Este banco sintético es ese segundo lote. Cada caso usa una institución,
un rótulo o un formato de fecha **distinto** de los de San Jorge, para
que las reglas se prueben contra variedad real de formatos y no contra
un solo estilo de membrete.

**Todos los datos de paciente son ficticios.** Ninguna institución de
este banco es real. Se usan dos identidades inventadas en todo el
catálogo:

- Paciente A: **María Luján Gregorio**, DNI 28.114.902, n. 15/06/1985.
- Paciente B: **Roberto Carlos Ferreyra**, DNI 22.907.318.

## Estructura

- `NN-slug.txt` — el documento impreso tal como lo leería un OCR
  (membrete, datos del paciente, tabla de resultados, firma). Texto
  plano, UTF-8 sin BOM.
- `casos.ts` — catálogo TypeScript con la extracción **cruda** que
  Gemini devolvería para cada `.txt`, antes de pasar por ningún
  validador. Expone `CASOS_SINTETICOS` (el array completo) y `caso(id)`
  (busca uno por id, lanza si no existe).

Las extracciones incluyen **a propósito** valores equivocados —una accesión
DICOM en `numero_orden`, un número de serie de equipo, la fecha de informe
elegida en vez de la de extracción— cuando esa es justamente la regla que el
caso ejercita. Lo que se prueba es el validador, no el catálogo.

### Con y sin tildes, a propósito

Ocho de los dieciséis `.txt` están escritos **con tildes** (01, 02, 04, 09, 10,
11, 12, 13) y los otros ocho **sin tildes** (03, 05, 06, 07, 08, 14, 15, 16).
No es un descuido: los sistemas de gestión viejos que usan muchos laboratorios
y servicios de imágenes argentinos imprimen sin acentuar, y los modernos sí.
Que el cotejo de nombres y el reconocimiento de rótulos toleren las dos formas
es parte de lo que este banco prueba. Los nombres en MAYÚSCULAS nunca llevan
tilde, igual que en los sistemas reales.

## Quién consume este banco

| Test | Qué prueba con estos fixtures |
|---|---|
| `tests/unit/numero-orden.test.ts` | Regla 2 — qué número de orden se acredita y cuál se descarta |
| `tests/unit/documento-schema.test.ts` | Regla 1 — recortar en vez de perder el documento (casos 12 y 13), y que los 16 validen |
| `tests/unit/duplicados-semanticos.test.ts` | Regla 3 — los dos falsos positivos de la Capa 3 (pares 05/16 y 06/07) |
| `tests/unit/gmail-coincidencia-nombre.test.ts` | Regla 4 — titularidad con apellido truncado (14), código interno (15) y DNI mal leído (16) |

## Casos

| Archivo | Institución ficticia | Formato / rótulos que ejercita | Regla del Sprint 18 que valida |
|---|---|---|---|
| `01-bioquimico-del-sur-protocolo` | Laboratorio Bioquímico del Sur (Rosario, Santa Fe) | Rótulo "Protocolo N°" + doble fecha rotulada (extracción vs. informe) | El rótulo queda impreso en `texto_completo`, así que el número **sí se acredita** (es el caso que prueba que la regla no mata a los números legítimos) |
| `02-centro-vega-orden-alfanumerica` | Centro de Análisis Clínicos Vega (Córdoba) | Número de orden alfanumérico con guion ("887-2026") + fecha escrita en letras | Se acredita por **forma**: ningún DNI, historia clínica ni accesión se imprime con guion entre grupos |
| `03-hospital-zonal-solicitud` | Hospital Zonal de Trelew (Chubut) | Rótulo "N° de Solicitud" (tercer sinónimo) + código con prefijo de letras | Se acredita por **forma**: un código con letras no puede ser un identificador de persona |
| `04-imagenes-vega-registro-dos-medicos` | Imágenes Diagnósticas del Litoral (Corrientes) | Rótulo "N° de registro" + médico solicitante y médico informante en líneas separadas | El `medico` extraído es el que informa, no el que solicita; y en **imágenes** un número solo se acredita con rótulo explícito — acá lo hay |
| `05-radiografia-accesion-dicom` | Centro de Diagnóstico por Imágenes Aconcagua (Mendoza) | Número de accesión DICOM quemado en la placa (`ACC: 15570342.01`), sin ningún rótulo de orden | Un patrón de accesión DICOM (`\d{6,}\.\d{2}`) no es número de orden — se rechaza |
| `06-columna-lumbar-frente` | Centro de Diagnóstico por Imágenes Aconcagua (Mendoza) | Accesión sin rótulo alguno (`11021738`), vista frente | Accesión sin rótulo se rechaza; y con el caso 07 forma el segundo falso positivo de la Capa 3 |
| `07-columna-lumbar-perfil` | Centro de Diagnóstico por Imágenes Aconcagua (Mendoza) | Misma accesión que el caso 06 (`11021738`), vista perfil | Dos vistas del mismo estudio comparten accesión — no deben marcarse como duplicadas entre sí |
| `08-guardia-numero-de-internacion` | Sanatorio Los Alerces (Neuquén) | Rótulo "N° de Internación" con relleno de ceros (`00176828`) | Un número de internación no es número de orden — se rechaza |
| `09-ecografia-codigo-de-equipo` | Instituto de Ecografía del Valle (Río Negro) | Número de serie del equipo en el pie del informe (`S/N 88234512`) | Un número de serie de equipo no es número de orden — se rechaza |
| `10-informe-sin-numero-de-orden` | Consultorios Médicos San Martín (Salta) | Documento sin ningún número administrativo | `numero_orden` vacío — la validación de orden simplemente no aplica |
| `11-laboratorio-dos-fechas-contradictorias` | Laboratorio Central de Tandil (Buenos Aires) | Fecha de informe anterior a la fecha de extracción (cronológicamente imposible) | Caso hostil para la validación de fecha ante fechas contradictorias |
| `12-laboratorio-rango-en-tres-renglones` | Laboratorio de Endocrinología Pampeana (Santa Rosa, La Pampa) | Rango de referencia de TSH impreso en tres renglones (por edad/embarazo), 116 caracteres | Un `rango` larguísimo debe recortarse, nunca descartar la extracción entera |
| `13-consulta-texto-completo-507` | Policlínico Regional del Comahue (Cipolletti, Río Negro) | `texto_completo` de 507 caracteres (7 por encima del tope de 500) | Un `texto_completo` que excede el tope debe recortarse, nunca descartar la extracción entera |
| `14-laboratorio-apellido-truncado` | Laboratorio Bioquímico del Sur (Rosario, Santa Fe) | Apellido truncado por el sistema del laboratorio ("GREGORI" en vez de "GREGORIO") | Un apellido truncado por el sistema emisor no puede rechazar la titularidad del documento |
| `15-informe-paciente-codigo-interno` | Centro de Medicina Nuclear del Plata (La Plata) | El nombre del paciente se reemplaza por un código interno de turno | Un código en vez de nombre es "no se sabe de quién es", no "es de otra persona" |
| `16-radiografia-dni-mal-leido` | Centro de Diagnóstico por Imágenes Aconcagua (Mendoza) | DNI mal impreso en una placa de baja resolución (un dígito cambiado), nombre completo y correcto | El DNI solo corrobora la titularidad; nunca puede rechazar por sí solo |

## Cómo agregar un caso nuevo

1. Creá el `.txt` en esta carpeta con el documento impreso (membrete,
   datos de paciente, tabla o cuerpo del informe, firma). UTF-8 sin BOM,
   entre 15 y 45 líneas, con el estilo de OCR de un documento real
   (mayúsculas de membrete, líneas de guiones, alineación con espacios).
2. Sumá una definición al array `DEFINICIONES` de `casos.ts` con el
   mismo `id` que el nombre de archivo (sin extensión), la
   `institucion`, la `regla` que ejercita, y la `extraccion` cruda tal
   como la devolvería Gemini (nunca `null`, siempre `""` para campos
   vacíos).
3. Sumá una fila a la tabla de este README.
4. Usá siempre datos ficticios: instituciones inventadas de provincias
   argentinas, y para el paciente reutilizá a María Luján Gregorio o a
   Roberto Carlos Ferreyra (o sumá una tercera identidad igual de
   ficticia si el caso lo requiere). Nunca "Hernández", "Darío", ni
   DNIs que empiecen con 314 — ese es el paciente real del lote de
   San Jorge y este banco existe justamente para no parecerse a él.
