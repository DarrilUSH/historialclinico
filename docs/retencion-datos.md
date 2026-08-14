# Política de retención y borrado de datos — Historial Médico

> **Qué es este documento.** La política de **retención** y **supresión** de datos
> del proyecto, exigida por la tarea 12.2 del Sprint 12 y por la Ley 25.326 de
> Protección de los Datos Personales (derecho de supresión, arts. 14-16; deber de
> destruir datos que dejaron de ser necesarios, art. 4 inc. 7). Está construido
> sobre lo que el **esquema real hace hoy**: cada mecanismo cita la tabla, el
> trigger o el archivo que lo implementa, verificado contra la base local
> (contenedor `supabase_db_historialclinico`, 18 migraciones). Donde un mecanismo
> **falta**, se declara como *gap* con severidad y recomendación, en vez de
> describir un comportamiento que no existe.
>
> **Fecha:** 2026-08-14. **Complementa** a
> [`docs/checklist-produccion.md`](./checklist-produccion.md) (ítem 6),
> [`docs/minimizacion-datos.md`](./minimizacion-datos.md) (qué NO sale hacia la IA)
> y la Política de Privacidad pública (`app/(legal)/privacidad/page.tsx`, secciones
> 9 y 10), con la que se contrasta explícitamente en el §4.

---

## 1. Qué datos se guardan y dónde

Todo vive en **Supabase** (PostgreSQL + Storage), el único procesador de
infraestructura (Política de Privacidad §7). El resumen por naturaleza del dato:

| Categoría | Dónde | Tablas / buckets |
|---|---|---|
| **Cuenta** | Supabase Auth | `auth.users` (email, hash de contraseña) |
| **Perfil de salud** (titular o gestionado) | `public` | `profiles` (fecha de nacimiento, grupo sanguíneo, alergias, condiciones crónicas, medicación crítica, DNI y contacto de emergencia si se cargan, notas SOS) |
| **Documentos y estudios** | `public` + Storage | `documents`, `lab_metrics` · bucket `documentos-medicos` (PDF/imagen del estudio) |
| **Medicación** | `public` | `medications`, `medication_intakes`, `medication_renewal_alerts` |
| **Signos vitales** | `public` | `vital_signs`, `vital_sign_thresholds`, `vital_sign_alerts` |
| **Turnos** | `public` | `appointments`, `appointment_reminders` |
| **Coberturas** | `public` + Storage | `insurance_cards` · bucket `credenciales-cobertura` |
| **Avatar** | Storage | bucket `avatares` (path en `profiles.avatar_storage_path`) |
| **Directorio de médicos** | `public` | `doctors` |
| **Permisos familiares** | `public` | `family_permissions` |
| **Registro de accesos** | `public` | `access_logs` (append-only) |
| **Fichas emitidas** | `public` | `consultation_sheets` (append-only) |
| **Consentimiento** | `public` | `consents` (append-only, Ley 25.326) |
| **Suscripciones push** | `public` | `push_subscriptions` |
| **Infraestructura efímera** | `public` + Storage | `shared_uploads_temp` + bucket `compartidos-temp` (área de espera del Share Target); `storage_purge_queue` (cola de purga) |

**El contexto que se manda a la IA no se guarda en ningún lado**: se arma en
memoria, se envía y se descarta (`docs/minimizacion-datos.md` §6). Lo que ya salió
hacia Google (procesador de Gemini) se rige por la política de retención de ese
proveedor, fuera del control de esta aplicación — por eso la minimización de
10.2 es tan estricta.

---

## 2. Cuánto tiempo se guardan

**Principio vigente: retención mientras la cuenta esté activa.** El proyecto **no
implementa expiración automática** de datos clínicos: un estudio de 2024 sigue
disponible en 2030 mientras el titular no lo borre y la cuenta exista. Es
deliberado y correcto para un historial médico —el valor del dato es
justamente su permanencia— y coincide con lo que declara la Política de
Privacidad §10 ("Conservamos tus datos mientras tu cuenta esté activa").

Las **únicas dos excepciones con expiración por diseño** son infraestructura
efímera, no datos del historial:

