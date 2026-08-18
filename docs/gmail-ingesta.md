# Ingesta desde Gmail — el barrido, la bandeja y los filtros aprendidos

> Sprint 17, tarea 17.2. La tarea 17.1 (conexión OAuth, token en el Vault,
> etiqueta `historialmedico` creada sola) está documentada en
> `docs/minimizacion-datos.md` §10 y en el encabezado de
> `supabase/migrations/20260818130000_gmail_conexiones.sql`.

## 1. Qué hace, en una frase

Cada media hora —y también cuando la persona toca **"Buscar ahora"**— la
aplicación mira **solo los correos de la etiqueta `historialmedico`**, anota lo
que encontró y lo deja esperando en una lista. Nada entra al historial sin que
una persona lo revise: cada ítem de esa lista termina en una pantalla de
revisión **que ya existía** —la del estudio recién subido, o `/turnos/nuevo`
con la propuesta precargada—.

```
pg_cron (cada 30 min)                    "Buscar ahora"
        │                                       │
        ▼                                       ▼
disparar_barrido_gmail()          buscarCorreosAhora()  (Server Action)
        │  pg_net + x-cron-secret               │
        ▼                                       │
POST /api/gmail/procesar-barrido               │
        └───────────────┬───────────────────────┘
                        ▼
              lib/gmail/barrido.ts
        (token → listar etiqueta → dedup → messages.get → clasificar → registrar)
                        │
                        ▼
              public.gmail_messages          ← METADATOS, nunca el correo
                        │
        ┌───────────────┴────────────────┐
        ▼                                ▼
  adjunto: "Revisar este estudio"   cuerpo con pinta de turno: "Revisar este turno"
        │                                │
  lib/gmail/adjunto.ts              /turnos/nuevo?gmail=<id>
  → ingestarDocumento()             → POST /api/gmail/analizar-correo
  → /estudios/nuevo/procesando        → analizarMensajeTurno() (16.4)
     (LA pantalla de revisión)          → formulario precargado
```

## 2. Las cuatro decisiones de diseño

### 2.1 El barrido registra; la ingesta ocurre cuando la persona toca

El barrido **no baja adjuntos y no crea filas en `documents`**. Guarda un
descriptor de cada adjunto (nombre, tipo, tamaño y el `attachmentId` con el que
Gmail lo entrega después) y nada más. Los bytes viajan recién cuando alguien
toca "Revisar este estudio".

Tres razones, y cada una alcanzaría sola:

1. **La confirmación existente no lo permitiría.** El RPC
   `confirmar_documento_recien_subido` (`20260813010000`) exige que quien
   confirma sea el CREADOR del documento y que no hayan pasado más de 60
   minutos desde `created_at`. Un correo que llega a las 3 de la mañana y se
   revisa a las 9 llegaría con la ventana vencida; y un documento creado por
   `service_role` no tiene perfil creador que sellar. Habría que relajar dos de
   las mejores guardas del proyecto para acomodar un caso que se resuelve sin
   tocarlas.
2. **A qué PERFIL va cada correo es una decisión humana.** La casilla es de la
   CUENTA y una cuenta administra varios perfiles.
3. **El barrido tiene que ser corto** (función serverless del plan gratuito).

Creando el documento en el momento en que la persona toca, con SU sesión y
sobre el perfil ACTIVO, las dos guardas se cumplen solas y no hubo que tocar
ninguna. Y el destino es literalmente la misma pantalla que ve después de
sacarle una foto a un estudio.

### 2.2 Lo mismo con el cuerpo del correo: no se guarda, se vuelve a pedir

`gmail_messages` no tiene una columna con el texto del correo. Cuando la
persona abre `/turnos/nuevo?gmail=<id>`, la aplicación **le vuelve a pedir el
mensaje a Gmail**, saca el texto, se lo manda a Gemini y lo deja ir. Una
llamada HTTP de más a cambio de no tener cuerpos de correo guardados en la
base.

### 2.3 La heurística es una puerta de privacidad, no una optimización

El cuerpo sale hacia Gemini **solo si `pareceAvisoDeTurno()` dice que sí**
(`lib/gmail/heuristica-turno.ts`). Cómo decide:

- **Palabras de turno** (sin tildes, en minúsculas): `turno`, `cita medica`,
  `consultorio`, `reprogram…`, `se asigna`, `presentarse`, `concurrir`,
  `orden medica`, `profesional:`, `especialidad:`, `recordatorio de su`, …
- **Una fecha o una hora**: `14/7`, `14/07/2026`, `22 de septiembre`, `9:45`,
  `18.10 hs`.

Da positivo con **una palabra + (fecha u hora)**, o con **dos palabras
distintas**. Los fragmentos no pueden ser subcadenas unos de otros: tener
`turno` y `turnos` a la vez hacía que una newsletter que dijera "sacá turnos
online" contara dos señales por la misma palabra
(`tests/unit/gmail-heuristica-turno.test.ts` lo encontró).

Reparto de costos: un **falso positivo** cuesta una llamada a la IA y un ítem
de más que se descarta de un toque; un **falso negativo** deja el correo en la
bandeja igual, con su asunto y su remitente, sin propuesta. Nada se pierde en
silencio, así que el umbral se elige generoso hacia el positivo pero no tanto
como para mandar cualquier cosa afuera.

### 2.4 La huella digital: dedup por CONTENIDO, no solo por mensaje (hotfix, Sprint 17 en vivo)

El dedup por `gmail_message_id` (§2.1) evita procesar el MISMO CORREO dos
veces. No evita que dos correos DISTINTOS traigan el MISMO ARCHIVO: el caso
real que motivó este hotfix fue un reenvío "RV:" sobre el original, con
segundos de diferencia, con idéntico PDF adjunto. Los dos mensajes son
legítimamente distintos -el dedup funcionó como tenía que funcionar-, pero
nada avisaba que el estudio ya estaba en el historial.

