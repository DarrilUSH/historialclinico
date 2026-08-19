# Minimización de datos en el contexto que se manda a la IA

**Sprint 10, tarea 10.2.** Alcance: el objeto `ContextoClinico` que arma
`lib/ficha/armado.ts` y que el Route Handler de la tarea 10.3 le manda a la API
de Gemini para generar la ficha de resumen para consulta.

**Este documento y el tipo `ContextoClinico` son la misma decisión escrita dos
veces.** Si divergen, hay un bug: el test `tests/unit/contexto-ficha.test.ts`
existe para que esa divergencia se note.

---

## 1. Principio rector

> **Si no cambia una decisión clínica, no viaja.**

Todo lo que entra al contexto sale de la infraestructura del proyecto y llega a
un **tercero** (Google, como procesador de la API de Gemini). Un dato que no
modifica lo que la ficha va a decir es, del lado del riesgo, un dato entregado
gratis. El nombre, el documento, el teléfono, el domicilio y el contacto de
emergencia no ayudan a redactar antecedentes ni a listar medicación: son
**identificadores puros**, y su lugar es la pantalla del titular, no el
`requestBody` de un modelo de lenguaje.

De ahí se derivan tres reglas operativas:

1. **Cada campo se copia a mano.** No hay un solo `...spread` de una fila de la
   base en `lib/ficha/armado.ts`. Con un spread, la próxima migración que
   agregue una columna a `profiles` o a `documents` la publicaría sola en el
   siguiente request, sin decisión humana de por medio.
2. **El tipo es la lista blanca.** `ContextoClinico` es exhaustivo: lo que no
   está declarado no puede salir, y agregar un campo obliga a tocar el tipo,
   este documento y el test.
3. **Los identificadores estables no viajan, ni siquiera los internos.** Los
   `uuid` no aportan nada al resumen y permitirían correlacionar dos requests
   distintos como "de la misma persona". Cuando la ficha necesita referirse a
   un estudio usa un **índice posicional** (`DocumentoContexto.indice`, 1..N),
   válido solo dentro de ese contexto.

---

## 2. Marco legal

Los datos de salud son **datos sensibles** (Ley 25.326, arts. 2 y 7). El art. 4
inc. 1 exige que los datos recogidos sean *"ciertos, adecuados, pertinentes y
no excesivos en relación al ámbito y finalidad para los que se hubieren
obtenido"*. La finalidad declarada acá es **redactar un resumen clínico para
llevar a una consulta**; un DNI no es pertinente a esa finalidad.

La regla ya estaba escrita antes de esta tarea, en dos lugares:

- `supabase/migrations/20260812200000_schema_inicial.sql` §4.1 —
  `comment on column public.profiles.national_id`: *"Dato identificatorio: se
  excluye del contexto que se envía a la IA (minimización, Ley 25.326)"*. Lo
  mismo para `profiles.phone`.
- `docs/modelo-permisos.md` §9.1 — *"El contexto que se manda a la IA excluye
  identificadores (`national_id`, `phone`, dirección, email)"*.

Esta tarea las implementa y las hace verificables.

### 2.1 Por qué la ficha SOS sí muestra el DNI y este contexto no

`docs/modelo-sos.md` §4.2 decide **incluir** el DNI en la ficha SOS. No es una
contradicción: **no son la misma amenaza.** La ficha SOS es el titular (o quien
él autorizó) mirando su propia pantalla, detrás de una sesión iniciada — no hay
tercero. El contexto de la IA sale hacia un procesador externo. La misma
columna, dos destinos con riesgo incomparable.

---

## 3. Qué viaja — lista exacta

Fuente única: `interface ContextoClinico` en `lib/ficha/armado.ts`.

### 3.0 Sobre

| Campo | Origen | Por qué |
|---|---|---|
| `version` | constante `VERSION_CONTEXTO_CLINICO` | La ficha generada se persiste (10.5); saber con qué forma de contexto se produjo permite releerla después sin adivinar. No es un dato personal. |
| `generadoEn` | reloj del **servidor** | Fecha de referencia para "hace tres meses" dentro del resumen. Lo estampa el servidor, nunca el cliente. |

### 3.1 `paciente`

| Campo | Origen | Por qué cambia una decisión clínica |
|---|---|---|
| `edadAnios` | `profiles.date_of_birth` → `calcularEdad()` | Dosis, rangos de referencia, riesgo cardiovascular y prioridades de tamizaje dependen de la edad. **Viaja el número de años, no la fecha**: la edad es clínica, la fecha exacta identifica. |
| `grupoSanguineo` | `profiles.blood_type` | Dato clínico puro, sin capacidad identificatoria útil (hay millones de "O+"). |
| `alergias` | `profiles.allergies` | Contraindicaciones. Es el dato que más puede cambiar una indicación. |
| `condicionesCronicas` | `profiles.chronic_conditions` | Es literalmente la sección "antecedentes" de la ficha. |
| `medicacionCritica` | `profiles.critical_medication` | Lo que no se suspende. Complementa a `medicacionActiva` con lo que el titular marcó como crítico aunque no esté cargado en el ABM. |
| `notasSos` | `profiles.sos_notes` | Texto libre **clínico** ("Marcapasos colocado en 2019"): un marcapasos cambia qué estudios se piden. Ver §5, riesgo residual. |

**No hay `sexo`**: la columna **no existe en el esquema**. No se infiere del
nombre ni se pide al modelo que lo deduzca — sería a la vez un dato inventado y
un dato identificatorio.

### 3.2 `medicacionActiva`

Origen: la vista `v_medicacion_estado` (que ya filtra `is_active`), quedándose
solo con lo vigente hoy (`vigente_hoy !== false`).

| Campo | Origen | Por qué |
|---|---|---|
| `nombre` | `medications.name` | La marca comercial es lo que dice la caja que la persona tiene en la mano. |
| `droga` | `medications.active_ingredient` | El principio activo es lo que entiende un profesional y lo que permite detectar interacciones. |
| `presentacion` | `medications.presentation` | La concentración ("Comprimidos 850 mg") cambia la dosis real. |
| `dosis` | `dose_amount` + `dose_unit`, vía `textoCantidadConUnidad` | Cuánto se toma por vez. |
| `frecuencia` | `frequency`, `schedule_times`, `interval_hours` | Redactada en castellano ("Todos los días (08:00, 20:00)"). La distribución horaria importa clínicamente. |
| `desde` | `medications.start_date` | Hace cuánto está en tratamiento. |
| `diasRestantes` | `v_medicacion_estado.dias_restantes` | Si hay que pedir receta **en esta consulta**. |
| `necesitaRenovacion` | `v_medicacion_estado.necesita_renovacion` | El umbral de 5 días está definido una sola vez, en la vista. |
| `indicaciones` | `medications.notes` | "Tomar con las comidas", "no suspender sin consultar": adherencia. Texto libre, ver §5. |

### 3.3 `episodios` — el historial agrupado (versión 2 del contexto)

