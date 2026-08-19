# Auditoría de seguridad de RLS y Storage — Historial Médico

> **Qué es este documento:** el informe de la tarea 11.4 del Sprint 11. Revisa, objeto por objeto, que lo que declara [`modelo-permisos.md`](./modelo-permisos.md) (el contrato) y lo que describe [`seguridad-rls.md`](./seguridad-rls.md) (la implementación) sea lo que la base y la aplicación **hacen realmente hoy**.
> **Fecha:** 2026-08-14 · **Motor:** PostgreSQL 17.6 (Supabase local, contenedor `supabase_db_historialclinico`) · **App:** Next.js 16.3.0.
> **Veredicto: SIN hallazgos abiertos de severidad alta.** Tres hallazgos (uno medio, dos bajos) — **los tres corregidos en esta misma tarea**. Cuatro observaciones verificadas que NO son hallazgos, documentadas en §7 para que la próxima auditoría no las vuelva a investigar desde cero.

---

## 1. Metodología

La auditoría **no lee migraciones para deducir el estado**: consulta el catálogo del motor, que es lo que el motor efectivamente aplica. Una migración puede haber sido revertida, pisada por otra o corregida a mano; `pg_policies` no miente. Las migraciones se usaron solo para entender la *intención* declarada, y cada vez que la intención escrita y el catálogo no coincidieron, eso mismo fue el hallazgo.

Cuatro fuentes de evidencia, en orden de fuerza:

| # | Fuente | Qué demuestra | Por qué no alcanza sola |
|---|---|---|---|
| 1 | **Catálogo del motor** (`pg_policies`, `information_schema.role_table_grants`, `pg_proc`, `storage.buckets`) | Qué reglas existen | No dice si las reglas *deciden* lo que uno cree |
| 2 | **Arnés `scripts/test-rls.sql`** (253 casos) | Que las reglas deciden lo esperado, simulando sesiones reales (`request.jwt.claims` + `set local role`) | Corre dentro de la base: no prueba el camino HTTP |
| 3 | **Arnés `scripts/test-storage-rls.sh`** (27 casos) | Lo mismo para Storage, por HTTP contra la API real con JWT firmados | Cubre Storage, no las rutas de la app |
| 4 | **Batería activa de acceso cruzado** (§6) | Que la aplicación entera —proxy, guardas, Route Handlers, RLS— niega el acceso ajeno con sesiones reales del seed contra el dev server | Es puntual: no reemplaza a 2 y 3, los confirma de punta a punta |

**El canario.** Para la batería activa se sembraron datos de María marcados con la cadena `CANARIO-AUDITORIA-114` (un documento, una credencial, un archivo temporal compartido y una alergia en su ficha SOS), y cada respuesta obtenida con la sesión de Diego se revisó buscando esa cadena. No basta con mirar el código HTTP: un `200` que igual filtra el dato sería el peor resultado posible y un status no lo delata. Los fixtures se eliminaron al terminar (§6.5).

**Desvío respecto del artefacto declarado en el roadmap.** El roadmap pedía `tests/seguridad/rls.test.ts` (vitest). No se creó, a propósito: RLS es una decisión del motor de Postgres sobre un rol concreto, y un test en Node solo puede observarla a través de un cliente. Reproducirla en vitest exigiría mockear lo único que importa —el motor— o levantar la base igual, que es lo que ya hacen los arneses 2 y 3 con **280 casos** contra el motor y la API reales. El criterio de aceptación ("los tests demuestran 0 filas devueltas en todos los intentos cruzados") se cumple con ellos más la batería de §6. Sí se agregó un test de vitest donde vitest es la herramienta correcta: `tests/unit/sesion-inservible.test.ts`, sobre lógica pura (§5.3).

### Cómo reproducir esta auditoría

```bash
export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"
npx supabase db reset                                                   # 16 migraciones + seed
docker exec -i supabase_db_historialclinico psql -U postgres -d postgres \
    -v ON_ERROR_STOP=1 < scripts/test-rls.sql                           # 253 casos
bash scripts/test-storage-rls.sh                                        # 27 casos
npx supabase db lint --level warning                                    # 0 hallazgos
npm run test && npx tsc --noEmit && npx eslint && npx next build
node scripts/verificar-contraste.mjs
```

---

## 2. Inventario auditado

Todo lo de abajo salió del catálogo del motor **después** de un `npx supabase db reset` limpio con las 16 migraciones aplicadas.

```
tablas=19  con_rls=19  politicas=60  vistas=1  funciones=39  triggers=28
buckets=4  (los 4 privados)  politicas_storage_objects=5
```

### 2.1 Las 19 tablas de `public` (política count entre paréntesis)

| Tabla | Pol. | Privilegios de `authenticated` | Nota |
|---|---|---|---|
| `profiles` | 4 | S/I/U/D | |
| `family_permissions` | 6 | S/I/U/D | 2 de INSERT: la general y la de arranque de gestionado |
| `doctors` · `documents` · `lab_metrics` · `appointments` · `medications` · `vital_signs` · `insurance_cards` | 4 c/u | S/I/U/D | Matriz estándar ver/cargar/administrar |
| `medication_intakes` | 5 | S/I/U/D | La 5ª acota el registro de la toma (`pending` → `taken`/`skipped`) |
| `vital_sign_thresholds` | 4 | S/I/U/D | |
| `push_subscriptions` | 4 | S/I/U/D | Por `user_id`, no por perfil |
| `access_logs` | 2 | **S/I** | Append-only por privilegio, no por ausencia de política |
| `consultation_sheets` | 2 | **S/I** | Append-only. **Corregido en esta auditoría** (§4.1) |
| `shared_uploads_temp` | 2 | **S/D** | Nace con `service_role`; nunca se edita |
| `vital_sign_alerts` | 2 | **S** + `UPDATE (acknowledged_at)` | Único privilegio **de columna** del proyecto |
| `medication_renewal_alerts` | 1 | **S** | Solo lectura para el administrador |
| `appointment_reminders` | **0** | **ninguno** | Infraestructura: solo `pg_cron`/`service_role` |
| `storage_purge_queue` | **0** | **ninguno** | Infraestructura: solo triggers `SECURITY DEFINER` |

