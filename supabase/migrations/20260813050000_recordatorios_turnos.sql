-- =============================================================================
-- Historial Médico — Migración 20260813050000: recordatorios de turnos
-- (Sprint 6, tarea 6.4)
-- -----------------------------------------------------------------------------
-- Cierra el circuito del sprint: un turno cargado en la app avisa solo, en las
-- ventanas 7 días / 48hs / 24hs / 3hs, sin que nadie tenga que acordarse.
--
-- ── LA DECISIÓN ARQUITECTÓNICA (por qué NO hay una Edge Function acá)
--
-- El roadmap proponía `supabase/functions/recordatorios-turnos/index.ts`: una
-- Edge Function de Deno disparada por `pg_cron`. Se descartó, y conviene que
-- quede escrito el motivo porque el Sprint 7 (alertas de medicación) y el 9
-- (alertas de presión) van a copiar esta forma.
--
-- Una Edge Function de Supabase corre en **Deno**. El envío Web Push del
-- proyecto (`lib/push/servidor.ts`) usa `web-push`, que es Node: depende de
-- `crypto` y `https` de Node y del `Buffer`. Llevarlo a Deno significa una de
-- estas tres, todas malas:
--
--   1. Reimplementar RFC 8291 (ECDH P-256 + HKDF + AES-128-GCM) y el JWT ES256
--      de VAPID con `SubtleCrypto`. Es criptografía nueva, sin tests reales, en
--      el único camino por el que la gente se entera de que tiene turno.
--   2. Usar un port de `web-push` para Deno. Suma una dependencia sin la
--      madurez del original para no ganar nada.
--   3. Duplicar la política de bajas (404/410 → `revoked_at`) en un segundo
--      lugar. `docs/push.md` §7 dice explícitamente lo contrario: "toda la
--      política de bajas vive en `lib/push/servidor.ts`".
--
-- Y sobre todo: la Edge Function tendría que recibir una copia de la clave
-- privada VAPID en sus secrets, duplicando el secreto más sensible del
-- proyecto en un segundo sistema.
--
-- Forma elegida — **la lógica en SQL, la entrega en Node**:
--
--     pg_cron (cada 15 min)
--        └─ public.disparar_recordatorios_turnos()
--              ├─ generar_recordatorios_pendientes()   ← ventanas + antiduplicación
--              └─ net.http_post(URL de la app, header x-cron-secret)
--                    └─ POST /api/push/procesar-recordatorios   (Node, Vercel/local)
--                          ├─ reclamar_recordatorios_turnos()   ← FOR UPDATE SKIP LOCKED
--                          ├─ destinatarios_de_avisos()
--                          ├─ enviarPushAUsuario()              ← lib/push/servidor.ts
--                          └─ cerrar_recordatorio_turno()
--
-- Ventajas concretas: el "cuándo" queda en SQL, que es declarativo y se puede
-- verificar con un `select` (y la antiduplicación pasa a ser una restricción
-- UNIQUE, no un `if` que alguien puede olvidar); el "cómo" reutiliza el envío
-- ya probado contra un teléfono real; y no hay un segundo lugar con la clave
-- VAPID.
--
-- ── POR QUÉ pg_cron Y NO UN CRON JOB DE VERCEL
--
-- Vercel Hobby (el plan del proyecto: "costo cero", ROADMAP §restricciones)
-- permite **cron jobs diarios y nada más**. La ventana de 3hs necesita, como
-- mínimo, una corrida cada 15 minutos: con una diaria, el aviso de "tu turno
-- es en 3 horas" llegaría cualquier cosa entre 3 y 27 horas antes. `pg_cron`
-- está incluido en Supabase Free y no tiene ese límite. La URL de destino es
-- un parámetro (ver §7), así que el mismo job sirve para local y para
-- producción sin tocar el código.
--
-- ── ZONA HORARIA
--
-- Toda esta migración es **inmune al huso** por construcción:
-- `appointment_date` es `timestamptz` y las ventanas son intervalos restados a
-- ese instante, así que "48 horas antes" es el mismo instante físico se mire
-- desde donde se mire. `America/Argentina/Ushuaia` importa en un solo lugar:
-- el TEXTO ("mañana a las 10:30"), que se arma en `lib/turnos/recordatorios.ts`
-- con los formateadores anclados de `lib/turnos/fecha.ts`. Es deliberado que la
-- zona viva ahí y no acá: la base no debería tener opinión sobre cómo se dice
-- una fecha.
--
-- UTF-8 sin BOM. Todas las funciones con `set search_path = ''` y cada objeto
-- calificado con su esquema, igual que el resto del proyecto.
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONES
-- -----------------------------------------------------------------------------
-- Las dos vienen con Supabase (local y hosted) en `shared_preload_libraries`;
-- lo único que falta es habilitarlas en esta base. `pg_net` ya está creada por
-- la plantilla de Supabase local, de ahí el `if not exists` en las dos.
--
-- `pg_net` hace el POST de forma ASÍNCRONA: `net.http_post` encola la request
-- y devuelve un id al instante. Eso es exactamente lo que se quiere en un job
-- de cron -la corrida no se queda esperando a que Node termine de mandar
-- notificaciones- y es también el motivo por el que el resultado del envío no
-- se puede leer desde el job: se consulta después en `net._http_response`.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;


