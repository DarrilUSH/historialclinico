-- =============================================================================
-- MiHistorialMédico — Migración 20260812220000: Row Level Security
-- -----------------------------------------------------------------------------
-- Implementa LITERALMENTE la matriz rol × recurso × operación de la sección 6 de
-- `docs/modelo-permisos.md`, más los complementos de la sección 7.3 que RLS por
-- sí sola no puede expresar.
--
-- Estructura del archivo:
--   1. Funciones auxiliares SECURITY DEFINER (evitan la recursión 42P17)
--   2. Complementos de política: triggers que RLS no puede reemplazar
--   3. ENABLE ROW LEVEL SECURITY en las 13 tablas
--   4. Privilegios de tabla (REVOKE/GRANT): anon sin nada del dominio
--   5. Políticas, tabla por tabla, en el orden de la matriz
--
-- PRINCIPIOS QUE ESTE ARCHIVO NO NEGOCIA:
--   * `profiles.role` NO se lee en ninguna política. El enum user_role es
--     descriptivo; si una política lo mirara, cualquiera escalaría privilegios
--     editando un campo de interfaz.
--   * Negación por defecto: sin fila en family_permissions y sin titularidad, el
--     resultado son CERO FILAS, nunca un error que revele que el dato existe.
--   * `access_logs` es append-only para todos los roles de usuario: no hay
--     política de UPDATE ni de DELETE, y además se revoca el privilegio.
--   * `push_subscriptions` queda fuera del modelo familiar: se resuelve solo por
--     user_id = auth.uid().
--
-- POR QUÉ NO SE USA `FORCE ROW LEVEL SECURITY`:
--   Las 13 tablas son propiedad de `postgres`, y en Supabase tanto `postgres`
--   como `service_role` tienen el atributo de rol BYPASSRLS, que se evalúa ANTES
--   que FORCE: activarlo no cambiaría el comportamiento de ningún rol real.
--   Lo que sí haría es someter a RLS a las funciones SECURITY DEFINER de la
--   sección 1 si alguna vez se les quitara el bypass, reintroduciendo
--   exactamente la recursión 42P17 que vienen a evitar, y romper el seed y las
--   migraciones. La protección efectiva contra el uso indebido de service_role
--   no es FORCE: es que la SERVICE_ROLE_KEY nunca salga del servidor.
-- =============================================================================


-- =============================================================================
-- 1. FUNCIONES AUXILIARES (sección 7.2 de docs/modelo-permisos.md)
-- -----------------------------------------------------------------------------
-- El problema que resuelven, concreto: la política de SELECT de `profiles`
-- necesita consultar `family_permissions`, y la de `family_permissions` necesita
-- resolver cuál es el perfil del actor, o sea consultar `profiles`. Postgres
-- detecta el ciclo y aborta con
--     42P17 infinite recursion detected in policy for relation "profiles"
--
-- Por qué estas funciones NO recursan: son SECURITY DEFINER y su dueño
-- (`postgres`) es el dueño de las tablas y tiene BYPASSRLS. Al ejecutarse, las
-- consultas de adentro no evalúan ninguna política, así que la política que las
-- invoca no vuelve a entrar. El ciclo se corta en la frontera de la función.
--
-- Reglas de uso (las mismas que fija el documento):
--   * STABLE, para que el planner las evalúe una vez por sentencia y no por fila.
--   * `set search_path = ''` y todo objeto calificado con su esquema: sin esto,
--     un search_path manipulado por el cliente podría hacer que la función
--     resuelva otra tabla (lint `function_search_path_mutable` de Supabase).
--   * Cada política usa UNA sola de estas funciones por cláusula. Combinar dos
--     EXISTS escritos a mano dentro de la política es lo que reintroduce la
--     recursión.
--
-- Viven en `public` y no en un esquema privado porque así las nombra el contrato
-- (`docs/modelo-permisos.md` §7.2 y el ROADMAP), y porque quedan protegidas por
-- privilegio: se revoca EXECUTE de PUBLIC y de `anon`. Que `authenticated` pueda
-- invocarlas por RPC no filtra nada: todas responden exclusivamente sobre la
-- autoridad del propio invocante, que él ya conoce.
-- =============================================================================

-- Perfil desde el que está operando la sesión. NULL si la cuenta todavía no
-- creó su perfil (estado válido: recién registrado).
create or replace function public.perfil_actor()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select p.id
      from public.profiles p
     where p.user_id = (select auth.uid())
     limit 1;
$$;

comment on function public.perfil_actor() is
    'Devuelve profiles.id cuyo user_id = auth.uid(), o NULL si la cuenta aún no tiene perfil. SECURITY DEFINER para que las políticas puedan resolver el perfil actor sin volver a entrar en la política de profiles (recursión 42P17).';

-- Titular de datos CON CUENTA: el actor es la persona del perfil.
create or replace function public.es_titular(perfil uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.profiles p
         where p.id = perfil
           and p.user_id is not null
           and p.user_id = (select auth.uid())
    );
$$;

comment on function public.es_titular(uuid) is
    'TRUE si el perfil existe y su user_id es el de la sesión. Es la vía directa del caso A: el titular con cuenta no necesita ninguna fila de family_permissions sobre sí mismo (el CHECK de no autorreferencia lo prohíbe).';