`select tablename from pg_tables where schemaname='public' and rowsecurity=false;` → **0 filas**.
`select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon';` → **0**. `anon` no tiene ni un `SELECT` sobre el dominio.

Las dos tablas con **cero políticas** son deliberadas y el BLOQUE 7 del arnés vigila que sigan siendo exactamente esas dos: si aparece una tercera, es un olvido de políticas y el caso falla.

### 2.2 Vistas

Una: `v_medicacion_estado`, con `reloptions = {security_invoker=true}`. Es el punto crítico de cualquier vista sobre tablas con RLS: sin `security_invoker`, la vista corre con los permisos de su **dueño** (`postgres`, que tiene `BYPASSRLS`) y se convierte en un túnel que devuelve todas las filas a cualquiera con `SELECT` sobre la vista. Verificado: está en modo invocador, así que las políticas de las tablas subyacentes se evalúan con la sesión que consulta.

### 2.3 Funciones

Las 39 funciones de `public` tienen `search_path` fijado — verificado con la consulta que usa el propio arnés:

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.prokind='f'
   and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search\_path=%');
-- 0
```

Se revisó una por una la combinación *seguridad × quién puede ejecutarla*:

- **29 `SECURITY DEFINER`.** Cada una está justificada: las 8 auxiliares de RLS existen para cortar la recursión `42P17` ([`seguridad-rls.md`](./seguridad-rls.md) §2), las RPC transaccionales (`registrar_toma`, `revertir_toma`, `confirmar_documento_recien_subido`, …) para que la invariante viva en una sola transacción, y las de barrido (`generar_tomas_del_dia`, `disparar_*`, `reclamar_*`) porque las ejecuta `pg_cron`.
- **10 `SECURITY INVOKER`.** Ocho son funciones de trigger; las dos restantes son `es_sesion_de_usuario()` —invocador **a propósito**, porque dentro de un `DEFINER` el `current_user` es `postgres` y la guarda nunca dispararía— y `perfil_de_objeto_storage()`, que solo parsea un texto.
- **`EXECUTE` mínimo.** Ninguna función auxiliar ni RPC es ejecutable por `anon`: el ACL de cada una lista `postgres`, `authenticated` y/o `service_role`, nunca `PUBLIC`. Las 10 que **sí** conservan `EXECUTE` para `PUBLIC` son, todas, **funciones de trigger** (`returns trigger`): Postgres rechaza invocarlas directamente y PostgREST no las expone, así que el privilegio no es alcanzable. Verificado explícitamente con `pg_get_function_result`, no asumido.
- Las funciones de barrido (`disparar_*`, `configurar_cron_*`) no tienen `EXECUTE` ni siquiera para `authenticated`: solo `postgres` y, donde corresponde, `service_role`.

`npx supabase db lint --level warning` → `No schema errors found`.

### 2.4 Buckets y Storage

| Bucket | Público | Límite | MIME permitidos | Políticas que lo nombran |
|---|---|---|---|---|
| `documentos-medicos` | **no** | 25 MiB | pdf, jpeg, png, webp | 4 (select/insert/update/delete) |
| `credenciales-cobertura` | **no** | 5 MiB | jpeg, png, webp | 4 |
| `avatares` | **no** | 2 MiB | jpeg, png, webp | 4 (insert exige `can_manage`) |
| `compartidos-temp` | **no** | 25 MiB | pdf, jpeg, png, webp | **0 — negación por defecto** |

`select count(*) from storage.buckets where public;` → **0**. Los cuatro son privados.

Las 5 políticas de `storage.objects` filtran por `bucket_id = ANY(ARRAY['documentos-medicos','credenciales-cobertura','avatares'])` y resuelven el perfil con `perfil_de_objeto_storage(name)` (el primer segmento del path). `compartidos-temp` no aparece en ninguna: por eso el cliente no puede leer, subir ni borrar ahí, sin que haga falta escribir una sola regla. Se verificó por HTTP, no por lectura del SQL (§4.3 y BLOQUE 7 de la suite de Storage).

**Signed URLs.** `lib/storage-admin.ts` acota la vida de la firma en el código, no en cada llamador: `TTL_DEFAULT_SEGUNDOS = 60`, `TTL_MAXIMO_SEGUNDOS = 300`, y `crearSignedUrl` **lanza** si le piden un valor fuera de `[1, 300]`. Ningún llamador puede pedir una URL de una hora aunque se equivoque. En uso: 300 s para el visor a pantalla completa, 60 s para las miniaturas de credenciales.

**El endpoint estable de imagen de credencial** (`app/api/credenciales/[id]/imagen/route.ts`) es el único que sirve el byte del archivo en vez de una URL firmada, y sigue el orden correcto en tres pasos: (1) `requerirSesion`, (2) leer la fila de `insurance_cards` **con el cliente del usuario**, de modo que RLS decide si esa credencial es visible, y (3) recién entonces bajar el objeto con `service_role`, usando un `path` que salió de una fila que RLS ya dejó pasar. Nunca se usa el `id` de la URL para construir un path. Responde con `Cache-Control: private, no-cache` y `X-Content-Type-Options: nosniff`. Mismo patrón, verificado, en `/compartir` para el bucket temporal.

### 2.5 Triggers de protección

30 triggers activos (`tgenabled='O'`, ninguno deshabilitado): 29 en `public` y uno sobre `auth.users`. Los que cubren lo que RLS no puede expresar:

| Trigger | Tabla | Qué hace cumplir |
|---|---|---|
| `profiles_proteger_titularidad` | `profiles` | `user_id` inmutable desde una sesión de usuario |
| `profiles_proteger_densidad` | `profiles` | El tamaño de letra lo cambia solo el titular de la fila |
| `auth_users_crear_perfil_de_cuenta` | `auth.users` | Toda cuenta nueva nace con perfil propio y consentimiento registrado |
| `*_sellar_created_by_profile_id` (7) | 7 tablas | El autor lo pone la base, no el cliente |
| `medication_intakes_proteger_programacion` | `medication_intakes` | No se reprograma una toma |
| `family_permissions_evitar_huerfano` | `family_permissions` | Ningún perfil gestionado queda sin administrador |
| `vital_sign_alerts_sellar_visto` | `vital_sign_alerts` | `acknowledged_at`/`by` sellados e inmutables |
| `*_encolar_purga_storage` (3) | `documents`, `insurance_cards`, `profiles` | El objeto huérfano queda encolado |

`auth_users_crear_perfil_de_cuenta` es la excepción deliberada al patrón: es el único trigger del proyecto que corre como **definer**, porque no es una guarda contra una sesión de usuario sino todo lo contrario — dispara cuando **no hay** sesión (el alta con confirmación por correo), y tiene que poder escribir en `profiles` y `consents` sin un `auth.uid()` que satisfaga sus políticas de INSERT. Ver el encabezado de `supabase/migrations/20260814140000_alta_de_cuenta.sql`.

Los tres que dependen de `es_sesion_de_usuario()` corren como **invocador**, que es la condición para que la guarda funcione (si fueran `DEFINER`, `current_user` sería siempre `postgres` y los triggers quedarían silenciosamente desactivados — el bug documentado en [`seguridad-rls.md`](./seguridad-rls.md) §2.5). Verificado en el catálogo: `proteger_titularidad_de_perfil`, `proteger_programacion_de_toma` y `sellar_created_by_profile_id` son `SECURITY INVOKER`.

### 2.6 `access_logs` es append-only

- `authenticated` tiene **solo** `SELECT` e `INSERT`. No hay `UPDATE` ni `DELETE` que revocar en tiempo de ejecución: el privilegio no existe.
- Sus dos políticas son de `SELECT` e `INSERT`. La de INSERT exige `actor_user_id = auth.uid()`: nadie puede escribir un acceso a nombre de otro.
- La de SELECT (`actor_user_id = auth.uid() OR puede_otorgar_permisos(profile_id)`) es la que permite al titular ver quién entró a sus datos.
- El BLOQUE 7 del arnés tiene una aserción dedicada desde el Sprint 1 que falla si alguien vuelve a conceder `UPDATE` o `DELETE`.

---

## 3. Hallazgos

| # | Severidad | Título | Estado |
|---|---|---|---|
| A-01 | **Media** | `consultation_sheets` concede `UPDATE`/`DELETE` sin política que los use | **Corregido** |
| A-02 | Baja | Las políticas de `shared_uploads_temp` llaman a `auth.uid()` sin envolver | **Corregido** |
| A-03 | Baja | La respuesta `401` de los Route Handlers descartaba el borrado de la cookie inservible | **Corregido** |
| A-04 | Baja | `seguridad-rls.md` describía un inventario de tres sprints atrás | **Corregido** |
| A-05 | Informativa | El enum `access_action` no tiene `subir_documento` | **Documentado, sin acción** |

**Ningún hallazgo de severidad alta, abierto ni cerrado.** Ninguno de los cinco es una fuga de datos: los tres primeros son desviaciones respecto de lo que el propio proyecto declara, que hoy no se explotan porque una segunda capa las tapa. Se corrigen igual, porque una defensa que quedó sostenida por una sola capa deja de avisar cuando esa capa se cae.

---

## 4. Hallazgos en detalle

### 4.1 A-01 (media) — `consultation_sheets` concedía `UPDATE` y `DELETE` a `authenticated`

**Qué se encontró.** El encabezado de `supabase/migrations/20260814090000_fichas.sql` declara textualmente:

> `· UPDATE ni DELETE: es un documento emitido. Cambió de opinión o hay un error → regenera (inserta una fila nueva). Esto mantiene el historial exacto de lo que se generó y cuándo.`

y 50 líneas más abajo ejecuta `grant select, insert, update, delete on public.consultation_sheets to authenticated`. El catálogo lo confirmaba:

```
$ psql -Atc "select privilege_type from information_schema.role_table_grants
             where table_name='consultation_sheets' and grantee='authenticated'"
