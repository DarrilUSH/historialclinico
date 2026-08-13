# Recordatorios de turnos

**Sprint 6, tarea 6.4.** Verificado de punta a punta en un Samsung Galaxy A71
real (Android, Chrome) el 2026-08-13: captura en
`docs/capturas/dispositivo-real/sprint6-recordatorio.png`.

Un turno cargado en la app avisa solo, en las ventanas **7 días / 48hs / 24hs /
3hs**, sin que nadie tenga que acordarse de nada. Es el cierre del circuito que
empezó con la infraestructura de Web Push (`docs/push.md`, tarea 6.3).

---

## 1. La decisión: por qué no hay una Edge Function

El roadmap proponía `supabase/functions/recordatorios-turnos/index.ts` — una
Edge Function de Deno disparada por `pg_cron`. **Se descartó.** Vale la pena
dejar escrito el motivo porque el Sprint 7 (alertas de medicación) y el 9
(alertas de presión) van a copiar esta forma.

Una Edge Function de Supabase corre en **Deno**. El envío Web Push del proyecto
(`lib/push/servidor.ts`) usa `web-push`, que es **Node**: depende de `crypto` y
`https` de Node y de `Buffer`. Llevarlo a Deno significa una de estas tres,
todas malas:

| Opción | Costo real |
|---|---|
| Reimplementar RFC 8291 (ECDH P-256 + HKDF + AES-128-GCM) y el JWT ES256 de VAPID con `SubtleCrypto` | criptografía nueva y sin probar en el único camino por el que la gente se entera de que tiene turno |
| Usar un port de `web-push` para Deno | una dependencia menos madura que el original, a cambio de nada |
| Duplicar la política de bajas (404/410 → `revoked_at`) allá | `docs/push.md` §7 dice lo contrario: "toda la política de bajas vive en `lib/push/servidor.ts`" |

Y sobre todo: la Edge Function necesitaría **una copia de la clave privada
VAPID** en sus secrets. El secreto más sensible del proyecto, duplicado en un
segundo sistema, para no ganar nada.

### La forma elegida: la lógica en SQL, la entrega en Node

```
pg_cron  (*/15 * * * *)
   └─ public.disparar_recordatorios_turnos()
         ├─ generar_recordatorios_pendientes()    ← ventanas + antiduplicación
         └─ net.http_post(URL, header x-cron-secret)     [pg_net, asíncrono]
               └─ POST /api/push/procesar-recordatorios  [Node]
                     ├─ reclamar_recordatorios_turnos()  ← FOR UPDATE SKIP LOCKED
                     ├─ destinatarios_de_avisos()        ← family_permissions
                     ├─ enviarPushAUsuario()             ← lib/push/servidor.ts
                     └─ cerrar_recordatorio_turno()
```

Cada decisión vive en un solo lugar:

| Decide | Dónde | Por qué ahí |
|---|---|---|
| **Cuándo** avisar | SQL | declarativo, se verifica con un `select`, y la antiduplicación es un `UNIQUE` en vez de un `if` |
| **A quién** | SQL (`destinatarios_de_avisos`) | la regla ya vive en `family_permissions`; sacarla de la base la duplicaría |
| **Qué dice** | `lib/turnos/recordatorios.ts` | función pura con 24 tests; es lo único que la persona ve |
| **Cómo se entrega** | `lib/push/servidor.ts` | ya estaba escrito y probado contra un teléfono real |

### Por qué `pg_cron` y no un Cron Job de Vercel

Vercel Hobby —el plan del proyecto, por la restricción de **costo cero** del
roadmap— permite **cron jobs diarios y nada más**. La ventana de 3hs necesita
como mínimo una corrida cada 15 minutos: con una diaria, "tu turno es en 3
horas" llegaría en cualquier momento entre 3 y 27 horas antes. `pg_cron` viene
incluido en Supabase Free y no tiene ese límite.

