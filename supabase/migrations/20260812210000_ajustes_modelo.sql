-- =============================================================================
-- Historial Médico — Migración 20260812210000: ajustes de modelo previos a RLS
-- -----------------------------------------------------------------------------
-- Aplica cinco de las nueve deudas detectadas al escribir `docs/modelo-permisos.md`
-- (sección 10). El orquestador decidió cuáles entran ahora y cuáles quedan
-- documentadas como deuda:
--
--   D1  created_by_profile_id en profiles .................... SE APLICA acá
--   D2  created_by_profile_id en tablas de contenido .......... SE APLICA acá
--   D3  CHECK de monotonía de los flags ..................... NO (deuda vigente)
--   D4  invariante de no orfandad (trigger) ................. SE APLICA acá
--   D5  limpieza de Storage al borrar (tabla + triggers) .... SE APLICA acá
--   D6  registro del consentimiento ......................... NO (Sprint 12)
--   D7  el autorizado debe tener cuenta ..................... NO (deuda vigente)
--   D8  push_subscriptions.profile_id -> SET NULL ........... SE APLICA acá
--   D9  turnos: can_upload cambia status .................... NO (Sprint 6)
--
-- Esta migración NO habilita RLS ni crea políticas: eso vive en
-- `20260812220000_rls.sql`, que se apoya en las columnas y triggers de acá.
--
-- Convenciones: identificadores en inglés, documentación en español,
-- UTF-8 sin BOM, `set search_path = ''` en toda función.
-- =============================================================================


-- =============================================================================
-- 1. D8 — push_subscriptions.profile_id pasa a ON DELETE SET NULL
-- -----------------------------------------------------------------------------
-- La suscripción Web Push pertenece al navegador de una PERSONA (user_id), no a
-- un perfil: `profile_id` solo guarda cuál era el perfil activo al suscribirse.
-- Con ON DELETE CASCADE, borrar el perfil de Roberto borraba la suscripción de
-- María (que se había suscripto mientras lo tenía activo) y ella dejaba de
-- recibir TODAS sus notificaciones, incluidas las de su propio historial.
-- La columna ya era nullable, así que no hay dato que migrar.
-- =============================================================================

alter table public.push_subscriptions
    drop constraint push_subscriptions_profile_id_fkey;

alter table public.push_subscriptions
    add constraint push_subscriptions_profile_id_fkey
        foreign key (profile_id) references public.profiles (id) on delete set null;

comment on column public.push_subscriptions.profile_id is
    'Perfil activo al momento de suscribirse. Es CONTEXTO, no propiedad: la suscripción pertenece a user_id. Por eso es ON DELETE SET NULL (deuda D8 de docs/modelo-permisos.md): borrar un perfil no puede dejar sin notificaciones a la persona que lo administraba.';


-- =============================================================================
-- 2. D1 — profiles.created_by_profile_id (quién creó un perfil gestionado)
-- -----------------------------------------------------------------------------
-- Hoy la única huella de quién creó un perfil gestionado es la fila de arranque
-- de `family_permissions`, que puede borrarse o transferirse. Esta columna la
-- hace explícita y además es la que habilita la política de arranque de
-- `family_permissions` en la migración de RLS: sin ella, el creador de un perfil
-- gestionado no podría insertar su propia fila de administración (nadie tiene
-- todavía `can_manage` sobre ese perfil) y el caso B del modelo sería
-- inimplementable desde la aplicación.
-- =============================================================================

alter table public.profiles
    add column created_by_profile_id uuid
        references public.profiles (id) on delete set null;

comment on column public.profiles.created_by_profile_id is
    'Perfil que creó esta fila. NULL para los perfiles que se autocrean al registrarse una cuenta; completado con el perfil actor cuando se crea un perfil GESTIONADO. Es trazabilidad (deuda D1) y, además, la condición que habilita la fila de arranque de family_permissions. ON DELETE SET NULL: el rastro se pierde antes que romper la supresión del creador.';

create index profiles_created_by_profile_id_idx
    on public.profiles (created_by_profile_id)
    where created_by_profile_id is not null;