DELETE
INSERT
SELECT
UPDATE
```

**Por qué importa, y por qué no es alta.** No hay fuga hoy: no existe política de `UPDATE` ni de `DELETE` sobre la tabla, así que RLS filtra cero filas y las dos operaciones no tocan nada (lo verificaba ya el BLOQUE 15 del arnés). Pero la inmutabilidad de una **ficha clínica emitida** —el documento que alguien imprime y le lleva al médico— quedaba sostenida por una sola capa, y por la más frágil: la **ausencia** de una política. Alcanza con que una migración futura agregue un `for all` o un `for update` amplio sobre la tabla para que el privilegio ya concedido se vuelva efectivo, sin que nadie note que se está habilitando la reescritura de un documento emitido. El modelo que declara [`seguridad-rls.md`](./seguridad-rls.md) §1 es de tres capas que "dicen lo mismo a propósito"; acá la capa 1 decía otra cosa.

El propio proyecto ya tenía el patrón correcto a la vista: `access_logs` es append-only **porque `authenticated` no tiene el privilegio**, no porque falte la política, y el BLOQUE 7 lo vigila desde el Sprint 1.

**Corrección** (`supabase/migrations/20260814110000_auditoria_seguridad.sql`):

```sql
revoke update, delete on public.consultation_sheets from authenticated;
```

**Evidencia después del `db reset`:**

```
$ psql -Atc "...grantee='authenticated'"   → INSERT, SELECT
```

**Efecto observable.** Un `UPDATE`/`DELETE` del cliente pasa de "afecta 0 filas en silencio" a `42501 insufficient_privilege`. Ningún código de la aplicación hace `UPDATE` ni `DELETE` sobre esta tabla (`grep -rn "consultation_sheets" lib/ app/` no tiene un solo `.update(` ni `.delete(`), así que no hubo nada que adaptar. Sí hubo que adaptar **el arnés**: los dos casos del BLOQUE 15 ejecutaban las sentencias sueltas y ahora lanzan excepción, que con `ON_ERROR_STOP` habría tumbado la suite entera — la misma trampa que se cobró el BLOQUE 15 en la auditoría 10.5. Se movieron a `do`-block y se agregaron dos casos que verifican la forma del rechazo, más un centinela de privilegio calcado del de `access_logs`.

### 4.2 A-02 (baja) — `auth.uid()` sin envolver en las políticas de `shared_uploads_temp`

**Qué se encontró.** Las dos políticas de la tabla del Sprint 11 usaban `using (user_id = auth.uid())`. Las otras 58 del proyecto usan `(select auth.uid())`.

**Por qué no es de seguridad.** El predicado decide exactamente lo mismo. La diferencia es de **plan**: sin el `select`, Postgres trata a `auth.uid()` como expresión correlacionada y la reevalúa una vez por fila examinada; con el `select` la convierte en un InitPlan que corre una sola vez por sentencia. Es el patrón `auth_rls_initplan` del linter de Supabase, y la convención que [`seguridad-rls.md`](./seguridad-rls.md) §2.3 ya declara para las funciones auxiliares.

**Por qué se corrige igual.** Una excepción sin motivo a una convención de seguridad es exactamente lo que hace que la próxima persona no sepa cuál de las dos formas es la correcta.

**Corrección** (misma migración, con `alter policy` para no dejar a la tabla sin regla ni un instante):

```sql
alter policy shared_uploads_temp_select_propio on public.shared_uploads_temp
    using (user_id = (select auth.uid()));
alter policy shared_uploads_temp_delete_propio on public.shared_uploads_temp
    using (user_id = (select auth.uid()));
```

**Evidencia:** `pg_policies` ahora devuelve `(user_id = ( SELECT auth.uid() AS uid))` para las dos.

### 4.3 A-03 (baja) — la respuesta `401` de los Route Handlers descartaba el borrado de la cookie inservible

Este hallazgo salió de investigar el ruido de log que había reportado el orquestador: `refresh_token_not_found` imprimiendo un stack trace por request desde pestañas con cookies viejas. La causa resultó ser más interesante que el síntoma.

**Reproducción.** Sesión real del seed → `signOut()` (que revoca el refresh token) → se arma la cookie que quedaría en una pestaña que no se enteró (access token vencido + refresh token revocado) → se pega contra el dev server:

```
$ curl -D - -o /dev/null -H "Cookie: sb-127-auth-token=<vieja>" localhost:3000/perfiles
HTTP/1.1 307 Temporary Redirect
location: /login?desde=%2Fperfiles
set-cookie: sb-127-auth-token=; Path=/; Max-Age=0; SameSite=lax      ← se limpia

$ curl -D - -o /dev/null -H "Cookie: sb-127-auth-token=<vieja>" localhost:3000/api/sos/<perfil>
HTTP/1.1 401 Unauthorized
                                                                      ← NO se limpia
```

**La causa.** `@supabase/auth-js` detecta el token muerto, borra la cookie y ese borrado viaja en la respuesta que arma `actualizarSesion`. `proxy.ts` la conservaba en las redirecciones (`redirigirConservandoCookies`) pero **no** en la rama de `/api`, que devolvía un `NextResponse.json` nuevo y tiraba las cookies — el mismo error que el propio archivo advierte en sus comentarios para el caso del token refrescado.

**La consecuencia.** Un cliente que pega contra `/api` —el service worker, un `fetch` en reintento, la PWA en segundo plano— conservaba la cookie muerta **para siempre** y le pedía a GoTrue que la refrescara en cada request: tráfico contra el servidor de Auth sin ningún propósito, y dos stack traces por request tapando errores de verdad. No es una fuga (la respuesta es `401`, correcta), pero un log en el que el ruido esperado supera a las señales es un problema de seguridad por otra vía: nadie encuentra el incidente cuando ocurra.

**Corrección.**

1. `proxy.ts`: se extrajo `conCookiesDe(destino, respuestaConCookies)` y se aplica también a la respuesta `401`.
2. `lib/supabase/proxy.ts`: se captura el error de `getUser()` y, cuando su código es uno de los que significan "esta cookie ya no sirve", se anota **una línea `info`** que explica de dónde salió el `AuthApiError` que imprime la librería. `AuthSessionMissingError` (el visitante anónimo, sin cookie) **no** se registra: llenaría el log.

No se parchea `console`. Sería la única forma de silenciar el stack de la librería, y exige tocar un global compartido por todas las requests en vuelo: el riesgo de tragarse un error ajeno es peor que el ruido. La decisión está escrita en el código, no solo acá.

**Evidencia — cuatro requests seguidas con la misma cookie muerta, usando un cookie jar como haría un navegador:**

```
req 1 → 401     req 2 → 401     req 3 → 401     req 4 → 401
```
```
{"level":"WARN","message":"AuthApiError: Invalid Refresh Token: Refresh Token Not Found"}
{"level":"WARN","message":"AuthApiError: Invalid Refresh Token: Refresh Token Not Found"}
{"level":"INFO","message":"[auth] Cookie de sesión inservible (refresh_token_not_found) en
 /api/sos/…: se responde sin sesión y se limpia la cookie. Flujo normal, no es un error."}
```

**Tres líneas en total para cuatro requests** — antes eran ocho stack traces, y seguían saliendo indefinidamente. La cookie desaparece del jar después de la primera. Una request **sin** cookie no produce ni una línea (verificado como control).

**El predicado quedó cubierto por tests** (`tests/unit/sesion-inservible.test.ts`, 9 casos), porque es una frontera de seguridad: los cuatro códigos que se degradan a `info` son `refresh_token_not_found`, `refresh_token_already_used`, `session_expired` y `validation_failed` **solo si el mensaje habla del refresh token** (es lo que GoTrue devuelve ante una cookie corrupta o manipulada). Los casos negativos son el contrato: `invalid_credentials`, `over_request_rate_limit`, `unexpected_failure`, un `validation_failed` que habla de otra cosa y un error sin código **no** se degradan. Un predicado que se ensancha sin querer convierte al proxy en un silenciador de problemas reales de Auth, y nada en la aplicación lo delataría.

### 4.4 A-04 (baja) — `seguridad-rls.md` describía un inventario de tres sprints atrás

El documento declaraba "13 tablas con RLS habilitada, 49 políticas, 3 buckets privados con 5 políticas, 10 funciones auxiliares" y "66 casos, 66 PASS". El estado real es **19 tablas, 60 políticas, 4 buckets, 39 funciones** y **253 casos**. La deriva es de los Sprints 9, 10 y 11, que agregaron tablas sin actualizar el resumen.

No es cosmético: ese documento es el que una auditoría usa como mapa, y un mapa que dice "13 tablas" hace que se auditen 13. Corregido, con la sección de estado ahora apuntando a este informe. Se agregó además la fila de `shared_uploads_temp` y del bucket `compartidos-temp` a los inventarios.

### 4.5 A-05 (informativa) — el enum `access_action` no tiene `subir_documento`

**Verificado:** el enum tiene 9 literales (`login`, `logout`, `ver_perfil`, `ver_documento`, `descargar_archivo`, `ver_credencial`, `exportar_ficha`, `otorgar_permiso`, `revocar_permiso`). Se cruzó cada uso de `ACCION.*` y de `registrarAcceso(` en `lib/` y `app/` contra esa lista: **todos los literales que el código usa existen en el enum**. No hay ninguna llamada que fuera a fallar en tiempo de ejecución.

`subir_documento` no existe, y es **deuda declarada, no un olvido**: está documentada en tres lugares del código antes de esta auditoría (`lib/auditoria.ts` §"Deuda declarada", `lib/documentos/ingesta.ts` y `app/(app)/(con-nav)/inicio/actions.ts`), que explican que la subida no se audita hoy. Como no hay ningún uso, **no corresponde una migración `ALTER TYPE ADD VALUE`**: agregar un literal que nadie escribe solo mueve la deuda de un archivo a otro. Queda documentado acá para que el sprint que decida auditar la subida sepa que la migración es el primer paso.

Lo mismo aplica a `otorgar_permiso` y `revocar_permiso`: existen en el enum y todavía no los escribe nadie. Es deuda en el sentido inverso (literal sin uso), inofensiva.

---

## 5. Secretos y separación servidor / cliente

### 5.1 `SERVICE_ROLE` fuera del cliente

**Criterio (para no quedar desactualizado):** cualquier archivo de `lib/` o `app/` que referencie `SUPABASE_SERVICE_ROLE_KEY` tiene que ser, o bien (a) un módulo de `lib/` con encabezado que declara el uso de la clave **y** una guarda que lanza si se carga en el navegador (`if (typeof window !== "undefined") throw …`), o bien (b) un Route Handler (`app/**/route.ts`): por convención de Next.js corre exclusivamente en el servidor —nunca se importa desde un Client Component, se invoca solo por HTTP— así que no necesita la guarda aunque sí conviene, y ya se usa, declarar `export const runtime = "nodejs"`. La próxima auditoría regenera este censo con:

```bash
grep -rln "SUPABASE_SERVICE_ROLE_KEY" lib/ app/
```

**Censo verificado el 2026-08-19 (tarea de higiene post-11.4): 17 archivos, 15 en `lib/` + 2 en `app/`.**

| Módulo | Guarda de navegador |
|---|---|
| `lib/auth/cuentas-admin.ts` | ✅ |
| `lib/documentos/compartir-temporal-admin.ts` | ✅ |
| `lib/documentos/extraccion-admin.ts` | ✅ |
| `lib/documentos/huella-admin.ts` | ✅ |
| `lib/gmail/auto-ingesta-admin.ts` | ✅ |
| `lib/gmail/conexiones-admin.ts` | ✅ |
| `lib/gmail/duplicados-semanticos-admin.ts` | ✅ |
| `lib/gmail/mensajes-admin.ts` | ✅ |
| `lib/gmail/pendientes-admin.ts` | ✅ |
| `lib/lugares/sincronizacion.ts` | ✅ (le faltaba; agregada en esta tarea) |
| `lib/medicacion/generar-tomas-admin.ts` | ✅ |
| `lib/push/servidor.ts` | ✅ (le faltaba; agregada en esta tarea) |
| `lib/signos/notificar.ts` | ✅ |
| `lib/signos/registrar-alertas.ts` | ✅ |
| `lib/storage-admin.ts` | ✅ |
| `app/api/push/procesar-alertas-medicacion/route.ts` | N/D — Route Handler, ver criterio (b) |
| `app/api/push/procesar-recordatorios/route.ts` | N/D — Route Handler, ver criterio (b) |

```
$ grep -n "SERVICE_ROLE" app/api/push/procesar-alertas-medicacion/route.ts app/api/push/procesar-recordatorios/route.ts
app/api/push/procesar-alertas-medicacion/route.ts:118,122
app/api/push/procesar-recordatorios/route.ts:127,131
```

**Cero coincidencias en `components/`.** Los dos de `app/` son Route Handlers de los barridos de `pg_cron` — código de servidor por definición, sin `"use client"`, con `runtime = "nodejs"`.

Los 15 módulos de `lib/` llevan la misma defensa: encabezado que declara el uso de la clave, y una guarda que **lanza** si el módulo se carga en el navegador. Esta tarea encontró dos que se habían quedado sin ella —`lib/lugares/sincronizacion.ts` y `lib/push/servidor.ts`, ambos posteriores a la auditoría 11.4— y les agregó la guarda con el mismo patrón que las otras 13. Se recorrieron los **74 archivos con `"use client"`** del proyecto: ninguno importa un módulo server-only, y ninguno referencia una variable de entorno que no empiece con `NEXT_PUBLIC_`.

### 5.2 El bundle del cliente

Tras `npx next build`, sobre los 55 archivos JS de `.next/static/`:

| Patrón buscado | Coincidencias |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 0 |
| `service_role` | 0 |
| `sb_secret_` | 0 |
| `VAPID_PRIVATE_KEY` | 0 |
| `GEMINI_API_KEY` | 0 |
| `CRON_SECRET` / `x-cron-secret` | 0 |

No solo no está el valor: **no está ni el nombre de la variable**, que es lo que confirma que ningún módulo servidor fue arrastrado al grafo del cliente.

### 5.3 El árbol actual

Barrido de `eyJ[A-Za-z0-9_-]{10,}` (JWT), `sb_secret_`, `sb_publishable_`, `AIza[…]` (Google) y `[a-z0-9]{20}\.supabase\.co` sobre todo el repo excluyendo `node_modules`, `.next` y `.git`: los únicos JWT del árbol están en `scripts/separar-claves-cloud.mjs`, y son las **claves demo del Supabase CLI local** —las mismas que `npx supabase status` imprime en cualquier máquina—, no credenciales.

`git ls-files | grep -i env` → **solo `.env.example`**. Y:

```
$ git check-ignore -v .env.local .env.cloud-respaldo .env.development.local
.gitignore:34:.env*    .env.local
.gitignore:34:.env*    .env.cloud-respaldo
.gitignore:34:.env*    .env.development.local
```

Los tres ignorados por la regla `.env*` con la excepción `!.env.example`. **`.env.cloud-respaldo` está git-ignoreado**, como pedía el criterio.

La referencia a la URL del proyecto cloud en `docs/entorno.md` **no es un hallazgo**: la URL del proyecto es pública por diseño (viaja en el bundle como `NEXT_PUBLIC_SUPABASE_URL` y en cada request del navegador). Lo que hay que proteger es la `service_role`, y no está.

---

## 6. Pruebas activas de acceso cruzado

Sesiones reales del seed contra el dev server (`http://localhost:3000`), con cookies emitidas por `@supabase/ssr` (no falsificadas: se generaron con `signInWithPassword` real). El reparto del seed: **Diego** tiene `can_view` sobre Roberto y **nada** sobre María; **María** administra a Roberto.

Cada respuesta se revisó buscando la cadena `CANARIO-AUDITORIA-114`, sembrada en los datos de María.

### 6.1 Vector 1 — IDOR por `perfilId` en la URL

| Caso | Resultado | Canario |
|---|---|---|
| Diego → `/api/sos/<perfil de María>` | **403** `No tenés permiso para ver los datos de este perfil.` | 0 |
| Diego → `/api/sos/<uuid inexistente>` | **403**, **respuesta idéntica** | 0 |
| Diego → `/api/sos/<Roberto>` (legítimo) | 200 | 0 |
| María → `/api/sos/<su perfil>` (control) | 200 | **1** |

La igualdad entre "ajeno" e "inexistente" es lo que impide usar el endpoint como oráculo para enumerar perfiles. El control positivo demuestra que el canario **sí** aparece cuando corresponde: sin él, un `403` universal por un bug podría pasar por seguridad.

### 6.2 Vector 2 — cookie `perfil_activo` forjada

La cookie es `httpOnly`, pero eso solo la protege del JavaScript de la página: quien controla su navegador puede escribirla. Se forjó apuntando al perfil de María y se navegó con la sesión de Diego:

| Ruta | Resultado | Canario | "María Gómez" |
|---|---|---|---|
| `/inicio`, `/estudios`, `/signos`, `/medicacion`, `/coberturas`, `/sos` | **307 → `/perfiles`** en las 6 | 0 | 0 |
| Control: mismas rutas con `perfil_activo=<Roberto>` | 200, con datos de Roberto | — | — |

`obtenerPerfilActivo()` revalida `requerirPermiso(perfilId, "view")` contra la base en **cada** llamada y limpia la cookie forjada. No se sirve la pantalla ni por un instante.

Mismo vector contra los endpoints que derivan el perfil de esa cookie:

| Endpoint | Con cookie forjada a María | Legítimo |
|---|---|---|
| `/api/signos/export?tipo=tension` | **403** | 200 + CSV de Roberto / de María |
| `/api/ficha/generar` | **403** | 403 también para Roberto: Diego solo tiene `can_view` y generar exige `upload` |

### 6.3 Vector 3 — share temporal ajeno por id adivinado

Se sembró una fila de `shared_uploads_temp` a nombre de la **cuenta** de María y se abrió `/compartir?archivo=<ese id>`:

| Sesión | Resultado |
|---|---|
| Diego (ajeno) | 200 (la pantalla), **canario = 0** — la fila no existe para él |
| María (dueña) | 200, **canario = 1** |

El `200` es correcto: es la pantalla de recepción mostrando "no hay archivo". Lo que importa es que el nombre del archivo de María no viajó. Y por PostgREST directo, `DELETE` sobre esa fila con el JWT de Diego devuelve `204` (la respuesta de PostgREST cuando no afecta nada) y la fila sigue en la base — verificado contra el catálogo, no contra el status.

### 6.4 Vector 4 — deep links `/{medicacion,signos,turnos}/enlace?perfil=`

Es el vector más delicado porque el handler **escribe** la cookie de perfil activo a partir de un parámetro de la URL. Con la sesión de Diego, cuatro variantes por cada una de las tres rutas:

| `?perfil=` | Respuesta | ¿Cambió el perfil activo? |
|---|---|---|
| perfil de María (ajeno) | 307 → `/medicacion` | **no** |
| uuid inexistente | 307 → `/medicacion` | **no** |
| `no-es-uuid` | 307 → `/medicacion` | **no** |
| Roberto (legítimo) | 307 → `/medicacion` | **sí** (`Set-Cookie: perfil_activo=…0003`) |

Las cuatro respuestas son **indistinguibles** salvo por el `Set-Cookie` del caso legítimo — que solo llega a quien ya tenía el permiso. El control positivo (última fila, partiendo del perfil propio de Diego) es lo que demuestra que el handler realmente hace algo y que el "no cambió" de las tres primeras filas no es un handler roto.

### 6.5 Vector 5 — PostgREST y Storage directos, salteando la aplicación

Con el access token de Diego contra `http://127.0.0.1:54321/rest/v1`:

| Operación | Resultado |
|---|---|
| `GET /profiles?id=eq.<María>` | `[]` |
| `GET /documents?profile_id=eq.<María>` | `[]` |
| `GET /insurance_cards?profile_id=eq.<María>` | `[]` |
| `GET /shared_uploads_temp` | `[]` |
| `GET /storage_purge_queue` · `/appointment_reminders` | **403 `42501`** (sin privilegio) |
| `POST /shared_uploads_temp` | **403 `42501`** |
| `DELETE /shared_uploads_temp?id=eq.<de María>` | 204 — **0 filas afectadas**, verificado en la base |
| `PATCH /profiles?id=eq.<María>` `{"full_name":"HACKEADO"}` | 204 — **0 filas**, el nombre sigue siendo "María Gómez" |
| `anon` sobre `profiles`, `documents`, `shared_uploads_temp` | **401 `42501`** |

Y contra Storage, con el bucket temporal (§2.4): las seis operaciones de cliente (subir, bajar y borrar, propias y ajenas, más `anon`) devuelven **400**; `service_role` sí puede, que es quien lo usa. El listado devuelve `[]`.

**Fixtures.** Los datos canario se eliminaron al terminar y se restauró el estado del seed; después se corrió `npx supabase db reset` completo, que reconstruye la base desde cero. La verificación final de §8 corre sobre esa base limpia.

---

## 7. Verificado y NO es hallazgo

Cuatro cosas que parecen problemas al mirarlas de reojo y no lo son. Se documentan para que la próxima auditoría no las investigue otra vez.

**`vital_sign_alerts` tiene una política de `UPDATE` y no aparece con privilegio de `UPDATE`.** Parece una política muerta. No lo es: el privilegio es **de columna**, `grant update (acknowledged_at)`, y `information_schema.role_table_grants` no muestra los privilegios de columna. Está en `role_column_grants`, y es el **único** del proyecto:

```
$ psql -Atc "select table_name, column_name, grantee, privilege_type
             from information_schema.role_column_grants where table_schema='public' …"
vital_sign_alerts|acknowledged_at|authenticated|UPDATE
```

Es la implementación correcta de "lo único que una sesión puede hacer con una alerta es marcarla vista", y el trigger `sellar_visto` sella el valor con `now()` y el autor con `perfil_actor()`.

**`anon` y `authenticated` tienen `TRUNCATE` sobre `storage.objects` y `storage.buckets`.** Es el default de Supabase para el esquema `storage`, que el proyecto no administra. No es alcanzable: `supabase/config.toml` expone en la Data API solo `["public", "graphql_public"]` —`storage` no está—, y PostgREST no tiene verbo `TRUNCATE` en ningún caso. El acceso real a Storage pasa por el servicio de Storage, que va por `storage.objects` con RLS. Riesgo residual aceptado, fuera del control del proyecto.

**Las tablas de `public` **sí** están protegidas de `TRUNCATE`,** que es donde el proyecto tiene la responsabilidad: `ALTER DEFAULT PRIVILEGES … GRANT ALL` de Supabase hace que toda tabla nueva nazca con `TRUNCATE` para los dos roles públicos, y RLS **no** protege de un `TRUNCATE`. Las migraciones hacen `revoke all` antes de conceder lo puntual, y el catálogo lo confirma: ninguna de las 19 tablas tiene `TRUNCATE` para `anon` ni `authenticated`. El BLOQUE 16 del arnés ahora lo prueba ejecutando el `TRUNCATE` de verdad, no solo mirando el catálogo.

**No se usa `FORCE ROW LEVEL SECURITY`.** Verificado (`relforcerowsecurity = false` en las 19). Está argumentado en [`seguridad-rls.md`](./seguridad-rls.md) §1: `postgres` y `service_role` tienen `BYPASSRLS`, que se evalúa **antes** que `FORCE`, así que activarlo no cambiaría el comportamiento de ningún rol real y sí sometería a RLS a las funciones `SECURITY DEFINER`, reintroduciendo la recursión `42P17`. La protección efectiva contra el uso indebido de `service_role` es que la clave no salga del servidor — auditado en §5.

### Rutas públicas: una por una

`RUTAS_PUBLICAS` tiene 10 entradas. "Pública" acá significa "el proxy no la corta con la cookie", **no** "cualquiera puede usarla":

| Ruta | Por qué es pública | Cómo se autentica |
|---|---|---|
| `/`, `/login`, `/registro`, `/recuperar` | Pantallas de entrada | — (no sirven datos) |
| `/sw.js` | El navegador lo pide sin cookies al registrar el worker | — (archivo estático) |
| `/offline` | El SW la precachea en `install`, antes de que exista sesión | — (no consulta nada; vive fuera de `app/(app)/`) |
| `/manifest.webmanifest` | Chrome lo evalúa sin sesión para decidir instalabilidad | — (no tiene datos) |
| `/api/push/procesar-recordatorios` | Lo llama `pg_cron` vía `pg_net`: no hay navegador ni cuenta | **`x-cron-secret` en tiempo constante** |
| `/api/push/procesar-alertas-medicacion` | Ídem, su gemelo | **`x-cron-secret` en tiempo constante** |
| `/api/compartir` | Es un POST multipart del **sistema operativo**; un `401` JSON sería la pantalla de aterrizaje tras compartir | **`supabase.auth.getUser()`**, y sin sesión hace su propio `303 → /login?desde=/compartir` |

Las dos rutas de cron comparan con `timingSafeEqual` de `node:crypto` sobre digests SHA-256 (que iguala las longitudes antes de comparar, requisito de `timingSafeEqual`) y, **sin `CRON_SECRET` en el entorno responden `503` y no hacen nada**, en vez de quedar abiertas. Probado en vivo:

| Intento | Recordatorios | Alertas |
|---|---|---|
| Sin header | **401** | **401** |
| `x-cron-secret: adivinado` | **401** | **401** |
| Con sesión válida de Diego y sin header | **401** | **401** |

`/estado` y `/estilos` son públicas **solo** en desarrollo (`RUTAS_PUBLICAS_DEV`) y además se autobloquean con `notFound()` en producción. `tests/unit/rutas.test.ts` cubre la matriz completa.

---

## 8. Verificación final

Todo lo de abajo se corrió **después** de `npx supabase db reset` con las 16 migraciones (incluida la de esta auditoría) y el seed.

| Suite | Antes | Después | Estado |
|---|---|---|---|
| `scripts/test-rls.sql` | 234/234 | **253/253 PASS, 0 FAIL** | ✅ (+19 casos; idempotente en dos corridas seguidas) |
| `scripts/test-storage-rls.sh` | 20/20 | **27/27 PASS, 0 FAIL** (exit 0) | ✅ (+7 casos) |
| `npm run test` (vitest) | 684 | **693 passed, 41 archivos** | ✅ (+9) |
| `npx tsc --noEmit` | — | exit 0 | ✅ |
| `npx eslint` | — | exit 0 | ✅ |
| `npx next build` | — | build completo | ✅ |
| `node scripts/verificar-contraste.mjs` | — | 98 pares, 0 fallas | ✅ |
| `npx supabase db lint --level warning` | — | `No schema errors found` | ✅ |
| `npx supabase db reset` | — | 16 migraciones + seed, limpio | ✅ |

### Casos nuevos del arnés

**BLOQUE 16 — `shared_uploads_temp` + bucket `compartidos-temp` (15 casos).** La tabla no tenía ni un caso propio: es la única del dominio cuyo dueño es una **cuenta** y no un perfil, y la única que nace de un `INSERT` con `service_role`. Cubre: lectura propia; que A no vea lo de B y B no vea lo de A (los dos marcados como criterio de aceptación); `INSERT` y `UPDATE` denegados a `authenticated` por falta de privilegio; **`TRUNCATE` denegado** (RLS no protege de un `TRUNCATE`, así que el `revoke` es lo único que lo frena); el borrado ajeno por id adivinado afectando 0 filas mientras el propio sí borra; `anon` sin nada; y los invariantes estructurales, incluido que el bucket sea privado y que **ninguna** política de `storage.objects` lo mencione.

**BLOQUE 15 — 4 casos nuevos** por el hallazgo A-01 (la forma del rechazo de `UPDATE`/`DELETE`, y el centinela de privilegio).

**BLOQUE 7 de Storage — 7 casos** que prueban por HTTP que el cliente no entra a `compartidos-temp` ni con `can_manage` puesto, y que `service_role` sí.

Los tres bloques se escribieron evitando explícitamente los cinco defectos que la auditoría 10.5 encontró en el BLOQUE 15 (commit `948fe4a`): la sesión simulada **envuelve** cada `do`-block, no se usan variables `psql` dentro de `$$…$$`, hay pre-limpieza defensiva al entrar y limpieza en el bloque final del script, y ninguna aserción puede devolver `NULL` (que violaría el `NOT NULL` de `resultado.obtenido` y, con `ON_ERROR_STOP`, tumbaría la suite entera).

---

## 9. Veredicto

**Sin hallazgos abiertos de severidad alta.** Tampoco los hubo cerrados: la auditoría no encontró ninguna vía de acceso a datos ajenos, ni por RLS, ni por Storage, ni por la aplicación.

Los tres hallazgos corregidos comparten una forma: en los tres, el sistema hacía lo correcto por una sola razón cuando el diseño declaraba dos. Un privilegio concedido que solo la ausencia de una política frenaba; una política que decidía bien pero no como decide el resto; una cookie muerta que se limpiaba por un camino y no por el otro. Ninguno era explotable hoy. Los tres habrían sido difíciles de encontrar el día que sí lo fueran.

Lo que se verificó y **no** hubo que tocar es la parte más grande del informe, y es el resultado principal: 19 tablas con RLS y políticas efectivas, 4 buckets privados, 39 funciones con `search_path` fijado y `EXECUTE` mínimo, la única vista en `security_invoker`, `access_logs` append-only por privilegio, 28 triggers activos, la `service_role` sin aparecer en un solo archivo de cliente ni en el bundle, y **280 casos automatizados** que fallan si algo de eso cambia.
