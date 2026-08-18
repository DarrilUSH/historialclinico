# Seguridad: Row Level Security — Historial Médico

> **Qué es este documento:** el mapa de lo que quedó **implementado en la base**. Traduce la matriz normativa de [`modelo-permisos.md`](./modelo-permisos.md) a nombres concretos de políticas, funciones y triggers, para que una auditoría pueda ir celda por celda hasta el objeto de Postgres que la hace cumplir.
> **Fuente de verdad:** `supabase/migrations/20260812220000_rls.sql` (políticas de tabla), `supabase/migrations/20260812230000_storage.sql` (buckets y políticas de Storage) y `supabase/migrations/20260812210000_ajustes_modelo.sql` (columnas y triggers de los que dependen). Si este documento y el SQL se contradicen, gana el SQL y este archivo se corrige.
> **El contrato sigue siendo [`modelo-permisos.md`](./modelo-permisos.md).** Acá no se decide nada: se muestra dónde quedó cada decisión.

- **Motor verificado:** PostgreSQL 17.6 (Supabase local, contenedor `supabase_db_historialclinico`).
- **Cobertura (verificada contra el catálogo el 2026-08-14, Sprint 11):** **19 tablas** con RLS habilitada, **60 políticas** de tabla, **4 buckets privados** con 5 políticas de `storage.objects`, **39 funciones** en `public` (todas con `search_path` fijado) y **28 triggers** que cubren lo que RLS no puede expresar. Una sola vista, `v_medicacion_estado`, en `security_invoker`.
- **Estado de las pruebas:** `scripts/test-rls.sql` — **253 casos, 253 PASS, 0 FAIL**; `scripts/test-storage-rls.sh` — **27 casos, 27 PASS, 0 FAIL**.
- **Auditoría:** [`auditoria-seguridad.md`](./auditoria-seguridad.md) (Sprint 11, tarea 11.4) es el informe completo, objeto por objeto, con los hallazgos y su estado. Los números de arriba salieron de ahí. **Este resumen quedó tres sprints atrás una vez** (hallazgo A-04): si volvés a tocar el esquema, actualizalo o volvé a dejar un mapa que miente sobre cuánto hay que auditar.

---

## 1. Qué se habilitó, y qué NO

```
  Capa 1  ── privilegio de tabla (GRANT) ────────────────────────────────────
            anon           : NADA sobre el dominio. Ni SELECT.
            authenticated  : SELECT/INSERT/UPDATE/DELETE en 11 tablas,
                             SELECT/INSERT en access_logs (append-only),
                             nada en storage_purge_queue.
            service_role   : todo (tiene además BYPASSRLS).

  Capa 2  ── Row Level Security (POLICY) ────────────────────────────────────
            Filtra FILAS dentro del privilegio que ya existe.
            Sin fila de permiso y sin titularidad -> CERO FILAS, no un error.

  Capa 3  ── triggers de complemento ────────────────────────────────────────
            Lo que RLS no puede decir: inmutabilidad de columnas,
            transiciones de estado, invariantes globales posteriores.
```

Las tres capas dicen lo mismo a propósito. Que `anon` no tenga privilegio de tabla no es redundante con RLS: es la garantía de que un error futuro al escribir una política no se traduzca en una fuga para un visitante sin sesión.

### Las 19 tablas con RLS habilitada

**Del Sprint 1:** `profiles` · `family_permissions` · `doctors` · `documents` · `lab_metrics` · `appointments` · `medications` · `medication_intakes` · `vital_signs` · `insurance_cards` · `access_logs` · `push_subscriptions` · `storage_purge_queue`

**Agregadas después:** `appointment_reminders` (6.4) · `medication_renewal_alerts` (7.4) · `vital_sign_thresholds` y `vital_sign_alerts` (9.2) · `consultation_sheets` (10.5) · `shared_uploads_temp` (11.2)

Dos de las 19 tienen RLS habilitada y **cero políticas**, a propósito: `appointment_reminders` y `storage_purge_queue` son infraestructura que solo tocan los triggers `SECURITY DEFINER`, `pg_cron` y los barridos con `service_role`; ninguna sesión de la aplicación tiene privilegio sobre ellas. El BLOQUE 7 del arnés verifica que sigan siendo **exactamente esas dos**: una tercera en la lista es un olvido de políticas, no una tabla de infraestructura nueva.

```sql
select tablename from pg_tables where schemaname = 'public' and rowsecurity = false;
-- esperado: 0 filas   (criterio de aceptación del Sprint 1)
```

### Por qué NO se usó `FORCE ROW LEVEL SECURITY`

Las 19 tablas son propiedad de `postgres`, y en Supabase tanto `postgres` como `service_role` tienen el atributo de rol **`BYPASSRLS`**, que se evalúa **antes** que `FORCE`. Activarlo no cambiaría el comportamiento de ningún rol real: sería seguridad decorativa.

Lo que sí haría, si alguna vez se quitara ese atributo, es someter a RLS a las funciones `SECURITY DEFINER` de la sección 2 — reintroduciendo exactamente la recursión `42P17` que vienen a evitar — y romper el seed y las migraciones. La protección efectiva contra el uso indebido de `service_role` no es `FORCE`: es que la `SERVICE_ROLE_KEY` nunca salga del servidor, y eso se audita en el Sprint 11.

---

## 2. Funciones auxiliares y por qué no recursan

### 2.1 El problema, concreto

La política de `SELECT` de `profiles` necesita consultar `family_permissions`. La política de `family_permissions` necesita resolver cuál es el perfil del actor, o sea consultar `profiles`. Postgres detecta el ciclo y aborta la consulta entera:

```
ERROR:  42P17: infinite recursion detected in policy for relation "profiles"
```

### 2.2 Por qué estas funciones lo cortan

Todas son **`SECURITY DEFINER`** y su dueño es `postgres`, que es a la vez **dueño de las 19 tablas** y portador de **`BYPASSRLS`**. Cuando una política invoca a una de estas funciones, las consultas de adentro **no evalúan ninguna política**: el motor no vuelve a entrar en `profiles` ni en `family_permissions` como sujeto de RLS. El ciclo se corta en la frontera de la función.