`ingestarDocumento` (`lib/documentos/ingesta.ts`) calcula el SHA-256 de los
bytes de CADA archivo que entra al producto -por Gmail, por subida manual o
por Web Share Target, las tres puertas- y lo guarda en
`documents.content_sha256`. Antes de crear un documento nuevo, coteja esa
huella contra los documentos que el perfil YA tiene. Si hay una coincidencia,
NO crea nada: la persona ve "Este archivo es idéntico a «título» cargado el
fecha" con dos acciones, **Ver ese estudio** y **Cargar igual** -esta última
fuerza la carga igual, porque puede ser una decisión legítima-.

**Qué detecta y qué no:** archivos BYTE A BYTE idénticos. Un PDF que la
clínica REGENERA -mismo contenido, pero el motor que lo arma le puso otra
fecha de generación en los metadatos, o lo comprimió distinto- tiene bytes
distintos y no matchea. Este límite quedó DECLARADO como deuda hasta el
primer día real de uso: al usuario le llegó un par de PDF del Sanatorio San
Jorge con el MISMO N° DE ORDEN (1446188), contenido idéntico, 2 bytes de
diferencia, y la huella no avisó nada. §2.4bis mitiga exactamente ese caso con
dos capas adicionales sobre datos ya extraídos con Gemini.

### 2.4bis Duplicados SEMÁNTICOS: cuando la huella no alcanza (hotfix sobre el hotfix)

Dos capas más, `lib/documentos/duplicados-semanticos.ts` (puras, sin red),
que cotejan la EXTRACCIÓN de Gemini en vez de los bytes:

- **Capa 2 — mismo laboratorio + mismo N° de orden.** Gemini extrae ahora un
  campo `numero_orden` (opcional, `lib/gemini/schemas.ts`) del documento -el
  número de orden/protocolo que el laboratorio imprime-, y se persiste en
  `documents.numero_orden` (`20260818180000_duplicados_semanticos.sql`): es
  un dato clínico-administrativo del ESTUDIO, no de una persona, y sirve para
  siempre (no solo para este cotejo). Si el nuevo documento coincide en
  institución (normalizada) + número de orden con un documento YA CONFIRMADO
  del perfil, es duplicado directo -exactamente el caso del Sanatorio San
  Jorge-.
- **Capa 3 — TODOS los datos extraídos exactamente iguales.** Fecha
  (condición NECESARIA, se compara primero: fecha distinta = JAMÁS
  duplicado, sin importar cuántas métricas coincidan -un estudio repetido en
  otra fecha con el mismo resultado es un dato válido para Tendencias, no un
  duplicado-), categoría, institución, médico y CADA métrica de laboratorio
  con su valor y unidad. Institución/médico/nombres de métrica se normalizan
  (tildes, mayúsculas, espacios) antes de comparar.

**Dónde corre:** en `POST /api/documentos/extraer` -recién ahí existen datos
estructurados con los que comparar-, justo después de validar la extracción
de Gemini, contra los documentos YA CONFIRMADOS del mismo perfil
(`lib/documentos/duplicados-semanticos-consulta.ts`, cliente del usuario). Es
el mismo punto de choque para las TRES puertas de entrada -manual, Web Share
Target, "Revisar este estudio" de Gmail-, porque las tres convergen en
`/estudios/nuevo/procesando`, la misma pantalla de revisión. Si encuentra
algo, `FormularioRevision` muestra la franja "Es un duplicado: [motivo] —
idéntico a «X» del DD/MM" con **Ver ese estudio** y **Cargar igual** -esta
última solo descarta el aviso: a diferencia de la huella, acá el documento YA
existe (fue creado antes de la extracción), así que el único botón que
persiste sigue siendo "Confirmar y guardar"-.

**En la AUTO-INGESTA** (§9), la misma compuerta corre con
`lib/gmail/duplicados-semanticos-admin.ts` (`service_role`, sin sesión):
si hay sospecha de Capa 2 o Capa 3, el correo NO se carga solo -queda a
revisión humana con el motivo escrito (`duplicado_numero_orden` /
`duplicado_datos_identicos`, `lib/gmail/auto-ingesta.ts`)-.

**Qué NO mitiga:** un documento que la persona nunca confirmó no participa
como candidato -institución/médico/número de orden y `lab_metrics` solo
existen después de `confirmar_documento_recien_subido`-, y los documentos
anteriores a `20260818180000` no tienen `numero_orden` (sin backfill posible:
no hay forma de derivarlo sin volver a llamar a Gemini), así que la Capa 2 no
los alcanza -la Capa 3 sí, porque no depende de esa columna-.

**Los documentos de ANTES de esta migración** nacen sin huella
(`content_sha256 = NULL`): no hubo backfill en SQL porque los bytes viven en
Storage, no en la base. Se completan PEREZOSAMENTE
(`lib/documentos/huella-admin.ts#backfillHuellasFaltantes`): la primera vez
que alguien sube algo nuevo a un perfil con documentos viejos sin huella, el
cotejo backfillea unos pocos (`LIMITE_BACKFILL_POR_COTEJO = 5`) antes de
comparar. Es best-effort -si Storage falla para alguno, ese sigue sin huella
y el cotejo de esta carga simplemente no lo ve- y acotado -nunca convierte una
subida en una corrida de minutos-, así que un perfil con historial viejo
termina de backfillearse solo, a lo largo de varias cargas.

