-- =============================================================================
-- Historial Médico — Migración 20260818130000: conexión de Gmail por cuenta
-- (Sprint 17, tarea 17.1)
-- -----------------------------------------------------------------------------
-- ── QUÉ ES ESTO
--
-- El Sprint 17 conecta la casilla de Gmail de la persona para que la app lea
-- SOLO los correos que caen en la etiqueta `historialmedico` (turnos y
-- estudios que mandan las clínicas) y los lleve al flujo de ingesta con
-- revisión humana. Esta migración crea la base de ese circuito:
--
--   1. `public.gmail_connections` — UNA fila por CUENTA con el ESTADO de la
--      conexión: qué correo se conectó, desde cuándo, qué etiqueta se creó y
--      si el permiso sigue vivo o venció.
--   2. Cinco funciones `SECURITY DEFINER` que son el ÚNICO camino por el que
--      el `refresh_token` de Google entra y sale de la base.
--
-- ── LA DECISIÓN CENTRAL: EL REFRESH TOKEN VA AL VAULT, NO A UNA COLUMNA
--
-- Un `refresh_token` de Google es una credencial de larga vida: con él, y con
-- el `client_secret` de la aplicación, cualquiera puede pedir access tokens
-- nuevos y leer la casilla de esa persona hasta que ella revoque el permiso a
-- mano en su cuenta de Google. Es, con diferencia, el dato más peligroso que
-- esta base va a guardar — más que cualquier estudio, porque no es un dato
-- sino una LLAVE.
--
-- Se evaluaron las dos opciones reales:
--
--   · **Cifrado propio** (AES-256-GCM en TypeScript, clave en una variable de
--     entorno nueva). Descartado. Obliga a crear, cargar y custodiar un
--     secreto MÁS en `.env.local` y en Vercel — un paso manual del usuario en
--     cada entorno, y un modo de falla nuevo: si esa clave se pierde, los
--     tokens guardados quedan basura ilegible y todo el mundo tiene que
--     reconectar sin saber por qué. Además la clave terminaría viviendo al
--     lado de la `SUPABASE_SERVICE_ROLE_KEY`, en el mismo archivo y en el
--     mismo panel: quien se lleve una se lleva las dos, así que el cifrado
--     propio no agrega la separación que aparenta agregar.
--
--   · **Supabase Vault** (`supabase_vault`). ELEGIDO. El proyecto YA lo usa
--     en producción para los secretos de los crons (`20260813050000` §6 y
--     `20260813070000`), así que no se suma un mecanismo nuevo: se suma un
--     secreto al mecanismo que ya existe y que el usuario ya tiene
--     configurado. El valor se guarda cifrado con una clave raíz que **no
--     vive en el esquema `public`**: un `pg_dump` de `public`, una consulta
--     de más en una tabla del dominio o una política RLS mal escrita no
--     pueden exponerlo, porque el token no está ahí. Y los roles del
--     navegador no tienen NADA sobre el esquema `vault`: medido en esta base,
--     el ACL de `vault.decrypted_secrets` es
--     `supabase_admin=arwdDxtm, postgres=r*d*D*x*, service_role=rd` — `anon`
--     y `authenticated` ni siquiera aparecen. El BLOQUE 23 de
--     `scripts/test-rls.sql` lo prueba como caso centinela.
--
-- ── LO QUE **NO** GUARDA ESTA TABLA
--
-- - **Ningún access token.** Duran una hora y se piden frescos cada vez
--   (`lib/gmail/conexiones-admin.ts#obtenerAccessTokenGmail`). Guardarlos
--   sería multiplicar la superficie a cambio de ahorrar una llamada HTTP.
-- - **Ningún contenido de correo.** En esta tarea la app no lee ni un mensaje;
--   en la 17.2 leerá SOLO los de la etiqueta. Ver `docs/minimizacion-datos.md`
--   §9.
-- - **El `client_secret` de la aplicación**, que vive en `GOOGLE_CLIENT_SECRET`
--   y jamás toca la base ni el navegador.
--
-- ── POR QUÉ `user_id` Y NO `profile_id`
--
-- La casilla es de la CUENTA que inicia sesión, no del perfil que esa cuenta
-- esté mirando. María conecta SU Gmail una vez y los correos que lleguen se
-- van a poder derivar a cualquiera de los perfiles que administra (elección
-- humana, tarea 17.2). Colgar la conexión de un `profile_id` obligaría a
-- reconectar la misma casilla una vez por perfil y multiplicaría los tokens
-- guardados por N sin ganar nada. Mismo argumento que `consents`
-- (`20260814130000`) y que `profiles.display_density` (`20260814120000`).
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema, mismo criterio que el
-- resto del proyecto.
-- =============================================================================