- **`shared_uploads_temp` / bucket `compartidos-temp`.** Un archivo compartido
  desde otra app (Web Share Target) que todavía no se asignó a un perfil.
  `expires_at` = `created_at + 1 hora`
  (`supabase/migrations/20260814100000_share_target_temporal.sql`). Pasada la
  hora se considera abandonado. **Ver el gap G4 (§5): la purga es perezosa, no
  programada.**
- **Ventana de confirmación de documentos.** Un documento recién subido sin
  confirmar se puede descartar durante 1 hora (`descartar_documento_recien_subido`).
  Pasado ese lapso se consolida como documento del historial.

---

## 3. Cómo se ejerce el borrado (mecanismos que EXISTEN)

### 3.1 `ON DELETE CASCADE` desde el perfil — la columna vertebral

Todas las tablas de dominio cuelgan del perfil con `ON DELETE CASCADE` (verificado
en `supabase/migrations/20260812200000_schema_inicial.sql` y las migraciones
posteriores):

```
profiles (id)  ──cascade──►  documents, lab_metrics, medications, medication_intakes,
                             vital_signs, vital_sign_thresholds, vital_sign_alerts,
                             appointments, appointment_reminders, insurance_cards,
                             family_permissions (owner y granted), push_subscriptions,
                             consultation_sheets, medication_renewal_alerts
```

**Borrar una fila de `profiles` borra en cascada todo el historial de esa
persona**, en una sola transacción atómica. Es lo que hace efectivo el derecho de
supresión a nivel de base.

A su vez, la **cuenta** encadena hacia el perfil propio y hacia lo que cuelga de
la cuenta (no del perfil):

```
auth.users (id)  ──cascade──►  profiles.user_id  (SOLO el perfil propio; ver gap G3)
                 ──cascade──►  consents.user_id
                 ──cascade──►  shared_uploads_temp.user_id
                 ──cascade──►  push_subscriptions.user_id
```

### 3.2 Borrado por-ítem desde la aplicación (con limpieza de Storage)

Las pantallas que **sí** ofrecen borrado individual, y que además limpian el
objeto de Storage de inmediato (patrón "belt-and-suspenders": borrado inmediato +
la cola de purga como red de seguridad):

- **Coberturas** (`app/(app)/(con-nav)/coberturas/actions.ts`): borra la fila de
  `insurance_cards` y llama a `limpiarObjetosSubidos(paths)` para eliminar las
  imágenes de credencial del bucket en el acto.
- **Documento recién subido** (`app/(app)/(con-nav)/estudios/actions.ts`,
  `descartarDocumento`): el RPC `descartar_documento_recien_subido` borra la fila
  (con guardas creador + 1 h + no-confirmado) y luego `borrarObjeto()` elimina el
  PDF/imagen del bucket. **Solo aplica al documento aún no confirmado** (ver gap
  G2).
- **Compartidos temporales** (`app/(app)/(sin-nav)/compartir/actions.ts` y
  `lib/documentos/compartir-temporal-admin.ts`): borran la fila de
  `shared_uploads_temp` y su objeto.

### 3.3 Revocación de acceso (no es borrado de datos, pero corta la visibilidad)

`app/(app)/(con-nav)/familia/actions.ts` borra la fila de `family_permissions`
para **revocar** un acceso otorgado. Los datos del perfil no se tocan; deja de
verlos quien perdió el permiso. Nota de exposición residual: una signed URL ya
emitida sigue sirviendo el archivo hasta expirar (máx. 300 s, §4 del checklist).

### 3.4 La cola de purga de Storage — `storage_purge_queue`

RLS y los `CASCADE` borran **filas**, pero el archivo físico vive en el bucket. El
puente es el trigger `encolar_purga_storage()`
(`supabase/migrations/20260812210000_ajustes_modelo.sql`), `AFTER DELETE` sobre
`documents`, `insurance_cards` y `profiles`: encola en `storage_purge_queue` el
`bucket` + `storage_path` de cada objeto que quedó huérfano por el borrado (el
avatar de un perfil, el PDF de un documento, las caras de una credencial).