**Una marca discreta y previa, en la bandeja de Gmail:** entre los correos
PENDIENTES, si dos traen un adjunto con el mismo NOMBRE y un tamaño dentro
del **±2%** -la metadata que el barrido YA registra, sin bajar ningún byte-,
`lib/gmail/deteccion-duplicados.ts` marca a cada uno con "Posible duplicado
del correo de las {hora}". La tolerancia de tamaño (antes exigía el tamaño
EXACTO) es el mismo ajuste del hotfix de duplicados semánticos: un PDF
regenerado por la clínica puede pesar unos pocos bytes distinto sin dejar de
ser, a los ojos de cualquiera, "el mismo archivo" -exigir el tamaño exacto
dejaba afuera justo el caso real que más costó (2 bytes de diferencia)-. No
bloquea nada y no reemplaza al cotejo real: es un aviso ANTES de gastar la
llamada a Gmail que baja el adjunto.

### 2.5 Los filtros se aprenden del uso, porque no hay catálogo que los tenga

El catálogo REFES (16.3) tiene los centros de salud con dirección y teléfono,
pero **no tiene las direcciones de correo desde las que mandan los turnos**. No
existe una lista de "remitentes médicos" para precargar. Entonces la app
aprende: cuando alguien revisa un correo de `turnos@sanjorge.com.ar`, ofrece de
un toque que los próximos de esa dirección entren solos a la etiqueta.

El filtro que se crea hace **una sola cosa**: agregar la etiqueta
(`action: { addLabelIds: [...] }`). Nunca `removeLabelIds` (que archivaría),
nunca `shouldTrash`, nunca `shouldMarkAsRead`. El correo sigue llegando a la
bandeja de entrada como siempre. Y cada filtro creado queda anotado en
`gmail_filters` **para poder borrarlo desde la app**: crear reglas invisibles en
la casilla de alguien sin darle el botón de deshacerlas sería lo contrario del
compromiso del §10 de minimización.

## 3. Límites y tandas

| Límite | Valor | Dónde | Por qué |
|---|---|---|---|
| Mensajes nuevos por pasada y por casilla | 15 | `LIMITE_MENSAJES_POR_PASADA` | Cada uno cuesta un `messages.get`. Quince deja la pasada en pocos segundos y cubre cualquier día normal. |
| Páginas del listado por pasada | 4 × 50 ids | `MAX_PAGINAS` | Evita paginar para siempre en una etiqueta enorme y ya toda procesada. |
| Casillas por corrida del cron | 25 | `LIMITE_CONEXIONES_POR_CORRIDA` | En esta instalación son una o dos; el tope es para que 50 cuentas no hagan una request de minutos. |
| Tamaño de adjunto | 25 MB | `LIMITE_BYTES` (el del pipeline) | Es el mismo límite que una subida a mano. El adjunto más grande se registra igual, marcado no apto y con su motivo, para poder explicarlo en pantalla. |

Cuando algo queda afuera por la tanda, el resultado trae `hayMas: true` y la
frase que ve la persona termina con *"Todavía quedan más: tocá otra vez para
seguir."*.

## 4. Modos de falla, y qué hace cada uno

| Qué pasa | Qué hace el barrido |
|---|---|
| Un mensaje falla (500 de Google, JSON raro) | Se cuenta como error, **no se registra**, y la pasada sigue con los demás. La próxima pasada lo reintenta. |
| `invalid_grant` al refrescar el token | La conexión queda `vencida` (17.1) y esa casilla se saltea. La pantalla ofrece reconectar. |
| `401` a mitad de la pasada | Igual que el anterior: se marca vencida, se conserva lo ya registrado y se corta ESA casilla. |
| Una casilla falla entera | Las demás de la corrida siguen (`barrerConexiones` atrapa por conexión). |
| La conexión no tiene `label_id` | **No se barre nada.** No hay caída a "leer la casilla entera": ese es el compromiso del §10.3. |
| El filtro ya existía en Gmail | No es error: se relista, se reconoce el que estaba y la pantalla dice "ya lo teníamos puesto". |
| Se borra el documento que salió de un correo | La fila del registro **no** se borra (si se borrara, el correo se volvería a proponer para siempre): el puntero queda en `NULL` y la bandeja ofrece "Volver a la lista". |

## 5. Configuración del cron (una vez por entorno)

Mismo patrón que los recordatorios de turnos y las alertas de medicación, y
**el mismo `CRON_SECRET`**: hay un solo secreto de cron por entorno, guardado en
el Vault bajo el nombre `cron_recordatorios_secret`. Lo único propio de este job
es la URL.

```sql
-- 1) Si es un entorno nuevo, primero el secreto (lo comparten los tres jobs):
select public.configurar_cron_recordatorios(
    'http://host.docker.internal:3000/api/push/procesar-recordatorios',
    '<el mismo valor que CRON_SECRET en el entorno de la app>'
);

-- 2) La URL de este barrido:
select public.configurar_cron_gmail(
    'https://www.historialmedico.com.ar/api/gmail/procesar-barrido'
);
-- En local: 'http://host.docker.internal:3000/api/gmail/procesar-barrido'
```

`configurar_cron_gmail` **no tiene EXECUTE ni para `service_role`**: se corre
desde psql o el SQL editor, que corren como `postgres`. Si el Vault todavía no
tiene el secreto, la función deja la URL cargada y avisa con un `warning`.

El job (`barrido-gmail`, `*/30 * * * *`) se crea con la migración. Si no hay
ninguna casilla conectada, termina sin hacer el POST. Si el Vault no está
configurado, degrada con un `warning` en vez de fallar — así un `db reset` en
medio del desarrollo no deja el cron en rojo cada media hora.

**Por qué 30 minutos**: el correo de una clínica no es urgente (avisa un turno
que es dentro de días, o manda un estudio ya hecho), así que la frecuencia se
elige para que "Buscar ahora" casi nunca haga falta sin gastar al pedo. Son 48
pasadas por día por casilla; contra el límite gratuito de Gmail (mil millones
de unidades de cuota por día, `messages.list` cuesta 5) es ruido. Cada 15
minutos duplicaría las corridas sin que nadie note la diferencia; cada hora
empezaría a hacer necesario el botón.

