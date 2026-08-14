-- =============================================================================
-- Historial Médico — Migración 20260813070000: alerta preventiva de renovación
-- de receta (Sprint 7, tarea 7.4)
-- -----------------------------------------------------------------------------
-- El cierre del Sprint 7: cuando a una medicación le quedan menos de 5 días de
-- stock, la persona que la administra recibe un aviso push a tiempo para pedir
-- la receta, sin que nadie tenga que mirar la app todos los días.
--
-- ── LA DECISIÓN ARQUITECTÓNICA: NO HAY EDGE FUNCTION (otra vez)
--
-- El ROADMAP proponía `supabase/functions/alertas-medicacion/index.ts`. Se
-- descarta por exactamente los mismos motivos que ya dejó escritos
-- `20260813050000_recordatorios_turnos.sql` §encabezado y `docs/recordatorios.md`
-- §1 —"el Sprint 7 y el 9 van a copiar esta forma", decía textualmente—: el
-- envío Web Push del proyecto es `web-push`, que es **Node**, y una Edge
-- Function de Supabase corre en **Deno**. Mudarlo allá obliga a reimplementar
-- RFC 8291 con `SubtleCrypto`, o a duplicar la política de bajas 404/410, o a
-- copiar la clave privada VAPID en un segundo sistema de secretos.
--
-- Forma elegida, idéntica a la de los recordatorios:
--
--     pg_cron (2 veces por día)
--        └─ public.disparar_alertas_medicacion()
--              ├─ generar_alertas_medicacion()      ← umbral + antidup de 48hs
--              └─ net.http_post(URL de la app, header x-cron-secret)
--                    └─ POST /api/push/procesar-alertas-medicacion   (Node)
--                          ├─ reclamar_alertas_medicacion()  ← FOR UPDATE SKIP LOCKED
--                          ├─ destinatarios_de_avisos()      ← la MISMA de 6.4
--                          ├─ enviarPushAUsuario()           ← lib/push/servidor.ts
--                          └─ cerrar_alerta_medicacion()
--
-- ── EL UMBRAL NO SE ESCRIBE ACÁ
--
-- "Menos de 5 días" ya vive en `v_medicacion_estado.necesita_renovacion`
-- (`20260813060000_medicacion_estado.sql` §1, `docs/modelo-medicacion.md` §2.5:
-- "el umbral se define UNA vez, en la vista"). Esta migración **no repite el
-- `< 5`**: filtra por la columna. Cambiar el umbral sigue siendo una sola línea
-- en una sola migración.
--
-- ── POR QUÉ UN ENDPOINT NUEVO Y NO UNA EXTENSIÓN DEL DE RECORDATORIOS
--
-- Se evaluó drenar las dos colas desde `/api/push/procesar-recordatorios`. Se
-- descartó: son dos colas con leases independientes y textos distintos, y un
-- fallo de una no tiene por qué frenar la otra ni consumir su presupuesto de
-- `LIMITE_POR_CORRIDA`. Sobre todo, ese endpoint es el único camino verificado
-- contra un teléfono real (`docs/recordatorios.md` §8) y no hay ninguna razón
-- para tocarlo. El endpoint nuevo lo calca —misma autenticación, mismo lease,
-- misma política de cierre— sin compartir estado.
--
-- UTF-8 sin BOM. Todas las funciones con `set search_path = ''` y cada objeto
-- calificado con su esquema, igual que el resto del proyecto.
-- =============================================================================