Hasta la versión 1 este campo se llamaba `estudiosRecientes` y traía **los 5
documentos más nuevos**. Se cambió al probar la ficha contra un historial real
de 47 documentos: los 5 más nuevos eran cinco laboratorios de rutina, y la
internación de dieciséis días por un absceso hepático —el hecho clínico más
importante de esa persona— **no aparecía en la ficha en absoluto**, porque sus
18 archivos tenían nueve meses de antigüedad. Un recorte por fecha no es un
recorte por pertinencia.

Desde la versión 2 viajan los documentos **agrupados por episodio** (por
cercanía de fecha, `DIAS_CORTE_EPISODIO`), sin recorte por antigüedad, y sin
los que no aportan ningún hecho clínico.

| Campo | Origen | Por qué |
|---|---|---|
| `indice` | posición, 1..N | Ordinal del episodio dentro de este contexto. **Ningún uuid.** |
| `desde` / `hasta` | `documents.document_date` (mín. y máx. del grupo) | El tramo de tiempo del episodio. |
| `adjuntosSinContenidoClinico` | conteo | Cuántos archivos del episodio quedaron afuera por no aportar nada. Viaja el **número**, nunca su texto: es para que la ficha no los cuente como estudios distintos. |
| `documentos[].indice` | posición, 1..N global | Permite que la ficha diga "ver estudio 2" **sin que viaje ningún uuid**. |
| `documentos[].fecha` | `documents.document_date` | Ubica el hallazgo en el tiempo. |
| `documentos[].categoria` | `documents.category` → etiqueta en castellano | Un laboratorio y una receta se leen distinto. |
| `documentos[].titulo` | `documents.title` | Qué estudio es. Texto libre, ver §5. |
| `documentos[].especialidad` | `documents.specialty` | El **área** ("Cardiología"), no la persona. |
| `documentos[].resumenIa` | `documents.ai_summary` | El resumen en lenguaje claro que ya generó el Sprint 4, y el insumo principal de la ficha. **Obligatorio**: un documento sin resumen no entra. |

#### Por qué esto NO afloja la minimización

La lista blanca de **columnas** no se tocó: sigue sin viajar `institution`,
`doctor_name`, `storage_path` ni `raw_ocr_text` (§4.4). Lo que cambió es qué
FILAS entran, y en las dos direcciones:

- **Entran más**: el historial entero en vez de los 5 archivos más nuevos. Se
  justifica por la finalidad declarada (art. 4 inc. 1, Ley 25.326): la ficha
  existe para resumir antecedentes ante un médico, y un absceso hepático de
  hace nueve meses, una vasectomía o un hallazgo que quedó "a valorar
  clínicamente" cambian decisiones clínicas **hoy**. El tope duro es
  `MAXIMO_DOCUMENTOS_CONTEXTO` (40), y por encima de él se descartan episodios
  enteros desde el más viejo.
- **Salen menos**: los documentos cuyo `ai_summary` no cuenta ningún hecho
  clínico —una placa escaneada, una hoja de imágenes, la hoja de firmas de un
  informe— **ya no viajan**. Son datos de salud que salían del servidor a
  cambio de cero valor clínico: en el historial real de 47 documentos eran 18
  (38 %). Menos superficie de exposición, no más.

#### El filtro `aportaHechoClinico`

Un documento entra solo si su resumen cuenta algo que le pasó a la persona. El
filtro vive en `lib/ficha/armado.ts` y reconoce las fórmulas que
`lib/gemini/prompt-documento.ts` (regla 5.b) le pide a la ingesta cuando la
página no tiene contenido: "sin informe escrito", "sin hallazgos nuevos", "solo
trae los datos administrativos y la firma". Las dos piezas son un contrato, y
`tests/unit/contexto-ficha.test.ts` lo verifica con los textos reales.

El motivo no es de privacidad sino de calidad, y lo reportó el dueño del
producto: sin el filtro, la ficha heredaba esos resúmenes y terminaba diciendo
"el 29/10/2025 se realizó un estudio en tal sanatorio" en lugar de "el
29/10/2025 se le encontró un absceso en el hígado". La ficha no puede mejorar
un resumen vacío; lo único correcto es no mostrarlo.

### 3.4 `metricasLaboratorio`

Agrupadas por `agruparEnSeries` (`lib/laboratorio/series.ts`), la única función
del proyecto que resuelve el nombre canónico de una métrica.

| Campo | Origen | Por qué |
|---|---|---|
| `metrica` | nombre canónico del diccionario | "Glucosa", no "GLU": el nombre unificado es lo que permite comparar entre laboratorios. |
| `unidad` | `lab_metrics.unit` | Un valor sin unidad no se puede leer. |
| `rangoReferencia` | `lab_metrics.reference_range` | El rango **impreso en el estudio**, no uno inventado por el modelo. |
| `ultimas[].fecha` / `.valor` | `measurement_date`, `value` | Las 3 últimas, más reciente primero (criterio de aceptación del roadmap). |
| `ultimas[].fueraDeRango` | calculado contra `reference_min/max` | Se calcula **acá**, no se le pide al modelo que interprete el rango. |
| `tendencia` | `resumenUltimoValor()` | "subió"/"bajó"/"igual" contra la medición anterior. Informativa, nunca semántica: nunca dice "empeoró". `null` con una sola medición — no se inventa tendencia. |

### 3.5 `signosVitales` (3 por tipo)

| Campo | Origen | Por qué |
|---|---|---|
| `signo` / `unidad` | `lib/signos/tipos.ts` | "Tensión arterial", "mmHg". |
| `ultimas[].fecha` | `vital_signs.measured_at` (ISO, con hora) | La hora del día cambia la lectura de una glucemia o de una tensión. |
| `ultimas[].sistolica` / `.diastolica` / `.pulso` | `systolic`, `diastolic`, `pulse` | Solo en tensión. |
| `ultimas[].valor` | `value` | Glucemia (mg/dL) o peso (kg). |
| `ultimas[].nota` | `vital_signs.notes` | "En ayunas" cambia por completo cómo se lee una glucemia. Texto libre, ver §5. |

### 3.6 `alertasActivas`

Solo las que siguen sin ver (`acknowledged_at is null`).

| Campo | Origen | Por qué |
|---|---|---|
| `fecha` | `vital_sign_alerts.created_at` | Cuándo ocurrió. |
| `signo` | `vital_sign_alerts.tipo` → etiqueta | Qué se midió. |
| `motivo` | `vital_sign_alerts.regla` → texto en castellano | Qué se pasó de umbral. |
| `valor` / `umbral` | columnas homónimas | El hecho medido y el criterio con el que se lo evaluó. |
| `referencia` | `vital_sign_alerts.referencia` | Solo en `peso_variacion`: la mediana de la ventana. |

---

## 4. Qué NO viaja — lista exacta y por qué

### 4.1 Identificatorios del titular