Para ver si el job corre:

```sql
select jobname, schedule, active from cron.job where jobname = 'barrido-gmail';
select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'barrido-gmail')
 order by start_time desc limit 5;
-- Y la respuesta HTTP que dio la app:
select id, status_code, content from net._http_response order by created desc limit 5;
```

## 6. Mapa de archivos

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/20260818140000_gmail_mensajes.sql` | `gmail_messages`, `gmail_filters`, RLS, el job y `configurar_cron_gmail`. |
| `lib/gmail/mensaje.ts` | **Puro.** Interpreta el JSON de `messages.get`: remitente, asunto, fecha, adjuntos y cuerpo (base64url + charset, HTML → texto). |
| `lib/gmail/heuristica-turno.ts` | **Puro.** ¿El cuerpo parece un aviso de turno? |
| `lib/gmail/barrido.ts` | La pasada: token, listado, dedup, clasificación, registro, tandas y modos de falla. |
| `lib/gmail/mensajes-admin.ts` | `service_role`: el único camino de escritura del registro. Toda escritura va acotada por `user_id`. |
| `lib/gmail/mensajes.ts` | Lectura para las pantallas, con el cliente del usuario (RLS). |
| `lib/gmail/adjunto.ts` | El puente al pipeline: baja el adjunto y llama a `ingestarDocumento`. |
| `lib/gmail/deteccion-duplicados.ts` | **Puro.** Marca "posible duplicado" entre pendientes por (nombre, tamaño) de adjuntos — hotfix de huella digital. |
| `lib/documentos/huella.ts` | **Puro + lectura RLS.** SHA-256 de bytes, cotejo por perfil — hotfix de huella digital. |
| `lib/documentos/huella-admin.ts` | `service_role`: backfill perezoso de huellas de documentos viejos — hotfix de huella digital. |
| `lib/gmail/filtros.ts` | Aprender y olvidar un remitente. |
| `lib/gmail/google-api.ts` | Las llamadas HTTP (17.1 + las cinco de la 17.2). Bases inyectables para los tests. |
| `app/api/gmail/procesar-barrido/route.ts` | El endpoint del cron (`x-cron-secret`). |
| `app/api/gmail/analizar-correo/route.ts` | Trae el cuerpo del correo y devuelve la propuesta de turno de la 16.4. |
| `app/(app)/(con-nav)/perfil/gmail/actions.ts` | Las seis Server Actions de la bandeja. |
| `components/gmail/bandeja-gmail.tsx` | "Llegaron por Gmail": pendientes, ya procesados y filtros. |
| `components/gmail/detalle-correo.tsx` | Diálogo de detalle (asunto/remitente/fecha completos + acciones) — ampliación en vivo, pedido del usuario en producción, 2026-08-18. |
| `components/turnos/precarga-gmail.tsx` | El hermano automático del analizador de la 16.4. |
| `supabase/migrations/20260818160000_gmail_auto_ingesta.sql` | La carga automática (§9): el interruptor, la marca de origen y las tres RPC — ampliación en vivo, pedido del usuario en producción, 2026-08-18. |
| `lib/gmail/auto-ingesta.ts` | **Puro.** La compuerta "sin dudas" (§9.2): decide, sin llamar a nada, si un documento o un turno leídos entran solos. |
| `lib/gmail/coincidencia-nombre.ts` | **Puro.** El cotejo de titularidad, contra `profiles.full_name`, para documentos y turnos. |
| `lib/gmail/auto-carga.ts` | La pasada automática dentro del barrido: baja el adjunto, llama a Gemini, consulta la compuerta y carga o anota el motivo (§9.1). |
| `lib/gmail/auto-ingesta-admin.ts` | `service_role`: enciende/apaga el interruptor, llama a las dos RPC de carga y hace el Deshacer (§9.5). |
| `lib/gmail/pendientes-admin.ts` | `service_role`: las dos consultas sin sesión que la pasada automática necesita (huella ya cargada, otros pendientes para la marca de posible duplicado). |
| `lib/documentos/ingesta-automatica.ts` | Sube el adjunto a Storage con `service_role` y crea el documento automático, con compensación si la RPC no devuelve `creado`. |
| `lib/gemini/schemas.ts` / `lib/gemini/prompt-documento.ts` | `SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE` / `PROMPT_DOCUMENTO_MEDICO_CON_PACIENTE`: el schema y el prompt derivados, exclusivos del camino automático. |
| `components/gmail/panel-auto-carga.tsx` | El interruptor, el selector de perfil de destino y "Evaluar pendientes" en `/perfil/gmail`. |
| `supabase/migrations/20260818180000_duplicados_semanticos.sql` | Duplicados semánticos: `documents.numero_orden`, y los dos RPC extendidos (`confirmar_documento_recien_subido`, `ingresar_documento_automatico`). |
| `lib/documentos/duplicados-semanticos.ts` | **Puro.** Capas 2 y 3 del detector: mismo N° de orden, o todos los datos exactamente iguales (fecha primero, condición necesaria). |
| `lib/documentos/duplicados-semanticos-consulta.ts` | Cliente del usuario: candidatos (documentos confirmados del perfil + `lab_metrics`) para las tres puertas humanas — llamado desde `app/api/documentos/extraer/route.ts`. |
| `lib/gmail/duplicados-semanticos-admin.ts` | `service_role`: mismo cotejo, sin sesión, para la compuerta de auto-ingesta. |
| `lib/gmail/mensajes-admin.ts` (`listarPendientesSinEvaluarAutoCarga`) | Los correos pendientes que NUNCA pasaron por la compuerta -el backlog que "Evaluar pendientes" resuelve-. |
| `lib/gmail/auto-carga.ts` (`evaluarPendientesGmail`) | Pasa correos YA pendientes por la MISMA compuerta que el barrido, de a tandas. |

## 7. Cómo se verifica

```bash
npm run test                    # incluye los tres archivos de Gmail de la 17.2
docker exec -i supabase_db_historialclinico psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < scripts/test-rls.sql      # BLOQUE 24
```

- `tests/unit/gmail-mensaje.test.ts` — el parseo, con payloads reales de Gmail.
- `tests/unit/gmail-heuristica-turno.test.ts` — la puerta de privacidad, con
  sus casos negativos.
- `tests/unit/gmail-barrido.test.ts` — **el barrido de punta a punta contra un
  Gmail de mentira** (`node:http`): una pasada con cinco correos deja 2
  estudios, 1 turno, 1 descartado y 1 error aislado; más paginación, tandas,
  dedup, `401` a mitad de camino, adjunto de 40 MB, el puente a
  `ingestarDocumento` y el filtro duplicado.
- `scripts/test-rls.sql` BLOQUE 24 (21 casos) — RLS por fila, cero escritura
  para el navegador, el dedup como invariante de la base, `ON DELETE SET NULL`
  de los punteros, la baja de cuenta y el job.
- `tests/unit/huella-documentos.test.ts` — huella estable, huella distinta
  para contenido distinto, cotejo con/sin coincidencia acotado por perfil, el
  error de la consulta se propaga, formateo de fecha sin corrimiento de zona.
- `tests/unit/huella-admin.test.ts` — backfill perezoso con Storage y el
  cliente `service_role` MOCKEADOS: tope de `LIMITE_BACKFILL_POR_COTEJO`,
  best-effort si falla el SELECT/la descarga/el UPDATE, escritura acotada por
  `profile_id`.
- `tests/unit/gmail-deteccion-duplicados.test.ts` — el emparejamiento por
  (nombre, tamaño ±2%), sin falsos positivos por nombre O tamaño solos,
  adjuntos no aptos excluidos, la rueda de emparejamiento con 3+
  coincidencias, el borde exacto del 2% (adentro sí, 5% no).
- `tests/unit/duplicados-semanticos.test.ts` — Capas 2 y 3 puras: mismo N° de
  orden + institución (evidencia real, Sanatorio San Jorge 1446188), fecha
  distinta = cero avisos aunque todo lo demás coincida (regla 2 del usuario),
  normalización de tildes/mayúsculas/espacios, métricas como conjunto
  (orden no importa, sinónimos del diccionario cuentan igual, deduplica antes
  de comparar), y el veredicto combinado con varios candidatos.
- `tests/unit/gmail-detalle-correo.test.tsx` — el diálogo de detalle
  (ampliación en vivo): el disparador trunca pero el diálogo muestra el
  asunto ENTERO, el nombre accesible completo, los links a estudio/turno
  según corresponda, y las acciones según el estado del correo.
- `tests/unit/gmail-coincidencia-nombre.test.ts` — el cotejo de titularidad
  (§9), en los dos sentidos: lo que TIENE que coincidir y, sobre todo, lo que
  NO puede coincidir, con el caso real del encargo (la casilla que recibe los
  estudios de la madre) en su propio `describe`.
- `tests/unit/gmail-auto-ingesta.test.ts` — la compuerta "sin dudas" (§9.2),
  un caso por cada `MotivoRevision`: si mañana alguien afloja un chequeo, el
  test que se pone rojo lleva el nombre de lo que se aflojó.
- `tests/unit/gmail-auto-carga.test.ts` — el circuito de la carga automática
  de punta a punta, contra el mismo Gmail de mentira que `gmail-barrido.test.ts`:
  correo perfecto que entra solo, cada tipo de duda con su motivo, duplicado
  que ni siquiera llega a llamar a Gemini, e interruptor apagado que no toca
  absolutamente nada.

- `scripts/test-rls.sql` BLOQUE 25 (55 casos) — las cuatro guardas de
  `ingresar_documento_automatico` / `ingresar_turno_automatico` con su versión
  HOSTIL de cada una (perfil que la cuenta no administra, opt-in apagado,
  replay, duplicado, correo ajeno, `can_manage` revocado DESPUÉS de encender
  el interruptor), el CHECK+trigger que evita que un interruptor prendido
  bloquee el borrado del perfil de destino, la inmutabilidad de
  `auto_ingest_source` desde una sesión de usuario, y la mitad del Deshacer
  que sí depende de sesión y de RLS —justo la que `tests/unit/gmail-auto-carga.test.ts`
  declara en su propio comentario que no prueba, por ser borrado con la sesión
  de la persona—.

**Migración `20260818150000_huella_documentos.sql` (huella digital):** no
tocó ninguna política RLS -una columna nueva de una tabla ya cubierta hereda
la misma autorización, ver el encabezado de la migración y el precedente de
`20260817231000` (tarea 16.1)-, así que el arnés no sumó casos nuevos; se
corrió igual **441/441 ×2** (antes y después de esta migración) para
confirmar que no rompió nada de lo existente.

En local, `supabase db reset` deja una conexión de Gmail de mentira y cuatro
correos ya barridos (`supabase/seed.sql` §12) para poder ver la pantalla sin
conectar una casilla real. **El token del seed es falso**: tocar "Buscar ahora"
en local hace que Google conteste `invalid_grant` y la conexión quede vencida.

## 8. Deuda declarada

1. **Un solo perfil por vez.** El estudio se ingiere sobre el perfil ACTIVO. Si
   el correo es de otra persona de la familia, hay que cambiar de perfil antes
   —la pantalla lo dice—. Elegir el perfil desde la propia bandeja sería mejor;
   no se hizo para no duplicar el selector de perfiles en una pantalla más.
2. **El correo con varios turnos** carga el primero; los demás se ven listados
   pero hay que volver al correo para cargar el siguiente.
3. **`raw_ocr_text` y la fecha del correo no se usan como pista** en la
   extracción del documento: el pipeline de Gemini recibe el archivo tal cual,
   sin el contexto del asunto ni del remitente. Podría mejorar la extracción.
4. **No hay push cuando llega algo nuevo.** El contador aparece en `/inicio` la
   próxima vez que la persona abre la app. Sumar el aviso empujado es una tanda
   propia (reusaría `lib/push/servidor.ts`).
5. **La huella digital (§2.4) detecta archivos IDÉNTICOS, no estudios
   equivalentes — MITIGADO por §2.4bis.** Un PDF regenerado por la clínica
   -mismo contenido, otros bytes- no matchea por hash, pero desde el hotfix
   de duplicados semánticos SÍ lo detectan la Capa 2 (mismo laboratorio +
   mismo N° de orden) y la Capa 3 (todos los datos extraídos exactamente
   iguales). No se intentó comparación semántica de IMÁGENES ni similitud de
   texto libre -sigue siendo una técnica más cara y con falsos positivos
   propios-: las dos capas nuevas comparan datos ESTRUCTURADOS ya extraídos
   por Gemini, no el archivo en sí. Deuda que sigue abierta: un documento sin
   número de orden impreso y sin ninguna métrica de laboratorio (una consulta
   sin institución ni médico detectados, por ejemplo) puede seguir sin
   detectarse si además el PDF se regeneró con bytes distintos.
6. **El aviso de duplicado en `/compartir` (Web Share Target) es más austero**
   que en `/estudios/nuevo` y en la bandeja de Gmail: mismo título+fecha en el
   mensaje y el mismo "Ver ese estudio", pero "Cargar igual" es "tocá la
   tarjeta del perfil de nuevo" en vez de un botón dedicado -no se armó un
   tercer patrón de UI para un camino de entrada que no estaba en el pedido
   original del hotfix-. Esto sigue valiendo solo para la huella (Capa 1): la
   franja de duplicados SEMÁNTICOS (Capas 2/3) vive en `FormularioRevision`,
   la pantalla de revisión posterior por la que pasan los tres caminos de
   entrada por igual -incluido `/compartir`-, así que ahí sí es una sola UI.
7. **Un documento sin confirmar no es candidato de las Capas 2/3.**
   `institution`/`doctor_name`/`numero_orden`/`lab_metrics` solo existen
   después de `confirmar_documento_recien_subido`; un documento a medio
   revisar en otra pestaña no participa del cotejo hasta que alguien lo
   confirme.

## 9. La carga automática (opt-in, Sprint 17, tarea 17.3)

Todo lo de arriba (§1 a §8) describe el circuito de la 17.2: el barrido
REGISTRA, y una persona decide, correo por correo, qué entra al historial.
Después de usar eso en producción, el pedido del usuario fue puntual:
*"cuando un correo se lee SIN NINGUNA duda, que se cargue solo; solo lo
dudoso queda a revisión manual"*. Esta sección documenta esa segunda pasada
-la que corre SOLO para las conexiones que la persona encendió a mano- y
remite a `docs/minimizacion-datos.md` §10.7 para el cambio de contrato de
privacidad que trae (el barrido, con el interruptor prendido, SÍ le manda a
Gemini el cuerpo del correo y los bytes del adjunto, sin que nadie los mire
antes).

### 9.1 El circuito, paso a paso

```
barrido de la etiqueta (§1, sin cambios)
        │
        ▼