-- =============================================================================
-- 1. TABLA medication_renewal_alerts
-- -----------------------------------------------------------------------------
-- Una fila = "el aviso de que la medicación M necesita renovación". La fila
-- existe recién cuando el aviso se vuelve DEBIDO (`necesita_renovacion` en
-- true), igual que `appointment_reminders`.
--
-- ── LA ANTIDUPLICACIÓN DE 48 HORAS, Y POR QUÉ ACÁ NO ALCANZA UN UNIQUE SOLO
--
-- Ésta es la diferencia de fondo con los recordatorios de turnos, y conviene
-- entenderla antes de leer el resto.
--
-- El aviso de un turno es un evento **discreto**: la ventana de 24hs de un
-- turno ocurre una vez y nunca más, así que `UNIQUE (appointment_id, ventana)`
-- expresa la antiduplicación entera, sin reloj.
--
-- "Quedan menos de 5 días de stock" no es un evento: es un **estado que se
-- sostiene en el tiempo**. Se mantiene verdadero día tras día hasta que alguien
-- carga la caja nueva —`docs/modelo-medicacion.md` §5 lo dice explícitamente:
-- "la alerta no se apaga sola, se apaga cuando alguien carga la caja nueva"—.
-- Un `UNIQUE (medication_id)` a secas avisaría UNA sola vez en la vida de la
-- medicación; el ROADMAP pide avisar cada 48 horas mientras el estado dure.
--
-- La regla, entonces, es una **ventana deslizante**, y se implementa en dos
-- capas que cubren dos problemas distintos:
--
--   1. **La regla de producto (48 hs)** — el predicado `not exists (... where
--      created_at > now() - interval '48 hours')` de `generar_alertas_
--      medicacion()` §4.1. Deslizante de verdad: cuenta desde el último aviso
--      REAL, no desde un cubo de calendario. Un cubo fijo (`floor(epoch/172800)`)
--      habría sido expresable como UNIQUE, pero permite dos avisos con minutos
--      de diferencia si caen a ambos lados del borde del cubo — que es
--      exactamente el caso que el criterio de aceptación prohíbe.
--
--   2. **La garantía estructural (concurrencia)** — el índice único PARCIAL
--      `medication_renewal_alerts_una_viva` sobre `(medication_id)` donde el
--      estado está vivo (`pendiente`/`enviando`). Dos corridas simultáneas del
--      generador evalúan el predicado de la capa 1 al mismo tiempo, las dos lo
--      pasan, y las dos intentan insertar: la segunda choca contra el índice y
--      el `ON CONFLICT DO NOTHING` la descarta. Sin esta capa la antiduplicación
--      dependería de que dos transacciones nunca se solapen, que es
--      precisamente lo que un `if` no puede garantizar.
--
-- La capa 1 sola es correcta en la corrida secuencial (el caso del criterio de
-- aceptación: "correr el job dos veces seguidas no duplica"); la capa 2 la hace
-- cierta también bajo concurrencia. Ninguna de las dos sobra.
--
-- Corolario del índice parcial: **nunca hay dos alertas vivas de la misma
-- medicación**. Si el barrido estuvo caído, la alerta vieja sigue `pendiente` y
-- no se apila una nueva encima; sale una sola cuando el barrido vuelva, con los
-- días restantes releídos de la vista en ese momento (§4.2).
--
-- ── LOS CUATRO ESTADOS
--
-- | estado      | qué significa                                                |
-- |-------------|--------------------------------------------------------------|
-- | `pendiente` | debido y todavía no entregado. Es la cola.                   |
-- | `enviando`  | un barrido lo tomó (lease de 10 min, ver §4.2)               |
-- | `enviado`   | se intentó la entrega a todos los destinatarios              |
-- | `omitido`   | no se manda: el stock se repuso (o la medicación se suspendió)|
--
-- `omitido` no se borra, y eso es deliberado: una fila borrada dejaría de
-- contar para la ventana de 48 horas, y una medicación que cruza el umbral,
-- se repone y vuelve a cruzarlo el mismo día produciría dos avisos seguidos.
-- La fila queda, con su rastro de por qué no salió.
-- =============================================================================

create table public.medication_renewal_alerts (
    id             uuid primary key default gen_random_uuid(),
    medication_id  uuid not null references public.medications (id) on delete cascade,
    profile_id     uuid not null references public.profiles (id)    on delete cascade,
    dias_restantes integer not null,
    estado         text not null default 'pendiente',
    claimed_at     timestamptz,
    sent_at        timestamptz,
    entregas       integer,
    fallos         integer,
    created_at     timestamptz not null default now(),

    constraint medication_renewal_alerts_estado_valido
        check (estado in ('pendiente', 'enviando', 'enviado', 'omitido')),
    -- Un aviso que dice "quedan −3 días" es un bug, no un dato: la vista solo
    -- enciende `necesita_renovacion` con `dias_restantes` entre 0 y 4.
    constraint medication_renewal_alerts_dias_no_negativos
        check (dias_restantes >= 0),
    -- `sent_at` y `estado` no pueden contradecirse: es la columna que decide si
    -- alguien ya recibió el aviso.
    constraint medication_renewal_alerts_sent_at_coherente
        check ((estado = 'enviado') = (sent_at is not null)),
    constraint medication_renewal_alerts_claimed_at_coherente
        check ((estado in ('pendiente', 'omitido')) = (claimed_at is null))
);