-- =============================================================================
-- 2. TABLA appointment_reminders
-- -----------------------------------------------------------------------------
-- Una fila = "el aviso de la ventana V del turno T". La fila existe desde que
-- el aviso se vuelve DEBIDO, no desde que se crea el turno: no hay 4 filas
-- esperando por cada turno del futuro, hay 0 hasta que la primera ventana
-- vence.
--
-- ── LA ANTIDUPLICACIÓN ES LA RESTRICCIÓN UNIQUE, NO UN `if`
--
-- `UNIQUE (appointment_id, ventana)` + `INSERT ... ON CONFLICT DO NOTHING` hace
-- que "no mandar dos veces el mismo aviso" sea imposible por construcción, aun
-- con dos corridas del cron pisándose o un `curl` manual en el medio. El estado
-- del envío vive en la misma fila, así que no hay ninguna ventana de tiempo
-- entre "decidí mandarlo" y "anoté que lo mandé".
--
-- ── LOS CUATRO ESTADOS
--
-- | estado      | qué significa                                                |
-- |-------------|--------------------------------------------------------------|
-- | `pendiente` | debido y todavía no entregado. Es la cola.                   |
-- | `enviando`  | un barrido lo tomó (lease de 10 min, ver §4.2)               |
-- | `enviado`   | se intentó la entrega a todos los destinatarios              |
-- | `omitido`   | no se va a mandar nunca: había una ventana más próxima       |
--
-- `omitido` es la parte interesante y es una decisión de PRODUCTO. Un turno
-- cargado dos horas antes tiene las CUATRO ventanas vencidas al mismo tiempo.
-- Lo ingenuo -crear las cuatro como pendientes- dispara cuatro notificaciones
-- juntas diciendo "en una semana", "pasado mañana", "mañana" y "en 3 horas"
-- del mismo turno: además de absurdo, es la clase de cosa por la que una
-- persona apaga las notificaciones para siempre. Se manda **solo la más
-- próxima al turno** y las otras tres quedan registradas como `omitido`, que
-- responde la pregunta "¿por qué no me avisó con 24hs?" sin tener que
-- reconstruir la lógica mentalmente.
--
-- ── POR QUÉ NO ES UN ENUM
--
-- `ventana` y `estado` son `text` con CHECK, no tipos enum, a diferencia de
-- `appointment_status`. Los enums del proyecto modelan vocabulario del DOMINIO
-- (lo que el usuario ve y elige); esto es vocabulario de INFRAESTRUCTURA, que
-- va a cambiar cuando el Sprint 7 agregue sus propias ventanas. Un CHECK se
-- edita en una migración; un enum arrastra el problema de que
-- `ALTER TYPE ... ADD VALUE` no corre dentro de una transacción.
-- =============================================================================

create table public.appointment_reminders (
    id              uuid primary key default gen_random_uuid(),
    appointment_id  uuid not null references public.appointments (id) on delete cascade,
    ventana         text not null,
    due_at          timestamptz not null,
    estado          text not null default 'pendiente',
    claimed_at      timestamptz,
    sent_at         timestamptz,
    entregas        integer,
    fallos          integer,
    created_at      timestamptz not null default now(),

    constraint appointment_reminders_ventana_unica
        unique (appointment_id, ventana),
    constraint appointment_reminders_ventana_valida
        check (ventana in ('7d', '48h', '24h', '3h')),
    constraint appointment_reminders_estado_valido
        check (estado in ('pendiente', 'enviando', 'enviado', 'omitido')),
    -- `sent_at` y `estado` no pueden contradecirse: es la columna que decide si
    -- una persona ya recibió el aviso, y un estado inconsistente acá es un
    -- aviso duplicado o un aviso que nunca sale.
    constraint appointment_reminders_sent_at_coherente
        check ((estado = 'enviado') = (sent_at is not null)),
    constraint appointment_reminders_claimed_at_coherente
        check ((estado in ('pendiente', 'omitido')) = (claimed_at is null))
);