gmail_messages (registrado, pendiente_revision)
        │
        ▼
¿la conexión tiene auto_ingest_enabled = true?  ──── no ──→ fin (17.2 de siempre)
        │ sí
        ▼
lib/gmail/auto-carga.ts — hasta LIMITE_AUTO_POR_PASADA = 3 correos (§9.4)
        │
        ├─ documento: baja el adjunto (descargarAdjunto) ─┐
        │                                                  │
        └─ turno: usa el cuerpo que ya tiene en memoria ───┤
                                                             ▼
                                          Gemini (SCHEMA_..._CON_PACIENTE /
                                          analizarMensajeTurno de la 16.4)
                                                             │
                                                             ▼
                                    lib/gmail/auto-ingesta.ts — LA COMPUERTA
                                    (evaluarDocumentoParaAutoCarga /
                                     evaluarTurnoParaAutoCarga)
                                                             │
                              ┌──────────────────────────────┴───────────────────────┐
                              ▼ sinDudas = true                                       ▼ algún motivo
                    ingresar_documento_automatico /                    anotarMotivoDeRevision(frase)
                    ingresar_turno_automatico (RPC,                    → correo sigue pendiente,
                     4 guardas, `docs/modelo-permisos.md` §7.5)          con el motivo escrito
                              │
                              ▼
                    documents / appointments
                    auto_ingest_source = 'gmail'
