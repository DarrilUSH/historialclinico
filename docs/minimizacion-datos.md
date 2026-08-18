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
   un estudio usa un **índice posicional** (`EstudioContexto.indice`, 1..N),
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

### 3.3 `estudiosRecientes` (máximo 5)

| Campo | Origen | Por qué |
|---|---|---|
| `indice` | posición, 1..N | Permite que la ficha diga "ver estudio 2" **sin que viaje ningún uuid**. |
| `fecha` | `documents.document_date` | Ubica el hallazgo en el tiempo. |
| `categoria` | `documents.category` → etiqueta en castellano | Un laboratorio y una receta se leen distinto. |
| `titulo` | `documents.title` | Qué estudio es. Texto libre, ver §5. |
| `especialidad` | `documents.specialty` | El **área** ("Cardiología"), no la persona. |
| `resumenIa` | `documents.ai_summary` | El resumen en lenguaje claro que ya generó el Sprint 4, y el insumo principal de la ficha. |

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
| `estudiosRecientes[].titulo` | "Análisis de sangre completo — Laboratorio Central" | El roadmap lo pide y es el nombre del estudio. Alguien podría escribir "Análisis de Roberto" y ese texto viajaría. |
| `medicacionActiva[].indicaciones` | "Tomar con las comidas" | Instrucciones de toma; cambian la adherencia. |
| `signosVitales[].ultimas[].nota` | "En ayunas" | Cambia por completo la lectura del valor. |
| `paciente.notasSos` | "Marcapasos colocado en 2019" | Es el campo de antecedentes libres; su contenido típico es puramente clínico. |

**No es hipotético: el propio seed lo demuestra.** La verificación contra la
base local (§7.3) devuelve **cero** apariciones de todo lo del §4 —incluida
`documents.institution`, que en el seed vale `"Centro Cardiovascular Ushuaia"`
y no aparece por ningún lado— pero encuentra el texto `"Laboratorio Central"`
**una** vez, dentro de `estudiosRecientes[1].titulo`:

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

## 10. Referencias

- `lib/ficha/armado.ts` — el tipo `ContextoClinico` (la lista blanca) y el armado puro.
- `lib/ficha/contexto.ts` — la lectura de la base, con los `select` acotados.
- `tests/unit/contexto-ficha.test.ts` — el test del criterio de aceptación.
- `docs/modelo-permisos.md` §9 — cumplimiento de la Ley 25.326 en el modelo de permisos.
- `docs/modelo-sos.md` §4.2 — por qué la ficha SOS sí muestra el DNI.
- `supabase/migrations/20260812200000_schema_inicial.sql` §4.1 — los `COMMENT ON COLUMN` que anticiparon esta tarea.
- `lib/gemini/schemas.ts` (`SCHEMA_ANALISIS_MENSAJE_TURNO`), `lib/gemini/prompt-turno.ts`, `lib/turnos/construir-propuestas.ts`, `app/api/turnos/analizar-mensaje/route.ts` — la función de la tarea 16.4 descripta en el §9.