-- =============================================================================
-- 1. gmail_connections — el ESTADO de la conexión (nunca el token)
-- =============================================================================

create table public.gmail_connections (
    -- PK y FK a la vez: una cuenta tiene a lo sumo UNA casilla conectada.
    -- Reconectar es un UPSERT sobre la misma fila, no una fila más — el
    -- historial de conexiones no aporta nada al producto y guardarlo sería
    -- retener direcciones de correo que la persona ya desconectó.
    user_id          uuid        primary key references auth.users (id) on delete cascade,

    -- La dirección de Gmail que se conectó, tal cual la devuelve
    -- `users.getProfile` de la API. Se muestra en la pantalla de estado para
    -- que la persona pueda confirmar de un vistazo QUÉ casilla conectó -si
    -- tiene dos cuentas de Google en el teléfono, es fácil consentir con la
    -- que no era-.
    email            text        not null,

    -- 'conectada' = el permiso sigue vivo · 'vencida' = Google contestó
    -- `invalid_grant` al refrescar (la persona revocó el acceso, o pasaron
    -- los 7 días que dura un refresh token mientras la pantalla de
    -- consentimiento esté "En prueba"). La app NO borra la fila cuando eso
    -- pasa: la deja en 'vencida' para poder decir "se venció, tocá para
    -- volver a conectar" en vez de "no tenés nada conectado", que es lo mismo
    -- que la persona vio la primera vez y no explica nada.
    status           text        not null default 'conectada',

    -- Id de la etiqueta `historialmedico` en la casilla de esa persona
    -- (formato `Label_123...`). La crea el callback si no existe, y si ya
    -- existía se guarda la que había. Es lo que la 17.2 va a pasar como
    -- `labelIds` para leer SOLO esos mensajes.
    label_id         text,

    -- El nombre visible de esa etiqueta. Se guarda aunque hoy sea siempre
    -- 'historialmedico' porque Gmail no permite dos etiquetas con el mismo
    -- nombre (ignorando mayúsculas) y, si la persona ya tenía una escrita
    -- distinto -"HistorialMedico"-, la app usa la suya y la pantalla tiene
    -- que poder mostrar el nombre REAL, no el que esperábamos.
    label_name       text        not null default 'historialmedico',

    -- Los scopes que Google efectivamente concedió (vienen en la respuesta
    -- del intercambio). Se guardan para poder diagnosticar el día que un
    -- barrido falle con 403: sirve para saber si la persona destildó un
    -- permiso en la pantalla de consentimiento. NO se le concede a
    -- `authenticated` (ver §2): es un dato de diagnóstico, no de la interfaz.
    granted_scopes   text,

    connected_at     timestamptz not null default now(),

    -- Última vez que Google entregó un access token sin protestar. Es el dato
    -- que dice "esto sigue funcionando" mejor que `connected_at`, que se
    -- queda quieto para siempre.
    last_ok_at       timestamptz,

    -- Cuándo se detectó el vencimiento. Va atado a `status` por un CHECK para
    -- que no pueda existir una conexión "vencida" sin fecha ni una "conectada"
    -- con fecha de vencimiento colgada de una conexión anterior.
    expired_at       timestamptz,

    -- Id de la fila de `vault.secrets` donde está el refresh token cifrado.
    -- **No es el token**: es un puntero a un lugar que ni `anon` ni
    -- `authenticated` pueden leer. Aun así, la columna NO se le concede a
    -- `authenticated` (§2): no hay una sola pantalla que la necesite, y la
    -- regla de este proyecto es conceder lo que se usa, no lo que no molesta.
    token_secret_id  uuid,

    constraint gmail_connections_email_no_vacio
        check (btrim(email) <> ''),
    constraint gmail_connections_status_valido
        check (status in ('conectada', 'vencida')),
    constraint gmail_connections_label_name_no_vacio
        check (btrim(label_name) <> ''),
    constraint gmail_connections_vencimiento_coherente
        check ((status = 'vencida') = (expired_at is not null))
);