La URL de destino es un parámetro (§4), así que el mismo job sirve en local y
en producción sin tocar una línea de código.

---

## 2. Qué se construyó

| Pieza | Archivo |
|---|---|
| Tabla, funciones, triggers y el job | `supabase/migrations/20260813050000_recordatorios_turnos.sql` |
| Barrido de la cola | `app/api/push/procesar-recordatorios/route.ts` |
| Texto de los avisos (puro) | `lib/turnos/recordatorios.ts` |
| Tests del texto | `tests/unit/recordatorios-turnos.test.ts` (24 casos) |
| Excepción de ruta pública | `lib/auth/rutas.ts` → `RUTA_CRON_RECORDATORIOS` |
| Aislamiento verificado | `scripts/test-rls.sql` → BLOQUE 9 (14 casos nuevos) |

**Costo: cero.** `pg_cron` y `pg_net` están incluidos en Supabase Free; los
Push Services (FCM, autopush) son gratuitos.

---

## 3. Las cuatro ventanas y la regla que evita el spam

Una fila de `appointment_reminders` = "el aviso de la ventana V del turno T".
La fila **existe recién cuando la ventana vence**: no hay cuatro filas
esperando por cada turno del futuro.

| estado | qué significa |
|---|---|
| `pendiente` | debido y sin entregar. Es la cola. |
| `enviando` | un barrido lo tomó (lease de 10 minutos) |
| `enviado` | se intentó la entrega a todos los destinatarios |
| `omitido` | no se manda nunca: había una ventana más próxima, o el turno pasó / se canceló antes de salir |

### El caso que define el diseño: el turno cargado a última hora

Un turno cargado dos horas antes tiene las **cuatro** ventanas vencidas al
mismo tiempo. Lo ingenuo —crear las cuatro como pendientes— dispara cuatro
notificaciones juntas diciendo "en una semana", "pasado mañana", "mañana" y "en
3 horas" del mismo turno. Además de absurdo, es exactamente por lo que una
persona apaga las notificaciones para siempre.

**Se manda solo la más próxima al turno.** Las otras quedan como `omitido`, que
responde "¿por qué no me avisó con 24hs?" sin tener que reconstruir la lógica
mentalmente. Verificado:

```
 ventana |  estado   | vence
---------+-----------+-------
 7d      | omitido   | 17:54
 48h     | omitido   | 17:54
 24h     | omitido   | 17:54
 3h      | pendiente | 14:54
```

### La misma regla, entre corridas (y por qué hacen falta las dos mitades)

Colapsar dentro de una corrida **no alcanza**, y esto salió en revisión de
código, no de la cabeza: si el barrido está caído, las ventanas se van creando
de a una en corridas distintas, cada una es la única candidata de su propia
corrida, y todas quedan `pendiente`. Cuando el barrido vuelve, salen juntas. Un
día de caída bastaba para mandar "mañana" y "en 3 horas" al mismo tiempo — el
mismo spam, por la puerta de al lado.

Por eso `generar_recordatorios_pendientes()` termina con un tercer paso: de
varios `pendiente` del mismo turno **sobrevive el más próximo**, el resto pasa a
`omitido`. Solo toca filas `pendiente`: una `enviando` ya está en vuelo y una
`enviado` ya se le mostró a alguien; degradarlas sería reescribir la historia.

Los casos 89 a 91 de `scripts/test-rls.sql` cubren las dos mitades y la
regresión.

### La antiduplicación no es un `if`

Es `UNIQUE (appointment_id, ventana)` + `INSERT ... ON CONFLICT DO NOTHING`. No
existe forma de mandar dos veces el mismo aviso, ni con dos corridas del cron
pisándose ni con un `curl` manual en el medio. El estado del envío vive en la
misma fila, así que no hay ninguna ventana de tiempo entre "decidí mandarlo" y
"anoté que lo mandé".

### Reprogramar un turno: por qué se borra hasta lo ya enviado