```

Antes de gastar una llamada a Gemini, `intentarDocumento`
(`lib/gmail/auto-carga.ts`) ya cotejó la huella del archivo y la marca de
"posible duplicado" con las mismas funciones del §2.4 -si el archivo ya está,
ni se lo manda al modelo-, y si el correo trae más de un adjunto apto, corta
ahí mismo con el motivo `varios_adjuntos` sin bajar ni leer nada: cuál de los
dos importar es una decisión, no algo que la compuerta pueda inferir.

### 9.2 La definición ESTRICTA de "sin dudas"

**La compuerta se abre solo si la lista de motivos está vacía.** No hay
puntajes ni umbrales ni "dos de tres": un solo motivo, cualquiera, manda el
correo a la bandeja de siempre. Cada motivo es la frase exacta que la persona
lee en `auto_review_reason` (`TEXTO_MOTIVO`, `lib/gmail/auto-ingesta.ts`):

**Comunes a documentos y turnos:**

| Motivo | Lo que dice la bandeja |
|---|---|
| `nombre_no_coincide` | "el nombre que figura no es el del perfil elegido" |
| `sin_nombre_de_paciente` | "no dice a nombre de quién viene" |

**Solo adjuntos:**

| Motivo | Lo que dice la bandeja |
|---|---|
| `lectura_fallida` | "no pudimos leer el archivo automáticamente" |
| `fecha_no_confiable` | "no pudimos leer con seguridad la fecha" |
| `categoria_indeterminada` | "no pudimos identificar qué tipo de estudio es" |
| `sin_datos_de_contexto` | "no dice de qué institución ni de qué especialidad es" |
| `duplicado_exacto` | "ya tenías cargado un archivo idéntico" |
| `posible_duplicado` | "puede estar repetido con otro correo" |
| `duplicado_numero_orden` | "ya tenías cargado un estudio del mismo laboratorio con el mismo número de orden" (Capa 2, hotfix de duplicados semánticos) |
| `duplicado_datos_identicos` | "ya tenías cargado un estudio con exactamente los mismos datos" (Capa 3) |
| `varios_adjuntos` | "traía más de un archivo y hay que elegir cuál" |

**Solo turnos:**

| Motivo | Lo que dice la bandeja |
|---|---|
| `aviso_del_analizador` | "faltaban datos del turno" |
| `varios_mensajes` | "el correo traía más de un turno" |
| `contradiccion` | "los datos del correo se contradicen entre sí" |
| `turno_vencido` | "la fecha del turno ya pasó" |

Si un correo queda afuera por varios motivos a la vez, la bandeja los lista
TODOS, no solo el primero: mostrar uno solo le haría creer a la persona que
arreglando eso alcanza para que la próxima vez entre solo. Para turnos, el
motivo `aviso_del_analizador` no reimplementa ninguna lista propia: son
literalmente los avisos que ya genera `generarAvisos` (Sprint 16, tarea 16.4)
sobre los campos finales y fusionados -año inferido, hora vacía, discrepancia
de día, orden de nombre dudoso, especialidad inferida-, para no tener dos
definiciones de "dudoso" que se puedan separar con el tiempo.

### 9.3 El correo sin nombre de paciente (decisión declarada)

Un correo que no dice a nombre de quién viene **es una duda**, no una
ausencia neutra. El caso real que decide esto: la casilla del usuario recibe
también los estudios de su madre. Ahí la falta de nombre es exactamente la
situación en la que nadie puede saber de quién es el estudio, así que "sin
ninguna duda" tiene que exigir una confirmación POSITIVA de titularidad, no
la mera ausencia de algo que la contradiga. El costo se acepta con los ojos
abiertos: los correos de clínicas que no imprimen el nombre del paciente
nunca se van a cargar solos, y siguen yendo a revisión manual como hasta hoy.

### 9.4 `LIMITE_AUTO_POR_PASADA` = 3, y por qué

Cada correo que la pasada automática intenta cargar puede costar una
descarga de hasta 25 MB, una llamada a Gemini de hasta 30 s con un reintento,
y una subida a Storage -tres cosas que el registro de metadatos del §3
(`LIMITE_MENSAJES_POR_PASADA = 15`) nunca paga-. Tres es lo que entra con
holgura en el presupuesto de la misma función serverless del plan gratuito
que ya corre el barrido, y cubre de sobra un día normal: una familia no
recibe tres estudios en la misma media hora. El resto de los correos nuevos
de esa pasada se registran igual -eso es barato y es lo que evita perder un
correo- pero quedan en la bandeja para revisar a mano, exactamente como
antes de esta función, hasta que les toque turno en una pasada siguiente.

### 9.5 "Cargados automáticamente" y el Deshacer

La bandeja de `/perfil/gmail` suma una sección **"Cargados automáticamente"**,
arriba de "correos que ya revisaste" y sin plegar -es lo único de esa
pantalla que la aplicación hizo sin que nadie lo tocara en el momento, así
que esconderla detrás de un `<details>` sería pedirle a la persona que
busque lo que nunca pidió-. Cada ítem tiene un botón **Deshacer**.

Deshacer hace dos escrituras, en este orden y por dos vías distintas
(`deshacerCargaAutomatica`, `app/(app)/(con-nav)/perfil/gmail/actions.ts`):

1. **Borra el documento o el turno con la SESIÓN de la persona.** Pasa por
   las políticas de siempre -`documents_delete_administrador` /
   `appointments_delete_administrador`, `can_manage`, `docs/modelo-permisos.md`
   §6-, no por `service_role`: si la cuenta ya no administra ese perfil, el
   `DELETE` no borra ninguna fila y la pantalla lo dice en vez de fingir que
   funcionó. El borrado dispara el mismo trigger de purga de Storage que
   cualquier otro borrado de documento.
2. **Devuelve el correo a `pendiente_revision`**, con `service_role`
   (`revertirCargaAutomatica`), limpiando `auto_ingested_at` y dejando en
   `auto_review_reason` la frase *"Lo habíamos cargado solo y lo deshiciste.
   Queda acá para que decidas vos."*.

Si el paso 2 fallara después del 1, el correo queda `ingresado` con el
puntero en `NULL` -mismo estado ya conocido de la fila "Modos de falla" del
§4-, y la bandeja ya sabe mostrar "Volver a la lista" para ese caso. Ningún
orden dentro del Deshacer deja algo peor que eso.

### 9.6 La marca inmutable de origen

`documents.auto_ingest_source` y `appointments.auto_ingest_source` valen
`'gmail'` cuando la fila la creó la carga automática, y `NULL` en cualquier
otro camino -subida a mano, Web Share Target, "Revisar este estudio" de la
bandeja-. La pantalla del estudio y la tarjeta del turno la muestran como
*"Cargado desde Gmail automáticamente"*.

Es inmutable para las sesiones de usuario por trigger
(`sellar_auto_ingest_source`, mismo patrón que el que sella
`created_by_profile_id`): al insertar, se fuerza a `NULL` -nadie puede
declarar que su carga a mano "entró sola"-, y al actualizar se conserva el
valor anterior -nadie puede borrar la marca de lo que sí entró solo-. La
única forma de escribirla es `service_role`, o sea las dos RPC del §9.1.
Detalle completo del puente con la matriz de permisos en
`docs/modelo-permisos.md` §7.5.

### 9.7 Deudas y límites declarados

1. **Un correo con dos o más adjuntos aptos siempre va a revisión**
   (`varios_adjuntos`). Cuál de los dos es el estudio -o si son dos estudios
   distintos- es una decisión que la persona tiene que tomar mirando los dos;
   la compuerta no adivina.
2. **Los correos que exceden `LIMITE_AUTO_POR_PASADA` (§9.4) en una pasada
   quedan para carga manual**, con sus metadatos ya registrados: entran a la
   tanda automática recién en una pasada siguiente, si para entonces la
   cuenta sigue teniendo lugar en el cupo de esa corrida.
3. **La huella (§2.4) solo detecta archivos BYTE A BYTE idénticos — MITIGADO
   por §2.4bis también en el camino automático.** Un PDF que la clínica
   regenera no matchea por hash, pero `lib/gmail/duplicados-semanticos-admin.ts`
   corre las mismas Capas 2 y 3 DESPUÉS de leer con Gemini (antes de decidir
   si se carga solo): mismo N° de orden, o todos los datos exactamente
   iguales, contra los documentos ya confirmados del perfil de destino.
   Hereda la misma deuda que el camino manual (§8.5): sin número de orden
   impreso y sin métricas de laboratorio, un documento regenerado con bytes
   distintos puede seguir sin detectarse.
4. **Un error de Gemini, de la descarga o de la RPC deja el correo pendiente
   con un motivo genérico** ("no pudimos leerlo automáticamente") en vez de
   con el detalle real: el error se registra en el log del servidor
   (`[gmail-auto]`) pero no se le pide a la persona que lo interprete. No hay
   reintento inmediato: el correo espera a la próxima pasada regular, igual
   que cualquier otro pendiente.
5. **El selector de perfil de destino solo ofrece los que la cuenta
   ADMINISTRA** (`can_manage`), no todos los que puede cargar
   (`can_upload OR can_manage`): es la lectura literal del encargo y lo que
   garantiza que "Deshacer" funcione siempre. Ver
   `docs/modelo-permisos.md` §7.5.

### 9.8 "Evaluar pendientes" — el backlog de ANTES de prender el interruptor

El barrido (§9.1) solo pasa por la compuerta los correos que ÉL MISMO acaba
de registrar en esa pasada (`recienRegistrados` en `barrerConexion`). Hallazgo
real de uso: el usuario prendió la carga automática con **30 correos que ya
estaban esperando** en la bandeja, y ninguno se evaluó retroactivamente -la
única forma de que entraran solos habría sido que el barrido los viera de
nuevo como "nuevos", cosa que el dedup por diseño no permite-.

El botón **"Evaluar pendientes"** (`/perfil/gmail`, dentro del panel de carga
automática, visible solo con el interruptor prendido) resuelve esto pasando
correos YA REGISTRADOS por la misma compuerta:

1. `lib/gmail/mensajes-admin.ts#listarPendientesSinEvaluarAutoCarga` trae hasta
   `LIMITE_EVALUAR_PENDIENTES_POR_TANDA` (= `LIMITE_AUTO_POR_PASADA`, hoy 3)
   correos `pendiente_revision` con `auto_review_reason IS NULL` -es decir,
   que NUNCA pasaron por la compuerta-, del más viejo al más nuevo.