comment on table public.gmail_connections is
    'Estado de la conexión de Gmail de una CUENTA (Sprint 17, tarea 17.1). Una fila por auth.users: qué casilla se conectó, desde cuándo, qué etiqueta se creó y si el permiso sigue vivo. NO guarda el refresh token -eso va cifrado al Vault de Supabase, ver el encabezado de la migración- ni ningún access token ni ningún contenido de correo. authenticated solo puede LEER su propia fila, y solo las columnas de estado (grant por columna); la escriben únicamente las cinco funciones SECURITY DEFINER de esta migración, alcanzables solo por service_role.';

comment on column public.gmail_connections.user_id is
    'La CUENTA dueña de la casilla, no un perfil: María conecta su Gmail una vez y después elige a qué perfil va cada correo (tarea 17.2). Mismo argumento que consents.user_id.';
comment on column public.gmail_connections.status is
    'conectada = el permiso sigue vivo · vencida = Google contestó invalid_grant al refrescar (permiso revocado, o los 7 días que dura un refresh token mientras la pantalla de consentimiento esté "En prueba"). La fila NO se borra al vencer: la pantalla necesita poder decir "se venció" y no "nunca conectaste".';
comment on column public.gmail_connections.label_id is
    'Id de la etiqueta historialmedico en esa casilla (Label_...). La crea el callback si no existe; si ya existía, se guarda la que había. Es el labelIds con el que la tarea 17.2 va a leer SOLO esos mensajes.';
comment on column public.gmail_connections.label_name is
    'Nombre visible REAL de la etiqueta. Casi siempre "historialmedico", pero si la persona ya tenía una escrita distinto (Gmail no admite dos que difieran solo en mayúsculas) se usa la suya y la pantalla muestra ese nombre.';
comment on column public.gmail_connections.granted_scopes is
    'Scopes que Google concedió de verdad, tal cual vienen en la respuesta del intercambio. Dato de diagnóstico (un 403 en un barrido futuro suele ser un permiso destildado en la pantalla de consentimiento): NO se le concede a authenticated.';
comment on column public.gmail_connections.last_ok_at is
    'Última vez que Google entregó un access token sin protestar. Es el "esto sigue andando" real; connected_at se queda quieto desde el día de la conexión.';
comment on column public.gmail_connections.token_secret_id is
    'Puntero a vault.secrets: dónde está el refresh token CIFRADO. No es el token. NO se le concede a authenticated —ninguna pantalla lo necesita— y el esquema vault no es alcanzable por anon ni authenticated de ninguna forma (BLOQUE 23 de scripts/test-rls.sql).';

-- La consulta típica de la 17.2 -"¿qué conexiones están vivas para barrer?"-
-- ordenada por la más vieja sin revisar. Sobre una tabla de una fila por
-- cuenta es barato y evita el seq scan cuando haya muchas familias.
create index gmail_connections_status_idx
    on public.gmail_connections (status, last_ok_at nulls first);


-- =============================================================================
-- 2. RLS Y PRIVILEGIOS — el dueño ve su ESTADO, nadie ve tokens
-- -----------------------------------------------------------------------------
-- La lección de siempre (`20260813050000` §3, `20260818100000` §3): el
-- `revoke all on all tables in schema public from anon, authenticated` de
-- `20260812220000_rls.sql` §4 fue una FOTO, no una regla viva. Toda tabla
-- nueva repite su propio revoke.
--
-- El modelo de acceso:
--
--   · `anon`          — NADA. No hay pantalla sin sesión que sepa de esto.
--   · `authenticated` — SELECT de SU PROPIA fila, y **solo de las columnas de
--                       estado**. `granted_scopes` y `token_secret_id` quedan
--                       fuera del GRANT: no es que estén protegidas por RLS,
--                       es que el privilegio de leerlas no existe. Un
--                       `select *` desde PostgREST responde 42501.
--   · `service_role`  — todo, porque es quien corre el callback y el barrido.
--
-- CERO privilegio de escritura para `authenticated` y CERO política de
-- INSERT/UPDATE/DELETE: los dos candados independientes de siempre. Aunque
-- alguien agregara mañana una política de escritura por error, sin el GRANT
-- no se escribe; y aunque otorgara el GRANT por error, sin política tampoco.
-- =============================================================================