El trigger `appointments_recalcular_recordatorios` recalcula **por borrado**:

- **Cambió `appointment_date`** → se borran **todos** los recordatorios, incluidos
  los que ya salieron.
- **Se canceló o completó** → se borran solo los que no salieron.

La primera regla es contraintuitiva y es la correcta. Si se borraran solo los
pendientes, un turno de hoy a las 15:00 que ya disparó sus avisos de 24hs y 3hs
y se reprograma **para dentro de un mes** conservaría esas filas en `enviado`;
cuando llegue la fecha nueva el generador las vería existentes y **no volvería
a avisar**. La persona se quedaría sin recordatorio justo del turno
reprogramado.

El riesgo de spam que esto abriría —mover un turno a mañana regenera 7d, 48h y
24h vencidas juntas— ya está cubierto por la regla de "solo la más próxima":
sale **una** notificación, con el texto de la ventana correcta.

Editar la dirección, el médico o las notas **no toca nada**: el trigger es
`after update of appointment_date, status` y adentro compara con
`is distinct from`.

### El lease de 10 minutos: al-menos-una-vez, a propósito

`reclamar_recordatorios_turnos()` marca `enviando` (no `enviado`) al tomar la
fila, con `FOR UPDATE SKIP LOCKED`. Si marcara `enviado` antes de mandar, un
proceso que muere en el medio —deploy, timeout— se traga el aviso en silencio y
nadie se entera hasta que alguien falta a un turno.

El precio es un duplicado posible si un barrido tarda más de 10 minutos en
cerrar. Para este producto es el intercambio correcto —**un aviso repetido
molesta; un aviso perdido es una consulta médica perdida**— y el `tag` del
payload (`turno-{id}-{ventana}`) hace que el segundo *reemplace* al primero en
la pantalla del teléfono en vez de apilarse.

### Quién recibe

Según `docs/modelo-permisos.md` §4.3, implementado en
`destinatarios_de_avisos(profile_id)`:

- el **titular**, si tiene cuenta;
- **todos los `can_manage`** sobre ese perfil.

Los `can_view` y `can_upload` **no reciben nada**. Diego puede mirar el
historial de su padre, pero no es quien lo lleva al médico: notificarle el
turno sería contarle algo que no le corresponde. Está cubierto por los casos 80
a 84 de `scripts/test-rls.sql`.

La misma función la van a usar las alertas de medicación (Sprint 7) y de
presión (Sprint 9); por eso se llama `..._de_avisos` y no `..._de_recordatorios`.

---

## 4. Configuración (una vez por entorno)

Hacen falta dos valores que **no están en el repositorio**: el secreto
compartido y la URL a la que postear.

### 4.1 El secreto, en el entorno de la aplicación

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Va como `CRON_SECRET` en `.env.local` y `.env.development.local` (y en las
variables de entorno de Vercel, en producción). `.env.example` lo documenta sin
valor. **Sin esta variable el endpoint responde 503 y no manda nada**: un
despliegue al que le falta tiene que verse como roto, no quedarse abierto.

### 4.2 El mismo secreto y la URL, en el Vault de la base

```sql
select public.configurar_cron_recordatorios(
    'http://host.docker.internal:3000/api/push/procesar-recordatorios',
    '<el mismo valor de CRON_SECRET>');
```

En producción, la misma llamada con
`https://<dominio>/api/push/procesar-recordatorios`.

Se usa el **Vault de Supabase** (`supabase_vault`) y no las alternativas obvias:

- `ALTER DATABASE ... SET app.secreto = '...'` deja el secreto en texto plano en
  `pg_db_role_setting`, visible con un `\drds`, y se pierde en cualquier
  `db reset`.
- Una tabla de configuración en `public` necesitaría su propia RLS y sería un
  secreto más que cuidar.

