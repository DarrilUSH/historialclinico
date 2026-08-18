-- =============================================================================
-- Historial Médico — Migración 20260818160000: carga automática desde Gmail,
-- opt-in y solo cuando no hay ninguna duda (Sprint 17, encargo del usuario en
-- producción)
-- -----------------------------------------------------------------------------
-- ── QUÉ ES ESTO
--
-- La 17.2 dejó el circuito completo: el barrido registra lo que llega a la
-- etiqueta y una PERSONA decide, correo por correo, qué entra al historial.
-- Funciona, y el usuario lo usó de verdad. Su pedido después de usarlo:
--
--     "cuando un correo se lee SIN NINGUNA duda, que se cargue solo; solo lo
--      dudoso queda a revisión manual".
--
-- Esta migración es la base de eso. Agrega:
--
--   1. El INTERRUPTOR, en `gmail_connections`: apagado por defecto, con el
--      perfil de destino elegido a mano.
--   2. La MARCA DE ORIGEN, en `documents` y en `appointments`: inmutable, para
--      que la persona siempre pueda saber cómo entró algo a su historial.
--   3. Las DOS RPC del camino automático, con guardas propias.
--   4. El rastro en `gmail_messages`: qué se cargó solo, y por qué lo que no
--      se cargó solo quedó esperando.
--
-- ── LA DECISIÓN CENTRAL: RPC NUEVAS, SIN TOCAR NI UNA GUARDA EXISTENTE
--
-- `confirmar_documento_recien_subido` (`20260813010000`) exige que quien
-- confirma sea el CREADOR del documento y que no haya pasado una hora desde que
-- se subió. Son dos de las mejores guardas del proyecto y la migración
-- `20260818140000` §"POR QUÉ EL BARRIDO NO CREA FILAS EN documents" ya explicó,
-- en su momento, que relajarlas para acomodar la ingesta de Gmail habría sido
-- el peor negocio posible.
--
-- **Esta migración no las toca.** Ni una línea. El camino automático no pasa
-- por ahí: tiene su propia función, `ingresar_documento_automatico`, con sus
-- propias guardas, que son distintas porque el actor es distinto —no hay
-- sesión, no hay creador, no hay ventana de una hora que tenga sentido—. El
-- documento que crea nace `confirmed_at = now()` y `created_by_profile_id =
-- NULL`, y esas dos cosas juntas hacen que las funciones de la 4.5 lo RECHACEN
-- si alguien intentara pasarlo por ellas: la guarda 1 falla (NULL no es el
-- perfil de nadie) y la guarda 3 también (ya está confirmado). Los dos caminos
-- quedan separados por construcción, no por disciplina.
--
-- ── LAS CUATRO GUARDAS DEL CAMINO AUTOMÁTICO
--
-- Las dos RPC nuevas son `SECURITY DEFINER`, `set search_path = ''`, con
-- EXECUTE **solo para `service_role`** (ni `authenticated` ni `anon`), y las dos
-- verifican, en la misma transacción, antes de escribir nada:
--
--   1. **El interruptor está encendido** para esa cuenta, y hay un perfil de
--      destino elegido. Con el interruptor apagado la función rechaza, aunque
--      la llame `service_role`: el opt-in no es una condición que evalúa la
--      aplicación y después le pide a la base que confíe, es una condición que
--      evalúa la base.
--   2. **La cuenta administra ESE perfil**, verificado contra
--      `family_permissions` en el momento de escribir —no contra lo que se
--      guardó el día que se encendió el interruptor—. Un permiso revocado ayer
--      apaga la auto-carga de hoy sin que nadie tenga que acordarse de apagarla.
--   3. **El correo es de esa cuenta y sigue pendiente.** Un replay del mismo
--      mensaje (dos pasadas simultáneas, un reintento) no crea un segundo
--      documento: la función devuelve `ya_resuelto` y no escribe nada.
--   4. **No hay huella duplicada** en el perfil de destino, comprobada DENTRO
--      de la transacción, con la fila del correo ya bloqueada. La compuerta de
--      `lib/gmail/auto-ingesta.ts` ya lo chequeó antes; esto es la red debajo,
--      para la carrera entre dos pasadas que bajan el mismo PDF a la vez.
--
-- ── POR QUÉ `cuenta_administra_perfil` Y NO `puede_administrar_perfil`
--
-- Las funciones de la matriz (`20260812220000_rls.sql` §2) resuelven el actor
-- con `auth.uid()`. El barrido automático **no tiene sesión**: lo dispara
-- `pg_cron`. Se agrega entonces una función hermana que recibe el `user_id`
-- como PARÁMETRO en vez de leerlo del JWT, con exactamente la misma definición
-- de "administra" (titular con cuenta, o `family_permissions.can_manage`), y
-- alcanzable solo por `service_role`.
--
-- ── POR QUÉ EL DESTINO EXIGE `can_manage` Y NO ALCANZA CON `can_upload`
--
-- Porque la auto-carga tiene que ser REVERSIBLE de un toque. "Deshacer" borra
-- el documento con la sesión de la persona, y `documents_delete_administrador`
-- exige `can_manage`. Ofrecer una carga automática que después la misma persona
-- no puede deshacer sería peor que no ofrecerla: quedaría un estudio ajeno en
-- un historial y habría que pedirle a un tercero que lo saque. Entonces el
-- selector de perfil de destino ofrece los perfiles que la cuenta ADMINISTRA
-- —que, por la monotonía de la matriz, son siempre un subconjunto de aquellos
-- en los que puede cargar (`puede_cargar_en_perfil` acepta `can_upload OR
-- can_manage`)—. Es la lectura literal del encargo, "los que administra con
-- can_upload", y la única que hace que el botón Deshacer funcione siempre.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema.
-- =============================================================================