| Campo | Tabla | Por qué queda afuera |
|---|---|---|
| `full_name` | `profiles` | El nombre no cambia ninguna decisión clínica. Es **el** identificador. |
| `national_id` | `profiles` | DNI. Identificador nacional único; cero valor clínico. Ya lo dice el `COMMENT ON COLUMN`. |
| `phone` | `profiles` | Dato de contacto. La IA no llama a nadie. |
| `date_of_birth` | `profiles` | Viaja la **edad** derivada, que es lo clínico. La fecha exacta es un cuasi-identificador clásico (edad + fecha exacta + ciudad reidentifican). |
| `avatar_storage_path` | `profiles` | Foto de la cara. No hace falta ni argumentarlo. |
| `user_id`, `id`, `created_by_profile_id`, `role` | `profiles` | Identificadores y metadatos de cuenta. Nada clínico. |
| `sos_updated_at` | `profiles` | Metadato de mantenimiento de la ficha SOS. |
| **Domicilio y email** | *no existen como columna* | El proyecto no guarda domicilio ni email del titular en `profiles` (el email vive en `auth.users`, fuera del alcance de esta lectura). Igual se los busca en el test, porque **sí aparecen** dentro del OCR crudo de los documentos. |

### 4.2 Contacto de emergencia — el bloque entero

| Campo | Tabla |
|---|---|
| `emergency_contact` | `profiles` |
| `emergency_contact_phone` | `profiles` |
| `emergency_contact_relationship` | `profiles` |

El nombre y el teléfono de la hija son **datos personales de una tercera
persona** que ni siquiera es la titular del historial, y no aportan absolutamente
nada a un resumen de antecedentes. Es el caso más claro del principio rector.
Entran en la ficha SOS —cuya función es exactamente que alguien pueda llamar—
y no acá.

### 4.3 Del médico tratante y de la institución

| Campo | Tabla | Por qué queda afuera |
|---|---|---|
| `doctor_name` | `documents` | **Decisión explícita de esta tarea.** ¿Aporta clínicamente el nombre del médico que firmó un estudio? Para un *resumen de antecedentes*, **no**: lo que cambia la lectura es de qué estudio se trata, de qué especialidad y qué dice — no quién lo firmó. A cambio, es el nombre de una persona real identificable, con matrícula, cuya relación con el paciente es en sí misma un dato de salud (que alguien vea a un oncólogo dice algo). Lo que sí aporta —el área— viaja en `especialidad`. |
| `doctor_id` | `documents` | uuid del profesional en el directorio. |
| `institution` | `documents` | "Centro Cardiovascular Ushuaia" hace dos cosas malas a la vez: **geolocaliza** al titular en una ciudad chica y revela el tipo de atención. Clínicamente no cambia nada. |
| Tabla `doctors` completa | — | Nombre, matrícula, teléfono, domicilio y coordenadas de profesionales. **No se lee en absoluto.** |

### 4.4 De los documentos

| Campo | Por qué queda afuera |
|---|---|
| `raw_ocr_text` | **La exclusión más importante del documento.** Es la transcripción completa del papel: encabezado del laboratorio con dirección y teléfono, nombre y DNI del paciente, correo, matrícula del profesional. Mandarlo anularía todo lo demás de una sola vez. Lo clínico ya está destilado en `ai_summary` y en `lab_metrics`. |
| `storage_path` | Ruta del archivo. Empieza con el uuid del perfil. |
| `id`, `profile_id` | uuid. |
| `mime_type`, `file_size_bytes` | Metadatos de archivo. Nada clínico. |
| `ai_confidence`, `confirmed_at`, `created_at`, `updated_at`, `created_by_profile_id` | Metadatos del pipeline de extracción y de auditoría. |

### 4.5 De la medicación, los signos y las alertas

| Campo | Tabla | Por qué queda afuera |
|---|---|---|
| `medication_id`, `profile_id`, `prescription_document_id` | `v_medicacion_estado` | uuid. |
| `stock_units`, `tomas_por_dia`, `dosis_diaria_total`, `fecha_estimada_fin` | `v_medicacion_estado` | Insumos y derivados del cálculo de stock. Lo accionable en la consulta es `diasRestantes` / `necesitaRenovacion`; el resto es ruido. |
| `end_date` | `medications` | Ya está aplicado: la selección es "vigente hoy". |
| `id`, `profile_id`, `created_by_profile_id` | `vital_signs` | uuid. |
| `id`, `vital_sign_id`, `profile_id`, `acknowledged_at`, `acknowledged_by` | `vital_sign_alerts` | uuid y metadatos de "quién tocó Ya lo vi". |
| `mensaje` | `vital_sign_alerts` | No tiene nada identificatorio, pero es **derivable** de `motivo` + `valor` + `umbral`, y su descargo ("no reemplaza el criterio médico") le corresponde a la **salida** de la ficha (10.3), no a la entrada. |
| `document_id`, `id` | `lab_metrics` | uuid. |

### 4.6 Tablas que directamente no se leen

`doctors`, `appointments` (turnos: fecha, lugar y profesional de una cita
futura no son antecedentes), `insurance_cards` (número de afiliado e imágenes
de la credencial), `family_permissions`, `access_logs`, `push_subscriptions`,
`medication_intakes` (el registro de tomas día por día es un patrón de conducta
detallado; lo clínicamente relevante —qué toma y si le alcanza el stock— ya
está en `medicacionActiva`).

---

## 5. Riesgos residuales declarados

Tres campos que **sí viajan** son **texto libre escrito por una persona**, y
por lo tanto el sistema no puede garantizar que no contengan un identificador:

| Campo | Ejemplo real | Por qué entra igual |
|---|---|---|
| `episodios[].documentos[].titulo` | "Análisis de sangre completo — Laboratorio Central" | El roadmap lo pide y es el nombre del estudio. Alguien podría escribir "Análisis de Roberto" y ese texto viajaría. |
| `medicacionActiva[].indicaciones` | "Tomar con las comidas" | Instrucciones de toma; cambian la adherencia. |
| `signosVitales[].ultimas[].nota` | "En ayunas" | Cambia por completo la lectura del valor. |
| `paciente.notasSos` | "Marcapasos colocado en 2019" | Es el campo de antecedentes libres; su contenido típico es puramente clínico. |

**No es hipotético: el propio seed lo demuestra.** La verificación contra la
base local (§7.3) devuelve **cero** apariciones de todo lo del §4 —incluida
`documents.institution`, que en el seed vale `"Centro Cardiovascular Ushuaia"`
y no aparece por ningún lado— pero encuentra el texto `"Laboratorio Central"`
**una** vez, dentro del `titulo` de un documento (`episodios[].documentos[].titulo`):

```
"titulo": "Análisis de sangre completo — Laboratorio Central"
```

Alguien escribió el nombre del laboratorio adentro del título del estudio. La
columna que guarda la institución está correctamente excluida; lo que sobrevive
es texto que una persona tipeó. Es exactamente la forma que tiene este riesgo, y
por eso se deja escrito con el ejemplo a la vista en vez de retocar el seed para
que la verificación quede prolija.