`configurar_cron_recordatorios()` no tiene `EXECUTE` ni para `service_role`:
solo el owner de la base (psql, o el SQL editor de Supabase). Una función que
escribe secretos no tiene por qué ser alcanzable desde una API key.

> `host.docker.internal` es cómo el contenedor de Postgres alcanza el
> `next dev` que corre en Windows. Verificado: resuelve a la IP del host
> (`172.29.0.254` en esta máquina).

Si el Vault no está configurado, el job **degrada en vez de fallar**: genera las
filas igual y avisa con un `warning`. Así un `supabase db reset` a mitad de
desarrollo no deja el job en rojo cada 15 minutos.

---

## 5. Verificarlo

### El job está programado

```sql
select jobid, jobname, schedule, active from cron.job;
--  1 | recordatorios-turnos | */15 * * * * | t

select runid, status, start_time from cron.job_run_details order by runid desc limit 5;
--  1 | succeeded | 2026-08-13 18:00:00.03+00
```

### El POST llegó (pg_net es asíncrono: la respuesta se consulta después)

```sql
select id, status_code, content, error_msg from net._http_response order by id desc limit 3;
--  1 | 200 | {"procesados":1,"entregas":1,"fallos":1} |
```

### Forzar una corrida a mano

```sql
select public.disparar_recordatorios_turnos();
-- generados=4 pendientes=1 request_id=1
```

O directo al endpoint, sin pasar por la base:

```bash
curl -X POST http://localhost:3000/api/push/procesar-recordatorios \
     -H "x-cron-secret: $CRON_SECRET"
```

### Ver la cola

```sql
select r.ventana, r.estado, r.entregas, r.fallos, a.specialty, a.appointment_date
  from public.appointment_reminders r
  join public.appointments a on a.id = r.appointment_id
 order by r.due_at desc;
```

### El log del barrido muestra los destinatarios

```
[recordatorios] 3h  turno=a0000000-… destinatarios=1 entregas=1 fallos=1 · "Turno de Cardiología en 3 horas"
[recordatorios] 48h turno=11621eda-… destinatarios=1 entregas=1 fallos=1 · "Turno de Cardiología pasado mañana"
[recordatorios] 7d  turno=65b45f0a-… destinatarios=1 entregas=1 fallos=1 · "Turno de Endocrinología en una semana"
```

> `fallos=1` en esas líneas es la suscripción **ficticia del seed**
> (`.../ficticio-seed-…`), que `web-push` rechaza localmente porque su `p256dh`
> no mide 65 bytes. Correctamente clasificada como *reintentable* y **no**
> revocada: no hubo respuesta de ningún Push Service, así que no hay evidencia
> de que esa suscripción esté muerta.

---

## 6. El texto: por qué no dice la ventana, sino el tiempo real

La tentación es mapear `'3h'` → `"en 3 horas"`. Está mal: la ventana es el
momento en que el aviso se vuelve *debido*, y el envío ocurre en la corrida
siguiente del cron (hasta 15 minutos después), o mucho más tarde si la máquina
estuvo apagada. "En 3 horas" para un turno que es en 40 minutos no es un
redondeo: es una notificación que hace llegar tarde a alguien.

La frase se calcula contra `ahora` de verdad. La ventana solo decide **cómo** se
mide:

| Ventana | Unidad | Ejemplos |
|---|---|---|
| `3h` | horas de reloj, redondeadas | "en 3 horas", "en 1 hora", "en menos de una hora" |
| `24h` / `48h` / `7d` | días de **calendario de Ushuaia** | "mañana", "pasado mañana", "en una semana" |

La distinción de días de calendario es la misma que ya documenta
`lib/turnos/tiempo-relativo.ts`: si son las 23:50 y el turno es a las 00:10,
faltan 20 minutos pero la respuesta correcta para la ventana de 24hs es
"mañana", porque es el turno de otro día.

El resultado, tal como se ve en el teléfono:

```
Turno de Cardiología en 3 horas
Hoy a las 17:54 · Dr. Carlos Rodríguez · Hospital Regional Ushuaia · Venir en ayunas de 8 horas
```

La **preparación** (`ayuno`, `traer estudios`) entra solo en las ventanas de
24hs y 3hs: a 7 días no le sirve a nadie y ocupa el renglón que se lee de un
vistazo, mientras que a 24hs es la razón de ser del aviso —el ayuno empieza la
noche anterior—.

### Zona horaria

Toda la parte SQL es **inmune al huso** por construcción: `appointment_date` es
`timestamptz` y las ventanas son intervalos restados a ese instante, así que "48
horas antes" es el mismo instante físico se lo mire desde donde se lo mire.
`America/Argentina/Ushuaia` importa en un solo lugar —el texto— y ahí se
resuelve con los formateadores anclados de `lib/turnos/fecha.ts`. El servidor
que corre el barrido puede estar en cualquier huso (Vercel corre en UTC) y el
texto sale igual.

La expresión `*/15 * * * *` tampoco lleva zona: cada 15 minutos es lo mismo en
todos lados.

---

## 7. Seguridad

### El endpoint es "público" para el proxy, no para cualquiera

`RUTA_CRON_RECORDATORIOS` está en `RUTAS_PUBLICAS` (`lib/auth/rutas.ts`) porque
quien lo llama es `pg_cron`: un proceso de la base, sin navegador, sin cookies y
sin ninguna cuenta con la cual iniciar sesión. Dejarlo bajo "privado por
defecto" solo produce un `401` que ningún login puede resolver — el mismo
problema que tuvo `/sw.js` en la tarea 6.3.

La autenticación la hace el propio Route Handler: compara `x-cron-secret` contra
`CRON_SECRET` **en tiempo constante** (SHA-256 de los dos + `timingSafeEqual`;
un endpoint que responde más rápido ante un prefijo incorrecto regala el secreto
de a un byte por vez).

Lo peor que logra quien adivine el secreto es **adelantar** un barrido que se
iba a ejecutar igual en los próximos 15 minutos: el endpoint no acepta ningún
parámetro (no se le puede pedir "mandale una notificación a fulano"), no expone
ningún dato (devuelve tres números) y no puede duplicar nada.

`/api/push/probar` sigue siendo privado y de solo desarrollo. Hay un test que lo
verifica.

### La tabla es infraestructura cerrada

`appointment_reminders` tiene RLS habilitada y **cero políticas**, igual que
`storage_purge_queue`: para `anon` y `authenticated` no existe.

> **Hallazgo de esta tarea.** Supabase trae un
> `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated` en
> `public`, así que **toda tabla nueva nace con privilegios para los dos roles
> públicos**. El `revoke all ... from anon` de `20260812220000_rls.sql` §4 usó
> `ALL TABLES IN SCHEMA public`, que en PostgreSQL alcanza a las tablas
> existentes y a ninguna futura. `appointment_reminders` quedó con TRUNCATE,
> REFERENCES y TRIGGER para `anon` hasta que lo detectó
> `scripts/test-rls.sql`. **RLS no protege de un TRUNCATE**: un visitante sin
> sesión podía vaciar la cola y dejar a toda la familia sin recordatorios.
>
> **Toda migración que agregue una tabla a `public` tiene que repetir el
> `revoke all ... from anon, authenticated`.** El caso 71 del arnés de RLS lo
> verifica de acá en adelante.

Las seis funciones del job tampoco tienen `EXECUTE` para `authenticated`. Dos de
ellas serían fugas si lo tuvieran: `destinatarios_de_avisos()` devuelve
`user_id` de otras cuentas, y `configurar_cron_recordatorios()` escribe secretos
en el Vault. Casos 72 a 79.

---

## 8. Verificación en dispositivo real (2026-08-13)

Samsung Galaxy A71, Android, Chrome, contra el `next dev` de la máquina de
desarrollo por `adb reverse tcp:3000 tcp:3000`.