comment on table public.appointment_reminders is
    'Infraestructura de los recordatorios push de turnos (Sprint 6.4). Una fila por (turno, ventana), creada recién cuando la ventana vence. El UNIQUE es la antiduplicación: no hay forma de mandar dos veces el mismo aviso. Sin políticas RLS a propósito: la escriben pg_cron y el barrido con service_role, igual que storage_purge_queue.';
comment on column public.appointment_reminders.ventana is
    'Cuánta anticipación tiene este aviso: 7d, 48h, 24h o 3h. Los literales son los mismos que VENTANAS_RECORDATORIO en lib/turnos/recordatorios.ts.';
comment on column public.appointment_reminders.due_at is
    'appointment_date menos la anticipación de la ventana. Instante a partir del cual el aviso está debido.';
comment on column public.appointment_reminders.estado is
    'pendiente (en la cola) · enviando (tomado por un barrido, lease de 10 min) · enviado (se intentó la entrega) · omitido (no se manda: había una ventana más próxima vencida, o el turno se pasó o se canceló antes de salir).';
comment on column public.appointment_reminders.claimed_at is
    'Cuándo un barrido tomó la fila. Sirve para recuperar avisos que quedaron en enviando porque el proceso murió a mitad de camino.';
comment on column public.appointment_reminders.sent_at is
    'Cuándo terminó el intento de entrega. No garantiza que la notificación se haya mostrado: eso el Push Service no lo informa.';
comment on column public.appointment_reminders.entregas is
    'Cuántas suscripciones aceptaron el envío. Puede ser 0 con estado enviado: nadie tenía notificaciones activas.';
comment on column public.appointment_reminders.fallos is
    'Cuántas suscripciones fallaron (revocadas, reintentables o rechazadas). Se guarda para poder ver desde SQL si un aviso salió a la nada.';

-- La consulta del barrido: "los debidos que faltan mandar, más viejo primero".
-- Parcial porque las filas `enviado`/`omitido` -que son el 100% de la tabla
-- pasadas unas horas- no se consultan nunca más.
create index appointment_reminders_cola_idx
    on public.appointment_reminders (due_at)
    where estado in ('pendiente', 'enviando');

create index appointment_reminders_appointment_id_idx
    on public.appointment_reminders (appointment_id);


-- =============================================================================
-- 3. RLS Y PRIVILEGIOS
-- -----------------------------------------------------------------------------
-- Mismo tratamiento que `storage_purge_queue` (`20260812220000_rls.sql` §5.6) y
-- por el mismo motivo: RLS habilitada, CERO políticas y ningún privilegio para
-- `anon` ni `authenticated`. Para una sesión de la aplicación esta tabla no
-- existe.
--
-- Es lo correcto y no una omisión: no hay ninguna pantalla que muestre "tus
-- recordatorios programados", y si algún día la hubiera, lo que corresponde es
-- una vista o una función `security definer` que filtre por los turnos que la
-- persona ya puede ver -no abrir la tabla de infraestructura-.
--
-- ── EL REVOKE NO ES DECORATIVO: SIN ÉL, `anon` PUEDE TRUNCAR ESTA TABLA
--
-- Supabase trae un `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
-- authenticated, service_role` en el esquema `public`. Cada tabla nueva nace,
-- por lo tanto, con privilegios para los dos roles públicos. El
-- `revoke all ... from anon` de `20260812220000_rls.sql` §4 usó
-- `ALL TABLES IN SCHEMA public`, que en PostgreSQL alcanza a las tablas que
-- EXISTÍAN en ese momento y a ninguna futura.
--
-- El agujero concreto que esto tapa lo encontró `scripts/test-rls.sql` (caso
-- "Privilegios de anon sobre tablas de public", que exige 0 y devolvía 3):
-- `anon` quedaba con TRUNCATE, REFERENCES y TRIGGER. RLS **no protege de
-- TRUNCATE** -no filtra filas, las borra todas de una-, así que un visitante
-- sin sesión podía vaciar la cola y dejar a toda la familia sin recordatorios.
--
-- **Toda migración que agregue una tabla a `public` tiene que repetir este
-- revoke.**
-- =============================================================================

alter table public.appointment_reminders enable row level security;

revoke all on public.appointment_reminders from anon, authenticated;
grant select, insert, update, delete on public.appointment_reminders to service_role;