**Mitigación:** ninguna automática. Sanitizar texto libre con heurísticas
produciría dos daños peores —borrar contenido clínico legítimo y dar una falsa
sensación de garantía—. Lo que corresponde es que la interfaz de la tarea 10.3
avise, en el momento de generar la ficha, que el resumen se produce con un
servicio externo. Queda anotado como límite conocido, no como descuido.

---

## 6. Ciclo de vida: el contexto es efímero

**El contexto no se persiste en ningún lado.** Se arma en memoria dentro del
request, se manda, y se descarta cuando termina la respuesta. No se guarda en
la base, no se cachea, no se escribe a un log.

Lo que sí se guarda (tarea 10.5, `fichas`) es la **ficha generada**: el texto
que la persona va a leer e imprimir. Esa asimetría es deliberada y es la que
hace que el derecho de supresión funcione de verdad:

- **Si el titular borra un estudio, una medición o su perfil entero**, el
  `CASCADE` del esquema borra las filas fuente (`docs/modelo-permisos.md` §8.5).
  Como el contexto nunca se materializó, **no queda ninguna copia
  intermedia que haya que ir a buscar**. La siguiente ficha se arma con lo que
  quedó.
- **Las fichas ya generadas sí son datos del titular** y se borran con su
  perfil, igual que el resto del historial. Eso es responsabilidad de la
  migración de la 10.5 (`fichas.profile_id ... on delete cascade`).
- **Lo que ya salió hacia el procesador externo** se rige por la política de
  retención de ese proveedor y está fuera del control de esta aplicación. Es
  exactamente por eso que la lista del §4 es tan larga: **lo único que no puede
  filtrarse es lo que nunca se mandó.**

---

## 7. Cómo se verifica

### 7.1 Dos capas independientes

1. **La lista blanca del armado** (`lib/ficha/armado.ts`): aunque le pasen la
   fila completa de la base, solo sale lo declarado en `ContextoClinico`.
2. **El `select` de la lectura** (`lib/ficha/contexto.ts`): ninguna consulta
   usa `*`; cada una nombra sus columnas. El DNI, el teléfono y el OCR crudo
   **ni siquiera salen de la base** hacia el proceso de Next.

La capa 1 es la que un test puede probar; la capa 2 es la que hace que un bug
en la capa 1 no sea explotable.

### 7.2 El test del criterio

`tests/unit/contexto-ficha.test.ts` le pasa al armado las filas **completas**
—`profiles` con DNI, teléfono y contacto de emergencia; `documents` con nombre
del médico, institución, ruta de Storage y OCR crudo— y busca cada uno de esos
textos en `JSON.stringify` del contexto. Es una prueba de **ausencia**: si
mañana alguien agrega un `...spread`, falla sola, sin que nadie tenga que
acordarse de actualizar un objeto esperado. Incluye además una red genérica que
falla ante **cualquier** uuid.

```powershell
npx vitest run tests/unit/contexto-ficha.test.ts
```

### 7.3 Contra el seed real

El test unitario prueba la función; contra la base local se prueba que los
datos de verdad tampoco filtran nada. El procedimiento, reproducible:

1. Volcar las filas **completas** del perfil de Roberto
   (`660e8400-e29b-41d4-a716-446655440003`) a un JSON, sin recortar columnas:

   ```powershell
   docker exec supabase_db_historialclinico psql -U postgres -d postgres -t -A -c "
   select json_build_object(
     'perfil',       (select row_to_json(p) from public.profiles p where p.id='660e8400-e29b-41d4-a716-446655440003'),
     'medicaciones', coalesce((select json_agg(row_to_json(v)) from public.v_medicacion_estado v where v.profile_id='660e8400-e29b-41d4-a716-446655440003'), '[]'::json),
     'documentos',   coalesce((select json_agg(row_to_json(d)) from public.documents     d where d.profile_id='660e8400-e29b-41d4-a716-446655440003'), '[]'::json),
     'metricas',     coalesce((select json_agg(row_to_json(m)) from public.lab_metrics   m where m.profile_id='660e8400-e29b-41d4-a716-446655440003'), '[]'::json),
     'signos',       coalesce((select json_agg(row_to_json(s)) from public.vital_signs   s where s.profile_id='660e8400-e29b-41d4-a716-446655440003'), '[]'::json),
     'alertas',      coalesce((select json_agg(row_to_json(a)) from public.vital_sign_alerts a where a.profile_id='660e8400-e29b-41d4-a716-446655440003' and a.acknowledged_at is null), '[]'::json)
   );" > fuentes-roberto.json
   ```

2. Pasar ese JSON por `armarContexto()` (un test efímero en `tests/unit/`
   alcanza: el alias `@` y el mock de `server-only` ya están configurados en
   `vitest.config.ts`) y buscar en `JSON.stringify` del resultado cada texto
   identificatorio.

**Resultado registrado el 2026-08-14** (base local con el seed vigente):

| Aguja | Qué es | Apariciones |
|---|---|---|
| `Roberto` | nombre de pila | 0 |
| `Gómez` | apellido | 0 |
| `8234567` | DNI (`profiles.national_id`) | 0 |
| `+54` | teléfono (titular y contacto) | 0 |
| `@` | email | 0 |
| `Ushuaia` | dirección / ciudad | 0 |
| `Gabriela` | contacto de emergencia | 0 |
| `Rodríguez` | médico tratante (`doctor_name`) | 0 |
| `Centro Cardiovascular` | institución (`documents.institution`) | 0 |
| `660e8400` | prefijo de los uuid | 0 |
| `raw_ocr_text` / `storage_path` | nombres de columna excluidas | 0 |
| `Laboratorio Central` | **texto libre dentro de `title`** | **1** → §5 |

En el mismo contexto sí viajan 2 medicaciones activas, 5 estudios, 4 métricas
con sus 3 últimas mediciones cada una, 3 tipos de signos y 2 alertas: la
minimización no vació la ficha.

---

## 8. Cómo agregar un campo (procedimiento obligatorio)

1. Justificar, **por escrito y en términos clínicos**, qué decisión cambia ese
   campo. Si la justificación es "puede ser útil", la respuesta es no.
2. Agregarlo a `ContextoClinico` en `lib/ficha/armado.ts`, copiándolo a mano.
3. Agregarlo a la tabla del §3 de este documento, con su porqué.
4. Si el campo es texto libre, sumarlo al §5.
5. Verificar que sigue pasando `tests/unit/contexto-ficha.test.ts`, y agregar
   al `PROHIBIDOS` del test cualquier identificador nuevo que ahora exista en
   la fila fuente.
6. Subir `VERSION_CONTEXTO_CLINICO` si la forma cambió de manera incompatible.

---

## 9. Mensajes de turno pegados desde WhatsApp (Sprint 16, tarea 16.4)