comment on table public.medication_renewal_alerts is
    'Infraestructura de la alerta preventiva de renovación de receta (Sprint 7.4). Una fila por aviso emitido sobre una medicación con menos de 5 días de stock (umbral de v_medicacion_estado.necesita_renovacion, nunca reimplementado acá). La antiduplicación de 48hs es un predicado deslizante en generar_alertas_medicacion() MÁS el índice único parcial medication_renewal_alerts_una_viva, que impide dos alertas vivas simultáneas de la misma medicación.';
comment on column public.medication_renewal_alerts.dias_restantes is
    'Días de stock que quedaban CUANDO SE ENCOLÓ el aviso. Es un registro histórico: el texto que se manda usa el valor releído de v_medicacion_estado en el momento del barrido, que puede ser menor si la cola se demoró.';
comment on column public.medication_renewal_alerts.estado is
    'pendiente (en la cola) · enviando (tomado por un barrido, lease de 10 min) · enviado (se intentó la entrega) · omitido (el stock se repuso o la medicación se suspendió antes de que el aviso saliera).';
comment on column public.medication_renewal_alerts.claimed_at is
    'Cuándo un barrido tomó la fila. Sirve para recuperar avisos que quedaron en enviando porque el proceso murió a mitad de camino.';
comment on column public.medication_renewal_alerts.sent_at is
    'Cuándo terminó el intento de entrega. No garantiza que la notificación se haya mostrado: eso el Push Service no lo informa.';
comment on column public.medication_renewal_alerts.entregas is
    'Cuántas suscripciones aceptaron el envío. Puede ser 0 con estado enviado: nadie tenía notificaciones activas.';
comment on column public.medication_renewal_alerts.fallos is
    'Cuántas suscripciones fallaron (revocadas, reintentables o rechazadas). Se guarda para poder ver desde SQL si un aviso salió a la nada.';

-- LA CAPA 2 DE LA ANTIDUPLICACIÓN (ver el encabezado de §1). Índice PARCIAL:
-- solo restringe a las filas vivas, así que dos avisos separados por 48hs
-- —donde el primero ya está `enviado`— conviven sin problema.
create unique index medication_renewal_alerts_una_viva
    on public.medication_renewal_alerts (medication_id)
 where estado in ('pendiente', 'enviando');

-- La consulta del barrido: "las vivas, más vieja primero". Parcial por el mismo
-- motivo que en `appointment_reminders`: las filas cerradas —que son el 100% de
-- la tabla pasadas unas horas— no se consultan nunca más por esta vía.
create index medication_renewal_alerts_cola_idx
    on public.medication_renewal_alerts (created_at)
 where estado in ('pendiente', 'enviando');

-- El predicado de las 48 horas (capa 1) filtra por medicación y fecha; el
-- índice único parcial de arriba no lo cubre porque solo indexa las vivas.
create index medication_renewal_alerts_antidup_idx
    on public.medication_renewal_alerts (medication_id, created_at desc);

-- La política de lectura del §2 filtra por perfil.
create index medication_renewal_alerts_profile_id_idx
    on public.medication_renewal_alerts (profile_id);


-- =============================================================================
-- 2. RLS Y PRIVILEGIOS
-- -----------------------------------------------------------------------------
-- Acá esta tabla SE APARTA de `appointment_reminders`, que tiene RLS habilitada
-- y cero políticas. La diferencia es que un aviso de renovación es un dato con
-- sentido para la familia —"¿ya nos avisaron de la Metformina?"— mientras que
-- un recordatorio de turno no agrega nada sobre el turno que la persona ya ve.
--
-- ── QUIÉN LEE: LOS MISMOS QUE RECIBEN EL AVISO
--
-- `puede_administrar_perfil` es el predicado de `can_manage`, que es
-- exactamente el conjunto de `destinatarios_de_avisos()` menos el titular sin
-- cuenta (`docs/modelo-permisos.md` §4.3). Quien recibe el push puede ver la
-- fila que lo generó; quien solo tiene `can_view` no ve ninguna de las dos
-- cosas, que es la misma decisión de minimización que ya tomó el Sprint 6.
--
-- ── NADIE ESCRIBE DESDE EL CLIENTE
--
-- No hay política de INSERT, UPDATE ni DELETE, y `authenticated` recibe
-- únicamente `SELECT` como privilegio de tabla. Las dos capas dicen lo mismo:
-- las filas las crean `pg_cron` (como `postgres`) y el barrido (como
-- `service_role`). Una sesión que pudiera borrar sus alertas podría también
-- desarmar la antiduplicación y hacerse mandar el mismo aviso en loop.
--
-- ── EL REVOKE NO ES DECORATIVO (la lección de 20260813050000 §3)
--
-- Supabase trae `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
-- authenticated`: **toda tabla nueva de `public` nace con TRUNCATE para los dos
-- roles públicos**, y RLS no protege de un TRUNCATE. Sin este revoke, un
-- visitante sin sesión podría vaciar la tabla —y con ella la antiduplicación—.
-- El caso "Privilegios de anon sobre tablas de public" del BLOQUE 7 de
-- `scripts/test-rls.sql` exige 0 y se pondría en rojo apenas se aplique esta
-- migración.
-- =============================================================================