-- =============================================================================
-- 4. FUNCIONES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4.1 generar_recordatorios_pendientes()
-- -----------------------------------------------------------------------------
-- El corazón de la tarea. Corre cada 15 minutos y hace dos cosas:
--
--   (a) CADUCA lo que ya no tiene sentido mandar: avisos pendientes de turnos
--       que arrancaron, se cancelaron o se completaron mientras estaban en la
--       cola. Sin esto, apagar la máquina un fin de semana y prenderla el lunes
--       dispararía "tu turno es en 3 horas" de un turno del sábado.
--
--   (b) CREA las filas de las ventanas que ya vencieron y todavía no existen,
--       marcando como `pendiente` únicamente la MÁS PRÓXIMA AL TURNO y como
--       `omitido` a las demás (ver el encabezado de §2).
--
--   (c) COLAPSA los pendientes que se hayan acumulado entre corridas, dejando
--       vivo solo el más próximo al turno.
--
-- La elección de la más próxima es el `row_number() over (partition by turno
-- order by anticipacion asc)`: menor anticipación = más cerca del turno. En el
-- camino normal esa ventana es la única candidata (a T-7d solo venció la de 7
-- días), así que la ventana de `omitido` solo se usa cuando el turno se cargó
-- tarde, se reprogramó para dentro de poco, o el cron estuvo caído un rato
-- largo.
--
-- (b) y (c) son dos mitades de la misma regla y hacen falta las dos: (b)
-- resuelve varias ventanas que vencen a la vez, (c) resuelve varias ventanas
-- que vencieron en corridas distintas sin que nadie las haya entregado en el
-- medio. Sin (c), un barrido caído un día entero manda "mañana" y "en 3 horas"
-- juntos.
--
-- Devuelve cuántas filas creó (pendientes + omitidas), que es lo que loguea el
-- job.
create or replace function public.generar_recordatorios_pendientes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_creados integer;
begin
    -- (a) Caducidad. `enviando` entra también: si el barrido murió con la fila
    -- tomada y mientras tanto el turno pasó, no hay que reintentarlo.
    update public.appointment_reminders r
       set estado     = 'omitido',
           claimed_at = null
      from public.appointments a
     where a.id = r.appointment_id
       and r.estado in ('pendiente', 'enviando')
       and (a.appointment_date <= now() or a.status not in ('pending', 'confirmed'));

    -- (b) Alta de las ventanas vencidas.
    with debidas as (
        select a.id                                    as appointment_id,
               v.ventana,
               a.appointment_date - v.anticipacion     as due_at,
               row_number() over (
                   partition by a.id
                   order by v.anticipacion asc
               )                                       as cercania
          from public.appointments a
         cross join (values
                   ('7d',  interval '7 days'),
                   ('48h', interval '48 hours'),
                   ('24h', interval '24 hours'),
                   ('3h',  interval '3 hours')
               ) as v (ventana, anticipacion)
         where a.status in ('pending', 'confirmed')
           and a.appointment_date > now()
           and a.appointment_date - v.anticipacion <= now()
           and not exists (
                   select 1
                     from public.appointment_reminders r
                    where r.appointment_id = a.id
                      and r.ventana = v.ventana)
    )
    insert into public.appointment_reminders (appointment_id, ventana, due_at, estado)
    select d.appointment_id,
           d.ventana,
           d.due_at,
           case when d.cercania = 1 then 'pendiente' else 'omitido' end
      from debidas d
    -- Redundante con el `not exists` de arriba, y a propósito: es lo que hace
    -- que dos corridas simultáneas no puedan crear la misma fila dos veces.
    on conflict on constraint appointment_reminders_ventana_unica do nothing;

    get diagnostics v_creados = row_count;

    -- (c) Colapso ENTRE corridas.
    --
    -- El `row_number()` de (b) elige la ventana más próxima dentro de UNA
    -- corrida. No alcanza: si el barrido estuvo caído, las ventanas se van
    -- creando de a una en corridas distintas y cada una es la única candidata
    -- de su propia corrida, así que todas quedan `pendiente` y salen juntas
    -- cuando el barrido vuelve. Con un día de caída eso son dos notificaciones
    -- simultáneas del mismo turno diciendo "mañana" y "en 3 horas" — el mismo
    -- spam que (b) evita en el caso del turno cargado tarde.
    --
    -- De varios `pendiente` del mismo turno sobrevive el MÁS PRÓXIMO. Solo
    -- toca filas `pendiente`: una `enviando` ya está en vuelo y una `enviado`
    -- ya se le mostró a alguien; degradarlas sería reescribir la historia.
    update public.appointment_reminders r
       set estado = 'omitido'
     where r.estado = 'pendiente'
       and exists (
               select 1
                 from public.appointment_reminders mas_proximo
                where mas_proximo.appointment_id = r.appointment_id
                  and mas_proximo.estado = 'pendiente'
                  and mas_proximo.due_at > r.due_at);

    return v_creados;
end;
$$;

comment on function public.generar_recordatorios_pendientes() is
    'Materializa los recordatorios de turnos cuya ventana ya venció y caduca los que quedaron sin sentido. De varias ventanas vencidas a la vez para el mismo turno, solo la más próxima queda pendiente; las demás quedan omitido. Idempotente: correrla N veces seguidas crea las filas una sola vez.';