`storage_purge_queue` es infraestructura pura: RLS habilitada, **cero políticas**,
sin grants para `anon`/`authenticated` (solo `service_role`). El borrado real del
byte tiene que hacerse por la **Storage API**, no por SQL, porque un `DELETE`
contra `storage.objects` deja el archivo huérfano en el backend y Supabase lo
bloquea con el trigger `protect_objects_delete`
(`supabase/migrations/20260812230000_storage.sql` §4). `borrarObjeto()` de
`lib/storage-admin.ts` usa la API por ese motivo.

**Ver gap G4 (§5): el job que drena esta cola no está escrito.** Hoy la cola es
solo la red de seguridad del borrado por-ítem (que ya limpia el objeto en el acto);
en el **camino de cascada** (borrar un perfil o una cuenta) nadie la drena.

### 3.5 El registro que NO se borra mientras la cuenta viva — y por qué está bien

`consents` es **append-only y probatorio** (Ley 25.326): guarda que tal cuenta
aceptó tal versión de tal documento, con fecha e IP. No se puede editar ni borrar
—ni siquiera el propio titular— porque su valor es ser prueba ante la AAIP o ante
la persona (`supabase/migrations/20260814130000_consents.sql`). Pero **cascadea
con la cuenta**: `user_id references auth.users on delete cascade`. Es la
resolución correcta de la tensión entre "prueba inmutable" y "derecho de
supresión": mientras la cuenta existe la prueba es intocable; si la cuenta se da
de baja, la prueba se va con ella. Mismo criterio para `consultation_sheets`
(fichas emitidas) y `access_logs`, ambos append-only y ambos con `CASCADE` desde
el perfil.

---

## 4. El circuito de baja: "quiero que borren todo"

Cómo se materializa hoy un pedido de supresión total, según lo que existe:

**Vía A — self-service parcial, desde la app.** El titular (o el administrador del
perfil) puede, dato por dato: borrar coberturas, descartar un documento no
confirmado, revocar accesos. Es inmediato y no requiere intervención de nadie.

**Vía B — por correo, la que describe la Política de Privacidad §9.** El titular
escribe a `claude2@legistdf.gob.ar` y el responsable ejecuta la baja. Con la
maquinaria de `CASCADE` del §3.1, **borrar el perfil (o la cuenta) desde el
Dashboard de Supabase / con `service_role` borra en cascada todo el historial en
una transacción**, de forma efectiva y sin papelera. La Política promete respuesta
en 10 días corridos (art. 14). **Esta vía funciona a nivel de base**, con dos
salvedades importantes (gaps G3 y G4).

> **Advertencia operativa para quien procese una baja por Vía B.** Por los gaps G3
> y G4, "borrar la cuenta" en el Dashboard **no alcanza** para una supresión
> completa. El procedimiento correcto es, en orden:
> 1. Borrar explícitamente **cada perfil gestionado** que administraba esa cuenta
>    (filas de `profiles` con `user_id IS NULL` vinculadas por
>    `family_permissions`), no solo la cuenta — ver G3.
> 2. Borrar la cuenta (`auth.users`), que cascadea el perfil propio y su
>    historial.
> 3. **Drenar `storage_purge_queue`** manualmente por la Storage API (borrar los
>    objetos encolados por los triggers), porque no hay job que lo haga — ver G4.
>    Verificar con `select count(*) from storage_purge_queue where purged_at is null`.

---

## 5. Gaps declarados (con severidad y recomendación)

Los mecanismos anteriores existen y funcionan; estos cuatro puntos son lo que
**falta** para que la supresión sea completa y self-service. Se declaran acá en
vez de dejarlos implícitos.

### G1 — No hay "eliminar mi cuenta" self-service en la UI · **Severidad: media**

**Qué falta.** No existe ninguna pantalla ni acción que permita al titular dar de
baja su **cuenta entera** desde la aplicación. Verificado: no hay ninguna llamada
a `supabase.auth.admin.deleteUser` ni a `auth.admin` en todo el árbol; no hay
ninguna Server Action de baja de cuenta.