-- =============================================================================
-- 1. EL INTERRUPTOR — tres columnas en gmail_connections
-- -----------------------------------------------------------------------------
-- Va en `gmail_connections` y no en una tabla nueva porque es exactamente un
-- atributo de la conexión: no tiene sentido fuera de ella, muere con ella, y
-- una tabla de una fila por cuenta colgando de otra tabla de una fila por
-- cuenta sería una junta más para no ganar nada.
-- =============================================================================

alter table public.gmail_connections
    add column auto_ingest_enabled    boolean     not null default false,
    add column auto_ingest_profile_id uuid        references public.profiles (id) on delete set null,
    add column auto_ingest_set_at     timestamptz;

comment on column public.gmail_connections.auto_ingest_enabled is
    'Interruptor de la carga automática: false por defecto y para todas las conexiones que ya existían. Con esto en false, el circuito se comporta EXACTAMENTE como la 17.2 -el barrido no llama a Gemini, no baja adjuntos y no crea nada-. Solo lo enciende la persona, desde /perfil/gmail, eligiendo además un perfil de destino.';

comment on column public.gmail_connections.auto_ingest_profile_id is
    'A qué perfil se le suman los estudios y turnos que entren solos. Es una elección humana y explícita: sin perfil no hay auto-carga (lo garantizan el trigger de normalización y el CHECK de esta migración). ON DELETE SET NULL: si el perfil se borra, el trigger apaga el interruptor en el mismo UPDATE y la auto-carga queda apagada, nunca apuntando a la nada.';

comment on column public.gmail_connections.auto_ingest_set_at is
    'Cuándo se encendió el interruptor por última vez. Es el dato que la pantalla usa para decir "está prendido desde el …", y el que permite auditar cuándo empezó a entrar algo solo. NULL siempre que el interruptor esté apagado.';

-- ── El trigger de normalización, y por qué existe antes que el CHECK
--
-- El invariante que se quiere es "encendido ⇒ hay perfil". El `ON DELETE SET
-- NULL` del `auto_ingest_profile_id` lo rompería de la peor manera posible: al
-- borrar un perfil, Postgres emite un UPDATE sobre esta tabla que dejaría
-- `enabled = true` con `profile_id = NULL`, el CHECK abortaría… y lo que
-- fallaría es el BORRADO DEL PERFIL. Un invariante de la conexión de Gmail no
-- puede impedir que alguien ejerza su derecho de supresión.
--
-- Con un trigger BEFORE -que en Postgres corre ANTES de evaluar los CHECK- el
-- UPDATE del `SET NULL` apaga el interruptor solo, el CHECK pasa, y el perfil
-- se borra. El CHECK queda igual, como segunda barrera para cualquier escritura
-- que no pase por acá.
create or replace function public.gmail_normalizar_auto_ingesta()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if new.auto_ingest_profile_id is null then
        new.auto_ingest_enabled := false;
    end if;

    if not new.auto_ingest_enabled then
        new.auto_ingest_set_at := null;
    elsif new.auto_ingest_set_at is null then
        new.auto_ingest_set_at := now();
    end if;

    return new;