alter table public.medication_renewal_alerts enable row level security;

revoke all on public.medication_renewal_alerts from anon, authenticated;
grant  select on public.medication_renewal_alerts to authenticated;
grant  select, insert, update, delete on public.medication_renewal_alerts to service_role;

create policy medication_renewal_alerts_select_administrador
    on public.medication_renewal_alerts
    for select to authenticated
    using (public.puede_administrar_perfil(profile_id));

comment on policy medication_renewal_alerts_select_administrador on public.medication_renewal_alerts is
    'Los administradores de un perfil (can_manage) leen sus alertas de renovación: son los mismos que reciben el push, según destinatarios_de_avisos(). No hay política de escritura a propósito — las filas las escriben pg_cron y el barrido con service_role, y una sesión que pudiera borrarlas desarmaría la antiduplicación de 48hs.';


-- =============================================================================
-- 3. LA MEDICACIÓN QUE CAMBIA INVALIDA SU ALERTA PENDIENTE
-- -----------------------------------------------------------------------------
-- Si alguien carga la caja nueva a las 10 de la mañana y el aviso todavía está
-- en la cola, mandarlo a las 18:10 sería avisar de un problema ya resuelto: la
-- clase de notificación que enseña a ignorar las notificaciones.
--
-- La caducidad la hace `generar_alertas_medicacion()` §4.1 (a), no un trigger,
-- y es a propósito: el criterio de caducidad es "ya no cumple
-- `necesita_renovacion`", una condición sobre una VISTA que depende del reloj
-- (`fecha_estimada_fin`, `vigente_hoy`). Un trigger sobre `medications` no se
-- dispararía cuando la condición deja de cumplirse por el paso del tiempo, solo
-- cuando alguien escribe. El barrido de cada corrida sí la evalúa completa.
--
-- El `ON DELETE CASCADE` de la FK cubre la otra mitad: borrar una medicación se
-- lleva sus alertas.
-- =============================================================================