**Por qué importa.** La Política de Privacidad §10 dice textualmente *"Si borrás …
tu cuenta entera, se elimina de forma efectiva"*, lo que le promete al usuario una
capacidad self-service que la UI **no** ofrece. La baja de cuenta solo es posible
por Vía B (correo → acción manual del responsable). Un desajuste entre lo que el
documento legal ofrece y lo que el producto hace es material bajo la Ley 25.326.

**Recomendación.** O bien (a) implementar la baja self-service: una Server Action
que llame a `deleteUser` con `service_role` (borra `auth.users` → cascada), previa
reautenticación y confirmación, contemplando G3; o bien (b) —si se prefiere el
control manual— **ajustar la redacción de la Política** para que describa la baja
como un pedido por correo, no como una acción in-app. La opción (b) es de costo
casi nulo y elimina el desajuste de inmediato; la (a) es la experiencia correcta a
mediano plazo. Cualquiera de las dos es **decisión del usuario**.

### G2 — Los documentos/medicación/signos confirmados no se borran individualmente desde la UI · **Severidad: media**

**Qué falta.** El borrado por-ítem de la UI cubre coberturas, accesos y el
documento *aún no confirmado*. Pero:
- Un **documento ya confirmado** no tiene acción de borrado (no hay una acción de
  eliminar en `estudios/actions.ts` ni botón en `estudios/[id]/page.tsx`).
- La **medicación no se borra: se suspende** (`suspenderMedicacion` fija
  `is_active=false` + `suspended_at`, la fila persiste — es trazabilidad
  deliberada, `medicacion/actions.ts`).
- Los **signos vitales** y los **turnos** no tienen borrado individual
  (`signos/actions.ts` solo registra y marca alertas; en turnos, "cancelar" es un
  cambio de estado, no un `DELETE`).

**Por qué importa.** La Política de Privacidad §9 afirma que *"cada dato que
cargaste —perfil, documento, medicación, signo vital, turno— se puede editar o
borrar directamente desde la pantalla donde lo cargaste"*. Hoy eso es cierto para
editar y para **algunos** borrados, pero no para el borrado individual de esos
cuatro tipos. La supresión de esos datos hoy solo ocurre por cascada (al borrar el
perfil) o por Vía B.

**Recomendación.** Alinear producto y política: agregar borrado por-ítem para
documento confirmado, signo y turno (reusando el patrón de coberturas: `DELETE` +
`limpiarObjetosSubidos`/`borrarObjeto` donde haya archivo), y decidir si "suspender
medicación" cuenta como supresión o si hace falta un borrado definitivo. Si no se
implementa, matizar la §9 de la Política. **Decisión del usuario.**

### G3 — Borrar la cuenta NO cascadea a los perfiles gestionados · **Severidad: media**

**Qué pasa.** `profiles.user_id` es **nullable a propósito**: un perfil
**gestionado** (un adulto mayor sin cuenta, administrado por un familiar) tiene
`user_id IS NULL` y se vincula al administrador solo por `family_permissions`
(`schema_inicial.sql` líneas 185-224). El `CASCADE` de `auth.users → profiles`
opera sobre `user_id`, así que **solo alcanza al perfil propio de la cuenta**. Al
borrar una cuenta:
- se borra su perfil propio y todo su historial (cascada ✔);
- se borran las filas de `family_permissions` de esa cuenta (cascada ✔);
- **el/los perfil(es) gestionado(s) quedan huérfanos**: `profiles` con
  `user_id IS NULL`, sin ningún `family_permissions` que apunte a ellos y sin
  cuenta que pueda verlos. Su historial médico **persiste indefinidamente** en la
  base, inaccesible por RLS pero no suprimido.

**Por qué importa.** Es datos de salud de un tercero que sobreviven a la baja de
la única persona que podía gestionarlos, sin cumplir el art. 4 inc. 7 (destruir lo
que dejó de ser necesario). Y hace que la Vía B, ejecutada como "borrar la cuenta",
sea **incompleta** sin que sea evidente.