end;
$$;

comment on function public.gmail_normalizar_auto_ingesta() is
    'Mantiene coherente el interruptor de auto-carga antes de que se evalúe el CHECK: sin perfil de destino lo apaga, apagado limpia la fecha, encendido sin fecha la sella. Existe sobre todo por el ON DELETE SET NULL de auto_ingest_profile_id: sin este trigger, borrar un perfil de destino haría fallar el CHECK y por lo tanto el borrado del PERFIL, que es lo último que puede pasar en una app con derecho de supresión.';

revoke execute on function public.gmail_normalizar_auto_ingesta() from public;

create trigger gmail_connections_normalizar_auto_ingesta
    before insert or update on public.gmail_connections
    for each row
    execute function public.gmail_normalizar_auto_ingesta();

comment on trigger gmail_connections_normalizar_auto_ingesta on public.gmail_connections is
    'Normaliza el interruptor de auto-carga antes del CHECK. Ver el comentario de la función.';

alter table public.gmail_connections
    add constraint gmail_connections_auto_ingesta_coherente
        check (
            (auto_ingest_enabled = false and auto_ingest_set_at is null)
            or (auto_ingest_enabled
                and auto_ingest_profile_id is not null
                and auto_ingest_set_at is not null)
        );

-- El GRANT de `20260818130000` §2 es por COLUMNA y fue una foto del momento:
-- las columnas nuevas no entran solas. La pantalla necesita las tres para
-- pintar el interruptor y decir a qué perfil está apuntando.
grant select (auto_ingest_enabled, auto_ingest_profile_id, auto_ingest_set_at)
    on public.gmail_connections to authenticated;

-- Sigue sin haber política de UPDATE para `authenticated`, a propósito: el
-- interruptor se enciende por la RPC de §4, con `service_role`, después de que
-- la Server Action verificó la sesión. Los dos candados de siempre.