-- El perfil no tiene cuenta: es un perfil GESTIONADO. De este predicado dependen
-- todas las notas ⚑ de la matriz.
create or replace function public.es_perfil_gestionado(perfil uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.profiles p
         where p.id = perfil
           and p.user_id is null
    );
$$;

comment on function public.es_perfil_gestionado(uuid) is
    'TRUE si el perfil existe y su user_id es NULL (perfil gestionado, sin cuenta). Es lo que leen las notas ⚑ de la matriz para transferir a los administradores las potestades del titular ausente. Se evalúa en tiempo de consulta: el día que el perfil reciba cuenta, esas potestades vuelven solas a su titular.';

-- LEER. Monótona a propósito: acepta también a quien tenga solo can_upload o
-- solo can_manage, para que una fila incoherente (mientras no exista la deuda
-- D3) degrade a "puede ver" y no a "escribe a ciegas".
create or replace function public.puede_ver_perfil(perfil uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.es_titular(perfil)
        or exists (
            select 1
              from public.family_permissions fp
             where fp.owner_profile_id = perfil
               and fp.granted_profile_id = public.perfil_actor()
               and (fp.can_view or fp.can_upload or fp.can_manage)
        );
$$;

comment on function public.puede_ver_perfil(uuid) is
    'Predicado de LECTURA de la matriz: titular, o fila de permiso con can_view OR can_upload OR can_manage. Monótono a propósito (deuda D3). Lo usan las políticas SELECT de profiles y de las ocho tablas de contenido, y debe usarlo también la política de lectura de Storage.';

-- CREAR contenido nuevo. No habilita UPDATE ni DELETE (regla de can_upload).
create or replace function public.puede_cargar_en_perfil(perfil uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.es_titular(perfil)
        or exists (
            select 1
              from public.family_permissions fp
             where fp.owner_profile_id = perfil
               and fp.granted_profile_id = public.perfil_actor()
               and (fp.can_upload or fp.can_manage)
        );
$$;

comment on function public.puede_cargar_en_perfil(uuid) is
    'Predicado de CREACIÓN de la matriz: titular, o fila de permiso con can_upload OR can_manage. can_upload NO habilita UPDATE ni DELETE: la única excepción es la transición pending -> taken|skipped de medication_intakes (nota ⑩).';

-- ADMINISTRAR: editar y borrar contenido, editar el perfil y su ficha SOS.
create or replace function public.puede_administrar_perfil(perfil uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.es_titular(perfil)
        or exists (
            select 1
              from public.family_permissions fp
             where fp.owner_profile_id = perfil
               and fp.granted_profile_id = public.perfil_actor()
               and fp.can_manage
        );
$$;

comment on function public.puede_administrar_perfil(uuid) is
    'Predicado de EDICIÓN/BORRADO de la matriz: titular, o fila de permiso con can_manage. Es también el criterio con el que el envío de alertas clínicas resuelve destinatarios.';

-- AUTORIDAD DE OTORGAMIENTO (sección 4.4). Es también el predicado de "ver la
-- lista de accesos" y de "borrar el perfil": las tres potestades del titular que
-- las notas ⚑ transfieren al administrador solo cuando no hay titular capaz de
-- ejercerlas.
create or replace function public.puede_otorgar_permisos(perfil uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.es_titular(perfil)
        or (public.es_perfil_gestionado(perfil) and public.puede_administrar_perfil(perfil));
$$;

comment on function public.puede_otorgar_permisos(uuid) is
    'Regla de la autoridad de otorgamiento (sección 4.4): si el perfil TIENE cuenta, solo su titular otorga —ni siquiera un can_manage—; si es GESTIONADO, cualquier can_manage, porque el titular no puede iniciar sesión y el perfil quedaría congelado para siempre. El mismo predicado gobierna las notas ⚑ de DELETE de profiles y de SELECT de access_logs.';

-- ARRANQUE (bootstrap) de un perfil gestionado.
-- NO está en la lista de siete funciones del documento: se agregó al implementar
-- la matriz porque sin ella el caso B es inimplementable desde la aplicación.
-- El agujero, concreto: cuando María crea el perfil de Roberto, nadie tiene
-- todavía can_manage sobre él, así que `puede_otorgar_permisos(p-roberto)` es
-- FALSE y la fila de arranque —que el propio documento declara obligatoria—
-- sería rechazada por RLS. El perfil nacería huérfano e inaccesible.
-- La alternativa era crear el perfil con service_role, y eso mueve una operación
-- del modelo fuera del alcance de la matriz. Se prefirió una extensión mínima y
-- auditable, con cuatro condiciones simultáneas.
create or replace function public.puede_arrancar_administracion(perfil uuid, autorizado uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select autorizado is not null
       and autorizado = public.perfil_actor()
       and exists (
            select 1
              from public.profiles p
             where p.id = perfil
               and p.user_id is null
               and p.created_by_profile_id = public.perfil_actor()
       )
       and not exists (
            select 1
              from public.family_permissions fp
             where fp.owner_profile_id = perfil
               and fp.can_manage
       );
$$;

comment on function public.puede_arrancar_administracion(uuid, uuid) is
    'Habilita la ÚNICA fila de family_permissions que se crea sin que nadie tenga permiso previo: la de arranque de un perfil gestionado. Exige las cuatro condiciones a la vez: (1) el perfil es gestionado, (2) lo creó el perfil actor (columna created_by_profile_id, deuda D1), (3) el autorizado es el propio perfil actor —no se puede arrancar a nombre de un tercero— y (4) el perfil todavía no tiene ningún can_manage. Deja de valer para siempre en cuanto existe el primer administrador.';

-- Privilegio de ejecución: CREATE FUNCTION otorga EXECUTE a PUBLIC por defecto.
revoke execute on function public.perfil_actor()                            from public;
revoke execute on function public.es_titular(uuid)                          from public;
revoke execute on function public.es_perfil_gestionado(uuid)                from public;
revoke execute on function public.puede_ver_perfil(uuid)                    from public;
revoke execute on function public.puede_cargar_en_perfil(uuid)              from public;
revoke execute on function public.puede_administrar_perfil(uuid)            from public;
revoke execute on function public.puede_otorgar_permisos(uuid)              from public;
revoke execute on function public.puede_arrancar_administracion(uuid, uuid) from public;

grant execute on function public.perfil_actor()                            to authenticated, service_role;
grant execute on function public.es_titular(uuid)                          to authenticated, service_role;
grant execute on function public.es_perfil_gestionado(uuid)                to authenticated, service_role;
grant execute on function public.puede_ver_perfil(uuid)                    to authenticated, service_role;
grant execute on function public.puede_cargar_en_perfil(uuid)              to authenticated, service_role;
grant execute on function public.puede_administrar_perfil(uuid)            to authenticated, service_role;
grant execute on function public.puede_otorgar_permisos(uuid)              to authenticated, service_role;
grant execute on function public.puede_arrancar_administracion(uuid, uuid) to authenticated, service_role;


-- =============================================================================
-- 2. COMPLEMENTOS DE POLÍTICA (sección 7.3 de docs/modelo-permisos.md)
-- -----------------------------------------------------------------------------
-- RLS autoriza FILAS, no columnas ni transiciones. Estas tres piezas cubren lo
-- que la matriz exige y una política no puede decir. Todas se aplican solo a
-- sesiones de usuario: el seed, las migraciones y los jobs con service_role no
-- pasan por ellas.
--
-- LOS TRES TRIGGERS SON `SECURITY INVOKER`, Y ES DELIBERADO. Dentro de una
-- función SECURITY DEFINER, `current_user` es el DUEÑO de la función (postgres),
-- no el rol de la sesión: una guarda escrita como "aplicar solo si current_user
-- es authenticated" nunca se dispararía y los tres complementos quedarían
-- silenciosamente desactivados. Como ninguno de los tres necesita saltear RLS
-- —solo leen NEW/OLD e invocan las funciones auxiliares de la sección 1, que sí
-- son DEFINER— corren como invocador y ven el rol real.
-- =============================================================================

-- 2.0 Detección de sesión de usuario.
-- Dos señales, en OR, porque ninguna alcanza sola: `current_user` distingue el
-- request de PostgREST (que hace SET LOCAL ROLE authenticated) del seed y las
-- migraciones, y `auth.uid()` cubre el caso de una función SECURITY DEFINER
-- invocada por un usuario, donde current_user ya no es el suyo pero el JWT sigue
-- estando. Un job con service_role no tiene `sub` en el JWT, así que no dispara
-- ninguna de las dos.
create or replace function public.es_sesion_de_usuario()
returns boolean
language sql
stable
set search_path = ''
as $$
    select current_user in ('authenticated', 'anon')
        or (select auth.uid()) is not null;
$$;

comment on function public.es_sesion_de_usuario() is
    'TRUE cuando la escritura viene de una sesión de usuario final y no del seed, una migración o un job con service_role. SECURITY INVOKER a propósito: si fuera DEFINER, current_user sería siempre postgres y la función mentiría.';

revoke execute on function public.es_sesion_de_usuario() from public;
grant  execute on function public.es_sesion_de_usuario() to authenticated, service_role;

-- 2.1 Nota ② — `user_id` de un perfil es inmutable desde la aplicación.
-- WITH CHECK puede exigir "user_id = auth.uid() OR user_id IS NULL", pero no
-- "igual al valor anterior", y cambiar la titularidad de un perfil es
-- exactamente la operación con la que alguien se adueñaría del historial ajeno.
-- Se aprovecha para sellar también created_by_profile_id (deuda D1).
create or replace function public.proteger_titularidad_de_perfil()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if not public.es_sesion_de_usuario() then
        return new;
    end if;

    if tg_op = 'INSERT' then
        -- El creador no se declara: se sella con el perfil actor.
        new.created_by_profile_id := public.perfil_actor();
        return new;
    end if;

    if new.user_id is distinct from old.user_id then
        raise exception
            'Cambiar la cuenta a la que pertenece un perfil no es una edición sino un cambio de titularidad, y no está habilitado desde la aplicación.'
            using errcode = 'insufficient_privilege';
    end if;

    new.created_by_profile_id := old.created_by_profile_id;
    return new;
end;
$$;

comment on function public.proteger_titularidad_de_perfil() is
    'Complemento de la nota ② de la matriz: rechaza cualquier cambio de profiles.user_id hecho desde una sesión de usuario y sella created_by_profile_id (inmutable, y en el alta igual al perfil actor). La transición de perfil gestionado a perfil con cuenta (sección 8.6) es un flujo server-side dedicado, no una edición.';

create trigger profiles_proteger_titularidad
    before insert or update on public.profiles
    for each row execute function public.proteger_titularidad_de_perfil();

-- 2.2 Deuda D2 — `created_by_profile_id` es trazabilidad, y la trazabilidad
-- falsificable no sirve. Ninguna política lee la columna, pero se sella igual:
-- si mañana el producto pide "quien subió puede corregir su propia carga", el
-- dato tiene que ser confiable desde el primer día.
create or replace function public.sellar_created_by_profile_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if not public.es_sesion_de_usuario() then
        return new;
    end if;

    if tg_op = 'INSERT' then
        new.created_by_profile_id := public.perfil_actor();
    else
        new.created_by_profile_id := old.created_by_profile_id;
    end if;

    return new;
end;
$$;

comment on function public.sellar_created_by_profile_id() is
    'Fija created_by_profile_id = perfil actor en el alta e impide modificarlo después, para sesiones de usuario. El seed y los jobs con service_role pueden escribir el valor que corresponda. Trazabilidad, no autoridad: ninguna política de esta migración lee la columna.';

create trigger documents_sellar_created_by_profile_id          before insert or update on public.documents          for each row execute function public.sellar_created_by_profile_id();
create trigger lab_metrics_sellar_created_by_profile_id        before insert or update on public.lab_metrics        for each row execute function public.sellar_created_by_profile_id();
create trigger appointments_sellar_created_by_profile_id       before insert or update on public.appointments       for each row execute function public.sellar_created_by_profile_id();
create trigger medications_sellar_created_by_profile_id        before insert or update on public.medications        for each row execute function public.sellar_created_by_profile_id();
create trigger medication_intakes_sellar_created_by_profile_id before insert or update on public.medication_intakes for each row execute function public.sellar_created_by_profile_id();
create trigger vital_signs_sellar_created_by_profile_id        before insert or update on public.vital_signs        for each row execute function public.sellar_created_by_profile_id();
create trigger insurance_cards_sellar_created_by_profile_id    before insert or update on public.insurance_cards    for each row execute function public.sellar_created_by_profile_id();
create trigger doctors_sellar_created_by_profile_id            before insert or update on public.doctors            for each row execute function public.sellar_created_by_profile_id();

-- 2.3 Nota ⑩ — la excepción de la toma no puede convertirse en reprogramación.
-- La política de UPDATE de medication_intakes restringe la fila vieja
-- (status = 'pending') y la nueva (status IN ('taken','skipped')), pero RLS no
-- compara columna a columna contra OLD: sin este trigger, un can_upload podría
-- mover la toma a otro horario, a otra medicación o a otro perfil en la misma
-- sentencia que la confirma.
create or replace function public.proteger_programacion_de_toma()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if not public.es_sesion_de_usuario() then
        return new;
    end if;

    if public.puede_administrar_perfil(old.profile_id) then
        return new;
    end if;

    if new.medication_id is distinct from old.medication_id
       or new.scheduled_at is distinct from old.scheduled_at
       or new.profile_id  is distinct from old.profile_id
    then
        raise exception
            'Registrar una toma no permite reprogramarla: cambiar la medicación, el horario o el perfil de una toma requiere permiso de administración.'
            using errcode = 'insufficient_privilege';
    end if;

    return new;
end;
$$;

comment on function public.proteger_programacion_de_toma() is
    'Complemento de la nota ⑩: un can_upload puede llevar una toma de pending a taken|skipped, pero no puede cambiar medication_id, scheduled_at ni profile_id en la misma sentencia. Quien administra el perfil no queda alcanzado.';

create trigger medication_intakes_proteger_programacion
    before update on public.medication_intakes
    for each row execute function public.proteger_programacion_de_toma();


-- =============================================================================
-- 3. HABILITACIÓN DE ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
-- Las 12 tablas de dominio más storage_purge_queue. Ninguna excepción: el
-- criterio de aceptación es que
--     select tablename from pg_tables where schemaname='public' and rowsecurity=false
-- devuelva VACÍO.
-- =============================================================================

alter table public.profiles            enable row level security;
alter table public.family_permissions  enable row level security;
alter table public.doctors             enable row level security;
alter table public.documents           enable row level security;
alter table public.lab_metrics         enable row level security;
alter table public.appointments        enable row level security;
alter table public.medications         enable row level security;
alter table public.medication_intakes  enable row level security;
alter table public.vital_signs         enable row level security;
alter table public.insurance_cards     enable row level security;
alter table public.access_logs         enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.storage_purge_queue enable row level security;


-- =============================================================================
-- 4. PRIVILEGIOS DE TABLA
-- -----------------------------------------------------------------------------
-- RLS filtra filas DENTRO de un privilegio que ya existe; no lo reemplaza. Las
-- dos capas tienen que decir lo mismo, y este proyecto no expone ninguna tabla
-- del dominio al rol `anon`: no hay una sola fila de estas tablas que un
-- visitante sin sesión deba poder leer.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select, insert, update, delete on
      public.profiles,
      public.family_permissions,
      public.doctors,
      public.documents,
      public.lab_metrics,
      public.appointments,
      public.medications,
      public.medication_intakes,
      public.vital_signs,
      public.insurance_cards,
      public.push_subscriptions
   to authenticated;

-- access_logs: APPEND-ONLY. No se otorgan UPDATE ni DELETE a nadie, ni siquiera
-- al titular. La ausencia de política ya lo impediría; la ausencia de privilegio
-- lo impide una capa antes y sin depender de que RLS esté habilitada.
grant select, insert on public.access_logs to authenticated;

-- storage_purge_queue: exclusiva de service_role. Sin GRANT y sin políticas, un
-- usuario autenticado no puede leerla ni escribirla; los triggers que la
-- alimentan son SECURITY DEFINER, así que no necesitan que él tenga privilegio.
grant select, insert, update, delete on public.storage_purge_queue to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;


-- =============================================================================
-- 5. POLÍTICAS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 5.1 profiles
-- -----------------------------------------------------------------------------

-- SELECT: dueño ✓ · can_view ✓ · can_upload ✓ · can_manage ✓ · sin permiso ✗
create policy profiles_select_visible
    on public.profiles
    for select
    to authenticated
    using (public.puede_ver_perfil(id));

comment on policy profiles_select_visible on public.profiles is
    'Fila de O visible para el titular de O y para cualquier autorizado sobre O. Sin fila de permiso: cero filas, no error.';

-- INSERT (nota ①): no se evalúa contra un perfil objetivo preexistente.
-- (a) el propio perfil, con user_id = auth.uid() (una sola vez, lo garantiza
--     profiles_user_id_unico), o (b) un perfil gestionado, con user_id IS NULL.
-- Insertar una fila con el user_id de OTRA cuenta está prohibido.
create policy profiles_insert_propio_o_gestionado
    on public.profiles
    for insert
    to authenticated
    with check (
        (user_id is null or user_id = (select auth.uid()))
        and (created_by_profile_id is null or created_by_profile_id = public.perfil_actor())
    );

comment on policy profiles_insert_propio_o_gestionado on public.profiles is
    'Nota ①: cualquier autenticado crea su propio perfil (user_id = auth.uid()) o un perfil gestionado (user_id IS NULL); nunca uno a nombre de otra cuenta. La segunda condición impide atribuir la creación a un tercero; el trigger profiles_proteger_titularidad la sella además con el perfil actor.';

-- UPDATE (nota ②): dueño ✓ · can_manage ✓ · resto ✗.
-- Alcanza datos de contacto, avatar y ficha SOS completa. NO alcanza user_id:
-- lo impide el trigger profiles_proteger_titularidad.
create policy profiles_update_administrador
    on public.profiles
    for update
    to authenticated
    using (public.puede_administrar_perfil(id))
    with check (public.puede_administrar_perfil(id));

comment on policy profiles_update_administrador on public.profiles is
    'Nota ②: titular o can_manage editan el perfil y su ficha SOS. El WITH CHECK evita además que la fila quede en un estado sobre el que el actor ya no tendría autoridad. La inmutabilidad de user_id la garantiza un trigger, porque RLS no puede comparar contra el valor anterior.';

-- DELETE (nota ③ ⚑): dueño ✓ · can_manage solo si el perfil es gestionado.
create policy profiles_delete_autoridad_titular
    on public.profiles
    for delete
    to authenticated
    using (public.puede_otorgar_permisos(id));

comment on policy profiles_delete_autoridad_titular on public.profiles is
    'Nota ③ ⚑: un perfil CON cuenta lo borra únicamente su titular; un perfil GESTIONADO puede borrarlo cualquiera de sus administradores, porque su titular no puede hacerlo por sí mismo y sin esa vía el derecho de supresión sería inejercitable. El predicado coincide exactamente con el de la autoridad de otorgamiento.';


-- -----------------------------------------------------------------------------
-- 5.2 family_permissions
-- -----------------------------------------------------------------------------

-- SELECT: dueño ✓ · can_view ✓④ · can_upload ✓④ · can_manage ✓ · sin permiso ✗
-- Nota ④: un autorizado ve SOLO su propia fila (para que la interfaz pueda
-- mostrarle qué puede hacer). La composición del grupo de acceso es información
-- del titular y de quien administra.
create policy family_permissions_select_propia_o_administrada
    on public.family_permissions
    for select
    to authenticated
    using (
        granted_profile_id = public.perfil_actor()
        or public.puede_administrar_perfil(owner_profile_id)
    );

comment on policy family_permissions_select_propia_o_administrada on public.family_permissions is
    'Nota ④: cada autorizado ve su propia fila; el titular y los can_manage ven todas las filas del perfil. Un can_view no descubre quién más entra a los datos que él ve.';

-- INSERT (nota ⑤ ⚑): dueño ✓ · can_manage solo si el perfil es gestionado.
create policy family_permissions_insert_autoridad
    on public.family_permissions
    for insert
    to authenticated
    with check (public.puede_otorgar_permisos(owner_profile_id));

comment on policy family_permissions_insert_autoridad on public.family_permissions is
    'Nota ⑤ ⚑ y sección 4.4: si el perfil tiene cuenta, solo su titular otorga (ni siquiera un can_manage: la sub-delegación estira el consentimiento a personas que el titular nunca vio y rompe la atomicidad de la revocación). Si es gestionado, cualquier can_manage.';

-- INSERT de arranque: la única fila que se crea sin permiso previo.
create policy family_permissions_insert_arranque_gestionado
    on public.family_permissions
    for insert
    to authenticated
    with check (
        can_manage
        and public.puede_arrancar_administracion(owner_profile_id, granted_profile_id)
    );

comment on policy family_permissions_insert_arranque_gestionado on public.family_permissions is
    'Fila de arranque del caso B: quien acaba de crear un perfil gestionado se otorga a sí mismo la administración, y solo mientras ese perfil no tenga ningún can_manage. Sin esta política un perfil gestionado nacería huérfano —estado prohibido por la sección 8.2— o habría que crearlo con service_role, sacando del alcance de la matriz una operación central del producto.';

-- UPDATE (notas ⑤ ⚑ y ⑥): la autoridad de otorgamiento, menos las destituciones
-- cruzadas. Un administrador no puede bajarle los flags a otro administrador:
-- evita la guerra de hermanos donde el que llega primero al botón deja al otro
-- afuera del historial del padre.
create policy family_permissions_update_autoridad
    on public.family_permissions
    for update
    to authenticated
    using (
        public.es_titular(owner_profile_id)
        or (
            public.puede_otorgar_permisos(owner_profile_id)
            and (not can_manage or granted_profile_id = public.perfil_actor())
        )
    )
    with check (public.puede_otorgar_permisos(owner_profile_id));

comment on policy family_permissions_update_autoridad on public.family_permissions is
    'Notas ⑤ ⚑ y ⑥. USING: el titular edita cualquier fila de su perfil; un administrador de un perfil gestionado edita filas de can_view/can_upload y la suya propia, nunca la de otro administrador. WITH CHECK: la fila no puede terminar bajo un perfil sobre el que el actor no tenga autoridad de otorgamiento.';

-- DELETE (nota ⑦): renuncia. Todo autorizado puede borrar SU propia fila.
-- El rechazo cuando es el último can_manage de un perfil gestionado lo hace el
-- trigger family_permissions_evitar_huerfano (deuda D4), no la política: RLS
-- autoriza filas, no verifica el estado global posterior.
create policy family_permissions_delete_renuncia
    on public.family_permissions
    for delete
    to authenticated
    using (granted_profile_id = public.perfil_actor());

comment on policy family_permissions_delete_renuncia on public.family_permissions is
    'Nota ⑦: cualquiera deja de tener acceso borrando su propia fila. Si es el último administrador de un perfil gestionado, el trigger de no orfandad rechaza la operación con un mensaje accionable.';

-- DELETE (notas ⑤ ⚑, ⑥ y ⑦): revocación por parte de la autoridad.
create policy family_permissions_delete_autoridad
    on public.family_permissions
    for delete
    to authenticated
    using (
        public.es_titular(owner_profile_id)
        or (public.puede_otorgar_permisos(owner_profile_id) and not can_manage)
    );

comment on policy family_permissions_delete_autoridad on public.family_permissions is
    'Notas ⑤ ⚑ y ⑥: el titular revoca cualquier acceso a sus datos; un administrador de un perfil gestionado revoca accesos de can_view/can_upload, pero no puede destituir a otro administrador.';


-- -----------------------------------------------------------------------------
-- 5.3 Tablas de contenido (sección 6.1 de docs/modelo-permisos.md)
-- -----------------------------------------------------------------------------
-- Para las ocho la matriz colapsa en tres predicados:
--     SELECT          -> dueño O (can_view O can_upload O can_manage)
--     INSERT          -> dueño O (can_upload O can_manage)
--     UPDATE / DELETE -> dueño O can_manage
-- con una sola excepción expresable en RLS: la nota ⑩ de medication_intakes.
-- Las políticas de UPDATE llevan USING (fila vieja) y WITH CHECK (fila nueva):
-- omitir el segundo permitiría mover una fila a un profile_id ajeno.
-- -----------------------------------------------------------------------------

-- doctors
create policy doctors_select_puede_ver      on public.doctors for select to authenticated using (public.puede_ver_perfil(profile_id));
create policy doctors_insert_puede_cargar   on public.doctors for insert to authenticated with check (public.puede_cargar_en_perfil(profile_id));
create policy doctors_update_administrador  on public.doctors for update to authenticated using (public.puede_administrar_perfil(profile_id)) with check (public.puede_administrar_perfil(profile_id));
create policy doctors_delete_administrador  on public.doctors for delete to authenticated using (public.puede_administrar_perfil(profile_id));

-- documents (nota ⑧: la fila la filtra RLS; el archivo lo protege la política
-- de Storage, que debe replicar esta misma celda y no una versión relajada)
create policy documents_select_puede_ver     on public.documents for select to authenticated using (public.puede_ver_perfil(profile_id));
create policy documents_insert_puede_cargar  on public.documents for insert to authenticated with check (public.puede_cargar_en_perfil(profile_id));
create policy documents_update_administrador on public.documents for update to authenticated using (public.puede_administrar_perfil(profile_id)) with check (public.puede_administrar_perfil(profile_id));
create policy documents_delete_administrador on public.documents for delete to authenticated using (public.puede_administrar_perfil(profile_id));

comment on policy documents_insert_puede_cargar on public.documents is
    'can_upload sube el estudio. Si la extracción de IA quedó mal, NO puede corregirlo después: eso es una edición y requiere can_manage. Por eso el pipeline del Sprint 4 revisa antes de persistir.';

-- lab_metrics (nota ⑫: reprocesar un documento es editar; el ON CONFLICT DO
-- UPDATE que dispara una nueva extracción requiere can_manage. La primera
-- extracción, que solo inserta, se cubre con can_upload)
create policy lab_metrics_select_puede_ver     on public.lab_metrics for select to authenticated using (public.puede_ver_perfil(profile_id));
create policy lab_metrics_insert_puede_cargar  on public.lab_metrics for insert to authenticated with check (public.puede_cargar_en_perfil(profile_id));
create policy lab_metrics_update_administrador on public.lab_metrics for update to authenticated using (public.puede_administrar_perfil(profile_id)) with check (public.puede_administrar_perfil(profile_id));
create policy lab_metrics_delete_administrador on public.lab_metrics for delete to authenticated using (public.puede_administrar_perfil(profile_id));

-- appointments (nota ⑬: confirmar o cancelar un turno es hoy can_manage. Si el
-- Sprint 6 decide que un can_upload pueda marcarlo completed, se agrega una
-- política análoga a la ⑩ restringida a la columna status — deuda D9)
create policy appointments_select_puede_ver     on public.appointments for select to authenticated using (public.puede_ver_perfil(profile_id));
create policy appointments_insert_puede_cargar  on public.appointments for insert to authenticated with check (public.puede_cargar_en_perfil(profile_id));
create policy appointments_update_administrador on public.appointments for update to authenticated using (public.puede_administrar_perfil(profile_id)) with check (public.puede_administrar_perfil(profile_id));
create policy appointments_delete_administrador on public.appointments for delete to authenticated using (public.puede_administrar_perfil(profile_id));

-- medications (nota ⑨: el descuento de stock al registrar una toma NO amplía
-- can_upload; se resolverá con la función SECURITY DEFINER registrar_toma() del
-- Sprint 7, que valida puede_cargar_en_perfil y hace las dos escrituras juntas)
create policy medications_select_puede_ver     on public.medications for select to authenticated using (public.puede_ver_perfil(profile_id));
create policy medications_insert_puede_cargar  on public.medications for insert to authenticated with check (public.puede_cargar_en_perfil(profile_id));
create policy medications_update_administrador on public.medications for update to authenticated using (public.puede_administrar_perfil(profile_id)) with check (public.puede_administrar_perfil(profile_id));
create policy medications_delete_administrador on public.medications for delete to authenticated using (public.puede_administrar_perfil(profile_id));

comment on policy medications_update_administrador on public.medications is
    'Nota ⑨: suspender una medicación o editar una dosis es administración. can_upload no escribe acá, ni siquiera para descontar stock: eso lo hará la función SECURITY DEFINER registrar_toma() del Sprint 7.';

-- medication_intakes
create policy medication_intakes_select_puede_ver    on public.medication_intakes for select to authenticated using (public.puede_ver_perfil(profile_id));
create policy medication_intakes_insert_puede_cargar on public.medication_intakes for insert to authenticated with check (public.puede_cargar_en_perfil(profile_id));
create policy medication_intakes_update_administrador on public.medication_intakes for update to authenticated using (public.puede_administrar_perfil(profile_id)) with check (public.puede_administrar_perfil(profile_id));
create policy medication_intakes_delete_administrador on public.medication_intakes for delete to authenticated using (public.puede_administrar_perfil(profile_id));

-- Nota ⑩ — la única excepción de la matriz: registrar la toma del día es
-- funcionalmente "cargar un dato" y es la tarea principal de un cuidador,
-- aunque técnicamente sea un UPDATE. Se acota a la transición
-- pending -> taken|skipped, y el trigger medication_intakes_proteger_programacion
-- impide que la misma sentencia reprograme la toma.
create policy medication_intakes_update_registrar_toma
    on public.medication_intakes
    for update
    to authenticated
    using (
        public.puede_cargar_en_perfil(profile_id)
        and status = 'pending'::public.medication_intake_status
    )
    with check (
        public.puede_cargar_en_perfil(profile_id)
        and status in ('taken'::public.medication_intake_status,
                       'skipped'::public.medication_intake_status)
    );

comment on policy medication_intakes_update_registrar_toma on public.medication_intakes is
    'Nota ⑩: can_upload lleva una toma de pending a taken o skipped y nada más. USING restringe la fila vieja, WITH CHECK la nueva; el resto de las columnas lo protege el trigger medication_intakes_proteger_programacion, porque RLS no compara contra OLD.';

-- vital_signs
create policy vital_signs_select_puede_ver     on public.vital_signs for select to authenticated using (public.puede_ver_perfil(profile_id));
create policy vital_signs_insert_puede_cargar  on public.vital_signs for insert to authenticated with check (public.puede_cargar_en_perfil(profile_id));
create policy vital_signs_update_administrador on public.vital_signs for update to authenticated using (public.puede_administrar_perfil(profile_id)) with check (public.puede_administrar_perfil(profile_id));
create policy vital_signs_delete_administrador on public.vital_signs for delete to authenticated using (public.puede_administrar_perfil(profile_id));

-- insurance_cards (nota ⑮: ver una credencial se audita siempre con
-- ver_credencial, y abrir la foto pasa por signed URL del bucket privado)
create policy insurance_cards_select_puede_ver     on public.insurance_cards for select to authenticated using (public.puede_ver_perfil(profile_id));
create policy insurance_cards_insert_puede_cargar  on public.insurance_cards for insert to authenticated with check (public.puede_cargar_en_perfil(profile_id));
create policy insurance_cards_update_administrador on public.insurance_cards for update to authenticated using (public.puede_administrar_perfil(profile_id)) with check (public.puede_administrar_perfil(profile_id));
create policy insurance_cards_delete_administrador on public.insurance_cards for delete to authenticated using (public.puede_administrar_perfil(profile_id));


-- -----------------------------------------------------------------------------
-- 5.4 access_logs — append-only
-- -----------------------------------------------------------------------------

-- SELECT (nota ⑪): la lista de accesos de O la ve el titular de O; si O es
-- gestionado, sus can_manage ⚑ (es la vía por la que el titular ausente ejerce
-- el derecho). Independientemente de eso, cualquier actor ve SIEMPRE sus propias
-- filas: son sus datos y le permiten verificar qué quedó registrado a su nombre.
-- Un can_view NO ve la lista de accesos del dueño: es el instrumento con el que
-- el titular controla a sus propios autorizados.
create policy access_logs_select_propias_o_titular
    on public.access_logs
    for select
    to authenticated
    using (
        actor_user_id = (select auth.uid())
        or public.puede_otorgar_permisos(profile_id)
    );

comment on policy access_logs_select_propias_o_titular on public.access_logs is
    'Nota ⑪: cada actor ve sus propias filas; la lista de accesos de un perfil la ve su titular, o —⚑— sus administradores si el perfil es gestionado. Un can_view o un can_upload nunca ven quién más entró: dárselo vaciaría de sentido el control del titular y expondría la composición del grupo familiar.';

-- INSERT (nota ⑯): habilitado para todo usuario autenticado, con la única
-- condición de no poder falsificar el actor. En la práctica escribe siempre el
-- servidor, pero la política impide firmar a nombre de otro aunque alguien use
-- el cliente directo.
create policy access_logs_insert_actor_propio
    on public.access_logs
    for insert
    to authenticated
    with check (actor_user_id = (select auth.uid()));

comment on policy access_logs_insert_actor_propio on public.access_logs is
    'Nota ⑯: cualquiera puede escribir una entrada de auditoría, nadie puede escribirla a nombre de otro. actor_user_id es nullable en el esquema, y la comparación contra NULL no es TRUE: una fila sin actor queda rechazada.';

-- SIN POLÍTICA DE UPDATE Y SIN POLÍTICA DE DELETE, A PROPÓSITO.
-- Sección 6.2: modificar o borrar una fila de access_logs no se le concede a
-- ningún rol de usuario, sin excepción. La ausencia de política ya lo garantiza;
-- el REVOKE de la sección 4 lo garantiza una capa antes.
revoke update, delete on public.access_logs from anon, authenticated;


-- -----------------------------------------------------------------------------
-- 5.5 push_subscriptions — fuera del modelo familiar (nota ⑰)
-- -----------------------------------------------------------------------------
-- Una suscripción Web Push pertenece a un NAVEGADOR DE UNA PERSONA, no a un
-- perfil. Si estas políticas se escribieran "por perfil" como el resto, el dueño
-- de un perfil podría listar las suscripciones de quien lo administra y con ellas
-- el user_agent y los endpoints de sus dispositivos: información del cuidador,
-- no del titular, que ninguna función del producto necesita.
-- El envío sí cruza permisos y perfiles, pero ocurre del lado del servidor con
-- service_role y nunca con el JWT de un usuario.

create policy push_subscriptions_select_propias
    on public.push_subscriptions for select to authenticated
    using (user_id = (select auth.uid()));

create policy push_subscriptions_insert_propias
    on public.push_subscriptions for insert to authenticated
    with check (user_id = (select auth.uid()));

create policy push_subscriptions_update_propias
    on public.push_subscriptions for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

create policy push_subscriptions_delete_propias
    on public.push_subscriptions for delete to authenticated
    using (user_id = (select auth.uid()));

comment on policy push_subscriptions_select_propias on public.push_subscriptions is
    'Nota ⑰: cada persona gestiona exclusivamente las suscripciones de sus propios navegadores. family_permissions no interviene en ninguna de las cuatro operaciones.';


-- -----------------------------------------------------------------------------
-- 5.6 storage_purge_queue — sin políticas, a propósito
-- -----------------------------------------------------------------------------
-- RLS habilitada y CERO políticas: para `anon` y `authenticated` la tabla no
-- existe a efectos prácticos (y tampoco tienen privilegio de tabla). La drena el
-- job del Sprint 6 con service_role, que tiene BYPASSRLS. Los triggers
-- productores son SECURITY DEFINER, así que el usuario que borra un documento
-- encola su path sin poder ver la cola ni escribir en ella directamente.

-- Fin de la migración.