-- -----------------------------------------------------------------------------
-- 4.2 reclamar_recordatorios_turnos(limite)
-- -----------------------------------------------------------------------------
-- Saca de la cola hasta `p_limite` avisos y los deja en `enviando`, devolviendo
-- todo lo que hace falta para escribir el texto. El barrido de Node no toca la
-- tabla directamente: llama a esta función y a `cerrar_recordatorio_turno()`.
--
-- ── POR QUÉ ES UNA FUNCIÓN Y NO UN `select` DESDE PostgREST
--
-- `FOR UPDATE SKIP LOCKED` no se puede expresar por PostgREST, y sin él dos
-- barridos que se solapan -el cron de las 15:00 y un `curl` manual- leen la
-- misma fila y mandan la notificación dos veces. Con `SKIP LOCKED` el segundo
-- ni siquiera espera: se lleva otras filas y sigue.
--
-- ── EL LEASE DE 10 MINUTOS
--
-- Marcar `enviando` al tomar la fila (y no `enviado`) es la diferencia entre
-- **al menos una vez** y **como mucho una vez**. Si se marcara `enviado` antes
-- de mandar, un proceso que muere en el medio -deploy, timeout de Vercel- se
-- traga el aviso en silencio y nadie se entera hasta que alguien falta a un
-- turno. Marcando `enviando`, una fila que quedó tomada hace más de 10 minutos
-- vuelve a ser elegible.
--
-- El precio es un duplicado posible si un barrido tarda más de 10 minutos en
-- cerrar sus filas. Para este producto es el intercambio correcto -un aviso
-- repetido molesta, un aviso perdido es una consulta médica perdida- y además
-- el `tag` del payload (`turno-{id}-{ventana}`) hace que el segundo REEMPLACE
-- al primero en la pantalla del teléfono en vez de apilarse.
--
-- Las condiciones sobre el turno están repetidas de §4.1 a propósito: el
-- endpoint se puede llamar a mano sin que el generador haya corrido antes.
create or replace function public.reclamar_recordatorios_turnos(
    p_limite integer default 50
)
returns table (
    recordatorio_id  uuid,
    ventana          text,
    appointment_id   uuid,
    profile_id       uuid,
    especialidad     text,
    medico           text,
    fecha            timestamptz,
    lugar            text,
    preparacion      text
)
language sql
security definer
set search_path = ''
as $$
    with elegidos as (
        select r.id
          from public.appointment_reminders r
          join public.appointments a on a.id = r.appointment_id
         where r.due_at <= now()
           and a.status in ('pending', 'confirmed')
           and a.appointment_date > now()
           and (r.estado = 'pendiente'
                or (r.estado = 'enviando'
                    and r.claimed_at < now() - interval '10 minutes'))
         order by r.due_at
           for update of r skip locked
         limit greatest(p_limite, 0)
    ),
    tomados as (
        update public.appointment_reminders r
           set estado     = 'enviando',
               claimed_at = now()
          from elegidos e
         where r.id = e.id
        returning r.id, r.ventana, r.appointment_id
    )
    select t.id,
           t.ventana,
           t.appointment_id,
           a.profile_id,
           a.specialty,
           a.doctor_name,
           a.appointment_date,
           a.location_name,
           a.preparation_notes
      from tomados t
      join public.appointments a on a.id = t.appointment_id
     order by a.appointment_date;
$$;

comment on function public.reclamar_recordatorios_turnos(integer) is
    'Toma hasta p_limite recordatorios debidos con FOR UPDATE SKIP LOCKED, los deja en estado enviando con un lease de 10 minutos y devuelve los datos del turno para armar el texto. Entrega al-menos-una-vez: un barrido que muere deja la fila recuperable en vez de perder el aviso.';