-- =============================================================================
-- 2. EL RASTRO — dos columnas en gmail_messages
-- -----------------------------------------------------------------------------
-- `auto_ingested_at` es lo que separa "esto entró solo" de "esto lo trajiste
-- vos", y es lo que la sección "Cargados automáticamente" de la bandeja lista.
--
-- `auto_review_reason` es la contracara, y es la que hace que la función sea
-- honesta en vez de mágica: cuando el barrido MIRÓ un correo con la auto-carga
-- encendida y decidió NO cargarlo, deja escrito por qué en castellano ("Quedó
-- para que lo mires vos: el mensaje no decía la hora"). Sin esto, la persona
-- vería unos correos entrar solos y otros no, sin ninguna forma de entender la
-- diferencia — que es exactamente la clase de comportamiento que hace que la
-- gente deje de confiar en una función automática.
-- =============================================================================

alter table public.gmail_messages
    add column auto_ingested_at   timestamptz,
    add column auto_review_reason text;

comment on column public.gmail_messages.auto_ingested_at is
    'Cuándo este correo entró SOLO al historial (carga automática). NULL = lo trajo una persona, o todavía no entró. Es lo que lista la sección "Cargados automáticamente" de /perfil/gmail, y "Deshacer" lo vuelve a NULL junto con devolver el correo a pendiente.';

comment on column public.gmail_messages.auto_review_reason is
    'Por qué este correo NO se cargó solo, en castellano y ya armado para mostrar ("Quedó para que lo mires vos: no dice a nombre de quién viene"). Lo escribe el barrido cuando la auto-carga está encendida y la compuerta de lib/gmail/auto-ingesta.ts encontró al menos un motivo. NULL cuando la auto-carga está apagada (no se evaluó nada) o cuando el correo sí entró solo.';

-- Un correo con fecha de auto-carga tiene que estar ingresado. Deshacer lo
-- devuelve a `pendiente_revision` y limpia la fecha en el mismo UPDATE.
alter table public.gmail_messages
    add constraint gmail_messages_auto_ingesta_coherente
        check (auto_ingested_at is null or status = 'ingresado');


-- =============================================================================
-- 3. LA MARCA VISIBLE — `auto_ingest_source`, inmutable, en las dos tablas
-- -----------------------------------------------------------------------------
-- El compromiso del encargo: "que la persona siempre pueda saber cómo entró
-- algo a su historial". Eso solo vale si la marca NO SE PUEDE BORRAR. Una
-- etiqueta que quien administra puede quitar con un UPDATE cualquiera no es una
-- garantía, es una sugerencia.
--
-- Se sella con el mismo patrón —y por el mismo motivo— que
-- `created_by_profile_id` (`20260812220000_rls.sql` §2.2): para una SESIÓN DE
-- USUARIO, el INSERT la fuerza a NULL y el UPDATE conserva el valor viejo.
-- Traducido: nadie desde la aplicación puede declarar que algo "entró solo"
-- (falsificar la trazabilidad hacia arriba) ni borrar la marca de lo que sí
-- entró solo (falsificarla hacia abajo). La única forma de escribirla es
-- `service_role`, o sea las dos RPC de §5.
-- =============================================================================

alter table public.documents
    add column auto_ingest_source text;

alter table public.documents
    add constraint documents_auto_ingest_source_valido
        check (auto_ingest_source is null or auto_ingest_source = 'gmail');

comment on column public.documents.auto_ingest_source is
    'NULL = lo cargó una persona (subida a mano, Web Share Target, o "Revisar este estudio" de la bandeja de Gmail). ''gmail'' = entró SOLO por la carga automática del Sprint 17, sin que nadie lo mirara antes. La pantalla del estudio lo muestra como "Cargado desde Gmail automáticamente". Es INMUTABLE para las sesiones de usuario (trigger sellar_auto_ingest_source): ni se puede inventar ni se puede borrar desde la aplicación.';

alter table public.appointments
    add column auto_ingest_source text;

alter table public.appointments
    add constraint appointments_auto_ingest_source_valido
        check (auto_ingest_source is null or auto_ingest_source = 'gmail');

comment on column public.appointments.auto_ingest_source is
    'NULL = lo cargó una persona. ''gmail'' = el turno lo creó sola la carga automática del Sprint 17 a partir de un aviso de la clínica. Mismo criterio, mismo trigger y misma inmutabilidad que documents.auto_ingest_source.';

create or replace function public.sellar_auto_ingest_source()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    -- El seed y las RPC de §5 (service_role) escriben lo que corresponda.
    if not public.es_sesion_de_usuario() then
        return new;
    end if;

    if tg_op = 'INSERT' then
        -- Una sesión de usuario NUNCA puede declarar que algo entró solo.
        new.auto_ingest_source := null;
    else
        -- Ni borrar la marca de lo que sí entró solo.
        new.auto_ingest_source := old.auto_ingest_source;
    end if;

    return new;
end;
$$;

comment on function public.sellar_auto_ingest_source() is
    'Hace inmutable auto_ingest_source para las sesiones de usuario: fuerza NULL en el alta (nadie puede fingir que su carga a mano entró sola) y conserva el valor anterior en el UPDATE (nadie puede borrar la marca de lo que sí entró solo). Sin esto, "la persona siempre puede saber cómo entró algo a su historial" sería una sugerencia y no una garantía. Mismo patrón que sellar_created_by_profile_id.';

revoke execute on function public.sellar_auto_ingest_source() from public;

create trigger documents_sellar_auto_ingest_source
    before insert or update on public.documents
    for each row execute function public.sellar_auto_ingest_source();

create trigger appointments_sellar_auto_ingest_source
    before insert or update on public.appointments
    for each row execute function public.sellar_auto_ingest_source();


-- =============================================================================
-- 4. "¿ESTA CUENTA ADMINISTRA ESTE PERFIL?" — sin sesión
-- -----------------------------------------------------------------------------
-- Hermana de `public.puede_administrar_perfil(uuid)` (`20260812220000_rls.sql`
-- §2) con UNA sola diferencia: el actor llega por parámetro en vez de salir de
-- `auth.uid()`. La definición de "administra" es literalmente la misma —titular
-- con cuenta, o fila de `family_permissions` con `can_manage`—, y se escribe
-- así de cerca del original a propósito, para que cualquiera que audite las dos
-- vea que dicen lo mismo.
--
-- No se le concede a `authenticated`: una cuenta preguntando por SU propia
-- autoridad ya tiene `puede_administrar_perfil`, que no necesita parámetro y no
-- se puede engañar. Esta acepta cualquier `user_id`, así que solo la puede
-- ejecutar quien ya no tiene nada que ganar mintiendo: `service_role`.
-- =============================================================================

create or replace function public.cuenta_administra_perfil(p_usuario uuid, p_perfil uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select p_usuario is not null
       and p_perfil is not null
       and (
            exists (
                select 1
                  from public.profiles p
                 where p.id = p_perfil
                   and p.user_id = p_usuario
            )
            or exists (
                select 1
                  from public.family_permissions fp
                  join public.profiles actor on actor.id = fp.granted_profile_id
                 where fp.owner_profile_id = p_perfil
                   and actor.user_id = p_usuario
                   and fp.can_manage
            )
       );
$$;

comment on function public.cuenta_administra_perfil(uuid, uuid) is
    'TRUE si la CUENTA p_usuario administra el perfil p_perfil: es su titular con cuenta, o tiene una fila de family_permissions con can_manage. Misma definición que puede_administrar_perfil(uuid), pero con el actor por parámetro en vez de auth.uid(), porque el barrido automático corre desde pg_cron y no tiene sesión. Solo service_role puede ejecutarla.';

revoke execute on function public.cuenta_administra_perfil(uuid, uuid) from public;
grant  execute on function public.cuenta_administra_perfil(uuid, uuid) to service_role;


-- =============================================================================
-- 5. LAS TRES RPC DEL CAMINO AUTOMÁTICO
-- -----------------------------------------------------------------------------
-- Las tres devuelven `jsonb` con la forma `{"estado": "...", ...}` en vez de un
-- uuid pelado. El motivo es que "no se creó nada" tiene MÁS DE UNA causa
-- legítima y la aplicación necesita distinguirlas para hacer cosas distintas:
-- un `ya_resuelto` (replay) hay que ignorarlo en silencio, un `duplicado` hay
-- que dejarlo anotado en el correo y borrar el archivo que se acababa de subir.
-- Un `uuid` nulo no alcanzaría para eso, y un tipo compuesto nuevo agregaría un
-- objeto al esquema para transportar dos campos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 5.1 configurar_auto_ingesta_gmail — encender y apagar el interruptor
-- -----------------------------------------------------------------------------
create or replace function public.configurar_auto_ingesta_gmail(
    p_usuario uuid,
    p_activar boolean,
    p_perfil  uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_usuario is null then
        raise exception 'Falta la cuenta.' using errcode = '22023';
    end if;

    if not exists (select 1 from public.gmail_connections c where c.user_id = p_usuario) then
        raise exception 'Esa cuenta no tiene ninguna casilla de Gmail conectada.'
            using errcode = 'insufficient_privilege';
    end if;

    if p_activar then
        if p_perfil is null then
            raise exception 'Para prender la carga automática hay que elegir a qué perfil van los estudios.'
                using errcode = '22023';
        end if;

        -- La autoridad se comprueba ACÁ y se vuelve a comprobar en cada carga
        -- (§5.2 y §5.3): que hoy pueda no significa que pueda dentro de un mes.
        if not public.cuenta_administra_perfil(p_usuario, p_perfil) then
            raise exception 'No podés elegir ese perfil: no lo administrás.'
                using errcode = 'insufficient_privilege';
        end if;

        update public.gmail_connections
           set auto_ingest_enabled    = true,
               auto_ingest_profile_id = p_perfil,
               -- Se re-sella la fecha en cada encendido, incluso si ya estaba
               -- prendido con OTRO perfil: cambiar el destino es una decisión
               -- nueva y merece su propia marca de tiempo.
               auto_ingest_set_at     = now()
         where user_id = p_usuario;
    else
        -- Apagar NO borra el perfil elegido: si la persona vuelve a prender,
        -- la pantalla le propone el mismo destino que ya había elegido. El
        -- trigger de §1 se encarga de limpiar `auto_ingest_set_at`.
        update public.gmail_connections
           set auto_ingest_enabled = false
         where user_id = p_usuario;
    end if;
end;
$$;

comment on function public.configurar_auto_ingesta_gmail(uuid, boolean, uuid) is
    'Enciende o apaga la carga automática de una cuenta y fija el perfil de destino. Para encender exige que la cuenta ADMINISTRE ese perfil (cuenta_administra_perfil), porque "Deshacer" borra el documento y eso requiere can_manage. Apagar no borra el destino elegido. Solo service_role puede ejecutarla: la llama la Server Action de /perfil/gmail después de verificar la sesión.';

revoke execute on function public.configurar_auto_ingesta_gmail(uuid, boolean, uuid) from public;
grant  execute on function public.configurar_auto_ingesta_gmail(uuid, boolean, uuid) to service_role;


-- -----------------------------------------------------------------------------
-- 5.2 ingresar_documento_automatico — un estudio que entra solo
-- -----------------------------------------------------------------------------
-- Recibe el archivo YA SUBIDO a Storage (la aplicación lo hizo con
-- `service_role` justo antes) y hace, atómicamente, las cuatro cosas que
-- quedan: verificar las guardas, crear la fila de `documents`, marcarla como
-- venida de Gmail, y dejar el correo resuelto apuntando a ella.
--
-- Si devuelve `duplicado` o `ya_resuelto`, NO escribió nada y quien llama tiene
-- que borrar el objeto que acababa de subir (compensación, mismo criterio que
-- `lib/documentos/ingesta.ts`).
create or replace function public.ingresar_documento_automatico(
    p_usuario      uuid,
    p_correo       uuid,
    p_storage_path text,
    p_mime         text,
    p_bytes        bigint,
    p_sha256       text,
    p_titulo       text,
    p_categoria    text,
    p_fecha        date,
    p_resumen      text,
    p_texto_ocr    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conexion  public.gmail_connections%rowtype;
    v_correo    public.gmail_messages%rowtype;
    v_perfil    uuid;
    v_titulo    text;
    v_categoria public.doc_category;
    v_documento uuid;
begin
    -- ── Guarda 1: el interruptor
    select * into v_conexion
      from public.gmail_connections c
     where c.user_id = p_usuario
     for update;

    if not found then
        raise exception 'Esa cuenta no tiene ninguna casilla de Gmail conectada.'
            using errcode = 'insufficient_privilege';
    end if;

    if not v_conexion.auto_ingest_enabled or v_conexion.auto_ingest_profile_id is null then
        raise exception 'La carga automática está apagada para esta cuenta.'
            using errcode = 'insufficient_privilege';
    end if;

    v_perfil := v_conexion.auto_ingest_profile_id;

    -- ── Guarda 2: la autoridad, AHORA (no la del día que se prendió)
    if not public.cuenta_administra_perfil(p_usuario, v_perfil) then
        raise exception 'Esa cuenta ya no administra el perfil de destino.'
            using errcode = 'insufficient_privilege';
    end if;

    -- ── Guarda 3: el correo, y el replay
    select * into v_correo
      from public.gmail_messages m
     where m.id = p_correo
       and m.user_id = p_usuario
     for update;

    if not found then
        raise exception 'No encontramos ese correo en el registro de esta cuenta.'
            using errcode = 'insufficient_privilege';
    end if;

    if v_correo.status <> 'pendiente_revision' or v_correo.document_id is not null then
        return jsonb_build_object('estado', 'ya_resuelto');
    end if;

    -- ── Guarda 4: la huella, dentro de la transacción
    if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
        raise exception 'La huella del archivo no tiene forma válida.'
            using errcode = '22023';
    end if;

    if exists (
        select 1
          from public.documents d
         where d.profile_id = v_perfil
           and d.content_sha256 = p_sha256
    ) then
        return jsonb_build_object('estado', 'duplicado');
    end if;

    -- ── Validación de los valores, espejo de confirmar_documento_recien_subido
    v_titulo := btrim(coalesce(p_titulo, ''));
    if char_length(v_titulo) = 0 or char_length(v_titulo) > 200 then
        raise exception 'El título no puede estar vacío ni superar los 200 caracteres.'
            using errcode = 'invalid_parameter_value';
    end if;

    begin
        v_categoria := p_categoria::public.doc_category;
    exception when invalid_text_representation then
        raise exception 'La categoría no es válida.' using errcode = 'invalid_parameter_value';
    end;

    if p_fecha is null or p_fecha > current_date or p_fecha <= date '1900-12-31' then
        raise exception 'La fecha del estudio no es válida: no puede ser futura ni anterior a 1900.'
            using errcode = 'invalid_parameter_value';
    end if;

    -- ── La escritura
    --
    -- `created_by_profile_id` va explícitamente en NULL: NADIE lo subió, y
    -- poner ahí el perfil de la cuenta sería una trazabilidad falsa. Quién lo
    -- trajo lo dice `auto_ingest_source`, que además es inmutable.
    --
    -- `confirmed_at = now()` porque este documento no va a pasar por ninguna
    -- pantalla de revisión: la revisión, acá, fue la compuerta. Y de paso deja
    -- a las funciones de la 4.5 rechazándolo, como explica el encabezado.
    insert into public.documents (
        profile_id, title, category, document_date, storage_path, mime_type,
        file_size_bytes, content_sha256, ai_summary, raw_ocr_text,
        created_by_profile_id, confirmed_at, auto_ingest_source
    ) values (
        v_perfil, v_titulo, v_categoria, p_fecha, p_storage_path, p_mime,
        p_bytes, p_sha256, nullif(btrim(coalesce(p_resumen, '')), ''),
        nullif(btrim(coalesce(p_texto_ocr, '')), ''),
        null, now(), 'gmail'
    )
    returning id into v_documento;

    update public.gmail_messages
       set status             = 'ingresado',
           document_id        = v_documento,
           resolved_at        = now(),
           auto_ingested_at   = now(),
           auto_review_reason = null
     where id = p_correo
       and user_id = p_usuario;

    return jsonb_build_object('estado', 'creado', 'documento_id', v_documento);
end;
$$;

comment on function public.ingresar_documento_automatico(uuid, uuid, text, text, bigint, text, text, text, date, text, text) is
    'Crea el documento de una carga AUTOMÁTICA desde Gmail y deja el correo resuelto, todo en una transacción (Sprint 17). Cuatro guardas propias: interruptor encendido con perfil de destino, la cuenta administra ESE perfil AHORA, el correo es suyo y sigue pendiente (replay -> ya_resuelto), y no hay huella duplicada en el perfil (-> duplicado). NO toca ni relaja confirmar_documento_recien_subido: el documento nace con created_by_profile_id NULL y confirmed_at seteado, así que esas funciones lo rechazan por construcción. Solo service_role.';

revoke execute on function public.ingresar_documento_automatico(uuid, uuid, text, text, bigint, text, text, text, date, text, text) from public;
grant  execute on function public.ingresar_documento_automatico(uuid, uuid, text, text, bigint, text, text, text, date, text, text) to service_role;


-- -----------------------------------------------------------------------------
-- 5.3 ingresar_turno_automatico — un turno que se agenda solo
-- -----------------------------------------------------------------------------
-- Mismas cuatro guardas. La cuarta cambia de forma porque un turno no tiene
-- huella: el duplicado se define como "ese perfil ya tiene un turno de la misma
-- especialidad a la misma hora exacta". Es el caso real de la clínica que manda
-- el aviso y después el recordatorio.
create or replace function public.ingresar_turno_automatico(
    p_usuario          uuid,
    p_correo           uuid,
    p_especialidad     text,
    p_medico           text,
    p_fecha_hora       timestamptz,
    p_lugar_nombre     text,
    p_lugar_direccion  text,
    p_lugar_ciudad     text,
    p_lugar_provincia  text,
    p_notas            text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conexion     public.gmail_connections%rowtype;
    v_correo       public.gmail_messages%rowtype;
    v_perfil       uuid;
    v_especialidad text;
    v_turno        uuid;
begin
    select * into v_conexion
      from public.gmail_connections c
     where c.user_id = p_usuario
     for update;

    if not found then
        raise exception 'Esa cuenta no tiene ninguna casilla de Gmail conectada.'
            using errcode = 'insufficient_privilege';
    end if;

    if not v_conexion.auto_ingest_enabled or v_conexion.auto_ingest_profile_id is null then
        raise exception 'La carga automática está apagada para esta cuenta.'
            using errcode = 'insufficient_privilege';
    end if;

    v_perfil := v_conexion.auto_ingest_profile_id;

    if not public.cuenta_administra_perfil(p_usuario, v_perfil) then
        raise exception 'Esa cuenta ya no administra el perfil de destino.'
            using errcode = 'insufficient_privilege';
    end if;

    select * into v_correo
      from public.gmail_messages m
     where m.id = p_correo
       and m.user_id = p_usuario
     for update;

    if not found then
        raise exception 'No encontramos ese correo en el registro de esta cuenta.'
            using errcode = 'insufficient_privilege';
    end if;

    if v_correo.status <> 'pendiente_revision' or v_correo.appointment_id is not null then
        return jsonb_build_object('estado', 'ya_resuelto');
    end if;

    v_especialidad := btrim(coalesce(p_especialidad, ''));
    if char_length(v_especialidad) = 0 or char_length(v_especialidad) > 100 then
        raise exception 'La especialidad no puede estar vacía ni superar los 100 caracteres.'
            using errcode = 'invalid_parameter_value';
    end if;

    if p_fecha_hora is null then
        raise exception 'El turno necesita fecha y hora.' using errcode = 'invalid_parameter_value';
    end if;

    if exists (
        select 1
          from public.appointments a
         where a.profile_id = v_perfil
           and a.appointment_date = p_fecha_hora
           and lower(btrim(a.specialty)) = lower(v_especialidad)
    ) then
        return jsonb_build_object('estado', 'duplicado');
    end if;

    insert into public.appointments (
        profile_id, specialty, doctor_name, appointment_date,
        location_name, location_address, location_city, location_province,
        preparation_notes, status, created_by_profile_id, auto_ingest_source
    ) values (
        v_perfil, v_especialidad,
        nullif(btrim(coalesce(p_medico, '')), ''),
        p_fecha_hora,
        nullif(btrim(coalesce(p_lugar_nombre, '')), ''),
        nullif(btrim(coalesce(p_lugar_direccion, '')), ''),
        nullif(btrim(coalesce(p_lugar_ciudad, '')), ''),
        nullif(btrim(coalesce(p_lugar_provincia, '')), ''),
        nullif(btrim(coalesce(p_notas, '')), ''),
        'pending', null, 'gmail'
    )
    returning id into v_turno;

    update public.gmail_messages
       set status             = 'ingresado',
           appointment_id     = v_turno,
           resolved_at        = now(),
           auto_ingested_at   = now(),
           auto_review_reason = null
     where id = p_correo
       and user_id = p_usuario;

    return jsonb_build_object('estado', 'creado', 'turno_id', v_turno);
end;
$$;

comment on function public.ingresar_turno_automatico(uuid, uuid, text, text, timestamptz, text, text, text, text, text) is
    'Crea el turno de una carga AUTOMÁTICA desde Gmail y deja el correo resuelto, en una transacción (Sprint 17). Mismas guardas que ingresar_documento_automatico; el dedup acá es "ese perfil ya tiene un turno de la misma especialidad a la misma hora exacta" (el aviso y el recordatorio de la misma clínica). El turno nace con created_by_profile_id NULL y auto_ingest_source = gmail. Solo service_role.';

revoke execute on function public.ingresar_turno_automatico(uuid, uuid, text, text, timestamptz, text, text, text, text, text) from public;
grant  execute on function public.ingresar_turno_automatico(uuid, uuid, text, text, timestamptz, text, text, text, text, text) to service_role;


-- =============================================================================
-- 6. LO QUE ESTA MIGRACIÓN NO HACE
-- -----------------------------------------------------------------------------
-- - **No toca `confirmar_documento_recien_subido` ni
--   `descartar_documento_recien_subido`.** Ver el encabezado.
-- - **No toca ninguna política de `20260812220000_rls.sql`.** El borrado del
--   "Deshacer" pasa por `documents_delete_administrador` /
--   `appointments_delete_administrador` tal como están: con la sesión de la
--   persona y con `can_manage`, que es justamente lo que el interruptor exige
--   para poder encenderse.
-- - **No agrega ninguna política de escritura para `authenticated`** en
--   `gmail_connections` ni en `gmail_messages`. Sigue habiendo un solo camino
--   de escritura (service_role, después de verificar la sesión), que sigue
--   siendo un solo lugar que auditar.
-- - **No cambia el job de `pg_cron`.** Es el mismo `barrido-gmail` cada 30
--   minutos de `20260818140000` §5: lo que cambia es lo que la aplicación hace
--   dentro de la pasada, y solo para las conexiones con el interruptor
--   encendido.
-- =============================================================================

-- Fin de la migración.