-- =============================================================================
-- 3. D2 — created_by_profile_id en las ocho tablas de contenido
-- -----------------------------------------------------------------------------
-- TRAZABILIDAD, NO AUTORIDAD: la matriz de permisos de docs/modelo-permisos.md
-- no lee esta columna (todavía). Existe para poder mostrar "cargado por Ana" y
-- para que, si el producto alguna vez pide "quien subió puede corregir su propia
-- carga durante N horas", el dato esté; retro-completarlo después es imposible.
-- El sellado contra falsificación (forzar created_by_profile_id = perfil actor)
-- vive en la migración de RLS, junto al resto de los complementos de política.
--
-- La columna se llama igual que la de D1 en `profiles`: un concepto, un nombre.
-- El sufijo `_profile_id` no es decorativo — deja explícito que referencia a
-- public.profiles y NO a auth.users, dos uuid distintos que conviven en varias
-- tablas de este esquema, y eso se propaga a los tipos que genera el CLI.
-- =============================================================================

alter table public.documents          add column created_by_profile_id uuid references public.profiles (id) on delete set null;
alter table public.lab_metrics        add column created_by_profile_id uuid references public.profiles (id) on delete set null;
alter table public.appointments       add column created_by_profile_id uuid references public.profiles (id) on delete set null;
alter table public.medications        add column created_by_profile_id uuid references public.profiles (id) on delete set null;
alter table public.medication_intakes add column created_by_profile_id uuid references public.profiles (id) on delete set null;
alter table public.vital_signs        add column created_by_profile_id uuid references public.profiles (id) on delete set null;
alter table public.insurance_cards    add column created_by_profile_id uuid references public.profiles (id) on delete set null;
alter table public.doctors            add column created_by_profile_id uuid references public.profiles (id) on delete set null;

comment on column public.documents.created_by_profile_id is
    'Perfil que cargó el documento. Trazabilidad, no autoridad: la matriz de permisos no la usa (todavía). ON DELETE SET NULL para que borrar a quien cargó no borre el dato de salud.';
comment on column public.lab_metrics.created_by_profile_id is
    'Perfil que cargó la métrica. Trazabilidad, no autoridad: la matriz de permisos no la usa (todavía).';
comment on column public.appointments.created_by_profile_id is
    'Perfil que cargó el turno. Trazabilidad, no autoridad: la matriz de permisos no la usa (todavía).';
comment on column public.medications.created_by_profile_id is
    'Perfil que cargó la medicación. Trazabilidad, no autoridad: la matriz de permisos no la usa (todavía).';
comment on column public.medication_intakes.created_by_profile_id is
    'Perfil que registró la toma. Trazabilidad, no autoridad: la matriz de permisos no la usa (todavía). Es el dato que permite mostrar "registrado por Ana" en el historial de tomas.';
comment on column public.vital_signs.created_by_profile_id is
    'Perfil que registró la medición. Trazabilidad, no autoridad: la matriz de permisos no la usa (todavía).';
comment on column public.insurance_cards.created_by_profile_id is
    'Perfil que cargó la cobertura. Trazabilidad, no autoridad: la matriz de permisos no la usa (todavía).';
comment on column public.doctors.created_by_profile_id is
    'Perfil que dio de alta al profesional en la agenda. Trazabilidad, no autoridad: la matriz de permisos no la usa (todavía).';

-- Índices parciales sobre la FK: sin ellos, cada DELETE de un perfil obliga a un
-- scan secuencial de las ocho tablas para resolver el SET NULL.
create index documents_created_by_profile_id_idx          on public.documents          (created_by_profile_id) where created_by_profile_id is not null;
create index lab_metrics_created_by_profile_id_idx        on public.lab_metrics        (created_by_profile_id) where created_by_profile_id is not null;
create index appointments_created_by_profile_id_idx       on public.appointments       (created_by_profile_id) where created_by_profile_id is not null;
create index medications_created_by_profile_id_idx        on public.medications        (created_by_profile_id) where created_by_profile_id is not null;
create index medication_intakes_created_by_profile_id_idx on public.medication_intakes (created_by_profile_id) where created_by_profile_id is not null;
create index vital_signs_created_by_profile_id_idx        on public.vital_signs        (created_by_profile_id) where created_by_profile_id is not null;
create index insurance_cards_created_by_profile_id_idx    on public.insurance_cards    (created_by_profile_id) where created_by_profile_id is not null;
create index doctors_created_by_profile_id_idx            on public.doctors            (created_by_profile_id) where created_by_profile_id is not null;