-- -----------------------------------------------------------------------------
-- 4.3 cerrar_recordatorio_turno(id, entregas, fallos)
-- -----------------------------------------------------------------------------
-- Cierra el aviso después de haber intentado la entrega.
--
-- POLÍTICA: un recordatorio se considera enviado si se INTENTÓ a todos los
-- destinatarios, aunque alguna entrega individual haya fallado. Reintentar un
-- aviso completo porque uno de los tres teléfonos de la familia devolvió 503
-- volvería a notificar a los otros dos, que ya lo recibieron. Las suscripciones
-- muertas se dan de baja solas por el 404/410 (`lib/push/servidor.ts`) y el
-- resto de los fallos quedan contados en la columna `fallos`, que es donde se
-- mira si se sospecha que un aviso salió a la nada.
--
-- El `where estado = 'enviando'` hace la función idempotente y protege el caso
-- del lease vencido: si otro barrido ya reclamó y cerró la fila, este cierre no
-- pisa nada. Devuelve `true` solo si efectivamente cerró.
create or replace function public.cerrar_recordatorio_turno(
    p_id       uuid,
    p_entregas integer,
    p_fallos   integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_filas integer;
begin
    update public.appointment_reminders
       set estado   = 'enviado',
           sent_at  = now(),
           entregas = greatest(coalesce(p_entregas, 0), 0),
           fallos   = greatest(coalesce(p_fallos, 0), 0)
     where id = p_id
       and estado = 'enviando';

    get diagnostics v_filas = row_count;
    return v_filas > 0;
end;
$$;

comment on function public.cerrar_recordatorio_turno(uuid, integer, integer) is
    'Marca un recordatorio como enviado con el resumen de entregas y fallos. Un aviso se cierra si se intentó a todos los destinatarios: el fallo de una suscripción no reprograma el aviso para las demás.';


-- -----------------------------------------------------------------------------
-- 4.4 destinatarios_de_avisos(profile_id)
-- -----------------------------------------------------------------------------
-- Quién recibe un aviso sobre un perfil, según `docs/modelo-permisos.md` §4.3:
--
--   · el TITULAR, si tiene cuenta (`profiles.user_id`). Un perfil gestionado
--     -Roberto, el caso central del producto- no tiene, y ahí esta rama no
--     aporta a nadie.
--   · los `can_manage` sobre ese perfil, vía `granted_profile_id → user_id`.
--     Son "los responsables": la matriz de permisos dice textualmente que las
--     alertas van a `can_manage` y que **`can_view` y `can_upload` NO las
--     reciben**.
--
-- Que un `can_view` no reciba el recordatorio es intencional y es
-- minimización, no un olvido: Diego puede mirar el historial de su padre, pero
-- no es quien lo lleva al médico. Notificarlo sería contarle el turno a alguien
-- que no tiene nada que hacer con esa información.
--
-- `union` (no `union all`) porque el titular puede además tener un `can_manage`
-- sobre sí mismo por la fila de bootstrap: sin deduplicar, recibiría todo por
-- duplicado.
--
-- Se llama `destinatarios_de_avisos` y no `..._de_recordatorios` porque es
-- exactamente la misma regla para la medicación (Sprint 7) y la presión
-- (Sprint 9). Cuando esas tareas lleguen, reusan esta función.
create or replace function public.destinatarios_de_avisos(p_profile_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
    select p.user_id
      from public.profiles p
     where p.id = p_profile_id
       and p.user_id is not null
    union
    select g.user_id
      from public.family_permissions fp
      join public.profiles g on g.id = fp.granted_profile_id
     where fp.owner_profile_id = p_profile_id
       and fp.can_manage
       and g.user_id is not null;
$$;

comment on function public.destinatarios_de_avisos(uuid) is
    'Cuentas que reciben los avisos push sobre un perfil: su titular (si tiene cuenta) y todos los can_manage. Implementa docs/modelo-permisos.md §4.3 — los can_view y can_upload NO reciben alertas. Compartida por los recordatorios de turnos (6.4), medicación (Sprint 7) y presión (Sprint 9).';


-- -----------------------------------------------------------------------------
-- 4.5 recalcular_recordatorios_de_turno() — trigger
-- -----------------------------------------------------------------------------
-- Un turno que se mueve invalida lo que ya se dijo sobre él. El recálculo es
-- por BORRADO: se eliminan las filas y el generador vuelve a crear lo que
-- corresponda en la próxima corrida, sin ninguna lógica de "actualizar el
-- due_at" que podría dejar estados a medias.
--
-- ── SE CAMBIÓ LA FECHA → SE BORRA TODO, INCLUIDO LO YA ENVIADO
--
-- Es la parte contraintuitiva. La alternativa -borrar solo lo pendiente- tiene
-- un agujero real: un turno de hoy a las 15:00 que ya disparó sus avisos de
-- 24hs y 3hs y se reprograma para dentro de un mes conservaría esas dos filas
-- en `enviado`, y cuando llegue la nueva fecha el generador las vería
-- existentes y **no volvería a avisar**. La persona se quedaría sin
-- recordatorio del turno reprogramado, que es justo cuando más falta hace.
--
-- Borrar todo hace que la fecha nueva empiece de cero. El riesgo de spam que
-- esto abriría -mover un turno a mañana regenera 7d, 48h y 24h vencidas
-- juntas- ya está cubierto por la regla de "solo la más próxima" de §4.1: sale
-- UNA notificación, con el texto de la ventana correcta.
--
-- ── SE CANCELÓ O SE COMPLETÓ → SE BORRA SOLO LO PENDIENTE
--
-- Acá sí se conserva lo enviado: es el registro de lo que se le dijo a la
-- gente, y si el turno se vuelve a confirmar no hay por qué repetir un aviso
-- que ya se dio para esa misma fecha y hora.
create or replace function public.recalcular_recordatorios_de_turno()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.appointment_date is distinct from old.appointment_date then
        delete from public.appointment_reminders
         where appointment_id = new.id;

    elsif new.status is distinct from old.status
          and new.status not in ('pending', 'confirmed') then
        delete from public.appointment_reminders
         where appointment_id = new.id
           and estado in ('pendiente', 'enviando');
    end if;

    return null;
end;
$$;

comment on function public.recalcular_recordatorios_de_turno() is
    'Recalcula por borrado los recordatorios de un turno que cambió. Si cambió la fecha borra TODOS (incluidos los ya enviados: la fecha nueva merece sus propios avisos); si se canceló o completó borra solo los que no salieron.';

-- `of appointment_date, status` acota el disparo a los UPDATE que mencionan
-- esas columnas; los `is distinct from` de adentro filtran los que las mencionan
-- sin cambiarlas. Editar la dirección o las notas de un turno no toca nada.
create trigger appointments_recalcular_recordatorios
    after update of appointment_date, status on public.appointments
    for each row execute function public.recalcular_recordatorios_de_turno();


-- =============================================================================
-- 5. PRIVILEGIOS DE LAS FUNCIONES
-- -----------------------------------------------------------------------------
-- Todo esto es infraestructura: lo ejecutan el job de `pg_cron` (como
-- `postgres`) y el barrido de Node (como `service_role`). Ninguna sesión
-- `authenticated` tiene nada que hacer acá, y `destinatarios_de_avisos` en
-- particular no puede quedar expuesta: devuelve `user_id` de otras cuentas.
-- =============================================================================

revoke execute on function public.generar_recordatorios_pendientes()          from public;
revoke execute on function public.reclamar_recordatorios_turnos(integer)      from public;
revoke execute on function public.cerrar_recordatorio_turno(uuid, integer, integer) from public;
revoke execute on function public.destinatarios_de_avisos(uuid)               from public;

grant execute on function public.generar_recordatorios_pendientes()          to service_role;
grant execute on function public.reclamar_recordatorios_turnos(integer)      to service_role;
grant execute on function public.cerrar_recordatorio_turno(uuid, integer, integer) to service_role;
grant execute on function public.destinatarios_de_avisos(uuid)               to service_role;


-- =============================================================================
-- 6. CONFIGURACIÓN DEL DESTINO (Supabase Vault)
-- -----------------------------------------------------------------------------
-- El job necesita dos datos que NO pueden estar en el repositorio: a qué URL
-- postear y con qué secreto compartido firmarse. Van al **Vault de Supabase**
-- (`supabase_vault`, disponible en local y en hosted), que los guarda cifrados
-- y los expone descifrados solo a quien puede leer `vault.decrypted_secrets`
-- -no `anon`, no `authenticated`-.
--
-- Se eligió Vault sobre las dos alternativas obvias:
--   · `ALTER DATABASE ... SET app.secreto = '...'` deja el secreto en texto
--     plano en `pg_db_role_setting`, visible con un `\drds`, y se pierde en
--     cualquier `db reset`.
--   · Una tabla de configuración en `public` habría necesitado su propia RLS y
--     sería un secreto más para cuidar.
--
-- La URL es un parámetro y no una constante porque es lo único que cambia
-- entre entornos: en local apunta a `host.docker.internal:3000` (el contenedor
-- de Postgres llegando al `next dev` de Windows) y en producción a
-- `https://<dominio>/api/push/procesar-recordatorios`. El job es el mismo.
--
-- Se configura UNA vez por entorno, a mano (ver `docs/recordatorios.md` §4).
-- La migración crea la función pero NO los secretos: no hay ningún valor de
-- estos en el repositorio.
-- =============================================================================

create or replace function public.configurar_cron_recordatorios(
    p_url     text,
    p_secreto text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    if coalesce(btrim(p_url), '') = '' or coalesce(btrim(p_secreto), '') = '' then
        raise exception 'La URL y el secreto del cron de recordatorios no pueden estar vacíos'
            using errcode = '22023';
    end if;

    select id into v_id from vault.secrets where name = 'cron_recordatorios_url';
    if v_id is null then
        perform vault.create_secret(btrim(p_url), 'cron_recordatorios_url',
            'URL del endpoint que drena la cola de recordatorios de turnos (Sprint 6.4).');
    else
        perform vault.update_secret(v_id, btrim(p_url));
    end if;

    select id into v_id from vault.secrets where name = 'cron_recordatorios_secret';
    if v_id is null then
        perform vault.create_secret(btrim(p_secreto), 'cron_recordatorios_secret',
            'Mismo valor que la variable de entorno CRON_SECRET de la aplicación.');
    else
        perform vault.update_secret(v_id, btrim(p_secreto));
    end if;
end;
$$;

comment on function public.configurar_cron_recordatorios(text, text) is
    'Carga en el Vault la URL y el secreto compartido que usa el job de recordatorios. Se corre a mano una vez por entorno; el secreto nunca entra al repositorio. Solo el owner de la base (postgres) puede ejecutarla.';

-- Ni siquiera `service_role`: esto se configura desde psql o el SQL editor,
-- que corren como `postgres`. Una función que escribe secretos no tiene por
-- qué ser alcanzable desde una API key.
revoke execute on function public.configurar_cron_recordatorios(text, text) from public;


-- =============================================================================
-- 7. EL JOB
-- -----------------------------------------------------------------------------
-- `disparar_recordatorios_turnos()` es lo único que corre `pg_cron`: genera lo
-- que haya que generar y, si quedó algo pendiente, le avisa a la aplicación.
--
-- ── DEGRADA EN VEZ DE FALLAR
--
-- Si el Vault no está configurado -una base recién reseteada, un entorno nuevo-
-- la función NO lanza: genera las filas igual y avisa con un `warning`. Así, un
-- `supabase db reset` en medio del desarrollo no deja el job en rojo cada 15
-- minutos, y las filas pendientes salen en cuanto alguien configure la URL.
--
-- ── NO ESPERA LA RESPUESTA
--
-- `net.http_post` devuelve un id al instante y el POST lo hace un worker de
-- `pg_net` por atrás. El job termina en milisegundos y no se entera de si el
-- envío salió bien; eso se consulta en `net._http_response` (§5 de
-- `docs/recordatorios.md`). Es una propiedad deseable: el cron programa, no
-- entrega.
-- =============================================================================

create or replace function public.disparar_recordatorios_turnos()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_creados     integer;
    v_pendientes  integer;
    v_url         text;
    v_secreto     text;
    v_request_id  bigint;
begin
    v_creados := public.generar_recordatorios_pendientes();

    select count(*) into v_pendientes
      from public.appointment_reminders
     where estado = 'pendiente';

    if v_pendientes = 0 then
        return format('generados=%s pendientes=0 http=innecesario', v_creados);
    end if;

    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'cron_recordatorios_url';
    select decrypted_secret into v_secreto
      from vault.decrypted_secrets where name = 'cron_recordatorios_secret';

    if v_url is null or v_secreto is null then
        raise warning
            'Recordatorios: hay % pendientes pero el Vault no tiene cron_recordatorios_url / cron_recordatorios_secret. Ver docs/recordatorios.md §4.',
            v_pendientes;
        return format('generados=%s pendientes=%s http=sin-configurar', v_creados, v_pendientes);
    end if;

    select net.http_post(
               url     := v_url,
               body    := jsonb_build_object('origen', 'pg_cron'),
               headers := jsonb_build_object(
                              'Content-Type',  'application/json',
                              'x-cron-secret', v_secreto),
               timeout_milliseconds := 30000
           )
      into v_request_id;

    return format('generados=%s pendientes=%s request_id=%s',
                  v_creados, v_pendientes, v_request_id);
end;
$$;

comment on function public.disparar_recordatorios_turnos() is
    'Punto de entrada del job de pg_cron: genera los recordatorios debidos y le pide a la aplicación que drene la cola con un POST autenticado por x-cron-secret. Si el Vault no está configurado degrada con un warning en vez de fallar.';

revoke execute on function public.disparar_recordatorios_turnos() from public;

-- -----------------------------------------------------------------------------
-- 7.1 La programación
-- -----------------------------------------------------------------------------
-- Cada 15 minutos, como pide el roadmap. Es la frecuencia mínima que hace
-- honesta a la ventana de 3hs: el aviso sale a lo sumo 15 minutos después de
-- que la ventana vence, y el texto se calcula contra el reloj real en
-- `lib/turnos/recordatorios.ts`, así que ese retraso no produce un "en 3 horas"
-- cuando faltan 2h45m.
--
-- La expresión cron NO lleva zona horaria: `*/15 * * * *` es la misma cosa en
-- cualquier huso. La zona de Ushuaia importa en el texto, no en la
-- programación (ver el encabezado de la migración).
--
-- `cron.schedule` con un nombre ya existente REEMPLAZA el job, así que esta
-- migración es reaplicable.
select cron.schedule(
    'recordatorios-turnos',
    '*/15 * * * *',
    $cron$select public.disparar_recordatorios_turnos()$cron$
);

-- Fin de la migración.