**Este caso es la excepción a la regla del §1.** Todo lo de arriba describe un
contexto ARMADO A MANO, campo por campo, con una lista blanca explícita. La
función "¿Te llegó el turno por WhatsApp? Pegalo acá" de `/turnos/nuevo`
(`components/turnos/analizador-mensaje-turno.tsx`) no puede funcionar así: el
insumo es texto libre que la persona pega tal cual le llegó, y la finalidad
declarada -que Gemini identifique fecha, hora, profesional, especialidad y
lugar dentro de ese texto- exige que el modelo vea el mensaje COMPLETO. No hay
forma de "minimizar antes de mandar" un mensaje de WhatsApp sin arriesgarse a
cortar justo el dato que hace falta leer.

### 9.1 Qué viaja

El texto pegado, completo, tal como lo escribió la persona -incluido lo que
haya adentro: nombre y a veces DNI del paciente (`tests/fixtures/mensajes-turno/clinica-san-jorge-ecografia.txt`
trae los dos), montos, teléfonos de la institución, cualquier dato que la
clínica haya puesto en el mensaje original. `lib/gemini/prompt-turno.ts` viaja
como prompt junto con el mensaje en un único `extraerJson` (`lib/gemini/client.ts`).

### 9.2 Qué NO sale del otro lado (la lista blanca sigue existiendo, del lado de la SALIDA)

Acá la minimización no puede aplicarse a la ENTRADA, así que se aplica con la
misma fuerza a la SALIDA: `SCHEMA_ANALISIS_MENSAJE_TURNO`
(`lib/gemini/schemas.ts`) **no tiene ningún campo para nombre ni DNI del
paciente** -no es que se extraigan y se descarten después: no existe dónde
ponerlos, mismo principio que `ContextoClinico` (§1, regla 2: "el tipo es la
lista blanca")-. El prompt además se lo pide explícitamente al modelo (punto 9
de `lib/gemini/prompt-turno.ts`): "no extraigas ni menciones en ningún campo
el nombre del paciente ni su DNI/documento, aunque aparezcan en el mensaje".
El DNI que trae el fixture de la Clínica San Jorge nunca aparece en ningún
campo de `PropuestaTurno` (`lib/turnos/construir-propuestas.ts`) ni, por lo
tanto, en ningún campo del formulario.

### 9.3 El mensaje nunca se persiste

`app/api/turnos/analizar-mensaje/route.ts` no escribe el mensaje en ninguna
tabla, ni en ningún `console.*` -mismo criterio de "nunca se loguea" que
`lib/ficha/generar.ts` aplica al contexto clínico (§6)-. Lo único que puede
llegar a persistir, si la persona revisa y toca "Guardar turno", es el turno
final en `appointments`, con los mismos campos que ya existían antes de esta
tarea (`specialty`, `doctor_name`, `appointment_date`,
`location_name`/`location_address`/`location_city`/`location_province`,
`preparation_notes`) — ninguno de ellos guarda el texto crudo del mensaje.

### 9.4 Riesgo residual declarado

A diferencia del §5 -donde el riesgo es que texto libre ESCRITO POR UNA
PERSONA dentro de un campo ya minimizado *pueda* contener un identificador-,
acá el mensaje COMPLETO, con cualquier identificador que traiga, viaja
siempre hacia Gemini como procesador externo. La mitigación es la misma que
ya declara el §6 para lo que sale de la aplicación: **lo único que no puede
filtrarse es lo que nunca se mandó**, y acá sí se manda. Lo que esta tarea
puede controlar -y controla- es (1) que el mensaje no quede escrito en ningún
lado de la propia infraestructura, y (2) que ningún identificador del mensaje
pueda terminar precargado en un campo del formulario ni, por lo tanto,
guardado en la base. `components/turnos/analizador-mensaje-turno.tsx` además
avisa en pantalla, antes de tocar "Analizar", que el texto se manda a un
servicio externo y que no se guarda.

---

## 10. Conexión de Gmail (Sprint 17, tarea 17.1)

Conectar la casilla de correo de la persona es, con diferencia, el permiso más
grande que esta aplicación pide. Este apartado declara qué se guarda, qué no y
cuál es el compromiso de lectura — con la misma disciplina de lista blanca que
el resto del documento, aplicada esta vez a una CREDENCIAL y no a un contexto.

### 10.1 Qué se guarda, exactamente

Una fila en `public.gmail_connections`, una por CUENTA (no por perfil):

| Dato | Por qué está |
|---|---|
| `user_id` | De quién es la casilla. Es la cuenta que inició sesión, no el perfil que esté mirando. |
| `email` | La dirección conectada. Se muestra en pantalla para que la persona pueda confirmar **cuál** de sus cuentas de Google conectó — con dos cuentas en el teléfono es fácil consentir con la que no era. |
| `status`, `connected_at`, `last_ok_at`, `expired_at` | El estado de la conexión: si el permiso sigue vivo, desde cuándo y cuándo se venció. Es lo que hace que la pantalla pueda decir "se venció, volvé a conectar" en vez de "no tenés nada". |
| `label_id`, `label_name` | La etiqueta `historialmedico` de esa casilla. Es el `labelIds` con el que la tarea 17.2 lee **solo** esos mensajes. |
| `granted_scopes` | Diagnóstico: qué permisos concedió Google de verdad. No se le concede a `authenticated`. |
| `token_secret_id` | Puntero a la fila del Vault. **No es el token.** Tampoco se le concede a `authenticated`. |

Y el **refresh token**, cifrado, en `vault.secrets` bajo el nombre
determinístico `gmail_refresh_token_<user_id>`. Nunca en una columna de
`public`, nunca en texto plano, nunca al alcance de `anon` ni de
`authenticated` (el esquema `vault` no les concede nada). El razonamiento
completo de por qué Vault y no cifrado propio está en el encabezado de
`supabase/migrations/20260818130000_gmail_conexiones.sql`.

### 10.2 Qué NO se guarda

- **Ningún contenido de correo.** En esta tarea la aplicación no lee ni un
  mensaje: conecta, crea la etiqueta y guarda el estado. Nada más.
- **Ningún access token.** Duran una hora y se piden frescos cada vez
  (`lib/gmail/conexiones-admin.ts`); lo más que existe es una copia en memoria
  del proceso, que muere con la instancia.
- **Ningún historial de conexiones.** Reconectar es un `UPSERT` sobre la misma
  fila, no una fila más: guardar el rastro de las direcciones que la persona
  ya desconectó sería retener exactamente lo que pidió sacar.
- **El `client_secret` de la aplicación** no toca la base ni el navegador: vive
  solo en `GOOGLE_CLIENT_SECRET` del entorno de servidor.

### 10.3 El compromiso de lectura limitada

Los tres permisos que se piden (`gmail.readonly`, `gmail.labels`,
`gmail.settings.basic`) se piden **juntos en la primera conexión**, para no
tener que mandar a la persona a una segunda pantalla de consentimiento en la
17.2. De los tres, el único amplio es `gmail.readonly`: técnicamente habilita
a leer toda la casilla, y hay que decirlo con esas palabras porque es la
verdad. Google **no ofrece un scope acotado a una etiqueta** — `gmail.metadata`
no deja ver ni el cuerpo ni los adjuntos, que es justo lo que hay que importar.

