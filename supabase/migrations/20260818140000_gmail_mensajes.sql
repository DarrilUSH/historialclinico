-- =============================================================================
-- Historial Médico — Migración 20260818140000: el registro de lo que llegó por
-- Gmail y los filtros aprendidos por remitente (Sprint 17, tarea 17.2)
-- -----------------------------------------------------------------------------
-- ── QUÉ ES ESTO
--
-- La 17.1 conectó la casilla y dejó la etiqueta `historialmedico` creada. Esta
-- migración es la base del BARRIDO: la app mira esa etiqueta cada tanto, y de
-- lo que encuentra deja constancia acá para poder (a) no volver a procesar dos
-- veces el mismo correo y (b) mostrarle a la persona una bandeja de "llegaron
-- por Gmail" que termina, siempre, en las pantallas de revisión que ya existen.
--
--   1. `public.gmail_messages` — UNA fila por CORREO YA MIRADO. Es el registro
--      de dedup y la bandeja de pendientes.
--   2. `public.gmail_filters` — los filtros que la app creó en Gmail a pedido
--      de la persona ("los próximos correos de turnos@clinica.com van solos a
--      la etiqueta"), para poder listarlos y borrarlos desde la aplicación.
--   3. El job de `pg_cron` que dispara el barrido periódico, con el MISMO
--      patrón que los recordatorios (`20260813050000` §6 y §7).
--
-- ── LA DECISIÓN CENTRAL: ESTA TABLA GUARDA METADATOS, NO CORREO
--
-- Lo que se guarda de cada mensaje es: su id de Gmail, quién lo mandó, el
-- asunto, la fecha, qué se encontró adentro (adjuntos aptos, o pinta de aviso
-- de turno) y en qué terminó. **El cuerpo del correo NO se guarda nunca**, ni
-- entero ni recortado, ni el `snippet` que devuelve la API -que es cuerpo-.
-- Los adjuntos TAMPOCO se descargan durante el barrido: de cada uno queda un
-- DESCRIPTOR (nombre, tipo, tamaño y el `attachmentId` con el que Gmail lo
-- entrega), y los bytes recién viajan cuando la persona toca "Revisar este
-- estudio" — momento en el que entran por el MISMO
-- `lib/documentos/ingesta.ts` que usa una subida a mano.
--
-- Esto no es prolijidad: es lo que hace que un barrido automático que corre
-- sin nadie mirando no pueda acumular datos de salud que nadie pidió. Lo que
-- la app junta sola son metadatos de sobre; lo que entra al historial lo
-- decide una persona, una por una. `docs/minimizacion-datos.md` §10.6 lo
-- declara con esas palabras.
--
-- Por qué SÍ se guardan remitente y asunto -que son datos de la casilla de la
-- persona-: sin el remitente no hay filtro aprendido que ofrecer ("¿los
-- próximos de este los traemos solos?") ni forma de reconocer al laboratorio
-- de siempre, y sin el asunto la bandeja sería una lista de fechas sin
-- ninguna manera de saber qué es cada cosa antes de abrirla. Son el mínimo
-- que hace usable la revisión humana, y se van con la cuenta (§4).
--
-- ── POR QUÉ EL BARRIDO NO CREA FILAS EN `documents`
--
-- La tentación era que el barrido bajara los adjuntos y creara el documento
-- "pendiente de confirmar" de una. No se hace, por tres razones que se suman:
--
--   · **La confirmación existente no lo permitiría.** El RPC
--     `confirmar_documento_recien_subido` (`20260813010000`) exige que quien
--     confirma sea el CREADOR (`created_by_profile_id = perfil_actor()`) y que
--     no haya pasado más de UNA HORA desde `created_at`. Un correo que llega a
--     las 3 de la mañana y se revisa a las 9 llegaría a la pantalla de revisión
--     con la ventana vencida; y un documento creado por `service_role` no tiene
--     perfil creador que sellar. Habría que relajar esas dos guardas -que son
--     de las mejores que tiene el proyecto- para acomodar un caso que se
--     resuelve sin tocarlas.
--   · **A qué PERFIL va cada correo es una decisión humana.** La casilla es de
--     la CUENTA (ver el encabezado de `20260818130000`), y una cuenta
--     administra varios perfiles. Elegir por ella sería adivinar de quién es
--     el estudio.
--   · **El barrido tiene que ser corto.** Corre en una función serverless del
--     plan gratuito; bajar y subir adjuntos de hasta 25 MB por correo la
--     convertiría en una corrida de minutos.
--
-- Entonces el barrido registra, y la INGESTA ocurre cuando la persona toca el
-- ítem: con SU sesión, sobre el perfil ACTIVO, por `ingestarDocumento`, y
-- aterrizando en `/estudios/nuevo/procesando` —la pantalla de revisión de
-- siempre, con su hora recién arrancada y su creador bien sellado—. El
-- `document_id` de la fila queda como puntero de "esto terminó siendo aquello".
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema.
-- =============================================================================


-- =============================================================================
-- 1. gmail_messages — el registro de dedup y la bandeja de pendientes
-- =============================================================================

create table public.gmail_messages (
    id                     uuid        primary key default gen_random_uuid(),

    -- La CUENTA dueña de la casilla, igual que en `gmail_connections`. Es FK a
    -- `auth.users` y NO a `gmail_connections(user_id)` a propósito: si colgara
    -- de la conexión, desconectar borraría el registro entero y la siguiente
    -- reconexión volvería a importar todo lo ya revisado. Y las reconexiones
    -- no son un caso raro: mientras la pantalla de consentimiento de Google
    -- siga "En prueba", el permiso caduca cada 7 días. El dedup tiene que
    -- sobrevivir a eso.
    user_id                uuid        not null references auth.users (id) on delete cascade,

    -- El id del mensaje EN GMAIL. Junto con `user_id` forma la clave de dedup:
    -- es lo único que hace que una pasada no vuelva a proponer lo que la
    -- persona ya descartó.
    gmail_message_id       text        not null,

    -- A qué casilla llegó, tal como estaba conectada en ese momento. Se guarda
    -- como TEXTO y no como FK: si mañana la persona conecta otra dirección,
    -- las filas viejas tienen que poder seguir diciendo la verdad sobre de
    -- dónde vinieron.
    connection_email       text        not null,

    -- Quién lo mandó. La dirección va normalizada a minúsculas (es lo que se
    -- compara contra los filtros aprendidos) y el nombre visible aparte, tal
    -- cual venía en el header `From`.
    from_email             text        not null,
    from_name              text,

    -- El asunto, recortado. Es lo único que le permite a la persona reconocer
    -- un correo en la bandeja sin abrirlo.
    subject                text,

    -- La fecha del mensaje (el `internalDate` de Gmail, en milisegundos epoch,
    -- ya convertido). Ordena la bandeja: lo más nuevo primero.
    message_date           timestamptz,

    -- Qué se encontró adentro:
    --   'documento' — tiene al menos un adjunto apto para el pipeline.
    --   'turno'     — sin adjuntos aptos, pero el cuerpo tiene pinta de aviso
    --                 de turno según la heurística barata de
    --                 `lib/gmail/heuristica-turno.ts`.
    --   'nada'      — ni una cosa ni la otra. Se registra igual, en estado
    --                 'descartado', para no volver a mirarlo en cada pasada.
    kind                   text        not null default 'nada',

    -- `true` si el cuerpo tenía pinta de aviso de turno, aunque `kind` haya
    -- quedado en 'documento' porque además traía un adjunto. Es lo que permite
    -- que la bandeja ofrezca los DOS caminos en un correo que trae la orden en
    -- PDF y el día y la hora en el texto.
    looks_like_appointment boolean     not null default false,

    -- Descriptores de los adjuntos, NUNCA sus bytes. Cada elemento:
    --   { "attachmentId": "...", "filename": "orden.pdf",
    --     "mimeType": "application/pdf", "size": 51234,
    --     "apto": true, "motivo": null }
    -- `apto: false` con su `motivo` ('demasiado_grande', 'tipo_no_soportado')
    -- se guarda igual: la bandeja tiene que poder explicar por qué un adjunto
    -- que la persona VE en su correo no se ofrece para importar.
    attachments            jsonb       not null default '[]'::jsonb,

    -- 'pendiente_revision' — esperando que una persona lo mire.
    -- 'ingresado'          — terminó en un documento o en un turno del historial.
    -- 'descartado'         — la persona lo descartó, o el barrido no encontró
    --                        nada que ofrecer (`kind = 'nada'`).
    status                 text        not null default 'pendiente_revision',

    -- En qué terminó. Los dos son ON DELETE SET NULL: si el documento o el
    -- turno se borran después, la fila del registro no se puede perder -es lo
    -- que impide que el correo se vuelva a proponer- pero deja de apuntar a
    -- algo que ya no existe.
    document_id            uuid        references public.documents (id)    on delete set null,
    appointment_id         uuid        references public.appointments (id) on delete set null,

    -- Cuándo lo vio el barrido y cuándo se resolvió.
    detected_at            timestamptz not null default now(),
    resolved_at            timestamptz,

    constraint gmail_messages_unico_por_cuenta
        unique (user_id, gmail_message_id),
    constraint gmail_messages_message_id_no_vacio
        check (btrim(gmail_message_id) <> ''),
    constraint gmail_messages_from_no_vacio
        check (btrim(from_email) <> ''),
    constraint gmail_messages_kind_valido
        check (kind in ('documento', 'turno', 'nada')),
    constraint gmail_messages_status_valido
        check (status in ('pendiente_revision', 'ingresado', 'descartado')),
    -- Un pendiente no tiene fecha de resolución, y un resuelto siempre la
    -- tiene. Mismo criterio que el CHECK de vencimiento de gmail_connections.
    constraint gmail_messages_resolucion_coherente
        check ((status = 'pendiente_revision') = (resolved_at is null)),
    constraint gmail_messages_adjuntos_es_lista
        check (jsonb_typeof(attachments) = 'array')
);

comment on table public.gmail_messages is
    'Un correo de la etiqueta historialmedico YA MIRADO por el barrido (Sprint 17, tarea 17.2). Es a la vez el registro de dedup -sin él cada pasada volvería a proponer lo mismo- y la bandeja de "llegaron por Gmail". Guarda METADATOS: remitente, asunto, fecha y descriptores de adjuntos. NUNCA el cuerpo del correo, ni el snippet, ni los bytes de ningún adjunto: eso viaja recién cuando una persona toca el ítem, y entra por el mismo lib/documentos/ingesta.ts que una subida a mano. Ver docs/minimizacion-datos.md §10.6.';

comment on column public.gmail_messages.user_id is
    'La CUENTA dueña de la casilla. FK a auth.users y no a gmail_connections: el dedup tiene que sobrevivir a una desconexión/reconexión, que con la pantalla de consentimiento "En prueba" ocurre cada 7 días.';
comment on column public.gmail_messages.gmail_message_id is
    'Id del mensaje en Gmail. Con user_id forma la clave de dedup (UNIQUE): es lo único que impide que una pasada vuelva a proponer lo que ya se descartó.';
comment on column public.gmail_messages.kind is
    'documento = trae al menos un adjunto apto · turno = sin adjuntos aptos pero el cuerpo tiene pinta de aviso de turno · nada = ni una cosa ni la otra (se registra igual, ya descartado, para no volver a mirarlo).';
comment on column public.gmail_messages.looks_like_appointment is
    'El cuerpo tenía pinta de aviso de turno, aunque kind sea "documento" por traer también un adjunto. Permite ofrecer los dos caminos en el correo que manda la orden en PDF y el día y la hora en el texto.';
comment on column public.gmail_messages.attachments is
    'Descriptores de los adjuntos, NUNCA sus bytes: attachmentId, filename, mimeType, size, apto y motivo. Los no aptos se guardan igual, con su motivo, para poder explicar por qué un adjunto que la persona ve en su correo no se ofrece para importar.';
comment on column public.gmail_messages.status is
    'pendiente_revision = esperando a una persona · ingresado = terminó en un documento o un turno · descartado = la persona lo descartó, o no había nada que ofrecer.';
comment on column public.gmail_messages.document_id is
    'El documento que salió de este correo, si salió alguno. ON DELETE SET NULL: borrar el documento no puede borrar la fila del registro, porque entonces el correo se volvería a proponer.';
comment on column public.gmail_messages.appointment_id is
    'El turno que salió de este correo, si salió alguno. Mismo criterio de ON DELETE SET NULL que document_id.';

-- La consulta de la bandeja: los pendientes de una cuenta, lo más nuevo
-- primero. También sirve al contador de la card de /inicio.
create index gmail_messages_bandeja_idx
    on public.gmail_messages (user_id, status, message_date desc nulls last);

-- El cruce del dedup en cada pasada: "de estos 20 ids, ¿cuáles ya vi?".
create index gmail_messages_dedup_idx
    on public.gmail_messages (user_id, gmail_message_id);


-- =============================================================================
-- 2. gmail_filters — los filtros que la app creó, para que se puedan deshacer
-- -----------------------------------------------------------------------------
-- El filtro VIVE EN GMAIL, no acá: es una regla de la casilla de la persona
-- ("de X → poner etiqueta historialmedico"). Esta tabla es el registro de
-- CUÁLES creó esta aplicación, y existe por una sola razón: para que se puedan
-- listar y borrar desde la app. Sin ella, la persona que tocara "sí, traelos
-- solos" tres veces tendría tres reglas nuevas en su Gmail y ninguna forma de
-- encontrarlas de vuelta salvo entrar a la configuración de Gmail en una
-- computadora. Crear reglas invisibles en la casilla de alguien y no darle el
-- botón de deshacerlas sería exactamente lo contrario del compromiso del §10
-- de minimización.
-- =============================================================================

create table public.gmail_filters (
    id              uuid        primary key default gen_random_uuid(),
    user_id         uuid        not null references auth.users (id) on delete cascade,

    -- El id del filtro EN GMAIL. Es lo que hace falta para borrarlo
    -- (`users.settings.filters.delete`).
    gmail_filter_id text        not null,

    -- El remitente de la regla, normalizado a minúsculas. Es la clave "de
    -- negocio": un remitente, un filtro.
    from_email      text        not null,

    -- La etiqueta que el filtro agrega. Se guarda el id y el nombre visible
    -- por el mismo motivo que en gmail_connections: la etiqueta puede llamarse
    -- distinto si la persona ya tenía una escrita de otra forma.
    label_id        text        not null,
    label_name      text        not null default 'historialmedico',

    created_at      timestamptz not null default now(),

    constraint gmail_filters_unico_remitente
        unique (user_id, from_email),
    constraint gmail_filters_unico_id_en_gmail
        unique (user_id, gmail_filter_id),
    constraint gmail_filters_from_no_vacio
        check (btrim(from_email) <> ''),
    constraint gmail_filters_label_no_vacio
        check (btrim(label_id) <> '')
);

comment on table public.gmail_filters is
    'Filtros de Gmail que ESTA aplicación creó a pedido de la persona (Sprint 17, tarea 17.2): "de tal remitente → etiqueta historialmedico". El filtro vive en Gmail; esta tabla existe para poder listarlos y BORRARLOS desde la app. Crear reglas en la casilla de alguien sin darle el botón de deshacerlas sería lo contrario del compromiso de docs/minimizacion-datos.md §10.';

comment on column public.gmail_filters.gmail_filter_id is
    'Id del filtro en Gmail. Es lo único que hace falta para borrarlo con users.settings.filters.delete.';
comment on column public.gmail_filters.from_email is
    'Remitente de la regla, en minúsculas. UNIQUE por cuenta: un remitente, un filtro — y así el botón "traer solos los de este" es idempotente.';

create index gmail_filters_por_cuenta_idx
    on public.gmail_filters (user_id, created_at desc);


-- =============================================================================
-- 3. RLS Y PRIVILEGIOS — el dueño mira, service_role escribe
-- -----------------------------------------------------------------------------
-- La lección de siempre (`20260812220000_rls.sql` §4 fue una FOTO, no una
-- regla viva): toda tabla nueva repite su propio revoke.
--
--   · `anon`          — NADA en las dos tablas.
--   · `authenticated` — SELECT de SUS PROPIAS filas. Nada de escribir.
--   · `service_role`  — todo: es quien corre el barrido y las acciones.
--
-- **Por qué `authenticated` no escribe ni siquiera sus propias filas.**
-- "Descartar" y "ya lo ingresé" parecen escrituras inocentes sobre datos
-- propios, y en aislamiento lo son. Pero la fila lleva `document_id` y
-- `appointment_id`: un UPDATE libre dejaría que el cliente escribiera ahí el
-- id que quisiera —el de un documento de OTRO perfil, por ejemplo— y la
-- bandeja mostraría un enlace a algo que esa persona no puede ver (RLS lo
-- frenaría al abrirlo, pero el registro quedaría mintiendo). Un GRANT por
-- columna sobre `status` resolvería ese caso puntual y dejaría igual dos
-- caminos de escritura que mantener en sincronía. Con un solo camino
-- —`lib/gmail/mensajes-admin.ts`, service_role, siempre acotado por `user_id`
-- después de que la Server Action verificó la sesión— hay un único lugar que
-- auditar. Mismo contrato y mismo encabezado de advertencia que
-- `lib/gmail/conexiones-admin.ts`.
--
-- No hace falta GRANT por columna acá (a diferencia de `gmail_connections`):
-- estas dos tablas no tienen ninguna columna que la pantalla no muestre. El
-- `attachmentId` de Gmail es un identificador opaco, sin valor fuera de una
-- sesión OAuth de esa misma casilla; sin el access token no abre nada.
-- =============================================================================

alter table public.gmail_messages enable row level security;
alter table public.gmail_filters  enable row level security;

revoke all on public.gmail_messages from anon, authenticated;
revoke all on public.gmail_filters  from anon, authenticated;

grant select on public.gmail_messages to authenticated;
grant select on public.gmail_filters  to authenticated;

grant select, insert, update, delete on public.gmail_messages to service_role;
grant select, insert, update, delete on public.gmail_filters  to service_role;

create policy gmail_messages_select_propios
    on public.gmail_messages
    for select
    to authenticated
    using (user_id = (select auth.uid()));

comment on policy gmail_messages_select_propios on public.gmail_messages is
    'Cada cuenta ve únicamente los correos de SU casilla. No hay visibilidad cruzada ni para quien administra un perfil gestionado: la casilla es de la CUENTA, no del perfil. Y no hay ninguna política de INSERT/UPDATE/DELETE: las escrituras pasan por service_role (lib/gmail/mensajes-admin.ts) después de que la Server Action verificó la sesión.';

create policy gmail_filters_select_propios
    on public.gmail_filters
    for select
    to authenticated
    using (user_id = (select auth.uid()));

comment on policy gmail_filters_select_propios on public.gmail_filters is
    'Cada cuenta ve únicamente los filtros que la app creó en SU Gmail. Crear y borrar pasan por service_role, después de la verificación de sesión de la Server Action.';


-- =============================================================================
-- 4. LA BAJA DE CUENTA Y LA DESCONEXIÓN
-- -----------------------------------------------------------------------------
-- El `ON DELETE CASCADE` del `user_id` se lleva las dos tablas cuando se borra
-- la cuenta (derecho de supresión, Ley 25.326 arts. 14-16): remitentes,
-- asuntos y filtros desaparecen con ella.
--
-- La DESCONEXIÓN de Gmail es distinta a propósito y NO borra `gmail_messages`
-- (ver el comentario de `user_id`): si borrara, la reconexión de la semana
-- siguiente -obligada, por los 7 días del modo prueba- volvería a proponer
-- todos los correos que la persona ya revisó o descartó. Lo que sí se lleva la
-- desconexión son los FILTROS, y eso se hace desde la aplicación
-- (`app/(app)/(con-nav)/perfil/gmail/actions.ts`), no acá: borrarlos exige
-- hablar con Gmail para sacar la regla de la casilla, y una función de la base
-- no puede hacer eso. Si la desconexión no llegara a borrarlos, quedan
-- listados en la pantalla para sacarlos a mano.
-- =============================================================================


-- =============================================================================
-- 5. EL JOB — barrido periódico, con el patrón de los recordatorios
-- -----------------------------------------------------------------------------
-- Mismo circuito exacto que `20260813050000` §6/§7 y `20260813070000` §7:
-- `pg_cron` llama a una función que hace un POST autenticado con
-- `x-cron-secret` a un Route Handler de la aplicación, vía `pg_net`.
--
-- **El secreto es el mismo `CRON_SECRET` de siempre** y se lee del Vault bajo
-- el nombre `cron_recordatorios_secret`, igual que hace
-- `configurar_cron_alertas_medicacion`: hay UN secreto de cron por entorno, y
-- multiplicarlo solo agregaría una variable más para que el usuario cargue y
-- desincronice. Lo único que hace falta configurar para este job es la URL.
--
-- ── LA FRECUENCIA: CADA 30 MINUTOS
--
-- El correo de una clínica no es urgente -avisa un turno que es dentro de
-- días, o manda un estudio que ya está hecho- así que la frecuencia se elige
-- por otro criterio: que "Buscar ahora" casi nunca haga falta, sin gastar
-- cuota ni tiempo de función al pedo. Cada 30 minutos son 48 pasadas por día
-- por cuenta conectada; contra el límite gratuito de Gmail (1.000.000.000 de
-- unidades de cuota por día, y `messages.list` cuesta 5) es ruido, y contra el
-- plan gratuito de Vercel es una función corta que la mayoría de las veces
-- corta enseguida porque no hay nada nuevo. Cada 15 -como los recordatorios-
-- duplicaría las corridas sin que nadie note la diferencia entre enterarse a
-- los 15 o a los 30 minutos de un correo que llegó mientras dormía; cada hora
-- empezaría a hacer que "Buscar ahora" fuera necesario.
--
-- ── DEGRADA EN VEZ DE FALLAR
--
-- Si el Vault no está configurado -una base recién reseteada- la función NO
-- lanza: avisa con un `warning` y devuelve. Así un `supabase db reset` en
-- medio del desarrollo no deja el job en rojo cada media hora.
--
-- ── NO HACE NADA SI NO HAY NADIE CONECTADO
--
-- El `count` de conexiones vivas se hace ACÁ, en la base, antes de gastar un
-- POST: en una instalación donde nadie conectó Gmail -o donde el único permiso
-- venció-, el job termina en un milisegundo sin despertar a la aplicación.
-- =============================================================================

create or replace function public.configurar_cron_gmail(p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    if coalesce(btrim(p_url), '') = '' then
        raise exception 'La URL del cron de Gmail no puede estar vacía'
            using errcode = '22023';
    end if;

    select id into v_id from vault.secrets where name = 'cron_gmail_url';
    if v_id is null then
        perform vault.create_secret(btrim(p_url), 'cron_gmail_url',
            'URL del endpoint que barre la etiqueta historialmedico de las casillas conectadas (Sprint 17, tarea 17.2).');
    else
        perform vault.update_secret(v_id, btrim(p_url));
    end if;

    if not exists (select 1 from vault.secrets where name = 'cron_recordatorios_secret') then
        raise warning
            'La URL quedó cargada, pero el Vault todavía no tiene cron_recordatorios_secret. Corré configurar_cron_recordatorios(url, secreto) — el secreto es el mismo CRON_SECRET para los tres jobs. Ver docs/gmail-ingesta.md §5.';
    end if;
end;
$$;

comment on function public.configurar_cron_gmail(text) is
    'Carga en el Vault la URL del endpoint que barre la etiqueta historialmedico. NO recibe el secreto a propósito: CRON_SECRET es uno solo y lo carga configurar_cron_recordatorios() bajo el nombre cron_recordatorios_secret. Se corre a mano una vez por entorno; solo el owner de la base (postgres) puede ejecutarla.';

-- Ni siquiera `service_role`: esto se configura desde psql o el SQL editor,
-- que corren como `postgres`. Mismo criterio que `configurar_cron_recordatorios`.
revoke execute on function public.configurar_cron_gmail(text) from public;


create or replace function public.disparar_barrido_gmail()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conectadas integer;
    v_url        text;
    v_secreto    text;
    v_request_id bigint;
begin
    select count(*) into v_conectadas
      from public.gmail_connections
     where status = 'conectada';

    if v_conectadas = 0 then
        return 'conectadas=0 http=innecesario';
    end if;

    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'cron_gmail_url';
    select decrypted_secret into v_secreto
      from vault.decrypted_secrets where name = 'cron_recordatorios_secret';

    if v_url is null or v_secreto is null then
        raise warning
            'Barrido de Gmail: hay % casilla(s) conectada(s) pero el Vault no tiene cron_gmail_url / cron_recordatorios_secret. Ver docs/gmail-ingesta.md §5.',
            v_conectadas;
        return format('conectadas=%s http=sin-configurar', v_conectadas);
    end if;

    select net.http_post(
               url     := v_url,
               body    := jsonb_build_object('origen', 'pg_cron'),
               headers := jsonb_build_object(
                              'Content-Type',  'application/json',
                              'x-cron-secret', v_secreto),
               -- Más generoso que los 30 s de los recordatorios: una pasada
               -- habla con Google una vez por conexión y hasta N veces por
               -- mensaje nuevo. Igual la aplicación se corta sola por tandas
               -- (`LIMITE_MENSAJES_POR_PASADA`), así que este número es el
               -- techo de seguridad y no el tiempo esperado.
               timeout_milliseconds := 60000
           )
      into v_request_id;

    return format('conectadas=%s request_id=%s', v_conectadas, v_request_id);
end;
$$;

comment on function public.disparar_barrido_gmail() is
    'Punto de entrada del job de pg_cron del Sprint 17: si hay casillas conectadas, le pide a la aplicación que barra la etiqueta historialmedico con un POST autenticado por x-cron-secret. Si no hay ninguna conexión viva no hace nada; si el Vault no está configurado degrada con un warning en vez de fallar.';

revoke execute on function public.disparar_barrido_gmail() from public;

-- `cron.schedule` con un nombre ya existente REEMPLAZA el job, así que esta
-- migración es reaplicable. La expresión no lleva zona horaria: `*/30 * * * *`
-- es lo mismo en cualquier huso.
select cron.schedule(
    'barrido-gmail',
    '*/30 * * * *',
    $cron$select public.disparar_barrido_gmail()$cron$
);

-- Fin de la migración.