-- =============================================================================
-- 4. FUNCIONES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4.1 generar_alertas_medicacion()
-- -----------------------------------------------------------------------------
-- Barre `v_medicacion_estado` y encola lo que corresponda. Dos pasos:
--
--   (a) CADUCA lo que ya no tiene sentido mandar: alertas vivas de medicaciones
--       que dejaron de necesitar renovación (se repuso el stock, se suspendió
--       la medicación —y entonces desaparece de la vista—, o dejó de estar
--       vigente).
--
--   (b) ENCOLA una alerta por cada medicación que necesita renovación y no
--       recibió ninguna en las últimas 48 horas.
--
-- ── POR QUÉ CORRE COMO `security definer` LEYENDO UNA VISTA `security_invoker`
--
-- `v_medicacion_estado` evalúa las políticas de `medications` contra quien
-- consulta. Dentro de esta función quien consulta es el dueño (`postgres`, que
-- tiene `BYPASSRLS`), así que la vista devuelve la medicación de TODAS las
-- familias — que es justo lo que un job de infraestructura necesita y lo que
-- ninguna sesión de usuario debe poder hacer. De ahí que §5 no le dé `EXECUTE`
-- a `authenticated`: mismo criterio que `generar_tomas_del_dia()`.
--
-- ── `vigente_hoy` FILTRA, Y NO ES UN DETALLE
--
-- Una medicación activa puede no estar vigente: un tratamiento que empieza el
-- mes que viene, o uno cuyo `end_date` ya pasó sin que nadie lo suspendiera
-- (`docs/modelo-medicacion.md` §11, límite 4). Avisar "renová la receta" de un
-- tratamiento terminado es ruido puro, y el ruido es lo que hace que la gente
-- apague las notificaciones.
--
-- ── LO QUE NO ENTRA POR CONSTRUCCIÓN
--
-- `as_needed` y las medicaciones sin stock cargado tienen `dias_restantes` en
-- NULL y por lo tanto `necesita_renovacion = false` (§3 y §2.2 del modelo). No
-- hay que excluirlas acá: la vista ya no las enciende. Es exactamente el motivo
-- por el que el umbral vive en la vista.
--
-- Devuelve cuántas alertas encoló, que es lo que loguea el job.
create or replace function public.generar_alertas_medicacion()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_creadas integer;
begin
    -- (a) Caducidad. `enviando` entra también: si el barrido murió con la fila
    -- tomada y mientras tanto alguien repuso el stock, no hay que reintentarlo.
    -- El `not exists` cubre de una sola vez los tres casos: la medicación ya no
    -- necesita renovación, dejó de estar vigente, o desapareció de la vista
    -- porque la suspendieron.
    update public.medication_renewal_alerts a
       set estado     = 'omitido',
           claimed_at = null
     where a.estado in ('pendiente', 'enviando')
       and not exists (
               select 1
                 from public.v_medicacion_estado v
                where v.medication_id = a.medication_id
                  and v.necesita_renovacion
                  and v.vigente_hoy);

    -- (b) Alta. El `not exists` de las 48 horas es la CAPA 1 de la
    -- antiduplicación (ver el encabezado de §1): ventana deslizante contra el
    -- último aviso real de esa medicación, cualquiera haya sido su desenlace
    -- —incluidos los `omitido`, para que reponer y volver a bajar el stock el
    -- mismo día no dispare dos avisos seguidos—.
    insert into public.medication_renewal_alerts (medication_id, profile_id, dias_restantes)
    select v.medication_id,
           v.profile_id,
           v.dias_restantes
      from public.v_medicacion_estado v
     where v.necesita_renovacion
       and v.vigente_hoy
       and not exists (
               select 1
                 from public.medication_renewal_alerts a
                where a.medication_id = v.medication_id
                  and a.created_at > now() - interval '48 hours')
    -- CAPA 2: inferencia del índice único parcial. Redundante con el `not
    -- exists` de arriba en el camino secuencial, y a propósito — es lo que hace
    -- que dos corridas simultáneas no puedan encolar la misma alerta dos veces.
    on conflict (medication_id) where estado in ('pendiente', 'enviando')
        do nothing;

    get diagnostics v_creadas = row_count;

    return v_creadas;
end;
$$;

comment on function public.generar_alertas_medicacion() is
    'Encola una alerta de renovación por cada medicación con v_medicacion_estado.necesita_renovacion (menos de 5 días de stock, umbral definido en la vista) que no haya recibido ninguna en las últimas 48 horas, y caduca como omitido las alertas vivas cuyo stock ya se repuso. Idempotente: correrla dos veces seguidas encola una sola vez, por el predicado de 48hs y por el índice único parcial medication_renewal_alerts_una_viva.';