Entonces la limitación no la impone Google: **la impone el código, y queda
declarada acá**. El compromiso es que toda lectura de mensajes de la tarea
17.2 se hace con `labelIds=<label_id de esta fila>`, nunca sobre la casilla
entera y nunca con una `q` de búsqueda libre. La pantalla de conexión
(`components/gmail/panel-conexion-gmail.tsx`) se lo dice a la persona antes de
que toque el botón, con esas mismas palabras: *"solo los correos de la etiqueta
historialmedico… nada más de tu casilla"*.

### 10.4 Cortar el acceso, y que cortar signifique cortar

"Desconectar" hace las tres cosas que tiene que hacer, en este orden
(`app/(app)/(con-nav)/perfil/gmail/actions.ts`):

1. **Revoca el permiso contra Google** (`oauth2.googleapis.com/revoke`). Es lo
   único que de verdad apaga el acceso del lado de Google.
2. **Borra la fila** de `gmail_connections`.
3. **Borra el secreto del Vault**, por nombre — y un trigger `AFTER DELETE`
   sobre la tabla lo vuelve a hacer por si la fila desapareciera por otra vía.

Si el paso 1 falla (Google caído, o el permiso ya sacado desde la cuenta de
Google), los pasos 2 y 3 se hacen igual **y la pantalla lo dice**, con el
enlace a los permisos de la cuenta de Google para terminarlo a mano. Dejar la
conexión puesta "por las dudas" sería mostrarle a la persona una casilla
conectada que ella ya pidió cortar.

La **baja de la cuenta** (derecho de supresión, Ley 25.326 arts. 14-16) se
lleva las dos cosas: la fila por el `ON DELETE CASCADE` del `user_id` y el
token cifrado por el mismo trigger. Sin ese trigger, el secreto sobreviviría a
la supresión — el BLOQUE 23 de `scripts/test-rls.sql` lo prueba borrando una
cuenta y verificando que el Vault queda vacío.

### 10.5 Cómo se verifica

`scripts/test-rls.sql`, BLOQUE 23 (38 casos). Prueba las cuatro capas por
separado, porque si mañana se cae una hay que saber cuál: RLS por fila
(el dueño no ve la conexión de otra cuenta), privilegio por columna (ni en su
propia fila puede leer `token_secret_id` ni `granted_scopes`, y un `select *`
—lo que manda PostgREST sin lista de columnas— falla entero con 42501), el
esquema `vault` inalcanzable para `anon` y `authenticated`, y las cinco
funciones `SECURITY DEFINER` ejecutables solo por `service_role`. Más el ciclo
de vida completo: guardar, vencer, reconectar, desconectar y la baja de cuenta.

### 10.6 El barrido de la etiqueta (tarea 17.2)

La 17.1 conectó la casilla sin leer un solo correo. La 17.2 los lee — y este
apartado declara exactamente **qué queda guardado** de esa lectura.

**Lo que se guarda** (una fila por correo ya mirado, en `public.gmail_messages`):

| Dato | Por qué está |
|---|---|
| `gmail_message_id` | El dedup. Sin él, cada pasada volvería a proponer lo que la persona ya descartó. |
| `from_email`, `from_name` | Para reconocer al laboratorio de siempre en la lista, y para poder ofrecer el filtro aprendido ("¿los próximos de este los traemos solos?"). Sin el remitente esa función no existe. |
| `subject` | Es lo único que le permite a la persona reconocer un correo **sin abrirlo**. Una lista de fechas sin asunto obligaría a abrir todo. |
| `message_date` | Ordena la lista. |
| `kind`, `looks_like_appointment` | Qué se encontró: un adjunto, algo con pinta de turno, o nada. |
| `attachments` | **Descriptores, nunca bytes**: nombre, tipo, tamaño y el `attachmentId` con el que Gmail entrega el archivo después. Los no aptos se guardan igual, con su motivo, para poder explicar en pantalla por qué un archivo que la persona VE en su correo no se ofrece para importar. |
| `status`, `document_id`, `appointment_id` | En qué terminó. |

**Lo que NO se guarda, nunca:**

- **El cuerpo del correo.** Ni entero, ni recortado, ni el `snippet` de la API
  —que es cuerpo—. Cuando hace falta el texto (para analizar un turno), se le
  vuelve a pedir el mensaje a Gmail, se usa en memoria y se deja ir.
- **Los bytes de ningún adjunto.** El barrido automático no descarga archivos.
  Los bytes viajan recién cuando una persona toca "Revisar este estudio", y
  entran por el MISMO `lib/documentos/ingesta.ts` que un archivo elegido a mano
  —con su validación de MIME real, su límite de 25 MB, su path determinístico y
  su RLS—.

**El cuerpo va a Gemini solo si parece un turno.** La heurística
(`lib/gmail/heuristica-turno.ts`, documentada en `docs/gmail-ingesta.md` §2.3)
es una puerta de privacidad antes que un ahorro de cuota: un barrido que le
mandara a un tercero el texto de todo lo que cae en la etiqueta estaría
sacando de la casilla correos que quizás no tienen nada que ver con un turno.
Y aun dando positivo, el texto **solo sale cuando la persona abre ese ítem**:
**con la carga automática apagada**, el barrido en sí mismo nunca llama a
Gemini —ni por el cuerpo de un aviso de turno ni por los bytes de un
adjunto—. Esa frase deja de ser cierta en cuanto la persona prende el
interruptor del §10.7: ahí el barrido SÍ le manda contenido a Gemini sin que
nadie lo revise antes. Se declara con esas palabras, sin matices, en la
sección siguiente.

**Los filtros creados quedan a la vista y se pueden borrar.** `gmail_filters`
existe para eso: la app crea reglas en la casilla de la persona a pedido suyo,
y la pantalla las lista con su botón de sacar. La regla solo AGREGA la etiqueta
—no archiva, no marca como leído, no borra—, así que el correo sigue llegando a
la bandeja de entrada igual que siempre.

**La baja de cuenta se lleva todo** (`ON DELETE CASCADE` del `user_id`): los
correos registrados y los filtros. La **desconexión** de Gmail, en cambio, NO
borra `gmail_messages`, y es deliberado: con la pantalla de consentimiento "En
prueba", el permiso caduca cada 7 días y la reconexión es semanal; si la
desconexión borrara el registro, cada reconexión volvería a proponer todo lo ya
revisado. Lo que la desconexión sí intenta llevarse son los filtros, porque
esos viven en la casilla.

Verificación: `scripts/test-rls.sql` BLOQUE 24 (21 casos) y
`tests/unit/gmail-barrido.test.ts` —que además comprueba, sobre el objeto que
se persiste, que no aparezca ni una palabra del cuerpo del correo—.

### 10.7 La carga automática (opt-in, Sprint 17, tarea 17.3)