alter table public.gmail_connections enable row level security;

revoke all on public.gmail_connections from anon, authenticated;

grant select (
    user_id,
    email,
    status,
    label_id,
    label_name,
    connected_at,
    last_ok_at,
    expired_at
) on public.gmail_connections to authenticated;

grant select, insert, update, delete on public.gmail_connections to service_role;

create policy gmail_connections_select_propia
    on public.gmail_connections
    for select
    to authenticated
    using (user_id = (select auth.uid()));

comment on policy gmail_connections_select_propia on public.gmail_connections is
    'Cada cuenta ve únicamente su propia conexión de Gmail. No hay visibilidad cruzada ni siquiera para quien administra un perfil gestionado: la casilla es de la CUENTA, no del perfil. Y aun dentro de la propia fila, las columnas granted_scopes y token_secret_id están fuera del GRANT por columna: la política decide QUÉ FILAS, el privilegio decide QUÉ COLUMNAS, y acá hacen falta los dos.';

-- Sin políticas de INSERT/UPDATE/DELETE, a propósito: conectar y desconectar
-- pasan por las funciones de §3, que corren con service_role desde el Route
-- Handler y la Server Action después de verificar la sesión.


-- =============================================================================
-- 3. LAS CINCO FUNCIONES — el único camino del refresh token
-- -----------------------------------------------------------------------------
-- Las cinco son `SECURITY DEFINER` con `set search_path = ''` (regla del
-- proyecto, docs/modelo-permisos.md §6), `revoke execute from public` y
-- `grant execute to service_role` — nunca a `authenticated`. Mismo patrón que
-- `reclamar_sincronizacion_refes` (`20260818100000` §5) y
-- `generar_alertas_medicacion` (`20260813070000` §6).
--
-- El nombre del secreto en el Vault es DETERMINÍSTICO:
-- `gmail_refresh_token_<user_id>`. No hace falta ir a buscarlo a ningún lado
-- para reescribirlo o borrarlo, y una fila de `gmail_connections` borrada a
-- mano no deja un secreto huérfano imposible de identificar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 guardar_conexion_gmail — la conexión entera, en una transacción
-- -----------------------------------------------------------------------------
-- Escribir el secreto y la fila por separado dejaría una ventana en la que
-- existe el token pero no la conexión (o al revés). Va todo junto: si algo
-- falla, no queda nada a medias.
create function public.guardar_conexion_gmail(
    p_usuario       uuid,
    p_email         text,
    p_refresh_token text,
    p_label_id      text,
    p_label_name    text,
    p_scopes        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_nombre_secreto text;
    v_secret_id      uuid;
begin
    if p_usuario is null then
        raise exception 'La conexión de Gmail necesita saber de qué cuenta es.'
            using errcode = '22023';
    end if;
    if coalesce(btrim(p_email), '') = '' then
        raise exception 'La conexión de Gmail necesita el correo conectado.'
            using errcode = '22023';
    end if;
    if coalesce(btrim(p_refresh_token), '') = '' then
        raise exception 'La conexión de Gmail necesita un refresh token no vacío.'
            using errcode = '22023';
    end if;

    v_nombre_secreto := 'gmail_refresh_token_' || p_usuario::text;

    select s.id into v_secret_id
      from vault.secrets s
     where s.name = v_nombre_secreto;

    if v_secret_id is null then
        v_secret_id := vault.create_secret(
            p_refresh_token,
            v_nombre_secreto,
            'Refresh token de Gmail de una cuenta de Historial Médico (Sprint 17). Entra y sale exclusivamente por public.guardar_conexion_gmail / public.leer_refresh_token_gmail.'
        );
    else
        perform vault.update_secret(v_secret_id, p_refresh_token);
    end if;

    insert into public.gmail_connections as g (
        user_id, email, status, label_id, label_name,
        granted_scopes, connected_at, last_ok_at, expired_at, token_secret_id
    )
    values (
        p_usuario,
        btrim(p_email),
        'conectada',
        nullif(btrim(coalesce(p_label_id, '')), ''),
        coalesce(nullif(btrim(coalesce(p_label_name, '')), ''), 'historialmedico'),
        nullif(btrim(coalesce(p_scopes, '')), ''),
        now(),
        now(),
        null,
        v_secret_id
    )
    on conflict (user_id) do update
       set email           = excluded.email,
           status          = 'conectada',
           -- `coalesce` y no `excluded.label_id` a secas: si una reconexión
           -- no pudo resolver la etiqueta (la API contestó 503 justo ahí), es
           -- mejor conservar la que ya se conocía que perderla.
           label_id        = coalesce(excluded.label_id, g.label_id),
           label_name      = excluded.label_name,
           granted_scopes  = coalesce(excluded.granted_scopes, g.granted_scopes),
           connected_at    = now(),
           last_ok_at      = now(),
           expired_at      = null,
           token_secret_id = excluded.token_secret_id;
end;
$$;

comment on function public.guardar_conexion_gmail(uuid, text, text, text, text, text) is
    'Guarda (o reconecta) la casilla de Gmail de una cuenta: cifra el refresh token en el Vault y deja el ESTADO en public.gmail_connections, todo en la misma transacción (Sprint 17, tarea 17.1). El secreto se llama gmail_refresh_token_<user_id>. Solo service_role puede ejecutarla: la llama app/api/gmail/callback/route.ts después de validar el state y la sesión.';

revoke execute on function public.guardar_conexion_gmail(uuid, text, text, text, text, text) from public;
grant  execute on function public.guardar_conexion_gmail(uuid, text, text, text, text, text) to service_role;


-- -----------------------------------------------------------------------------
-- 3.2 leer_refresh_token_gmail — la única lectura del token
-- -----------------------------------------------------------------------------
-- Devuelve NULL si la cuenta no tiene conexión o si el secreto desapareció,
-- y quien llama lo trata como "no hay conexión". No lanza: un `raise` acá
-- terminaría en un stack trace en los logs con el nombre del secreto al lado.
create function public.leer_refresh_token_gmail(p_usuario uuid)
returns text
language sql
security definer
set search_path = ''
as $$
    select s.decrypted_secret
      from public.gmail_connections c
      join vault.decrypted_secrets s on s.id = c.token_secret_id
     where c.user_id = p_usuario;
$$;

comment on function public.leer_refresh_token_gmail(uuid) is
    'Descifra el refresh token de Gmail de una cuenta. Es el ÚNICO camino de lectura del token y solo service_role puede ejecutarla (lib/gmail/conexiones-admin.ts). Devuelve NULL si no hay conexión, en vez de lanzar: un raise dejaría el nombre del secreto en los logs.';

revoke execute on function public.leer_refresh_token_gmail(uuid) from public;
grant  execute on function public.leer_refresh_token_gmail(uuid) to service_role;


-- -----------------------------------------------------------------------------
-- 3.3 marcar_conexion_gmail_vencida — el invalid_grant, sin drama
-- -----------------------------------------------------------------------------
-- Se llama cuando Google contesta `invalid_grant` al refrescar. NO borra la
-- fila ni el secreto: el secreto ya no sirve, pero borrarlo acá haría que la
-- pantalla no pudiera distinguir "se venció" de "nunca conectaste", que es
-- justo la diferencia que la persona necesita ver.
create function public.marcar_conexion_gmail_vencida(p_usuario uuid)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.gmail_connections
       set status     = 'vencida',
           expired_at = coalesce(expired_at, now())
     where user_id = p_usuario
       and status <> 'vencida';
$$;

comment on function public.marcar_conexion_gmail_vencida(uuid) is
    'Marca la conexión de Gmail como vencida cuando Google contesta invalid_grant (permiso revocado, o los 7 días del modo "En prueba"). No borra nada: la pantalla necesita poder ofrecer "Volver a conectar" y no "no tenés nada conectado". Idempotente.';

revoke execute on function public.marcar_conexion_gmail_vencida(uuid) from public;
grant  execute on function public.marcar_conexion_gmail_vencida(uuid) to service_role;


-- -----------------------------------------------------------------------------
-- 3.4 marcar_conexion_gmail_activa — el latido
-- -----------------------------------------------------------------------------
create function public.marcar_conexion_gmail_activa(p_usuario uuid)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.gmail_connections
       set status     = 'conectada',
           expired_at = null,
           last_ok_at = now()
     where user_id = p_usuario;
$$;

comment on function public.marcar_conexion_gmail_activa(uuid) is
    'Deja constancia de que Google acaba de entregar un access token sin protestar (last_ok_at) y, si la conexión estaba marcada vencida por un invalid_grant transitorio, la revive. Idempotente.';

revoke execute on function public.marcar_conexion_gmail_activa(uuid) from public;
grant  execute on function public.marcar_conexion_gmail_activa(uuid) to service_role;


-- -----------------------------------------------------------------------------
-- 3.5 borrar_conexion_gmail — desconectar de verdad
-- -----------------------------------------------------------------------------
-- Desconectar tiene que llevarse las DOS cosas: la fila y el secreto. Se borra
-- el secreto por NOMBRE y no solo por el `token_secret_id` de la fila, para
-- que un puntero que quedó desincronizado -por ejemplo, una fila borrada a
-- mano en el panel de Supabase- no deje el token cifrado ahí para siempre.
--
-- La revocación contra Google la hace la aplicación ANTES de llamar acá
-- (`app/(app)/(con-nav)/perfil/gmail/actions.ts`): si esa llamada falla
-- -Google caído, token ya revocado-, el borrado local se hace igual. Es la
-- decisión correcta: dejar la fila "por las dudas" le mostraría a la persona
-- una conexión que ella ya pidió cortar.
create function public.borrar_conexion_gmail(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    delete from public.gmail_connections where user_id = p_usuario;
    delete from vault.secrets where name = 'gmail_refresh_token_' || p_usuario::text;
end;
$$;

comment on function public.borrar_conexion_gmail(uuid) is
    'Desconecta la casilla: borra la fila de gmail_connections Y el secreto del Vault (por nombre determinístico, para no dejar tokens huérfanos). La revocación contra Google la intenta la Server Action antes de llamar acá; si falla, el borrado local se hace igual. Idempotente.';

revoke execute on function public.borrar_conexion_gmail(uuid) from public;
grant  execute on function public.borrar_conexion_gmail(uuid) to service_role;


-- =============================================================================
-- 4. LA BAJA DE CUENTA SE LLEVA EL TOKEN
-- -----------------------------------------------------------------------------
-- El `on delete cascade` del `user_id` borra la FILA cuando se borra la
-- cuenta, pero el secreto del Vault no cuelga de ninguna FK: sin este trigger
-- quedaría cifrado ahí para siempre, sobreviviendo al ejercicio del derecho de
-- supresión (Ley 25.326, arts. 14-16). El trigger va sobre `gmail_connections`
-- y no sobre `auth.users` a propósito: esa tabla no es de `postgres` (la tiene
-- `supabase_auth_admin`) y ya se pagó esa lección en
-- `20260814140000_alta_de_cuenta.sql`. Colgando de la propia tabla cubre las
-- dos vías por igual — la baja de cuenta y el borrado directo de la fila.
-- =============================================================================

create function public.gmail_conexion_borrar_secreto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    delete from vault.secrets where name = 'gmail_refresh_token_' || old.user_id::text;
    return old;
end;
$$;

comment on function public.gmail_conexion_borrar_secreto() is
    'Trigger AFTER DELETE de gmail_connections: se lleva el refresh token del Vault junto con la fila. Cubre la baja de cuenta (ON DELETE CASCADE del user_id), el borrado por borrar_conexion_gmail y cualquier delete manual. Sin esto, el token cifrado sobreviviría al derecho de supresión.';

revoke execute on function public.gmail_conexion_borrar_secreto() from public;

create trigger gmail_connections_borrar_secreto
    after delete on public.gmail_connections
    for each row
    execute function public.gmail_conexion_borrar_secreto();

comment on trigger gmail_connections_borrar_secreto on public.gmail_connections is
    'Borra el secreto del Vault cuando desaparece la fila de conexión, por la vía que sea (baja de cuenta, desconexión, borrado manual).';

-- Fin de la migración.