-- -----------------------------------------------------------------------------
-- 4.2 reclamar_alertas_medicacion(limite)
-- -----------------------------------------------------------------------------
-- Saca de la cola hasta `p_limite` alertas, las deja en `enviando` y devuelve
-- todo lo que hace falta para escribir el texto. El barrido de Node no toca la
-- tabla: llama a esta función y a `cerrar_alerta_medicacion()`.
--
-- ── LOS DÍAS RESTANTES SE RELEEN DE LA VISTA, NO DE LA FILA
--
-- La columna `medication_renewal_alerts.dias_restantes` guarda cuántos días
-- quedaban al ENCOLAR. Esta función devuelve, en cambio, el valor actual de
-- `v_medicacion_estado`, que es el único honesto para el texto: si la alerta
-- esperó en la cola porque el barrido estuvo caído, decir "quedan 4 días"
-- cuando ya quedan 2 es la misma clase de error que `docs/recordatorios.md` §6
-- describe para los turnos ("en 3 horas" para un turno que es en 40 minutos).
-- La columna queda como registro histórico de por qué se disparó el aviso.
--
-- ── EL JOIN CONTRA LA VISTA ES TAMBIÉN UNA GUARDA
--
-- Solo se reclaman alertas cuya medicación SIGUE necesitando renovación y
-- vigente. Las condiciones están repetidas de §4.1 a propósito: el endpoint se
-- puede llamar a mano sin que el generador haya corrido antes, y en ese caso el
-- que filtra es este `join`.
--
-- ── EL LEASE DE 10 MINUTOS
--
-- Idéntico a `reclamar_recordatorios_turnos()` y por el mismo motivo: marcar
-- `enviando` (y no `enviado`) al tomar la fila es la diferencia entre **al
-- menos una vez** y **como mucho una vez**. Un proceso que muere en el medio
-- deja la fila recuperable a los 10 minutos en vez de tragarse el aviso en
-- silencio. El precio es un duplicado posible si un barrido tarda más de 10
-- minutos en cerrar, y el `tag` del payload (`medicacion-{id}`) hace que el
-- segundo REEMPLACE al primero en la pantalla del teléfono.
create or replace function public.reclamar_alertas_medicacion(
    p_limite integer default 50
)
returns table (
    alerta_id      uuid,
    medication_id  uuid,
    profile_id     uuid,
    nombre_perfil  text,
    nombre         text,
    dias_restantes integer,
    stock_units    numeric,
    dose_unit      text
)
language sql
security definer
set search_path = ''
as $$
    with elegidas as (
        select a.id
          from public.medication_renewal_alerts a
          join public.v_medicacion_estado v on v.medication_id = a.medication_id
         where v.necesita_renovacion
           and v.vigente_hoy
           and (a.estado = 'pendiente'
                or (a.estado = 'enviando'
                    and a.claimed_at < now() - interval '10 minutes'))
         order by a.created_at
           for update of a skip locked
         limit greatest(p_limite, 0)
    ),
    tomadas as (
        update public.medication_renewal_alerts a
           set estado     = 'enviando',
               claimed_at = now()
          from elegidas e
         where a.id = e.id
        returning a.id, a.medication_id, a.profile_id
    )
    select t.id,
           t.medication_id,
           t.profile_id,
           p.full_name,
           v.name,
           v.dias_restantes,
           v.stock_units,
           v.dose_unit
      from tomadas t
      join public.v_medicacion_estado v on v.medication_id = t.medication_id
      join public.profiles p            on p.id            = t.profile_id
     order by v.dias_restantes, v.name;
$$;

comment on function public.reclamar_alertas_medicacion(integer) is
    'Toma hasta p_limite alertas de renovación debidas con FOR UPDATE SKIP LOCKED, las deja en estado enviando con un lease de 10 minutos y devuelve los datos para armar el texto. Los días restantes salen de v_medicacion_estado en el momento del barrido, no de la fila: una alerta demorada tiene que decir los días que quedan de verdad. Entrega al-menos-una-vez.';