Este es el cambio de contrato de privacidad más importante del sprint, y hay
que decirlo sin suavizarlo: **con el interruptor encendido, el barrido
automático manda a Gemini el cuerpo del correo y los bytes del adjunto, sin
que ninguna persona los mire antes.** Todo el resto de este documento describe
un sistema que minimiza lo que sale hacia un tercero; esta sección describe la
única puerta por la que, a pedido explícito del usuario y solo si él mismo la
abrió, esa regla se corre.

**El pedido fue textual, después de usar la 17.2 en producción:** *"cuando un
correo se lee SIN NINGUNA duda, que se cargue solo; solo lo dudoso queda a
revisión manual"*. El diseño completo —las cuatro guardas de la base, la
compuerta "sin dudas" y las dos RPC nuevas— está en el encabezado de
`supabase/migrations/20260818160000_gmail_auto_ingesta.sql`; acá se declara
solo la parte que le corresponde a este documento: qué viaja hacia Gemini y
qué no.

**Es opt-in por cuenta, apagado por defecto, y con destino elegido a mano.**
Ninguna conexión existente antes de esta migración queda encendida: la
columna nace `auto_ingest_enabled = false` para todas. Prenderlo es un gesto
explícito desde `/perfil/gmail`, y el mismo formulario exige elegir el perfil
de destino en el momento de prender —no hay forma de "prender y decidir
después"—. Apagarlo devuelve el circuito a ser exactamente el de la 17.2:
metadatos nada más, sin Gemini y sin bytes.

#### Con el interruptor apagado, nada cambia

Es el estado de toda conexión existente y el default de cualquier conexión
nueva. El barrido sigue haciendo exactamente lo que declara el §10.6: registra
metadatos del correo, no baja adjuntos, no llama a Gemini. `lib/gmail/auto-carga.ts`
ni siquiera se ejecuta —la función devuelve el resultado vacío en la primera
línea, sin una consulta de más, apenas confirma que la cuenta no tiene destino
de auto-carga.

#### Con el interruptor encendido, qué sale y hacia dónde

Para cada correo nuevo que el barrido acaba de registrar (hasta
`LIMITE_AUTO_POR_PASADA = 3` por pasada, ver `docs/gmail-ingesta.md` §9.4), la
pasada automática:

1. Baja el adjunto de Gmail (o usa el cuerpo que ya tiene en memoria, si es un
   aviso de turno).
2. Se lo manda a Gemini: el adjunto entero para un documento, el asunto más el
   cuerpo para un turno.
3. Con lo que Gemini contestó, le pregunta a la compuerta puramente en memoria
   (`lib/gmail/auto-ingesta.ts`) si hay algún motivo de duda.
4. Si no hay ninguno, carga el documento o el turno por la RPC del camino
   automático. Si hay al menos uno, descarta lo que Gemini contestó y deja el
   correo pendiente con el motivo escrito.