**Recomendación.** (1) Inmediato/procedimental: documentar el orden de borrado del
§4 (perfiles gestionados primero, cuenta después) — hecho en este documento. (2)
De producto: si se implementa la baja self-service (G1), que la Server Action
detecte los perfiles gestionados por la cuenta y ofrezca borrarlos o transferir su
administración antes de dar de baja la cuenta; o un trigger `BEFORE DELETE ON
auth.users` que borre los perfiles gestionados sin otro administrador (mismo
espíritu que `family_permissions_evitar_huerfano`, que hoy protege el caso
inverso). **Decisión de diseño del usuario.**

### G4 — El job que drena `storage_purge_queue` no está escrito · **Severidad: baja-media**

**Qué falta.** La cola `storage_purge_queue` se llena (triggers del §3.4) pero
**nadie la drena**: no hay job de `pg_cron` ni endpoint que la procese. Verificado
en la base local:

```
$ select jobname, schedule from cron.job;
 alertas-medicacion     | 10 12,21 * * *
 generar-tomas-del-dia  | 5 3 * * *
 recordatorios-turnos   | */15 * * * *
(ningún job de purga)

$ select proname from pg_proc … ilike '%storage_purge_queue%';
 encolar_purga_storage      (solo el trigger de ENCOLADO; no hay drenaje)
```

Es **deuda declarada y aceptada** del proyecto desde el Sprint 6, repetida
textualmente en tres migraciones (`ajustes_modelo`, `storage`,
`share_target_temporal`): "el job que la drena … es del Sprint 6" y todavía no se
escribió.

**Alcance real (por qué no es alto).** En el borrado **por-ítem** desde la UI
(coberturas, descarte de documento) el objeto ya se elimina en el acto con
`borrarObjeto`/`limpiarObjetosSubidos`; la cola es solo respaldo. El agujero está
en el camino de **cascada**: al borrar un perfil o una cuenta, los triggers encolan
los paths pero los bytes quedan huérfanos en un **bucket privado sin política de
cliente** (nadie los puede leer) hasta que alguien drene la cola. Es una falla de
*supresión efectiva del byte*, no una exposición.

**Recomendación.** Escribir el drenaje pendiente: un cuarto job de `pg_cron` +
endpoint autenticado con `x-cron-secret` (mismo patrón ya probado de
`recordatorios-turnos`) que lea `storage_purge_queue where purged_at is null`,
borre cada objeto por la Storage API (`borrarObjeto`) y selle `purged_at`. Análogo
para la purga de `shared_uploads_temp` vencidos (hoy solo perezosa: se barre
cuando la misma cuenta vuelve a `/compartir`, así que una cuenta que comparte una
vez y no vuelve deja su archivo temporal más allá de la hora). Mientras tanto, el
§4 documenta el drenaje manual como parte del circuito de baja.

---

## 6. Verificación

| Afirmación | Cómo se verificó |
|---|---|
| 20/20 tablas con RLS; el borrado por perfil cascadea | `pg_tables` + FKs `on delete cascade` en las migraciones (§3.1) |
| Los 4 buckets privados; objeto huérfano queda encolado | `storage.buckets` (§4 del checklist) + trigger `encolar_purga_storage` |
| No hay drenaje de `storage_purge_queue` | `cron.job` (3 jobs, ninguno de purga) + `pg_proc` (solo `encolar_purga_storage`) |
| No hay baja de cuenta ni de perfil self-service | `grep` de `deleteUser`/`auth.admin`/`.from("profiles").delete()`/RPC en todo el árbol → 0 |
| `consents` cascadea con la cuenta | `consents.user_id references auth.users on delete cascade` (migración de 12.1) |
| Perfiles gestionados no cascadean con la cuenta | `profiles.user_id` nullable + FK solo sobre `user_id` (`schema_inicial.sql`) |

Los cuatro gaps son **acciones o decisiones del usuario**, no bugs a corregir en
esta tarea de auditoría. Ninguno es una fuga de datos: G1/G2 son desajustes entre
la Política publicada y el producto; G3/G4 son supresiones incompletas de datos ya
inaccesibles. Se dejan escritos con severidad y camino de resolución para que el
Sprint que los tome sepa exactamente qué falta.