```
   política de profiles          ┌───────────────────────────────┐
   USING (puede_ver_perfil(id))  │  SECURITY DEFINER (postgres)  │
            │                    │                               │
            └───────────────────►│  select ... from profiles     │  ◄── sin RLS
                                 │  select ... from              │
                                 │        family_permissions     │  ◄── sin RLS
                                 └───────────────┬───────────────┘
                                                 │  boolean
            ┌────────────────────────────────────┘
            ▼
   la política decide y TERMINA. No hay segunda vuelta.
```

### 2.3 Reglas que cumplen las nueve

| Regla | Por qué |
|---|---|
| `SECURITY DEFINER` | Es lo que corta la recursión (salvo `es_sesion_de_usuario`, ver abajo) |
| `STABLE` | El planner las evalúa una vez por sentencia, no una vez por fila |
| `SET search_path = ''` + todo objeto calificado | Un `search_path` manipulado por el cliente podría hacer que la función resuelva otra tabla (lint `function_search_path_mutable` de Supabase) |
| `REVOKE EXECUTE FROM public` + `GRANT TO authenticated, service_role` | `anon` no puede invocarlas ni por RPC |
| **Una sola** por cláusula de política | Combinar dos `EXISTS` escritos a mano dentro de la política es lo que reintroduce la recursión |

### 2.4 Las nueve funciones

| Función | Devuelve | Semántica | Contrato |
|---|---|---|---|
| `public.perfil_actor()` | `uuid` | El `profiles.id` cuyo `user_id = auth.uid()`. `NULL` si la cuenta todavía no tiene perfil | §7.2 |
| `public.es_titular(perfil)` | `boolean` | El perfil existe y su `user_id` es el de la sesión | §7.2 |
| `public.es_perfil_gestionado(perfil)` | `boolean` | El perfil existe y su `user_id` es `NULL` — es lo que leen las notas ⚑ | §7.2 |
| `public.puede_ver_perfil(perfil)` | `boolean` | Titular **o** permiso con `can_view OR can_upload OR can_manage` | §7.2 |
| `public.puede_cargar_en_perfil(perfil)` | `boolean` | Titular **o** permiso con `can_upload OR can_manage` | §7.2 |
| `public.puede_administrar_perfil(perfil)` | `boolean` | Titular **o** permiso con `can_manage` | §7.2 |
| `public.puede_otorgar_permisos(perfil)` | `boolean` | Titular **o** (`perfil` gestionado **y** `can_manage`) — regla de la autoridad de otorgamiento | §4.4 / §7.2 |
| `public.puede_arrancar_administracion(perfil, autorizado)` | `boolean` | Habilita **solo** la fila de arranque de un perfil gestionado | **extensión, ver §2.6** |
| `public.es_sesion_de_usuario()` | `boolean` | La escritura viene de una sesión de usuario final y no del seed / una migración / un job | **auxiliar de los triggers** |