-- =============================================================================
-- 4. D4 — invariante de no orfandad de perfiles gestionados
-- -----------------------------------------------------------------------------
-- Un perfil gestionado (user_id IS NULL) sin ninguna fila con can_manage = true
-- guarda datos de salud de una persona real que NADIE puede leer, corregir ni
-- borrar: falla a la vez el derecho de acceso, el de rectificación y el de
-- supresión de la Ley 25.326. Es un estado prohibido, no una configuración.
--
-- El trigger cierra los tres caminos a la orfandad (renuncia del último
-- administrador, destitución cruzada, y CASCADE por baja de cuenta), y deja
-- pasar el único borrado legítimo: el CASCADE que dispara el DELETE del propio
-- perfil dueño. Se distingue por la existencia de la fila de `profiles`: cuando
-- el borrado viene del dueño, la fila ya no existe al ejecutarse este trigger.
-- =============================================================================

create or replace function public.evitar_perfil_gestionado_huerfano()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_owner          uuid := old.owner_profile_id;
    v_es_gestionado  boolean;
    v_quedan         integer;
    v_retorno        public.family_permissions%rowtype;
begin
    v_retorno := case when tg_op = 'DELETE' then old else new end;

    -- La fila que se toca no confería administración: no puede orfanar a nadie.
    if not old.can_manage then
        return v_retorno;
    end if;

    -- UPDATE que conserva can_manage sobre el mismo perfil: sigue habiendo
    -- administrador, no hay nada que verificar.
    if tg_op = 'UPDATE'
       and new.can_manage
       and new.owner_profile_id = old.owner_profile_id
    then
        return v_retorno;
    end if;

    -- El perfil dueño ya no existe => estamos dentro del CASCADE de su propio
    -- DELETE. Es el borrado legítimo del perfil: dejar pasar.
    select (p.user_id is null)
      into v_es_gestionado
      from public.profiles p
     where p.id = v_owner;

    if not found then
        return v_retorno;
    end if;

    -- Un perfil con cuenta nunca queda huérfano: su titular siempre puede entrar.
    if not v_es_gestionado then
        return v_retorno;
    end if;

    select count(*)
      into v_quedan
      from public.family_permissions fp
     where fp.owner_profile_id = v_owner
       and fp.can_manage
       and fp.id <> old.id;

    if v_quedan = 0 then
        raise exception
            'El perfil gestionado % quedaría sin ningún administrador. Transferí la administración a otra persona o eliminá el perfil y sus datos antes de quitar este acceso.',
            v_owner
            using errcode = 'restrict_violation';
    end if;

    return v_retorno;
end;
$$;

comment on function public.evitar_perfil_gestionado_huerfano() is
    'Trigger BEFORE DELETE OR UPDATE en family_permissions: impide que un perfil gestionado (user_id IS NULL) se quede sin ninguna fila con can_manage. Deja pasar el CASCADE del borrado del propio perfil dueño, que se detecta porque la fila de profiles ya no existe. Implementa la deuda D4 y el caso 8.2 de docs/modelo-permisos.md.';

create trigger family_permissions_evitar_huerfano
    before delete or update on public.family_permissions
    for each row execute function public.evitar_perfil_gestionado_huerfano();


-- =============================================================================
-- 5. D5 — cola de purga de objetos de Storage
-- -----------------------------------------------------------------------------
-- Ningún CASCADE de Postgres alcanza a `storage.objects`: borrar un perfil deja
-- los PDF y las fotos de la credencial vivos en los buckets. Es la diferencia
-- entre cumplir el derecho de supresión (Ley 25.326, art. 16) y aparentar
-- cumplirlo.
--
-- Se eligió la opción 2 de la deuda D5 (tabla de purga alimentada por triggers)
-- sobre la opción 1 (borrado desde la Server Action) porque es robusta ante
-- CUALQUIER vía de borrado: Studio, SQL directo, CASCADE de una baja de cuenta.
-- La Server Action puede además borrar en caliente; la cola es la red de
-- seguridad.
--
-- ALCANCE DE ESTA MIGRACIÓN: tabla + triggers productores + su RLS.
-- El job que la drena (Edge Function con service_role que borra los objetos y
-- completa `purged_at`) es del Sprint 6.
-- =============================================================================