-- -----------------------------------------------------------------------------
-- 4.3 cerrar_alerta_medicacion(id, entregas, fallos)
-- -----------------------------------------------------------------------------
-- Misma política que `cerrar_recordatorio_turno()`: una alerta se considera
-- enviada si se INTENTÓ la entrega a todos los destinatarios, aunque alguna
-- suscripción individual haya fallado. Reintentar el aviso completo porque uno
-- de los tres teléfonos de la familia devolvió 503 volvería a notificar a los
-- otros dos, que ya lo recibieron. Las suscripciones muertas se dan de baja
-- solas por el 404/410 (`lib/push/servidor.ts`) y el resto queda contado en
-- `fallos`.
--
-- El `where estado = 'enviando'` la hace idempotente y protege el caso del
-- lease vencido: si otro barrido ya reclamó y cerró la fila, este cierre no
-- pisa nada. Devuelve `true` solo si efectivamente cerró.
create or replace function public.cerrar_alerta_medicacion(
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
    update public.medication_renewal_alerts
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

comment on function public.cerrar_alerta_medicacion(uuid, integer, integer) is
    'Marca una alerta de renovación como enviada con el resumen de entregas y fallos. Un aviso se cierra si se intentó a todos los destinatarios: el fallo de una suscripción no reprograma el aviso para las demás.';


-- =============================================================================
-- 5. PRIVILEGIOS DE LAS FUNCIONES
-- -----------------------------------------------------------------------------
-- Las tres son infraestructura: las ejecutan el job de `pg_cron` (como
-- `postgres`) y el barrido de Node (como `service_role`). `authenticated` no
-- tiene nada que hacer acá — `generar_alertas_medicacion()` y
-- `reclamar_alertas_medicacion()` recorren la base entera saltando RLS por ser
-- `SECURITY DEFINER`, y reclamar una alerta ajena permitiría mandarle un push a
-- otra familia.
--
-- `destinatarios_de_avisos()` no aparece acá: ya existe desde 6.4, con sus
-- privilegios correctos, y esta tarea la REUSA tal cual (era el motivo por el
-- que se llamó "de avisos" y no "de recordatorios").
-- =============================================================================

revoke execute on function public.generar_alertas_medicacion()                   from public;
revoke execute on function public.reclamar_alertas_medicacion(integer)           from public;
revoke execute on function public.cerrar_alerta_medicacion(uuid, integer, integer) from public;

grant execute on function public.generar_alertas_medicacion()                    to service_role;
grant execute on function public.reclamar_alertas_medicacion(integer)            to service_role;
grant execute on function public.cerrar_alerta_medicacion(uuid, integer, integer) to service_role;


-- =============================================================================
-- 6. CONFIGURACIÓN DEL DESTINO (Supabase Vault)
-- -----------------------------------------------------------------------------
-- ── EL SECRETO ES UNO SOLO, Y NO SE DUPLICA
--
-- `CRON_SECRET` es **una** variable de entorno de la aplicación, compartida por
-- todos los endpoints de cron. Guardarla dos veces en el Vault sería tener dos
-- copias que pueden divergir en silencio —y el síntoma de una divergencia es un
-- 401 silencioso que nadie mira hasta que falta un aviso—. Por eso esta función
-- recibe **solo la URL** y el job de §7 lee el secreto de
-- `cron_recordatorios_secret`, que ya carga `configurar_cron_recordatorios()`
-- (`docs/recordatorios.md` §4.2).
--
-- El nombre del secreto quedó atado al Sprint 6 por orden de llegada; su
-- alcance es el de todos los jobs. Renombrarlo obligaría a reconfigurar los
-- entornos ya andando a cambio de nada.
--
-- Si el secreto no está cargado, el job degrada con un `warning` que dice
-- exactamente qué correr (§7), en vez de fallar cada 12 horas.
--
-- Se configura UNA vez por entorno, a mano. La migración crea la función pero
-- NO el secreto: no hay ningún valor de estos en el repositorio.
-- =============================================================================

create or replace function public.configurar_cron_alertas_medicacion(p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    if coalesce(btrim(p_url), '') = '' then
        raise exception 'La URL del cron de alertas de medicación no puede estar vacía'
            using errcode = '22023';
    end if;

    select id into v_id from vault.secrets where name = 'cron_alertas_medicacion_url';
    if v_id is null then
        perform vault.create_secret(btrim(p_url), 'cron_alertas_medicacion_url',
            'URL del endpoint que drena la cola de alertas de renovación de receta (Sprint 7.4).');
    else
        perform vault.update_secret(v_id, btrim(p_url));
    end if;

    if not exists (select 1 from vault.secrets where name = 'cron_recordatorios_secret') then
        raise warning
            'La URL quedó cargada, pero el Vault todavía no tiene cron_recordatorios_secret. Corré configurar_cron_recordatorios(url, secreto) — el secreto es el mismo CRON_SECRET para los dos jobs. Ver docs/modelo-medicacion.md §12.';
    end if;
end;
$$;

comment on function public.configurar_cron_alertas_medicacion(text) is
    'Carga en el Vault la URL del endpoint que drena las alertas de renovación. NO recibe el secreto a propósito: CRON_SECRET es uno solo y lo carga configurar_cron_recordatorios() bajo el nombre cron_recordatorios_secret. Se corre a mano una vez por entorno; solo el owner de la base (postgres) puede ejecutarla.';

-- Ni siquiera `service_role`: esto se configura desde psql o el SQL editor, que
-- corren como `postgres`. Mismo criterio que `configurar_cron_recordatorios`.
revoke execute on function public.configurar_cron_alertas_medicacion(text) from public;


-- =============================================================================
-- 7. EL JOB
-- -----------------------------------------------------------------------------
-- `disparar_alertas_medicacion()` es lo único que corre `pg_cron`: genera lo
-- que haya que generar y, si quedó algo pendiente, le avisa a la aplicación.
-- Degrada con un `warning` si el Vault no está configurado, y no espera la
-- respuesta del POST (`pg_net` es asíncrono). Las dos propiedades están
-- argumentadas en `20260813050000_recordatorios_turnos.sql` §7.
-- =============================================================================

create or replace function public.disparar_alertas_medicacion()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_creadas    integer;
    v_pendientes integer;
    v_url        text;
    v_secreto    text;
    v_request_id bigint;
begin
    v_creadas := public.generar_alertas_medicacion();

    select count(*) into v_pendientes
      from public.medication_renewal_alerts
     where estado = 'pendiente';

    if v_pendientes = 0 then
        return format('generadas=%s pendientes=0 http=innecesario', v_creadas);
    end if;

    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'cron_alertas_medicacion_url';
    select decrypted_secret into v_secreto
      from vault.decrypted_secrets where name = 'cron_recordatorios_secret';

    if v_url is null or v_secreto is null then
        raise warning
            'Alertas de medicación: hay % pendientes pero el Vault no tiene cron_alertas_medicacion_url / cron_recordatorios_secret. Ver docs/modelo-medicacion.md §12.',
            v_pendientes;
        return format('generadas=%s pendientes=%s http=sin-configurar', v_creadas, v_pendientes);
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

    return format('generadas=%s pendientes=%s request_id=%s',
                  v_creadas, v_pendientes, v_request_id);
end;
$$;

comment on function public.disparar_alertas_medicacion() is
    'Punto de entrada del job de pg_cron: encola las alertas de renovación debidas y le pide a la aplicación que drene la cola con un POST autenticado por x-cron-secret. Si el Vault no está configurado degrada con un warning en vez de fallar.';

revoke execute on function public.disparar_alertas_medicacion() from public;


-- -----------------------------------------------------------------------------
-- 7.1 La programación: dos veces por día
-- -----------------------------------------------------------------------------
-- ── POR QUÉ NO CADA 15 MINUTOS COMO LOS TURNOS
--
-- Los recordatorios de turnos necesitan esa frecuencia porque la ventana de 3
-- horas es un instante que hay que perseguir. Acá el evento es un estado que
-- dura días: adelantar el aviso 15 minutos no cambia absolutamente nada para
-- quien tiene que pedir un turno con su médico o pasar por la farmacia. Correr
-- cada 15 minutos serían 96 barridos diarios para emitir, como mucho, un aviso
-- cada 48 horas por medicación.
--
-- ── POR QUÉ DOS Y NO UNA
--
-- Con una sola corrida diaria, una app caída en ese minuto atrasa el aviso 24
-- horas —sobre un stock que dura menos de 5 días, eso es el 20% del margen—.
-- Con dos, el peor caso es 12 horas. La antiduplicación de 48 hs es
-- independiente de la frecuencia, así que duplicar las corridas no puede
-- duplicar los avisos: es exactamente el criterio de aceptación del ROADMAP
-- ("correr el job dos veces seguidas no duplica la notificación"), aplicado al
-- diseño de la programación y no solo a la prueba.
--
-- ── LOS HORARIOS: 09:10 Y 18:10 DE USHUAIA
--
-- Las expresiones de `pg_cron` se interpretan en UTC (`cron.timezone` es un
-- parámetro de servidor que no se puede tocar desde una migración, ni en
-- Supabase hosted) y Argentina está en UTC−3 de forma continua desde 2009, sin
-- horario de verano: `10 12,21 * * *` es 09:10 y 18:10 locales.
--
-- Los dos son horarios en que una farmacia o un consultorio están abiertos, que
-- es la única forma de que el aviso sea accionable en el momento en que se lee.
-- Un aviso de renovación a las 3 de la mañana se ve recién a la mañana
-- siguiente, ya sin la notificación en pantalla. Y las 09:10 caen después de la
-- toma de las 8:00 —el horario más común del producto—, así que el stock que se
-- mira es el del día, ya descontado.
--
-- `cron.schedule` con un nombre ya existente REEMPLAZA el job, así que esta
-- migración es reaplicable.
select cron.schedule(
    'alertas-medicacion',
    '10 12,21 * * *',
    $cron$select public.disparar_alertas_medicacion()$cron$
);

-- Fin de la migración.