**Monotonía deliberada.** `puede_ver_perfil` acepta también a quien tenga solo `can_upload` o solo `can_manage`. Mientras no exista la [deuda D3](./modelo-permisos.md#d3-check-de-monotonía-de-los-flags) (el `CHECK` de monotonía de los flags), una fila incoherente como `can_view = false, can_upload = true` degrada a *"puede ver"* en lugar de a *"escribe a ciegas"*.

**Un mismo predicado, tres potestades.** `puede_otorgar_permisos` gobierna a la vez el `DELETE` de `profiles` (nota ③ ⚑), el ABM de `family_permissions` (nota ⑤ ⚑) y el `SELECT` de la lista de accesos (nota ⑪ ⚑). No es una casualidad de implementación: las tres son potestades del titular que las notas ⚑ transfieren al administrador **solo** cuando no hay titular capaz de ejercerlas.

### 2.5 `es_sesion_de_usuario()` es la excepción: `SECURITY INVOKER`

Es la única función auxiliar que **no** es `SECURITY DEFINER`, y el motivo es una trampa que ya se cobró cuatro casos de prueba durante la implementación:

> Dentro de una función `SECURITY DEFINER`, `current_user` es el **dueño** de la función (`postgres`), **no el rol de la sesión**.

Una guarda escrita como `if current_user not in ('authenticated','anon') then return; end if;` dentro de un trigger `SECURITY DEFINER` **nunca se dispara**: siempre ve `postgres` y sale por la rama del seed. Los tres triggers de complemento quedaban silenciosamente desactivados y la suite lo detectó (`created_by_profile_id` sin sellar, toma reprogramable, `user_id` mutable, arranque de perfil gestionado imposible).

Por eso `es_sesion_de_usuario()` y los tres triggers que la usan corren como **invocador**, y la detección combina dos señales en `OR`:

```sql
current_user in ('authenticated', 'anon')   -- request de PostgREST (SET LOCAL ROLE)
or (select auth.uid()) is not null          -- JWT con sub, incluso dentro de un RPC DEFINER
```

Un job con `service_role` no tiene `sub` en su JWT y corre con su propio rol: no dispara ninguna de las dos. Ninguno de los tres triggers necesita saltear RLS, así que ser invocador no les cuesta nada.

### 2.6 La extensión al contrato: `puede_arrancar_administracion()`

**No está en las siete funciones de la §7.2 del contrato. Se agregó al implementar la matriz, y merece revisión del orquestador.**

**El agujero, concreto.** El documento declara *obligatoria* la fila de arranque: quien crea un perfil gestionado recibe, en la misma transacción, una fila con los tres flags en `true` ([§3.2](./modelo-permisos.md#32-caso-b--perfil-gestionado-sin-cuenta-user_id-is-null)). Pero la matriz autoriza el `INSERT` en `family_permissions` solo a la autoridad de otorgamiento, y en ese instante **nadie** tiene `can_manage` sobre el perfil recién creado: `puede_otorgar_permisos()` es `false` y RLS rechaza la fila. El perfil nacería [huérfano](./modelo-permisos.md#82-perfil-huérfano-un-gestionado-sin-administrador) e inaccesible — el estado que la §8.2 declara prohibido.

**Las alternativas descartadas.** Crear el perfil con `service_role` saca del alcance de la matriz una operación central del producto y hace que la garantía dependa del código de la aplicación en lugar de la base. Relajar la política de `INSERT` a "cualquiera puede otorgarse permiso sobre un perfil sin administrador" abre una carrera por adueñarse de perfiles gestionados.

**Lo que se implementó.** Una política aparte (`family_permissions_insert_arranque_gestionado`) con **cinco** condiciones simultáneas:

1. la fila nueva tiene `can_manage = true` (es una fila de administración, no otra cosa);
2. el perfil dueño es **gestionado** (`user_id IS NULL`);
3. el perfil dueño fue **creado por el perfil actor** (`created_by_profile_id`, [deuda D1](./modelo-permisos.md#d1-created_by_profile_id-en-profiles), sellado por trigger e inmutable);
4. el autorizado es el **propio perfil actor** — no se puede arrancar a nombre de un tercero;
5. el perfil dueño **todavía no tiene ningún `can_manage`**.

La política deja de valer **para siempre** en cuanto existe el primer administrador. La suite lo verifica en los dos sentidos: Diego puede arrancar la administración del perfil que él creó, y **no** puede autoasignarse la del perfil gestionado que creó María (casos 39 y 40).

### 2.7 `crear_perfil_gestionado()` (Sprint 15, tarea 15.1): empaqueta el arranque, no lo reemplaza

`profiles_insert_propio_o_gestionado` + `family_permissions_insert_arranque_gestionado` siguen intactas y siguen siendo el camino que prueba el BLOQUE 5 (dos `INSERT` sueltos desde una sesión de usuario). `20260817220000_perfiles_gestionados.sql` agrega un TERCER camino, no un reemplazo: la función `SECURITY DEFINER` `crear_perfil_gestionado(full_name, date_of_birth, legales_version, ip)`, que hace los mismos dos `INSERT` -perfil y fila de arranque- más un tercero (`consents`, `document = 'acceso_familiar_representante'`, cierra la [deuda D6](./modelo-permisos.md#d6-registro-del-consentimiento-en-perfiles-gestionados-aplicada)) en una **única transacción PL/pgSQL**. La UI de `/familia` usa este RPC en vez del camino de dos `INSERT`: con dos llamadas sueltas desde un Server Action, un fallo de red entre la primera y la segunda deja un perfil con `user_id IS NULL` y **cero** filas de `can_manage` -huérfano e invisible incluso para quien lo creó, porque `puede_ver_perfil` exige titularidad o una fila de permiso y ninguna de las dos llegó a existir-. `SECURITY DEFINER` bypassea RLS para las tres escrituras (mismo criterio que `registrar_toma()`), así que la función no depende de -ni relaja- ninguna política de este archivo.

### 2.8 `puede_graduar_perfil()` (Sprint 15, tarea 15.2): la autoridad para cambiar la titularidad

`20260817230000_graduacion.sql` implementa la [transición de gestionado a perfil con cuenta](./modelo-permisos.md#86-transición-de-gestionado-a-perfil-con-cuenta) (§8.6), *"la única operación del modelo que ningún rol puede hacer desde la aplicación"*. La décima función auxiliar es la que decide quién puede pedirla:

| Función | Devuelve | Semántica | Contrato |
|---|---|---|---|
| `public.puede_graduar_perfil(perfil)` | `boolean` | El perfil sigue siendo gestionado (`user_id IS NULL`) **y** su `created_by_profile_id` es el perfil actor | §8.6 |

**Es más estricta que `puede_otorgar_permisos`, a propósito.** Sobre un perfil gestionado, la autoridad de otorgamiento alcanza a *cualquier* `can_manage` (nota ⚑). La graduación no: solo el **creador**, que es quien declaró la representación legal al crear el perfil y firmó el consentimiento `acceso_familiar_representante` (§2.7). Administrar el historial de alguien y decidir sobre su identidad no son la misma potestad, y un familiar al que después le dieron `can_manage` para cargar estudios no heredó la segunda. El BLOQUE 21 del arnés lo prueba de forma explícita, con los dos casos juntos: el mismo actor obtiene `puede_otorgar_permisos = true` y `puede_graduar_perfil = false`.

**La escritura NO pasa por RLS y por eso la autorización tiene que ser previa.** La cuenta nueva la crea la Admin API de Supabase con `service_role` (`lib/auth/cuentas-admin.ts`, patrón `storage-admin`), que tiene `BYPASSRLS`. La vinculación en sí la hace el trigger de alta —`completar_alta_de_cuenta`, extendida por esta migración— dentro de la **misma transacción** del `INSERT` en `auth.users`, con la guarda atómica `where id = <claim> and user_id is null`: dos graduaciones simultáneas del mismo perfil no pueden ganar las dos, y un perfil con dueño no se puede tomar. Si la vinculación no se puede hacer, la función levanta excepción y **el alta entera se deshace**: no queda una cuenta a medio vincular (el modo de falla que arregló el hotfix de `20260814140000`) ni se toca un perfil ajeno.

**El claim viaja en `raw_app_meta_data`, nunca en `raw_user_meta_data`.** Es el punto de seguridad de la tarea. `raw_user_meta_data` es lo que escribe el propio usuario desde el navegador (`options.data` de `signUp`, `data` de `updateUser`) con la clave anónima: si el trigger lo leyera de ahí, un `signUp` preparado con el `uuid` de un perfil gestionado ajeno alcanzaría para adueñarse de su historial médico —y el `and user_id is null` no protegería, porque los gestionados son justamente los que tienen `user_id IS NULL`—. `raw_app_meta_data` solo la puebla la Admin API. Un `perfil_existente` que aparezca en la metadata del usuario se **ignora**, y esa alta se procesa como cualquier otra (no se rechaza: negarla le confirmaría al atacante que el `uuid` probado existe, el mismo criterio de no-oráculo de `perfil_id_por_email`).

**Lo que ocurre solo, sin migrar un dato:** al dejar de ser `NULL` el `user_id`, `es_perfil_gestionado` pasa a `false`, las notas ⚑ dejan de aplicar y la autoridad de otorgamiento se transfiere del administrador al nuevo titular (§8.6 punto 4). El trigger `family_permissions_evitar_huerfano` (D4) también deja de tutelar el perfil, que es lo que permite al nuevo titular revocarle el acceso a quien lo administraba: un perfil con cuenta no puede quedar huérfano porque su titular siempre puede entrar (§8.2). Las filas de `family_permissions` existentes **se conservan** —decisión de producto del Sprint 15— y es el titular quien decide cuáles sobreviven.

**La nota ② sigue intacta.** El trigger `profiles_proteger_titularidad` sigue rechazando con `42501` cualquier cambio de `profiles.user_id` hecho desde una sesión de usuario, en los dos sentidos: nadie se adueña de un perfil ajeno y nadie "des-gradúa" al que graduó. La migración no lo esquiva por casualidad: ese trigger es `SECURITY INVOKER` y su guarda es `es_sesion_de_usuario()`, que devuelve `false` cuando la escritura viene de GoTrue —sin JWT y con `current_user` distinto de `authenticated`/`anon`—, que es exactamente la excepción que su propio `COMMENT` anticipa.

---

## 3. Matriz implementada: tabla × operación × política

Leer junto con la [matriz normativa](./modelo-permisos.md#6-matriz-rol--recurso--operación). Símbolos: **⚑** extensión que aplica solo a perfiles gestionados · **①..⑰** notas al pie del contrato.

### 3.1 `profiles`

| Op. | Política | Predicado | Nota |
|---|---|---|---|
| SELECT | `profiles_select_visible` | `puede_ver_perfil(id)` | — |
| INSERT | `profiles_insert_propio_o_gestionado` | `(user_id is null or user_id = auth.uid())` **y** `(created_by_profile_id is null or created_by_profile_id = perfil_actor())` | ① |
| UPDATE | `profiles_update_administrador` | `USING` y `WITH CHECK`: `puede_administrar_perfil(id)` | ② |
| DELETE | `profiles_delete_autoridad_titular` | `puede_otorgar_permisos(id)` | ③ ⚑ |

**Complemento (nota ②):** `RLS` puede exigir `user_id = auth.uid() OR user_id IS NULL`, pero **no** "igual al valor anterior". El trigger `profiles_proteger_titularidad` (`BEFORE INSERT OR UPDATE`) rechaza cualquier cambio de `user_id` desde una sesión de usuario y sella `created_by_profile_id` con el perfil actor en el alta, dejándolo inmutable después. La transición de gestionado a perfil con cuenta ([§8.6](./modelo-permisos.md#86-transición-de-gestionado-a-perfil-con-cuenta)) es un flujo server-side dedicado, no una edición.

### 3.2 `family_permissions`

| Op. | Política | Predicado | Nota |
|---|---|---|---|
| SELECT | `family_permissions_select_propia_o_administrada` | `granted_profile_id = perfil_actor()` **o** `puede_administrar_perfil(owner_profile_id)` | ④ |
| INSERT | `family_permissions_insert_autoridad` | `puede_otorgar_permisos(owner_profile_id)` | ⑤ ⚑ |
| INSERT | `family_permissions_insert_arranque_gestionado` | `can_manage` **y** `puede_arrancar_administracion(owner_profile_id, granted_profile_id)` | **§2.6** |
| UPDATE | `family_permissions_update_autoridad` | `USING`: `es_titular(owner)` **o** (`puede_otorgar_permisos(owner)` **y** (`not can_manage` **o** `granted_profile_id = perfil_actor()`)) · `WITH CHECK`: `puede_otorgar_permisos(owner)` | ⑤ ⚑ ⑥ |
| DELETE | `family_permissions_delete_renuncia` | `granted_profile_id = perfil_actor()` | ⑦ |
| DELETE | `family_permissions_delete_autoridad` | `es_titular(owner)` **o** (`puede_otorgar_permisos(owner)` **y** `not can_manage`) | ⑤ ⚑ ⑥ |

Las dos políticas de `INSERT` y las dos de `DELETE` son **permisivas**: Postgres las combina con `OR`. Están separadas para que cada celda de la matriz tenga un nombre propio y una auditoría pueda leerlas de a una.

**Nota ⑥ — sin destituciones cruzadas.** El `USING` del `UPDATE` y el `DELETE` de autoridad excluyen las filas con `can_manage = true` que no son la propia. Es lo que evita la guerra de hermanos donde el que llega primero al botón deja al otro afuera del historial del padre. El titular no queda alcanzado: sobre su propio perfil manda sin restricciones.

**Complemento (deuda D4 — no orfandad):** el trigger `family_permissions_evitar_huerfano` (`BEFORE DELETE OR UPDATE`) aborta con `SQLSTATE 23001` y un mensaje accionable cuando la operación dejaría un perfil gestionado sin ningún `can_manage`. **RLS autoriza filas; no verifica el estado global posterior.** El trigger deja pasar el único borrado legítimo —el `CASCADE` que dispara el `DELETE` del propio perfil dueño— detectando que la fila de `profiles` ya no existe, y cierra los tres caminos a la orfandad, incluido el que la aplicación **no puede interceptar**: la baja de cuenta del último administrador.

### 3.3 Las ocho tablas de contenido

`doctors` · `documents` · `lab_metrics` · `appointments` · `medications` · `medication_intakes` · `vital_signs` · `insurance_cards`

| Op. | Política | Predicado |
|---|---|---|
| SELECT | `<tabla>_select_puede_ver` | `puede_ver_perfil(profile_id)` |
| INSERT | `<tabla>_insert_puede_cargar` | `puede_cargar_en_perfil(profile_id)` |
| UPDATE | `<tabla>_update_administrador` | `USING` y `WITH CHECK`: `puede_administrar_perfil(profile_id)` |
| DELETE | `<tabla>_delete_administrador` | `puede_administrar_perfil(profile_id)` |

Las políticas de `UPDATE` llevan **`USING` (fila vieja) y `WITH CHECK` (fila nueva)**. Omitir el segundo permitiría mover una fila a un `profile_id` ajeno: la fila vieja pasa el filtro, la nueva no se verifica, y el dato de salud termina en otro historial.

**La única excepción de la matriz — nota ⑩:**

| Op. | Política | Predicado |
|---|---|---|
| UPDATE | `medication_intakes_update_registrar_toma` | `USING`: `puede_cargar_en_perfil(profile_id)` **y** `status = 'pending'` · `WITH CHECK`: `puede_cargar_en_perfil(profile_id)` **y** `status in ('taken','skipped')` |

Registrar la toma del día es técnicamente un `UPDATE`, pero funcionalmente es "cargar el dato del día" y es la tarea principal de un cuidador.

**Complemento (nota ⑩):** RLS restringe la fila resultante, **no qué columnas cambiaron**. Sin refuerzo, un `can_upload` podría mover la toma a otro horario, a otra medicación o a otro perfil en la misma sentencia que la confirma. El trigger `medication_intakes_proteger_programacion` (`BEFORE UPDATE`) rechaza con `42501` los cambios de `medication_id`, `scheduled_at` y `profile_id` cuando el actor no administra el perfil.

**Lo que sigue sin poder expresarse en RLS (nota ⑨):** el descuento de `medications.stock_units` al registrar una toma requiere escribir en dos tablas con permisos distintos, atómicamente. **No se resuelve ampliando `can_upload`**: se resolverá con la función `SECURITY DEFINER` `registrar_toma()` del Sprint 7, que valida `puede_cargar_en_perfil` y hace ambas escrituras juntas. La suite verifica hoy que un `can_upload` **no** pueda tocar `stock_units` directo (caso 27).

### 3.4 `access_logs` — append-only

| Op. | Política | Predicado | Nota |
|---|---|---|---|
| SELECT | `access_logs_select_propias_o_titular` | `actor_user_id = auth.uid()` **o** `puede_otorgar_permisos(profile_id)` | ⑪ ⚑ |
| INSERT | `access_logs_insert_actor_propio` | `actor_user_id = auth.uid()` | ⑯ |
| UPDATE | **ninguna** — más `REVOKE UPDATE` | — | §6.2 |
| DELETE | **ninguna** — más `REVOKE DELETE` | — | §6.2 |

- Un `can_view` o un `can_upload` **no** ve la lista de accesos del dueño: es el instrumento con el que el titular controla a sus propios autorizados, y dárselo a un autorizado lo vacía de sentido y expone la composición del grupo familiar. Sí ve **siempre** sus propias filas (`actor_user_id = auth.uid()`): son sus datos.
- El `INSERT` no puede firmarse a nombre de otro. `actor_user_id` es nullable en el esquema y la comparación contra `NULL` no es `TRUE`: una fila sin actor queda rechazada.
- La ausencia de política ya impediría `UPDATE` y `DELETE`; el `REVOKE` los impide **una capa antes**, sin depender de que RLS esté habilitada.

### 3.5 `push_subscriptions` — fuera del modelo familiar (nota ⑰)

| Op. | Política | Predicado |
|---|---|---|
| SELECT | `push_subscriptions_select_propias` | `user_id = auth.uid()` |
| INSERT | `push_subscriptions_insert_propias` | `user_id = auth.uid()` |
| UPDATE | `push_subscriptions_update_propias` | `USING` y `WITH CHECK`: `user_id = auth.uid()` |
| DELETE | `push_subscriptions_delete_propias` | `user_id = auth.uid()` |

Una suscripción Web Push pertenece a **un navegador de una persona**, no a un perfil. Si estas políticas se escribieran "por perfil" como el resto, el dueño de un perfil podría listar las suscripciones de quien lo administra y con ellas el `user_agent` y los endpoints de sus dispositivos: información del cuidador, no del titular. El **envío** sí cruza permisos y perfiles, pero ocurre del lado del servidor con `service_role` y nunca con el JWT de un usuario.

### 3.6 `storage_purge_queue` — sin políticas, a propósito

RLS habilitada y **cero políticas**: para `anon` y `authenticated` la tabla no existe a efectos prácticos, y tampoco tienen privilegio de tabla. La alimentan los triggers `documents_encolar_purga_storage`, `insurance_cards_encolar_purga_storage` y `profiles_encolar_purga_storage`, todos `SECURITY DEFINER`, así que el usuario que borra un documento encola su path **sin poder ver la cola ni escribir en ella directamente**. La drena el job del Sprint 6 con `service_role`.

Es la [deuda D5](./modelo-permisos.md#d5-limpieza-de-storage-al-borrar-un-perfil): ningún `CASCADE` de Postgres alcanza a `storage.objects`, así que sin esto un perfil "suprimido" dejaría sus PDF y las fotos de la credencial vivos en los buckets. Es la diferencia entre cumplir el derecho de supresión (Ley 25.326, art. 16) y aparentar cumplirlo. Se eligió la opción de tabla + triggers sobre la de borrado desde la Server Action porque es robusta ante **cualquier** vía de borrado: Studio, SQL directo, `CASCADE` de una baja de cuenta.

---

## 4. Privilegios de tabla

| Rol | `profiles`, `family_permissions` y las 8 de contenido, `push_subscriptions` | `access_logs` | `storage_purge_queue` |
|---|---|---|---|
| `anon` | — | — | — |
| `authenticated` | SELECT, INSERT, UPDATE, DELETE | SELECT, INSERT | — |
| `service_role` | SELECT, INSERT, UPDATE, DELETE (+ `BYPASSRLS`) | idem | idem |

La migración empieza con `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated` y otorga de nuevo solo lo necesario, para que el estado no dependa de los privilegios por defecto que traía el esquema.

**`anon` no tiene una sola fila que deba poder leer.** No hay contenido público en este producto: hasta la ficha SOS, que se lee offline y en una emergencia, sale de un perfil sobre el que hay que estar autenticado.

---

## 5. Cambios de esquema de los que dependen estas políticas

Aplicados en `supabase/migrations/20260812210000_ajustes_modelo.sql`.

| Deuda | Qué se aplicó | Para qué lo usa RLS |
|---|---|---|
| **D1** | `profiles.created_by_profile_id` (+ índice, `ON DELETE SET NULL`) | Condición 3 de `puede_arrancar_administracion()`. Sin ella no hay caso B |
| **D2** | `created_by_profile_id` en las 8 tablas de contenido (+ índices) | **Nada.** Trazabilidad, no autoridad: ninguna política la lee |
| **D4** | Trigger `family_permissions_evitar_huerfano` | Complementa lo que RLS no verifica: el estado global posterior |
| **D5** | Tabla `storage_purge_queue` + 3 triggers `AFTER DELETE` | Hace efectivo el derecho de supresión más allá de Postgres |
| **D8** | `push_subscriptions.profile_id` pasa a `ON DELETE SET NULL` | Evita que borrar un perfil deje sin notificaciones a quien lo administraba |
| **D6** | `consents.document = 'acceso_familiar_representante'` (Sprint 15, tarea 15.1, `20260817220000_perfiles_gestionados.sql`) | No la usa RLS: es el registro probatorio de representación que exige §9.4 de `modelo-permisos.md`, insertado por `crear_perfil_gestionado()` (§2.7) |

**Sobre `created_by_profile_id` (D2).** Ninguna política la lee, pero **se sella igual** con el trigger `sellar_created_by_profile_id` (`BEFORE INSERT OR UPDATE` en las 8 tablas): en el alta se fija con el perfil actor y después es inmutable, para sesiones de usuario. La razón es que trazabilidad falsificable no es trazabilidad: si mañana el producto pide *"quien subió puede corregir su propia carga durante N horas"* —el escenario que la [deuda D2](./modelo-permisos.md#d2-created_by_profile_id-en-las-tablas-de-contenido) anticipa—, la columna tiene que ser confiable **desde el primer día**, porque retro-completarla es imposible.

**Nomenclatura unificada.** La columna se llama `created_by_profile_id` en las nueve tablas que la tienen: las ocho de contenido (D2) y `profiles` (D1). Un concepto, un nombre. El sufijo `_profile_id` no es decorativo: deja explícito que referencia a `public.profiles` y **no** a `auth.users` —dos uuid distintos que conviven en varias tablas de este esquema— y eso se propaga a los tipos TypeScript que genera el CLI.

### Deudas que siguen abiertas

| Deuda | Estado | Mitigación vigente |
|---|---|---|
| **D3** `CHECK` de monotonía de los flags | Abierta | Las políticas de lectura son monótonas: una fila incoherente degrada a "puede ver", no a "escribe a ciegas" |
| **D7** el autorizado debe tener cuenta | Abierta | La fila queda **inerte** (un perfil sin `user_id` nunca coincide con una sesión), pero se ve como un acceso concedido. Debe rechazarlo la Server Action del ABM del Sprint 2 |
| **D9** turnos: `can_upload` cambia `status` | Abierta — decisión del Sprint 6 | Hoy confirmar o cancelar un turno es `can_manage` |

### Limitación conocida que hereda el Sprint 2

La política `profiles_select_visible` implementa la matriz literalmente: se ve el perfil sobre el que hay titularidad o permiso. **La relación inversa no está cubierta:** María, que otorgó acceso a Ana, no puede leer `profiles` de Ana, así que la pantalla *"quién ve mis datos"* recibiría `uuid` sin nombre. No es una fuga —es lo contrario—, pero es una funcionalidad que falta. Se resuelve en el Sprint 2 con una función `SECURITY DEFINER` que devuelva **solo** `id` y `full_name` de los perfiles autorizados sobre los perfiles del actor. No corresponde relajar `profiles_select_visible` para esto: expondría la ficha SOS completa de un cuidador a todas las familias que atiende.

---

## 6. Cómo correr las pruebas

### 6.1 El ciclo completo

```bash
# Requiere Docker corriendo y la instancia local levantada (npx supabase start).
# En Git Bash sobre Windows, agregar Docker al PATH primero:
export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"

# 1. Aplicar las 16 migraciones desde cero
npx supabase db reset

# 2. Correr la suite de aislamiento de las TABLAS (353 casos al cierre del Sprint 15)
docker exec -i supabase_db_historialclinico psql -U postgres -d postgres < scripts/test-rls.sql

# 3. Correr la suite de aislamiento de STORAGE (27 casos, por HTTP)
bash scripts/test-storage-rls.sh
```

`scripts/test-rls.sql` es **idempotente y autolimpiante**: borra los restos de una corrida anterior al empezar y borra todo lo que creó al terminar, después de imprimir el resumen. Se puede correr N veces seguidas sin resetear la base.

### 6.2 Qué imprime

Una tabla de casos con `esperado` / `obtenido` / `PASS|FAIL`, y un veredicto:

```
+-------+------+------+-------------------------+
| casos | pass | fail |        veredicto        |
+-------+------+------+-------------------------+
|    54 |   54 |    0 | TODOS LOS CASOS PASARON |
+-------+------+------+-------------------------+
```

### 6.3 Qué cubre la suite

| Bloque | Casos | Qué demuestra |
|---|---|---|
| **1. sin permiso** | 11 | **Criterio de aceptación:** el usuario B recibe **0 filas** al consultar `documents` de A. Además: `vital_signs`, `profiles`, `access_logs`, `push_subscriptions`, la tabla `documents` completa (fuga global) y `storage_purge_queue`. Contracara: A sí ve lo suyo y lo que administra |
| **2. can_view** | 10 | Lee todo el historial y la ficha SOS; **no** inserta (42501), no edita ni borra (0 filas, sin error), ve solo su fila de `family_permissions` (④) y no ve la lista de accesos (⑪) |
| **3. can_upload** | 7 | Inserta; `created_by_profile_id` queda sellado; **no** corrige ni su propia carga; registra la toma `pending → taken` (⑩) pero **no** puede reprogramarla; no toca `stock_units` (⑨); no otorga permisos (§4.4) |
| **4. can_manage** | 4 | Edita contenido; **no** otorga permisos sobre un perfil con cuenta (⑤ ⚑); **no** borra un perfil con cuenta (③ ⚑); **no** se apropia del perfil cambiando `user_id` (②) |
| **5. auditoría y arranque** | 10 | `access_logs` no admite `UPDATE` ni `DELETE` **ni con el dueño**; no se firma a nombre de otro (⑯); no se renuncia siendo el último administrador (D4); el arranque de un gestionado funciona para su creador y falla para un tercero; borrar un gestionado encola su archivo en la cola de purga (D5) |
| **6. anon** | 4 | Un visitante sin sesión recibe `42501` en `documents`, `profiles`, `access_logs`, y no puede insertar un perfil |
| **7. estructura** | 8 | `pg_tables` sin RLS = **vacío**; solo `storage_purge_queue` sin políticas; **0 políticas que lean `profiles.role`**; 0 funciones sin `search_path`; 0 funciones auxiliares ejecutables por `anon`; 0 privilegios de `anon`; 0 privilegios de `UPDATE`/`DELETE` de `authenticated` en `access_logs`; 0 perfiles gestionados huérfanos |

### 6.4 Cómo se simula una sesión

PostgREST hace dos cosas por request, y el script las reproduce:

```sql
begin;
select set_config('request.jwt.claims',
                  '{"sub":"<uuid de auth.users>","role":"authenticated"}', true);
set local role authenticated;
--  ... consultas ...
commit;   -- SET LOCAL se revierte solo
```

- Se usa `set_config(..., true)` en lugar de `SET LOCAL "request.jwt.claims"` porque el nombre del GUC tiene más de un punto y la sintaxis `SET` no lo acepta de forma portable.
- `auth.uid()` en esta versión lee **primero** `request.jwt.claim.sub` (forma legacy) y, si está vacío, `request.jwt.claims ->> 'sub'`. El script usa la forma moderna, verificada contra PostgreSQL 17.6.
- El arnés de resultados vive en el esquema **`pruebas_rls`**, no en `public`, para no romper el criterio de aceptación mientras la prueba corre.
- Las cuentas de prueba se insertan **directo en `auth.users`**: es una base local y no hay servidor de Auth en el camino.

### 6.5 Verificaciones sueltas

```bash
export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"
PSQL='docker exec supabase_db_historialclinico psql -U postgres -d postgres'

# Criterio de aceptación del Sprint 1
$PSQL -c "select tablename from pg_tables where schemaname='public' and rowsecurity=false;"
# esperado: 0 filas

# Ninguna política puede leer profiles.role (escalada por campo descriptivo)
$PSQL -c "select policyname from pg_policies where schemaname='public'
          and (coalesce(qual,'')||coalesce(with_check,'')) ~* '\mrole\M';"
# esperado: 0 filas

# Inventario de políticas por tabla
$PSQL -c "select tablename, cmd, policyname from pg_policies
          where schemaname='public' order by tablename, cmd;"
```

> El contrato propone verificar esto con `grep -rn "role" supabase/migrations/*rls*.sql`. **Ese grep no sirve tal cual:** el archivo menciona `profiles.role` en su encabezado justamente para documentar la prohibición, y menciona `service_role`, `authenticated` y `enable row level security` decenas de veces. La verificación válida es la consulta a `pg_policies` de arriba, que lee las políticas **ya compiladas por Postgres** y no el texto del archivo. Está automatizada como caso 49 de la suite.

---

## 7. Storage: buckets privados y políticas de objetos

Migración: `supabase/migrations/20260812230000_storage.sql`.

**Por qué esta sección no es un apéndice.** La fila de `documents` la filtra RLS, pero el PDF del análisis vive en un bucket. Si Storage quedara más permisivo que las tablas, el modelo entero es decorativo, porque **el archivo *es* el dato de salud**. Por eso no hay una segunda implementación del modelo de permisos: las políticas de `storage.objects` invocan **las mismas funciones auxiliares** de la §2. Una sola definición, invocada desde dos lugares, que no pueden divergir.

### 7.1 Los tres buckets

| Bucket | Público | Límite por archivo | MIME permitidos | Convención de path |
|---|:--:|---|---|---|
| `documentos-medicos` | **No** | 25 MiB | `application/pdf`, `image/jpeg`, `image/png`, `image/webp` | `{profile_id}/{anio}/{uuid}.{ext}` |
| `credenciales-cobertura` | **No** | 5 MiB | `image/jpeg`, `image/png`, `image/webp` | `{profile_id}/{card_id}/{side}.jpg` |
| `avatares` | **No** | 2 MiB | `image/jpeg`, `image/png`, `image/webp` | `{profile_id}/{uuid}.{ext}` |

Los tres literales son exactamente los que emite `public.encolar_purga_storage()` al encolar en `storage_purge_queue`: si alguno cambiara, hay que actualizar esa función. La prueba lo verifica cruzando la cola contra `storage.buckets`.

Sin PDF en credenciales ni avatares a propósito: la credencial se muestra a pantalla completa para que la lea un lector de códigos, y un PDF no sirve para eso.

### 7.2 El puente: el primer segmento del path es el `profile_id`

```
  documentos-medicos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/a1.pdf
                     └──────────── profile_id ──────────┘
                                    │
                                    ▼
             public.perfil_de_objeto_storage(name) -> uuid | NULL
                                    │
                                    ▼
        puede_ver_perfil() · puede_cargar_en_perfil() · puede_administrar_perfil()
```

`public.perfil_de_objeto_storage(text)` (IMMUTABLE, `search_path = ''`) toma el primer elemento de `storage.foldername(name)` y lo devuelve como `uuid` **sólo si valida contra la expresión regular de uuid**; si no, devuelve `NULL`.

**Por qué el cast tiene que ser tolerante.** Escribir el cast directo parece equivalente y no lo es: un solo objeto cuyo primer segmento no sea un uuid —subido a mano, migrado, o puesto ahí a propósito— hace que el cast levante `22P02 invalid input syntax for type uuid` y **la consulta entera falle**. Dentro de una política eso no es un rechazo prolijo: es un error 500 que rompe el listado de estudios de todos los usuarios del bucket. Devolver `NULL` es además seguro, porque `puede_ver_perfil(NULL)` es `FALSE`: un objeto suelto en la raíz del bucket, o con otra convención de path, queda inaccesible para todo el mundo. Negación por defecto, igual que en las tablas.

### 7.3 Las cinco políticas de `storage.objects`

| Op. | Política | Buckets | Predicado |
|---|---|---|---|
| SELECT | `objetos_select_puede_ver_perfil` | los 3 | `puede_ver_perfil(perfil_de_objeto_storage(name))` |
| INSERT | `objetos_insert_puede_cargar_en_perfil` | documentos, credenciales | `puede_cargar_en_perfil(...)` |
| INSERT | `objetos_insert_avatar_administrador` | avatares | `puede_administrar_perfil(...)` |
| UPDATE | `objetos_update_administrador` | los 3 | `USING` y `WITH CHECK`: `puede_administrar_perfil(...)` |
| DELETE | `objetos_delete_administrador` | los 3 | `puede_administrar_perfil(...)` |

Todas declaran `to authenticated` **explícitamente**, y eso importa más acá que en el esquema `public`: en Storage, `anon` y `authenticated` tienen `GRANT` de SELECT/INSERT/UPDATE/DELETE sobre `storage.objects` a nivel de tabla, así que **RLS es la única capa de protección** y una política sin cláusula `TO` habilitaría también al visitante sin sesión.

**La asimetría del avatar es deliberada.** Subir un avatar exige `can_manage`, no `can_upload`, porque el avatar no es contenido del historial sino un campo de `profiles` (`avatar_storage_path`), y editar `profiles` es administración (nota ②). Aceptar `can_upload` acá dejaría Storage más laxo que la tabla que lo referencia.

**El `WITH CHECK` del UPDATE** impide mover un archivo al prefijo de otro perfil: es la versión Storage de "mover una fila a un `profile_id` ajeno".

### 7.4 Lo que no se tocó, y una consecuencia para el Sprint 6

- **Sin políticas sobre `storage.buckets`.** Tiene RLS y cero políticas, así que ni `anon` ni `authenticated` enumeran los buckets ni leen sus límites. El servicio de Storage resuelve esa metadata con su propia conexión administrativa, de modo que subir y descargar funciona igual: verificado con usuarios reales.
- **Los triggers `protect_objects_delete` / `protect_buckets_delete` quedan como vienen.** Rechazan el `DELETE` por SQL directo. Son un anti-footgun, no una frontera de seguridad (se destraban con el GUC `storage.allow_delete_query`), pero tienen una consecuencia práctica: **el job que drene `storage_purge_queue` tiene que borrar por la Storage API**, no con un `DELETE` contra `storage.objects`, porque el borrado por SQL deja el archivo físico huérfano en el backend. `borrarObjeto()` de `lib/storage-admin.ts` ya usa la API por ese motivo.

### 7.5 `lib/storage-admin.ts`

Helper server-side con `SUPABASE_SERVICE_ROLE_KEY`. Exporta `crearSignedUrl(bucket, path, segundos)` y `borrarObjeto(bucket, path)`.

- **Se llama `storage-admin` y no `storage` a propósito:** que el nombre del import grite lo que es. Aborta al cargarse si detecta `window`, para que un import accidental desde un Client Component falle fuerte en vez de filtrar la clave al bundle.
- **No autoriza nada.** Usa `service_role`, que tiene `BYPASSRLS`: firma cualquier path que se le pase. El orden correcto es (1) leer la fila con el cliente **del usuario**, que sí pasa por RLS —si la fila aparece, el permiso está verificado—, (2) recién entonces pedir la signed URL, (3) auditar con `descargar_archivo`.
- **TTL acotado a 300 s** (default 60). No es un número arbitrario: es la única ventana real de exposición después de una revocación, porque una signed URL ya emitida sigue sirviendo el archivo sin volver a consultar la base ([§8.1 del contrato](./modelo-permisos.md#81-revocación)).

### 7.6 Evidencia

Verificado contra el stack local con `curl` y JWT de usuario firmados con el secreto local:

| Comprobación | Resultado |
|---|---|
| `GET` anónimo a la URL pública del objeto | `HTTP 400` — `NoSuchBucket` (el bucket privado ni siquiera se revela) |
| `GET` con la anon key al endpoint autenticado | `HTTP 400` — `NoSuchKey` (RLS filtra: indistinguible de inexistente) |
| Signed URL de 60 s | `HTTP 200`, contenido byte-a-byte idéntico al subido |
| La misma signed URL con `expiresIn: 1`, pasados ~4 s | `HTTP 400` — `InvalidJWT`, `"exp" claim timestamp check failed` |
| `scripts/test-storage-rls.sh` (27 casos con usuarios reales) | **27 PASS / 0 FAIL** |

---

## 8. Lo que estas políticas NO protegen

RLS filtra filas de Postgres. Tres cosas quedan afuera **por construcción** y necesitan su propia capa:

1. ~~**Los archivos.**~~ **Ya cubierto:** ver [§7, Storage](#7-storage-buckets-privados-y-políticas-de-objetos). Los cuatro buckets son privados. Tres de ellos tienen políticas de `storage.objects` que invocan las mismas funciones auxiliares que las tablas; el cuarto, `compartidos-temp` (11.2), no tiene ninguna a propósito: sin una política que lo nombre, el cliente no puede leerlo ni escribirlo.
2. **La ventana post-revocación.** Borrar la fila de `family_permissions` corta el acceso **de inmediato** para toda consulta nueva, pero las signed URLs ya emitidas siguen sirviendo el archivo hasta que expiren, y el cache del service worker sigue en el dispositivo. De ahí el TTL corto (60–300 s) y la purga de cache al perder el permiso ([§8.1](./modelo-permisos.md#81-revocación)).
3. **`service_role`.** Tiene `BYPASSRLS`: para él estas políticas no existen. Toda la protección es que la `SERVICE_ROLE_KEY` no salga del servidor. **Auditado** en el Sprint 11 (tarea 11.4): ver [`auditoria-seguridad.md`](./auditoria-seguridad.md) §5 — cero apariciones en `components/`, cero en el bundle del cliente, y una guarda que lanza en los seis módulos que la usan si se los carga en el navegador.