Ni el adjunto ni el cuerpo del correo se persisten en ningún punto de este
circuito —siguen rigiendo el §4.4 y el §10.2 de este documento—, y lo mismo
vale para todo lo que Gemini devuelve: si el correo termina yendo a revisión,
lo único que sobrevive es la frase de `docs/gmail-ingesta.md` §9.2 ("no dice a
nombre de quién viene"), nunca la respuesta cruda del modelo.

#### El campo `paciente`: un schema y un prompt derivados, exclusivos del camino automático

Leer un documento para el camino automático usa `SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE`
y `PROMPT_DOCUMENTO_MEDICO_CON_PACIENTE` (`lib/gemini/schemas.ts`,
`lib/gemini/prompt-documento.ts`), no `SCHEMA_DOCUMENTO_MEDICO` /
`PROMPT_DOCUMENTO_MEDICO` de siempre. **Las tres puertas humanas —subida a
mano, Web Share Target, "Revisar este estudio"— siguen usando el schema y el
prompt de siempre, sin el campo `paciente`: su contrato de privacidad no
cambió en nada.**

Son DERIVADOS y no un campo agregado al schema de siempre a propósito: las
ocho reglas de extracción tienen que ser literalmente las mismas en los dos
caminos, y la forma de garantizarlo es que un camino se construya sobre el
otro (`...SCHEMA_DOCUMENTO_MEDICO.properties`, prompt concatenado) en vez de
mantener dos copias que se van a separar con el tiempo.

El campo que se agrega, `paciente`, le pide a Gemini el nombre y apellido tal
como figura impreso en el documento —"Paciente:", "Apellido y Nombre:", la
carátula del laboratorio—, copiado literal y sin completar nada si no
aparece. Ese nombre:

1. Se compara **en memoria**, dentro de la misma pasada del barrido, contra
   `profiles.full_name` del perfil de destino elegido en el interruptor
   (`coincideNombreDePaciente`, `docs/gmail-ingesta.md` §9.1).
2. Alimenta un único booleano en la compuerta (`sinDudas` / el motivo
   `nombre_no_coincide` o `sin_nombre_de_paciente`).
3. **Se descarta ahí mismo.** No se persiste en ninguna tabla, no se escribe
   en ningún `console.*` —ni siquiera cuando la validación de Zod falla, en
   cuyo caso lo que se registra son los mensajes de Zod (que describen la
   estructura, no el contenido, mismo criterio que el §6)—, y no vuelve al
   navegador: este circuito entero corre en `pg_cron` → Route Handler, sin
   ninguna respuesta hacia un cliente.

La garantía de que el nombre no puede terminar guardado por descuido no es
disciplina de quien escribió el código: **es que no hay dónde ponerlo.**
`DocumentoAutomaticoParaIngresar` (`lib/gmail/auto-ingesta-admin.ts`), el tipo
que junta todo lo que se manda a la RPC que crea el documento, no tiene un
parámetro `paciente`. Es la misma técnica de "el tipo es la lista blanca" que
`ContextoClinico` (§1, regla 2): agregar el nombre ahí exigiría tocar el tipo,
y tocar el tipo es una decisión visible, no un `...spread` que lo cuela.

#### En turnos, no hay ningún campo de paciente — y es deliberadamente más protector

El camino de los turnos **no agregó ningún campo nuevo al schema de
extracción**. `SCHEMA_ANALISIS_MENSAJE_TURNO` sigue siendo exactamente el que
describe el §9: sin un solo campo para nombre ni DNI del paciente. En vez de
preguntarle a Gemini a nombre de quién viene el aviso, `nombreApareceEnTexto`
(`lib/gmail/coincidencia-nombre.ts`) busca, **fuera de cualquier llamada al
modelo**, si los tokens del nombre del perfil de destino aparecen contiguos
dentro del asunto y el cuerpo del correo tal como el barrido los tiene en
memoria.

Es más protector que el camino de los documentos por una razón concreta: en
documentos, el riesgo es que el MODELO invente o corrompa un nombre en el
campo `paciente` antes de que se lo compare y descarte. En turnos, ese riesgo
directamente no existe, porque nunca se le pide al modelo que produzca un
nombre: la comparación es una búsqueda de texto determinística, en el
servidor, contra una cadena que la aplicación ya conocía de antes
(`profiles.full_name`). Nada que Gemini devuelva puede hacer que esa búsqueda
mienta.

#### Qué queda guardado de nuevo

| Columna | Tabla | Qué es |
|---|---|---|
| `auto_ingest_enabled`, `auto_ingest_profile_id`, `auto_ingest_set_at` | `gmail_connections` | El interruptor, a quién apunta y desde cuándo. Las tres nacen vacías/`false` para toda conexión existente. |
| `auto_ingested_at` | `gmail_messages` | Cuándo ese correo entró SOLO. `NULL` = lo trajo una persona, o no entró. |
| `auto_review_reason` | `gmail_messages` | Por qué NO se cargó solo, en una frase ya armada para la bandeja ("Quedó para que lo mires vos: …"). |
| `auto_ingest_source` | `documents`, `appointments` | La marca inmutable de origen (`'gmail'` o `NULL`). Sellada por trigger para las sesiones de usuario: nadie puede fingir que algo entró solo, ni borrar la marca de lo que sí entró solo. Detalle completo en `docs/modelo-permisos.md` §7.5. |

Ninguna de estas columnas guarda el nombre del paciente, el cuerpo del correo
ni la respuesta cruda de Gemini: son metadatos de trazabilidad —qué pasó y
cuándo—, no el contenido que se leyó para decidirlo.

#### Cómo se verifica

`tests/unit/gmail-coincidencia-nombre.test.ts` prueba el cotejo de
titularidad en los dos sentidos —lo que TIENE que coincidir y, sobre todo, lo
que NO puede coincidir—, con el caso real del encargo (la casilla que recibe
los estudios de la madre) en su propio `describe`. `tests/unit/gmail-auto-ingesta.test.ts`
prueba la compuerta motivo por motivo: cada uno de los que lista
`docs/gmail-ingesta.md` §9.2 tiene su caso propio, para que aflojar cualquiera
ponga un test en rojo con el nombre de lo que se aflojó. `tests/unit/gmail-auto-carga.test.ts`
prueba el circuito completo contra un Gmail de mentira (`node:http`, mismo
patrón que la 17.1/17.2): correo perfecto que entra solo, cada tipo de duda,
duplicado que ni siquiera llama a Gemini, e interruptor apagado que no toca
nada.

Las cuatro guardas de la base están declaradas en el propio encabezado SQL de
`20260818160000_gmail_auto_ingesta.sql`, y `scripts/test-rls.sql` BLOQUE 25
(55 casos) las prueba una por una: las cuatro guardas con su versión HOSTIL
—perfil que Ana no administra, opt-in apagado, replay del mismo correo,
huella y turno duplicados, correo de otra cuenta, `can_manage` revocado
DESPUÉS de encender el interruptor—, que ni `anon` ni `authenticated` pueden
ejecutar ninguna de las funciones nuevas, que `auto_ingest_source` no se
puede ni inventar ni borrar desde una sesión de usuario, el CHECK+trigger
del §1 (borrar el perfil de destino con el interruptor encendido no rompe
nada), y el Deshacer completo -Beto, que no administra el perfil, no puede
deshacer nada; Ana sí, y el borrado encola la purga de Storage como
cualquier otro borrado-.

---

## 11. Referencias

- `lib/ficha/armado.ts` — el tipo `ContextoClinico` (la lista blanca) y el armado puro.
- `lib/ficha/contexto.ts` — la lectura de la base, con los `select` acotados.
- `tests/unit/contexto-ficha.test.ts` — el test del criterio de aceptación.
- `docs/modelo-permisos.md` §9 — cumplimiento de la Ley 25.326 en el modelo de permisos.
- `docs/modelo-sos.md` §4.2 — por qué la ficha SOS sí muestra el DNI.
- `supabase/migrations/20260812200000_schema_inicial.sql` §4.1 — los `COMMENT ON COLUMN` que anticiparon esta tarea.
- `lib/gemini/schemas.ts` (`SCHEMA_ANALISIS_MENSAJE_TURNO`), `lib/gemini/prompt-turno.ts`, `lib/turnos/construir-propuestas.ts`, `app/api/turnos/analizar-mensaje/route.ts` — la función de la tarea 16.4 descripta en el §9.
- `supabase/migrations/20260818130000_gmail_conexiones.sql` — la tabla, el Vault y las cinco funciones del §10; su encabezado tiene el porqué de cada decisión de guardado.
- `lib/gmail/google-api.ts` (scopes y etiqueta), `lib/gmail/conexiones-admin.ts` (el único lugar por el que pasa el refresh token), `app/api/gmail/callback/route.ts`, `app/(app)/(con-nav)/perfil/gmail/` — el circuito del §10.
- `scripts/test-rls.sql` BLOQUE 23 — las cuatro capas que separan el token de una sesión del navegador (§10.5).
- `docs/gmail-ingesta.md` — el circuito completo de la tarea 17.2 (barrido, bandeja, filtros aprendidos) descripto en el §10.6.
- `supabase/migrations/20260818140000_gmail_mensajes.sql` — el registro de correos y los filtros: qué guarda cada columna y por qué.
- `lib/gmail/heuristica-turno.ts` — la puerta que decide si el cuerpo de un correo puede salir hacia Gemini (§10.6).
- `scripts/test-rls.sql` BLOQUE 24 — RLS, dedup y baja de cuenta de la bandeja de Gmail.
- `supabase/migrations/20260818160000_gmail_auto_ingesta.sql` — el interruptor, la marca de origen y las tres RPC de la carga automática (§10.7); su encabezado tiene el razonamiento completo de las cuatro guardas.
- `lib/gmail/auto-ingesta.ts` — la compuerta "sin dudas", pura y probada motivo por motivo (§10.7).
- `lib/gmail/coincidencia-nombre.ts` — el cotejo de titularidad para documentos y turnos (§10.7).
- `lib/gmail/auto-carga.ts` — la pasada automática dentro del barrido: baja el adjunto, llama a Gemini, decide y carga (§10.7).
- `lib/gmail/auto-ingesta-admin.ts`, `lib/gmail/pendientes-admin.ts`, `lib/documentos/ingesta-automatica.ts` — la persistencia del camino automático con `service_role` (§10.7).
- `lib/gemini/schemas.ts` (`SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE`), `lib/gemini/prompt-documento.ts` (`PROMPT_DOCUMENTO_MEDICO_CON_PACIENTE`) — el schema y el prompt derivados, exclusivos del camino automático (§10.7).
- `docs/modelo-permisos.md` §7.5 — el puente entre la carga automática y la matriz de permisos: por qué el destino exige `can_manage`, por qué no se tocó `confirmar_documento_recien_subido`, y la autoridad re-verificada en cada carga.
- `docs/gmail-ingesta.md` §9 — el circuito completo de la carga automática, la lista de motivos de revisión y las deudas declaradas.
- `scripts/test-rls.sql` BLOQUE 25 (55 casos) — las cuatro guardas de las RPC con su versión hostil, la inmutabilidad de `auto_ingest_source` y el Deshacer completo (§10.7).