create table public.storage_purge_queue (
    id            uuid primary key default gen_random_uuid(),
    bucket        text not null,
    storage_path  text not null,
    source_table  text not null,
    source_id     uuid not null,
    created_at    timestamptz not null default now(),
    purged_at     timestamptz,

    constraint storage_purge_queue_bucket_no_vacio
        check (char_length(btrim(bucket)) > 0),
    constraint storage_purge_queue_path_no_es_url
        check (char_length(btrim(storage_path)) > 0
               and lower(storage_path) not like 'http%')
);

comment on table public.storage_purge_queue is
    'Cola de objetos de Storage pendientes de borrado físico. La alimentan triggers AFTER DELETE sobre documents, insurance_cards y profiles; la drena un job con service_role (Sprint 6) que borra el objeto del bucket y completa purged_at. Existe porque ningún CASCADE de Postgres alcanza a storage.objects y un perfil "suprimido" no puede dejar sus datos de salud vivos en un bucket (Ley 25.326, art. 16). Solo service_role accede: no tiene ninguna política RLS.';
comment on column public.storage_purge_queue.bucket is
    'Bucket donde vive el objeto (documentos-medicos, credenciales-cobertura, avatares). Los literales deben coincidir con los buckets que crea la migración de Storage; si esa migración elige otros nombres, hay que actualizar public.encolar_purga_storage().';
comment on column public.storage_purge_queue.storage_path is
    'Path del objeto dentro del bucket. Nunca una URL (lo impide el CHECK), igual que en las tablas de origen.';
comment on column public.storage_purge_queue.source_table is
    'Tabla que originó el encolado (documents, insurance_cards, profiles). Texto libre a propósito: la cola no debe acoplarse al esquema.';
comment on column public.storage_purge_queue.source_id is
    'Identificador de la fila borrada. Sin FK: la fila ya no existe cuando esto se escribe.';
comment on column public.storage_purge_queue.purged_at is
    'Momento en que el job confirmó el borrado del objeto en el bucket. NULL = pendiente. No se borran las filas drenadas: son la prueba de que la supresión se ejecutó.';

create index storage_purge_queue_pendientes_idx
    on public.storage_purge_queue (created_at)
    where purged_at is null;

create or replace function public.encolar_purga_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_table_name = 'documents' then
        insert into public.storage_purge_queue (bucket, storage_path, source_table, source_id)
        values ('documentos-medicos', old.storage_path, 'documents', old.id);

    elsif tg_table_name = 'insurance_cards' then
        if old.front_storage_path is not null then
            insert into public.storage_purge_queue (bucket, storage_path, source_table, source_id)
            values ('credenciales-cobertura', old.front_storage_path, 'insurance_cards', old.id);
        end if;
        if old.back_storage_path is not null then
            insert into public.storage_purge_queue (bucket, storage_path, source_table, source_id)
            values ('credenciales-cobertura', old.back_storage_path, 'insurance_cards', old.id);
        end if;

    elsif tg_table_name = 'profiles' then
        if old.avatar_storage_path is not null then
            insert into public.storage_purge_queue (bucket, storage_path, source_table, source_id)
            values ('avatares', old.avatar_storage_path, 'profiles', old.id);
        end if;
    end if;

    return null;
end;
$$;

comment on function public.encolar_purga_storage() is
    'Trigger AFTER DELETE: encola en storage_purge_queue los paths de Storage de la fila borrada. SECURITY DEFINER porque quien borra un documento (un usuario autenticado) no tiene ni debe tener privilegios sobre la cola.';

create trigger documents_encolar_purga_storage
    after delete on public.documents
    for each row execute function public.encolar_purga_storage();

create trigger insurance_cards_encolar_purga_storage
    after delete on public.insurance_cards
    for each row execute function public.encolar_purga_storage();

create trigger profiles_encolar_purga_storage
    after delete on public.profiles
    for each row execute function public.encolar_purga_storage();

-- Fin de la migración.