1. Turno de prueba de Cardiología cargado a **2h55m** sobre el perfil de Roberto
   (perfil gestionado, sin cuenta propia).
2. `generar_recordatorios_pendientes()` → **solo `3h` pendiente**, las otras tres
   `omitido`.
3. El job completo (`disparar_recordatorios_turnos()` → `pg_net` → endpoint) →
   `net._http_response` con `200` y `{"procesados":1,"entregas":1,"fallos":1}`.
4. **La notificación llegó al teléfono** con el texto correcto
   (`sprint6-recordatorio.png`). El destinatario fue María, que tiene
   `can_manage` sobre Roberto — Roberto no tiene cuenta y Diego, que solo tiene
   `can_view`, no recibió nada.
5. Tocarla abrió `localhost:3000/turnos`.
6. Segundo, tercer y cuarto disparo → `{"procesados":0,...}`: **no reenvía**.
7. Cambiar la fecha del turno → el trigger borró las cuatro filas y la corrida
   siguiente las regeneró.
8. `cron.job_run_details` muestra la corrida automática de las 18:00 en
   `succeeded`.

También llegaron, en el mismo barrido, los recordatorios reales de los dos
turnos del seed ("Turno de Cardiología pasado mañana" y "Turno de
Endocrinología en una semana"), que es el sistema funcionando sin que nadie lo
provoque.

---

## 9. Límites conocidos

- **La notificación abre `/turnos`, no el turno.** El proyecto todavía no tiene
  pantalla de detalle (`turnos/` tiene `page.tsx`, `nuevo/` y `[id]/editar/`).
  Mandar a `/turnos/{id}` daría un 404 justo cuando la persona más confía en el
  aviso. Se cambia en `RUTA_RECORDATORIO` (`lib/turnos/recordatorios.ts`) y en
  ningún otro lado.
- ~~**`/turnos` muestra el perfil ACTIVO, que puede no ser el del turno.**~~
  **Resuelto en la tarea correctiva 6.6, ver §10.** Se vio en la prueba real:
  el aviso era de un turno de Roberto, pero María tenía su propio perfil
  activo y llegó a una lista vacía. Antes se pensaba resolver recién cuando
  existiera el detalle de turno; terminó resolviéndose antes, con un deep
  link que cambia el perfil activo -revalidando el permiso- antes de mostrar
  la lista.
- **Un turno cargado a menos de 3 horas espera hasta 15 minutos** para su aviso:
  la generación la hace el cron, no un trigger de INSERT. Es aceptable porque
  quien lo cargó ya sabe que existe; el aviso es para los demás destinatarios.
- **El aviso sale una sola vez por ventana aunque falle la entrega a todos.** Es
  la política de `cerrar_recordatorio_turno()`: reintentar el aviso completo
  porque uno de los tres teléfonos devolvió 503 volvería a notificar a los otros
  dos. Las suscripciones muertas se dan de baja solas por el 410 y el resto de
  los fallos quedan contados en la columna `fallos`.

  La excepción, y es importante: si falla **resolver los destinatarios** (el RPC
  `destinatarios_de_avisos`), el barrido **no cierra la fila** — lanza, la deja
  en `enviando` y el lease la devuelve a la cola. Cerrarla sería confundir "no
  pude preguntar quién recibe" con "no recibe nadie", y como el `UNIQUE` impide
  regenerar la ventana, un hipo de red de un segundo silenciaría ese
  recordatorio para siempre dejando un rastro (`entregas=0, fallos=0`) idéntico
  al del caso legítimo.
- **En producción falta correr `configurar_cron_recordatorios()`** con la URL
  real y cargar `CRON_SECRET` en Vercel. Es parte de la tarea "Jobs de
  producción" del Sprint 12.

---

## 10. El deep link aterriza en el perfil del turno (tarea correctiva 6.6)

El límite de §9 -tocar la notificación mostraba el perfil ACTIVO de quien la
tocaba, no el del turno- se resolvió sin esperar al detalle de turno.

**El mecanismo, en tres piezas:**

1. **La url del payload lleva el perfil.** `construirRecordatorio`
   (`lib/turnos/recordatorios.ts`) arma `/turnos?perfil={profileId}` cuando el
   turno trae `profileId` -que siempre trae, en el uso real:
   `app/api/push/procesar-recordatorios/route.ts` lo pasa desde
   `fila.profile_id`, `NOT NULL` en `appointments`-. Sin `profileId` (los
   tests del módulo puro, que arman turnos mínimos) la url queda pelada, el
   comportamiento de antes de esta tarea.

2. **`/turnos` reenvía, no procesa.** `turnos/page.tsx` es un Server
   Component: no puede escribir la cookie `perfil_activo` él mismo (Next.js
   solo permite escribir cookies en un Server Action o un Route Handler,
   nunca durante el render de una página, ni siquiera si esa página llama a
   `redirect()` después). Si ve `?perfil=`, redirige a `/turnos/enlace` con el
   mismo valor.

3. **`/turnos/enlace` (`turnos/enlace/route.ts`) hace el trabajo real.**
   Llama a `cambiarPerfilDesdeParametro` (`lib/perfil-activo.ts`), que por
   dentro es `fijarPerfilActivo` -la misma función que usa el selector de
   perfiles, así que revalida `requerirPermiso(perfilId, "view")` contra la
   base en cada llamada- y siempre termina en `redirect("/turnos")`, con o sin
   cambio de perfil, con o sin permiso. Ese `redirect()` es lo que limpia la
   url (nunca queda `?perfil=` en la barra de direcciones) y lo que hace que
   el request siguiente a `/turnos` -layout incluido, con el encabezado "Viendo
   a..."- vea la cookie nueva desde el arranque, en vez de mostrar el perfil
   viejo un instante y corregirse después.

   Está fuera de `/api` a propósito: un Route Handler bajo `/api` responde
   `401` JSON cuando no hay sesión (`esRutaDeApi` en `lib/auth/rutas.ts`), lo
   correcto para código (`pg_cron`) pero no para una persona tocando una
   notificación con la sesión vencida, que merece la pantalla de login con
   `?desde=` de vuelta a este mismo enlace -igual que le pasa a `/turnos`
   pelado-.

**La decisión de seguridad: silencio total.** Si el uuid de `?perfil=` no
tiene forma de uuid, no existe, o la sesión no tiene permiso `view` sobre él,
`/turnos/enlace` no lo dice de ninguna forma distinguible: redirige exactamente
igual que en el caso exitoso, a `/turnos` pelado, sin perfil nuevo. Contestar
distinto -un 403, un `?error=`- convertiría el enlace en un oráculo para
adivinar ids de perfiles ajenos con solo mirar la respuesta. Es el mismo
principio que ya aplica `ErrorPermisoDenegado` en `lib/auth/guardas.ts`, que
tampoco distingue "no existe" de "no tenés permiso".

**Reutilizable.** `cambiarPerfilDesdeParametro` es la pieza que le falta a
cualquier deep link futuro con el mismo problema -Sprint 7 (medicación),
Sprint 9 (alertas)-: un Route Handler chico, fuera de `/api`, que la llama y
redirige a su propia pantalla. No hace falta generalizar más que eso hasta
que el patrón se repita una tercera vez.

**Sin cambios en `public/sw.js`.** El service worker abre la url que venga en
el payload tal cual (`notificationclick`); no le importa si es `/turnos` o
`/turnos?perfil=...`, y sigue redirecciones HTTP con normalidad -a diferencia
del registro del propio worker (`navigator.serviceWorker.register()`), que sí
las rechaza (ver el comentario de `RUTA_SERVICE_WORKER` en
`lib/auth/rutas.ts`)-.