2. Para cada uno, `lib/gmail/auto-carga.ts#evaluarPendientesGmail` reconstruye
   la entrada y llama a `intentarUno` -la MISMA función que usa el barrido-.
   Los `documento` usan los adjuntos ya guardados en
   `gmail_messages.attachments`; los `turno` necesitan volver a pedirle el
   cuerpo a Gmail (`obtenerMensajeCompleto` + `parsearMensajeGmail`), porque
   el cuerpo NUNCA se persiste (`docs/minimizacion-datos.md` §10.6).
3. Lo que entra solo se cuenta como `cargados`; lo que no, queda con su motivo
   escrito -exactamente igual que si el barrido lo hubiera visto de nuevo-.
4. La pantalla muestra una frase (`fraseDeEvaluacionPendientes`): *"3 cargados
   solos, 5 quedaron para vos con su motivo."* Si el backlog es más grande que
   la tanda, agrega *"Tocá «Evaluar pendientes» de nuevo para seguir."* -mismo
   patrón que "Buscar ahora" con `hayMas`-.

**Por qué NO reprocesa correos que ya se evaluaron una vez:** el filtro
`auto_review_reason IS NULL` es la clave. Un correo que quedó con un motivo
escrito ya tiene su veredicto -evaluarlo de nuevo sin que cambie nada del
contexto sería trabajo repetido-, y uno que entró solo dejó de estar
`pendiente_revision`. Cada click de "Evaluar pendientes" avanza sobre
correos NUEVOS del backlog, nunca sobre los mismos tres una y otra vez.

**Con velo de progreso**, mismo componente (`VeloEspera`) que el resto del
flujo de ingesta: la tanda puede tardar (hasta 3 llamadas reales a Gemini).
