-- =============================================================================
-- Historial Médico — Prueba reproducible de aislamiento por RLS
-- -----------------------------------------------------------------------------
-- Qué demuestra: que la matriz de docs/modelo-permisos.md está efectivamente
-- implementada en la base, no solo escrita. Simula sesiones reales de dos
-- cuentas distintas y del rol anónimo, y verifica CADA celda relevante.
--
-- Cómo se corre (Docker con la instancia local levantada):
--
--     docker exec -i supabase_db_historialclinico \
--         psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/test-rls.sql
--
-- o, si preferís el CLI:
--
--     npx supabase db reset            # aplica las tres migraciones
--     docker exec -i supabase_db_historialclinico psql -U postgres -d postgres < scripts/test-rls.sql
--
-- Es IDEMPOTENTE y AUTOLIMPIANTE: borra los restos de una corrida anterior al
-- empezar y borra todo lo que creó al terminar (después de imprimir el resumen),
-- de modo que se puede correr N veces seguidas sin resetear la base.
--
-- CÓMO SE SIMULA UNA SESIÓN. PostgREST hace dos cosas por request:
--     1. set_config('request.jwt.claims', '<json del JWT>', true)
--     2. SET LOCAL ROLE authenticated   (o anon si no hay sesión)
-- `auth.uid()` lee `request.jwt.claim.sub` (forma legacy) y, si está vacío,
-- `request.jwt.claims ->> 'sub'`. Este script usa la forma moderna
-- (`request.jwt.claims`), que es la que verifica funcionar contra PostgreSQL 17
-- + PostgREST de Supabase local. Se usa `set_config(..., true)` en lugar de
-- `SET LOCAL "request.jwt.claims"` porque el nombre del GUC tiene más de un
-- punto y la sintaxis SET no lo acepta de forma portable.
--
-- El arnés vive en el esquema `pruebas_rls` y NO en `public`, para no romper el
-- criterio de aceptación
--     select tablename from pg_tables where schemaname='public' and rowsecurity=false;
-- que debe seguir devolviendo vacío mientras la prueba corre.
-- =============================================================================

\set ON_ERROR_STOP on

\set u_a   '''11111111-1111-4111-8111-111111111111'''
\set u_b   '''22222222-2222-4222-8222-222222222222'''
\set p_a   '''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'''
\set p_b   '''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'''
\set p_g   '''cccccccc-cccc-4ccc-8ccc-cccccccccccc'''
\set p_g2  '''dddddddd-dddd-4ddd-8ddd-dddddddddddd'''
\set p_g3  '''f0000000-0000-4000-8000-00000000f001'''
\set med   '''eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'''
\set tom1  '''f1111111-1111-4111-8111-111111111111'''
\set tom2  '''f2222222-2222-4222-8222-222222222222'''

\set jwt_a '''{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}'''
\set jwt_b '''{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}'''


-- =============================================================================
-- 0. LIMPIEZA PREVIA (restos de una corrida anterior)
-- =============================================================================

drop schema if exists pruebas_rls cascade;

-- Los perfiles gestionados se borran ANTES que las cuentas: si se borrara
-- primero la cuenta de María, el CASCADE le quitaría a Roberto su único
-- administrador y el trigger de no orfandad (deuda D4) abortaría — que es
-- exactamente lo que debe hacer.
delete from public.profiles  where id    in (:p_g, :p_g2, :p_g3);
delete from auth.users       where id    in (:u_a, :u_b);
-- Cuentas del BLOQUE 24 (Sprint 17, tarea 17.2). La de Beto ya se borró dentro
-- del bloque -es parte de lo que prueba: que la baja de cuenta se lleve la
-- bandeja entera-, así que este delete alcanza a la de Ana. El CASCADE se
-- lleva sus correos registrados, sus filtros y el perfil que le creó el
-- trigger de alta de cuenta; el documento de prueba ya se borró dentro del
-- bloque (era justamente el caso del ON DELETE SET NULL).
delete from auth.users where id in (
    'f2300aaa-1111-4111-8111-111111111111',
    'f2300bbb-2222-4222-8222-222222222222');

-- El BLOQUE 25 (Sprint 17, tarea 17.3) crea tres cuentas -dos con conexión de
-- Gmail- y dos perfiles gestionados, uno de los cuales llega a tener un
-- documento auto-cargado. Se barre ACÁ, antes del delete de
-- storage_purge_queue de abajo: si una corrida anterior se cortó a mitad del
-- bloque, borrar el perfil gestionado en cascada encola una purga nueva de
-- Storage, y esta ubicación asegura que esa purga fantasma también se limpie
-- en la misma pasada -si fuera después del delete de storage_purge_queue,
-- quedaría un residuo que ningún caso vuelve a barrer-.
delete from public.profiles where id in (
    'f2400d00-2222-4222-8222-222222222222',
    'f2400e00-2222-4222-8222-222222222222');
delete from auth.users where id in (
    'f2400a00-1111-4111-8111-111111111111',
    'f2400b00-1111-4111-8111-111111111111',
    'f2400c00-1111-4111-8111-111111111111');
delete from vault.secrets where name in (
    'gmail_refresh_token_f2400a00-1111-4111-8111-111111111111',
    'gmail_refresh_token_f2400b00-1111-4111-8111-111111111111');

delete from public.storage_purge_queue where source_table in ('documents', 'insurance_cards', 'profiles');

-- El BLOQUE 15 crea usuarios y perfiles propios.
-- Nota: la limpieza de estos perfiles al final de la corrida falla porque el
-- trigger evitar_perfil_gestionado_huerfano() previene borrar el administrador
-- de un perfil gestionado. Se deja para que `npx supabase db reset` lo limpie.

-- El BLOQUE 23 (Sprint 17) crea dos cuentas con conexión de Gmail. Se barren
-- acá también, por si una corrida se cortó antes de su limpieza: sin esto, el
-- `insert into auth.users` del bloque fallaría por clave duplicada y el
-- `guardar_conexion_gmail` encontraría el secreto viejo en el Vault.
delete from auth.users where id in (
    'f2200aaa-1111-4111-8111-111111111111',
    'f2200bbb-2222-4222-8222-222222222222');
delete from vault.secrets where name in (
    'gmail_refresh_token_f2200aaa-1111-4111-8111-111111111111',
    'gmail_refresh_token_f2200bbb-2222-4222-8222-222222222222');

-- El BLOQUE 11 genera tomas en una fecha sintética lejana (2099-06-15) también
-- para las medicaciones del seed, que no cuelgan de los perfiles de prueba. Las
-- borra al terminar; esto cubre el caso de una corrida que se cayó a la mitad.
delete from public.medication_intakes
 where scheduled_at >= (date '2099-06-15'::timestamp at time zone 'America/Argentina/Ushuaia')
   and scheduled_at <  (date '2099-06-16'::timestamp at time zone 'America/Argentina/Ushuaia');


-- =============================================================================
-- 1. ARNÉS DE RESULTADOS
-- =============================================================================

create schema pruebas_rls;

create table pruebas_rls.resultado (
    n         serial primary key,
    bloque    text    not null,
    caso      text    not null,
    esperado  text    not null,
    obtenido  text    not null,
    ok        boolean not null
);

create function pruebas_rls.registrar(bloque text, caso text, esperado text, obtenido text)
returns void
language sql
as $$
    insert into pruebas_rls.resultado (bloque, caso, esperado, obtenido, ok)
    values (bloque, caso, esperado, obtenido, esperado = obtenido);
$$;

-- `service_role` se suma en el Sprint 16 (tarea 16.3, BLOQUE 22): es el
-- primer bloque del arnés que necesita PROBAR el camino permitido de un rol
-- de servidor -que service_role sí puede escribir el catálogo REFES y sí
-- puede tomar el lock de sincronización-, y para registrar el resultado tiene
-- que poder escribir en la tabla del arnés desde ese rol. No afecta a ningún
-- bloque anterior: el esquema `pruebas_rls` vive fuera de `public` y se borra
-- entero al terminar la corrida.
grant usage on schema pruebas_rls to anon, authenticated, service_role;
grant select, insert on pruebas_rls.resultado to anon, authenticated, service_role;
grant usage, select on sequence pruebas_rls.resultado_n_seq to anon, authenticated, service_role;


-- =============================================================================
-- 2. DATOS DE PRUEBA (se cargan como postgres, que tiene BYPASSRLS)
-- -----------------------------------------------------------------------------
-- María Gómez  (u_a / p_a) — cuenta propia, titular de sus datos.
-- Diego Gómez  (u_b / p_b) — cuenta propia, el hijo a distancia.
-- Roberto Gómez     (p_g)  — PERFIL GESTIONADO (user_id NULL), creado por María.
--
-- Se arranca SIN ningún permiso de María hacia Diego: el primer bloque de
-- pruebas es justamente el criterio de aceptación del sprint.
-- =============================================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
    (:u_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'maria@ejemplo.ar', crypt('prueba-rls', gen_salt('bf')), now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}'),
    (:u_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'diego@ejemplo.ar', crypt('prueba-rls', gen_salt('bf')), now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}');

-- Desde `20260814140000_alta_de_cuenta.sql`, insertar en `auth.users` dispara
-- `auth_users_crear_perfil_de_cuenta`, que le crea a cada cuenta su perfil
-- propio con un id ALEATORIO y sus dos filas de `consents`. El arnés necesita
-- ids fijos (:p_a y :p_b se interpolan en medio script), así que descarta el
-- perfil automático — si no, el INSERT de abajo chocaría contra
-- `profiles_user_id_unico` y tumbaría la corrida entera. Los `consents` se
-- dejan: ningún bloque cuenta filas de estas dos cuentas y el cleanup final se
-- los lleva con el CASCADE de `auth.users`.
--
-- El `id not in (...)` protege el caso de una corrida sobre restos previos:
-- borrar el perfil DEFINITIVO de María se llevaría en cascada sus datos.
-- El BLOQUE 19 es el que prueba que este perfil automático se crea bien.
delete from public.profiles
 where user_id in (:u_a, :u_b)
   and id not in (:p_a, :p_b);

insert into public.profiles (id, user_id, full_name, role, blood_type, allergies) values
    (:p_a, :u_a, 'María Gómez',   'admin',         'A+',  '{"Penicilina"}'),
    (:p_b, :u_b, 'Diego Gómez',   'family_member', 'O-',  '{}');

insert into public.profiles (id, user_id, full_name, role, created_by_profile_id, blood_type, chronic_conditions) values
    (:p_g, null, 'Roberto Gómez', 'elder', :p_a, 'O+', '{"Hipertensión","Diabetes tipo 2"}');

-- Fila de arranque del perfil gestionado (caso B): los tres flags en true.
insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage)
values (:p_g, :p_a, true, true, true);

-- Contenido de María.
insert into public.documents (profile_id, title, category, document_date, storage_path) values
    (:p_a, 'Análisis de sangre — Hospital Regional', 'laboratory', '2026-07-14', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/a1.pdf'),
    (:p_a, 'Ecografía abdominal',                    'imaging',    '2026-06-02', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/a2.pdf');

insert into public.vital_signs (profile_id, type, systolic, diastolic, pulse, measured_at) values
    (:p_a, 'blood_pressure', 128, 82, 71, now() - interval '2 days'),
    (:p_a, 'blood_pressure', 134, 86, 68, now() - interval '1 day');

-- Contenido de Roberto (el perfil gestionado).
insert into public.documents (profile_id, title, category, document_date, storage_path) values
    (:p_g, 'Receta — Metformina 850 mg', 'prescription', '2026-08-01', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/2026/r1.pdf');

insert into public.medications (id, profile_id, name, active_ingredient, dose_amount, dose_unit,
                                frequency, schedule_times, stock_units)
values (:med, :p_a, 'Glucophage', 'Metformina', 1, 'comprimido', 'daily', '{08:00,20:00}', 60);

insert into public.medication_intakes (id, medication_id, profile_id, scheduled_at, status) values
    (:tom1, :med, :p_a, now() - interval '3 hours', 'pending'),
    (:tom2, :med, :p_a, now() - interval '1 hours', 'pending');

-- Auditoría preexistente y una suscripción push de María.
insert into public.access_logs (actor_user_id, actor_profile_id, profile_id, action, resource_type) values
    (:u_a, :p_a, :p_a, 'ver_perfil',    'profiles'),
    (:u_a, :p_a, :p_g, 'ver_documento', 'documents');

insert into public.push_subscriptions (profile_id, user_id, endpoint, p256dh, auth)
values (:p_a, :u_a, 'https://fcm.googleapis.com/fcm/send/maria-prueba', 'clave-publica', 'secreto');


-- =============================================================================
-- BLOQUE 1 — SIN PERMISO: el criterio de aceptación del Sprint 1
-- =============================================================================
\echo ''
\echo '### BLOQUE 1 — Diego SIN ningún permiso sobre los datos de María'

begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

select pruebas_rls.registrar('1. sin permiso',
       'B lee documents de A  [CRITERIO DE ACEPTACIÓN]', '0 filas', count(*) || ' filas')
  from public.documents where profile_id = :p_a;

select pruebas_rls.registrar('1. sin permiso',
       'B lee vital_signs de A', '0 filas', count(*) || ' filas')
  from public.vital_signs where profile_id = :p_a;

select pruebas_rls.registrar('1. sin permiso',
       'B lee la fila de profiles de A', '0 filas', count(*) || ' filas')
  from public.profiles where id = :p_a;

select pruebas_rls.registrar('1. sin permiso',
       'B lee documents del perfil gestionado', '0 filas', count(*) || ' filas')
  from public.documents where profile_id = :p_g;

select pruebas_rls.registrar('1. sin permiso',
       'B lee access_logs de A', '0 filas', count(*) || ' filas')
  from public.access_logs where profile_id = :p_a;

select pruebas_rls.registrar('1. sin permiso',
       'B lee push_subscriptions de A', '0 filas', count(*) || ' filas')
  from public.push_subscriptions where user_id = :u_a;

select pruebas_rls.registrar('1. sin permiso',
       'B lee TODA la tabla documents (fuga global)', '0 filas', count(*) || ' filas')
  from public.documents;

do $$
declare v text;
begin
    begin
        perform 1 from public.storage_purge_queue limit 1;
        v := 'accede';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('1. sin permiso',
        'B lee storage_purge_queue (solo service_role)', 'denegado (42501)', v);
end $$;

commit;


-- Contracara: la misma sesión de María sí ve lo suyo y lo que administra.
begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

select pruebas_rls.registrar('1. sin permiso',
       'A (titular) lee sus propios documents', '2 filas', count(*) || ' filas')
  from public.documents where profile_id = :p_a;

select pruebas_rls.registrar('1. sin permiso',
       'A (can_manage ⚑) lee documents del gestionado', '1 filas', count(*) || ' filas')
  from public.documents where profile_id = :p_g;

select pruebas_rls.registrar('1. sin permiso',
       'A ve su perfil, el gestionado y ninguno más', '2 filas', count(*) || ' filas')
  from public.profiles;

commit;


-- =============================================================================
-- BLOQUE 2 — can_view: lee todo, no escribe nada
-- =============================================================================
\echo '### BLOQUE 2 — María otorga can_view a Diego (el default al invitar)'

insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage)
values (:p_a, :p_b, true, false, false);

begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

select pruebas_rls.registrar('2. can_view',
       'B lee documents de A', '2 filas', count(*) || ' filas')
  from public.documents where profile_id = :p_a;

select pruebas_rls.registrar('2. can_view',
       'B lee vital_signs de A', '2 filas', count(*) || ' filas')
  from public.vital_signs where profile_id = :p_a;

select pruebas_rls.registrar('2. can_view',
       'B lee la ficha SOS de A (perfil visible)', '1 filas', count(*) || ' filas')
  from public.profiles where id = :p_a and blood_type is not null;

select pruebas_rls.registrar('2. can_view',
       'B sigue sin ver el perfil gestionado de A', '0 filas', count(*) || ' filas')
  from public.documents where profile_id = :p_g;

select pruebas_rls.registrar('2. can_view',
       'B ve SOLO su propia fila de family_permissions (nota ④)', '1 filas', count(*) || ' filas')
  from public.family_permissions;

select pruebas_rls.registrar('2. can_view',
       'B NO ve la lista de accesos de A (nota ⑪)', '0 filas', count(*) || ' filas')
  from public.access_logs where profile_id = :p_a;

do $$
declare v text;
begin
    begin
        insert into public.documents (profile_id, title, category, document_date, storage_path)
        values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Intento sin can_upload', 'other',
                '2026-08-10', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/intento.pdf');
        v := 'insertado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('2. can_view',
        'B INSERTA en documents de A sin can_upload', 'rechazado (42501)', v);
end $$;

do $$
declare v integer;
begin
    update public.documents set title = 'Título pisado por B'
     where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('2. can_view',
        'B EDITA documents de A (0 filas, no error)', '0 filas', v || ' filas');
end $$;

do $$
declare v integer;
begin
    delete from public.documents
     where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('2. can_view',
        'B BORRA documents de A (0 filas, no error)', '0 filas', v || ' filas');
end $$;

do $$
declare v text;
begin
    begin
        update public.profiles set full_name = 'Nombre pisado por B'
         where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        v := 'afectó ' || (select count(*) from public.profiles
                            where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                              and full_name = 'Nombre pisado por B') || ' filas';
    exception when others then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('2. can_view',
        'B EDITA el perfil de A (incluida la ficha SOS)', 'afectó 0 filas', v);
end $$;

commit;


-- =============================================================================
-- BLOQUE 3 — can_upload: crea contenido, no lo edita
-- =============================================================================
\echo '### BLOQUE 3 — María suma can_upload a Diego'

update public.family_permissions
   set can_upload = true
 where owner_profile_id = :p_a and granted_profile_id = :p_b;

begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        insert into public.documents (profile_id, title, category, document_date, storage_path)
        values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Estudio subido por Diego', 'laboratory',
                '2026-08-10', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/subido-b.pdf');
        v := 'insertado';
    exception when others then v := 'rechazado ' || sqlstate;
    end;
    perform pruebas_rls.registrar('3. can_upload',
        'B INSERTA en documents de A', 'insertado', v);
end $$;

select pruebas_rls.registrar('3. can_upload',
       'created_by_profile_id quedó sellado con el perfil de B (deuda D2)', :p_b, coalesce(created_by_profile_id::text, 'NULL'))
  from public.documents where storage_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/subido-b.pdf';

do $$
declare v integer;
begin
    update public.documents set title = 'Corrección de Diego'
     where storage_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/subido-b.pdf';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('3. can_upload',
        'B corrige SU PROPIA carga (requiere can_manage)', '0 filas', v || ' filas');
end $$;

do $$
declare v integer;
begin
    update public.medication_intakes
       set status = 'taken', taken_at = now()
     where id = 'f1111111-1111-4111-8111-111111111111';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('3. can_upload',
        'B registra la toma pending -> taken (nota ⑩)', '1 filas', v || ' filas');
end $$;

do $$
declare v text;
begin
    begin
        update public.medication_intakes
           set status = 'taken', taken_at = now(), scheduled_at = now() + interval '5 hours'
         where id = 'f2222222-2222-4222-8222-222222222222';
        v := 'reprogramada';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('3. can_upload',
        'B reprograma la toma mientras la registra (nota ⑩)', 'rechazado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        update public.medications set stock_units = 999
         where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
        v := (select stock_units::text from public.medications
               where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
        v := coalesce(v, 'sin lectura');
    exception when others then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('3. can_upload',
        'B toca medications.stock_units directo (nota ⑨)', '60', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view)
        values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
        v := 'otorgado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('3. can_upload',
        'B otorga permisos sobre el perfil de A (sección 4.4)', 'rechazado (42501)', v);
end $$;

commit;


-- =============================================================================
-- BLOQUE 4 — can_manage sobre un perfil CON CUENTA: administra, pero no otorga
-- =============================================================================
\echo '### BLOQUE 4 — María sube a Diego a can_manage (perfil CON cuenta)'

update public.family_permissions
   set can_manage = true
 where owner_profile_id = :p_a and granted_profile_id = :p_b;

begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

do $$
declare v integer;
begin
    update public.documents set title = 'Corrección de Diego (can_manage)'
     where storage_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/subido-b.pdf';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('4. can_manage',
        'B ahora SÍ edita documents de A', '1 filas', v || ' filas');
end $$;

do $$
declare v text;
begin
    begin
        insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view)
        values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
        v := 'otorgado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('4. can_manage',
        'B con can_manage otorga sobre perfil CON cuenta (nota ⑤ ⚑)', 'rechazado (42501)', v);
end $$;

-- Nota ③ ⚑: un perfil CON cuenta lo borra ÚNICAMENTE su titular. Que Diego
-- tenga can_manage sobre María no lo habilita a suprimir su historial: la
-- extensión ⚑ existe solo para perfiles gestionados, donde no hay titular capaz
-- de ejercer el derecho por sí mismo.
do $$
declare v text; n integer;
begin
    begin
        delete from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        get diagnostics n = row_count;
        v := case when n = 0 then 'no borrado' else 'borrado' end;
    exception when others then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('4. can_manage',
        'B con can_manage borra el perfil CON cuenta de A (nota ③ ⚑)', 'no borrado', v);
end $$;

do $$
declare v text;
begin
    begin
        update public.profiles
           set user_id = '22222222-2222-4222-8222-222222222222'
         where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        v := 'cambiado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('4. can_manage',
        'B se apropia del perfil de A cambiando user_id (nota ②)', 'rechazado (42501)', v);
end $$;

commit;


-- =============================================================================
-- BLOQUE 5 — access_logs append-only y arranque de perfiles gestionados
-- =============================================================================
\echo '### BLOQUE 5 — access_logs append-only, arranque y no orfandad'

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

select pruebas_rls.registrar('5. auditoría',
       'A (titular) ve la lista de accesos de su perfil', '1 filas', count(*) || ' filas')
  from public.access_logs where profile_id = :p_a;

select pruebas_rls.registrar('5. auditoría',
       'A ve los accesos del perfil gestionado (nota ⑪ ⚑)', '1 filas', count(*) || ' filas')
  from public.access_logs where profile_id = :p_g;

do $$
declare v text;
begin
    begin
        update public.access_logs set action = 'login'
         where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        v := 'modificado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('5. auditoría',
        'A MODIFICA su propia fila de access_logs', 'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        delete from public.access_logs
         where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        v := 'borrado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('5. auditoría',
        'A BORRA su propia fila de access_logs', 'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.access_logs (actor_user_id, actor_profile_id, profile_id, action)
        values ('22222222-2222-4222-8222-222222222222',
                'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ver_documento');
        v := 'insertado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('5. auditoría',
        'A firma una entrada a nombre de B (nota ⑯)', 'rechazado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        delete from public.family_permissions
         where owner_profile_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
           and granted_profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        v := 'renunció';
    exception when sqlstate '23001' then v := 'rechazado (23001)';
             when others            then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('5. auditoría',
        'A renuncia siendo el único administrador (deuda D4)', 'rechazado (23001)', v);
end $$;

commit;


-- Diego crea su propio perfil gestionado y se autoasigna la administración.
begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        insert into public.profiles (id, user_id, full_name, role)
        values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', null, 'Elsa Quiroga', 'elder');

        insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage)
        values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true, true, true);
        v := 'creado y administrado';
    exception when others then v := 'rechazado ' || sqlstate;
    end;
    perform pruebas_rls.registrar('5. auditoría',
        'B crea un perfil gestionado y arranca su administración', 'creado y administrado', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage)
        values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true, true, true);
        v := 'se autoasignó';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('5. auditoría',
        'B se autoasigna la administración del gestionado de A', 'rechazado (42501)', v);
end $$;

commit;


-- Contracara positiva de la nota ③ ⚑ y prueba de la deuda D5: María, que
-- administra un perfil GESTIONADO, sí puede suprimirlo, y ese borrado deja los
-- objetos de Storage encolados para purga física.
begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text; n integer;
begin
    begin
        delete from public.profiles where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        get diagnostics n = row_count;
        v := case when n = 0 then 'no borrado' else 'borrado' end;
    exception when others then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('5. auditoría',
        'A borra el perfil GESTIONADO que administra (nota ③ ⚑)', 'borrado', v);
end $$;

commit;

select pruebas_rls.registrar('5. auditoría',
       'El borrado encoló el documento en storage_purge_queue (deuda D5)', '1', count(*)::text)
  from public.storage_purge_queue
 where source_table = 'documents' and bucket = 'documentos-medicos' and purged_at is null;


-- =============================================================================
-- BLOQUE 6 — rol anon: cero acceso al dominio
-- =============================================================================
\echo '### BLOQUE 6 — visitante sin sesión (rol anon)'

begin;
select set_config('request.jwt.claims', '', true);
set local role anon;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.documents;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('6. anon', 'anon lee documents', 'denegado (42501)', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.profiles;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('6. anon', 'anon lee profiles', 'denegado (42501)', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.access_logs;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('6. anon', 'anon lee access_logs', 'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.profiles (full_name) values ('Perfil de un anónimo');
        v := 'insertado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('6. anon', 'anon inserta un perfil', 'rechazado (42501)', v);
end $$;

commit;


-- =============================================================================
-- BLOQUE 7 — invariantes estructurales (sección 11 de docs/modelo-permisos.md)
-- =============================================================================
\echo '### BLOQUE 7 — invariantes estructurales'

select pruebas_rls.registrar('7. estructura',
       'Tablas de public sin RLS  [CRITERIO DE ACEPTACIÓN]', '0', count(*)::text)
  from pg_tables where schemaname = 'public' and rowsecurity = false;

-- Las dos tablas de INFRAESTRUCTURA del proyecto: RLS habilitada y cero
-- políticas, a propósito (`20260812220000_rls.sql` §5.6 y
-- `20260813050000_recordatorios_turnos.sql` §3). Ninguna sesión de la
-- aplicación las toca: las escriben los triggers SECURITY DEFINER, pg_cron y
-- los barridos con service_role. Que aparezca una TERCERA en esta lista es un
-- olvido de políticas, no una tabla de infraestructura nueva.
select pruebas_rls.registrar('7. estructura',
       'Tablas de public sin ninguna política (solo las dos de infraestructura)',
       'appointment_reminders, storage_purge_queue',
       coalesce(string_agg(t.tablename, ', ' order by t.tablename), '(ninguna)'))
  from pg_tables t
 where t.schemaname = 'public'
   and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = t.tablename);

select pruebas_rls.registrar('7. estructura',
       'Políticas que leen profiles.role (escalada de privilegios)', '0', count(*)::text)
  from pg_policies
 where schemaname = 'public'
   and (coalesce(qual, '') || coalesce(with_check, '')) ~* '\mrole\M';

select pruebas_rls.registrar('7. estructura',
       'Funciones de public sin search_path fijado', '0', count(*)::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prokind = 'f'
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%');

-- Si PUBLIC conservara EXECUTE, `anon` lo heredaría: una sola consulta cubre
-- las dos formas de sobre-exposición.
select pruebas_rls.registrar('7. estructura',
       'Funciones auxiliares ejecutables por anon o por PUBLIC', '0', count(*)::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('perfil_actor', 'es_titular', 'es_perfil_gestionado', 'puede_ver_perfil',
                     'puede_cargar_en_perfil', 'puede_administrar_perfil', 'puede_otorgar_permisos',
                     'puede_arrancar_administracion', 'es_sesion_de_usuario',
                     'confirmar_documento_recien_subido', 'descartar_documento_recien_subido',
                     'registrar_toma', 'revertir_toma', 'generar_tomas_del_dia')
   and has_function_privilege('anon', p.oid, 'execute');

select pruebas_rls.registrar('7. estructura',
       'Privilegios de anon sobre tablas de public', '0', count(*)::text)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon';

select pruebas_rls.registrar('7. estructura',
       'Privilegio de UPDATE/DELETE de authenticated en access_logs', '0', count(*)::text)
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'access_logs'
   and grantee = 'authenticated' and privilege_type in ('UPDATE', 'DELETE');

select pruebas_rls.registrar('7. estructura',
       'Perfiles gestionados huérfanos (sin ningún can_manage)', '0', count(*)::text)
  from public.profiles p
 where p.user_id is null
   and not exists (select 1 from public.family_permissions fp
                    where fp.owner_profile_id = p.id and fp.can_manage);


-- =============================================================================
-- BLOQUE 8 — confirmación acotada del documento recién subido (RPC, tarea 4.5)
-- -----------------------------------------------------------------------------
-- Las cuatro guardas de `confirmar_documento_recien_subido` / `descartar_documento_recien_subido`
-- (`supabase/migrations/20260813010000_confirmacion_documentos.sql`) no son
-- políticas RLS -son un SECURITY DEFINER que bypassea la RLS de `documents`
-- por diseño-, así que este bloque las prueba por separado, LLAMANDO al RPC
-- con las mismas sesiones simuladas del resto del arnés. Documentos propios
-- del bloque, con storage_path únicos para no chocar con el resto del script.
-- =============================================================================
\echo '### BLOQUE 8 — confirmación acotada del documento recién subido (RPC)'

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

-- doc_propio: para el caso feliz + doble confirmación.
-- doc_ajeno:  para que Diego intente confirmarlo/descartarlo sin ser el creador.
insert into public.documents (id, profile_id, title, category, document_date, storage_path) values
    ('77777777-7777-4777-8777-777777777777', :p_a, 'Análisis de sangre (sin revisar)', 'other', '2026-08-05', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/bloque8-propio.pdf'),
    ('88888888-8888-4888-8888-888888888888', :p_a, 'Radiografía (sin revisar)',        'other', '2026-08-06', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/bloque8-ajeno.pdf');

-- doc_viejo: mismo creador y sin confirmar todavía, pero created_at ya pasó la
-- ventana de 1 hora -el trigger sellador solo toca created_by_profile_id, así
-- que el created_at explícito del INSERT llega intacto a la fila.
insert into public.documents (id, profile_id, title, category, document_date, storage_path, created_at) values
    ('99999999-9999-4999-8999-999999999999', :p_a, 'Consulta vieja (sin revisar)', 'other', '2026-07-20', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/bloque8-viejo.pdf', now() - interval '2 hours');

commit;

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare
    v    text;
    fila public.documents%rowtype;
begin
    begin
        select * into fila from public.confirmar_documento_recien_subido(
            '77777777-7777-4777-8777-777777777777',
            'Análisis de sangre — agosto (editado por A)',
            'laboratory', '2026-08-05', 'Todo dentro de rango.');
        v := 'confirmado: título="' || fila.title || '", confirmed_at ' ||
             case when fila.confirmed_at is not null then 'sellado' else 'NULL' end;
    exception when others then v := 'error ' || sqlstate || ' ' || sqlerrm;
    end;
    perform pruebas_rls.registrar('8. confirmación RPC',
        'A confirma SU documento dentro de la hora (el título editado, no el original, queda persistido)',
        'confirmado: título="Análisis de sangre — agosto (editado por A)", confirmed_at sellado', v);
end $$;

commit;

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.confirmar_documento_recien_subido(
            '77777777-7777-4777-8777-777777777777',
            'Segundo intento de confirmación', 'laboratory', '2026-08-05', null);
        v := 'confirmado de nuevo';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('8. confirmación RPC',
        'A vuelve a confirmar el MISMO documento (doble confirmación, guarda 3)', 'rechazado (42501)', v);
end $$;

commit;

begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.confirmar_documento_recien_subido(
            '88888888-8888-4888-8888-888888888888',
            'Título puesto por Diego', 'imaging', '2026-08-06', null);
        v := 'confirmado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('8. confirmación RPC',
        'Diego (jwt de B) confirma un documento AJENO de A — no es el creador (guarda 1)',
        'rechazado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.descartar_documento_recien_subido('88888888-8888-4888-8888-888888888888');
        v := 'descartado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('8. confirmación RPC',
        'Diego (jwt de B) descarta el mismo documento AJENO — no es el creador (guarda 1)',
        'rechazado (42501)', v);
end $$;

commit;

select pruebas_rls.registrar('8. confirmación RPC',
       'El documento ajeno sigue intacto tras los dos intentos de Diego (ni confirmado ni borrado)',
       'existe, confirmed_at NULL, título original',
       case when exists (select 1 from public.documents
                           where id = '88888888-8888-4888-8888-888888888888'
                             and confirmed_at is null
                             and title = 'Radiografía (sin revisar)')
            then 'existe, confirmed_at NULL, título original'
            else 'estado inesperado' end);

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.confirmar_documento_recien_subido(
            '99999999-9999-4999-8999-999999999999',
            'Consulta vieja actualizada', 'consultation', '2026-07-20', null);
        v := 'confirmado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('8. confirmación RPC',
        'A (SÍ es la creadora) confirma un documento con created_at retrocedido > 1 hora (guarda 2)',
        'rechazado (42501)', v);
end $$;

commit;

-- Cierre prolijo del bloque: A, la dueña real del documento ajeno, lo
-- descarta legítimamente -a diferencia del intento de Diego, esta llamada sí
-- cumple las tres guardas (creadora, dentro de la hora, sin confirmar)-.
begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text; c integer;
begin
    begin
        perform public.descartar_documento_recien_subido('88888888-8888-4888-8888-888888888888');
        select count(*) into c from public.documents where id = '88888888-8888-4888-8888-888888888888';
        v := case when c = 0 then 'descartado (fila borrada)' else 'sigue existiendo' end;
    exception when others then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('8. confirmación RPC',
        'A (la creadora real) descarta su propio documento sin revisar', 'descartado (fila borrada)', v);
end $$;

commit;

select pruebas_rls.registrar('8. confirmación RPC',
       'El descarte encoló el objeto borrado en storage_purge_queue (mismo trigger que cualquier DELETE)',
       'encolado',
       case when exists (select 1 from public.storage_purge_queue
                           where source_table = 'documents'
                             and storage_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/bloque8-ajeno.pdf')
            then 'encolado' else 'NO encolado' end);

-- doc_propio (confirmado) y doc_viejo (rechazado, nunca confirmado) no se
-- borran acá a propósito: la limpieza final del script, al borrar auth.users
-- de A y B, hace cascade profiles -> documents y se lleva estas dos filas
-- igual que cualquier otro documento de prueba del resto del arnés.


-- =============================================================================
-- BLOQUE 8b — parámetro `metricas` del RPC (tarea 4.6)
-- -----------------------------------------------------------------------------
-- `confirmar_documento_recien_subido` se extendió en
-- `20260813020000_metricas_en_confirmacion.sql` con un sexto parámetro
-- `metricas jsonb DEFAULT NULL` que inserta en `lab_metrics` DENTRO de la
-- misma transacción que sella `confirmed_at`. Este bloque prueba lo que el
-- resto de BLOQUE 8 no cubre: que el caso feliz persiste las filas con
-- `measurement_date` forzado a la fecha CONFIRMADA, y que una métrica
-- inválida (guarda 5) aborta la llamada COMPLETA -ni el documento queda
-- confirmado ni se cuela ninguna fila de lab_metrics-, la garantía de
-- atomicidad que motivó meter las métricas dentro del RPC en primer lugar.
--
-- Documentos propios del bloque, mismo patrón que 8: storage_path únicos.
-- `metric_canonical` se manda explícito en el JSON porque acá se llama al RPC
-- directo -sin pasar por `lib/laboratorio/normalizacion.ts`-, así que el
-- nombre canónico lo pone esta prueba, no el diccionario de TypeScript (ese
-- diccionario ya lo cubre `tests/unit/laboratorio.test.ts`).
-- =============================================================================
\echo '### BLOQUE 8b — parámetro metricas del RPC de confirmación'

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

insert into public.documents (id, profile_id, title, category, document_date, storage_path) values
    ('10101010-1010-4101-8101-101010101010', :p_a, 'Análisis con métricas (sin revisar)',       'other', '2026-08-07', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/bloque8b-ok.pdf'),
    ('20202020-2020-4202-8202-202020202020', :p_a, 'Análisis con métrica inválida (sin revisar)', 'other', '2026-08-08', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/bloque8b-mal.pdf');

commit;

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare
    v text;
    n integer;
begin
    begin
        perform public.confirmar_documento_recien_subido(
            '10101010-1010-4101-8101-101010101010',
            'Análisis con métricas — agosto', 'laboratory', '2026-08-07', null,
            '[{"metric_name":"Glucemia","metric_canonical":"Glucosa","value":95,"unit":"mg/dl","reference_range":"70 - 110","reference_min":70,"reference_max":110},
              {"metric_name":"COL TOTAL","metric_canonical":"Colesterol total","value":180,"unit":"mg/dl"}]'::jsonb);
        select count(*) into n from public.lab_metrics where document_id = '10101010-1010-4101-8101-101010101010';
        v := 'confirmado, ' || n || ' métricas insertadas';
    exception when others then v := 'error ' || sqlstate || ' ' || sqlerrm;
    end;
    perform pruebas_rls.registrar('8b. parámetro metricas',
        'A confirma CON métricas válidas: quedan insertadas atómicamente en lab_metrics',
        'confirmado, 2 métricas insertadas', v);
end $$;

commit;

select pruebas_rls.registrar('8b. parámetro metricas',
       'La métrica "Glucemia" quedó con metric_canonical resuelto y measurement_date = fecha CONFIRMADA (no la del JSON, que no la trae)',
       'Glucosa / 2026-08-07',
       coalesce((select metric_canonical || ' / ' || measurement_date::text
                   from public.lab_metrics
                  where document_id = '10101010-1010-4101-8101-101010101010'
                    and metric_name = 'Glucemia'),
                'NO ENCONTRADA'));

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.confirmar_documento_recien_subido(
            '20202020-2020-4202-8202-202020202020',
            'Análisis con métrica inválida', 'laboratory', '2026-08-08', null,
            '[{"metric_name":"Rara","value":"no-es-un-numero"}]'::jsonb);
        v := 'confirmado (no debería)';
    exception when invalid_parameter_value then v := 'rechazado (22023)';
             when others                   then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('8b. parámetro metricas',
        'A confirma con una métrica de VALOR NO NUMÉRICO (guarda 5): se rechaza la llamada completa',
        'rechazado (22023)', v);
end $$;

commit;

select pruebas_rls.registrar('8b. parámetro metricas',
       'El rechazo por guarda 5 es atómico: el documento sigue SIN confirmar y no se coló ninguna fila de lab_metrics',
       'sin confirmar, sin métricas',
       case when exists (
                 select 1 from public.documents
                  where id = '20202020-2020-4202-8202-202020202020'
                    and confirmed_at is null
                    and title = 'Análisis con métrica inválida (sin revisar)')
             and not exists (
                 select 1 from public.lab_metrics
                  where document_id = '20202020-2020-4202-8202-202020202020')
            then 'sin confirmar, sin métricas'
            else 'estado inesperado' end);

-- Los dos documentos de este bloque (y las métricas del primero) no se
-- borran acá a propósito, mismo criterio que el cierre de BLOQUE 8: la
-- limpieza final del script los arrastra por CASCADE al borrar auth.users.


-- =============================================================================
-- BLOQUE 8c — parámetros institución/especialidad/médico (Sprint 5, tarea
-- correctiva de metadatos)
-- -----------------------------------------------------------------------------
-- `confirmar_documento_recien_subido` se extendió en
-- `20260813030000_confirmacion_metadatos_completos.sql` con tres parámetros
-- más (`nueva_institucion`, `nueva_especialidad`, `nuevo_medico`, los tres
-- `text DEFAULT NULL`) que persisten en `documents.institution` / `.specialty`
-- / `.doctor_name` dentro de la MISMA transacción que sella `confirmed_at`.
-- Este bloque prueba lo que 8 y 8b no cubren: que el caso feliz persiste los
-- tres campos (guarda 6), y que un valor demasiado largo aborta la llamada
-- COMPLETA -mismo criterio de atomicidad que la guarda 5 de métricas-. Que
-- BLOQUE 8 y 8b sigan pasando sin cambios (llaman con 5 y 6 argumentos)
-- confirma la compatibilidad posicional que documenta el encabezado de la
-- migración: los tres parámetros nuevos van al FINAL, todos con default.
-- =============================================================================
\echo '### BLOQUE 8c — parámetros institución/especialidad/médico del RPC de confirmación'

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

insert into public.documents (id, profile_id, title, category, document_date, storage_path) values
    ('30303030-3030-4303-8303-303030303030', :p_a, 'Análisis con metadatos (sin revisar)',           'other', '2026-08-09', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/bloque8c-ok.pdf'),
    ('40404040-4040-4404-8404-404040404040', :p_a, 'Análisis con institución demasiado larga (sin revisar)', 'other', '2026-08-10', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/bloque8c-mal.pdf');

commit;

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.confirmar_documento_recien_subido(
            '30303030-3030-4303-8303-303030303030',
            'Análisis con metadatos — agosto', 'laboratory', '2026-08-09', null, null,
            'Laboratorio Central Ushuaia', 'Clínica médica', 'Dr. Pérez MP 1234');
        v := coalesce((select institution || ' / ' || specialty || ' / ' || doctor_name
                         from public.documents
                        where id = '30303030-3030-4303-8303-303030303030'),
                      'NO ENCONTRADO');
    exception when others then v := 'error ' || sqlstate || ' ' || sqlerrm;
    end;
    perform pruebas_rls.registrar('8c. institución/especialidad/médico',
        'A confirma CON institución/especialidad/médico: quedan persistidos en documents',
        'Laboratorio Central Ushuaia / Clínica médica / Dr. Pérez MP 1234', v);
end $$;

commit;

do $$
declare v text;
begin
    begin
        perform public.confirmar_documento_recien_subido(
            '30303030-3030-4303-8303-303030303030',
            'Segundo intento', 'laboratory', '2026-08-09', null);
        v := 'confirmado de nuevo';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('8c. institución/especialidad/médico',
        'Llamando SIN los tres parámetros nuevos (5 argumentos) sigue resolviendo contra la MISMA función -guarda 3, doble confirmación-',
        'rechazado (42501)', v);
end $$;

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text; institucion_larga text;
begin
    institucion_larga := rpad('X', 151, 'X');
    begin
        perform public.confirmar_documento_recien_subido(
            '40404040-4040-4404-8404-404040404040',
            'Análisis con institución demasiado larga', 'laboratory', '2026-08-10', null, null,
            institucion_larga, null, null);
        v := 'confirmado (no debería)';
    exception when invalid_parameter_value then v := 'rechazado (22023)';
             when others                   then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('8c. institución/especialidad/médico',
        'A confirma con INSTITUCIÓN de 151 caracteres (guarda 6): se rechaza la llamada completa',
        'rechazado (22023)', v);
end $$;

commit;

select pruebas_rls.registrar('8c. institución/especialidad/médico',
       'El rechazo por guarda 6 es atómico: el documento sigue SIN confirmar y sin institución',
       'sin confirmar, sin institución',
       case when exists (
                 select 1 from public.documents
                  where id = '40404040-4040-4404-8404-404040404040'
                    and confirmed_at is null
                    and institution is null
                    and title = 'Análisis con institución demasiado larga (sin revisar)')
            then 'sin confirmar, sin institución'
            else 'estado inesperado' end);

-- Los dos documentos de este bloque no se borran acá a propósito, mismo
-- criterio que el cierre de BLOQUE 8/8b: la limpieza final del script los
-- arrastra por CASCADE al borrar auth.users.


-- =============================================================================
-- BLOQUE 8d — parámetro `nuevo_numero_orden` del RPC (hotfix de duplicados
-- semánticos, 20260818180000_duplicados_semanticos.sql)
-- -----------------------------------------------------------------------------
-- `confirmar_documento_recien_subido` se extendió con un DÉCIMO parámetro
-- `nuevo_numero_orden text DEFAULT NULL` que persiste en
-- `documents.numero_orden` -la columna que alimenta la Capa 2 del detector de
-- duplicados semánticos-. Este bloque prueba lo que 8/8b/8c no cubren: que el
-- caso feliz persiste el número de orden (guarda 6 extendida), y que un valor
-- demasiado largo aborta la llamada COMPLETA -mismo criterio de atomicidad
-- que las guardas 5 y 6 de institución/especialidad/médico-. Que BLOQUE
-- 8/8b/8c sigan pasando sin cambios (llaman con 5, 6 y 9 argumentos) confirma
-- la compatibilidad posicional: el parámetro nuevo va al FINAL, con DEFAULT.
-- =============================================================================
\echo '### BLOQUE 8d — parámetro numero_orden del RPC de confirmación'

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

insert into public.documents (id, profile_id, title, category, document_date, storage_path) values
    ('50505050-5050-4505-8505-505050505050', :p_a, 'Análisis con número de orden (sin revisar)',            'other', '2026-08-11', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/bloque8d-ok.pdf'),
    ('60606060-6060-4606-8606-606060606060', :p_a, 'Análisis con número de orden demasiado largo (sin revisar)', 'other', '2026-08-12', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/bloque8d-mal.pdf');

commit;

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.confirmar_documento_recien_subido(
            '50505050-5050-4505-8505-505050505050',
            'Análisis con número de orden — agosto', 'laboratory', '2026-08-11', null, null,
            'Sanatorio San Jorge', 'Clínica médica', 'Dra. Pérez',
            '1446188');
        v := coalesce((select numero_orden from public.documents
                        where id = '50505050-5050-4505-8505-505050505050'),
                      'NO ENCONTRADO');
    exception when others then v := 'error ' || sqlstate || ' ' || sqlerrm;
    end;
    perform pruebas_rls.registrar('8d. número de orden',
        'A confirma CON número de orden: queda persistido en documents.numero_orden',
        '1446188', v);
end $$;

commit;

do $$
declare v text;
begin
    begin
        perform public.confirmar_documento_recien_subido(
            '50505050-5050-4505-8505-505050505050',
            'Segundo intento', 'laboratory', '2026-08-11', null);
        v := 'confirmado de nuevo';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('8d. número de orden',
        'Llamando SIN el parámetro nuevo (5 argumentos) sigue resolviendo contra la MISMA función -guarda 3, doble confirmación-',
        'rechazado (42501)', v);
end $$;

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text; orden_largo text;
begin
    orden_largo := rpad('9', 61, '9');
    begin
        perform public.confirmar_documento_recien_subido(
            '60606060-6060-4606-8606-606060606060',
            'Análisis con número de orden demasiado largo', 'laboratory', '2026-08-12', null, null,
            null, null, null, orden_largo);
        v := 'confirmado (no debería)';
    exception when invalid_parameter_value then v := 'rechazado (22023)';
             when others                   then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('8d. número de orden',
        'A confirma con NÚMERO DE ORDEN de 61 caracteres (guarda 6 extendida): se rechaza la llamada completa',
        'rechazado (22023)', v);
end $$;

commit;

select pruebas_rls.registrar('8d. número de orden',
       'El rechazo por guarda 6 es atómico: el documento sigue SIN confirmar y sin número de orden',
       'sin confirmar, sin numero_orden',
       case when exists (
                 select 1 from public.documents
                  where id = '60606060-6060-4606-8606-606060606060'
                    and confirmed_at is null
                    and numero_orden is null
                    and title = 'Análisis con número de orden demasiado largo (sin revisar)')
            then 'sin confirmar, sin numero_orden'
            else 'estado inesperado' end);

-- Los dos documentos de este bloque no se borran acá a propósito, mismo
-- criterio que el cierre de BLOQUE 8/8b/8c: la limpieza final del script los
-- arrastra por CASCADE al borrar auth.users.


-- =============================================================================
-- BLOQUE 8e — resultados CUALITATIVOS de lab_metrics (Sprint 18)
-- -----------------------------------------------------------------------------
-- `20260819190000_lab_metrics_resultados_cualitativos.sql` deja `value`
-- nullable y agrega `value_text` + el CHECK `lab_metrics_valor_o_texto`
-- (al menos uno de los dos, nunca ninguno). Este bloque prueba lo que 8b no
-- cubre: una métrica con SOLO `value_text` (sin `value`) se acepta e
-- inserta, y una métrica sin NINGUNO de los dos se sigue rechazando -mismo
-- criterio atómico que 8b, ahora por la guarda ampliada-.
-- =============================================================================
\echo '### BLOQUE 8e — resultados cualitativos (value_text) del RPC de confirmación'

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

insert into public.documents (id, profile_id, title, category, document_date, storage_path) values
    ('8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d', :p_a, 'Análisis con resultado cualitativo (sin revisar)', 'other', '2026-08-09', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/bloque8e-cualitativo.pdf'),
    ('8d8d8d8e-8d8d-4d8d-8d8d-8d8d8d8d8d8e', :p_a, 'Análisis sin value ni value_text (sin revisar)',    'other', '2026-08-10', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/bloque8e-mal.pdf');

commit;

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare
    v text;
    n integer;
begin
    begin
        perform public.confirmar_documento_recien_subido(
            '8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d',
            'Análisis con resultado cualitativo — agosto', 'laboratory', '2026-08-09', null,
            '[{"metric_name":"Strep A","value_text":"Negativo"},
              {"metric_name":"Plaquetas","metric_canonical":"Plaquetas","value":450000,"value_text":"Aumentadas","unit":"/mm3"}]'::jsonb);
        select count(*) into n from public.lab_metrics where document_id = '8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d';
        v := 'confirmado, ' || n || ' métricas insertadas';
    exception when others then v := 'error ' || sqlstate || ' ' || sqlerrm;
    end;
    perform pruebas_rls.registrar('8e. resultados cualitativos',
        'A confirma con una métrica SOLO value_text y otra con value+value_text juntos: las dos quedan insertadas',
        'confirmado, 2 métricas insertadas', v);
end $$;

commit;

select pruebas_rls.registrar('8e. resultados cualitativos',
       '"Strep A" quedó con value NULL y value_text = Negativo (resultado puramente cualitativo)',
       'NULL / Negativo',
       coalesce((select coalesce(value::text, 'NULL') || ' / ' || value_text
                   from public.lab_metrics
                  where document_id = '8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d'
                    and metric_name = 'Strep A'),
                'NO ENCONTRADA'));

select pruebas_rls.registrar('8e. resultados cualitativos',
       '"Plaquetas" quedó con value Y value_text a la vez (no es un XOR, ver el CHECK lab_metrics_valor_o_texto)',
       '450000 / Aumentadas',
       coalesce((select value::text || ' / ' || value_text
                   from public.lab_metrics
                  where document_id = '8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d'
                    and metric_name = 'Plaquetas'),
                'NO ENCONTRADA'));

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.confirmar_documento_recien_subido(
            '8d8d8d8e-8d8d-4d8d-8d8d-8d8d8d8d8d8e',
            'Análisis sin ningún valor', 'laboratory', '2026-08-10', null,
            '[{"metric_name":"Rara sin valor"}]'::jsonb);
        v := 'confirmado (no debería)';
    exception when invalid_parameter_value then v := 'rechazado (22023)';
             when others                   then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('8e. resultados cualitativos',
        'A confirma con una métrica SIN value NI value_text (guarda 5 ampliada): se rechaza la llamada completa',
        'rechazado (22023)', v);
end $$;

commit;

select pruebas_rls.registrar('8e. resultados cualitativos',
       'El rechazo por guarda 5 ampliada es atómico: el documento sigue SIN confirmar y no se coló ninguna fila de lab_metrics',
       'sin confirmar, sin métricas',
       case when exists (
                 select 1 from public.documents
                  where id = '8d8d8d8e-8d8d-4d8d-8d8d-8d8d8d8d8d8e'
                    and confirmed_at is null
                    and title = 'Análisis sin value ni value_text (sin revisar)')
             and not exists (
                 select 1 from public.lab_metrics
                  where document_id = '8d8d8d8e-8d8d-4d8d-8d8d-8d8d8d8d8d8e')
            then 'sin confirmar, sin métricas'
            else 'estado inesperado' end);

-- Mismo criterio que el cierre de 8b: no se borran acá, la limpieza final
-- del script los arrastra por CASCADE al borrar auth.users.


-- =============================================================================
-- BLOQUE 9 — recordatorios de turnos: infraestructura cerrada (tarea 6.4)
-- -----------------------------------------------------------------------------
-- `appointment_reminders` y sus funciones son INFRAESTRUCTURA: las escriben
-- pg_cron (como postgres) y el barrido de `/api/push/procesar-recordatorios`
-- (como service_role). Una sesión de la aplicación no tiene nada que hacer ahí,
-- y dos de esas funciones serían fugas si estuvieran expuestas:
--
--   · `destinatarios_de_avisos()` devuelve `user_id` de OTRAS cuentas (las de
--     los can_manage sobre un perfil). Es exactamente el tipo de dato que
--     ninguna política del proyecto deja ver.
--   · `configurar_cron_recordatorios()` ESCRIBE secretos en el Vault.
--
-- El bloque prueba las dos capas: privilegio de tabla (que es lo que frena un
-- TRUNCATE, cosa que RLS no hace) y privilegio de ejecución de las funciones.
-- =============================================================================
\echo '### BLOQUE 9 — recordatorios de turnos (infraestructura)'

-- Ni anon ni authenticated tienen NINGÚN privilegio sobre las dos tablas de
-- infraestructura. Sin esto, el default de Supabase
-- (`alter default privileges ... grant all on tables to anon, authenticated`)
-- las deja con TRUNCATE, y RLS no protege de un TRUNCATE.
select pruebas_rls.registrar('9. recordatorios',
       'Privilegios de anon/authenticated sobre las tablas de infraestructura', '0', count(*)::text)
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('appointment_reminders', 'storage_purge_queue')
   and grantee in ('anon', 'authenticated');

select pruebas_rls.registrar('9. recordatorios',
       'Funciones del job ejecutables por anon o authenticated', '0', count(*)::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('generar_recordatorios_pendientes', 'reclamar_recordatorios_turnos',
                     'cerrar_recordatorio_turno', 'destinatarios_de_avisos',
                     'configurar_cron_recordatorios', 'disparar_recordatorios_turnos')
   and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'));

select pruebas_rls.registrar('9. recordatorios',
       'appointment_reminders tiene RLS habilitada', 'true',
       coalesce((select rowsecurity::text from pg_tables
                  where schemaname = 'public' and tablename = 'appointment_reminders'),
                '(la tabla no existe)'));

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.appointment_reminders;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('9. recordatorios',
        'A lee appointment_reminders', 'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.generar_recordatorios_pendientes();
        v := 'ejecutado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('9. recordatorios',
        'A ejecuta generar_recordatorios_pendientes()', 'denegado (42501)', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.reclamar_recordatorios_turnos(5);
        v := 'ejecutado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('9. recordatorios',
        'A ejecuta reclamar_recordatorios_turnos() (podría mandar avisos ajenos)',
        'denegado (42501)', v);
end $$;

-- El argumento es irrelevante: el privilegio de EXECUTE se verifica antes de
-- evaluar la función, así que `null` alcanza y evita depender de qué perfiles
-- existen en este punto del script. (psql no interpola `:variables` dentro de
-- un bloque dollar-quoted, de ahí que no se use `:p_g`.)
do $$
declare v text; u uuid;
begin
    begin
        select d into u from public.destinatarios_de_avisos(null) as d;
        v := 'ejecutado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('9. recordatorios',
        'A ejecuta destinatarios_de_avisos() (fuga de user_id ajenos)', 'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.configurar_cron_recordatorios('http://atacante.example', 'secreto');
        v := 'ejecutado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('9. recordatorios',
        'A ejecuta configurar_cron_recordatorios() (escribe secretos del Vault)',
        'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.disparar_recordatorios_turnos();
        v := 'ejecutado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('9. recordatorios',
        'A ejecuta disparar_recordatorios_turnos()', 'denegado (42501)', v);
end $$;

commit;

-- A QUIÉN le llega el aviso, que es la otra mitad de la tarea. Se usa el
-- perfil gestionado de B (Elsa, `p_g2`), que sigue vivo en este punto -el de A
-- lo borró el BLOQUE 5- y que no tiene cuenta propia: el único destinatario
-- posible es su administrador.
select pruebas_rls.registrar('9. recordatorios',
       'destinatarios_de_avisos() de un perfil gestionado: su can_manage',
       'u_b',
       coalesce((select string_agg(case when d = :u_a then 'u_a'
                                        when d = :u_b then 'u_b'
                                        else d::text end, ', ' order by 1)
                   from public.destinatarios_de_avisos(:p_g2) as d),
                '(nadie)'));

-- LA REGLA DE docs/modelo-permisos.md §4.3, CON LOS DIENTES AFUERA: se le da a
-- A un `can_view` + `can_upload` sobre el mismo perfil y NO tiene que aparecer
-- entre los destinatarios. Poder mirar el historial de alguien no es lo mismo
-- que ser quien lo lleva al médico, y notificarle sus turnos sería contarle
-- algo que no le corresponde.
insert into public.family_permissions
    (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage)
values (:p_g2, :p_a, true, true, false);

select pruebas_rls.registrar('9. recordatorios',
       'Un can_view/can_upload NO recibe los avisos del perfil', 'u_b',
       coalesce((select string_agg(case when d = :u_a then 'u_a'
                                        when d = :u_b then 'u_b'
                                        else d::text end, ', ' order by 1)
                   from public.destinatarios_de_avisos(:p_g2) as d),
                '(nadie)'));

-- Y en cuanto ese permiso pasa a can_manage, sí entra.
update public.family_permissions set can_manage = true
 where owner_profile_id = :p_g2 and granted_profile_id = :p_a;

select pruebas_rls.registrar('9. recordatorios',
       'Ascender a can_manage suma a la persona a los destinatarios', 'u_a, u_b',
       coalesce((select string_agg(case when d = :u_a then 'u_a'
                                        when d = :u_b then 'u_b'
                                        else d::text end, ', ' order by 1)
                   from public.destinatarios_de_avisos(:p_g2) as d),
                '(nadie)'));

-- Un perfil CON cuenta (el de A) se recibe a sí mismo por la rama del titular,
-- y suma a quien lo administre -en este punto del script B ya tiene can_manage
-- sobre A-. El `string_agg` mostraría los repetidos si el `union` no
-- deduplicara.
select pruebas_rls.registrar('9. recordatorios',
       'El titular con cuenta se recibe a sí mismo, sin duplicados, y suma a su can_manage',
       'u_a, u_b',
       coalesce((select string_agg(case when d = :u_a then 'u_a'
                                        when d = :u_b then 'u_b'
                                        else d::text end, ', ' order by 1)
                   from public.destinatarios_de_avisos(:p_a) as d),
                '(nadie)'));

-- Un perfil que no existe no rompe nada ni devuelve a nadie: el barrido lo
-- cierra con 0 entregas en vez de fallar.
select pruebas_rls.registrar('9. recordatorios',
       'Un perfil inexistente no devuelve destinatarios', '(nadie)',
       coalesce((select string_agg(d::text, ', ')
                   from public.destinatarios_de_avisos(
                            '00000000-0000-4000-8000-000000000000') as d),
                '(nadie)'));


-- =============================================================================
-- BLOQUE 10 — ventanas de los recordatorios: la regla antispam (tarea 6.4)
-- -----------------------------------------------------------------------------
-- No es RLS -como el BLOQUE 8- pero vive acá por el mismo motivo: es lógica de
-- base que ninguna prueba de TypeScript puede ejercitar, y es la garantía de
-- producto más frágil de la tarea. Si se rompe, la consecuencia no es un error
-- visible: es que a alguien le llegan cuatro notificaciones juntas del mismo
-- turno, o que no le llega ninguna.
--
-- El caso 5 en particular es una regresión REAL encontrada en revisión: la
-- primera versión colapsaba las ventanas dentro de una corrida pero no entre
-- corridas, así que un barrido caído un día mandaba "mañana" y "en 3 horas"
-- al mismo tiempo.
-- =============================================================================
\echo '### BLOQUE 10 — ventanas de los recordatorios (antispam)'

-- Turno de prueba sobre el perfil propio de A, que sigue vivo en este punto.
-- Se borra al final del bloque; si algo abortara antes, la limpieza general
-- lo arrastra igual al borrar auth.users.
insert into public.appointments (id, profile_id, specialty, appointment_date, status)
values ('a0000000-0000-4000-8000-0000000b10c0'::uuid, :p_a, 'Traumatología',
        now() + interval '8 days', 'confirmed');

-- Función auxiliar: el estado de las ventanas del turno de prueba, ordenado
-- de la más ancha a la más próxima, como '7d=omitido, 3h=pendiente'.
create function pruebas_rls.ventanas() returns text language sql as $$
    select coalesce(string_agg(ventana || '=' || estado, ', ' order by due_at),
                    '(sin filas)')
      from public.appointment_reminders
     where appointment_id = 'a0000000-0000-4000-8000-0000000b10c0'::uuid;
$$;

select public.generar_recordatorios_pendientes();
select pruebas_rls.registrar('10. ventanas',
       'Turno a 8 días: ninguna ventana vencida todavía',
       '(sin filas)', pruebas_rls.ventanas());

update public.appointments set appointment_date = now() + interval '6 days 23 hours'
 where id = 'a0000000-0000-4000-8000-0000000b10c0';
select public.generar_recordatorios_pendientes();
select pruebas_rls.registrar('10. ventanas',
       'Turno a 6d23h: solo vence la de 7 días',
       '7d=pendiente', pruebas_rls.ventanas());

select public.generar_recordatorios_pendientes();
select pruebas_rls.registrar('10. ventanas',
       'Idempotencia: la corrida siguiente no crea nada',
       '7d=pendiente', pruebas_rls.ventanas());

-- El caso del roadmap: turno cargado (o reprogramado) con TODAS las ventanas
-- ya vencidas. Cambiar la fecha borra las filas por trigger, así que este
-- update prueba las dos cosas de una.
update public.appointments set appointment_date = now() + interval '2 hours 50 minutes'
 where id = 'a0000000-0000-4000-8000-0000000b10c0';
select pruebas_rls.registrar('10. ventanas',
       'Cambiar la fecha borra los recordatorios (trigger)',
       '(sin filas)', pruebas_rls.ventanas());

select public.generar_recordatorios_pendientes();
select pruebas_rls.registrar('10. ventanas',
       'Turno a 2h50m: las 4 ventanas vencidas, se manda SOLO la más próxima',
       '7d=omitido, 48h=omitido, 24h=omitido, 3h=pendiente', pruebas_rls.ventanas());

-- Colapso ENTRE corridas: se simula un barrido caído dejando un pendiente
-- viejo y ancho, y se comprueba que la corrida siguiente lo degrada en vez de
-- sumarle una segunda notificación.
delete from public.appointment_reminders
 where appointment_id = 'a0000000-0000-4000-8000-0000000b10c0' and ventana <> '7d';
update public.appointment_reminders set estado = 'pendiente', claimed_at = null, sent_at = null
 where appointment_id = 'a0000000-0000-4000-8000-0000000b10c0';
select public.generar_recordatorios_pendientes();
select pruebas_rls.registrar('10. ventanas',
       'Barrido caído: un pendiente viejo NO se suma al nuevo, se degrada [REGRESIÓN]',
       '7d=omitido, 48h=omitido, 24h=omitido, 3h=pendiente', pruebas_rls.ventanas());

-- Pero el colapso no puede reescribir la historia: lo que ya salió, salió.
update public.appointment_reminders set estado = 'enviado', sent_at = now(), claimed_at = now()
 where appointment_id = 'a0000000-0000-4000-8000-0000000b10c0' and ventana = '24h';
update public.appointment_reminders set estado = 'pendiente', claimed_at = null
 where appointment_id = 'a0000000-0000-4000-8000-0000000b10c0' and ventana = '48h';
select public.generar_recordatorios_pendientes();
select pruebas_rls.registrar('10. ventanas',
       'El colapso degrada pendientes pero no toca lo ya enviado',
       '7d=omitido, 48h=omitido, 24h=enviado, 3h=pendiente', pruebas_rls.ventanas());

-- Cancelar: se van los que no salieron, queda el registro de los que sí.
update public.appointments set status = 'cancelled'
 where id = 'a0000000-0000-4000-8000-0000000b10c0';
select pruebas_rls.registrar('10. ventanas',
       'Cancelar borra lo pendiente y conserva lo enviado',
       '7d=omitido, 48h=omitido, 24h=enviado', pruebas_rls.ventanas());

select public.generar_recordatorios_pendientes();
select pruebas_rls.registrar('10. ventanas',
       'Un turno cancelado no genera recordatorios nuevos',
       '7d=omitido, 48h=omitido, 24h=enviado', pruebas_rls.ventanas());

-- Caducidad: el turno arrancó mientras el aviso esperaba en la cola.
update public.appointments set status = 'confirmed', appointment_date = now() + interval '2 hours'
 where id = 'a0000000-0000-4000-8000-0000000b10c0';
select public.generar_recordatorios_pendientes();
update public.appointments set appointment_date = now() - interval '5 minutes'
 where id = 'a0000000-0000-4000-8000-0000000b10c0';
insert into public.appointment_reminders (appointment_id, ventana, due_at, estado)
values ('a0000000-0000-4000-8000-0000000b10c0'::uuid, '3h', now() - interval '5 hours', 'pendiente');
select public.generar_recordatorios_pendientes();
select pruebas_rls.registrar('10. ventanas',
       'Un aviso de un turno que ya empezó no sale: caduca a omitido',
       '3h=omitido', pruebas_rls.ventanas());

-- Y el borrado del turno se lleva sus recordatorios (ON DELETE CASCADE).
delete from public.appointments where id = 'a0000000-0000-4000-8000-0000000b10c0';
select pruebas_rls.registrar('10. ventanas',
       'Borrar el turno borra sus recordatorios (CASCADE)',
       '(sin filas)', pruebas_rls.ventanas());


-- =============================================================================
-- BLOQUE 11 — medicación: estado, tomas y stock (tarea 7.1)
-- -----------------------------------------------------------------------------
-- `20260813060000_medicacion_estado.sql` agrega tres cosas que este bloque
-- verifica por separado, porque son de naturaleza distinta:
--
--   · `v_medicacion_estado` es una VISTA con `security_invoker = true`: hereda
--     las políticas de `medications`, así que lo que hay que probar es la
--     ARITMÉTICA (que los días restantes sean los correctos para los tres
--     esquemas de frecuencia) y que `anon` no la alcance.
--   · `registrar_toma()` / `revertir_toma()` son SECURITY DEFINER que bypassean
--     la RLS por diseño (nota ⑨ de docs/modelo-permisos.md): sus guardas se
--     prueban LLAMÁNDOLAS con las sesiones simuladas del resto del arnés.
--   · `generar_tomas_del_dia()` es infraestructura: se prueba su idempotencia y
--     que no esté al alcance de una sesión de usuario.
--
-- Las medicaciones del bloque cuelgan de un perfil GESTIONADO propio (:p_g3),
-- que es el caso de uso real: la persona mayor no marca sus propias tomas, las
-- marca quien la cuida. Es un perfil nuevo y no Roberto porque el BLOQUE 5 lo
-- borra a propósito (la contracara positiva de la nota ③). La limpieza final
-- del script se lo lleva, y con él sus medicaciones y tomas por CASCADE.
-- =============================================================================
\echo '### BLOQUE 11 — medicación: estado, tomas y stock'

insert into public.profiles (id, user_id, full_name, role, created_by_profile_id, blood_type)
values (:p_g3, null, 'Rosa Medina', 'elder', :p_a, 'A-');

-- María la administra: es quien va a registrar las tomas.
insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage)
values (:p_g3, :p_a, true, true, true);

insert into public.medications
    (id, profile_id, name, active_ingredient, dose_amount, dose_unit,
     frequency, schedule_times, interval_hours, stock_units, start_date,
     is_active, suspended_at)
values
    -- 2 tomas/día × 1 comprimido, stock 60 → 30 días (el ejemplo del ROADMAP).
    ('d0000000-0000-4000-8000-00000000d001', :p_g3, 'Metformina de prueba', 'Metformina',
     1, 'comprimido', 'daily', '{08:00,20:00}', null, 60, current_date - 30, true, null),
    -- Cada 8 horas → 3 tomas/día × 1, stock 60 → 20 días.
    ('d0000000-0000-4000-8000-00000000d002', :p_g3, 'Ibuprofeno de prueba', 'Ibuprofeno',
     1, 'comprimido', 'interval_hours', null, 8, 60, current_date - 10, true, null),
    -- A demanda: sin consumo diario, sin días restantes. El stock informa.
    ('d0000000-0000-4000-8000-00000000d003', :p_g3, 'Paracetamol de prueba', 'Paracetamol',
     1, 'comprimido', 'as_needed', null, null, 20, current_date - 5, true, null),
    -- Suspendida: fuera de la vista, aunque tenga stock.
    ('d0000000-0000-4000-8000-00000000d004', :p_g3, 'Suspendida de prueba', 'Enalapril',
     1, 'comprimido', 'daily', '{09:00}', null, 30, current_date - 40, false, now()),
    -- Stock agotado: días restantes 0 y alerta encendida, pero se puede seguir
    -- registrando tomas (el stock es una guía, no un portero).
    ('d0000000-0000-4000-8000-00000000d005', :p_g3, 'Sin stock de prueba', 'Losartán',
     1, 'comprimido', 'daily', '{10:00}', null, 0, current_date - 3, true, null);

insert into public.medication_intakes (id, medication_id, profile_id, scheduled_at, taken_at, status, dose_units)
values
    ('e0000000-0000-4000-8000-00000000e001', 'd0000000-0000-4000-8000-00000000d001', :p_g3, now() - interval '2 hours',  null, 'pending', null),
    ('e0000000-0000-4000-8000-00000000e002', 'd0000000-0000-4000-8000-00000000d001', :p_g3, now() - interval '30 hours', null, 'pending', null),
    ('e0000000-0000-4000-8000-00000000e003', 'd0000000-0000-4000-8000-00000000d005', :p_g3, now() - interval '1 hour',   null, 'pending', null),
    -- Registrada AYER: sirve para el límite de "solo el mismo día".
    ('e0000000-0000-4000-8000-00000000e004', 'd0000000-0000-4000-8000-00000000d001', :p_g3, now() - interval '1 day', now() - interval '1 day', 'taken', 1),
    ('e0000000-0000-4000-8000-00000000e005', 'd0000000-0000-4000-8000-00000000d001', :p_g3, now() + interval '1 hour',  null, 'pending', null);

-- Diego arranca con can_view sobre Roberto: mira, no toca.
insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage)
values (:p_g3, :p_b, true, false, false);

-- Renderizadores legibles (mismo criterio que pruebas_rls.ventanas()).
create function pruebas_rls.med(p_id uuid) returns text
language sql
as $$
    select coalesce(
        (select format('tomas/día=%s dosis diaria=%s días restantes=%s renovar=%s',
                       coalesce(trim_scale(tomas_por_dia)::text,      'NULL'),
                       coalesce(trim_scale(dosis_diaria_total)::text, 'NULL'),
                       coalesce(dias_restantes::text,                 'NULL'),
                       necesita_renovacion::text)
           from public.v_medicacion_estado
          where medication_id = p_id),
        '(no aparece en la vista)');
$$;

create function pruebas_rls.stock(p_id uuid) returns text
language sql
as $$
    select coalesce(trim_scale(stock_units)::text, 'NULL')
      from public.medications where id = p_id;
$$;

create function pruebas_rls.toma(p_id uuid) returns text
language sql
as $$
    select format('%s dose_units=%s', status,
                  coalesce(trim_scale(dose_units)::text, 'NULL'))
      from public.medication_intakes where id = p_id;
$$;

-- OJO con `date AT TIME ZONE`: un `date` se promueve a timestamptz y el
-- resultado corre 3 horas. El `::timestamp` explícito es lo que hace que la
-- ventana sea el día de pared de Ushuaia y no un rango corrido.
create function pruebas_rls.grilla(p_med uuid, p_fecha date) returns text
language sql
as $$
    select coalesce(
        string_agg(to_char(mi.scheduled_at at time zone 'America/Argentina/Ushuaia', 'HH24:MI'),
                   ', ' order by mi.scheduled_at),
        '(sin tomas)')
      from public.medication_intakes mi
     where mi.medication_id = p_med
       and mi.scheduled_at >= (p_fecha::timestamp       at time zone 'America/Argentina/Ushuaia')
       and mi.scheduled_at <  ((p_fecha + 1)::timestamp at time zone 'America/Argentina/Ushuaia');
$$;


-- --- 11.1 La aritmética de la vista ------------------------------------------

select pruebas_rls.registrar('11. medicación',
       'Vista: daily con 2 horarios, stock 60  [CRITERIO DE ACEPTACIÓN]',
       'tomas/día=2 dosis diaria=2 días restantes=30 renovar=false',
       pruebas_rls.med('d0000000-0000-4000-8000-00000000d001'));

select pruebas_rls.registrar('11. medicación',
       'Vista: interval_hours cada 8hs, stock 60  [CRITERIO DE ACEPTACIÓN]',
       'tomas/día=3 dosis diaria=3 días restantes=20 renovar=false',
       pruebas_rls.med('d0000000-0000-4000-8000-00000000d002'));

select pruebas_rls.registrar('11. medicación',
       'Vista: as_needed no proyecta días restantes  [CRITERIO DE ACEPTACIÓN]',
       'tomas/día=NULL dosis diaria=NULL días restantes=NULL renovar=false',
       pruebas_rls.med('d0000000-0000-4000-8000-00000000d003'));

select pruebas_rls.registrar('11. medicación',
       'Vista: una medicación suspendida no aparece',
       '(no aparece en la vista)',
       pruebas_rls.med('d0000000-0000-4000-8000-00000000d004'));

select pruebas_rls.registrar('11. medicación',
       'Vista: stock 0 da 0 días y enciende la alerta de renovación',
       'tomas/día=1 dosis diaria=1 días restantes=0 renovar=true',
       pruebas_rls.med('d0000000-0000-4000-8000-00000000d005'));

-- Contra los datos REALES de supabase/seed.sql, no contra los del arnés:
-- Glucophage 120 comprimidos ÷ 2 por día = 60 días; Enalapril 90 ÷ 1 = 90.
select pruebas_rls.registrar('11. medicación',
       'Vista: los días restantes del seed (Glucophage 120/2, Enalapril 90/1)',
       'Enalapril=90, Glucophage=60',
       coalesce((select string_agg(name || '=' || dias_restantes, ', ' order by name)
                   from public.v_medicacion_estado
                  where medication_id in ('880e8400-e29b-41d4-a716-446655440001',
                                          '880e8400-e29b-41d4-a716-446655440002')),
                '(el seed no está cargado)'));


-- --- 11.2 registrar_toma: las dos escrituras, atómicas -----------------------

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

-- María administra a Roberto: puede_cargar_en_perfil es true.
do $$
declare v text;
begin
    begin
        perform public.registrar_toma('e0000000-0000-4000-8000-00000000e001');
        v := 'registrada';
    exception when others then v := 'rechazado (' || sqlstate || ')';
    end;
    perform pruebas_rls.registrar('11. medicación',
        'A registra la toma pendiente de las últimas horas', 'registrada', v);
end $$;

-- Segunda llamada sobre la MISMA toma: es lo que impide el doble descuento.
do $$
declare v text;
begin
    begin
        perform public.registrar_toma('e0000000-0000-4000-8000-00000000e001');
        v := 'registrada';
    exception when others then v := 'rechazado (' || sqlstate || ')';
    end;
    perform pruebas_rls.registrar('11. medicación',
        'Registrar dos veces la misma toma se rechaza (no descuenta de nuevo)',
        'rechazado (22023)', v);
end $$;

-- Una toma de hace 30 horas ya no se "registra": se corrige, y eso es can_manage.
do $$
declare v text;
begin
    begin
        perform public.registrar_toma('e0000000-0000-4000-8000-00000000e002');
        v := 'registrada';
    exception when others then v := 'rechazado (' || sqlstate || ')';
    end;
    perform pruebas_rls.registrar('11. medicación',
        'Una toma de hace 30hs queda fuera de la ventana de ±12hs',
        'rechazado (22023)', v);
end $$;

commit;

select pruebas_rls.registrar('11. medicación',
       'Registrar la toma marcó taken y guardó lo descontado',
       'taken dose_units=1', pruebas_rls.toma('e0000000-0000-4000-8000-00000000e001'));

select pruebas_rls.registrar('11. medicación',
       'Registrar la toma descontó el stock (60 → 59)  [CRITERIO DE ACEPTACIÓN]',
       '59', pruebas_rls.stock('d0000000-0000-4000-8000-00000000d001'));


-- --- 11.3 revertir_toma: deshacer el mismo día -------------------------------

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.revertir_toma('e0000000-0000-4000-8000-00000000e001');
        v := 'revertida';
    exception when others then v := 'rechazado (' || sqlstate || ')';
    end;
    perform pruebas_rls.registrar('11. medicación',
        'A deshace la toma que acaba de marcar', 'revertida', v);
end $$;

-- La de ayer ya no es un error de tipeo: es historial clínico.
do $$
declare v text;
begin
    begin
        perform public.revertir_toma('e0000000-0000-4000-8000-00000000e004');
        v := 'revertida';
    exception when others then v := 'rechazado (' || sqlstate || ')';
    end;
    perform pruebas_rls.registrar('11. medicación',
        'Deshacer una toma de AYER se rechaza (solo el mismo día de Ushuaia)',
        'rechazado (22023)', v);
end $$;

commit;

select pruebas_rls.registrar('11. medicación',
       'Deshacer restituye el stock exacto (59 → 60)  [CRITERIO DE ACEPTACIÓN]',
       '60', pruebas_rls.stock('d0000000-0000-4000-8000-00000000d001'));

select pruebas_rls.registrar('11. medicación',
       'La toma deshecha vuelve a pending y suelta dose_units',
       'pending dose_units=NULL', pruebas_rls.toma('e0000000-0000-4000-8000-00000000e001'));


-- --- 11.4 Stock en cero: se registra igual -----------------------------------
-- La abuela puede tener una caja que nadie cargó en la app. Bloquear el
-- registro sería que la app le discuta un hecho consumado.

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.registrar_toma('e0000000-0000-4000-8000-00000000e003');
        v := 'registrada';
    exception when others then v := 'rechazado (' || sqlstate || ')';
    end;
    perform pruebas_rls.registrar('11. medicación',
        'Con stock 0 la toma se registra igual (el stock es guía, no portero)',
        'registrada', v);
end $$;

commit;

select pruebas_rls.registrar('11. medicación',
       'Con stock 0 no se descuenta nada: dose_units queda NULL',
       'taken dose_units=NULL', pruebas_rls.toma('e0000000-0000-4000-8000-00000000e003'));

select pruebas_rls.registrar('11. medicación',
       'Con stock 0 el stock no se va a negativo', '0',
       pruebas_rls.stock('d0000000-0000-4000-8000-00000000d005'));


-- --- 11.5 Quién puede registrar: la nota ⑨, con los dientes afuera ----------

begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.registrar_toma('e0000000-0000-4000-8000-00000000e005');
        v := 'registrada';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'rechazado (' || sqlstate || ')';
    end;
    perform pruebas_rls.registrar('11. medicación',
        'B con solo can_view NO registra tomas  [CRITERIO DE ACEPTACIÓN]',
        'rechazado (42501)', v);
end $$;

commit;

-- Se le suma can_upload: registrar la toma del día es EXACTAMENTE la tarea de
-- quien cuida, y el RPC se la habilita sin darle UPDATE sobre `medications`.
update public.family_permissions
   set can_upload = true
 where owner_profile_id = :p_g3 and granted_profile_id = :p_b;

begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.registrar_toma('e0000000-0000-4000-8000-00000000e005');
        v := 'registrada';
    exception when others then v := 'rechazado (' || sqlstate || ')';
    end;
    perform pruebas_rls.registrar('11. medicación',
        'B con can_upload SÍ registra la toma y descuenta stock (nota ⑨)',
        'registrada', v);
end $$;

-- Pero sigue SIN poder tocar `medications` por la vía directa: el RPC no le
-- amplió el permiso, le dio un camino acotado.
do $$
declare v text; c integer;
begin
    begin
        update public.medications set stock_units = 999
         where id = 'd0000000-0000-4000-8000-00000000d001';
        get diagnostics c = row_count;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('11. medicación',
        'B con can_upload NO edita el stock por la vía directa (nota ⑨)',
        '0 filas', v);
end $$;

commit;

select pruebas_rls.registrar('11. medicación',
       'La toma de B descontó el stock (60 → 59)', '59',
       pruebas_rls.stock('d0000000-0000-4000-8000-00000000d001'));


-- --- 11.6 generar_tomas_del_dia: la grilla y su idempotencia -----------------
-- Se usa una fecha lejana y sintética para no pisar ninguna toma real ni la del
-- seed, y se borra al final del bloque.

select public.generar_tomas_del_dia(date '2099-06-15');

select pruebas_rls.registrar('11. medicación',
       'Generar el día: daily materializa sus dos horarios',
       '08:00, 20:00', pruebas_rls.grilla('d0000000-0000-4000-8000-00000000d001', date '2099-06-15'));

select pruebas_rls.registrar('11. medicación',
       'Generar el día: cada 8hs arma la grilla módulo 24 desde las 8:00',
       '00:00, 08:00, 16:00', pruebas_rls.grilla('d0000000-0000-4000-8000-00000000d002', date '2099-06-15'));

select pruebas_rls.registrar('11. medicación',
       'Generar el día: as_needed no programa nada',
       '(sin tomas)', pruebas_rls.grilla('d0000000-0000-4000-8000-00000000d003', date '2099-06-15'));

select pruebas_rls.registrar('11. medicación',
       'Generar el día: una medicación suspendida no programa nada',
       '(sin tomas)', pruebas_rls.grilla('d0000000-0000-4000-8000-00000000d004', date '2099-06-15'));

select pruebas_rls.registrar('11. medicación',
       'Correrla de nuevo no crea ni una toma más  [CRITERIO DE ACEPTACIÓN]',
       '0', public.generar_tomas_del_dia(date '2099-06-15')::text);

delete from public.medication_intakes
 where scheduled_at >= (date '2099-06-15'::timestamp at time zone 'America/Argentina/Ushuaia')
   and scheduled_at <  (date '2099-06-16'::timestamp at time zone 'America/Argentina/Ushuaia');


-- --- 11.7 Superficie expuesta de lo nuevo ------------------------------------
-- La vista es una RELACIÓN: nace con los privilegios `Dxtm` que el default de
-- Supabase le da a anon y authenticated sobre todo lo nuevo de `public`, y
-- aparece en `role_table_grants` igual que una tabla. El caso "Privilegios de
-- anon sobre tablas de public" del BLOQUE 7 la cubre; acá se prueba el efecto.

begin;
select set_config('request.jwt.claims', '', true);
set local role anon;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.v_medicacion_estado;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('11. medicación',
        'anon lee v_medicacion_estado', 'denegado (42501)', v);
end $$;

commit;

-- `generar_tomas_del_dia` recorre TODOS los perfiles de la base: no es una
-- operación de sesión de usuario y no se le otorga a authenticated.
begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.generar_tomas_del_dia(date '2099-06-15');
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('11. medicación',
        'A ejecuta generar_tomas_del_dia (barre toda la base)',
        'denegado (42501)', v);
end $$;

commit;

select pruebas_rls.registrar('11. medicación',
       'El job diario de tomas está programado en pg_cron', '5 3 * * *',
       coalesce((select schedule from cron.job where jobname = 'generar-tomas-del-dia'),
                '(el job no existe)'));


-- =============================================================================
-- BLOQUE 12 — alerta preventiva de renovación de receta (tarea 7.4)
-- -----------------------------------------------------------------------------
-- `20260813070000_alertas_medicacion.sql` cierra el Sprint 7. Este bloque
-- verifica las tres cosas que ninguna prueba de TypeScript puede ejercitar:
--
--   · **El umbral y la antiduplicación de 48 horas.** Son los dos criterios de
--     aceptación literales del ROADMAP ("con stock para 4 días llega push; con
--     stock para 6 días no llega nada; correr el job dos veces seguidas no
--     duplica la notificación"), y los dos viven enteramente en SQL.
--   · **El ciclo de la cola**: reclamar con lease, cerrar, y la caducidad
--     cuando alguien repone el stock antes de que el aviso salga.
--   · **La superficie expuesta**: a diferencia de `appointment_reminders`, esta
--     tabla SÍ tiene una política de lectura (los `can_manage` ven sus
--     alertas), así que hay que probar las dos direcciones — que el
--     administrador lee y que el `can_view`/`can_upload` no—, además del
--     TRUNCATE, que RLS no cubre.
--
-- Reutiliza las medicaciones del BLOQUE 11 sobre el perfil gestionado :p_g3
-- (Rosa Medina), donde en este punto del script A tiene can_manage y B tiene
-- can_view + can_upload pero NO can_manage — exactamente el par que hace falta.
-- La limpieza final se lleva el perfil y, por CASCADE, sus medicaciones y sus
-- alertas.
--
-- Estado heredado del BLOQUE 11 que este bloque usa a propósito:
--   d001 "Metformina de prueba" — daily 2 horarios, stock 59 → 29 días.
--   d002 "Ibuprofeno de prueba" — cada 8hs (3 tomas/día), stock 60 → 20 días.
--   d005 "Sin stock de prueba"  — daily 1 horario, stock 0 → 0 días, y por lo
--        tanto YA necesita renovación. Sirve para probar que un barrido toma
--        más de una alerta.
-- =============================================================================
\echo '### BLOQUE 12 — alerta preventiva de renovación de receta'

-- Renderizador legible: el estado de la alerta de una medicación, con los días
-- que se registraron al encolarla.
create function pruebas_rls.alerta(p_med uuid) returns text
language sql
as $$
    select coalesce(
        (select format('%s dias=%s', a.estado, a.dias_restantes)
           from public.medication_renewal_alerts a
          where a.medication_id = p_med
          order by a.created_at desc
          limit 1),
        '(sin alerta)');
$$;

create function pruebas_rls.alertas_de(p_med uuid) returns text
language sql
as $$
    select count(*)::text
      from public.medication_renewal_alerts a
     where a.medication_id = p_med;
$$;


-- --- 12.1 El umbral: 4 días avisa, 6 días no --------------------------------
-- El umbral NO se escribe en la migración de alertas: sale de
-- `v_medicacion_estado.necesita_renovacion`. Estos dos casos verifican que la
-- alerta respeta esa columna y no una copia del `< 5`.

-- 8 unidades ÷ 2 tomas por día = 4 días.
update public.medications set stock_units = 8
 where id = 'd0000000-0000-4000-8000-00000000d001';
-- 18 unidades ÷ 3 tomas por día = 6 días.
update public.medications set stock_units = 18
 where id = 'd0000000-0000-4000-8000-00000000d002';

select pruebas_rls.registrar('12. alertas medicación',
       'La vista enciende necesita_renovacion con 4 días y no con 6',
       'Ibuprofeno=false/6, Metformina=true/4',
       coalesce((select string_agg(split_part(name, ' ', 1) || '=' ||
                                   necesita_renovacion || '/' || dias_restantes,
                                   ', ' order by name)
                   from public.v_medicacion_estado
                  where medication_id in ('d0000000-0000-4000-8000-00000000d001',
                                          'd0000000-0000-4000-8000-00000000d002')),
                '(no aparecen)'));

-- Encola d001 (4 días) y d005 (0 días, heredada del BLOQUE 11). NO d002.
select pruebas_rls.registrar('12. alertas medicación',
       'Generar encola las que necesitan renovación (4 días y 0 días)  [CRITERIO DE ACEPTACIÓN]',
       '2', public.generar_alertas_medicacion()::text);

select pruebas_rls.registrar('12. alertas medicación',
       'La medicación con 4 días de stock quedó en la cola  [CRITERIO DE ACEPTACIÓN]',
       'pendiente dias=4', pruebas_rls.alerta('d0000000-0000-4000-8000-00000000d001'));

select pruebas_rls.registrar('12. alertas medicación',
       'La medicación con 6 días de stock NO genera nada  [CRITERIO DE ACEPTACIÓN]',
       '(sin alerta)', pruebas_rls.alerta('d0000000-0000-4000-8000-00000000d002'));

-- El borde exacto del umbral: `necesita_renovacion` es `dias_restantes < 5`, así
-- que 5 días justos NO avisa. Un `<=` en cualquier lado rompería este caso.
update public.medications set stock_units = 15
 where id = 'd0000000-0000-4000-8000-00000000d002';

select pruebas_rls.registrar('12. alertas medicación',
       'Con 5 días justos tampoco avisa (el umbral es < 5, no <= 5)',
       '(sin alerta)',
       (select pruebas_rls.alerta('d0000000-0000-4000-8000-00000000d002')
          from (select public.generar_alertas_medicacion()) as _));


-- --- 12.2 La antiduplicación de 48 horas ------------------------------------
-- El criterio de aceptación literal del ROADMAP. La ventana es deslizante (un
-- predicado sobre `created_at`), no un cubo de calendario: correrla de nuevo un
-- segundo después no puede encolar otra vez.

select pruebas_rls.registrar('12. alertas medicación',
       'Correr el generador dos veces seguidas no encola nada nuevo  [CRITERIO DE ACEPTACIÓN]',
       '0', public.generar_alertas_medicacion()::text);

select pruebas_rls.registrar('12. alertas medicación',
       'Y la medicación sigue teniendo UNA sola alerta  [CRITERIO DE ACEPTACIÓN]',
       '1', pruebas_rls.alertas_de('d0000000-0000-4000-8000-00000000d001'));

-- La segunda capa de la antiduplicación: el índice único parcial. Aunque el
-- predicado de 48hs no estuviera (o dos corridas simultáneas lo pasaran a la
-- vez), la base no permite dos alertas VIVAS de la misma medicación.
do $$
declare v text;
begin
    begin
        insert into public.medication_renewal_alerts (medication_id, profile_id, dias_restantes)
        values ('d0000000-0000-4000-8000-00000000d001',
                'f0000000-0000-4000-8000-00000000f001', 4);
        v := 'insertada';
    exception when unique_violation then v := 'rechazado (23505)';
             when others            then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('12. alertas medicación',
        'Una segunda alerta VIVA de la misma medicación la rechaza el índice único',
        'rechazado (23505)', v);
end $$;


-- --- 12.3 El barrido: lease de 10 minutos y cierre --------------------------

select pruebas_rls.registrar('12. alertas medicación',
       'Reclamar toma las dos alertas debidas y devuelve los datos del texto',
       'Rosa/Metformina de prueba/4, Rosa/Sin stock de prueba/0',
       coalesce((select string_agg(split_part(nombre_perfil, ' ', 1) || '/' ||
                                   nombre || '/' || dias_restantes, ', ' order by nombre)
                   from public.reclamar_alertas_medicacion(10)),
                '(cola vacía)'));

select pruebas_rls.registrar('12. alertas medicación',
       'Reclamar dejó la alerta en enviando (lease tomado, no enviado)',
       'enviando dias=4', pruebas_rls.alerta('d0000000-0000-4000-8000-00000000d001'));

select pruebas_rls.registrar('12. alertas medicación',
       'Un segundo barrido inmediato NO se lleva la misma alerta (lease vivo)',
       '0', (select count(*)::text from public.reclamar_alertas_medicacion(10)));

select pruebas_rls.registrar('12. alertas medicación',
       'Cerrar la alerta la marca como enviada', 'true',
       public.cerrar_alerta_medicacion(
           (select id from public.medication_renewal_alerts
             where medication_id = 'd0000000-0000-4000-8000-00000000d001'),
           1, 0)::text);

select pruebas_rls.registrar('12. alertas medicación',
       'Cerrarla de nuevo no pisa nada y devuelve false (idempotente)', 'false',
       public.cerrar_alerta_medicacion(
           (select id from public.medication_renewal_alerts
             where medication_id = 'd0000000-0000-4000-8000-00000000d001'),
           99, 99)::text);

select pruebas_rls.registrar('12. alertas medicación',
       'La alerta cerrada guarda el resumen de entregas',
       'enviado entregas=1 fallos=0 con-sent-at',
       coalesce((select format('%s entregas=%s fallos=%s %s', estado, entregas, fallos,
                               case when sent_at is not null then 'con-sent-at'
                                    else 'SIN sent_at' end)
                   from public.medication_renewal_alerts
                  where medication_id = 'd0000000-0000-4000-8000-00000000d001'),
                '(sin alerta)'));


-- --- 12.4 Reponer el stock caduca la alerta que no salió --------------------
-- Mandar "conviene renovar la receta" un rato después de que alguien cargó la
-- caja nueva es la clase de aviso que enseña a ignorar los avisos.

-- 12 ÷ 3 tomas por día = 4 días → se encola.
update public.medications set stock_units = 12
 where id = 'd0000000-0000-4000-8000-00000000d002';
select public.generar_alertas_medicacion();

select pruebas_rls.registrar('12. alertas medicación',
       'La medicación que baja a 4 días entra en la cola',
       'pendiente dias=4', pruebas_rls.alerta('d0000000-0000-4000-8000-00000000d002'));

-- Alguien carga la caja nueva antes de que el barrido pase.
update public.medications set stock_units = 60
 where id = 'd0000000-0000-4000-8000-00000000d002';

select pruebas_rls.registrar('12. alertas medicación',
       'Reponer el stock deja la alerta pendiente como omitida, no la manda',
       'omitido dias=4',
       (select pruebas_rls.alerta('d0000000-0000-4000-8000-00000000d002')
          from (select public.generar_alertas_medicacion()) as _));

select pruebas_rls.registrar('12. alertas medicación',
       'Y el barrido ya no la reclama', '0',
       (select count(*)::text from public.reclamar_alertas_medicacion(10)));

-- La ventana de 48hs cuenta TAMBIÉN las omitidas: reponer y volver a bajar el
-- stock el mismo día no puede disparar dos avisos seguidos.
update public.medications set stock_units = 12
 where id = 'd0000000-0000-4000-8000-00000000d002';

select pruebas_rls.registrar('12. alertas medicación',
       'Volver a bajar el stock enseguida no reabre el aviso (las omitidas cuentan para las 48hs)',
       '0', public.generar_alertas_medicacion()::text);


-- --- 12.5 Quién lee la tabla ------------------------------------------------
-- A diferencia de `appointment_reminders`, acá hay una política de SELECT: los
-- administradores del perfil (los mismos que reciben el push) ven sus alertas.

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.medication_renewal_alerts;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('12. alertas medicación',
        'A (can_manage sobre el perfil) lee las alertas de sus medicaciones',
        '3 filas', v);
end $$;

-- Escribir NO: no hay política de INSERT/UPDATE/DELETE, y `authenticated` solo
-- tiene el privilegio SELECT. Una sesión que pudiera borrar sus alertas
-- desarmaría la antiduplicación y podría hacerse mandar el mismo aviso en loop.
do $$
declare v text; c integer;
begin
    begin
        delete from public.medication_renewal_alerts;
        get diagnostics c = row_count;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('12. alertas medicación',
        'A no puede BORRAR sus alertas (desarmaría la antiduplicación)',
        'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.medication_renewal_alerts (medication_id, profile_id, dias_restantes)
        values ('d0000000-0000-4000-8000-00000000d002',
                'f0000000-0000-4000-8000-00000000f001', 0);
        v := 'insertada';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('12. alertas medicación',
        'A no puede INSERTAR una alerta a mano', 'denegado (42501)', v);
end $$;

commit;

-- B tiene can_view + can_upload sobre el mismo perfil desde el BLOQUE 11, pero
-- NO can_manage. Es la regla de docs/modelo-permisos.md §4.3 aplicada a la
-- tabla: quien no recibe el aviso tampoco ve la fila que lo generó.
begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.medication_renewal_alerts;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('12. alertas medicación',
        'B (can_view + can_upload, sin can_manage) NO ve ninguna alerta',
        '0 filas', v);
end $$;

commit;


-- --- 12.6 La superficie de la infraestructura -------------------------------

-- RLS no protege de un TRUNCATE: vaciar la tabla desarmaría la antiduplicación
-- de toda la base. Lo que lo frena es el `revoke all ... from anon,
-- authenticated` de la migración, y esto lo prueba con los dientes afuera.
begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        truncate table public.medication_renewal_alerts;
        v := 'truncada';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('12. alertas medicación',
        'TRUNCATE de la tabla de alertas (RLS no lo cubre)', 'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.generar_alertas_medicacion();
        v := 'ejecutado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('12. alertas medicación',
        'A ejecuta generar_alertas_medicacion() (barre toda la base)',
        'denegado (42501)', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.reclamar_alertas_medicacion(5);
        v := 'ejecutado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('12. alertas medicación',
        'A ejecuta reclamar_alertas_medicacion() (podría mandar avisos ajenos)',
        'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.disparar_alertas_medicacion();
        v := 'ejecutado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('12. alertas medicación',
        'A ejecuta disparar_alertas_medicacion()', 'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.configurar_cron_alertas_medicacion('http://atacante.example');
        v := 'ejecutado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('12. alertas medicación',
        'A ejecuta configurar_cron_alertas_medicacion() (escribe el Vault)',
        'denegado (42501)', v);
end $$;

commit;

begin;
select set_config('request.jwt.claims', '', true);
set local role anon;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.medication_renewal_alerts;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('12. alertas medicación',
        'anon lee medication_renewal_alerts', 'denegado (42501)', v);
end $$;

commit;

select pruebas_rls.registrar('12. alertas medicación',
       'Privilegios de anon sobre la tabla de alertas', '0', count(*)::text)
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name = 'medication_renewal_alerts'
   and grantee = 'anon';

-- `authenticated` tiene SELECT y nada más: la política de lectura sin el
-- privilegio de escritura. Si acá apareciera INSERT/UPDATE/DELETE, la ausencia
-- de políticas de escritura sería lo único que separa a una sesión de la cola.
select pruebas_rls.registrar('12. alertas medicación',
       'authenticated tiene SOLO SELECT sobre la tabla de alertas', 'SELECT',
       coalesce((select string_agg(distinct privilege_type, ', ' order by privilege_type)
                   from information_schema.role_table_grants
                  where table_schema = 'public'
                    and table_name = 'medication_renewal_alerts'
                    and grantee = 'authenticated'),
                '(ninguno)'));

select pruebas_rls.registrar('12. alertas medicación',
       'Funciones del job ejecutables por anon o authenticated', '0', count(*)::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('generar_alertas_medicacion', 'reclamar_alertas_medicacion',
                     'cerrar_alerta_medicacion', 'configurar_cron_alertas_medicacion',
                     'disparar_alertas_medicacion')
   and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'));

select pruebas_rls.registrar('12. alertas medicación',
       'medication_renewal_alerts tiene RLS habilitada', 'true',
       coalesce((select rowsecurity::text from pg_tables
                  where schemaname = 'public' and tablename = 'medication_renewal_alerts'),
                '(la tabla no existe)'));

select pruebas_rls.registrar('12. alertas medicación',
       'El job de alertas está programado dos veces por día en pg_cron',
       '10 12,21 * * *',
       coalesce((select schedule from cron.job where jobname = 'alertas-medicacion'),
                '(el job no existe)'));


-- =============================================================================
-- BLOQUE 13 — ficha SOS: quién la lee, quién la edita y qué valida la base
-- -----------------------------------------------------------------------------
-- Tarea 8.2 (docs/modelo-sos.md). Los datos SOS son OCHO COLUMNAS de
-- `profiles`, no una tabla: no tienen políticas propias y heredan literalmente
-- las de la fila. Eso es exactamente lo que hay que demostrar acá, porque es
-- fácil suponer que "los datos vitales" tienen alguna regla especial y no la
-- tienen: se rigen por `profiles_select_visible` (leer) y
-- `profiles_update_administrador` (escribir).
--
-- Lo que ya estaba cubierto y NO se repite:
--   * BLOQUE 1  — 'B lee la fila de profiles de A' → 0 filas (sin permiso).
--   * BLOQUE 2  — 'B lee la ficha SOS de A (perfil visible)' → 1 fila.
--   * BLOQUE 2  — 'B EDITA el perfil de A (incluida la ficha SOS)' → 0 filas,
--                 pero tocando `full_name`, NO una columna SOS.
--
-- Lo que faltaba y agrega este bloque: que el intento de UPDATE de un
-- `can_view` sobre las COLUMNAS SOS concretas también dé cero filas, el caso
-- positivo del `can_manage` sobre esas mismas columnas, el ida y vuelta de un
-- texto con tildes y ñ, el alcance exacto del trigger `set_sos_updated_at` y
-- el CHECK `profiles_blood_type_valido` con los dientes afuera.
--
-- Escenario heredado (no se crea nada nuevo): Rosa Medina (:p_g3) es un perfil
-- GESTIONADO -el caso "Roberto" del roadmap-; María (:p_a) la administra
-- (can_manage) y Diego (:p_b) la mira (can_view + can_upload, sin can_manage)
-- desde los BLOQUES 11 y 12.
-- =============================================================================
\echo ''
\echo '### BLOQUE 13 — ficha SOS: lectura, edición y validación del grupo sanguíneo'

-- Renderizador legible de la ficha, mismo criterio que pruebas_rls.med(): sin
-- SECURITY DEFINER, así que corre con los privilegios de quien la llama y RLS
-- la filtra igual que a un SELECT directo.
create function pruebas_rls.sos(p_id uuid) returns text
language sql
as $$
    select coalesce(
        (select format('grupo=%s | alergias=%s | crónicas=%s | crítica=%s | contacto=%s (%s, %s) | notas=%s',
                       coalesce(p.blood_type, 'NULL'),
                       coalesce(nullif(array_to_string(p.allergies, ' + '), ''), '(vacío)'),
                       coalesce(nullif(array_to_string(p.chronic_conditions, ' + '), ''), '(vacío)'),
                       coalesce(nullif(array_to_string(p.critical_medication, ' + '), ''), '(vacío)'),
                       coalesce(p.emergency_contact, 'NULL'),
                       coalesce(p.emergency_contact_phone, 'NULL'),
                       coalesce(p.emergency_contact_relationship, 'NULL'),
                       coalesce(p.sos_notes, 'NULL'))
           from public.profiles p
          where p.id = p_id),
        '(sin acceso a la fila)');
$$;

grant execute on function pruebas_rls.sos(uuid) to anon, authenticated;


-- --- 13.1 can_view LEE la ficha SOS entera ----------------------------------

begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

select pruebas_rls.registrar('13. ficha SOS',
       'B (can_view) lee la fila del perfil gestionado', '1 filas', count(*) || ' filas')
  from public.profiles where id = :p_g3;

-- Las ocho columnas, una por una: que la fila sea visible no alcanza si
-- mañana alguien agrega una `column-level privilege` sobre alguna de ellas.
select pruebas_rls.registrar('13. ficha SOS',
       'B (can_view) lee las OCHO columnas SOS  [CRITERIO DE ACEPTACIÓN]',
       'grupo=A- | alergias=(vacío) | crónicas=(vacío) | crítica=(vacío) | contacto=NULL (NULL, NULL) | notas=NULL',
       pruebas_rls.sos(:p_g3));

commit;


-- --- 13.2 can_view NO edita ninguna columna SOS -----------------------------

begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

do $$
declare v integer;
begin
    update public.profiles set blood_type = 'AB+'
     where id = 'f0000000-0000-4000-8000-00000000f001';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('13. ficha SOS',
        'B (can_view) cambia el GRUPO SANGUÍNEO del gestionado', '0 filas', v || ' filas');
end $$;

do $$
declare v integer;
begin
    update public.profiles set allergies = '{"Inventada por Diego"}'
     where id = 'f0000000-0000-4000-8000-00000000f001';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('13. ficha SOS',
        'B (can_view) agrega una ALERGIA al gestionado', '0 filas', v || ' filas');
end $$;

do $$
declare v integer;
begin
    update public.profiles
       set emergency_contact = 'Diego', emergency_contact_phone = '2901000000'
     where id = 'f0000000-0000-4000-8000-00000000f001';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('13. ficha SOS',
        'B (can_view) se pone como CONTACTO DE EMERGENCIA', '0 filas', v || ' filas');
end $$;

do $$
declare v integer;
begin
    update public.profiles set sos_notes = 'Nota puesta por Diego'
     where id = 'f0000000-0000-4000-8000-00000000f001';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('13. ficha SOS',
        'B (can_view + can_upload) escribe las OBSERVACIONES SOS', '0 filas', v || ' filas');
end $$;

-- Y la ficha sigue siendo la que era: ninguno de los cuatro intentos dejó nada.
select pruebas_rls.registrar('13. ficha SOS',
       'La ficha del gestionado quedó intacta tras los intentos de B', 'A-',
       coalesce((select blood_type from public.profiles where id = :p_g3), 'NULL'));

commit;


-- --- 13.3 can_manage SÍ edita, y las tildes vuelven intactas ----------------

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v integer;
begin
    update public.profiles
       set blood_type                     = 'O+',
           allergies                      = '{"Alergia a penicilína, ñoquis","Ácaros"}',
           chronic_conditions             = '{"Hipertensión arterial","Diabetes tipo 2"}',
           critical_medication            = '{"Acenocumarol 4 mg"}',
           emergency_contact              = 'Begoña Muñoz Ibáñez',
           emergency_contact_phone        = '+54 9 2901 612345',
           emergency_contact_relationship = 'sobrina política',
           sos_notes                      = 'Marcapasos desde 2019. ¿Alergia a látex? Prótesis de cadera.'
     where id = 'f0000000-0000-4000-8000-00000000f001';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('13. ficha SOS',
        'A (can_manage) edita la ficha SOS completa del gestionado', '1 filas', v || ' filas');
end $$;

-- El ida y vuelta literal del criterio de aceptación: lo que entró con tildes,
-- ñ y signos de apertura sale idéntico. Si en algún punto de la cadena
-- (cliente, driver, columna, dump) hubiera un latin1 escondido, esto falla.
select pruebas_rls.registrar('13. ficha SOS',
       'Ida y vuelta UTF-8 de la ficha completa  [CRITERIO DE ACEPTACIÓN]',
       'grupo=O+ | alergias=Alergia a penicilína, ñoquis + Ácaros | crónicas=Hipertensión arterial + Diabetes tipo 2 | crítica=Acenocumarol 4 mg | contacto=Begoña Muñoz Ibáñez (+54 9 2901 612345, sobrina política) | notas=Marcapasos desde 2019. ¿Alergia a látex? Prótesis de cadera.',
       pruebas_rls.sos(:p_g3));

-- Una entrada con coma sigue siendo UNA entrada del arreglo: el modelo guarda
-- listas, no un texto con comas que alguien parsea después.
select pruebas_rls.registrar('13. ficha SOS',
       'La alergia con coma quedó como UN solo elemento del text[]', '2',
       coalesce((select cardinality(allergies)::text from public.profiles where id = :p_g3), 'NULL'));

commit;


-- --- 13.4 El trigger set_sos_updated_at, y su límite exacto -----------------

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

-- Se movió con la edición de 13.3 (que ocurrió en OTRA transacción, así que
-- now() es distinto del de la creación del perfil en el BLOQUE 11).
select pruebas_rls.registrar('13. ficha SOS',
       'sos_updated_at se movió al editar la ficha (trigger)', 'sí',
       coalesce((select case when sos_updated_at > created_at then 'sí' else 'no' end
                   from public.profiles where id = :p_g3), '(sin fila)'));

commit;

-- Editar un campo NO-SOS del perfil no debe tocar la marca de frescura: es el
-- motivo entero de que `sos_updated_at` exista y no se use `updated_at`. Si
-- esto fallara, la ficha diría "datos vitales revisados hoy" porque alguien
-- corrigió un nombre mal escrito.
begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare antes timestamptz; despues timestamptz; n integer;
begin
    select sos_updated_at into antes from public.profiles
     where id = 'f0000000-0000-4000-8000-00000000f001';

    update public.profiles set full_name = 'Rosa Medina Ñandú'
     where id = 'f0000000-0000-4000-8000-00000000f001';
    get diagnostics n = row_count;

    select sos_updated_at into despues from public.profiles
     where id = 'f0000000-0000-4000-8000-00000000f001';

    perform pruebas_rls.registrar('13. ficha SOS',
        'Editar full_name NO mueve sos_updated_at (alcance del trigger)',
        '1 filas, no cambió',
        n || ' filas, ' || case when antes is not distinct from despues
                                then 'no cambió' else 'cambió' end);
end $$;

commit;


-- --- 13.5 profiles_blood_type_valido, con los dientes afuera ----------------

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

-- Un grupo inválido NO llega nunca acá: lo frena antes el schema Zod
-- (lib/validacion/sos.schema.ts). Esto prueba la SEGUNDA barrera, la que
-- queda si alguien escribe por fuera de la aplicación.
do $$
declare v text;
begin
    begin
        update public.profiles set blood_type = 'Z+'
         where id = 'f0000000-0000-4000-8000-00000000f001';
        v := 'aceptado';
    exception when check_violation then v := 'rechazado (23514)';
             when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('13. ficha SOS',
        'UPDATE crudo con grupo sanguíneo inválido  [CRITERIO DE ACEPTACIÓN]',
        'rechazado (23514)', v);
end $$;

-- Las variantes que "casi" parecen válidas y que un desplegable mal armado
-- podría mandar.
do $$
declare v text; malo text;
begin
    v := '';
    foreach malo in array array['a+', 'AB', '0+', 'A positivo', 'O ', '']
    loop
        begin
            update public.profiles set blood_type = malo
             where id = 'f0000000-0000-4000-8000-00000000f001';
            v := v || coalesce(nullif(malo, ''), '(vacío)') || '=aceptado ';
        exception when check_violation then null;
                  when others          then v := v || malo || '=error' || sqlstate || ' ';
        end;
    end loop;
    perform pruebas_rls.registrar('13. ficha SOS',
        'Variantes casi-válidas del grupo sanguíneo aceptadas por el CHECK',
        '(ninguna)', coalesce(nullif(btrim(v), ''), '(ninguna)'));
end $$;

-- Y los ocho válidos entran todos: un CHECK demasiado estrecho sería un bug
-- igual de real que uno demasiado laxo.
do $$
declare v text; bueno text; aceptados integer := 0;
begin
    foreach bueno in array array['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
    loop
        begin
            update public.profiles set blood_type = bueno
             where id = 'f0000000-0000-4000-8000-00000000f001';
            aceptados := aceptados + 1;
        exception when others then null;
        end;
    end loop;
    perform pruebas_rls.registrar('13. ficha SOS',
        'Los 8 grupos sanguíneos del CHECK se aceptan', '8', aceptados::text);
end $$;

-- NULL es un valor legítimo: "no lo sé" es información, no un campo sin llenar.
do $$
declare v text;
begin
    begin
        update public.profiles set blood_type = null
         where id = 'f0000000-0000-4000-8000-00000000f001';
        v := 'aceptado';
    exception when others then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('13. ficha SOS',
        'blood_type NULL ("No lo sé") es válido', 'aceptado', v);
end $$;

commit;


-- --- 13.6 Revocado: deja de ver la ficha en el acto -------------------------
-- La segunda mitad del criterio de aceptación del roadmap: "el familiar con
-- can_view los ve y el revocado no". Se borra la fila de permiso de Diego
-- sobre el perfil gestionado -es el último bloque, así que no afecta a nadie
-- más- y se vuelve a preguntar sin tocar ninguna sesión.

delete from public.family_permissions
 where owner_profile_id = :p_g3 and granted_profile_id = :p_b;

begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

select pruebas_rls.registrar('13. ficha SOS',
       'B REVOCADO ya no lee la fila del gestionado  [CRITERIO DE ACEPTACIÓN]',
       '0 filas', count(*) || ' filas')
  from public.profiles where id = :p_g3;

select pruebas_rls.registrar('13. ficha SOS',
       'B REVOCADO no alcanza la ficha SOS ni por la función auxiliar',
       '(sin acceso a la fila)', pruebas_rls.sos(:p_g3));

commit;

-- El visitante sin sesión ya está cubierto por el BLOQUE 6 ('anon lee
-- profiles' → denegado 42501) y no se repite acá: `anon` ni siquiera tiene el
-- privilegio de SELECT sobre `profiles`, así que no llega a la instancia en la
-- que RLS filtraría filas. Es una barrera anterior, no una más estricta.


-- =============================================================================
-- BLOQUE 14 — umbrales clínicos y alertas de signos vitales (tarea 9.2)
-- -----------------------------------------------------------------------------
-- `20260814080000_signos_umbrales.sql`. El MOTOR de evaluación es TypeScript
-- puro y lo cubre `tests/unit/umbrales.test.ts` (43 casos: normal, borde exacto
-- 160/100, por encima, glucemia baja y alta, ventana de peso). Este bloque
-- cubre exactamente lo que ningún test de TypeScript puede ejercitar:
--
--   · **Los CHECK de coherencia** de las dos tablas, con los dientes afuera:
--     un umbral invertido, una alerta cuyo `tipo` contradice su `regla`, y —el
--     más importante— un mensaje SIN el descargo clínico, que el ROADMAP exige
--     ("los umbrales son orientativos, no diagnóstico: el texto debe decirlo")
--     y que acá es una constraint, no una convención.
--   · **Los dos triggers de sellado**: `profile_id` derivado de la medición
--     (es la columna que decide qué familia ve la alerta) y el par
--     `acknowledged_at`/`acknowledged_by`, que la 9.3 va a escribir con
--     `marcarAlertaVista`.
--   · **La superficie expuesta**, en las dos direcciones: `can_manage` lee y
--     marca vista, `can_upload` no ve ni marca, `anon` nada, TRUNCATE denegado,
--     y —la decisión de diseño de esta tarea— que NADIE pueda insertar una
--     alerta desde el cliente, ni siquiera quien tiene permiso para cargar la
--     medición que la produciría.
--
-- Las mediciones se insertan CALCADAS de `registrarSigno`
-- (`app/(app)/(con-nav)/signos/actions.ts`) y las alertas calcadas de lo que
-- `lib/signos/registrar-alertas.ts` persiste para esos valores con los umbrales
-- por defecto. Si el motor cambiara de opinión sobre alguno de estos casos, el
-- que se pone en rojo es `tests/unit/umbrales.test.ts`; acá se verifica que la
-- base acepte —y solo acepte— la forma correcta de esas filas.
--
-- Escenario: Rosa Medina (:p_g3), el perfil gestionado de los BLOQUES 11 a 13.
-- María (:p_a) tiene can_manage. A Diego (:p_b) el BLOQUE 13.6 le revocó el
-- permiso, así que se lo vuelve a otorgar con can_view + can_upload y SIN
-- can_manage: es exactamente el rol que tiene que ver la medición y no la
-- alerta.
-- =============================================================================
\echo ''
\echo '### BLOQUE 14 — umbrales clínicos y alertas de signos vitales'

-- Diego vuelve a ser el que carga: ve y sube, no administra.
insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage)
values (:p_g3, :p_b, true, true, false);

-- Renderizadores legibles. Sin SECURITY DEFINER: corren con los privilegios de
-- quien los llama, así que RLS los filtra igual que a un SELECT directo.
create function pruebas_rls.umbrales(p_perfil uuid) returns text
language sql
as $$
    select coalesce(
        (select format('sistolica=%s diastolica=%s glucemia=%s/%s peso=%s kg en %s dias',
                       trim_scale(sistolica_max::numeric),
                       trim_scale(diastolica_max::numeric),
                       trim_scale(glucemia_min),
                       trim_scale(glucemia_max),
                       trim_scale(peso_variacion_kg),
                       peso_ventana_dias)
           from public.vital_sign_thresholds
          where profile_id = p_perfil),
        '(sin fila: rigen los defaults globales)');
$$;

create function pruebas_rls.alertas_signo(p_signo uuid) returns text
language sql
as $$
    select coalesce(
        (select string_agg(format('%s %s/%s', a.regla,
                                  trim_scale(a.valor), trim_scale(a.umbral)),
                           ', ' order by a.regla)
           from public.vital_sign_alerts a
          where a.vital_sign_id = p_signo),
        '(sin alerta)');
$$;

create function pruebas_rls.visto(p_alerta uuid) returns text
language sql
as $$
    select coalesce(
        (select case
                    when a.acknowledged_at is null then 'sin ver'
                    else format('vista por %s, %s', coalesce(p.full_name, '(perfil borrado)'),
                                case when a.acknowledged_at > now() - interval '1 minute'
                                     then 'con la hora del servidor'
                                     else 'con la hora que mandó el cliente' end)
                end
           from public.vital_sign_alerts a
           left join public.profiles p on p.id = a.acknowledged_by
          where a.id = p_alerta),
        '(no existe)');
$$;

grant execute on function pruebas_rls.umbrales(uuid)      to anon, authenticated;
grant execute on function pruebas_rls.alertas_signo(uuid) to anon, authenticated;

-- Las mediciones. Calcadas del INSERT de `registrarSigno`: perfil activo, tipo
-- del enum, columnas por tipo y `measured_at` explícito.
insert into public.vital_signs (id, profile_id, type, systolic, diastolic, pulse, value, measured_at)
values
    ('a1000000-0000-4000-8000-00000000a001', :p_g3, 'blood_pressure', 170, 110, 88, null, now() - interval '5 hours'),
    ('a1000000-0000-4000-8000-00000000a002', :p_g3, 'blood_pressure', 160, 100, 84, null, now() - interval '4 hours'),
    ('a1000000-0000-4000-8000-00000000a003', :p_g3, 'blood_pressure', 150,  95, 78, null, now() - interval '3 hours'),
    ('a1000000-0000-4000-8000-00000000a004', :p_g3, 'glucose', null, null, null,  65, now() - interval '2 hours'),
    ('a1000000-0000-4000-8000-00000000a005', :p_g3, 'glucose', null, null, null, 260, now() - interval '1 hour'),
    ('a1000000-0000-4000-8000-00000000a006', :p_g3, 'weight',  null, null, null,  80, now() - interval '3 days'),
    ('a1000000-0000-4000-8000-00000000a007', :p_g3, 'weight',  null, null, null,  83, now() - interval '10 minutes');


-- --- 14.1 Los umbrales: sin fila rigen los defaults -------------------------

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'Un perfil sin fila de umbrales no tiene una fila vacía: no tiene fila',
       '(sin fila: rigen los defaults globales)', pruebas_rls.umbrales(:p_g3));

-- Un INSERT que solo trae el perfil completa las seis columnas con los DEFAULT
-- de la tabla, que son los mismos números que `UMBRALES_POR_DEFECTO` de
-- `lib/signos/umbrales.ts`. Los valores viven en dos lenguajes por necesidad y
-- ESTE es el caso que impide que diverjan.
insert into public.vital_sign_thresholds (profile_id) values (:p_g3);

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'Los DEFAULT de la tabla son los de UMBRALES_POR_DEFECTO (lib/signos/umbrales.ts)',
       'sistolica=160 diastolica=100 glucemia=70/250 peso=2 kg en 7 dias',
       pruebas_rls.umbrales(:p_g3));

-- Los CHECK de coherencia, uno por uno.
do $$
declare v text; caso record;
begin
    for caso in
        select * from (values
            ('sistolica_max menor que diastolica_max', 'sistolica_max = 90, diastolica_max = 100'),
            ('glucemia_min mayor que glucemia_max',    'glucemia_min = 300, glucemia_max = 250'),
            ('umbral de sistólica que alertaría siempre', 'sistolica_max = 80'),
            ('variación de peso de 0 kg',              'peso_variacion_kg = 0'),
            ('ventana de peso de 0 días',              'peso_ventana_dias = 0')
        ) as t(descripcion, asignacion)
    loop
        begin
            execute format('update public.vital_sign_thresholds set %s where profile_id = %L',
                           caso.asignacion, 'f0000000-0000-4000-8000-00000000f001');
            v := 'aceptado';
        exception when check_violation then v := 'rechazado (23514)';
                  when others          then v := 'error ' || sqlstate;
        end;
        perform pruebas_rls.registrar('14. umbrales y alertas de signos',
            'CHECK de coherencia: ' || caso.descripcion, 'rechazado (23514)', v);
    end loop;
end $$;

-- Un perfil no puede tener dos configuraciones de umbrales: `profile_id` es la
-- clave primaria, no una columna más.
do $$
declare v text;
begin
    begin
        insert into public.vital_sign_thresholds (profile_id)
        values ('f0000000-0000-4000-8000-00000000f001');
        v := 'insertada';
    exception when unique_violation then v := 'rechazado (23505)';
              when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'Una segunda fila de umbrales para el mismo perfil', 'rechazado (23505)', v);
end $$;

-- Un override real: el médico de Rosa acepta hasta 150/95 y quiere la alerta
-- de peso más temprano.
update public.vital_sign_thresholds
   set sistolica_max = 150, diastolica_max = 95, peso_variacion_kg = 1.5
 where profile_id = :p_g3;

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'El override por perfil convive con los defaults en las columnas que no toca',
       'sistolica=150 diastolica=95 glucemia=70/250 peso=1.5 kg en 7 dias',
       pruebas_rls.umbrales(:p_g3));

-- Se vuelve a los defaults para que las alertas de §14.2 se lean contra
-- 160/100 y 2 kg, que son los números del criterio de aceptación.
delete from public.vital_sign_thresholds where profile_id = :p_g3;


-- --- 14.2 Quién lee y quién edita los umbrales ------------------------------

insert into public.vital_sign_thresholds (profile_id, sistolica_max) values (:p_g3, 155);

begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

-- `can_view` LEE los umbrales: quien carga mediciones necesita saber contra qué
-- se están comparando (docs/modelo-permisos.md §6.1, lectura monótona).
select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'B (can_view + can_upload) LEE los umbrales del perfil',
       'sistolica=155 diastolica=100 glucemia=70/250 peso=2 kg en 7 dias',
       pruebas_rls.umbrales(:p_g3));

-- Pero NO los edita: cambiar el umbral de alerta de una persona mayor es una
-- decisión clínica del administrador, no "cargar el dato del día".
do $$
declare v text; c integer;
begin
    begin
        update public.vital_sign_thresholds set sistolica_max = 200
         where profile_id = 'f0000000-0000-4000-8000-00000000f001';
        get diagnostics c = row_count;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
              when others                 then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'B (can_upload, sin can_manage) NO edita los umbrales  [CRITERIO DE ACEPTACIÓN]',
        '0 filas', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.vital_sign_thresholds (profile_id)
        values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
        v := 'insertada';
    exception when insufficient_privilege then v := 'denegado (42501)';
              when others                 then v := 'error ' || sqlstate;
    end;
    -- Un INSERT que no pasa el WITH CHECK de la política levanta 42501 ("new
    -- row violates row-level security policy"), no devuelve 0 filas: no hay
    -- fila que filtrar, hay una fila que la base se niega a escribir.
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'B tampoco crea umbrales donde no los había', 'denegado (42501)', v);
end $$;

commit;

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text; c integer;
begin
    begin
        update public.vital_sign_thresholds set sistolica_max = 150
         where profile_id = 'f0000000-0000-4000-8000-00000000f001';
        get diagnostics c = row_count;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
              when others                 then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'A (can_manage) SÍ edita los umbrales  [CRITERIO DE ACEPTACIÓN]', '1 filas', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        delete from public.vital_sign_thresholds
         where profile_id = 'f0000000-0000-4000-8000-00000000f001';
        get diagnostics c = row_count;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
              when others                 then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'A borra los umbrales del perfil (vuelve a los defaults globales)', '1 filas', v);
end $$;

commit;


-- --- 14.3 Las alertas que deja cada carga -----------------------------------
-- Filas calcadas de lo que persiste `lib/signos/registrar-alertas.ts`.

insert into public.vital_sign_alerts (vital_sign_id, profile_id, tipo, regla, valor, umbral, referencia, mensaje)
values
    -- 170/110: por encima de los dos umbrales.
    ('a1000000-0000-4000-8000-00000000a001', :p_g3, 'blood_pressure', 'sistolica_alta',  170, 160, null,
     'Presión sistólica alta: 170 mmHg (umbral de alerta: 160). Valor orientativo — no reemplaza el criterio médico.'),
    ('a1000000-0000-4000-8000-00000000a001', :p_g3, 'blood_pressure', 'diastolica_alta', 110, 100, null,
     'Presión diastólica alta: 110 mmHg (umbral de alerta: 100). Valor orientativo — no reemplaza el criterio médico.'),
    -- 160/100 EXACTO: el 16/10 del ROADMAP. El umbral es inclusivo (≥), así que
    -- deja las mismas dos alertas que 170/110.
    ('a1000000-0000-4000-8000-00000000a002', :p_g3, 'blood_pressure', 'sistolica_alta',  160, 160, null,
     'Presión sistólica alta: 160 mmHg (umbral de alerta: 160). Valor orientativo — no reemplaza el criterio médico.'),
    ('a1000000-0000-4000-8000-00000000a002', :p_g3, 'blood_pressure', 'diastolica_alta', 100, 100, null,
     'Presión diastólica alta: 100 mmHg (umbral de alerta: 100). Valor orientativo — no reemplaza el criterio médico.'),
    -- Glucemia por debajo y por encima.
    ('a1000000-0000-4000-8000-00000000a004', :p_g3, 'glucose', 'glucemia_baja',  65,  70, null,
     'Glucemia baja: 65 mg/dL (umbral de alerta: 70). Valor orientativo — no reemplaza el criterio médico.'),
    ('a1000000-0000-4000-8000-00000000a005', :p_g3, 'glucose', 'glucemia_alta', 260, 250, null,
     'Glucemia alta: 260 mg/dL (umbral de alerta: 250). Valor orientativo — no reemplaza el criterio médico.'),
    -- Peso: 83 kg contra una referencia de 80 kg en la ventana de 7 días.
    ('a1000000-0000-4000-8000-00000000a007', :p_g3, 'weight', 'peso_variacion', 83, 2, 80,
     'Peso 83 kg: 3 kg más que la referencia de los últimos 7 días (80 kg; umbral de alerta: 2 kg). Valor orientativo — no reemplaza el criterio médico.');

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'Una carga de 170/110 deja las DOS alertas con su valor y su umbral  [CRITERIO DE ACEPTACIÓN]',
       'sistolica_alta 170/160, diastolica_alta 110/100',
       pruebas_rls.alertas_signo('a1000000-0000-4000-8000-00000000a001'));

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       '160/100 EXACTO deja las mismas dos alertas: el umbral es INCLUSIVO  [CRITERIO DE ACEPTACIÓN]',
       'sistolica_alta 160/160, diastolica_alta 100/100',
       pruebas_rls.alertas_signo('a1000000-0000-4000-8000-00000000a002'));

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'Una carga de 150/95 no deja ninguna alerta  [CRITERIO DE ACEPTACIÓN]',
       '(sin alerta)', pruebas_rls.alertas_signo('a1000000-0000-4000-8000-00000000a003'));

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'Glucemia 65 deja una alerta de hipoglucemia', 'glucemia_baja 65/70',
       pruebas_rls.alertas_signo('a1000000-0000-4000-8000-00000000a004'));

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'Glucemia 260 deja una alerta de hiperglucemia', 'glucemia_alta 260/250',
       pruebas_rls.alertas_signo('a1000000-0000-4000-8000-00000000a005'));

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'Un salto de peso deja la alerta con la referencia contra la que se comparó',
       'peso_variacion 83/2 ref=80',
       coalesce((select format('%s %s/%s ref=%s', regla, trim_scale(valor),
                               trim_scale(umbral), trim_scale(referencia))
                   from public.vital_sign_alerts
                  where vital_sign_id = 'a1000000-0000-4000-8000-00000000a007'),
                '(sin alerta)'));

-- Antidup: la evaluación de una medición es determinista, así que la misma
-- regla sobre la misma medición es siempre la misma alerta. Reevaluar (un doble
-- submit, una corrida de reparación) no puede duplicarla.
do $$
declare v text;
begin
    begin
        insert into public.vital_sign_alerts (vital_sign_id, profile_id, tipo, regla, valor, umbral, mensaje)
        values ('a1000000-0000-4000-8000-00000000a001', 'f0000000-0000-4000-8000-00000000f001',
                'blood_pressure', 'sistolica_alta', 170, 160,
                'Presión sistólica alta: 170 mmHg (umbral de alerta: 160). Valor orientativo — no reemplaza el criterio médico.');
        v := 'insertada';
    exception when unique_violation then v := 'rechazado (23505)';
              when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'La misma regla sobre la misma medición no se duplica (antidup)',
        'rechazado (23505)', v);
end $$;


-- --- 14.4 Los CHECK de la alerta, con los dientes afuera --------------------

-- EL DESCARGO ES UNA CONSTRAINT. Es el ROADMAP hecho base: "los umbrales son
-- orientativos, no diagnóstico: el texto debe decirlo". Un refactor de copy que
-- se lo olvide no puede persistir la alerta.
do $$
declare v text;
begin
    begin
        insert into public.vital_sign_alerts (vital_sign_id, profile_id, tipo, regla, valor, umbral, mensaje)
        values ('a1000000-0000-4000-8000-00000000a003', 'f0000000-0000-4000-8000-00000000f001',
                'blood_pressure', 'sistolica_alta', 150, 160,
                'Presión sistólica alta: 150 mmHg. Consultá al médico.');
        v := 'insertada';
    exception when check_violation then v := 'rechazado (23514)';
              when others          then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'Una alerta SIN el descargo clínico no se puede guardar  [CRITERIO DE ACEPTACIÓN]',
        'rechazado (23514)', v);
end $$;

do $$
declare v text; caso record;
begin
    for caso in
        select * from (values
            ('el tipo contradice la regla (glucemia con regla de tensión)',
             $q$'a1000000-0000-4000-8000-00000000a003', 'f0000000-0000-4000-8000-00000000f001', 'glucose', 'sistolica_alta', 150, 160, null$q$),
            ('una regla que no es de peso trae referencia',
             $q$'a1000000-0000-4000-8000-00000000a003', 'f0000000-0000-4000-8000-00000000f001', 'blood_pressure', 'sistolica_alta', 150, 160, 80$q$),
            ('la regla de peso viene SIN referencia',
             $q$'a1000000-0000-4000-8000-00000000a006', 'f0000000-0000-4000-8000-00000000f001', 'weight', 'peso_variacion', 80, 2, null$q$),
            ('el umbral aplicado es 0',
             $q$'a1000000-0000-4000-8000-00000000a003', 'f0000000-0000-4000-8000-00000000f001', 'blood_pressure', 'sistolica_alta', 150, 0, null$q$)
        ) as t(descripcion, valores)
    loop
        begin
            execute format(
                'insert into public.vital_sign_alerts (vital_sign_id, profile_id, tipo, regla, valor, umbral, referencia, mensaje) values (%s, %L)',
                caso.valores,
                'Texto de prueba. Valor orientativo — no reemplaza el criterio médico.');
            v := 'aceptada';
        exception when check_violation then v := 'rechazado (23514)';
                  when others          then v := 'error ' || sqlstate;
        end;
        perform pruebas_rls.registrar('14. umbrales y alertas de signos',
            'CHECK de coherencia: ' || caso.descripcion, 'rechazado (23514)', v);
    end loop;
end $$;

-- Una alerta que no cuelga de ninguna medición no tiene de quién ser: el
-- trigger de sellado no encuentra el perfil y aborta con el mismo código que
-- una FK rota.
do $$
declare v text;
begin
    begin
        insert into public.vital_sign_alerts (vital_sign_id, profile_id, tipo, regla, valor, umbral, mensaje)
        values ('a1000000-0000-4000-8000-0000000000ff', 'f0000000-0000-4000-8000-00000000f001',
                'blood_pressure', 'sistolica_alta', 170, 160,
                'Texto de prueba. Valor orientativo — no reemplaza el criterio médico.');
        v := 'insertada';
    exception when foreign_key_violation then v := 'rechazado (23503)';
              when others                then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'Una alerta de una medición inexistente', 'rechazado (23503)', v);
end $$;

-- EL SELLADO DEL PERFIL. `profile_id` decide qué familia ve la alerta: no puede
-- depender de que quien escribe la mande bien. Se inserta a nombre de OTRO
-- perfil y la base la corrige sola.
insert into public.vital_sign_alerts (vital_sign_id, profile_id, tipo, regla, valor, umbral, mensaje)
values ('a1000000-0000-4000-8000-00000000a003', :p_a, 'blood_pressure', 'diastolica_alta', 95, 90,
        'Texto de prueba. Valor orientativo — no reemplaza el criterio médico.');

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'El trigger sella profile_id desde la medición e ignora el que mandó quien inserta',
       'el perfil de la medición',
       coalesce((select case when a.profile_id = v.profile_id
                             then 'el perfil de la medición'
                             else 'el que mandó el INSERT (' || a.profile_id || ')' end
                   from public.vital_sign_alerts a
                   join public.vital_signs v on v.id = a.vital_sign_id
                  where a.vital_sign_id = 'a1000000-0000-4000-8000-00000000a003'),
                '(sin alerta)'));

delete from public.vital_sign_alerts
 where vital_sign_id = 'a1000000-0000-4000-8000-00000000a003';


-- --- 14.5 Quién ve las alertas y quién las marca vistas ---------------------

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.vital_sign_alerts;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
              when others                 then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'A (can_manage) lee las 7 alertas del perfil que administra', '7 filas', v);
end $$;

-- Escribir una alerta a mano NO: es la decisión de diseño de esta tarea. RLS
-- puede autorizar a un autor pero no puede verificar que la alerta describa de
-- verdad a su medición, y la 9.3 convierte cada fila en un push a la familia.
do $$
declare v text;
begin
    begin
        insert into public.vital_sign_alerts (vital_sign_id, profile_id, tipo, regla, valor, umbral, mensaje)
        values ('a1000000-0000-4000-8000-00000000a003', 'f0000000-0000-4000-8000-00000000f001',
                'blood_pressure', 'sistolica_alta', 300, 160,
                'Presión sistólica alta: 300 mmHg (umbral de alerta: 160). Valor orientativo — no reemplaza el criterio médico.');
        v := 'insertada';
    exception when insufficient_privilege then v := 'denegado (42501)';
              when others                 then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'A NO puede inventar una alerta desde el cliente  [DECISIÓN DE DISEÑO]',
        'denegado (42501)', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        delete from public.vital_sign_alerts;
        get diagnostics c = row_count;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
              when others                 then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'A no puede BORRAR una alerta (el registro clínico no se hace desaparecer)',
        'denegado (42501)', v);
end $$;

-- El alcance del UPDATE no lo fija la política sino el PRIVILEGIO DE COLUMNA:
-- `authenticated` tiene UPDATE (acknowledged_at) y nada más.
do $$
declare v text;
begin
    begin
        update public.vital_sign_alerts set umbral = 999, mensaje = 'Otra cosa.';
        v := 'aceptado';
    exception when insufficient_privilege then v := 'denegado (42501)';
              when others                 then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'A no puede reescribir el umbral ni el texto de una alerta (privilegio de columna)',
        'denegado (42501)', v);
end $$;

-- Marcar vista: lo que la 9.3 va a hacer con `marcarAlertaVista`. El cliente
-- manda una fecha cualquiera y la base la reemplaza por `now()`.
do $$
declare v text; c integer;
begin
    begin
        update public.vital_sign_alerts
           set acknowledged_at = timestamptz '2000-01-01 00:00:00-03'
         where vital_sign_id = 'a1000000-0000-4000-8000-00000000a001'
           and regla = 'sistolica_alta';
        get diagnostics c = row_count;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
              when others                 then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'A marca vista la alerta de 170/110  [CONTRATO DE LA 9.3]', '1 filas', v);
end $$;

commit;

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'El trigger sella el visto con el perfil actor y la hora del servidor  [CONTRATO DE LA 9.3]',
       'vista por María Gómez, con la hora del servidor',
       pruebas_rls.visto((select id from public.vital_sign_alerts
                           where vital_sign_id = 'a1000000-0000-4000-8000-00000000a001'
                             and regla = 'sistolica_alta')));

-- Una vez vista, no se puede "desver": el rastro de quién se hizo cargo no se
-- borra. El UPDATE no falla —para que un `marcarAlertaVista` idempotente no
-- tenga que distinguir el caso— pero no cambia nada.
begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

update public.vital_sign_alerts set acknowledged_at = null
 where vital_sign_id = 'a1000000-0000-4000-8000-00000000a001' and regla = 'sistolica_alta';

commit;

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'Una alerta ya vista no se puede "desver"',
       'vista por María Gómez, con la hora del servidor',
       pruebas_rls.visto((select id from public.vital_sign_alerts
                           where vital_sign_id = 'a1000000-0000-4000-8000-00000000a001'
                             and regla = 'sistolica_alta')));

-- B carga las mediciones pero no administra: no ve las alertas que su propia
-- carga genera, y tampoco puede marcarlas vistas. Es la regla de
-- docs/modelo-permisos.md §4.3 ("los can_view y can_upload no las reciben")
-- llevada a la tabla: quien no recibe el aviso tampoco ve la fila que lo generó.
begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.vital_sign_alerts;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
              when others                 then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'B (can_upload, sin can_manage) NO ve ninguna alerta  [CRITERIO DE ACEPTACIÓN]',
        '0 filas', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        update public.vital_sign_alerts set acknowledged_at = now()
         where vital_sign_id = 'a1000000-0000-4000-8000-00000000a002';
        get diagnostics c = row_count;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
              when others                 then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('14. umbrales y alertas de signos',
        'B tampoco puede marcar vista una alerta que no ve', '0 filas', v);
end $$;

-- Y sigue viendo la MEDICIÓN: `vital_signs` es monótona en lectura. Lo que se
-- minimiza es el escalamiento, no el dato.
select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'B sí ve las mediciones que cargó (lo que no ve es el escalamiento)',
       '7 filas', count(*) || ' filas')
  from public.vital_signs where profile_id = :p_g3;

commit;


-- --- 14.6 La superficie de las dos tablas -----------------------------------

begin;
select set_config('request.jwt.claims', '', true);
set local role anon;

do $$
declare v text; c integer; tabla text;
begin
    foreach tabla in array array['vital_sign_thresholds', 'vital_sign_alerts']
    loop
        begin
            execute format('select count(*) from public.%I', tabla) into c;
            v := c || ' filas';
        exception when insufficient_privilege then v := 'denegado (42501)';
                  when others                 then v := 'error ' || sqlstate;
        end;
        perform pruebas_rls.registrar('14. umbrales y alertas de signos',
            'anon lee ' || tabla, 'denegado (42501)', v);
    end loop;
end $$;

commit;

-- RLS no protege de un TRUNCATE: lo que lo frena es el `revoke all` de la
-- migración. Vaciar `vital_sign_thresholds` borraría los umbrales que un médico
-- ajustó para toda la base.
begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v text; tabla text;
begin
    foreach tabla in array array['vital_sign_thresholds', 'vital_sign_alerts']
    loop
        begin
            execute format('truncate table public.%I cascade', tabla);
            v := 'truncada';
        exception when insufficient_privilege then v := 'denegado (42501)';
                  when others                 then v := 'error ' || sqlstate;
        end;
        perform pruebas_rls.registrar('14. umbrales y alertas de signos',
            'TRUNCATE de ' || tabla || ' (RLS no lo cubre)', 'denegado (42501)', v);
    end loop;
end $$;

commit;

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'Privilegios de anon sobre las dos tablas nuevas', '0', count(*)::text)
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('vital_sign_thresholds', 'vital_sign_alerts')
   and grantee = 'anon';

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'authenticated tiene SOLO SELECT a nivel tabla sobre vital_sign_alerts', 'SELECT',
       coalesce((select string_agg(distinct privilege_type, ', ' order by privilege_type)
                   from information_schema.role_table_grants
                  where table_schema = 'public'
                    and table_name = 'vital_sign_alerts'
                    and grantee = 'authenticated'),
                '(ninguno)'));

-- El UPDATE de la 9.3 existe, pero acotado a UNA columna. Si acá apareciera
-- `mensaje` o `umbral`, la política de fila sería lo único que separa a una
-- sesión de reescribir un registro clínico.
select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'El UPDATE de authenticated sobre vital_sign_alerts llega a una sola columna',
       'acknowledged_at',
       coalesce((select string_agg(distinct column_name, ', ' order by column_name)
                   from information_schema.column_privileges
                  where table_schema = 'public'
                    and table_name = 'vital_sign_alerts'
                    and grantee = 'authenticated'
                    and privilege_type = 'UPDATE'),
                '(ninguna)'));

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'Las dos tablas nuevas tienen RLS habilitada', 'vital_sign_alerts=true, vital_sign_thresholds=true',
       coalesce((select string_agg(tablename || '=' || rowsecurity, ', ' order by tablename)
                   from pg_tables
                  where schemaname = 'public'
                    and tablename in ('vital_sign_thresholds', 'vital_sign_alerts')),
                '(no existen)'));

-- Borrar la medición se lleva sus alertas: una alerta sin medición no tiene
-- referente, y corregir una medición mal cargada es una potestad de can_manage
-- (docs/modelo-permisos.md §4.3).
delete from public.vital_signs where id = 'a1000000-0000-4000-8000-00000000a005';

select pruebas_rls.registrar('14. umbrales y alertas de signos',
       'Borrar la medición se lleva su alerta (ON DELETE CASCADE)',
       '(sin alerta)', pruebas_rls.alertas_signo('a1000000-0000-4000-8000-00000000a005'));


-- =============================================================================
-- 15. FICHAS GENERADAS (consultation_sheets) — Sprint 10, tarea 10.5
-- =============================================================================
-- RLS de historial inmutable de fichas. Una sesión puede:
--   · LEER fichas si tiene puede_ver_perfil.
--   · ESCRIBIR (INSERT) si tiene puede_cargar_en_perfil Y generated_by = actor.
--   · NO puede UPDATE ni DELETE (documento emitido).
--   · anon no puede leer ni escribir.
-- =============================================================================

-- Crear perfiles de prueba nuevos para este bloque (los anteriores fueron
-- borrados en bloques anteriores: BLOQUE 5 borra :p_g, por ejemplo).
-- (fix auditoria 10.5: variables psql reemplazadas por literales, no interpolan dentro de do $$..$$)

-- Pre-limpieza defensiva (fix de auditoría 10.5): una corrida anterior abortada
-- puede haber dejado estas filas y el INSERT de abajo chocaría contra
-- users_pkey, tumbando el resto de la suite. Orden: gestionado primero (el
-- trigger de no orfandad aborta si se van antes las cuentas que lo administran).
delete from public.profiles where id = 'f1500000-0000-4000-8000-00000000f503';
delete from auth.users      where id in ('f1500aaa-1111-4111-8111-111111111111', 'f1500bbb-2222-4222-8222-222222222222');

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('f1500aaa-1111-4111-8111-111111111111', 'usuario15a@test.local', '{}', '{}'),
    ('f1500bbb-2222-4222-8222-222222222222', 'usuario15b@test.local', '{}', '{}');

-- Mismo motivo que en la sección 2 de datos de prueba: el trigger
-- `auth_users_crear_perfil_de_cuenta` (20260814140000) ya les creó un perfil
-- propio con id aleatorio, y este bloque necesita ids fijos.
delete from public.profiles
 where user_id in ('f1500aaa-1111-4111-8111-111111111111', 'f1500bbb-2222-4222-8222-222222222222')
   and id not in ('f1500000-0000-4000-8000-00000000f501', 'f1500000-0000-4000-8000-00000000f502');

insert into public.profiles (id, user_id, full_name, role, blood_type)
values
    ('f1500000-0000-4000-8000-00000000f501', 'f1500aaa-1111-4111-8111-111111111111', 'Perfil Prueba 15A', 'admin', 'A+'),
    ('f1500000-0000-4000-8000-00000000f502', 'f1500bbb-2222-4222-8222-222222222222', 'Perfil Prueba 15B', 'family_member', 'O-');

insert into public.profiles (id, full_name, role, created_by_profile_id, blood_type)
values
    ('f1500000-0000-4000-8000-00000000f503', 'Perfil Gestionado 15C', 'elder', 'f1500000-0000-4000-8000-00000000f501', 'B+');

insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage)
values ('f1500000-0000-4000-8000-00000000f503', 'f1500000-0000-4000-8000-00000000f501', true, true, true);

-- Helper: listar fichas de un perfil (para verificar lecturas).
create function pruebas_rls.fichas_de(p_perfil uuid) returns text
language sql
as $$
    select coalesce(
        (select string_agg(id::text, ', ' order by id)
           from public.consultation_sheets
          where profile_id = p_perfil),
        '(sin fichas)');
$$;

grant execute on function pruebas_rls.fichas_de(uuid) to anon, authenticated;

-- Datos de prueba: fichas generadas por cada actor.
insert into public.consultation_sheets
    (id, profile_id, generated_by_profile_id, content, created_at)
values
    ('b1000000-0000-4000-8000-00000000b001', 'f1500000-0000-4000-8000-00000000f503', 'f1500000-0000-4000-8000-00000000f503', '{"motivoConsulta":{"titulo":"Motivo de consulta sugerido","contenido":"Test"},"antecedentesRelevantes":{"titulo":"Antecedentes relevantes","contenido":"Test"},"medicacionActual":{"titulo":"Medicación actual","contenido":"Test"},"estudiosRecientes":{"titulo":"Estudios recientes","contenido":"Test"},"valoresFueraDeRango":{"titulo":"Valores fuera de rango","contenido":"Test"},"preguntasSugeridas":{"titulo":"Preguntas sugeridas para el médico","preguntas":["P1","P2","P3"]},"aviso":"No sustituye el criterio médico"}'::jsonb, now()),
    ('b1000000-0000-4000-8000-00000000b002', 'f1500000-0000-4000-8000-00000000f503', 'f1500000-0000-4000-8000-00000000f501', '{"motivoConsulta":{"titulo":"Motivo de consulta sugerido","contenido":"Test2"},"antecedentesRelevantes":{"titulo":"Antecedentes relevantes","contenido":"Test"},"medicacionActual":{"titulo":"Medicación actual","contenido":"Test"},"estudiosRecientes":{"titulo":"Estudios recientes","contenido":"Test"},"valoresFueraDeRango":{"titulo":"Valores fuera de rango","contenido":"Test"},"preguntasSugeridas":{"titulo":"Preguntas sugeridas para el médico","preguntas":["P1","P2","P3"]},"aviso":"No sustituye el criterio médico"}'::jsonb, now());


-- El titular (titular implícito de 'f1500000-0000-4000-8000-00000000f503') lee sus fichas.
begin;
select set_config('request.jwt.claims', '{"sub":"f1500aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
       'El titular lee sus fichas (SELECT con puede_ver_perfil)',
       '2',
       (select count(*)::text from public.consultation_sheets where profile_id = 'f1500000-0000-4000-8000-00000000f503'));

-- Un can_view de 'f1500000-0000-4000-8000-00000000f503' lee sus fichas (ya está en family_permissions).
select pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
       'El can_manage lee las fichas del perfil (SELECT con puede_ver_perfil)',
       '2',
       (select count(*)::text from public.consultation_sheets where profile_id = 'f1500000-0000-4000-8000-00000000f503'));

commit;

-- authenticated f502 intenta INSERT sin ser can_upload: rechazado.
-- fix auditoría 10.5: los do-blocks originales corrían SIN simulación de
-- sesión (como postgres, que saltea RLS), así que "insertaban" y los casos
-- daban FAIL. La sesión tiene que ENVOLVER cada do-block.
begin;
select set_config('request.jwt.claims', '{"sub":"f1500bbb-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        insert into public.consultation_sheets
            (profile_id, generated_by_profile_id, content)
        values ('f1500000-0000-4000-8000-00000000f503', 'f1500000-0000-4000-8000-00000000f502', '{"aviso":"x"}'::jsonb);
        v := 'insertada';
    exception when insufficient_privilege or others then v := 'rechazado';
    end;
    perform pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
        'authenticated sin can_upload NO puede insertar ficha (INSERT denegado)',
        'rechazado', v);
end $$;

commit;

-- Cambiar f502 a can_upload sobre f503 (setup, como postgres a propósito).
insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload)
values ('f1500000-0000-4000-8000-00000000f503', 'f1500000-0000-4000-8000-00000000f502', true, true);

-- Reintentar INSERT con can_upload y generated_by correcto (f502): permitido.
begin;
select set_config('request.jwt.claims', '{"sub":"f1500bbb-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        insert into public.consultation_sheets
            (profile_id, generated_by_profile_id, content)
        values ('f1500000-0000-4000-8000-00000000f503', 'f1500000-0000-4000-8000-00000000f502', '{"motivoConsulta":{"titulo":"Motivo de consulta sugerido","contenido":"Test"},"antecedentesRelevantes":{"titulo":"Antecedentes relevantes","contenido":"Test"},"medicacionActual":{"titulo":"Medicación actual","contenido":"Test"},"estudiosRecientes":{"titulo":"Estudios recientes","contenido":"Test"},"valoresFueraDeRango":{"titulo":"Valores fuera de rango","contenido":"Test"},"preguntasSugeridas":{"titulo":"Preguntas sugeridas para el médico","preguntas":["P1","P2","P3"]},"aviso":"No sustituye el criterio médico"}'::jsonb);
        v := 'insertada';
    exception when others then v := 'rechazada (' || sqlstate || ')';
    end;
    perform pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
        'authenticated con can_upload e generated_by correcto inserta (INSERT permitido)',
        'insertada', v);
end $$;

commit;

-- Intentar INSERT con generated_by AJENO (f502 firma como f501): WITH CHECK falla.
-- fix auditoría 10.5: el dato de prueba original ponía generated_by = f502 (el
-- propio actor), con lo cual el caso no probaba nada — ahora firma como f501.
begin;
select set_config('request.jwt.claims', '{"sub":"f1500bbb-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        insert into public.consultation_sheets
            (profile_id, generated_by_profile_id, content)
        values ('f1500000-0000-4000-8000-00000000f503', 'f1500000-0000-4000-8000-00000000f501', '{"aviso":"x"}'::jsonb);
        v := 'insertada';
    exception when insufficient_privilege or others then v := 'rechazado';
    end;
    perform pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
        'authenticated NO puede insertar con generated_by distinto de su id (WITH CHECK falla)',
        'rechazado', v);
end $$;

commit;

-- Intentar UPDATE/DELETE como authenticated: denegado.
--
-- fix auditoría 10.5: el `begin; set_config; set local role; commit;` original
-- cerraba la transacción ANTES de los intentos, que entonces corrían como
-- postgres (superusuario): el DELETE borraba la fila de verdad y el caso
-- siguiente encontraba NULL. La simulación de sesión tiene que ENVOLVER los
-- intentos, como hacen todos los demás bloques.
--
-- fix auditoría 11.4 (hallazgo A-01): hasta la migración 20260814110000,
-- `authenticated` TENÍA el privilegio de UPDATE y de DELETE sobre esta tabla y
-- lo único que lo frenaba era la ausencia de política — los dos intentos
-- afectaban 0 filas EN SILENCIO. Ahora el privilegio está revocado y los dos
-- ERRAN con 42501, así que van en do-block (si no, con ON_ERROR_STOP la
-- excepción tumbaría la suite entera). Se conservan además las dos
-- comprobaciones de estado —la fila sigue ahí y su contenido no cambió—
-- porque son las que demuestran el efecto, no la forma del rechazo.
begin;
select set_config('request.jwt.claims', '{"sub":"f1500aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        delete from public.consultation_sheets where id = 'b1000000-0000-4000-8000-00000000b001';
        v := 'borrada';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
        'authenticated NO tiene GRANT DELETE sobre fichas  [auditoría 11.4]',
        'denegado (42501)', v);
end $$;

select pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
       'authenticated NO puede DELETE fichas (la fila sigue ahí)',
       -- fix auditoría 10.5: 3 = las 2 fichas del seed del bloque + la del caso
       -- de INSERT permitido de arriba.
       '3',
       (select count(*)::text from public.consultation_sheets where profile_id = 'f1500000-0000-4000-8000-00000000f503'));

do $$
declare v text;
begin
    begin
        update public.consultation_sheets set content = '{"test":true}'::jsonb
         where id = 'b1000000-0000-4000-8000-00000000b001';
        v := 'editada';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
        'authenticated NO tiene GRANT UPDATE sobre fichas  [auditoría 11.4]',
        'denegado (42501)', v);
end $$;

select pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
       'authenticated NO puede UPDATE fichas (el contenido no cambió)',
       'Motivo de consulta sugerido',
       -- fix auditoría 10.5: `->'titulo' ->> 0` indexa un string como array y
       -- devuelve NULL (y registrar exige NOT NULL, abortando la suite entera
       -- porque el arnés corre con ON_ERROR_STOP). La navegación correcta es
       -- `->> 'titulo'` sobre el objeto de la sección.
       (select content ->'motivoConsulta' ->> 'titulo'
          from public.consultation_sheets
         where id = 'b1000000-0000-4000-8000-00000000b001'));

commit;

-- anon intenta leer fichas: denegado. (fix auditoría 10.5: sin GRANT SELECT,
-- la consulta ERRA con 42501 en vez de devolver 0 filas — con ON_ERROR_STOP
-- el caso original tumbaba la suite. Patrón do-block del resto del arnés.)
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $$
declare v text;
begin
    begin
        perform count(*) from public.consultation_sheets;
        v := 'permitido';
    exception when insufficient_privilege then v := 'denegado (42501)';
    end;
    perform pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
        'anon NO puede leer fichas (sin GRANT SELECT)',
        'denegado (42501)', v);
end $$;

commit;

-- anon intenta INSERT: rechazado (REVOKE). (mismo fix)
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $$
declare v text;
begin
    begin
        insert into public.consultation_sheets
            (profile_id, generated_by_profile_id, content)
        values ('f1500000-0000-4000-8000-00000000f503', 'f1500000-0000-4000-8000-00000000f503', '{"aviso":"x"}'::jsonb);
        v := 'insertada';
    exception when insufficient_privilege then v := 'denegado (42501)';
    end;
    perform pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
        'anon NO tiene GRANT INSERT (REVOKE no concede nada)',
        'denegado (42501)', v);
end $$;

commit;

-- Verificar que consultation_sheets tiene RLS habilitada.
select pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
       'consultation_sheets tiene RLS habilitada',
       'true',
       (select rowsecurity::text from pg_tables
         where schemaname = 'public' and tablename = 'consultation_sheets'));

-- Verificar que no hay GRANTs inadecuados a anon.
select pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
       'Privilegios de anon sobre consultation_sheets',
       '0',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'consultation_sheets' and grantee = 'anon'));

-- Auditoría 11.4, hallazgo A-01: el privilegio, no solo la política. Mismo
-- centinela que el BLOQUE 7 tiene para access_logs desde el Sprint 1: si una
-- migración futura vuelve a conceder UPDATE o DELETE, esto lo dice en la
-- corrida siguiente aunque nadie escriba la política que lo aprovecha.
select pruebas_rls.registrar('15. fichas generadas (consultation_sheets)',
       'Privilegio de UPDATE/DELETE de authenticated en consultation_sheets  [auditoría 11.4]',
       '0',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'consultation_sheets'
           and grantee = 'authenticated' and privilege_type in ('UPDATE', 'DELETE')));


-- =============================================================================
-- 16. ÁREA DE ESPERA DEL WEB SHARE TARGET (shared_uploads_temp + bucket
--     `compartidos-temp`) — Sprint 11, tarea 11.2; bloque agregado por la
--     auditoría de seguridad 11.4
-- =============================================================================
-- Es la única tabla del dominio cuyo dueño NO es un perfil sino una CUENTA
-- (`user_id`, porque en ese momento del flujo todavía no se eligió perfil), y
-- la única que nace de un INSERT hecho con `service_role` desde el receptor
-- `/api/compartir`. Eso le da una matriz propia que ningún otro bloque cubre:
--
--   · SELECT y DELETE: solo las filas PROPIAS (`user_id = auth.uid()`).
--   · INSERT y UPDATE: NINGUNO para `authenticated` — no hay privilegio, ni
--     política. La fila la crea el receptor con service_role y nunca se edita.
--   · TRUNCATE: revocado. RLS no protege de un TRUNCATE, y Supabase concede
--     ALL sobre toda tabla nueva de `public` por default: sin el revoke,
--     cualquier sesión podría vaciar los archivos en espera de TODAS las
--     cuentas. Es la razón por la que la migración dice "el revoke no es
--     decorativo", y acá se verifica que sigue siendo cierto.
--   · anon: nada de nada.
--   · Bucket `compartidos-temp`: privado y SIN NINGUNA política de
--     `storage.objects` que lo mencione — negación por defecto para el
--     cliente. La subida directa desde el navegador está denegada; la
--     verificación por HTTP vive en `scripts/test-storage-rls.sh` BLOQUE 7.
--
-- Reusa las dos cuentas del BLOQUE 15 (`f1500aaa…` y `f1500bbb…`): siguen
-- vivas porque la limpieza de todas las entidades es global y corre al final
-- del script. Es la misma convención con la que el BLOQUE 9 reusa el perfil
-- gestionado que crea el BLOQUE 5.
-- =============================================================================

-- Pre-limpieza defensiva (lección del fix de auditoría 10.5): una corrida
-- anterior abortada a la mitad dejaría estas filas y el INSERT de abajo
-- chocaría contra la primary key, tumbando el resto de la suite.
delete from public.shared_uploads_temp
 where id in ('f1600000-0000-4000-8000-00000000f601', 'f1600000-0000-4000-8000-00000000f602');

-- Las dos filas de prueba las crea `postgres` a propósito: es exactamente lo
-- que hace el receptor real, que corre con service_role.
insert into public.shared_uploads_temp
    (id, user_id, storage_path, mime_type, original_filename, file_size_bytes)
values
    ('f1600000-0000-4000-8000-00000000f601', 'f1500aaa-1111-4111-8111-111111111111',
     'f1500aaa-1111-4111-8111-111111111111/estudio-de-a.pdf', 'application/pdf',
     'estudio-de-a.pdf', 2048),
    ('f1600000-0000-4000-8000-00000000f602', 'f1500bbb-2222-4222-8222-222222222222',
     'f1500bbb-2222-4222-8222-222222222222/estudio-de-b.pdf', 'application/pdf',
     'estudio-de-b.pdf', 4096);


-- ── La cuenta A: ve la suya y SOLO la suya.
begin;
select set_config('request.jwt.claims', '{"sub":"f1500aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
       'A lee su propio archivo en espera (SELECT propio)',
       'estudio-de-a.pdf',
       (select coalesce(string_agg(original_filename, ', ' order by original_filename), '(ninguno)')
          from public.shared_uploads_temp));

select pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
       'A NO ve el archivo de B  [CRITERIO DE ACEPTACIÓN]', '0 filas',
       (select count(*)::text || ' filas' from public.shared_uploads_temp
         where id = 'f1600000-0000-4000-8000-00000000f602'));

-- INSERT: no hay GRANT. Ni siquiera para una fila a nombre propio.
do $$
declare v text;
begin
    begin
        insert into public.shared_uploads_temp
            (user_id, storage_path, mime_type, original_filename, file_size_bytes)
        values ('f1500aaa-1111-4111-8111-111111111111',
                'f1500aaa-1111-4111-8111-111111111111/inventado.pdf', 'application/pdf',
                'inventado.pdf', 100);
        v := 'insertado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
        'authenticated NO tiene GRANT INSERT (la fila la crea el receptor con service_role)',
        'denegado (42501)', v);
end $$;

-- UPDATE: tampoco. La fila nace y se borra, nunca se edita.
do $$
declare v text;
begin
    begin
        update public.shared_uploads_temp set original_filename = 'pisado.pdf'
         where id = 'f1600000-0000-4000-8000-00000000f601';
        v := 'editado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
        'authenticated NO tiene GRANT UPDATE (la fila no se edita, solo se borra)',
        'denegado (42501)', v);
end $$;

-- TRUNCATE: el revoke que NO es decorativo. RLS no lo filtraría.
do $$
declare v text;
begin
    begin
        truncate table public.shared_uploads_temp;
        v := 'vaciada';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
        'authenticated NO puede TRUNCATE la tabla (RLS no protege de un TRUNCATE)',
        'denegado (42501)', v);
end $$;

commit;


-- ── La cuenta B: no toca nada de A.
begin;
select set_config('request.jwt.claims', '{"sub":"f1500bbb-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
       'B NO ve el archivo de A  [CRITERIO DE ACEPTACIÓN]', '0 filas',
       (select count(*)::text || ' filas' from public.shared_uploads_temp
         where id = 'f1600000-0000-4000-8000-00000000f601'));

-- DELETE ajeno: B SÍ tiene el privilegio de DELETE, así que esto no erra —
-- RLS filtra y no toca ninguna fila. Es el caso que distingue "no tiene
-- permiso" de "no tiene privilegio", y el que demuestra que un id adivinado
-- no alcanza para borrarle a otro el archivo que está por guardar.
do $$
declare v integer;
begin
    delete from public.shared_uploads_temp where id = 'f1600000-0000-4000-8000-00000000f601';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
        'B BORRA el archivo de A por id adivinado (0 filas, no error)',
        '0 filas', v || ' filas');
end $$;

-- DELETE propio: sí, es el botón "Descartar" de /compartir.
do $$
declare v integer;
begin
    delete from public.shared_uploads_temp where id = 'f1600000-0000-4000-8000-00000000f602';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
        'B descarta su PROPIO archivo (DELETE propio)',
        '1 filas', v || ' filas');
end $$;

commit;

-- El archivo de A sobrevivió al intento de B (se comprueba con postgres, que
-- ve todo: si el DELETE ajeno hubiera pasado, acá saldría 0).
select pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
       'El archivo de A sigue existiendo después del intento de B', '1',
       (select count(*)::text from public.shared_uploads_temp
         where id = 'f1600000-0000-4000-8000-00000000f601'));


-- ── anon: nada.
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $$
declare v text;
begin
    begin
        perform count(*) from public.shared_uploads_temp;
        v := 'permitido';
    exception when insufficient_privilege then v := 'denegado (42501)';
    end;
    perform pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
        'anon NO puede leer archivos en espera (sin GRANT SELECT)',
        'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        delete from public.shared_uploads_temp where id = 'f1600000-0000-4000-8000-00000000f601';
        v := 'borrado';
    exception when insufficient_privilege then v := 'denegado (42501)';
    end;
    perform pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
        'anon NO puede borrar archivos en espera (sin GRANT DELETE)',
        'denegado (42501)', v);
end $$;

commit;


-- ── Invariantes estructurales de la tabla y del bucket.
select pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
       'shared_uploads_temp tiene RLS habilitada', 'true',
       (select rowsecurity::text from pg_tables
         where schemaname = 'public' and tablename = 'shared_uploads_temp'));

select pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
       'Privilegios de anon sobre shared_uploads_temp', '0',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'shared_uploads_temp' and grantee = 'anon'));

select pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
       'Privilegios de authenticated sobre shared_uploads_temp (exactamente los dos)',
       'DELETE, SELECT',
       (select coalesce(string_agg(distinct privilege_type, ', ' order by privilege_type), '(ninguno)')
          from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'shared_uploads_temp'
           and grantee = 'authenticated'));

select pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
       'El bucket compartidos-temp existe y es PRIVADO', 'privado',
       (select case when public then 'PÚBLICO' else 'privado' end
          from storage.buckets where id = 'compartidos-temp'));

-- La negación por defecto: todas las políticas de storage.objects filtran por
-- `bucket_id in (...)` a los tres buckets del producto. Que ninguna nombre a
-- `compartidos-temp` ES el mecanismo que deja al cliente afuera del bucket.
select pruebas_rls.registrar('16. share target temporal (shared_uploads_temp)',
       'Políticas de storage.objects que mencionan compartidos-temp (subida directa del cliente)',
       '0',
       (select count(*)::text from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and (coalesce(qual, '') || coalesce(with_check, '')) like '%compartidos-temp%'));


-- =============================================================================
-- BLOQUE 17 — Preferencia de tamaño de letra (Sprint 13, tarea 13.1)
-- -----------------------------------------------------------------------------
-- `profiles.display_density` es la única columna de `profiles` que NO describe
-- al paciente sino a la cuenta que MIRA la pantalla, y por eso es la única a la
-- que no le sirve la nota ② de la matriz ("titular o can_manage editan el
-- perfil"): un `can_manage` puede corregir la ficha SOS de Roberto, pero no
-- tiene por qué decidir con qué tamaño de letra ve la app la cuenta de María.
--
-- La regla no la puede expresar ni un privilegio de columna (no mira filas) ni
-- una política RLS (no puede comparar `new` contra `old`): la impone el trigger
-- `profiles_proteger_densidad`. Este bloque prueba las cuatro esquinas de esa
-- decisión —el titular sí, el administrador ajeno no, la edición legítima de
-- terceros sigue intacta, y un perfil sin cuenta no admite preferencia—, más el
-- default y la visibilidad de lectura.
--
-- Estado de partida: el BLOQUE 4 dejó a Diego con `can_manage` sobre el perfil
-- de María. Se re-afirma acá con un UPDATE idempotente en vez de asumirlo, para
-- que el bloque siga siendo válido si algún bloque intermedio cambia la matriz.
-- =============================================================================
\echo '### BLOQUE 17 — preferencia de tamaño de letra (display_density)'

update public.family_permissions
   set can_manage = true
 where owner_profile_id = :p_a and granted_profile_id = :p_b;

-- El default del producto pasó a ser el modo CHICO en el Sprint 14 (migración
-- 20260817150000): quien no eligió nada ve la densidad nativa. Toda fila que no
-- haya elegido explícitamente tiene que estar ahí — las de este arnés, que se
-- crean sin nombrar la columna, y las del seed.
--
-- La excepción es deliberada y está en el seed: el perfil de Diego
-- (660e8400-…0002) declara `display_density = 'grande'` a mano, para que la
-- demo tenga las DOS densidades y para que se vea que una elección explícita
-- convive con el default nuevo. Se la excluye del conteo por id y se la
-- verifica aparte, en vez de aflojar el conteo: así el caso sigue detectando
-- cualquier OTRA fila que se haya desviado del default.
select pruebas_rls.registrar('17. densidad',
       'Toda fila de profiles que no eligió arranca en el modo chico (default nuevo)',
       '0 filas distintas de chica',
       count(*) || ' filas distintas de chica')
  from public.profiles
 where display_density <> 'chica'
   and id <> '660e8400-e29b-41d4-a716-446655440002'::uuid;

-- La contracara: la elección explícita del seed sigue en pie. Corre sobre la
-- base que deja `npx supabase db reset` (migraciones + seed), que es la forma
-- documentada de correr este arnés; si la fila no estuviera, el caso lo dice
-- con todas las letras en vez de pasar por no encontrar el objetivo.
select pruebas_rls.registrar('17. densidad',
       'La elección explícita del seed (Diego en grande) convive con el default nuevo',
       'grande',
       coalesce((select display_density::text from public.profiles
                  where id = '660e8400-e29b-41d4-a716-446655440002'),
                'no existe la fila del seed'));

-- ── El titular SÍ cambia la suya.
-- Cambia a 'grande' y no a 'chica': desde que 'chica' es el default, un UPDATE
-- a 'chica' no distinguiría "se escribió" de "estaba así", y además el trigger
-- (`is distinct from`) ni siquiera se despertaría. 'grande' es el único valor
-- que no puede salir de un default.
begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v integer;
begin
    update public.profiles set display_density = 'grande'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('17. densidad',
        'A cambia SU PROPIA preferencia de tamaño  [CRITERIO DE ACEPTACIÓN]',
        '1 filas', v || ' filas');
end $$;

select pruebas_rls.registrar('17. densidad',
       'El valor quedó persistido en la fila de A', 'grande', display_density::text)
  from public.profiles where id = :p_a;

-- Nadie más que el titular: A administra el perfil GESTIONADO de Rosa (:p_g3,
-- lo creó ella en el BLOQUE 11) y aun así no puede darle una preferencia. Un
-- perfil sin cuenta no mira nada; el trigger lo rechaza antes de que el CHECK
-- llegue a opinar.
--
-- El `row_count` del camino feliz no es decorativo: la primera versión de este
-- caso apuntaba a :p_g (Roberto), que el BLOQUE 5 borra, y un UPDATE que no
-- encuentra fila no lanza nada — la prueba "pasaba por no existir el objetivo".
-- Reportar cuántas filas tocó convierte ese escenario en un resultado distinto
-- y visible ('sin fila objetivo') en vez de un falso 'cambiado'.
--
-- El valor que se intenta escribir tiene que ser el que NO es el default
-- ('grande' desde el Sprint 14): el trigger compara con `is distinct from`, así
-- que reenviarle a un perfil gestionado su propio 'chica' no sería un cambio y
-- pasaría legítimamente, dejando el caso vacío.
do $$
declare v text; n integer;
begin
    begin
        update public.profiles set display_density = 'grande'
         where id = 'f0000000-0000-4000-8000-00000000f001';
        get diagnostics n = row_count;
        v := case when n = 0 then 'sin fila objetivo' else 'cambiado' end;
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when check_violation         then v := 'rechazado (23514)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('17. densidad',
        'A le cambia la preferencia a un perfil GESTIONADO que administra (no tiene cuenta, no mira nada)',
        'rechazado (42501)', v);
end $$;

commit;

-- ── El administrador ajeno NO.
begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        update public.profiles set display_density = 'chica'
         where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        v := 'cambiado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('17. densidad',
        'B con can_manage sobre A le cambia la preferencia de tamaño  [CRITERIO DE ACEPTACIÓN]',
        'rechazado (42501)', v);
end $$;

select pruebas_rls.registrar('17. densidad',
       'La preferencia de A siguió intacta después del intento de B', 'grande',
       (select display_density::text from public.profiles
         where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));

-- La contracara imprescindible: el trigger NO puede haber roto la edición
-- legítima. B con can_manage sigue editando el resto del perfil de A -incluida
-- la ficha SOS, que es el caso de uso central del Sprint 8- porque el predicado
-- solo mira `display_density is distinct from`.
do $$
declare v integer;
begin
    update public.profiles set blood_type = 'A-'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('17. densidad',
        'B con can_manage sigue editando OTRAS columnas del perfil de A (el trigger no lo rompe)',
        '1 filas', v || ' filas');
end $$;

-- Un UPDATE que reenvía el MISMO valor de densidad no es un cambio y no debe
-- fallar: es lo que hace cualquier `update` de fila completa (un ORM, un
-- formulario que reenvía todo). El trigger compara con `is distinct from`
-- justamente para no convertir eso en un error.
do $$
declare v text;
begin
    begin
        update public.profiles
           set display_density = display_density, full_name = 'María Gómez'
         where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        v := 'aceptado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('17. densidad',
        'B reenvía la MISMA densidad de A junto con otra columna (no es un cambio)',
        'aceptado', v);
end $$;

-- Lectura: la preferencia viaja en `select *` para quien puede ver la fila. Se
-- deja escrito como caso porque es una decisión, no un descuido — ver "LA
-- LECTURA SÍ ES VISIBLE" en la migración 20260814120000 y docs/densidad.md §6.
select pruebas_rls.registrar('17. densidad',
       'B (autorizado sobre A) LEE la preferencia de A: se acepta a propósito, no es dato de salud',
       'grande',
       (select display_density::text from public.profiles
         where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));

commit;

-- ── El CHECK, medido sin el trigger de por medio.
-- Fuera de un `set local role`, esto corre como `postgres`: `es_sesion_de_usuario()`
-- devuelve false y el trigger se abstiene, igual que con el seed o una
-- migración. Lo único que queda en pie es
-- `profiles_densidad_solo_con_cuenta`, y tiene que alcanzar: un bug de un job
-- con service_role tampoco puede dejar una preferencia colgada de un perfil que
-- nadie usa para mirar.
--
-- El valor probado es 'grande' porque el CHECK clava los perfiles gestionados
-- en el DEFAULT de la columna, y desde el Sprint 14 ese default es 'chica'
-- (migración 20260817150000 §4). Escribirles 'chica' sería escribirles lo que
-- ya tienen; 'grande' es lo que el CHECK tiene que rechazar.
do $$
declare v text; n integer;
begin
    begin
        update public.profiles set display_density = 'grande'
         where id = 'f0000000-0000-4000-8000-00000000f001';
        get diagnostics n = row_count;
        v := case when n = 0 then 'sin fila objetivo' else 'cambiado' end;
    exception when check_violation then v := 'rechazado (23514)';
             when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('17. densidad',
        'service_role/seed le pone densidad a un perfil gestionado (solo queda el CHECK)',
        'rechazado (23514)', v);
end $$;

-- Invariantes estructurales: que las tres piezas existan de verdad y no solo en
-- el texto de la migración.
select pruebas_rls.registrar('17. densidad',
       'El trigger profiles_proteger_densidad existe sobre profiles', '1',
       (select count(*)::text from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
         where c.relname = 'profiles' and t.tgname = 'profiles_proteger_densidad'));

select pruebas_rls.registrar('17. densidad',
       'El CHECK profiles_densidad_solo_con_cuenta existe', '1',
       (select count(*)::text from pg_constraint
         where conname = 'profiles_densidad_solo_con_cuenta'));

select pruebas_rls.registrar('17. densidad',
       'El enum display_density tiene exactamente los dos modos del producto',
       'chica, grande',
       (select string_agg(e.enumlabel, ', ' order by e.enumlabel)
          from pg_enum e join pg_type t on t.oid = e.enumtypid
         where t.typname = 'display_density'));

-- Se restaura el estado para no arrastrar la preferencia ni el grupo sanguíneo
-- editado a los totales de otras corridas: la fila de A vuelve al DEFAULT del
-- producto ('chica' desde el Sprint 14), que es donde la encontró el primer
-- caso de este bloque.
update public.profiles set display_density = 'chica' where id = :p_a;
update public.profiles set blood_type = 'A+'          where id = :p_a;


-- =============================================================================
-- BLOQUE 18 — Consentimiento registrado (consents) — Sprint 12, tarea 12.1
-- -----------------------------------------------------------------------------
-- Ley 25.326, criterio de aceptación del ROADMAP: el consentimiento queda
-- registrado con versión y timestamp. Reusa las dos cuentas del BLOQUE
-- 15/16 (f1500aaa = A, f1500bbb = B), que siguen vivas por la misma razón
-- que el BLOQUE 16 ya documentó: la limpieza de estas entidades es global y
-- corre al final del script.
--
--   · INSERT propio: permitido. INSERT a nombre de otra cuenta: rechazado
--     por el WITH CHECK.
--   · SELECT: solo las filas propias, ni siquiera entre las dos cuentas de
--     prueba que en otros bloques comparten perfiles.
--   · document fuera del dominio cerrado ('privacidad', 'terminos',
--     'acceso_familiar'): rechazado por el CHECK (23514).
--   · UPDATE y DELETE: sin PRIVILEGIO, no solo sin política — nace
--     append-only desde el día uno (lección de la auditoría 11.4 sobre
--     consultation_sheets, aplicada acá sin esperar a una migración de
--     corrección separada).
--   · anon: nada de nada.
--   · TRUNCATE: revocado. RLS no protege de un TRUNCATE.
-- =============================================================================
\echo '### BLOQUE 18 — consentimiento registrado (consents)'

-- Pre-limpieza defensiva (lección del fix de auditoría 10.5): una corrida
-- anterior abortada a la mitad dejaría estas filas y los conteos esperados
-- de abajo no cerrarían.
delete from public.consents
 where user_id in ('f1500aaa-1111-4111-8111-111111111111', 'f1500bbb-2222-4222-8222-222222222222');

-- ── La cuenta A: firma su propio consentimiento de alta (privacidad + términos).
begin;
select set_config('request.jwt.claims', '{"sub":"f1500aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v integer;
begin
    insert into public.consents (user_id, document, version)
    values ('f1500aaa-1111-4111-8111-111111111111', 'privacidad', '2026-08-14-v1'),
           ('f1500aaa-1111-4111-8111-111111111111', 'terminos',   '2026-08-14-v1');
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('18. consentimiento (consents)',
        'A inserta su propio consentimiento a privacidad y términos  [CRITERIO DE ACEPTACIÓN]',
        '2 filas', v || ' filas');
end $$;

select pruebas_rls.registrar('18. consentimiento (consents)',
       'A lee sus propias filas (SELECT propio)', '2',
       (select count(*)::text from public.consents
         where user_id = 'f1500aaa-1111-4111-8111-111111111111'));

select pruebas_rls.registrar('18. consentimiento (consents)',
       'A NO ve el consentimiento de B  [CRITERIO DE ACEPTACIÓN]', '0 filas',
       (select count(*)::text || ' filas' from public.consents
         where user_id = 'f1500bbb-2222-4222-8222-222222222222'));

-- INSERT a nombre de OTRA cuenta: el WITH CHECK lo rechaza.
do $$
declare v text;
begin
    begin
        insert into public.consents (user_id, document, version)
        values ('f1500bbb-2222-4222-8222-222222222222', 'privacidad', '2026-08-14-v1');
        v := 'insertado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('18. consentimiento (consents)',
        'A NO puede insertar consentimiento a nombre de B (WITH CHECK)',
        'rechazado (42501)', v);
end $$;

-- El CHECK del dominio cerrado de documentos: 'cookies' no es ninguno de los tres.
do $$
declare v text;
begin
    begin
        insert into public.consents (user_id, document, version)
        values ('f1500aaa-1111-4111-8111-111111111111', 'cookies', '2026-08-14-v1');
        v := 'insertado';
    exception when check_violation then v := 'rechazado (23514)';
             when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('18. consentimiento (consents)',
        'Un documento fuera del dominio cerrado es rechazado por el CHECK',
        'rechazado (23514)', v);
end $$;

-- UPDATE: sin PRIVILEGIO, no solo sin política.
do $$
declare v text;
begin
    begin
        update public.consents set version = 'otra'
         where user_id = 'f1500aaa-1111-4111-8111-111111111111' and document = 'privacidad';
        v := 'editado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('18. consentimiento (consents)',
        'authenticated NO tiene GRANT UPDATE sobre consents (registro probatorio)',
        'denegado (42501)', v);
end $$;

-- DELETE: ídem.
do $$
declare v text;
begin
    begin
        delete from public.consents
         where user_id = 'f1500aaa-1111-4111-8111-111111111111' and document = 'privacidad';
        v := 'borrado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('18. consentimiento (consents)',
        'authenticated NO tiene GRANT DELETE sobre consents (registro probatorio)',
        'denegado (42501)', v);
end $$;

-- TRUNCATE: el revoke que no es decorativo. RLS no lo filtraría.
do $$
declare v text;
begin
    begin
        truncate table public.consents;
        v := 'vaciada';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('18. consentimiento (consents)',
        'authenticated NO puede TRUNCATE consents (RLS no protege de un TRUNCATE)',
        'denegado (42501)', v);
end $$;

commit;

-- ── La cuenta B: firma la suya (acceso_familiar), no toca la de A.
begin;
select set_config('request.jwt.claims', '{"sub":"f1500bbb-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v integer;
begin
    insert into public.consents (user_id, document, version)
    values ('f1500bbb-2222-4222-8222-222222222222', 'acceso_familiar', '2026-08-14-v1');
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('18. consentimiento (consents)',
        'B inserta su propio consentimiento de "acceso_familiar"',
        '1 filas', v || ' filas');
end $$;

select pruebas_rls.registrar('18. consentimiento (consents)',
       'B NO ve el consentimiento de A  [CRITERIO DE ACEPTACIÓN]', '0 filas',
       (select count(*)::text || ' filas' from public.consents
         where user_id = 'f1500aaa-1111-4111-8111-111111111111'));

commit;

-- ── anon: nada de nada.
begin;
select set_config('request.jwt.claims', '', true);
set local role anon;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.consents;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('18. consentimiento (consents)',
        'anon NO puede leer consents (sin GRANT SELECT)', 'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.consents (user_id, document, version)
        values ('f1500aaa-1111-4111-8111-111111111111', 'privacidad', '2026-08-14-v1');
        v := 'insertado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('18. consentimiento (consents)',
        'anon NO tiene GRANT INSERT sobre consents (REVOKE no concede nada)',
        'denegado (42501)', v);
end $$;

commit;

-- Invariantes estructurales.
select pruebas_rls.registrar('18. consentimiento (consents)',
       'consents tiene RLS habilitada', 'true',
       (select rowsecurity::text from pg_tables
         where schemaname = 'public' and tablename = 'consents'));

select pruebas_rls.registrar('18. consentimiento (consents)',
       'Privilegios de anon sobre consents', '0',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'consents' and grantee = 'anon'));

select pruebas_rls.registrar('18. consentimiento (consents)',
       'Privilegio de UPDATE/DELETE de authenticated en consents (append-only desde el día uno)',
       '0',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'consents'
           and grantee = 'authenticated' and privilege_type in ('UPDATE', 'DELETE')));


-- =============================================================================
-- BLOQUE 19 — Alta de cuenta: perfil y consentimiento por trigger
-- (HOTFIX de producción, migración 20260814140000)
-- -----------------------------------------------------------------------------
-- Reproduce EL FLUJO DE PRODUCCIÓN, que es justamente el que no se podía
-- probar desde la aplicación en local: un INSERT directo en `auth.users`, sin
-- ninguna sesión, sin `auth.uid()`, sin cookies — exactamente lo que hace
-- GoTrue cuando alguien se registra con la confirmación por correo encendida.
-- Antes del hotfix, después de ese INSERT no existía ni el perfil ni el
-- consentimiento, y la persona entraba a una cuenta vacía e inservible.
--
-- Se verifica:
--   · El trigger crea UN perfil PROPIO con el nombre que viajó en
--     `raw_user_meta_data.full_name`, `role = 'admin'` y sin
--     `created_by_profile_id` (no lo creó nadie más).
--   · Crea las DOS filas de `consents` con la versión que viajó en
--     `raw_user_meta_data.legales_version` y fechadas en el alta.
--   · IDEMPOTENCIA (lección de 948fe4a): volver a llamar a
--     `completar_alta_de_cuenta` sobre la misma cuenta no duplica nada, ni
--     siquiera sobre una cuenta cuyo perfil ya existía desde antes. Es lo que
--     habilita que el backfill de la migración se pueda correr de nuevo.
--   · FALLBACKS: una cuenta sin metadata (invitación desde el panel, seed,
--     este mismo arnés) igual obtiene perfil, con el nombre derivado del
--     correo, y consentimiento con la constante espejo de `VERSION_LEGALES`.
--   · La función NO es invocable desde una sesión de usuario.
-- =============================================================================
\echo '### BLOQUE 19 — alta de cuenta (perfil + consentimiento por trigger)'

-- Pre-limpieza defensiva (misma lección que el BLOQUE 15): restos de una
-- corrida abortada harían chocar los INSERT de abajo contra users_pkey.
delete from auth.users where id in (
    'f1900aaa-1111-4111-8111-111111111111',
    'f1900bbb-2222-4222-8222-222222222222',
    'f1900ccc-3333-4333-8333-333333333333');

-- ── Cuenta A: el alta tal como la manda `registrarse` (nombre + versión
--    legal en options.data). La versión es deliberadamente distinta de la
--    vigente, para probar que sale del metadata y no de la constante.
insert into auth.users (id, instance_id, aud, role, email, created_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('f1900aaa-1111-4111-8111-111111111111',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'juana@ejemplo.ar', now(),
        '{"provider":"email","providers":["email"]}',
        '{"full_name":"Juana Pérez","legales_version":"2020-01-01-v9"}');

select pruebas_rls.registrar('19. alta de cuenta',
       'Una cuenta nueva SIN SESIÓN obtiene su perfil  [CRITERIO DE ACEPTACIÓN]',
       '1 filas',
       (select count(*)::text || ' filas' from public.profiles
         where user_id = 'f1900aaa-1111-4111-8111-111111111111'));

select pruebas_rls.registrar('19. alta de cuenta',
       'El perfil se llama como el full_name que viajó en raw_user_meta_data',
       'Juana Pérez',
       (select full_name from public.profiles
         where user_id = 'f1900aaa-1111-4111-8111-111111111111'));

select pruebas_rls.registrar('19. alta de cuenta',
       'El perfil propio nace con role admin (titular de sus datos, modelo §3.1)',
       'admin',
       (select role::text from public.profiles
         where user_id = 'f1900aaa-1111-4111-8111-111111111111'));

-- Un perfil PROPIO, no uno gestionado: la distinción es user_id NOT NULL.
select pruebas_rls.registrar('19. alta de cuenta',
       'El perfil es PROPIO (user_id apunta a la cuenta), no gestionado',
       'propio',
       (select case when user_id is null then 'gestionado' else 'propio' end
          from public.profiles
         where user_id = 'f1900aaa-1111-4111-8111-111111111111'));

-- `proteger_titularidad_de_perfil` sella created_by_profile_id con el perfil
-- actor SOLO en sesiones de usuario. Acá no hay sesión, así que la columna
-- queda NULL — que es lo que su propio comentario declara para los perfiles
-- que se autocrean al registrarse una cuenta.
select pruebas_rls.registrar('19. alta de cuenta',
       'created_by_profile_id queda NULL (un perfil propio no lo creó nadie más)',
       'NULL',
       (select coalesce(created_by_profile_id::text, 'NULL') from public.profiles
         where user_id = 'f1900aaa-1111-4111-8111-111111111111'));

-- El trigger de alta no nombra `display_density`: la fila toma el DEFAULT de la
-- columna, que el Sprint 14 movió a 'chica' (migración 20260817150000 §2). Este
-- caso es el que ata las dos migraciones: si alguien cambiara el default sin
-- pasar por acá, se enteraría en esta línea.
select pruebas_rls.registrar('19. alta de cuenta',
       'El perfil nace en el modo de letra chica (default del producto desde el Sprint 14)',
       'chica',
       (select display_density::text from public.profiles
         where user_id = 'f1900aaa-1111-4111-8111-111111111111'));

select pruebas_rls.registrar('19. alta de cuenta',
       'La cuenta queda con los DOS consentimientos de alta  [CRITERIO DE ACEPTACIÓN]',
       'privacidad, terminos',
       (select string_agg(document, ', ' order by document) from public.consents
         where user_id = 'f1900aaa-1111-4111-8111-111111111111'));

select pruebas_rls.registrar('19. alta de cuenta',
       'La versión registrada es la que viajó en el metadata, no la constante',
       '2020-01-01-v9',
       (select distinct version from public.consents
         where user_id = 'f1900aaa-1111-4111-8111-111111111111'));

-- Fechado en el alta y no en el momento en que corre la función: es lo que
-- hace honesto al backfill de cuentas viejas.
select pruebas_rls.registrar('19. alta de cuenta',
       'accepted_at es el momento del alta de la cuenta (no el de la migración)',
       'true',
       (select bool_and(c.accepted_at = u.created_at)::text
          from public.consents c
          join auth.users u on u.id = c.user_id
         where c.user_id = 'f1900aaa-1111-4111-8111-111111111111'));

-- ── IDEMPOTENCIA: la segunda pasada del backfill no duplica nada.
do $$
begin
    perform public.completar_alta_de_cuenta('f1900aaa-1111-4111-8111-111111111111');
    perform public.completar_alta_de_cuenta('f1900aaa-1111-4111-8111-111111111111');
end $$;

select pruebas_rls.registrar('19. alta de cuenta',
       'Llamarla dos veces más NO duplica el perfil (idempotencia del backfill)',
       '1 perfiles',
       (select count(*)::text || ' perfiles' from public.profiles
         where user_id = 'f1900aaa-1111-4111-8111-111111111111'));

select pruebas_rls.registrar('19. alta de cuenta',
       'Llamarla dos veces más NO duplica el consentimiento (registro probatorio)',
       '2 consents',
       (select count(*)::text || ' consents' from public.consents
         where user_id = 'f1900aaa-1111-4111-8111-111111111111'));

-- Y sobre una cuenta que YA tenía perfil desde antes del hotfix (María):
-- tampoco inventa un segundo perfil propio.
do $$
begin
    perform public.completar_alta_de_cuenta('11111111-1111-4111-8111-111111111111');
end $$;

select pruebas_rls.registrar('19. alta de cuenta',
       'Sobre una cuenta que ya tenía perfil, el backfill no crea otro',
       '1 perfiles',
       (select count(*)::text || ' perfiles' from public.profiles
         where user_id = :u_a));

-- ── Cuenta B: sin metadata ninguna (invitación desde el panel de Supabase,
--    seed, o este mismo arnés). Los fallbacks tienen que sostenerla igual:
--    una cuenta sin perfil es exactamente lo que el hotfix vino a impedir.
insert into auth.users (id, instance_id, aud, role, email, created_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('f1900bbb-2222-4222-8222-222222222222',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'usuario19b@test.local', now(), '{}', '{}');

select pruebas_rls.registrar('19. alta de cuenta',
       'Una cuenta SIN metadata igual obtiene perfil, con el nombre derivado del correo',
       'usuario19b',
       (select full_name from public.profiles
         where user_id = 'f1900bbb-2222-4222-8222-222222222222'));

-- El espejo SQL de VERSION_LEGALES (lib/legales.ts). Si alguien cambia la
-- constante de TypeScript y se olvida de la migración, este caso lo delata
-- -igual que tests/unit/alta-de-cuenta.test.ts del lado del código-.
select pruebas_rls.registrar('19. alta de cuenta',
       'Sin legales_version en el metadata, se usa la constante espejo de VERSION_LEGALES',
       '2026-08-14-v1',
       (select distinct version from public.consents
         where user_id = 'f1900bbb-2222-4222-8222-222222222222'));

-- ── Cuenta C: metadata presente pero en blanco. `btrim` + `nullif` tienen que
--    tratarla como ausente, porque `profiles_full_name_no_vacio` rechazaría
--    una cadena vacía y el alta entera se caería.
insert into auth.users (id, instance_id, aud, role, email, created_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('f1900ccc-3333-4333-8333-333333333333',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'usuario19c@test.local', now(), '{}',
        '{"full_name":"   ","legales_version":"  "}');

select pruebas_rls.registrar('19. alta de cuenta',
       'Un full_name en blanco se trata como ausente (el CHECK de no vacío no se roza)',
       'usuario19c',
       (select full_name from public.profiles
         where user_id = 'f1900ccc-3333-4333-8333-333333333333'));

select pruebas_rls.registrar('19. alta de cuenta',
       'Una legales_version en blanco cae al fallback en vez de guardar vacío',
       '2026-08-14-v1',
       (select distinct version from public.consents
         where user_id = 'f1900ccc-3333-4333-8333-333333333333'));

-- ── La función NO se llama a mano desde una sesión: solo la disparan el
--    trigger (como definer) y el backfill de la migración.
begin;
select set_config('request.jwt.claims', :jwt_b, true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.completar_alta_de_cuenta('f1900aaa-1111-4111-8111-111111111111');
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('19. alta de cuenta',
        'authenticated NO puede ejecutar completar_alta_de_cuenta (REVOKE del EXECUTE por defecto)',
        'denegado (42501)', v);
end $$;

commit;

-- ── Una cuenta inexistente no se completa en silencio: sin este raise, un
--    backfill mal escrito crearía perfiles colgando de la nada.
do $$
declare v text;
begin
    begin
        perform public.completar_alta_de_cuenta('f1900fff-9999-4999-8999-999999999999');
        v := 'ejecutada';
    exception when foreign_key_violation then v := 'rechazado (23503)';
             when others                 then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('19. alta de cuenta',
        'Completar el alta de una cuenta que no existe falla en vez de pasar de largo',
        'rechazado (23503)', v);
end $$;

-- Invariantes estructurales: el trigger existe, está habilitado y la función
-- es SECURITY DEFINER (sin eso no podría escribir en profiles ni en consents,
-- porque en el alta todavía no hay auth.uid()).
select pruebas_rls.registrar('19. alta de cuenta',
       'El trigger auth_users_crear_perfil_de_cuenta existe y está habilitado en auth.users',
       'O',
       (select tgenabled::text from pg_trigger
         where tgrelid = 'auth.users'::regclass
           and tgname = 'auth_users_crear_perfil_de_cuenta'));

select pruebas_rls.registrar('19. alta de cuenta',
       'completar_alta_de_cuenta es SECURITY DEFINER y fija su search_path',
       'definer/search_path fijado',
       (select case when p.prosecdef then 'definer' else 'invoker' end
               || '/' ||
               case when coalesce(array_to_string(p.proconfig, ','), '') like 'search_path=%'
                    then 'search_path fijado' else 'search_path heredado' end
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'completar_alta_de_cuenta'));


-- =============================================================================
-- BLOQUE 20 — Perfiles gestionados desde /familia (Sprint 15, tarea 15.1)
-- -----------------------------------------------------------------------------
-- El RPC `crear_perfil_gestionado()` (`20260817220000_perfiles_gestionados.sql`)
-- es un TERCER camino además de los dos ya probados: el de dos INSERT sueltos
-- (BLOQUE 5) y el que dispara el trigger de alta de cuenta (BLOQUE 19). Este
-- bloque prueba la operación completa -perfil + fila de arranque + consent del
-- representante, atómicos- con tres cuentas nuevas:
--   f2000aaa "Noelia" — crea el perfil gestionado.
--   f2000bbb "Bruno"  — tercero AUTORIZADO después (Noelia le da can_view).
--   f2000ccc "Carla"  — tercero que NUNCA recibe permiso.
-- El id del perfil creado lo devuelve el RPC -no se puede fijar de antemano,
-- profiles.id usa gen_random_uuid() por default- así que se guarda en un GUC
-- de sesión (`pruebas_rls.perfil_lucas_id`) con set_config(..., false): a
-- diferencia de request.jwt.claims (siempre `true`, local a la transacción),
-- acá se necesita que el valor sobreviva el `commit` de la transacción que lo
-- generó para poder leerlo en los bloques begin/commit siguientes.
-- =============================================================================
\echo '### BLOQUE 20 — perfiles gestionados desde /familia (crear_perfil_gestionado)'

-- Pre-limpieza defensiva (una corrida anterior abortada a la mitad dejaría
-- estas filas y el INSERT de auth.users de abajo chocaría contra users_pkey).
-- Los perfiles gestionados que Noelia haya creado se borran ANTES que su
-- cuenta -mismo motivo que en toda la suite: el trigger de no orfandad
-- abortaría si se lo intentara al revés-.
delete from public.profiles where created_by_profile_id = 'f2000000-0000-4000-8000-00000000f001';
delete from auth.users      where id in (
    'f2000aaa-1111-4111-8111-111111111111',
    'f2000bbb-2222-4222-8222-222222222222',
    'f2000ccc-3333-4333-8333-333333333333',
    'f2000ddd-4444-4444-8444-444444444444');

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('f2000aaa-1111-4111-8111-111111111111', 'usuario20a@test.local', '{}', '{}'),
    ('f2000bbb-2222-4222-8222-222222222222', 'usuario20b@test.local', '{}', '{}'),
    ('f2000ccc-3333-4333-8333-333333333333', 'usuario20c@test.local', '{}', '{}'),
    ('f2000ddd-4444-4444-8444-444444444444', 'usuario20d@test.local', '{}', '{}');

-- El trigger de alta ya les creó su perfil propio con id aleatorio; se
-- descartan y se reinsertan con ids fijos (mismo patrón que el BLOQUE 15).
delete from public.profiles
 where user_id in (
    'f2000aaa-1111-4111-8111-111111111111',
    'f2000bbb-2222-4222-8222-222222222222',
    'f2000ccc-3333-4333-8333-333333333333',
    'f2000ddd-4444-4444-8444-444444444444')
   and id not in (
    'f2000000-0000-4000-8000-00000000f001',
    'f2000000-0000-4000-8000-00000000f002',
    'f2000000-0000-4000-8000-00000000f003');

insert into public.profiles (id, user_id, full_name, role) values
    ('f2000000-0000-4000-8000-00000000f001', 'f2000aaa-1111-4111-8111-111111111111', 'Noelia Bloque20', 'family_member'),
    ('f2000000-0000-4000-8000-00000000f002', 'f2000bbb-2222-4222-8222-222222222222', 'Bruno Bloque20',  'family_member'),
    ('f2000000-0000-4000-8000-00000000f003', 'f2000ccc-3333-4333-8333-333333333333', 'Carla Bloque20',  'family_member');
-- f2000ddd se queda SIN perfil propio a propósito -ver el caso "actor sin
-- perfil" más abajo-, borrándole el que el trigger de alta le creó.
delete from public.profiles where user_id = 'f2000ddd-4444-4444-8444-444444444444';


-- ── Noelia crea el perfil gestionado de "Lucas" -- [CRITERIO DE ACEPTACIÓN]
begin;
select set_config('request.jwt.claims', '{"sub":"f2000aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
    v      text;
    fila   public.profiles%rowtype;
begin
    select * into fila from public.crear_perfil_gestionado(
        'Lucas Bloque20', date '2019-05-10', '2026-08-14-v1', '203.0.113.5'::inet);
    v := fila.full_name || ' / user_id ' ||
         case when fila.user_id is null then 'NULL' else 'NOT NULL' end || ' / creado_por ' ||
         case when fila.created_by_profile_id = 'f2000000-0000-4000-8000-00000000f001' then 'Noelia' else 'otro' end;
    perform set_config('pruebas_rls.perfil_lucas_id', fila.id::text, false);
    perform pruebas_rls.registrar('20. perfiles gestionados',
        'Noelia crea "Lucas" con crear_perfil_gestionado()  [CRITERIO DE ACEPTACIÓN]',
        'Lucas Bloque20 / user_id NULL / creado_por Noelia', v);
end $$;

commit;

select pruebas_rls.registrar('20. perfiles gestionados',
       'La fila de arranque quedó con los tres flags en true',
       'true/true/true',
       (select can_view::text || '/' || can_upload::text || '/' || can_manage::text
          from public.family_permissions
         where owner_profile_id = current_setting('pruebas_rls.perfil_lucas_id')::uuid
           and granted_profile_id = 'f2000000-0000-4000-8000-00000000f001'));

select pruebas_rls.registrar('20. perfiles gestionados',
       'El consentimiento del representante quedó sellado (consent sellado)',
       'acceso_familiar_representante/2026-08-14-v1/203.0.113.5',
       (select document || '/' || version || '/' || host(ip)
          from public.consents
         where user_id = 'f2000aaa-1111-4111-8111-111111111111'
           and document = 'acceso_familiar_representante'));


-- ── Noelia (creadora) ve a Lucas en su selector.
begin;
select set_config('request.jwt.claims', '{"sub":"f2000aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('20. perfiles gestionados',
       'Noelia ve a Lucas en su selector de perfiles', '1 filas',
       count(*) || ' filas')
  from public.profiles where id = current_setting('pruebas_rls.perfil_lucas_id')::uuid;

commit;


-- ── Carla, sin ningún permiso, NO ve a Lucas.
begin;
select set_config('request.jwt.claims', '{"sub":"f2000ccc-3333-4333-8333-333333333333","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('20. perfiles gestionados',
       'Carla (sin permiso) NO ve a Lucas', '0 filas',
       count(*) || ' filas')
  from public.profiles where id = current_setting('pruebas_rls.perfil_lucas_id')::uuid;

commit;


-- ── anon no ve nada de esto.
begin;
select set_config('request.jwt.claims', '', true);
set local role anon;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.profiles
         where id = current_setting('pruebas_rls.perfil_lucas_id')::uuid;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('20. perfiles gestionados',
        'anon lee el perfil de Lucas', 'denegado (42501)', v);
end $$;

commit;


-- ── Noelia autoriza a Bruno con can_view (flujo existente de invitar,
--    docs/modelo-permisos.md §4.4 ⚑: puede otorgar porque Lucas es gestionado
--    y ella tiene can_manage). Después, Bruno SÍ ve a Lucas.
begin;
select set_config('request.jwt.claims', '{"sub":"f2000aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage)
values (current_setting('pruebas_rls.perfil_lucas_id')::uuid, 'f2000000-0000-4000-8000-00000000f002', true, false, false);

commit;

begin;
select set_config('request.jwt.claims', '{"sub":"f2000bbb-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('20. perfiles gestionados',
       'Bruno, autorizado después, SÍ ve a Lucas  [CRITERIO DE ACEPTACIÓN]', '1 filas',
       count(*) || ' filas')
  from public.profiles where id = current_setting('pruebas_rls.perfil_lucas_id')::uuid;

commit;

begin;
select set_config('request.jwt.claims', '{"sub":"f2000ccc-3333-4333-8333-333333333333","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('20. perfiles gestionados',
       'Carla sigue sin ver a Lucas después de autorizar a Bruno', '0 filas',
       count(*) || ' filas')
  from public.profiles where id = current_setting('pruebas_rls.perfil_lucas_id')::uuid;

commit;


-- ── No-orfandad intacta: Noelia (única can_manage) no puede renunciar sola.
begin;
select set_config('request.jwt.claims', '{"sub":"f2000aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        delete from public.family_permissions
         where owner_profile_id = current_setting('pruebas_rls.perfil_lucas_id')::uuid
           and granted_profile_id = 'f2000000-0000-4000-8000-00000000f001';
        v := 'renunció';
    exception when sqlstate '23001' then v := 'rechazado (23001)';
             when others            then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('20. perfiles gestionados',
        'Noelia (única can_manage de un perfil creado por RPC) no puede renunciar sola (D4 intacta)',
        'rechazado (23001)', v);
end $$;

commit;


-- ── Guardas de validación del RPC (errcode 22023, mensaje en español).
begin;
select set_config('request.jwt.claims', '{"sub":"f2000aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.crear_perfil_gestionado('   ', date '2019-01-01', '2026-08-14-v1', null);
        v := 'creado';
    exception when sqlstate '22023' then v := 'rechazado (22023)';
             when others            then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('20. perfiles gestionados',
        'Nombre vacío (o solo espacios) es rechazado', 'rechazado (22023)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.crear_perfil_gestionado('Fecha Futura', current_date + 1, '2026-08-14-v1', null);
        v := 'creado';
    exception when sqlstate '22023' then v := 'rechazado (22023)';
             when others            then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('20. perfiles gestionados',
        'Fecha de nacimiento futura es rechazada', 'rechazado (22023)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.crear_perfil_gestionado('Sin Fecha', null, '2026-08-14-v1', null);
        v := 'creado';
    exception when sqlstate '22023' then v := 'rechazado (22023)';
             when others            then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('20. perfiles gestionados',
        'Fecha de nacimiento NULL es rechazada (obligatoria en este flujo)', 'rechazado (22023)', v);
end $$;

commit;

-- ── Actor sin perfil propio (guarda 1): f2000ddd no tiene fila en profiles.
begin;
select set_config('request.jwt.claims', '{"sub":"f2000ddd-4444-4444-8444-444444444444","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        perform public.crear_perfil_gestionado('Sin Perfil Propio', date '2020-01-01', '2026-08-14-v1', null);
        v := 'creado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('20. perfiles gestionados',
        'Una cuenta sin perfil propio no puede crear un gestionado', 'rechazado (42501)', v);
end $$;

commit;

-- ── anon no puede ejecutar el RPC (sin GRANT EXECUTE).
begin;
select set_config('request.jwt.claims', '', true);
set local role anon;

do $$
declare v text;
begin
    begin
        perform public.crear_perfil_gestionado('Intento Anónimo', date '2020-01-01', '2026-08-14-v1', null);
        v := 'creado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('20. perfiles gestionados',
        'anon no puede ejecutar crear_perfil_gestionado (sin GRANT EXECUTE)', 'denegado (42501)', v);
end $$;

commit;


-- ── Idempotencia/replay: llamar al RPC otra vez con el mismo actor crea un
--    SEGUNDO perfil independiente -no corrompe ni fusiona con "Lucas"-, con
--    su propia fila de arranque y su propio consent. No hay clave de
--    deduplicación (cada alta es una declaración de representación propia,
--    igual que dos invitaciones separadas se auditan como dos filas), así
--    que "replay-safe" acá significa "seguro de repetir", no "deduplicado".
begin;
select set_config('request.jwt.claims', '{"sub":"f2000aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
    v    text;
    fila public.profiles%rowtype;
begin
    select * into fila from public.crear_perfil_gestionado(
        'Sofía Bloque20', date '2021-02-20', '2026-08-14-v1', null);
    v := case when fila.id <> current_setting('pruebas_rls.perfil_lucas_id')::uuid
              then 'perfil nuevo e independiente' else 'mismo id que Lucas (mal)' end;
    perform set_config('pruebas_rls.perfil_sofia_id', fila.id::text, false);
    perform pruebas_rls.registrar('20. perfiles gestionados',
        'Replay del RPC con el mismo actor crea un SEGUNDO perfil independiente',
        'perfil nuevo e independiente', v);
end $$;

commit;

select pruebas_rls.registrar('20. perfiles gestionados',
       'Noelia terminó administrando 2 perfiles gestionados creados por ella (Lucas + Sofía)', '2',
       (select count(*)::text from public.family_permissions
         where granted_profile_id = 'f2000000-0000-4000-8000-00000000f001'
           and can_manage
           and owner_profile_id in (
               current_setting('pruebas_rls.perfil_lucas_id')::uuid,
               current_setting('pruebas_rls.perfil_sofia_id')::uuid)));

select pruebas_rls.registrar('20. perfiles gestionados',
       'El replay dejó DOS consents de representante para Noelia, uno por cada alta', '2',
       (select count(*)::text from public.consents
         where user_id = 'f2000aaa-1111-4111-8111-111111111111'
           and document = 'acceso_familiar_representante'));


-- =============================================================================
-- BLOQUE 21 — Graduación de perfiles gestionados (Sprint 15, tarea 15.2)
-- -----------------------------------------------------------------------------
-- La GRADUACIÓN es la operación de docs/modelo-permisos.md §8.6: un perfil
-- gestionado recibe su propia cuenta y su titular toma el control. La
-- implementa `20260817230000_graduacion.sql` extendiendo
-- `completar_alta_de_cuenta` -o sea, extendiendo el trigger de alta de
-- `auth.users`- con una rama que VINCULA en vez de crear.
--
-- ── CÓMO SE SIMULA LA GRADUACIÓN, Y POR QUÉ ASÍ
--
-- Hay que reproducir lo que hace `auth.admin.createUser`, que NO es un único
-- INSERT con toda la metadata puesta. Medido con triggers de diagnóstico sobre
-- `auth.users` (ver el encabezado de la migración): el `INSERT` lleva el
-- `raw_user_meta_data` pero un `raw_app_meta_data` con solo el proveedor, y el
-- claim `perfil_existente` llega en un `UPDATE` posterior — **dentro de la
-- misma transacción**. Ese detalle no es cosmético: es lo que hace que para
-- cuando el claim aparece, el alta normal ya haya corrido y la cuenta ya tenga
-- un perfil propio en blanco que hay que deshacer.
--
-- Por eso los casos de graduación de este bloque van dentro de un `do $$ ... $$`
-- (un statement = una transacción) que hace el INSERT y el UPDATE juntos. Un
-- `insert;` y un `update;` sueltos en psql serían DOS transacciones y no
-- probarían el camino real -de hecho probarían el caso D, que también está acá
-- y que debe fallar-.
--
-- El elenco (tres cuentas base + siete altas de un solo uso):
--   f2100aaa "Nadia" — CREADORA de los perfiles gestionados. La única que puede graduarlos.
--   f2100bbb "Bruno" — can_manage sobre el gestionado, pero NO su creador.
--   f2100ccc "Carla" — tercero sin ningún permiso.
--   f2100ddd            — la cuenta NUEVA de Tomás: la graduación de verdad (INSERT + UPDATE).
--   f2100777            — forma "GoTrue futuro": el claim YA viene en el INSERT (gradúa a Ana).
--   f2100666            — cuenta VIEJA en uso a la que alguien le estampa el claim después.
--   f2100eee            — segundo intento sobre un perfil YA graduado (debe fallar).
--   f2100fff            — HOSTIL: se declara `perfil_existente` en `raw_user_meta_data`.
--   f2100999            — metadata rota: apunta a un perfil que no existe.
--   f2100888            — metadata rota: el claim no tiene forma de uuid.
--
-- Lo que este bloque demuestra, en orden:
--   · `puede_graduar_perfil()` responde por el CREADOR y por nadie más -ni un
--     can_manage, ni un tercero, ni sobre un perfil con cuenta-;
--   · un `perfil_existente` puesto en `raw_user_meta_data` -la metadata que
--     el propio usuario escribe desde el navegador con la clave anónima- NO
--     roba nada: esa alta se procesa como cualquier otra y el perfil ajeno
--     queda intacto. Es el ataque que la migración cierra leyendo el claim de
--     `raw_app_meta_data`, que solo escribe la Admin API;
--   · estamparle el claim a una cuenta VIEJA no le borra el perfil ni le roba
--     el ajeno: se rechaza, ruidosamente. Es el footgun que abre tener que
--     deshacer el alta automática, y la condición exacta `created_at = now()`
--     es lo que lo cierra;
--   · una metadata rota NO deja una cuenta a medio vincular: el alta entera
--     se deshace y en `auth.users` no queda nada;
--   · la vinculación feliz deja UN solo perfil -el de siempre, con su
--     historia-, sin el perfil en blanco que el INSERT había creado, NO firma
--     ningún consentimiento -lo firma su titular en el gate- y CONSERVA todos
--     los accesos existentes (decisión de producto del Sprint 15);
--   · las DOS formas funcionan: la real (claim en un UPDATE) y la que traería
--     una versión futura de GoTrue (claim ya en el INSERT);
--   · la autoridad se transfiere SOLA, sin migrar datos: quien creó el perfil
--     pierde la autoridad de otorgamiento y el nuevo titular la gana, porque
--     las políticas leen `user_id IS NULL` en tiempo de consulta (§8.6 pto 4);
--   · graduar dos veces el mismo perfil lo rechaza LA BASE, no la interfaz;
--   · la nota ② sigue en pie: desde una sesión de usuario `profiles.user_id`
--     sigue siendo inmutable, tanto para adueñarse como para des-graduar;
--   · el nuevo titular sella sus dos consentimientos con su propio `user_id`
--     y no puede firmar a nombre de nadie más;
--   · y ya como titular pleno revoca el acceso de quien lo administraba, que
--     es el criterio de aceptación del sprint.
--
-- Los ids de los perfiles gestionados los genera `gen_random_uuid()`, así que
-- se guardan en GUC de sesión (`pruebas_rls.perfil_tomas_id`,
-- `pruebas_rls.perfil_ana_id`) con `set_config(..., false)` — mismo mecanismo
-- y mismo motivo que el BLOQUE 20 con Lucas: tienen que sobrevivir al `commit`
-- de la transacción que los generó.
-- =============================================================================
\echo '### BLOQUE 21 — graduación de perfiles gestionados (perfil gestionado → cuenta propia)'

-- Pre-limpieza defensiva (misma lección que los BLOQUES 15, 19 y 20): restos
-- de una corrida abortada harían chocar los INSERT de abajo contra users_pkey.
-- Los perfiles que Nadia haya creado se borran ANTES que su cuenta.
delete from public.profiles where created_by_profile_id = 'f2100000-0000-4000-8000-00000000f101';
delete from auth.users      where id in (
    'f2100aaa-1111-4111-8111-111111111111',
    'f2100bbb-2222-4222-8222-222222222222',
    'f2100ccc-3333-4333-8333-333333333333',
    'f2100ddd-4444-4444-8444-444444444444',
    'f2100eee-5555-4555-8555-555555555555',
    'f2100fff-6666-4666-8666-666666666666',
    'f2100999-7777-4777-8777-777777777777',
    'f2100888-8888-4888-8888-888888888888',
    'f2100777-9999-4999-8999-999999999999',
    'f2100666-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
    ('f2100aaa-1111-4111-8111-111111111111', 'usuario21a@test.local', '{}', '{}'),
    ('f2100bbb-2222-4222-8222-222222222222', 'usuario21b@test.local', '{}', '{}'),
    ('f2100ccc-3333-4333-8333-333333333333', 'usuario21c@test.local', '{}', '{}');

-- El trigger de alta ya les creó su perfil propio con id aleatorio; se
-- descartan y se reinsertan con ids fijos (mismo patrón que los BLOQUES 15 y 20).
delete from public.profiles
 where user_id in (
    'f2100aaa-1111-4111-8111-111111111111',
    'f2100bbb-2222-4222-8222-222222222222',
    'f2100ccc-3333-4333-8333-333333333333')
   and id not in (
    'f2100000-0000-4000-8000-00000000f101',
    'f2100000-0000-4000-8000-00000000f102',
    'f2100000-0000-4000-8000-00000000f103');

insert into public.profiles (id, user_id, full_name, role) values
    ('f2100000-0000-4000-8000-00000000f101', 'f2100aaa-1111-4111-8111-111111111111', 'Nadia Bloque21', 'family_member'),
    ('f2100000-0000-4000-8000-00000000f102', 'f2100bbb-2222-4222-8222-222222222222', 'Bruno Bloque21',  'family_member'),
    ('f2100000-0000-4000-8000-00000000f103', 'f2100ccc-3333-4333-8333-333333333333', 'Carla Bloque21',  'family_member');


-- ── Nadia crea el perfil gestionado de "Tomás" y le da can_manage a Bruno.
--    Bruno es la pieza clave del bloque: tiene TODA la autoridad que el modelo
--    le da a un administrador de perfil gestionado -incluida la de otorgar
--    accesos, nota ⚑ de §4.4- y aun así no va a poder graduarlo.
begin;
select set_config('request.jwt.claims', '{"sub":"f2100aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare fila public.profiles%rowtype;
begin
    select * into fila from public.crear_perfil_gestionado(
        'Tomás Bloque21', date '2008-03-12', '2026-08-14-v1', '203.0.113.7'::inet);
    perform set_config('pruebas_rls.perfil_tomas_id', fila.id::text, false);

    -- Segundo gestionado, para probar la forma "GoTrue futuro" (claim ya en
    -- el INSERT) sin pisar el caso principal.
    select * into fila from public.crear_perfil_gestionado(
        'Ana Bloque21', date '2007-11-02', '2026-08-14-v1', null);
    perform set_config('pruebas_rls.perfil_ana_id', fila.id::text, false);
end $$;

insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage)
values (current_setting('pruebas_rls.perfil_tomas_id')::uuid, 'f2100000-0000-4000-8000-00000000f102', true, true, true);

commit;


-- ── ¿QUIÉN PUEDE GRADUAR? La pregunta la contesta la base, no la interfaz.
begin;
select set_config('request.jwt.claims', '{"sub":"f2100aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('21. graduación',
       'Nadia (CREADORA) puede graduar a Tomás  [CRITERIO DE ACEPTACIÓN]',
       'true',
       (select public.puede_graduar_perfil(current_setting('pruebas_rls.perfil_tomas_id')::uuid)::text));

-- Sobre su PROPIO perfil, que ya tiene cuenta: no hay nada que graduar.
select pruebas_rls.registrar('21. graduación',
       'Nadia NO puede "graduar" su propio perfil, que ya tiene cuenta',
       'false',
       (select public.puede_graduar_perfil('f2100000-0000-4000-8000-00000000f101')::text));

commit;

begin;
select set_config('request.jwt.claims', '{"sub":"f2100bbb-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;

-- Bruno TIENE la autoridad de otorgamiento sobre Tomás (nota ⚑ de §4.4: es
-- can_manage sobre un gestionado) y aun así no puede graduarlo. Los dos casos
-- van juntos para que se lea que la diferencia es deliberada y no un descuido.
select pruebas_rls.registrar('21. graduación',
       'Bruno (can_manage NO creador) SÍ tiene autoridad de otorgamiento sobre Tomás',
       'true',
       (select public.puede_otorgar_permisos(current_setting('pruebas_rls.perfil_tomas_id')::uuid)::text));

select pruebas_rls.registrar('21. graduación',
       'Bruno (can_manage NO creador) NO puede graduar a Tomás  [CASO HOSTIL]',
       'false',
       (select public.puede_graduar_perfil(current_setting('pruebas_rls.perfil_tomas_id')::uuid)::text));

commit;

begin;
select set_config('request.jwt.claims', '{"sub":"f2100ccc-3333-4333-8333-333333333333","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('21. graduación',
       'Carla (sin ningún permiso) NO puede graduar a Tomás',
       'false',
       (select public.puede_graduar_perfil(current_setting('pruebas_rls.perfil_tomas_id')::uuid)::text));

commit;

begin;
select set_config('request.jwt.claims', '', true);
set local role anon;

do $$
declare v text;
begin
    begin
        perform public.puede_graduar_perfil(current_setting('pruebas_rls.perfil_tomas_id')::uuid);
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('21. graduación',
        'anon no puede ejecutar puede_graduar_perfil (sin GRANT EXECUTE)',
        'denegado (42501)', v);
end $$;

commit;


-- ── CASO HOSTIL CENTRAL: `perfil_existente` en `raw_user_meta_data`.
--    Es la metadata que viaja en `options.data` de `signUp`, o sea la que
--    escribe cualquiera desde el navegador con la clave anónima. Si el trigger
--    la leyera, este INSERT sería suficiente para adueñarse del historial
--    médico de Tomás. Se procesa como un alta normal y no toca nada ajeno.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values ('f2100fff-6666-4666-8666-666666666666', 'atacante21@test.local',
        jsonb_build_object('perfil_existente', current_setting('pruebas_rls.perfil_tomas_id'),
                           'full_name', 'Atacante Bloque21'),
        '{}');

select pruebas_rls.registrar('21. graduación',
       'Un perfil_existente en raw_user_meta_data NO roba el perfil ajeno  [CASO HOSTIL]',
       'sigue gestionado (user_id NULL)',
       (select case when user_id is null then 'sigue gestionado (user_id NULL)'
                    else 'ROBADO por ' || user_id::text end
          from public.profiles
         where id = current_setting('pruebas_rls.perfil_tomas_id')::uuid));

select pruebas_rls.registrar('21. graduación',
       'Esa alta hostil se procesó como un alta NORMAL: la cuenta estrenó su propio perfil',
       'Atacante Bloque21',
       (select full_name from public.profiles
         where user_id = 'f2100fff-6666-4666-8666-666666666666'));

select pruebas_rls.registrar('21. graduación',
       'Y firmó sus dos consentimientos de alta, como cualquier registro público',
       'privacidad, terminos',
       (select string_agg(document, ', ' order by document) from public.consents
         where user_id = 'f2100fff-6666-4666-8666-666666666666'));


-- ── FOOTGUN CERRADO: estamparle el claim a una cuenta VIEJA, ya en uso.
--    Es el riesgo que abre tener que deshacer el alta automática: si la
--    condición de borrado fuera laxa, esto le borraría a alguien su perfil
--    real -con su historial médico adentro- para dárselo a otro. La condición
--    `created_at = now()` -exacta, no una ventana de tiempo- lo cierra: el
--    perfil de esta cuenta nació en OTRA transacción, no lo alcanza el delete,
--    y la operación termina rechazada.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values ('f2100666-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'vieja21@test.local',
        '{"full_name":"Cuenta Vieja Bloque21"}', '{}');

do $$
declare v text;
begin
    begin
        update auth.users
           set raw_app_meta_data = jsonb_build_object(
                   'perfil_existente', current_setting('pruebas_rls.perfil_tomas_id'))
         where id = 'f2100666-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        v := 'vinculada';
    exception when insufficient_privilege then v := 'rechazada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('21. graduación',
        'Estamparle el claim a una cuenta VIEJA es rechazado  [CASO HOSTIL]',
        'rechazada (42501)', v);
end $$;

select pruebas_rls.registrar('21. graduación',
       'La cuenta vieja conserva su perfil propio y Tomás sigue sin dueño',
       'Cuenta Vieja Bloque21 / Tomás sigue gestionado',
       (select (select full_name from public.profiles
                 where user_id = 'f2100666-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
               || ' / ' ||
               (select case when user_id is null then 'Tomás sigue gestionado' else 'Tomás ROBADO' end
                  from public.profiles
                 where id = current_setting('pruebas_rls.perfil_tomas_id')::uuid)));


-- ── METADATA ROTA: el alta se DESHACE entera. La regla de oro tiene dos
--    mitades -no dejar una cuenta sin poder entrar, y no robar un perfil
--    ajeno- y abortar el alta es lo único que satisface las dos: no queda
--    nadie afuera de su cuenta porque no llega a haber cuenta. Se reproduce
--    la forma real: INSERT y UPDATE en la MISMA transacción (el `do` block).
do $$
declare v text;
begin
    begin
        insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
        values ('f2100888-8888-4888-8888-888888888888', 'rota21b@test.local', '{}', '{}');
        update auth.users set raw_app_meta_data = '{"perfil_existente":"no-soy-un-uuid"}'
         where id = 'f2100888-8888-4888-8888-888888888888';
        v := 'creada';
    exception when sqlstate '22023' then v := 'rechazada (22023)';
             when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('21. graduación',
        'Un perfil_existente que no tiene forma de uuid aborta el alta',
        'rechazada (22023)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
        values ('f2100999-7777-4777-8777-777777777777', 'rota21a@test.local', '{}', '{}');
        update auth.users
           set raw_app_meta_data = '{"perfil_existente":"f2100aaa-0000-4000-8000-00000000dead"}'
         where id = 'f2100999-7777-4777-8777-777777777777';
        v := 'creada';
    exception when insufficient_privilege then v := 'rechazada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('21. graduación',
        'Un perfil_existente que apunta a un perfil inexistente aborta el alta',
        'rechazada (42501)', v);
end $$;

select pruebas_rls.registrar('21. graduación',
       'Ninguna de las dos altas rotas dejó una cuenta a medio vincular en auth.users',
       '0 cuentas',
       (select count(*)::text || ' cuentas' from auth.users
         where id in ('f2100888-8888-4888-8888-888888888888',
                      'f2100999-7777-4777-8777-777777777777')));


-- ── LA GRADUACIÓN DE VERDAD, con la forma REAL de `auth.admin.createUser`:
--    INSERT sin el claim (que dispara el alta normal y le estrena a la cuenta
--    un perfil propio en blanco) + UPDATE que agrega el claim, todo en la
--    MISMA transacción. Ver "CÓMO SE SIMULA LA GRADUACIÓN" en el encabezado
--    del bloque.
do $$
begin
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values ('f2100ddd-4444-4444-8444-444444444444', 'tomas21@test.local',
            '{"full_name":"Tomás Bloque21"}', '{"provider":"email"}');

    -- Comprobación intermedia, DENTRO de la transacción: el alta normal ya
    -- corrió y dejó el perfil en blanco. Es el estado que el trigger de
    -- graduación tiene que deshacer, y dejarlo asentado es lo que hace que el
    -- caso siguiente signifique algo.
    perform pruebas_rls.registrar('21. graduación',
        'Antes del claim, el INSERT ya le estrenó a la cuenta un perfil propio en blanco',
        '1 perfiles en blanco / 2 consents',
        (select count(*) from public.profiles
          where user_id = 'f2100ddd-4444-4444-8444-444444444444')::text
        || ' perfiles en blanco / ' ||
        (select count(*) from public.consents
          where user_id = 'f2100ddd-4444-4444-8444-444444444444')::text || ' consents');

    update auth.users
       set raw_app_meta_data = raw_app_meta_data
           || jsonb_build_object('perfil_existente', current_setting('pruebas_rls.perfil_tomas_id'))
     where id = 'f2100ddd-4444-4444-8444-444444444444';
end $$;

select pruebas_rls.registrar('21. graduación',
       'El perfil gestionado queda VINCULADO a la cuenta nueva  [CRITERIO DE ACEPTACIÓN]',
       'vinculado a la cuenta nueva',
       (select case when user_id = 'f2100ddd-4444-4444-8444-444444444444'
                    then 'vinculado a la cuenta nueva'
                    when user_id is null then 'sigue sin cuenta'
                    else 'vinculado a otra cuenta' end
          from public.profiles
         where id = current_setting('pruebas_rls.perfil_tomas_id')::uuid));

-- Vincular, no crear: la cuenta graduada tiene UN perfil y es el que ya
-- existía, con su historia. Si el trigger hubiera caído al camino normal
-- habría dos filas (o una nueva y en blanco).
select pruebas_rls.registrar('21. graduación',
       'La cuenta graduada NO estrenó un perfil nuevo: tiene el de siempre',
       '1 perfiles / es el mismo',
       (select count(*)::text || ' perfiles / ' ||
               case when bool_and(p.id = current_setting('pruebas_rls.perfil_tomas_id')::uuid)
                    then 'es el mismo' else 'es otro' end
          from public.profiles p
         where p.user_id = 'f2100ddd-4444-4444-8444-444444444444'));

-- El perfil sigue siendo EL MISMO objeto: su fecha de nacimiento y la huella
-- de quién lo creó sobreviven a la graduación.
select pruebas_rls.registrar('21. graduación',
       'El perfil conserva sus datos y la huella de quién lo creó (created_by_profile_id)',
       '2008-03-12 / creado por Nadia',
       (select date_of_birth::text || ' / ' ||
               case when created_by_profile_id = 'f2100000-0000-4000-8000-00000000f101'
                    then 'creado por Nadia' else 'otro creador' end
          from public.profiles
         where id = current_setting('pruebas_rls.perfil_tomas_id')::uuid));

-- El punto legal de la tarea: la cuenta graduada NACE SIN CONSENTIMIENTOS.
-- Hasta la graduación regía el del representante, que habla de él y no se
-- transfiere; los suyos los firma el titular en el gate /aceptar-terminos.
select pruebas_rls.registrar('21. graduación',
       'La cuenta graduada nace SIN consentimientos: los firma su titular en el gate',
       '0 consents',
       (select count(*)::text || ' consents' from public.consents
         where user_id = 'f2100ddd-4444-4444-8444-444444444444'));

-- Decisión de producto cerrada con el usuario: los accesos SE MANTIENEN.
select pruebas_rls.registrar('21. graduación',
       'Los accesos existentes SE MANTIENEN tras graduar (Nadia y Bruno siguen)  [CRITERIO DE ACEPTACIÓN]',
       '2 accesos',
       (select count(*)::text || ' accesos' from public.family_permissions
         where owner_profile_id = current_setting('pruebas_rls.perfil_tomas_id')::uuid
           and granted_profile_id in ('f2100000-0000-4000-8000-00000000f101',
                                      'f2100000-0000-4000-8000-00000000f102')));

-- Idempotencia: el backfill de 20260814140000 §3 recorre TODAS las cuentas y
-- volvería a pasar por esta. No puede duplicar el perfil, ni inventar el
-- consentimiento que su titular todavía no dio, ni fallar.
do $$
begin
    perform public.completar_alta_de_cuenta('f2100ddd-4444-4444-8444-444444444444');
    perform public.completar_alta_de_cuenta('f2100ddd-4444-4444-8444-444444444444');
end $$;

select pruebas_rls.registrar('21. graduación',
       'Volver a completar el alta de la cuenta graduada no duplica ni inventa nada',
       '1 perfiles / 0 consents',
       (select (select count(*) from public.profiles where user_id = 'f2100ddd-4444-4444-8444-444444444444')::text
               || ' perfiles / ' ||
               (select count(*) from public.consents where user_id = 'f2100ddd-4444-4444-8444-444444444444')::text
               || ' consents'));


-- ── LA OTRA FORMA: el claim YA viene en el INSERT. Hoy GoTrue no lo hace
--    (medido), pero si una versión futura lo hiciera, la graduación tiene que
--    seguir funcionando -y por ese camino ni siquiera hace falta deshacer
--    nada, porque el alta normal nunca llega a correr-. Es lo que evita que
--    esta implementación vuelva a depender de un detalle interno ajeno.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values ('f2100777-9999-4999-8999-999999999999', 'ana21@test.local',
        '{"full_name":"Ana Bloque21"}',
        jsonb_build_object('perfil_existente', current_setting('pruebas_rls.perfil_ana_id')));

select pruebas_rls.registrar('21. graduación',
       'Con el claim ya en el INSERT también vincula, y sin perfil en blanco de por medio',
       'vinculado / 1 perfiles / 0 consents',
       (select case when p.user_id = 'f2100777-9999-4999-8999-999999999999'
                    then 'vinculado' else 'NO vinculado' end
          from public.profiles p
         where p.id = current_setting('pruebas_rls.perfil_ana_id')::uuid)
       || ' / ' ||
       (select count(*) from public.profiles
         where user_id = 'f2100777-9999-4999-8999-999999999999')::text || ' perfiles / ' ||
       (select count(*) from public.consents
         where user_id = 'f2100777-9999-4999-8999-999999999999')::text || ' consents');


-- ── GRADUAR UN PERFIL YA GRADUADO: lo rechaza LA BASE, no la interfaz.
do $$
declare v text;
begin
    begin
        insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
        values ('f2100eee-5555-4555-8555-555555555555', 'segundo21@test.local', '{}',
                '{"provider":"email"}');
        update auth.users
           set raw_app_meta_data = raw_app_meta_data
               || jsonb_build_object('perfil_existente', current_setting('pruebas_rls.perfil_tomas_id'))
         where id = 'f2100eee-5555-4555-8555-555555555555';
        v := 'creada';
    exception when insufficient_privilege then v := 'rechazada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('21. graduación',
        'Graduar un perfil YA graduado es rechazado por la base  [CASO HOSTIL]',
        'rechazada (42501)', v);
end $$;

select pruebas_rls.registrar('21. graduación',
       'Ese segundo intento no dejó cuenta ni le cambió el dueño al perfil',
       '0 cuentas / dueño intacto',
       (select (select count(*) from auth.users where id = 'f2100eee-5555-4555-8555-555555555555')::text
               || ' cuentas / ' ||
               (select case when user_id = 'f2100ddd-4444-4444-8444-444444444444'
                            then 'dueño intacto' else 'dueño CAMBIADO' end
                  from public.profiles
                 where id = current_setting('pruebas_rls.perfil_tomas_id')::uuid)));

-- Y `puede_graduar_perfil` deja de decir que sí, incluso para su creadora.
begin;
select set_config('request.jwt.claims', '{"sub":"f2100aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('21. graduación',
       'Ni siquiera Nadia puede volver a graduar a Tomás una vez graduado',
       'false',
       (select public.puede_graduar_perfil(current_setting('pruebas_rls.perfil_tomas_id')::uuid)::text));

commit;


-- ── LA AUTORIDAD SE TRANSFIERE SOLA (§8.6 punto 4). No se migró un solo dato:
--    las políticas leen `user_id IS NULL` en tiempo de consulta, así que
--    dejar de ser NULL les cambia la respuesta en la consulta siguiente.
select pruebas_rls.registrar('21. graduación',
       'El perfil dejó de ser gestionado para toda la base (es_perfil_gestionado)',
       'false',
       (select public.es_perfil_gestionado(current_setting('pruebas_rls.perfil_tomas_id')::uuid)::text));

begin;
select set_config('request.jwt.claims', '{"sub":"f2100aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('21. graduación',
       'Nadia PERDIÓ la autoridad de otorgamiento sobre Tomás (la nota ⚑ dejó de aplicar)',
       'false',
       (select public.puede_otorgar_permisos(current_setting('pruebas_rls.perfil_tomas_id')::uuid)::text));

-- Lo que NO perdió: sigue pudiendo administrar el contenido, porque su fila
-- de can_manage sigue viva. Es exactamente la decisión de producto.
select pruebas_rls.registrar('21. graduación',
       'Nadia conserva la administración del contenido (su can_manage sigue vivo)',
       'true',
       (select public.puede_administrar_perfil(current_setting('pruebas_rls.perfil_tomas_id')::uuid)::text));

commit;

begin;
select set_config('request.jwt.claims', '{"sub":"f2100ddd-4444-4444-8444-444444444444","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('21. graduación',
       'Tomás es ahora el TITULAR de su perfil y tiene la autoridad de otorgamiento',
       'titular=true / otorga=true',
       (select 'titular=' || public.es_titular(current_setting('pruebas_rls.perfil_tomas_id')::uuid)::text
               || ' / otorga=' || public.puede_otorgar_permisos(current_setting('pruebas_rls.perfil_tomas_id')::uuid)::text));

select pruebas_rls.registrar('21. graduación',
       'Tomás ve su propio perfil en el selector', '1 filas',
       count(*) || ' filas')
  from public.profiles where id = current_setting('pruebas_rls.perfil_tomas_id')::uuid;

commit;


-- ── LA NOTA ② SIGUE EN PIE: desde una sesión de usuario, `profiles.user_id`
--    es inmutable. Ni para adueñarse de un perfil ajeno, ni para
--    "des-graduar" al que uno mismo graduó.
begin;
select set_config('request.jwt.claims', '{"sub":"f2100ddd-4444-4444-8444-444444444444","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        update public.profiles set user_id = 'f2100ccc-3333-4333-8333-333333333333'
         where id = current_setting('pruebas_rls.perfil_tomas_id')::uuid;
        v := 'cambió la titularidad';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('21. graduación',
        'El titular NO puede regalar su perfil a otra cuenta desde la aplicación (nota ②)',
        'rechazado (42501)', v);
end $$;

commit;

begin;
select set_config('request.jwt.claims', '{"sub":"f2100aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v text;
begin
    begin
        update public.profiles set user_id = null
         where id = current_setting('pruebas_rls.perfil_tomas_id')::uuid;
        v := 'des-graduado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('21. graduación',
        'Nadia (can_manage) NO puede DES-graduar a Tomás desde la aplicación (nota ②)',
        'rechazado (42501)', v);
end $$;

commit;


-- ── EL GATE DE LEGALES: el nuevo titular firma SUS documentos, con su propio
--    user_id. Es literalmente lo que hace `registrarLegalesDeAlta`
--    (`lib/legales.ts`) con el cliente del USUARIO, bajo consents_insert_propio.
begin;
select set_config('request.jwt.claims', '{"sub":"f2100ddd-4444-4444-8444-444444444444","role":"authenticated"}', true);
set local role authenticated;

insert into public.consents (user_id, document, version, ip)
select 'f2100ddd-4444-4444-8444-444444444444', d.documento, '2026-08-14-v1', '203.0.113.9'::inet
  from (values ('privacidad'), ('terminos')) as d (documento);

-- Y no puede firmar a nombre de otra cuenta: un consentimiento que se puede
-- firmar por un tercero no es un consentimiento.
do $$
declare v text;
begin
    begin
        insert into public.consents (user_id, document, version)
        values ('f2100aaa-1111-4111-8111-111111111111', 'privacidad', '2026-08-14-v1');
        v := 'firmado por otro';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('21. graduación',
        'Tomás NO puede firmar el consentimiento a nombre de otra cuenta',
        'denegado (42501)', v);
end $$;

commit;

select pruebas_rls.registrar('21. graduación',
       'El gate selló los DOS consentimientos del nuevo titular con su propio user_id  [CRITERIO DE ACEPTACIÓN]',
       'privacidad, terminos / 2026-08-14-v1',
       (select string_agg(document, ', ' order by document) || ' / ' || min(version)
          from public.consents
         where user_id = 'f2100ddd-4444-4444-8444-444444444444'));


-- ── EL CRITERIO DE ACEPTACIÓN DEL SPRINT: ya como titular, Tomás revoca el
--    acceso de quien lo administraba. El trigger de no orfandad (D4) no lo
--    impide y está bien: solo protege perfiles GESTIONADOS, y este ya no lo
--    es -su titular siempre puede entrar, así que no puede quedar huérfano
--    (§8.2)-.
begin;
select set_config('request.jwt.claims', '{"sub":"f2100ddd-4444-4444-8444-444444444444","role":"authenticated"}', true);
set local role authenticated;

delete from public.family_permissions
 where owner_profile_id = current_setting('pruebas_rls.perfil_tomas_id')::uuid
   and granted_profile_id = 'f2100000-0000-4000-8000-00000000f101';

commit;

select pruebas_rls.registrar('21. graduación',
       'El nuevo titular revoca el acceso de quien lo administraba  [CRITERIO DE ACEPTACIÓN]',
       '0 accesos de Nadia',
       (select count(*)::text || ' accesos de Nadia' from public.family_permissions
         where owner_profile_id = current_setting('pruebas_rls.perfil_tomas_id')::uuid
           and granted_profile_id = 'f2100000-0000-4000-8000-00000000f101'));

begin;
select set_config('request.jwt.claims', '{"sub":"f2100aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('21. graduación',
       'Revocada, Nadia ya no ve el perfil de Tomás', '0 filas',
       count(*) || ' filas')
  from public.profiles where id = current_setting('pruebas_rls.perfil_tomas_id')::uuid;

commit;

begin;
select set_config('request.jwt.claims', '{"sub":"f2100bbb-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;

select pruebas_rls.registrar('21. graduación',
       'Bruno, a quien Tomás decidió conservar, sigue viendo el perfil', '1 filas',
       count(*) || ' filas')
  from public.profiles where id = current_setting('pruebas_rls.perfil_tomas_id')::uuid;

commit;


-- ── Invariantes estructurales de la función nueva (mismo centinela que el
--    BLOQUE 19 tiene para `completar_alta_de_cuenta`): sin DEFINER no podría
--    leer `profiles` sin recursar en su propia política, y con el search_path
--    heredado sería escalable por quien pueda crear objetos en el path.
select pruebas_rls.registrar('21. graduación',
       'puede_graduar_perfil es SECURITY DEFINER y fija su search_path',
       'definer/search_path fijado',
       (select case when p.prosecdef then 'definer' else 'invoker' end
               || '/' ||
               case when coalesce(array_to_string(p.proconfig, ','), '') like 'search_path=%'
                    then 'search_path fijado' else 'search_path heredado' end
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'puede_graduar_perfil'));


-- =============================================================================
-- BLOQUE 22 — Catálogo REFES de centros de salud (Sprint 16, tarea 16.3)
-- -----------------------------------------------------------------------------
-- `health_centers` y `health_centers_sync` son las PRIMERAS tablas del
-- proyecto sin dueño: no cuelgan de un `profile_id` y la matriz de
-- docs/modelo-permisos.md no tiene nada que decidir sobre ellas. Su modelo es
-- otro y este bloque lo verifica entero:
--
--   · `authenticated` LEE todo y NO ESCRIBE NADA (ni el catálogo ni el lock).
--   · `anon` no ve ni una fila -la lección de siempre: toda tabla nueva
--     repite su propio `revoke`, porque el `revoke all on all tables` de
--     `20260812220000_rls.sql` §4 fue una foto, no una regla viva-.
--   · `service_role` es el único que escribe.
--   · El LOCK de sincronización no se puede tomar ni tocar desde una sesión
--     del navegador, es atómico entre dos llamadas simultáneas, y CADUCA.
--
-- Las dos capas se prueban por separado a propósito: que falte la política y
-- que falte el privilegio son dos candados independientes, y un bloque que
-- solo probara "no puedo escribir" no distinguiría cuál de los dos se cayó.
-- =============================================================================
\echo '### BLOQUE 22 — catálogo REFES: lectura para todos, escritura para nadie'

-- El total real del catálogo (el seed carga 24; si alguien sincronizó de
-- verdad contra el portal antes de correr el arnés, son 36.046). Se lee ACÁ,
-- como postgres, para comparar contra lo que ve una sesión con cuenta sin
-- clavar un número que dependa del estado local.
select count(*)::text as total_catalogo from public.health_centers \gset

begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

-- ── Lectura: el catálogo entero, sin filtro por perfil.
-- Va como SQL plano y no adentro de un `do $$`: psql NO interpola sus
-- variables (`:'total_catalogo'`) dentro de un bloque con comillas de dólar,
-- así que el `:'...'` quedaría literal y sería un error de sintaxis. Como
-- este caso espera ÉXITO, tampoco hace falta el `exception` que sí llevan los
-- bloques de más abajo, que esperan un rechazo.
select pruebas_rls.registrar('22. catálogo REFES',
       'María lee el catálogo completo', :'total_catalogo',
       (select count(*)::text from public.health_centers));

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.health_centers_sync;
        v := c || ' fila(s)';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'María lee el estado de la sincronización (para "última actualización")',
        '1 fila(s)', v);
end $$;

-- ── Escritura del catálogo: las tres, rechazadas
do $$
declare v text;
begin
    begin
        insert into public.health_centers (refes_id, name, province_refes, search_text)
        values ('99999999999999', 'CLINICA TRUCHA', 'BUENOS AIRES', 'clinica trucha');
        v := 'insertado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'María inserta un centro en el catálogo', 'rechazado (42501)', v);
end $$;

do $$
declare v text; n integer;
begin
    begin
        update public.health_centers set name = 'NOMBRE CAMBIADO A MANO';
        get diagnostics n = row_count;
        v := n || ' filas modificadas';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'María renombra un centro del catálogo', 'rechazado (42501)', v);
end $$;

do $$
declare v text; n integer;
begin
    begin
        delete from public.health_centers;
        get diagnostics n = row_count;
        v := n || ' filas borradas';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'María borra el catálogo entero', 'rechazado (42501)', v);
end $$;

-- ── El LOCK no se manipula desde el navegador
do $$
declare v text; n integer;
begin
    begin
        update public.health_centers_sync set status = 'idle', run_started_by = null;
        get diagnostics n = row_count;
        v := n || ' filas modificadas';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'María libera a mano el lock de sincronización', 'rechazado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.health_centers_sync (id) values (false);
        v := 'insertado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'María agrega una segunda fila de estado', 'rechazado (42501)', v);
end $$;

do $$
declare v text; n integer;
begin
    begin
        delete from public.health_centers_sync;
        get diagnostics n = row_count;
        v := n || ' filas borradas';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'María borra la fila de estado', 'rechazado (42501)', v);
end $$;

-- ── La función del lock es SECURITY DEFINER: la corre el Route Handler con
--    service_role, nunca una sesión del navegador (mismo criterio que todas
--    las funciones auxiliares del proyecto, docs/modelo-permisos.md §6).
do $$
declare v text; r boolean;
begin
    begin
        select public.reclamar_sincronizacion_refes(
            '11111111-1111-4111-8111-111111111111'::uuid, 120) into r;
        v := 'ejecutó y devolvió ' || coalesce(r::text, 'null');
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'María toma el lock llamando a la función directo', 'rechazado (42501)', v);
end $$;

commit;


-- ── anon: nada de nada
begin;
select set_config('request.jwt.claims', '', true);
set local role anon;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.health_centers;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'anon lee el catálogo', 'denegado (42501)', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.health_centers_sync;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'anon lee el estado de la sincronización', 'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.health_centers (refes_id, name, province_refes, search_text)
        values ('88888888888888', 'CLINICA ANONIMA', 'BUENOS AIRES', 'clinica anonima');
        v := 'insertado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'anon inserta un centro', 'rechazado (42501)', v);
end $$;

do $$
declare v text; r boolean;
begin
    begin
        select public.reclamar_sincronizacion_refes(null, 120) into r;
        v := 'ejecutó';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'anon toma el lock de sincronización', 'rechazado (42501)', v);
end $$;

commit;


-- ── Las dos capas, por separado: privilegios y políticas
select pruebas_rls.registrar('22. catálogo REFES',
       'Privilegios de authenticated sobre health_centers',
       'SELECT',
       coalesce((select string_agg(privilege_type, ', ' order by privilege_type)
                   from information_schema.role_table_grants
                  where table_schema = 'public' and table_name = 'health_centers'
                    and grantee = 'authenticated'), '(ninguno)'));

select pruebas_rls.registrar('22. catálogo REFES',
       'Privilegios de authenticated sobre health_centers_sync',
       'SELECT',
       coalesce((select string_agg(privilege_type, ', ' order by privilege_type)
                   from information_schema.role_table_grants
                  where table_schema = 'public' and table_name = 'health_centers_sync'
                    and grantee = 'authenticated'), '(ninguno)'));

select pruebas_rls.registrar('22. catálogo REFES',
       'Privilegios de anon sobre las dos tablas del catálogo', '0',
       (select count(*)::text
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name in ('health_centers', 'health_centers_sync')
           and grantee = 'anon'));

select pruebas_rls.registrar('22. catálogo REFES',
       'Políticas de ESCRITURA en las dos tablas del catálogo', '0',
       (select count(*)::text
          from pg_policies
         where schemaname = 'public'
           and tablename in ('health_centers', 'health_centers_sync')
           and cmd <> 'SELECT'));

select pruebas_rls.registrar('22. catálogo REFES',
       'Las dos tablas del catálogo con RLS habilitada', '2',
       (select count(*)::text
          from pg_tables
         where schemaname = 'public'
           and tablename in ('health_centers', 'health_centers_sync')
           and rowsecurity));

select pruebas_rls.registrar('22. catálogo REFES',
       'reclamar_sincronizacion_refes es SECURITY DEFINER y fija su search_path',
       'definer/search_path fijado',
       (select case when p.prosecdef then 'definer' else 'invoker' end
               || '/' ||
               case when coalesce(array_to_string(p.proconfig, ','), '') like 'search_path=%'
                    then 'search_path fijado' else 'search_path heredado' end
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'reclamar_sincronizacion_refes'));

-- La auditoría de "quién apretó Actualizar" no puede impedir dar de baja una
-- cuenta: la FK es ON DELETE SET NULL ('n'), no RESTRICT ni CASCADE.
select pruebas_rls.registrar('22. catálogo REFES',
       'run_started_by referencia auth.users con ON DELETE SET NULL', 'n',
       (select c.confdeltype::text
          from pg_constraint c
          join pg_class t on t.oid = c.conrelid
         where t.relname = 'health_centers_sync' and c.contype = 'f'));


-- ── El lock: atómico, exclusivo y CADUCABLE (como service_role, que es quien
--    lo usa de verdad desde app/api/lugares/sincronizar/route.ts).
begin;
set local role service_role;

do $$
declare primera boolean; segunda boolean;
begin
    -- Estado limpio de partida.
    update public.health_centers_sync
       set status = 'idle', run_heartbeat_at = null, run_started_by = null, run_error = null;

    select public.reclamar_sincronizacion_refes(
        '11111111-1111-4111-8111-111111111111'::uuid, 120) into primera;
    -- Segunda persona apretando "Actualizar" en el mismo minuto.
    select public.reclamar_sincronizacion_refes(
        '22222222-2222-4222-8222-222222222222'::uuid, 120) into segunda;

    perform pruebas_rls.registrar('22. catálogo REFES',
        'Dos "Actualizar" seguidos: solo el primero se lleva el lock',
        'true/false', primera::text || '/' || segunda::text);
end $$;

do $$
declare v uuid;
begin
    select run_started_by into v from public.health_centers_sync;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'Queda auditado quién disparó la sincronización',
        '11111111-1111-4111-8111-111111111111', coalesce(v::text, '(nadie)'));
end $$;

do $$
declare tomado boolean;
begin
    -- Lock CADUCADO: la pestaña se cerró y el latido quedó viejo. Con un TTL
    -- de 1 segundo y un latido de hace una hora, la llamada siguiente se lo
    -- lleva. Sin esta cláusula, una corrida abandonada dejaría el botón
    -- "Actualizar" muerto para siempre.
    update public.health_centers_sync set run_heartbeat_at = now() - interval '1 hour';

    select public.reclamar_sincronizacion_refes(
        '22222222-2222-4222-8222-222222222222'::uuid, 1) into tomado;

    perform pruebas_rls.registrar('22. catálogo REFES',
        'Un lock sin latido caduca y la corrida siguiente lo toma', 'true', tomado::text);
end $$;

-- ── service_role SÍ escribe el catálogo: es el camino real de la
--    sincronización, y probar solo las prohibiciones dejaría sin verificar
--    que el camino permitido funciona.
do $$
declare v text; c integer;
begin
    begin
        insert into public.health_centers (refes_id, name, province_refes, search_text)
        values ('00000000000000', 'CENTRO DE PRUEBA DEL ARNÉS', 'BUENOS AIRES', 'centro de prueba del arnes')
        on conflict (refes_id) do update set name = excluded.name;
        select count(*) into c from public.health_centers where refes_id = '00000000000000';
        v := c || ' fila';
    exception when others then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'service_role hace upsert de un centro (el camino de la sincronización)', '1 fila', v);
end $$;

-- La fila de estado es ÚNICA por construcción (PK booleana + CHECK id).
do $$
declare v text;
begin
    begin
        insert into public.health_centers_sync (id) values (false);
        v := 'insertada';
    exception when check_violation      then v := 'rechazada por el CHECK';
             when unique_violation      then v := 'rechazada por la PK';
             when others                then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('22. catálogo REFES',
        'Ni service_role puede crear una segunda fila de estado',
        'rechazada por el CHECK', v);
end $$;

-- Limpieza del bloque: el centro de prueba y el estado como estaba.
delete from public.health_centers where refes_id = '00000000000000';
update public.health_centers_sync
   set status = 'idle', run_heartbeat_at = null, run_started_by = null, run_error = null,
       run_started_at = null;

commit;


-- =============================================================================
-- BLOQUE 23 — Conexión de Gmail y el refresh token (Sprint 17, tarea 17.1)
-- -----------------------------------------------------------------------------
-- `gmail_connections` guarda el ESTADO de la casilla conectada de una CUENTA;
-- el `refresh_token` -la credencial de verdad, con la que se lee el correo de
-- una persona hasta que ella revoque el permiso- vive CIFRADO en el Vault de
-- Supabase (`20260818130000_gmail_conexiones.sql`). Este bloque prueba las
-- cuatro capas que lo separan de una sesión del navegador, cada una por
-- separado, porque si mañana se cae una hay que saber CUÁL:
--
--   1. **RLS por fila** — el dueño ve su conexión y NO la de otra cuenta.
--   2. **Privilegio por COLUMNA** — ni siquiera dentro de su propia fila puede
--      leer `token_secret_id` ni `granted_scopes`: no están en el GRANT. Un
--      `select *` -que es lo que manda PostgREST si nadie nombra las columnas-
--      no devuelve menos columnas: falla entero con 42501.
--   3. **El esquema `vault` es inalcanzable** para `anon` y `authenticated`.
--      Este es EL caso del bloque: aunque las tres capas de arriba fallaran a
--      la vez, en `public` no hay ningún token que leer.
--   4. **Las funciones SECURITY DEFINER** que tocan el Vault solo las puede
--      ejecutar `service_role`.
--
-- Y además el ciclo de vida completo desde `service_role`: guardar, leer,
-- vencer, reconectar, desconectar — y que la BAJA DE LA CUENTA se lleve el
-- token cifrado, que es lo que hace que el derecho de supresión de la Ley
-- 25.326 alcance también al Vault.
-- =============================================================================
\echo '### BLOQUE 23 — conexión de Gmail: el token no existe para el navegador'

-- Dos cuentas: Elena conecta su Gmail, Rubén también (para probar el cruce).
insert into auth.users (id, email, instance_id, aud, role, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
    ('f2200aaa-1111-4111-8111-111111111111', 'elena.gmail@ejemplo.com.ar',
     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'x', now(), now(), now()),
    ('f2200bbb-2222-4222-8222-222222222222', 'ruben.gmail@ejemplo.com.ar',
     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'x', now(), now(), now());

-- Las dos conexiones se crean por el ÚNICO camino que existe: la función
-- SECURITY DEFINER, corriendo como service_role (que es como la llama
-- app/api/gmail/callback/route.ts).
begin;
set local role service_role;

do $$
declare v text;
begin
    perform public.guardar_conexion_gmail(
        'f2200aaa-1111-4111-8111-111111111111'::uuid,
        'elena@gmail.com', 'ELENA-REFRESH-TOKEN', 'Label_100', 'historialmedico',
        'https://www.googleapis.com/auth/gmail.readonly');
    perform public.guardar_conexion_gmail(
        'f2200bbb-2222-4222-8222-222222222222'::uuid,
        'ruben@gmail.com', 'RUBEN-REFRESH-TOKEN', 'Label_200', 'historialmedico',
        'https://www.googleapis.com/auth/gmail.readonly');

    select count(*)::text into v from public.gmail_connections
     where user_id in ('f2200aaa-1111-4111-8111-111111111111',
                       'f2200bbb-2222-4222-8222-222222222222');
    perform pruebas_rls.registrar('23. Gmail',
        'service_role guarda las dos conexiones', '2', v);
end $$;

-- El token quedó en el Vault, cifrado, y NO en ninguna columna de public.
do $$
declare v text;
begin
    select public.leer_refresh_token_gmail('f2200aaa-1111-4111-8111-111111111111'::uuid) into v;
    perform pruebas_rls.registrar('23. Gmail',
        'service_role descifra el refresh token de Elena', 'ELENA-REFRESH-TOKEN',
        coalesce(v, '(nulo)'));
end $$;

do $$
declare v text;
begin
    -- Barrido de TODAS las columnas de texto de la tabla buscando el token.
    -- Si alguna vez alguien agrega una columna `refresh_token text`, este caso
    -- se cae y hay que mirar por qué.
    select case when exists (
        select 1 from public.gmail_connections c
         where c::text like '%ELENA-REFRESH-TOKEN%'
    ) then 'aparece en la tabla' else 'no aparece en la tabla' end into v;
    perform pruebas_rls.registrar('23. Gmail',
        'El refresh token NO está en ninguna columna de gmail_connections',
        'no aparece en la tabla', v);
end $$;

commit;


-- ── CAPA 1 y 2: la sesión de Elena
begin;
select set_config('request.jwt.claims',
    '{"sub":"f2200aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.gmail_connections;
        v := c::text || ' fila(s)';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena ve UNA conexión: la suya (la de Rubén no existe para ella)',
        '1 fila(s)', v);
end $$;

do $$
declare v text;
begin
    select coalesce(max(email), '(ninguna)') into v from public.gmail_connections;
    perform pruebas_rls.registrar('23. Gmail',
        'Y la que ve es la suya', 'elena@gmail.com', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.gmail_connections
         where user_id = 'f2200bbb-2222-4222-8222-222222222222';
        v := c::text || ' fila(s)';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena pide explícitamente la conexión de Rubén', '0 fila(s)', v);
end $$;

-- CAPA 2: el privilegio por columna. Es lo que hace que ni en su propia fila
-- pueda ver el puntero al Vault.
do $$
declare v text; t uuid;
begin
    begin
        select token_secret_id into t from public.gmail_connections
         where user_id = 'f2200aaa-1111-4111-8111-111111111111';
        v := 'leído: ' || coalesce(t::text, 'nulo');
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena lee token_secret_id DE SU PROPIA FILA', 'denegado (42501)', v);
end $$;

do $$
declare v text; s text;
begin
    begin
        select granted_scopes into s from public.gmail_connections
         where user_id = 'f2200aaa-1111-4111-8111-111111111111';
        v := 'leído: ' || coalesce(s, 'nulo');
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena lee granted_scopes de su propia fila', 'denegado (42501)', v);
end $$;

do $$
declare v text; c integer;
begin
    -- `select *` es exactamente lo que manda PostgREST cuando nadie nombra las
    -- columnas: tiene que FALLAR, no devolver menos columnas.
    begin
        execute 'select count(*) from (select * from public.gmail_connections) x' into c;
        v := 'devolvió ' || c::text || ' fila(s)';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena hace select * (lo que manda PostgREST sin lista de columnas)',
        'denegado (42501)', v);
end $$;

-- Escrituras: las cuatro rechazadas, cada una por su lado.
do $$
declare v text;
begin
    begin
        insert into public.gmail_connections (user_id, email)
        values ('f2200aaa-1111-4111-8111-111111111111', 'trucha@gmail.com');
        v := 'insertada';
    exception when insufficient_privilege then v := 'rechazada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena inserta una conexión a mano', 'rechazada (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        update public.gmail_connections set email = 'otra@gmail.com'
         where user_id = 'f2200aaa-1111-4111-8111-111111111111';
        v := 'actualizada';
    exception when insufficient_privilege then v := 'rechazada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena edita su propia conexión', 'rechazada (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        delete from public.gmail_connections
         where user_id = 'f2200aaa-1111-4111-8111-111111111111';
        v := 'borrada';
    exception when insufficient_privilege then v := 'rechazada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena borra su conexión sin pasar por la desconexión',
        'rechazada (42501)', v);
end $$;

-- El centinela de siempre: RLS no cubre TRUNCATE, el revoke sí.
do $$
declare v text;
begin
    begin
        execute 'truncate table public.gmail_connections';
        v := 'vaciada';
    exception when insufficient_privilege then v := 'rechazada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena hace TRUNCATE de la tabla de conexiones', 'rechazada (42501)', v);
end $$;

-- CAPA 3: el Vault. ESTE es el caso del bloque.
do $$
declare v text; c integer;
begin
    begin
        execute 'select count(*) from vault.decrypted_secrets' into c;
        v := 'leyó ' || c::text || ' secreto(s)';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when invalid_schema_name     then v := 'denegado (3F000)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena lee vault.decrypted_secrets (donde vive el token descifrado)',
        'denegado (42501)', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        execute 'select count(*) from vault.secrets' into c;
        v := 'leyó ' || c::text || ' secreto(s)';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when invalid_schema_name     then v := 'denegado (3F000)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena lee vault.secrets (donde vive el token cifrado)',
        'denegado (42501)', v);
end $$;

-- CAPA 4: las funciones. Ninguna es ejecutable desde el navegador.
do $$
declare v text; t text;
begin
    begin
        select public.leer_refresh_token_gmail('f2200aaa-1111-4111-8111-111111111111'::uuid) into t;
        v := 'ejecutada: ' || coalesce(t, 'nulo');
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena ejecuta leer_refresh_token_gmail SOBRE SÍ MISMA',
        'denegada (42501)', v);
end $$;

do $$
declare v text; t text;
begin
    begin
        select public.leer_refresh_token_gmail('f2200bbb-2222-4222-8222-222222222222'::uuid) into t;
        v := 'ejecutada: ' || coalesce(t, 'nulo');
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena ejecuta leer_refresh_token_gmail sobre la cuenta de Rubén',
        'denegada (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.guardar_conexion_gmail(
            'f2200aaa-1111-4111-8111-111111111111'::uuid,
            'trucha@gmail.com', 'TOKEN-INVENTADO', 'Label_X', 'historialmedico', null);
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena ejecuta guardar_conexion_gmail', 'denegada (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.borrar_conexion_gmail('f2200bbb-2222-4222-8222-222222222222'::uuid);
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena ejecuta borrar_conexion_gmail sobre la cuenta de Rubén',
        'denegada (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.marcar_conexion_gmail_vencida('f2200bbb-2222-4222-8222-222222222222'::uuid);
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena ejecuta marcar_conexion_gmail_vencida', 'denegada (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.marcar_conexion_gmail_activa('f2200aaa-1111-4111-8111-111111111111'::uuid);
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena ejecuta marcar_conexion_gmail_activa', 'denegada (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.gmail_conexion_borrar_secreto();
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'denegada (' || sqlstate || ')';
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'Elena ejecuta la función del trigger que borra secretos del Vault',
        'denegada (42501)', v);
end $$;

-- `commit` y no `rollback`: los casos registrados viven en
-- `pruebas_rls.resultado`, que es una tabla como cualquier otra — un rollback
-- acá se llevaría puestos los resultados del bloque junto con los intentos
-- fallidos. Y no hay nada que deshacer: las cuatro escrituras de arriba fueron
-- rechazadas, así que esta transacción no cambió una sola fila.
commit;


-- ── Sin sesión: anon no ve nada de nada
begin;
set local role anon;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.gmail_connections;
        v := c::text || ' fila(s)';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'anon lee las conexiones de Gmail', 'denegado (42501)', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        execute 'select count(*) from vault.decrypted_secrets' into c;
        v := 'leyó ' || c::text || ' secreto(s)';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when invalid_schema_name     then v := 'denegado (3F000)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('23. Gmail',
        'anon lee vault.decrypted_secrets', 'denegado (42501)', v);
end $$;

commit;


-- ── El ciclo de vida, como lo corre la aplicación (service_role)
begin;
set local role service_role;

do $$
declare v text;
begin
    perform public.marcar_conexion_gmail_vencida('f2200aaa-1111-4111-8111-111111111111'::uuid);
    select status || '/' || case when expired_at is null then 'sin fecha' else 'con fecha' end
      into v from public.gmail_connections
     where user_id = 'f2200aaa-1111-4111-8111-111111111111';
    perform pruebas_rls.registrar('23. Gmail',
        'invalid_grant deja la conexión vencida CON fecha (y no la borra)',
        'vencida/con fecha', v);
end $$;

do $$
declare v text;
begin
    -- Reconectar es un UPSERT sobre la misma fila, con token nuevo.
    perform public.guardar_conexion_gmail(
        'f2200aaa-1111-4111-8111-111111111111'::uuid,
        'elena@gmail.com', 'ELENA-TOKEN-NUEVO', 'Label_100', 'historialmedico', null);
    select status || '/' || case when expired_at is null then 'sin fecha' else 'con fecha' end
      into v from public.gmail_connections
     where user_id = 'f2200aaa-1111-4111-8111-111111111111';
    perform pruebas_rls.registrar('23. Gmail',
        'Reconectar revive la conexión y limpia la fecha de vencimiento',
        'conectada/sin fecha', v);
end $$;

do $$
declare v text; c integer;
begin
    select count(*) into c from public.gmail_connections
     where user_id = 'f2200aaa-1111-4111-8111-111111111111';
    v := c::text || ' fila';
    perform pruebas_rls.registrar('23. Gmail',
        'Y no crea una fila más: una cuenta, una casilla', '1 fila', v);
end $$;

do $$
declare v text;
begin
    select public.leer_refresh_token_gmail('f2200aaa-1111-4111-8111-111111111111'::uuid) into v;
    perform pruebas_rls.registrar('23. Gmail',
        'El token viejo quedó pisado por el nuevo', 'ELENA-TOKEN-NUEVO',
        coalesce(v, '(nulo)'));
end $$;

-- Desconectar: se lleva la fila Y el secreto.
do $$
declare v text; c integer;
begin
    perform public.borrar_conexion_gmail('f2200aaa-1111-4111-8111-111111111111'::uuid);
    select count(*) into c from public.gmail_connections
     where user_id = 'f2200aaa-1111-4111-8111-111111111111';
    v := c::text || ' fila(s)';
    perform pruebas_rls.registrar('23. Gmail',
        'Desconectar borra la fila de conexión', '0 fila(s)', v);
end $$;

commit;

-- El secreto del Vault se mira como postgres: service_role no es quien manda
-- acá y el punto es verificar que NO QUEDÓ NADA, no quién puede verlo.
do $$
declare v text; c integer;
begin
    select count(*) into c from vault.secrets
     where name = 'gmail_refresh_token_f2200aaa-1111-4111-8111-111111111111';
    v := c::text || ' secreto(s)';
    perform pruebas_rls.registrar('23. Gmail',
        'Desconectar borra TAMBIÉN el token cifrado del Vault', '0 secreto(s)', v);
end $$;

-- La baja de la cuenta (derecho de supresión, Ley 25.326 arts. 14-16) tiene
-- que llevarse las dos cosas: la fila por el CASCADE y el secreto por el
-- trigger. Rubén sigue conectado justamente para probar esto.
do $$
declare v text; c integer;
begin
    select count(*) into c from vault.secrets
     where name = 'gmail_refresh_token_f2200bbb-2222-4222-8222-222222222222';
    v := c::text || ' secreto(s)';
    perform pruebas_rls.registrar('23. Gmail',
        'Antes de la baja, el token de Rubén está en el Vault', '1 secreto(s)', v);
end $$;

delete from auth.users where id = 'f2200bbb-2222-4222-8222-222222222222';

do $$
declare v text; c integer;
begin
    select count(*) into c from public.gmail_connections
     where user_id = 'f2200bbb-2222-4222-8222-222222222222';
    v := c::text || ' fila(s)';
    perform pruebas_rls.registrar('23. Gmail',
        'Borrar la CUENTA borra su conexión (ON DELETE CASCADE)', '0 fila(s)', v);
end $$;

do $$
declare v text; c integer;
begin
    select count(*) into c from vault.secrets
     where name = 'gmail_refresh_token_f2200bbb-2222-4222-8222-222222222222';
    v := c::text || ' secreto(s)';
    perform pruebas_rls.registrar('23. Gmail',
        'Y se lleva el token cifrado del Vault (el trigger AFTER DELETE)',
        '0 secreto(s)', v);
end $$;

-- Las dos capas por separado, leídas del catálogo: que falte la política y que
-- falte el privilegio son candados independientes.
do $$
declare v text;
begin
    select string_agg(cmd, ',' order by cmd) into v
      from pg_policies
     where schemaname = 'public' and tablename = 'gmail_connections';
    perform pruebas_rls.registrar('23. Gmail',
        'gmail_connections tiene política SOLO de SELECT', 'SELECT',
        coalesce(v, '(ninguna)'));
end $$;

do $$
declare v text;
begin
    select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '(ninguno)')
      into v
      from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'gmail_connections'
       and grantee in ('anon', 'authenticated');
    perform pruebas_rls.registrar('23. Gmail',
        'anon/authenticated no tienen NINGÚN privilegio de tabla entera',
        '(ninguno)', v);
end $$;

do $$
declare v text;
begin
    -- `20260818160000_gmail_auto_ingesta.sql` §1 sumó tres columnas de ESTADO
    -- más (auto_ingest_enabled, auto_ingest_profile_id, auto_ingest_set_at) al
    -- GRANT por columna de authenticated -mismo criterio que las ocho de
    -- acá-, así que la lista "exactamente las de estado" creció con ellas. El
    -- BLOQUE 25 prueba esas tres columnas en detalle.
    select coalesce(string_agg(distinct column_name, ',' order by column_name), '(ninguna)')
      into v
      from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'gmail_connections'
       and grantee = 'authenticated';
    perform pruebas_rls.registrar('23. Gmail',
        'Las columnas concedidas a authenticated son exactamente las de estado',
        'auto_ingest_enabled,auto_ingest_profile_id,auto_ingest_set_at,connected_at,email,expired_at,label_id,label_name,last_ok_at,status,user_id',
        v);
end $$;

do $$
declare v text;
begin
    select coalesce(string_agg(p.proname, ',' order by p.proname), '(ninguna)') into v
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like '%gmail%'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE');
    perform pruebas_rls.registrar('23. Gmail',
        'authenticated no puede ejecutar NINGUNA función de Gmail',
        '(ninguna)', v);
end $$;

do $$
declare v text;
begin
    select coalesce(string_agg(p.proname, ',' order by p.proname), '(ninguna)') into v
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('guardar_conexion_gmail', 'leer_refresh_token_gmail',
                         'borrar_conexion_gmail', 'marcar_conexion_gmail_vencida',
                         'marcar_conexion_gmail_activa')
       and has_function_privilege('service_role', p.oid, 'EXECUTE');
    perform pruebas_rls.registrar('23. Gmail',
        'service_role sí puede ejecutar las cinco',
        'borrar_conexion_gmail,guardar_conexion_gmail,leer_refresh_token_gmail,marcar_conexion_gmail_activa,marcar_conexion_gmail_vencida',
        v);
end $$;


-- =============================================================================
-- BLOQUE 24 — La bandeja de Gmail: registro de correos y filtros aprendidos
-- (Sprint 17, tarea 17.2)
-- -----------------------------------------------------------------------------
-- `gmail_messages` guarda METADATOS de los correos que el barrido ya miró
-- (remitente, asunto, fecha, descriptores de adjuntos) y `gmail_filters` las
-- reglas que la app creó en el Gmail de la persona. Las dos son tablas de la
-- CUENTA, como `gmail_connections` del BLOQUE 23, y este bloque prueba las
-- mismas capas que aquel, más las invariantes propias de este registro:
--
--   1. **RLS por fila** — cada cuenta ve lo suyo y NADA de la otra.
--   2. **Cero escritura para el navegador** — `authenticated` no puede
--      insertar, actualizar ni borrar ni siquiera SUS PROPIAS filas: la fila
--      lleva punteros (`document_id`, `appointment_id`) que un cliente no debe
--      poder escribir, y el único camino de escritura es `service_role`
--      (`lib/gmail/mensajes-admin.ts`), después de que la Server Action
--      verificó la sesión.
--   3. **El dedup es una invariante de la base**, no una promesa del código:
--      `UNIQUE (user_id, gmail_message_id)`.
--   4. **Los punteros son ON DELETE SET NULL**: borrar el documento que salió
--      de un correo NO puede borrar la fila del registro — si la borrara, el
--      correo se volvería a proponer en la próxima pasada, para siempre.
--   5. **La baja de cuenta se lleva todo** (Ley 25.326, arts. 14-16).
--   6. **El job de cron** existe, con la frecuencia declarada, y sus funciones
--      no son alcanzables desde una sesión del navegador.
-- =============================================================================
\echo '### BLOQUE 24 — bandeja de Gmail: correos registrados y filtros aprendidos'

-- Dos cuentas nuevas. El trigger `auth_users_crear_perfil_de_cuenta`
-- (20260814140000) les crea el perfil propio solo, que es lo que hace falta
-- para el caso del documento borrado.
insert into auth.users (id, email, instance_id, aud, role, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
    ('f2300aaa-1111-4111-8111-111111111111', 'ana.bandeja@ejemplo.com.ar',
     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'x', now(), now(), now()),
    ('f2300bbb-2222-4222-8222-222222222222', 'beto.bandeja@ejemplo.com.ar',
     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'x', now(), now(), now());

begin;
set local role service_role;

-- El barrido corre como service_role: así entra cada correo al registro.
do $$
declare v text;
begin
    insert into public.gmail_messages (
        user_id, gmail_message_id, connection_email, from_email, from_name,
        subject, message_date, kind, looks_like_appointment, attachments, status)
    values
        ('f2300aaa-1111-4111-8111-111111111111', 'msg-doc-1', 'ana@gmail.com',
         'resultados@lab-austral.com.ar', 'Laboratorio Austral',
         'Resultado de laboratorio', now(), 'documento', false,
         '[{"attachmentId":"ATT_1","filename":"resultado.pdf","mimeType":"application/pdf","size":24000,"apto":true,"motivo":null}]'::jsonb,
         'pendiente_revision'),
        ('f2300aaa-1111-4111-8111-111111111111', 'msg-turno-1', 'ana@gmail.com',
         'turnos@sanjorge.com.ar', 'Clínica San Jorge',
         'Turno asignado', now(), 'turno', true, '[]'::jsonb, 'pendiente_revision'),
        ('f2300bbb-2222-4222-8222-222222222222', 'msg-de-beto', 'beto@gmail.com',
         'turnos@otraclinica.com.ar', null,
         'Turno de Beto', now(), 'turno', true, '[]'::jsonb, 'pendiente_revision');

    -- Un correo sin nada aprovechable entra YA descartado: la fila existe para
    -- que la próxima pasada no lo vuelva a bajar.
    insert into public.gmail_messages (
        user_id, gmail_message_id, connection_email, from_email, subject,
        kind, status, resolved_at)
    values ('f2300aaa-1111-4111-8111-111111111111', 'msg-nada-1', 'ana@gmail.com',
            'facturacion@obrasocial.com.ar', 'Su factura de julio',
            'nada', 'descartado', now());

    select count(*)::text into v from public.gmail_messages
     where user_id in ('f2300aaa-1111-4111-8111-111111111111',
                       'f2300bbb-2222-4222-8222-222222222222');
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'service_role registra los cuatro correos', '4', v);
end $$;

-- El dedup: la misma casilla no puede registrar dos veces el mismo mensaje.
do $$
declare v text;
begin
    begin
        insert into public.gmail_messages (
            user_id, gmail_message_id, connection_email, from_email, kind, status)
        values ('f2300aaa-1111-4111-8111-111111111111', 'msg-doc-1', 'ana@gmail.com',
                'resultados@lab-austral.com.ar', 'documento', 'pendiente_revision');
        v := 'insertó un duplicado';
    exception when unique_violation then v := 'rechazado (23505)';
             when others            then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'El dedup es de la BASE: el mismo mensaje no entra dos veces',
        'rechazado (23505)', v);
end $$;

-- Pero el MISMO id de Gmail en OTRA cuenta sí puede entrar (dos personas
-- reenviándose el mismo correo es un caso real).
do $$
declare v text;
begin
    begin
        insert into public.gmail_messages (
            user_id, gmail_message_id, connection_email, from_email, kind, status)
        values ('f2300bbb-2222-4222-8222-222222222222', 'msg-doc-1', 'beto@gmail.com',
                'resultados@lab-austral.com.ar', 'documento', 'pendiente_revision');
        v := 'aceptado';
    exception when others then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'El mismo id de Gmail en OTRA cuenta sí entra', 'aceptado', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.gmail_messages (
            user_id, gmail_message_id, connection_email, from_email, kind, status)
        values ('f2300aaa-1111-4111-8111-111111111111', 'msg-x', 'ana@gmail.com',
                'x@y.com', 'documento', 'inventado');
        v := 'aceptó un estado inválido';
    exception when check_violation then v := 'rechazado (23514)';
             when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Un estado que no existe lo rechaza el CHECK', 'rechazado (23514)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.gmail_messages (
            user_id, gmail_message_id, connection_email, from_email, kind, status)
        values ('f2300aaa-1111-4111-8111-111111111111', 'msg-y', 'ana@gmail.com',
                'x@y.com', 'inventado', 'pendiente_revision');
        v := 'aceptó una clase inválida';
    exception when check_violation then v := 'rechazado (23514)';
             when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Una clase que no existe la rechaza el CHECK', 'rechazado (23514)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.gmail_messages (
            user_id, gmail_message_id, connection_email, from_email, kind, status, resolved_at)
        values ('f2300aaa-1111-4111-8111-111111111111', 'msg-z', 'ana@gmail.com',
                'x@y.com', 'documento', 'pendiente_revision', now());
        v := 'aceptó un pendiente ya resuelto';
    exception when check_violation then v := 'rechazado (23514)';
             when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Un pendiente NO puede tener fecha de resolución', 'rechazado (23514)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.gmail_messages (
            user_id, gmail_message_id, connection_email, from_email, kind, status, attachments)
        values ('f2300aaa-1111-4111-8111-111111111111', 'msg-w', 'ana@gmail.com',
                'x@y.com', 'documento', 'pendiente_revision', '{"no":"es una lista"}'::jsonb);
        v := 'aceptó adjuntos que no son lista';
    exception when check_violation then v := 'rechazado (23514)';
             when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Los adjuntos tienen que ser una lista JSON', 'rechazado (23514)', v);
end $$;

-- Los filtros aprendidos.
do $$
declare v text;
begin
    insert into public.gmail_filters (user_id, gmail_filter_id, from_email, label_id, label_name)
    values
        ('f2300aaa-1111-4111-8111-111111111111', 'ANe1', 'turnos@sanjorge.com.ar',
         'Label_100', 'historialmedico'),
        ('f2300bbb-2222-4222-8222-222222222222', 'BNe1', 'turnos@otraclinica.com.ar',
         'Label_200', 'historialmedico');

    select count(*)::text into v from public.gmail_filters
     where user_id in ('f2300aaa-1111-4111-8111-111111111111',
                       'f2300bbb-2222-4222-8222-222222222222');
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'service_role registra los filtros creados en Gmail', '2', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.gmail_filters (user_id, gmail_filter_id, from_email, label_id)
        values ('f2300aaa-1111-4111-8111-111111111111', 'ANe2', 'turnos@sanjorge.com.ar',
                'Label_100');
        v := 'creó dos filtros para el mismo remitente';
    exception when unique_violation then v := 'rechazado (23505)';
             when others            then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Un remitente, UN filtro (el botón es idempotente)', 'rechazado (23505)', v);
end $$;

commit;


-- ── La sesión de Ana: ve lo suyo, y no escribe nada
begin;
select set_config('request.jwt.claims',
    '{"sub":"f2300aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.gmail_messages;
        v := c::text || ' fila(s)';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Ana ve sus TRES correos (los de Beto no existen para ella)', '3 fila(s)', v);
end $$;

do $$
declare v text;
begin
    select coalesce(string_agg(gmail_message_id, ',' order by gmail_message_id), '(ninguno)')
      into v from public.gmail_messages;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Y son exactamente los suyos', 'msg-doc-1,msg-nada-1,msg-turno-1', v);
end $$;

do $$
declare v text; c integer;
begin
    select count(*) into c from public.gmail_messages
     where user_id = 'f2300bbb-2222-4222-8222-222222222222';
    v := c::text || ' fila(s)';
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Ana pide explícitamente los correos de Beto', '0 fila(s)', v);
end $$;

-- A diferencia de gmail_connections, acá NO hay grant por columna: no hay
-- ninguna columna que la pantalla no muestre, así que un `select *` -lo que
-- manda PostgREST- tiene que funcionar.
do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from (select * from public.gmail_messages) t;
        v := c::text || ' fila(s)';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'El select * de PostgREST funciona: acá no hay columnas secretas',
        '3 fila(s)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.gmail_messages (
            user_id, gmail_message_id, connection_email, from_email, kind, status)
        values ('f2300aaa-1111-4111-8111-111111111111', 'inventado-por-ana', 'ana@gmail.com',
                'x@y.com', 'documento', 'pendiente_revision');
        v := 'insertó';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Ana NO puede inventarse un correo en su propia bandeja',
        'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        update public.gmail_messages set status = 'ingresado'
         where user_id = 'f2300aaa-1111-4111-8111-111111111111';
        v := 'actualizó';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Ana NO puede marcar sus correos a mano (los punteros no son suyos)',
        'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        delete from public.gmail_messages
         where user_id = 'f2300aaa-1111-4111-8111-111111111111';
        v := 'borró';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Ana NO puede borrar filas del registro (rompería el dedup)',
        'denegado (42501)', v);
end $$;

do $$
declare v text; c integer;
begin
    select count(*) into c from public.gmail_filters;
    v := c::text || ' fila(s)';
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Ana ve UN filtro: el suyo', '1 fila(s)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.gmail_filters (user_id, gmail_filter_id, from_email, label_id)
        values ('f2300aaa-1111-4111-8111-111111111111', 'FALSO', 'otro@x.com', 'Label_100');
        v := 'insertó';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Ana NO puede anotar un filtro por su cuenta', 'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        delete from public.gmail_filters where user_id = 'f2300aaa-1111-4111-8111-111111111111';
        v := 'borró';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Ana NO borra la fila del filtro sola: sacarlo pasa por Gmail primero',
        'denegado (42501)', v);
end $$;

rollback;


-- ── anon: nada de nada
begin;
set local role anon;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.gmail_messages;
        v := c::text || ' fila(s)';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'anon lee la bandeja de correos', 'denegado (42501)', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.gmail_filters;
        v := c::text || ' fila(s)';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'anon lee los filtros', 'denegado (42501)', v);
end $$;

rollback;


-- ── El puntero al documento: borrar el estudio NO borra el registro
begin;
set local role service_role;

do $$
declare v text; v_perfil uuid; v_doc uuid;
begin
    select id into v_perfil from public.profiles
     where user_id = 'f2300aaa-1111-4111-8111-111111111111';

    insert into public.documents (profile_id, title, category, document_date, storage_path)
    values (v_perfil, 'Estudio que vino por Gmail', 'other', current_date,
            v_perfil::text || '/2026/f2300000-0000-4000-8000-000000000001.pdf')
    returning id into v_doc;

    update public.gmail_messages
       set status = 'ingresado', resolved_at = now(), document_id = v_doc
     where user_id = 'f2300aaa-1111-4111-8111-111111111111'
       and gmail_message_id = 'msg-doc-1';

    select case when document_id is not null then 'apunta al estudio' else 'sin puntero' end
      into v
      from public.gmail_messages
     where user_id = 'f2300aaa-1111-4111-8111-111111111111'
       and gmail_message_id = 'msg-doc-1';
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'El correo ingresado apunta al estudio que produjo', 'apunta al estudio', v);

    -- Y ahora se borra el estudio (es lo que pasa si se descarta en la
    -- pantalla de revisión).
    delete from public.documents where id = v_doc;

    select count(*)::text into v from public.gmail_messages
     where user_id = 'f2300aaa-1111-4111-8111-111111111111'
       and gmail_message_id = 'msg-doc-1';
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Borrar el estudio NO borra la fila del registro (si no, se reimportaría)',
        '1', v);

    select case when document_id is null then 'puntero en NULL' else 'sigue apuntando' end
      into v
      from public.gmail_messages
     where user_id = 'f2300aaa-1111-4111-8111-111111111111'
       and gmail_message_id = 'msg-doc-1';
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Y el puntero queda en NULL (ON DELETE SET NULL)', 'puntero en NULL', v);
end $$;

commit;


-- ── La baja de cuenta se lleva la bandeja entera
begin;
set local role postgres;

do $$
declare v text; c1 integer; c2 integer;
begin
    delete from auth.users where id = 'f2300bbb-2222-4222-8222-222222222222';

    select count(*) into c1 from public.gmail_messages
     where user_id = 'f2300bbb-2222-4222-8222-222222222222';
    select count(*) into c2 from public.gmail_filters
     where user_id = 'f2300bbb-2222-4222-8222-222222222222';
    v := c1::text || ' correo(s), ' || c2::text || ' filtro(s)';
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Borrar la CUENTA se lleva sus correos y sus filtros (Ley 25.326)',
        '0 correo(s), 0 filtro(s)', v);
end $$;

do $$
declare v text;
begin
    select count(*)::text into v from public.gmail_messages
     where user_id = 'f2300aaa-1111-4111-8111-111111111111';
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Y no toca los de la otra cuenta', '3', v);
end $$;

commit;


-- ── Privilegios, políticas y el job
do $$
declare v text;
begin
    select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '(ninguno)')
      into v
      from information_schema.table_privileges
     where table_schema = 'public' and table_name in ('gmail_messages', 'gmail_filters')
       and grantee in ('anon', 'authenticated');
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'anon/authenticated solo tienen SELECT sobre las dos tablas', 'SELECT', v);
end $$;

do $$
declare v text;
begin
    select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '(ninguno)')
      into v
      from information_schema.table_privileges
     where table_schema = 'public' and table_name in ('gmail_messages', 'gmail_filters')
       and grantee = 'service_role'
       -- Solo los cuatro de DML: service_role además trae REFERENCES, TRIGGER
       -- y TRUNCATE de los defaults de Supabase, que no son lo que este caso
       -- vigila.
       and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'service_role sí escribe (es quien corre el barrido)',
        'DELETE,INSERT,SELECT,UPDATE', v);
end $$;

do $$
declare v text;
begin
    select coalesce(string_agg(distinct cmd, ',' order by cmd), '(ninguna)') into v
      from pg_policies
     where schemaname = 'public' and tablename in ('gmail_messages', 'gmail_filters');
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Las dos tablas tienen política SOLO de SELECT', 'SELECT', v);
end $$;

do $$
declare v text;
begin
    select coalesce(string_agg(c.relname, ',' order by c.relname), '(ninguna)') into v
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('gmail_messages', 'gmail_filters')
       and c.relrowsecurity;
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Las dos tienen RLS habilitada', 'gmail_filters,gmail_messages', v);
end $$;

do $$
declare v text;
begin
    select coalesce(string_agg(p.proname, ',' order by p.proname), '(ninguna)') into v
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('configurar_cron_gmail', 'disparar_barrido_gmail')
       and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
            or has_function_privilege('anon', p.oid, 'EXECUTE'));
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Ni anon ni authenticated pueden disparar el barrido', '(ninguna)', v);
end $$;

do $$
declare v text;
begin
    select coalesce(string_agg(p.proname, ',' order by p.proname), '(ninguna)') into v
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'configurar_cron_gmail'
       and has_function_privilege('service_role', p.oid, 'EXECUTE');
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'Ni siquiera service_role configura el cron: eso es del owner',
        '(ninguna)', v);
end $$;

do $$
declare v text;
begin
    select coalesce(schedule, '(sin job)') into v from cron.job where jobname = 'barrido-gmail';
    perform pruebas_rls.registrar('24. Bandeja Gmail',
        'El job periódico está programado cada 30 minutos', '*/30 * * * *',
        coalesce(v, '(sin job)'));
end $$;


-- =============================================================================
-- BLOQUE 25 — Carga automática desde Gmail: el interruptor, las RPC y la marca
-- inmutable (Sprint 17, tarea 17.3)
-- -----------------------------------------------------------------------------
-- `20260818160000_gmail_auto_ingesta.sql` agrega el camino de "esto entró
-- solo": un interruptor por cuenta en `gmail_connections` (apagado por
-- defecto), dos RPC `service_role` que crean el documento o el turno con sus
-- propias cuatro guardas, y una marca `auto_ingest_source` inmutable para que
-- la persona siempre sepa cómo entró algo a su historial. Este bloque prueba
-- las cuatro guardas por separado -sobre todo la re-verificación de autoridad
-- en cada carga, que es el corazón del diseño-, el CHECK+trigger que evita
-- que un interruptor prendido bloquee el borrado de un perfil, y que la marca
-- de origen no se pueda ni inventar ni borrar desde una sesión de usuario.
--
-- Tres cuentas nuevas, prefijo f2400 (para no chocar con f2200/f2300 de los
-- BLOQUE 23/24):
--   f2400a00 "Ana"      — conecta Gmail, enciende la auto-carga.
--   f2400b00 "Beto"     — conecta Gmail por separado; su perfil es el que Ana
--                         NO administra, y su cuenta es la que prueba los
--                         cruces (correo ajeno, deshacer sin permiso).
--   f2400c00 "Respaldo" — sin Gmail, cuya única función es ser un SEGUNDO
--                         administrador del perfil gestionado para que el
--                         caso 18 (revocar el can_manage de Ana) sea legal:
--                         si Ana fuera la única administradora, el trigger de
--                         no orfandad (D4, 20260812210000 §4) abortaría el
--                         UPDATE que el caso necesita hacer.
-- Los tres perfiles PROPIOS se reinsertan con id fijo (mismo patrón que el
-- BLOQUE 20): el trigger de alta les crea uno con id aleatorio, que se
-- descarta, para poder referenciar los ids directamente sin subconsultas.
-- =============================================================================
\echo ''
\echo '### BLOQUE 25 — auto-ingesta de Gmail: el interruptor, las RPC y la marca'

insert into auth.users (id, email, instance_id, aud, role, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
    ('f2400a00-1111-4111-8111-111111111111', 'ana.autoingesta@ejemplo.com.ar',
     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'x', now(), now(), now()),
    ('f2400b00-1111-4111-8111-111111111111', 'beto.autoingesta@ejemplo.com.ar',
     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'x', now(), now(), now()),
    ('f2400c00-1111-4111-8111-111111111111', 'respaldo.autoingesta@ejemplo.com.ar',
     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'x', now(), now(), now());

delete from public.profiles
 where user_id in ('f2400a00-1111-4111-8111-111111111111',
                   'f2400b00-1111-4111-8111-111111111111',
                   'f2400c00-1111-4111-8111-111111111111')
   and id not in ('f2400a00-2222-4222-8222-222222222222',
                  'f2400b00-2222-4222-8222-222222222222',
                  'f2400c00-2222-4222-8222-222222222222');

insert into public.profiles (id, user_id, full_name, role) values
    ('f2400a00-2222-4222-8222-222222222222', 'f2400a00-1111-4111-8111-111111111111', 'Ana Bloque25',      'family_member'),
    ('f2400b00-2222-4222-8222-222222222222', 'f2400b00-1111-4111-8111-111111111111', 'Beto Bloque25',     'family_member'),
    ('f2400c00-2222-4222-8222-222222222222', 'f2400c00-1111-4111-8111-111111111111', 'Respaldo Bloque25', 'family_member');

-- El perfil GESTIONADO que Ana administra, con Respaldo como segundo
-- administrador (ver el encabezado: lo necesita el caso 18).
insert into public.profiles (id, user_id, full_name, role, created_by_profile_id) values
    ('f2400d00-2222-4222-8222-222222222222', null, 'Perfil gestionado Bloque25', 'elder',
     'f2400a00-2222-4222-8222-222222222222');

insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage) values
    ('f2400d00-2222-4222-8222-222222222222', 'f2400a00-2222-4222-8222-222222222222', true, true, true),
    ('f2400d00-2222-4222-8222-222222222222', 'f2400c00-2222-4222-8222-222222222222', true, true, true);

-- Las dos conexiones de Gmail, por el único camino que existe.
begin;
set local role service_role;

do $$
begin
    perform public.guardar_conexion_gmail(
        'f2400a00-1111-4111-8111-111111111111'::uuid,
        'ana.autoingesta@gmail.com', 'ANA-AUTOINGESTA-REFRESH', 'Label_2500', 'historialmedico',
        'https://www.googleapis.com/auth/gmail.readonly');
    perform public.guardar_conexion_gmail(
        'f2400b00-1111-4111-8111-111111111111'::uuid,
        'beto.autoingesta@gmail.com', 'BETO-AUTOINGESTA-REFRESH', 'Label_2600', 'historialmedico',
        'https://www.googleapis.com/auth/gmail.readonly');
end $$;

commit;


-- -----------------------------------------------------------------------------
-- Privilegios y RLS del interruptor (§1 gmail_connections de la migración)
-- -----------------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
    '{"sub":"f2400a00-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

-- También cubre el caso "default OFF en una conexión recién guardada": es
-- justo lo que estos valores tienen que ser en este punto del bloque.
do $$
declare v text; e boolean; p uuid; s timestamptz;
begin
    begin
        select auto_ingest_enabled, auto_ingest_profile_id, auto_ingest_set_at
          into e, p, s
          from public.gmail_connections
         where user_id = 'f2400a00-1111-4111-8111-111111111111';
        v := 'enabled=' || e::text || '/perfil=' || coalesce(p::text, 'null') || '/set_at=' ||
             case when s is null then 'null' else 'con fecha' end;
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Ana lee las tres columnas del interruptor de SU PROPIA conexión (nace apagado)',
        'enabled=false/perfil=null/set_at=null', v);
end $$;

do $$
declare v text; c integer;
begin
    select count(*) into c from public.gmail_connections
     where user_id = 'f2400b00-1111-4111-8111-111111111111';
    v := c || ' fila(s)';
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Ana pide el interruptor de la conexión de Beto (RLS por fila)', '0 fila(s)', v);
end $$;

do $$
declare v text;
begin
    begin
        update public.gmail_connections set auto_ingest_enabled = true
         where user_id = 'f2400a00-1111-4111-8111-111111111111';
        v := 'actualizada';
    exception when insufficient_privilege then v := 'rechazada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Ana intenta prender el interruptor con un UPDATE directo (sigue sin política)',
        'rechazada (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.configurar_auto_ingesta_gmail(
            'f2400a00-1111-4111-8111-111111111111'::uuid, true,
            'f2400d00-2222-4222-8222-222222222222'::uuid);
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Ana ejecuta configurar_auto_ingesta_gmail', 'denegada (42501)', v);
end $$;

do $$
declare v text; r jsonb;
begin
    begin
        select public.ingresar_documento_automatico(
            'f2400a00-1111-4111-8111-111111111111'::uuid,
            'f2400100-0000-4000-8000-000000000001'::uuid,
            'x/2026/x.pdf', 'application/pdf', 1000, repeat('a1', 32),
            'Intento', 'other', current_date, null, null) into r;
        v := 'ejecutada: ' || coalesce(r::text, 'nulo');
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Ana ejecuta ingresar_documento_automatico', 'denegada (42501)', v);
end $$;

do $$
declare v text; r jsonb;
begin
    begin
        select public.ingresar_turno_automatico(
            'f2400a00-1111-4111-8111-111111111111'::uuid,
            'f2400200-0000-4000-8000-000000000001'::uuid,
            'Cardiología', null, now() + interval '5 days',
            null, null, null, null, null) into r;
        v := 'ejecutada: ' || coalesce(r::text, 'nulo');
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Ana ejecuta ingresar_turno_automatico', 'denegada (42501)', v);
end $$;

do $$
declare v text; r boolean;
begin
    begin
        select public.cuenta_administra_perfil(
            'f2400a00-1111-4111-8111-111111111111'::uuid,
            'f2400a00-2222-4222-8222-222222222222'::uuid) into r;
        v := 'ejecutada: ' || coalesce(r::text, 'nulo');
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Ana ejecuta cuenta_administra_perfil SOBRE SÍ MISMA', 'denegada (42501)', v);
end $$;

commit;


begin;
set local role anon;

do $$
declare v text;
begin
    begin
        perform auto_ingest_enabled from public.gmail_connections limit 1;
        v := 'leyó';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'anon lee la columna auto_ingest_enabled', 'denegado (42501)', v);
end $$;

commit;

-- Las dos capas leídas del catálogo, como en el BLOQUE 23: privilegio de
-- ejecución y privilegio por columna son candados independientes.
do $$
declare v text;
begin
    select coalesce(string_agg(p.proname, ',' order by p.proname), '(ninguna)') into v
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('configurar_auto_ingesta_gmail', 'cuenta_administra_perfil',
                         'ingresar_documento_automatico', 'ingresar_turno_automatico')
       and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
            or has_function_privilege('anon', p.oid, 'EXECUTE'));
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Ni anon ni authenticated pueden ejecutar ninguna de las cuatro funciones nuevas',
        '(ninguna)', v);
end $$;

do $$
declare v text;
begin
    select coalesce(string_agg(p.proname, ',' order by p.proname), '(ninguna)') into v
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('configurar_auto_ingesta_gmail', 'cuenta_administra_perfil',
                         'ingresar_documento_automatico', 'ingresar_turno_automatico')
       and has_function_privilege('service_role', p.oid, 'EXECUTE');
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'service_role sí puede ejecutar las cuatro',
        'configurar_auto_ingesta_gmail,cuenta_administra_perfil,ingresar_documento_automatico,ingresar_turno_automatico',
        v);
end $$;

do $$
declare v text;
begin
    select coalesce(string_agg(distinct column_name, ',' order by column_name), '(ninguna)')
      into v
      from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'gmail_connections'
       and grantee = 'authenticated';
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Las tres columnas del interruptor se sumaron al GRANT por columna de authenticated',
        'auto_ingest_enabled,auto_ingest_profile_id,auto_ingest_set_at,connected_at,email,expired_at,label_id,label_name,last_ok_at,status,user_id',
        v);
end $$;


-- -----------------------------------------------------------------------------
-- El interruptor: configurar_auto_ingesta_gmail (§5.1 de la migración)
-- -----------------------------------------------------------------------------
begin;
set local role service_role;

do $$
declare v text;
begin
    begin
        perform public.configurar_auto_ingesta_gmail(
            'f2400a00-1111-4111-8111-111111111111'::uuid, true, null);
        v := 'encendido';
    exception when invalid_parameter_value then v := 'rechazado (22023)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Encender sin elegir perfil de destino', 'rechazado (22023)', v);
end $$;

do $$
declare v text; e boolean;
begin
    begin
        perform public.configurar_auto_ingesta_gmail(
            'f2400a00-1111-4111-8111-111111111111'::uuid, true,
            'f2400b00-2222-4222-8222-222222222222'::uuid);
        v := 'encendido';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'HOSTIL: Ana apunta la auto-carga al perfil PROPIO de Beto, que no administra',
        'rechazado (42501)', v);

    select auto_ingest_enabled into e from public.gmail_connections
     where user_id = 'f2400a00-1111-4111-8111-111111111111';
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Y la fila queda intacta: sigue apagada', 'false', e::text);
end $$;

do $$
declare v text; e boolean; p uuid; s timestamptz;
begin
    perform public.configurar_auto_ingesta_gmail(
        'f2400a00-1111-4111-8111-111111111111'::uuid, true,
        'f2400d00-2222-4222-8222-222222222222'::uuid);
    select auto_ingest_enabled, auto_ingest_profile_id, auto_ingest_set_at
      into e, p, s
      from public.gmail_connections
     where user_id = 'f2400a00-1111-4111-8111-111111111111';
    v := 'enabled=' || e::text || '/perfil=' ||
         case when p = 'f2400d00-2222-4222-8222-222222222222' then 'gestionado' else 'otro' end ||
         '/set_at=' || case when s is null then 'null' else 'con fecha' end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Ana enciende apuntando al perfil gestionado que administra',
        'enabled=true/perfil=gestionado/set_at=con fecha', v);
end $$;

do $$
declare v text; e boolean; p uuid; s timestamptz;
begin
    perform public.configurar_auto_ingesta_gmail(
        'f2400a00-1111-4111-8111-111111111111'::uuid, false, null);
    select auto_ingest_enabled, auto_ingest_profile_id, auto_ingest_set_at
      into e, p, s
      from public.gmail_connections
     where user_id = 'f2400a00-1111-4111-8111-111111111111';
    v := 'enabled=' || e::text || '/perfil=' ||
         case when p = 'f2400d00-2222-4222-8222-222222222222' then 'gestionado' else coalesce(p::text, 'null') end ||
         '/set_at=' || case when s is null then 'null' else 'con fecha' end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Apagar limpia la fecha pero conserva el perfil elegido',
        'enabled=false/perfil=gestionado/set_at=null', v);
end $$;

-- Re-encender: el resto del bloque necesita el interruptor prendido.
do $$
begin
    perform public.configurar_auto_ingesta_gmail(
        'f2400a00-1111-4111-8111-111111111111'::uuid, true,
        'f2400d00-2222-4222-8222-222222222222'::uuid);
end $$;

do $$
declare v text;
begin
    begin
        perform public.configurar_auto_ingesta_gmail(
            'f2400f00-6666-4666-8666-666666666666'::uuid, true,
            'f2400d00-2222-4222-8222-222222222222'::uuid);
        v := 'encendido';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Encender para una cuenta SIN casilla de Gmail conectada', 'rechazado (42501)', v);
end $$;

-- El CHECK + trigger: borrar el perfil de destino con el interruptor
-- ENCENDIDO no puede fallar (usa un perfil descartable aparte, para no tocar
-- el perfil gestionado real que el resto del bloque necesita).
insert into public.profiles (id, user_id, full_name, role, created_by_profile_id) values
    ('f2400e00-2222-4222-8222-222222222222', null, 'Perfil descartable Bloque25', 'elder',
     'f2400a00-2222-4222-8222-222222222222');

insert into public.family_permissions (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage) values
    ('f2400e00-2222-4222-8222-222222222222', 'f2400a00-2222-4222-8222-222222222222', true, true, true);

do $$
begin
    perform public.configurar_auto_ingesta_gmail(
        'f2400a00-1111-4111-8111-111111111111'::uuid, true,
        'f2400e00-2222-4222-8222-222222222222'::uuid);
end $$;

do $$
declare v text;
begin
    begin
        delete from public.profiles where id = 'f2400e00-2222-4222-8222-222222222222';
        v := 'sin error';
    exception when others then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'HOSTIL: borrar el perfil de destino con el interruptor ENCENDIDO no tira error',
        'sin error', v);
end $$;

do $$
declare v text; e boolean; p uuid; s timestamptz;
begin
    select auto_ingest_enabled, auto_ingest_profile_id, auto_ingest_set_at
      into e, p, s
      from public.gmail_connections
     where user_id = 'f2400a00-1111-4111-8111-111111111111';
    v := 'enabled=' || e::text || '/perfil=' || coalesce(p::text, 'null') || '/set_at=' ||
         case when s is null then 'null' else 'con fecha' end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'El ON DELETE SET NULL + el trigger apagan el interruptor solos',
        'enabled=false/perfil=null/set_at=null', v);
end $$;

-- Re-encender apuntando al perfil gestionado real: los tests de las RPC de
-- carga que siguen lo necesitan prendido.
do $$
begin
    perform public.configurar_auto_ingesta_gmail(
        'f2400a00-1111-4111-8111-111111111111'::uuid, true,
        'f2400d00-2222-4222-8222-222222222222'::uuid);
end $$;

commit;


-- -----------------------------------------------------------------------------
-- ingresar_documento_automatico (§5.2 de la migración)
-- -----------------------------------------------------------------------------
begin;
set local role service_role;

insert into public.gmail_messages (
    id, user_id, gmail_message_id, connection_email, from_email, from_name,
    subject, message_date, kind, looks_like_appointment, attachments, status)
values (
    'f2400100-0000-4000-8000-000000000001', 'f2400a00-1111-4111-8111-111111111111',
    'msg-doc-feliz', 'ana.autoingesta@gmail.com', 'resultados@lab-austral.com.ar',
    'Laboratorio Austral', 'Resultado de laboratorio', now(), 'documento', false,
    '[{"attachmentId":"ATT_1","filename":"resultado.pdf","mimeType":"application/pdf","size":24000,"apto":true,"motivo":null}]'::jsonb,
    'pendiente_revision');

do $$
declare v text; r jsonb; d public.documents%rowtype; m public.gmail_messages%rowtype;
begin
    select public.ingresar_documento_automatico(
        'f2400a00-1111-4111-8111-111111111111'::uuid,
        'f2400100-0000-4000-8000-000000000001'::uuid,
        'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-feliz.pdf',
        'application/pdf', 51200, repeat('a1', 32),
        'Análisis de sangre — Laboratorio Austral', 'laboratory', current_date - 1,
        'Resumen generado por IA', 'texto OCR de prueba',
        -- Duodécimo parámetro (hotfix de duplicados semánticos,
        -- 20260818180000): número de orden detectado por Gemini.
        '778899') into r;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Camino feliz: crea el documento y devuelve "creado"',
        'creado', coalesce(r->>'estado', 'nulo'));

    select * into d from public.documents
     where storage_path = 'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-feliz.pdf';
    v := 'source=' || coalesce(d.auto_ingest_source, 'null') ||
         '/confirmed=' || case when d.confirmed_at is null then 'null' else 'con fecha' end ||
         '/creador=' || coalesce(d.created_by_profile_id::text, 'null');
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'El documento nace marcado, confirmado y sin creador humano',
        'source=gmail/confirmed=con fecha/creador=null', v);

    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'El número de orden (hotfix de duplicados semánticos) queda persistido en documents.numero_orden',
        '778899', coalesce(d.numero_orden, 'NULL'));

    select * into m from public.gmail_messages where id = 'f2400100-0000-4000-8000-000000000001';
    v := 'status=' || m.status || '/documento=' ||
         case when m.document_id = d.id then 'coincide' else 'no coincide' end ||
         '/auto_ingested_at=' || case when m.auto_ingested_at is null then 'null' else 'con fecha' end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'El correo queda ingresado, apuntando al documento y con su marca de tiempo',
        'status=ingresado/documento=coincide/auto_ingested_at=con fecha', v);
end $$;

commit;


begin;
set local role service_role;

do $$
begin
    perform public.configurar_auto_ingesta_gmail(
        'f2400a00-1111-4111-8111-111111111111'::uuid, false, null);
end $$;

insert into public.gmail_messages (
    id, user_id, gmail_message_id, connection_email, from_email,
    subject, message_date, kind, attachments, status)
values (
    'f2400100-0000-4000-8000-000000000002', 'f2400a00-1111-4111-8111-111111111111',
    'msg-doc-apagado', 'ana.autoingesta@gmail.com', 'resultados@lab-austral.com.ar',
    'Otro resultado', now(), 'documento',
    '[{"attachmentId":"ATT_2","filename":"otro.pdf","mimeType":"application/pdf","size":10000,"apto":true,"motivo":null}]'::jsonb,
    'pendiente_revision');

do $$
declare v text; r jsonb; c integer;
begin
    begin
        select public.ingresar_documento_automatico(
            'f2400a00-1111-4111-8111-111111111111'::uuid,
            'f2400100-0000-4000-8000-000000000002'::uuid,
            'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-apagado.pdf',
            'application/pdf', 10000, repeat('b2', 32),
            'Otro resultado', 'laboratory', current_date, null, null) into r;
        v := coalesce(r->>'estado', 'nulo');
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'HOSTIL: opt-in apagado — rechaza aunque todo lo demás esté bien',
        'rechazado (42501)', v);

    select count(*) into c from public.documents
     where profile_id = 'f2400d00-2222-4222-8222-222222222222';
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Y no se creó ningún documento nuevo', '1', c::text);
end $$;

-- Re-encender: el resto de esta sección necesita el interruptor prendido.
do $$
begin
    perform public.configurar_auto_ingesta_gmail(
        'f2400a00-1111-4111-8111-111111111111'::uuid, true,
        'f2400d00-2222-4222-8222-222222222222'::uuid);
end $$;

commit;


begin;
set local role service_role;

do $$
declare v text; r jsonb; c integer;
begin
    select public.ingresar_documento_automatico(
        'f2400a00-1111-4111-8111-111111111111'::uuid,
        'f2400100-0000-4000-8000-000000000001'::uuid,
        'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-feliz-replay.pdf',
        'application/pdf', 51200, repeat('a1', 32),
        'Análisis de sangre — Laboratorio Austral', 'laboratory', current_date - 1,
        null, null) into r;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'HOSTIL: replay del mismo correo ya resuelto', 'ya_resuelto', coalesce(r->>'estado', 'nulo'));

    select count(*) into c from public.documents
     where profile_id = 'f2400d00-2222-4222-8222-222222222222';
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Sigue habiendo UN solo documento', '1', c::text);
end $$;

commit;


begin;
set local role service_role;

insert into public.gmail_messages (
    id, user_id, gmail_message_id, connection_email, from_email,
    subject, message_date, kind, attachments, status)
values (
    'f2400100-0000-4000-8000-000000000003', 'f2400a00-1111-4111-8111-111111111111',
    'msg-doc-huella-dup', 'ana.autoingesta@gmail.com', 'resultados@lab-austral.com.ar',
    'RV: Resultado de laboratorio', now(), 'documento',
    '[{"attachmentId":"ATT_3","filename":"resultado.pdf","mimeType":"application/pdf","size":24000,"apto":true,"motivo":null}]'::jsonb,
    'pendiente_revision');

do $$
declare v text; r jsonb; c integer;
begin
    select public.ingresar_documento_automatico(
        'f2400a00-1111-4111-8111-111111111111'::uuid,
        'f2400100-0000-4000-8000-000000000003'::uuid,
        'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-huella-dup.pdf',
        'application/pdf', 51200, repeat('a1', 32),
        'Reenvío del mismo análisis', 'laboratory', current_date, null, null) into r;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'HOSTIL: mismo contenido (misma huella) por otro correo', 'duplicado', coalesce(r->>'estado', 'nulo'));

    select count(*) into c from public.documents
     where profile_id = 'f2400d00-2222-4222-8222-222222222222';
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'No se crea un segundo documento', '1', c::text);
end $$;

commit;


begin;
set local role service_role;

insert into public.gmail_messages (
    id, user_id, gmail_message_id, connection_email, from_email,
    subject, message_date, kind, attachments, status)
values (
    'f2400100-0000-4000-8000-000000000009', 'f2400b00-1111-4111-8111-111111111111',
    'msg-doc-de-beto', 'beto.autoingesta@gmail.com', 'resultados@otrolab.com.ar',
    'Resultado de Beto', now(), 'documento',
    '[{"attachmentId":"ATT_9","filename":"beto.pdf","mimeType":"application/pdf","size":9000,"apto":true,"motivo":null}]'::jsonb,
    'pendiente_revision');

do $$
declare v text; r jsonb; c integer;
begin
    begin
        select public.ingresar_documento_automatico(
            'f2400a00-1111-4111-8111-111111111111'::uuid,
            'f2400100-0000-4000-8000-000000000009'::uuid,
            'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-de-beto.pdf',
            'application/pdf', 9000, repeat('c3', 32),
            'Resultado de Beto', 'laboratory', current_date, null, null) into r;
        v := coalesce(r->>'estado', 'nulo');
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'HOSTIL: Ana pasa el p_correo de Beto (correo de otra cuenta)', 'rechazado (42501)', v);

    select count(*) into c from public.documents
     where profile_id = 'f2400d00-2222-4222-8222-222222222222';
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'No se creó nada a partir del correo ajeno', '1', c::text);
end $$;

commit;


begin;
set local role service_role;

insert into public.gmail_messages (
    id, user_id, gmail_message_id, connection_email, from_email,
    subject, message_date, kind, attachments, status)
values
    ('f2400100-0000-4000-8000-000000000004', 'f2400a00-1111-4111-8111-111111111111',
     'msg-doc-fecha-futura', 'ana.autoingesta@gmail.com', 'clinica@x.com.ar',
     'Orden', now(), 'documento',
     '[{"attachmentId":"ATT_4","filename":"orden.pdf","mimeType":"application/pdf","size":5000,"apto":true,"motivo":null}]'::jsonb,
     'pendiente_revision'),
    ('f2400100-0000-4000-8000-000000000005', 'f2400a00-1111-4111-8111-111111111111',
     'msg-doc-titulo-vacio', 'ana.autoingesta@gmail.com', 'clinica@x.com.ar',
     'Orden', now(), 'documento',
     '[{"attachmentId":"ATT_5","filename":"orden.pdf","mimeType":"application/pdf","size":5000,"apto":true,"motivo":null}]'::jsonb,
     'pendiente_revision'),
    ('f2400100-0000-4000-8000-000000000006', 'f2400a00-1111-4111-8111-111111111111',
     'msg-doc-categoria-mala', 'ana.autoingesta@gmail.com', 'clinica@x.com.ar',
     'Orden', now(), 'documento',
     '[{"attachmentId":"ATT_6","filename":"orden.pdf","mimeType":"application/pdf","size":5000,"apto":true,"motivo":null}]'::jsonb,
     'pendiente_revision'),
    ('f2400100-0000-4000-8000-000000000007', 'f2400a00-1111-4111-8111-111111111111',
     'msg-doc-huella-mala', 'ana.autoingesta@gmail.com', 'clinica@x.com.ar',
     'Orden', now(), 'documento',
     '[{"attachmentId":"ATT_7","filename":"orden.pdf","mimeType":"application/pdf","size":5000,"apto":true,"motivo":null}]'::jsonb,
     'pendiente_revision');

do $$
declare v text;
begin
    begin
        perform public.ingresar_documento_automatico(
            'f2400a00-1111-4111-8111-111111111111'::uuid,
            'f2400100-0000-4000-8000-000000000004'::uuid,
            'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-fecha-futura.pdf',
            'application/pdf', 5000, repeat('c3', 32),
            'Orden con fecha futura', 'laboratory', current_date + 30, null, null);
        v := 'aceptó una fecha futura';
    exception when invalid_parameter_value then v := 'rechazado (22023)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail', 'Fecha futura', 'rechazado (22023)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.ingresar_documento_automatico(
            'f2400a00-1111-4111-8111-111111111111'::uuid,
            'f2400100-0000-4000-8000-000000000005'::uuid,
            'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-titulo-vacio.pdf',
            'application/pdf', 5000, repeat('d4', 32),
            '   ', 'laboratory', current_date, null, null);
        v := 'aceptó un título vacío';
    exception when invalid_parameter_value then v := 'rechazado (22023)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail', 'Título vacío', 'rechazado (22023)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.ingresar_documento_automatico(
            'f2400a00-1111-4111-8111-111111111111'::uuid,
            'f2400100-0000-4000-8000-000000000006'::uuid,
            'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-categoria-mala.pdf',
            'application/pdf', 5000, repeat('e5', 32),
            'Orden con categoría inventada', 'radiografia', current_date, null, null);
        v := 'aceptó una categoría inválida';
    exception when invalid_parameter_value then v := 'rechazado (22023)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail', 'Categoría inválida', 'rechazado (22023)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.ingresar_documento_automatico(
            'f2400a00-1111-4111-8111-111111111111'::uuid,
            'f2400100-0000-4000-8000-000000000007'::uuid,
            'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-huella-mala.pdf',
            'application/pdf', 5000, 'no-es-un-hash-sha256',
            'Orden con huella trucha', 'laboratory', current_date, null, null);
        v := 'aceptó una huella con forma inválida';
    exception when invalid_parameter_value then v := 'rechazado (22023)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Huella con forma inválida (no 64 hex)', 'rechazado (22023)', v);
end $$;

commit;


begin;
set local role service_role;

insert into public.gmail_messages (
    id, user_id, gmail_message_id, connection_email, from_email,
    subject, message_date, kind, attachments, status)
values (
    'f2400100-0000-4000-8000-000000000008', 'f2400a00-1111-4111-8111-111111111111',
    'msg-doc-permiso-revocado', 'ana.autoingesta@gmail.com', 'clinica@x.com.ar',
    'Orden', now(), 'documento',
    '[{"attachmentId":"ATT_8","filename":"orden.pdf","mimeType":"application/pdf","size":5000,"apto":true,"motivo":null}]'::jsonb,
    'pendiente_revision');

-- Se le baja el can_manage a Ana. Respaldo (f2400c00) sigue administrando, así
-- que el trigger de no orfandad (D4) deja pasar el UPDATE.
update public.family_permissions set can_manage = false
 where owner_profile_id = 'f2400d00-2222-4222-8222-222222222222'
   and granted_profile_id = 'f2400a00-2222-4222-8222-222222222222';

do $$
declare v text; c integer;
begin
    begin
        perform public.ingresar_documento_automatico(
            'f2400a00-1111-4111-8111-111111111111'::uuid,
            'f2400100-0000-4000-8000-000000000008'::uuid,
            'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-permiso-revocado.pdf',
            'application/pdf', 5000, repeat('f6', 32),
            'Orden con permiso ya revocado', 'laboratory', current_date, null, null);
        v := 'creó el documento igual';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'EL CASO: el can_manage se revocó DESPUÉS de encender — se re-verifica en cada carga',
        'rechazado (42501)', v);

    select count(*) into c from public.documents
     where profile_id = 'f2400d00-2222-4222-8222-222222222222';
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'La fila queda intacta: sigue habiendo un solo documento', '1', c::text);
end $$;

-- Se restaura: turnos y "deshacer" más abajo necesitan que Ana vuelva a
-- administrar el perfil gestionado.
update public.family_permissions set can_manage = true
 where owner_profile_id = 'f2400d00-2222-4222-8222-222222222222'
   and granted_profile_id = 'f2400a00-2222-4222-8222-222222222222';

commit;


-- -----------------------------------------------------------------------------
-- ingresar_turno_automatico (§5.3 de la migración)
-- -----------------------------------------------------------------------------
begin;
set local role service_role;

insert into public.gmail_messages (
    id, user_id, gmail_message_id, connection_email, from_email, from_name,
    subject, message_date, kind, looks_like_appointment, attachments, status)
values (
    'f2400200-0000-4000-8000-000000000001', 'f2400a00-1111-4111-8111-111111111111',
    'msg-turno-feliz', 'ana.autoingesta@gmail.com', 'turnos@sanjorge.com.ar',
    'Clínica San Jorge', 'Turno asignado', now(), 'turno', true, '[]'::jsonb,
    'pendiente_revision');

do $$
declare v text; r jsonb; a public.appointments%rowtype; m public.gmail_messages%rowtype;
begin
    select public.ingresar_turno_automatico(
        'f2400a00-1111-4111-8111-111111111111'::uuid,
        'f2400200-0000-4000-8000-000000000001'::uuid,
        'Cardiología', 'Dr. Pérez', timestamptz '2026-09-15 10:00:00-03',
        'Clínica San Jorge', 'Av. Siempre Viva 123', 'Ushuaia',
        'Tierra del Fuego, Antártida e Islas del Atlántico Sur',
        'Traer estudios previos') into r;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Camino feliz de turno: crea la cita y devuelve "creado"',
        'creado', coalesce(r->>'estado', 'nulo'));

    select * into a from public.appointments
     where profile_id = 'f2400d00-2222-4222-8222-222222222222'
       and specialty = 'Cardiología'
       and appointment_date = timestamptz '2026-09-15 10:00:00-03';
    v := 'source=' || coalesce(a.auto_ingest_source, 'null') ||
         '/status=' || a.status::text ||
         '/creador=' || coalesce(a.created_by_profile_id::text, 'null');
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'El turno nace marcado, pendiente y sin creador humano',
        'source=gmail/status=pending/creador=null', v);

    select * into m from public.gmail_messages where id = 'f2400200-0000-4000-8000-000000000001';
    v := 'status=' || m.status || '/turno=' ||
         case when m.appointment_id = a.id then 'coincide' else 'no coincide' end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'El correo queda ingresado y apunta al turno que produjo',
        'status=ingresado/turno=coincide', v);
end $$;

commit;


begin;
set local role service_role;

do $$
begin
    perform public.configurar_auto_ingesta_gmail(
        'f2400a00-1111-4111-8111-111111111111'::uuid, false, null);
end $$;

insert into public.gmail_messages (
    id, user_id, gmail_message_id, connection_email, from_email, from_name,
    subject, message_date, kind, looks_like_appointment, attachments, status)
values (
    'f2400200-0000-4000-8000-000000000002', 'f2400a00-1111-4111-8111-111111111111',
    'msg-turno-apagado', 'ana.autoingesta@gmail.com', 'turnos@sanjorge.com.ar',
    'Clínica San Jorge', 'Otro turno', now(), 'turno', true, '[]'::jsonb,
    'pendiente_revision');

do $$
declare v text;
begin
    begin
        perform public.ingresar_turno_automatico(
            'f2400a00-1111-4111-8111-111111111111'::uuid,
            'f2400200-0000-4000-8000-000000000002'::uuid,
            'Dermatología', null, timestamptz '2026-09-20 09:00:00-03',
            null, null, null, null, null);
        v := 'creó el turno igual';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'HOSTIL: opt-in apagado, también para turnos', 'rechazado (42501)', v);
end $$;

do $$
begin
    perform public.configurar_auto_ingesta_gmail(
        'f2400a00-1111-4111-8111-111111111111'::uuid, true,
        'f2400d00-2222-4222-8222-222222222222'::uuid);
end $$;

commit;


begin;
set local role service_role;

do $$
declare v text; r jsonb; c integer;
begin
    select public.ingresar_turno_automatico(
        'f2400a00-1111-4111-8111-111111111111'::uuid,
        'f2400200-0000-4000-8000-000000000001'::uuid,
        'Cardiología', 'Dr. Pérez', timestamptz '2026-09-15 10:00:00-03',
        'Clínica San Jorge', 'Av. Siempre Viva 123', 'Ushuaia',
        'Tierra del Fuego, Antártida e Islas del Atlántico Sur', null) into r;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'HOSTIL: replay del mismo correo de turno ya resuelto', 'ya_resuelto', coalesce(r->>'estado', 'nulo'));

    select count(*) into c from public.appointments
     where profile_id = 'f2400d00-2222-4222-8222-222222222222';
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Sigue habiendo UN solo turno', '1', c::text);
end $$;

commit;


begin;
set local role service_role;

insert into public.gmail_messages (
    id, user_id, gmail_message_id, connection_email, from_email, from_name,
    subject, message_date, kind, looks_like_appointment, attachments, status)
values (
    'f2400200-0000-4000-8000-000000000003', 'f2400a00-1111-4111-8111-111111111111',
    'msg-turno-duplicado', 'ana.autoingesta@gmail.com', 'turnos@sanjorge.com.ar',
    'Clínica San Jorge', 'Recordatorio del mismo turno', now(), 'turno', true, '[]'::jsonb,
    'pendiente_revision');

do $$
declare v text; r jsonb; c integer;
begin
    -- Especialidad en minúsculas a propósito: el dedup compara sin distinguir
    -- mayúsculas (lower(a.specialty) = lower(v_especialidad)).
    select public.ingresar_turno_automatico(
        'f2400a00-1111-4111-8111-111111111111'::uuid,
        'f2400200-0000-4000-8000-000000000003'::uuid,
        'cardiología', null, timestamptz '2026-09-15 10:00:00-03',
        null, null, null, null, 'Recordatorio de la misma clínica') into r;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Dedup: mismo perfil, misma fecha/hora, misma especialidad', 'duplicado', coalesce(r->>'estado', 'nulo'));

    select count(*) into c from public.appointments
     where profile_id = 'f2400d00-2222-4222-8222-222222222222';
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'No se crea un segundo turno', '1', c::text);
end $$;

commit;


begin;
set local role service_role;

insert into public.gmail_messages (
    id, user_id, gmail_message_id, connection_email, from_email,
    subject, message_date, kind, looks_like_appointment, attachments, status)
values (
    'f2400200-0000-4000-8000-000000000004', 'f2400a00-1111-4111-8111-111111111111',
    'msg-turno-especialidad-vacia', 'ana.autoingesta@gmail.com', 'turnos@x.com.ar',
    'Turno sin especialidad', now(), 'turno', true, '[]'::jsonb,
    'pendiente_revision');

do $$
declare v text;
begin
    begin
        perform public.ingresar_turno_automatico(
            'f2400a00-1111-4111-8111-111111111111'::uuid,
            'f2400200-0000-4000-8000-000000000004'::uuid,
            '   ', null, timestamptz '2026-09-25 11:00:00-03',
            null, null, null, null, null);
        v := 'aceptó una especialidad vacía';
    exception when invalid_parameter_value then v := 'rechazado (22023)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail', 'Especialidad vacía', 'rechazado (22023)', v);
end $$;

commit;


-- -----------------------------------------------------------------------------
-- La marca inmutable (§3 de la migración): sellar_auto_ingest_source
-- -----------------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
    '{"sub":"f2400a00-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare d public.documents%rowtype;
begin
    insert into public.documents (profile_id, title, category, document_date, storage_path, auto_ingest_source)
    values ('f2400a00-2222-4222-8222-222222222222', 'Carga a mano de Ana', 'other', current_date,
            'f2400a00-2222-4222-8222-222222222222/2026/carga-a-mano.pdf', 'gmail')
    returning * into d;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'HOSTIL: Ana inserta un documento propio declarando auto_ingest_source=''gmail''',
        '(nulo)', coalesce(d.auto_ingest_source, '(nulo)'));
end $$;

do $$
declare v text;
begin
    update public.documents set auto_ingest_source = null
     where storage_path = 'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-feliz.pdf';
    select auto_ingest_source into v from public.documents
     where storage_path = 'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-feliz.pdf';
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'HOSTIL: Ana (can_manage) intenta borrar la marca con un UPDATE a NULL',
        'gmail', coalesce(v, '(nulo)'));
end $$;

do $$
declare a public.appointments%rowtype;
begin
    insert into public.appointments (profile_id, specialty, appointment_date, auto_ingest_source, status)
    values ('f2400a00-2222-4222-8222-222222222222', 'Dermatología',
            timestamptz '2026-10-01 09:00:00-03', 'gmail', 'pending')
    returning * into a;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'HOSTIL: Ana inserta un turno propio declarando auto_ingest_source=''gmail''',
        '(nulo)', coalesce(a.auto_ingest_source, '(nulo)'));
end $$;

do $$
declare v text;
begin
    update public.appointments set auto_ingest_source = null
     where profile_id = 'f2400d00-2222-4222-8222-222222222222'
       and specialty = 'Cardiología'
       and appointment_date = timestamptz '2026-09-15 10:00:00-03';
    select auto_ingest_source into v from public.appointments
     where profile_id = 'f2400d00-2222-4222-8222-222222222222'
       and specialty = 'Cardiología'
       and appointment_date = timestamptz '2026-09-15 10:00:00-03';
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'HOSTIL: Ana intenta borrar la marca del turno auto-cargado con un UPDATE a NULL',
        'gmail', coalesce(v, '(nulo)'));
end $$;

commit;


-- -----------------------------------------------------------------------------
-- Deshacer: las políticas existentes de siempre, con sesión de usuario
-- -----------------------------------------------------------------------------
-- El orden importa: primero se prueba que Beto NO puede (para que el intento
-- sea contra la fila real, no contra una que ya no existe), y recién después
-- Ana la borra de verdad.
begin;
select set_config('request.jwt.claims',
    '{"sub":"f2400b00-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v integer;
begin
    delete from public.documents
     where storage_path = 'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-feliz.pdf';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Beto (NO administra el perfil gestionado) intenta deshacer el documento',
        '0 filas', v || ' filas');
end $$;

do $$
declare v integer;
begin
    delete from public.appointments
     where profile_id = 'f2400d00-2222-4222-8222-222222222222'
       and specialty = 'Cardiología'
       and appointment_date = timestamptz '2026-09-15 10:00:00-03';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Beto (NO administra el perfil gestionado) intenta deshacer el turno',
        '0 filas', v || ' filas');
end $$;

commit;


begin;
select set_config('request.jwt.claims',
    '{"sub":"f2400a00-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v integer;
begin
    delete from public.documents
     where storage_path = 'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-feliz.pdf';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Ana (administra el perfil gestionado) SÍ puede deshacer el documento',
        '1 filas', v || ' filas');
end $$;

do $$
declare v integer;
begin
    delete from public.appointments
     where profile_id = 'f2400d00-2222-4222-8222-222222222222'
       and specialty = 'Cardiología'
       and appointment_date = timestamptz '2026-09-15 10:00:00-03';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'Y también el turno', '1 filas', v || ' filas');
end $$;

commit;

select pruebas_rls.registrar('25. Auto-ingesta Gmail',
       'Al borrar el documento se encoló la purga en storage_purge_queue', '1', count(*)::text)
  from public.storage_purge_queue
 where storage_path = 'f2400d00-2222-4222-8222-222222222222/2026/auto-doc-feliz.pdf';


-- -----------------------------------------------------------------------------
-- El CHECK gmail_messages_auto_ingesta_coherente (§2 de la migración)
-- -----------------------------------------------------------------------------
do $$
declare v text;
begin
    begin
        update public.gmail_messages set status = 'descartado'
         where id = 'f2400100-0000-4000-8000-000000000001';
        v := 'aceptó auto_ingested_at con status distinto de ingresado';
    exception when check_violation then v := 'rechazado (23514)';
             when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('25. Auto-ingesta Gmail',
        'gmail_messages_auto_ingesta_coherente: auto_ingested_at exige status=ingresado',
        'rechazado (23514)', v);
end $$;


-- =============================================================================
-- BLOQUE 26 — Estado de los consejos del tutorial de bienvenida
-- (consejos_estado, tarea #14, migración 20260818170000)
-- -----------------------------------------------------------------------------
-- A diferencia de casi todas las tablas nuevas de las últimas migraciones
-- (append-only como consents, o de solo lectura para authenticated como
-- gmail_messages), acá el CLIENTE SÍ escribe lo suyo directo: es una
-- preferencia de interfaz sin ningún valor clínico ni probatorio, así que
-- SELECT/INSERT/UPDATE quedan otorgados a `authenticated` con `auth.uid()`
-- como única cerradura (ver el encabezado de la migración). Este bloque
-- prueba las tres operaciones sobre la fila propia, que ninguna alcanza la
-- fila ajena (ni para leer, ni para insertar a su nombre, ni para
-- reasignársela con un UPDATE), los dos CHECK del dominio cerrado
-- (consejo_id, estado), la restricción única (user_id, consejo_id) y que
-- DELETE/TRUNCATE siguen sin privilegio -la segunda capa, sin política que
-- haga falta rechazar-.
--
-- Dos cuentas nuevas, prefijo f2600 (para no chocar con f2400 del BLOQUE 25):
--   f2600aaa "A" — pospone un consejo, lo pasa a descartado, prueba los
--                  intentos de cruzarse con B.
--   f2600bbb "B" — inserta el suyo por separado, para probar el aislamiento
--                  en los dos sentidos.
-- No hace falta perfil con id fijo (a diferencia del BLOQUE 25):
-- `consejos_estado` solo referencia `auth.users`, nunca `profiles`.
-- =============================================================================
\echo ''
\echo '### BLOQUE 26 — estado de los consejos del tutorial de bienvenida'

delete from public.consejos_estado
 where user_id in ('f2600aaa-1111-4111-8111-111111111111', 'f2600bbb-2222-4222-8222-222222222222');

insert into auth.users (id, email, instance_id, aud, role, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
    ('f2600aaa-1111-4111-8111-111111111111', 'a.consejos@ejemplo.com.ar',
     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'x', now(), now(), now()),
    ('f2600bbb-2222-4222-8222-222222222222', 'b.consejos@ejemplo.com.ar',
     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'x', now(), now(), now());

-- ── A: inserta, lee, actualiza, y prueba todos los cruces con B.
begin;
select set_config('request.jwt.claims', '{"sub":"f2600aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v integer;
begin
    insert into public.consejos_estado (user_id, consejo_id, estado)
    values ('f2600aaa-1111-4111-8111-111111111111', 'ficha_sos', 'pospuesto');
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'A pospone "ficha_sos" ("Ahora no")  [CRITERIO DE ACEPTACIÓN]',
        '1 filas', v || ' filas');
end $$;

select pruebas_rls.registrar('26. Consejos (consejos_estado)',
       'A lee su propia fila (SELECT propio)', '1',
       (select count(*)::text from public.consejos_estado
         where user_id = 'f2600aaa-1111-4111-8111-111111111111'));

-- INSERT a nombre de OTRA cuenta: el WITH CHECK lo rechaza.
do $$
declare v text;
begin
    begin
        insert into public.consejos_estado (user_id, consejo_id, estado)
        values ('f2600bbb-2222-4222-8222-222222222222', 'gmail', 'pospuesto');
        v := 'insertado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'A NO puede insertar un consejo a nombre de B (WITH CHECK)',
        'rechazado (42501)', v);
end $$;

-- consejo_id fuera del dominio cerrado de seis ids.
do $$
declare v text;
begin
    begin
        insert into public.consejos_estado (user_id, consejo_id, estado)
        values ('f2600aaa-1111-4111-8111-111111111111', 'no_existe', 'pospuesto');
        v := 'insertado';
    exception when check_violation then v := 'rechazado (23514)';
             when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'Un consejo_id fuera de los seis conocidos es rechazado por el CHECK',
        'rechazado (23514)', v);
end $$;

-- estado fuera de {'pospuesto', 'descartado'}.
do $$
declare v text;
begin
    begin
        insert into public.consejos_estado (user_id, consejo_id, estado)
        values ('f2600aaa-1111-4111-8111-111111111111', 'gmail', 'archivado');
        v := 'insertado';
    exception when check_violation then v := 'rechazado (23514)';
             when others           then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'Un estado fuera de pospuesto/descartado es rechazado por el CHECK',
        'rechazado (23514)', v);
end $$;

-- Restricción única (user_id, consejo_id): un segundo INSERT del mismo par
-- choca. El upsert real de la app (`app/(app)/(con-nav)/inicio/actions.ts`)
-- usa ON CONFLICT sobre esta misma restricción -acá se prueba el INSERT
-- pelado, que es lo que la restricción en sí garantiza.
do $$
declare v text;
begin
    begin
        insert into public.consejos_estado (user_id, consejo_id, estado)
        values ('f2600aaa-1111-4111-8111-111111111111', 'ficha_sos', 'descartado');
        v := 'insertado';
    exception when unique_violation then v := 'rechazado (23505)';
             when others            then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'Un segundo consejo_id repetido para la misma cuenta choca contra la restricción única',
        'rechazado (23505)', v);
end $$;

-- UPDATE de la fila propia: "Ahora no" → "No mostrar más" sobre el mismo consejo.
do $$
declare v integer;
begin
    update public.consejos_estado set estado = 'descartado'
     where user_id = 'f2600aaa-1111-4111-8111-111111111111' and consejo_id = 'ficha_sos';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'A pasa su propio consejo de pospuesto a descartado (UPDATE propio)  [CRITERIO DE ACEPTACIÓN]',
        '1 filas', v || ' filas');
end $$;

-- UPDATE apuntando a la fila de B (que todavía no existe): 0 filas, sin error
-- -mismo criterio de negación silenciosa que el resto del proyecto-.
do $$
declare v integer;
begin
    update public.consejos_estado set estado = 'descartado'
     where user_id = 'f2600bbb-2222-4222-8222-222222222222' and consejo_id = 'gmail';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'A intenta actualizar una fila de B: 0 filas, sin error (USING la filtra)',
        '0 filas', v || ' filas');
end $$;

-- Reasignar la fila propia a B vía UPDATE: el WITH CHECK lo rechaza.
do $$
declare v text;
begin
    begin
        update public.consejos_estado set user_id = 'f2600bbb-2222-4222-8222-222222222222'
         where user_id = 'f2600aaa-1111-4111-8111-111111111111' and consejo_id = 'ficha_sos';
        v := 'reasignado';
    exception when insufficient_privilege then v := 'rechazado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'A NO puede reasignar su fila a B con un UPDATE de user_id (WITH CHECK)',
        'rechazado (42501)', v);
end $$;

-- DELETE: sin PRIVILEGIO, no solo sin política (ver el encabezado de la migración).
do $$
declare v text;
begin
    begin
        delete from public.consejos_estado
         where user_id = 'f2600aaa-1111-4111-8111-111111111111' and consejo_id = 'ficha_sos';
        v := 'borrado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'authenticated NO tiene GRANT DELETE sobre consejos_estado',
        'denegado (42501)', v);
end $$;

-- TRUNCATE: el revoke que no es decorativo. RLS no lo filtraría.
do $$
declare v text;
begin
    begin
        truncate table public.consejos_estado;
        v := 'vaciada';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'authenticated NO puede TRUNCATE consejos_estado',
        'denegado (42501)', v);
end $$;

commit;

-- ── B: inserta el suyo por separado, aislamiento en el otro sentido.
begin;
select set_config('request.jwt.claims', '{"sub":"f2600bbb-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v integer;
begin
    insert into public.consejos_estado (user_id, consejo_id, estado)
    values ('f2600bbb-2222-4222-8222-222222222222', 'notificaciones', 'pospuesto');
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'B inserta su propio consejo por separado', '1 filas', v || ' filas');
end $$;

select pruebas_rls.registrar('26. Consejos (consejos_estado)',
       'B NO ve la fila de A  [CRITERIO DE ACEPTACIÓN]', '0 filas',
       (select count(*)::text || ' filas' from public.consejos_estado
         where user_id = 'f2600aaa-1111-4111-8111-111111111111'));

commit;

-- ── anon: nada de nada.
begin;
select set_config('request.jwt.claims', '', true);
set local role anon;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.consejos_estado;
        v := c || ' filas';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'anon NO puede leer consejos_estado (sin GRANT SELECT)', 'denegado (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        insert into public.consejos_estado (user_id, consejo_id, estado)
        values ('f2600aaa-1111-4111-8111-111111111111', 'gmail', 'pospuesto');
        v := 'insertado';
    exception when insufficient_privilege then v := 'denegado (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('26. Consejos (consejos_estado)',
        'anon NO tiene GRANT INSERT sobre consejos_estado (REVOKE no concede nada)',
        'denegado (42501)', v);
end $$;

commit;

-- Invariantes estructurales.
select pruebas_rls.registrar('26. Consejos (consejos_estado)',
       'consejos_estado tiene RLS habilitada', 'true',
       (select rowsecurity::text from pg_tables
         where schemaname = 'public' and tablename = 'consejos_estado'));

select pruebas_rls.registrar('26. Consejos (consejos_estado)',
       'Privilegios de anon sobre consejos_estado', '0',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'consejos_estado' and grantee = 'anon'));

select pruebas_rls.registrar('26. Consejos (consejos_estado)',
       'authenticated SÍ tiene SELECT/INSERT/UPDATE (acá el cliente escribe lo suyo)', '3',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'consejos_estado'
           and grantee = 'authenticated' and privilege_type in ('SELECT', 'INSERT', 'UPDATE')));

select pruebas_rls.registrar('26. Consejos (consejos_estado)',
       'authenticated NO tiene DELETE (sin política que ofrecer "olvidate de esto")', '0',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'consejos_estado'
           and grantee = 'authenticated' and privilege_type = 'DELETE'));

select pruebas_rls.registrar('26. Consejos (consejos_estado)',
       'El trigger de refresco de updated_at existe', '1',
       (select count(*)::text from pg_trigger
         where tgrelid = 'public.consejos_estado'::regclass
           and tgname = 'consejos_estado_set_updated_at'));



-- =============================================================================
-- BLOQUE 27 — Superficie de ejecución: quién puede llamar a las funciones
-- (Security Advisor / splinter, migración 20260818190000_hardening_advisor)
-- -----------------------------------------------------------------------------
-- POR QUÉ ESTE BLOQUE EXISTE. Hasta el Sprint 17 el arnés ya probaba, función
-- por función, que `authenticated` NO podía ejecutar las SECURITY DEFINER
-- privilegiadas ("A ejecuta generar_recordatorios_pendientes()", "Elena ejecuta
-- leer_refresh_token_gmail sobre la cuenta de Rubén", y unas cuantas más). Esos
-- casos pasaban. Pero pasaban por una razón que no era la nuestra: el stack
-- local ya defaultea a "nada se auto-expone", mientras que el proyecto de
-- Supabase cloud arrastra el `alter default privileges ... grant execute on
-- functions to anon, authenticated, service_role` de la época en que `public`
-- se auto-exponía. Nuestro `revoke ... from public` no borraba esos dos grants
-- explícitos —PUBLIC es el pseudo-rol "todos", `anon` y `authenticated` son
-- roles de verdad con su propia entrada en el ACL—, así que en PRODUCCIÓN las
-- 50 funciones SECURITY DEFINER de `public` eran llamables por cualquiera con
-- sesión, y 32 casos de este mismo arnés eran falsos en la única base que
-- importa. El experimento está contado en el encabezado de la migración.
--
-- Este bloque prueba la superficie de ejecución COMO INVARIANTE ESTRUCTURAL, no
-- función por función: cuenta y compara listas completas. Una función nueva que
-- alguien exponga sin querer rompe el caso de la lista, no espera a que alguien
-- se acuerde de escribirle su caso hostil. El caso 9 va más lejos y deja
-- MEDIDA la trampa de fondo: una función nueva en `public` nace abierta a
-- PUBLIC pase lo que pase con los privilegios por defecto, y por eso el revoke
-- explícito de cada migración no es opcional. Los casos 11 y 12 hacen lo mismo
-- con una deuda que NO se pudo cerrar (los grants de pg_net sobre el esquema
-- `net`, que son de `supabase_admin` y `postgres` no puede revocar).
--
-- Los casos "SÍ puede" (17, 18) están para que el hardening no se pase de
-- rosca: si alguien revoca de más, los predicados que las políticas RLS
-- invocan dejan de funcionar y la app se cae entera. Que estén acá obliga a
-- que cualquier ajuste futuro mantenga las dos direcciones.
--
-- No hace falta crear cuentas: casi todo se lee del catálogo, y los casos
-- conductuales usan uuid de relleno —lo que se prueba es el privilegio, que
-- Postgres verifica ANTES de ejecutar el cuerpo, así que el dato da igual—.
-- =============================================================================
\echo ''
\echo '### BLOQUE 27 — superficie de ejecución de las funciones (Security Advisor)'

-- ── 1–3. Nadie sin nombre y nadie anónimo: PUBLIC y anon, a cero.
select pruebas_rls.registrar('27. Superficie de ejecución',
       'Ninguna función de public conserva EXECUTE de PUBLIC  [CRITERIO DE ACEPTACIÓN]', '0',
       (select count(*)::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0));

select pruebas_rls.registrar('27. Superficie de ejecución',
       'Ninguna función de public es ejecutable por anon  [CRITERIO DE ACEPTACIÓN]', '0',
       (select count(*)::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')));

-- Éste es, literal, el lint 0028 del splinter ("Public Can Execute SECURITY
-- DEFINER Function"): el que mostraba 50 avisos en el Advisor de producción.
select pruebas_rls.registrar('27. Superficie de ejecución',
       'Lint 0028 (anon ejecuta SECURITY DEFINER): sin hallazgos', '0',
       (select count(*)::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef
           and has_function_privilege('anon', p.oid, 'EXECUTE')));

-- ── 4–6. `authenticated`: exactamente las 19 previstas, ni una más.
select pruebas_rls.registrar('27. Superficie de ejecución',
       'authenticated ejecuta exactamente 20 funciones de public', '20',
       (select count(*)::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')));

-- La lista, textual. Si alguien agrega o saca una, este caso lo dice con
-- nombre y apellido en vez de mostrar un número que no cierra.
select pruebas_rls.registrar('27. Superficie de ejecución',
       'La lista de funciones que authenticated ejecuta es EXACTAMENTE la prevista  [CRITERIO DE ACEPTACIÓN]',
       'confirmar_documento_recien_subido,crear_perfil_gestionado,descartar_documento_recien_subido,'
       || 'es_perfil_gestionado,es_sesion_de_usuario,es_titular,especialidades_todas_no_vacias,nombres_de_perfiles_vinculados,'
       || 'perfil_actor,perfil_de_objeto_storage,perfil_id_por_email,puede_administrar_perfil,'
       || 'puede_arrancar_administracion,puede_cargar_en_perfil,puede_graduar_perfil,'
       || 'puede_otorgar_permisos,puede_ver_perfil,registrar_suscripcion_push,registrar_toma,revertir_toma',
       (select string_agg(p.proname, ',' order by p.proname)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')));

-- De esas 19, 17 son SECURITY DEFINER: son las que el lint 0029 sigue
-- reportando y que `docs/seguridad-rls.md` documenta como deliberadas (los
-- predicados que invocan las políticas RLS + los RPC de escritura de la app).
-- Las otras dos -es_sesion_de_usuario, perfil_de_objeto_storage- son INVOKER.
select pruebas_rls.registrar('27. Superficie de ejecución',
       'De esas 19, 17 son SECURITY DEFINER (las que el lint 0029 reporta a propósito)', '17',
       (select count(*)::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef
           and has_function_privilege('authenticated', p.oid, 'EXECUTE')));

-- ── 7. `service_role` (la clave del servidor) tampoco queda con todo.
-- Las 23 que no están son las tres configurar_cron_*, las tres disparar_*,
-- crear_perfil_de_cuenta() y las 16 de trigger y CHECK.
select pruebas_rls.registrar('27. Superficie de ejecución',
       'service_role ejecuta exactamente 40 funciones (no las 62 del esquema)', '40',
       (select count(*)::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where n.nspname = 'public' and a.privilege_type = 'EXECUTE'
           and pg_get_userbyid(a.grantee) = 'service_role'));

-- ── 8–9. La fuente: los privilegios POR DEFECTO del esquema.
-- Este es el caso que habría cazado el problema el primer día. En el proyecto
-- de cloud, antes de la migración de hardening, este contador daba 3.
select pruebas_rls.registrar('27. Superficie de ejecución',
       'Los privilegios por defecto de public/funciones no otorgan a PUBLIC, anon, authenticated ni service_role  [CRITERIO DE ACEPTACIÓN]', '0',
       (select coalesce(count(*), 0)::text
          from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace,
               lateral aclexplode(d.defaclacl) a
         where n.nspname = 'public' and d.defaclobjtype = 'f'
           and pg_get_userbyid(d.defaclrole) = 'postgres'
           and a.privilege_type = 'EXECUTE'
           and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))));

-- ── 9. LA TRAMPA, MEDIDA. Este caso no verifica que algo esté bien: verifica
-- que algo SIGUE ESTANDO MAL, y por eso está escrito así a propósito.
--
-- Uno esperaría que, con el default del caso anterior en `{postgres=X}`, una
-- función nueva naciera cerrada. No pasa: Postgres le pone `proacl = NULL`, que
-- es su default interno `{=X/dueño, dueño=X/dueño}`, y ese `=X` es PUBLIC. O
-- sea que el EXECUTE de PUBLIC —y con él el de `anon`, que es parte de PUBLIC—
-- REAPARECE en cada `create function`, haga lo que haga el `alter default
-- privileges`.
--
-- Se mide corriéndolo, en vez de dejarlo escrito en un comentario, por dos
-- razones. La primera: es la justificación de por qué cada migración tiene que
-- revocar a mano sus funciones nuevas, y de por qué el caso "ninguna función de
-- public es ejecutable por anon" no se puede relajar nunca. La segunda: si
-- algún día Postgres o Supabase cambian este comportamiento, este caso pasa a
-- FAIL, alguien lee este comentario, y la nota se actualiza en vez de quedar
-- mintiendo en un archivo durante dos años.
--
-- Se borra en el acto: no usa rollback porque el registro del resultado se
-- iría con él.
create function public.zz_arnes_privilegio_por_defecto() returns integer language sql as $$ select 1 $$;

select pruebas_rls.registrar('27. Superficie de ejecución',
       'TRAMPA MEDIDA: una función NUEVA en public nace ABIERTA a PUBLIC (por eso cada migración revoca a mano)',
       'PUBLIC=true, anon=true, authenticated=true',
       'PUBLIC=' || (exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                              where p.oid = 'public.zz_arnes_privilegio_por_defecto()'::regprocedure
                                and a.grantee = 0 and a.privilege_type = 'EXECUTE'))::text
       || ', anon=' || has_function_privilege('anon', 'public.zz_arnes_privilegio_por_defecto()', 'EXECUTE')::text
       || ', authenticated=' || has_function_privilege('authenticated', 'public.zz_arnes_privilegio_por_defecto()', 'EXECUTE')::text);

drop function public.zz_arnes_privilegio_por_defecto();

-- ── 10. Lint 0011: ninguna función con search_path mutable.
-- Ya era regla del proyecto (`set search_path = ''` en toda SECURITY DEFINER);
-- acá queda medido, para que se note el día que a alguna se le escape.
select pruebas_rls.registrar('27. Superficie de ejecución',
       'Lint 0011 (search_path mutable): ninguna función de public se escapó', '0',
       (select count(*)::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')));

-- ── 11–12. pg_net: DEUDA CONOCIDA, medida en vez de comentada.
--
-- pg_net otorga por su cuenta USAGE sobre el esquema `net` y EXECUTE sobre
-- `net.http_post` / `net.http_get` a `anon` y `authenticated`. En potencia eso
-- es un SSRF con la identidad de la base. La migración de hardening trajo los
-- `revoke` correspondientes y hubo que sacarlos: **no se puede**. `net` y sus
-- funciones son de `supabase_admin`, y `postgres` no es miembro suyo ni
-- superusuario (ni en cloud ni acá), así que el `revoke` se ejecuta, no revoca
-- nada y solo deja un WARNING que en un `db push` no lo ve nadie.
--
-- Se acepta porque `net` no está entre los esquemas que expone PostgREST
-- (`public, graphql_public`): no hay `/rest/v1/rpc/http_post`. Llegar requiere
-- ejecución de SQL arbitrario, y con eso pg_net ya es lo de menos.
--
-- Estos dos casos existen para que la deuda tenga un valor que se pueda mirar.
-- El día que Supabase cambie ese default, o que alguien exponga `net`, cambian
-- de valor y el tema vuelve a la mesa en vez de dormir en un comentario.
select pruebas_rls.registrar('27. Superficie de ejecución',
       'El esquema net es de supabase_admin: por eso `postgres` no puede revocar sus grants', 'supabase_admin',
       (select pg_get_userbyid(n.nspowner) from pg_namespace n where n.nspname = 'net'));

select pruebas_rls.registrar('27. Superficie de ejecución',
       'DEUDA CONOCIDA: anon/authenticated conservan EXECUTE sobre net.http_get y net.http_post (grant de Supabase, no revocable)',
       'http_get,http_post',
       coalesce((select string_agg(distinct p.proname, ',' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'net' and p.proname in ('http_post', 'http_get')
                    and (has_function_privilege('anon', p.oid, 'EXECUTE')
                      or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
                '(ninguna)'));

-- ── 13. Los crons siguen en pie. El hardening no toca privilegios de
-- `postgres`, que es con quien corren los cuatro jobs; este caso lo deja
-- escrito para que un cambio futuro de privilegios no los apague de costado.
select pruebas_rls.registrar('27. Superficie de ejecución',
       'Los cuatro jobs de pg_cron siguen activos y corriendo como postgres  [CRITERIO DE ACEPTACIÓN]', '4',
       (select count(*)::text from cron.job
         where jobname in ('recordatorios-turnos', 'generar-tomas-del-dia',
                           'alertas-medicacion', 'barrido-gmail')
           and active and username = 'postgres'));

-- ── 14–18. Lo mismo, pero probado desde adentro de una sesión `authenticated`:
-- que el privilegio no esté es una cosa, que Postgres devuelva 42501 al
-- intentarlo es la que le importa a quien ataca.
begin;
select set_config('request.jwt.claims', '{"sub":"f2700aaa-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v text; t text;
begin
    begin
        select public.leer_refresh_token_gmail('f2700aaa-1111-4111-8111-111111111111') into t;
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('27. Superficie de ejecución',
        'authenticated ejecuta leer_refresh_token_gmail (leía el token de Gmail de CUALQUIER cuenta)  [CASO HOSTIL]',
        'denegada (42501)', v);
end $$;

do $$
declare v text;
begin
    begin
        perform public.configurar_cron_recordatorios('https://atacante.example/robo', 'secreto-del-atacante');
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('27. Superficie de ejecución',
        'authenticated ejecuta configurar_cron_recordatorios (reapuntaba el cron a su propia URL)  [CASO HOSTIL]',
        'denegada (42501)', v);
end $$;

do $$
declare v text; c integer;
begin
    begin
        select count(*) into c from public.destinatarios_de_avisos('f2700aaa-1111-4111-8111-111111111111');
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('27. Superficie de ejecución',
        'authenticated ejecuta destinatarios_de_avisos (fuga de user_id ajenos)  [CASO HOSTIL]',
        'denegada (42501)', v);
end $$;

-- Y las dos direcciones: el camino permitido sigue abierto. Si el hardening se
-- pasara de rosca acá, las políticas RLS que invocan estos predicados
-- dejarían de evaluarse y la app entera devolvería 42501.
do $$
declare v text; t uuid;
begin
    begin
        select public.perfil_actor() into t;
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('27. Superficie de ejecución',
        'authenticated SÍ ejecuta perfil_actor() (el hardening no se pasó de rosca)', 'ejecutada', v);
end $$;

do $$
declare v text; t boolean;
begin
    begin
        select public.es_titular('f2700aaa-1111-4111-8111-111111111111') into t;
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('27. Superficie de ejecución',
        'authenticated SÍ ejecuta es_titular() (predicado que invocan las políticas RLS)', 'ejecutada', v);
end $$;

commit;

-- ── 19–20. Y desde `anon`, que es el rol de la clave pública: nada.
begin;
set local role anon;

do $$
declare v text; t boolean;
begin
    begin
        select public.puede_ver_perfil('f2700aaa-1111-4111-8111-111111111111') into t;
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('27. Superficie de ejecución',
        'anon ejecuta puede_ver_perfil  [CASO HOSTIL]', 'denegada (42501)', v);
end $$;

do $$
declare v text; t uuid;
begin
    begin
        select public.perfil_actor() into t;
        v := 'ejecutada';
    exception when insufficient_privilege then v := 'denegada (42501)';
             when others                  then v := 'error ' || sqlstate;
    end;
    perform pruebas_rls.registrar('27. Superficie de ejecución',
        'anon ejecuta perfil_actor  [CASO HOSTIL]', 'denegada (42501)', v);
end $$;

commit;


-- =============================================================================
-- RESUMEN
-- =============================================================================
\echo ''
\echo '======================================================================'
\echo '  RESULTADO POR CASO'
\echo '======================================================================'

\pset border 2
select n,
       bloque,
       caso,
       esperado,
       obtenido,
       case when ok then 'PASS' else 'FAIL' end as estado
  from pruebas_rls.resultado
 order by n;

\echo ''
\echo '======================================================================'
\echo '  TOTALES'
\echo '======================================================================'

select count(*)                          as casos,
       count(*) filter (where ok)        as pass,
       count(*) filter (where not ok)    as fail,
       case when count(*) filter (where not ok) = 0
            then 'TODOS LOS CASOS PASARON'
            else 'HAY CASOS EN FALLA — revisar el detalle de arriba'
       end                               as veredicto
  from pruebas_rls.resultado;


-- =============================================================================
-- LIMPIEZA (deja la base como estaba, para poder repetir la corrida)
-- =============================================================================
-- Orden obligatorio: los perfiles gestionados primero. Borrar antes las cuentas
-- haría que el CASCADE quitara el único can_manage de un perfil gestionado y el
-- trigger de no orfandad abortaría la limpieza — comportamiento correcto que el
-- BLOQUE 5 ya verifica de forma explícita.

delete from public.profiles  where id in (:p_g, :p_g2, :p_g3);
delete from auth.users       where id in (:u_a, :u_b);
-- Entidades propias del BLOQUE 15 (fix de auditoría 10.5: faltaban acá y el
-- residuo rompía la corrida siguiente). Mismo orden: gestionado primero.
delete from public.profiles  where id = 'f1500000-0000-4000-8000-00000000f503';
-- Filas del BLOQUE 16 (auditoría 11.4). Van ANTES del delete de auth.users:
-- el `on delete cascade` de shared_uploads_temp.user_id igual las llevaría,
-- pero explícito es más fácil de auditar y no depende del orden de los FK.
delete from public.shared_uploads_temp
 where id in ('f1600000-0000-4000-8000-00000000f601', 'f1600000-0000-4000-8000-00000000f602');
-- Filas del BLOQUE 18 (Sprint 12, tarea 12.1). Mismo criterio: el
-- `on delete cascade` de consents.user_id igual las llevaría, pero explícito
-- no depende del orden de los FK.
delete from public.consents
 where user_id in ('f1500aaa-1111-4111-8111-111111111111', 'f1500bbb-2222-4222-8222-222222222222');
delete from auth.users       where id in ('f1500aaa-1111-4111-8111-111111111111', 'f1500bbb-2222-4222-8222-222222222222');
-- Cuentas del BLOQUE 19 (hotfix del alta). Alcanza con borrar la cuenta: su
-- perfil propio y sus consents cuelgan de ella con ON DELETE CASCADE, y
-- ninguna administra un perfil gestionado, así que no hay orden que respetar.
delete from auth.users       where id in (
    'f1900aaa-1111-4111-8111-111111111111',
    'f1900bbb-2222-4222-8222-222222222222',
    'f1900ccc-3333-4333-8333-333333333333');
-- Entidades del BLOQUE 20 (Sprint 15, tarea 15.1). Los perfiles gestionados
-- creados por crear_perfil_gestionado() -Lucas y, del replay, Sofía- primero
-- -mismo motivo que el resto de este bloque: el trigger de no orfandad
-- abortaría si se borrara antes la cuenta de Noelia-, filtrados por
-- created_by_profile_id en vez de por su id -generado por gen_random_uuid(),
-- no fijo- para no depender de que los GUC de sesión sigan vivos acá.
delete from public.profiles
 where created_by_profile_id = 'f2000000-0000-4000-8000-00000000f001';
-- Las cuatro cuentas del bloque. f2000ddd nunca administró nada (guarda 1);
-- las otras tres solo tenían su perfil propio, ya sin nada gestionado
-- colgando después del delete de arriba.
delete from auth.users       where id in (
    'f2000aaa-1111-4111-8111-111111111111',
    'f2000bbb-2222-4222-8222-222222222222',
    'f2000ccc-3333-4333-8333-333333333333',
    'f2000ddd-4444-4444-8444-444444444444');
-- Entidades del BLOQUE 21 (Sprint 15, tarea 15.2). El perfil de Tomás se
-- borra por `created_by_profile_id` -no por su id, generado por
-- gen_random_uuid()- para no depender de que el GUC de sesión siga vivo acá.
-- Va PRIMERO por la regla de siempre, aunque en este caso ya no haga falta:
-- después de la graduación el perfil dejó de ser gestionado y el trigger de
-- no orfandad ya no lo protege. El orden se mantiene igual porque el bloque
-- también deja perfiles gestionados si se interrumpe antes de graduar.
delete from public.profiles
 where created_by_profile_id = 'f2100000-0000-4000-8000-00000000f101';
delete from auth.users       where id in (
    'f2100aaa-1111-4111-8111-111111111111',
    'f2100bbb-2222-4222-8222-222222222222',
    'f2100ccc-3333-4333-8333-333333333333',
    'f2100ddd-4444-4444-8444-444444444444',
    'f2100eee-5555-4555-8555-555555555555',
    'f2100fff-6666-4666-8666-666666666666',
    'f2100999-7777-4777-8777-777777777777',
    'f2100888-8888-4888-8888-888888888888',
    'f2100777-9999-4999-8999-999999999999',
    'f2100666-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
-- Cuentas del BLOQUE 23 (Sprint 17, tarea 17.1). La de Rubén ya se borró
-- dentro del bloque -es parte de lo que prueba: que la baja de cuenta se lleve
-- el token del Vault-, así que este delete solo alcanza a la de Elena. Va con
-- `in (...)` igual, para que el bloque siga limpiando bien si algún día se
-- interrumpe antes de esa baja. El CASCADE se lleva la fila de
-- gmail_connections y el trigger AFTER DELETE se lleva el secreto del Vault;
-- por las dudas -una fila borrada a mano, un secreto huérfano de una corrida
-- interrumpida- se barren también los secretos por nombre.
delete from auth.users where id in (
    'f2200aaa-1111-4111-8111-111111111111',
    'f2200bbb-2222-4222-8222-222222222222');
delete from vault.secrets where name in (
    'gmail_refresh_token_f2200aaa-1111-4111-8111-111111111111',
    'gmail_refresh_token_f2200bbb-2222-4222-8222-222222222222');
-- Cuentas del BLOQUE 25 (Sprint 17, tarea 17.3): el perfil gestionado
-- descartable del caso 12 ya se borró dentro del bloque -es parte de lo que
-- prueba-, se repite acá igual por las dudas. El perfil gestionado principal
-- (f2400d00) va primero, después las tres cuentas -el CASCADE se lleva sus
-- conexiones de Gmail y el trigger AFTER DELETE el secreto del Vault-, y por
-- las dudas también los secretos por nombre.
delete from public.profiles where id in (
    'f2400d00-2222-4222-8222-222222222222',
    'f2400e00-2222-4222-8222-222222222222');
delete from auth.users where id in (
    'f2400a00-1111-4111-8111-111111111111',
    'f2400b00-1111-4111-8111-111111111111',
    'f2400c00-1111-4111-8111-111111111111');
delete from vault.secrets where name in (
    'gmail_refresh_token_f2400a00-1111-4111-8111-111111111111',
    'gmail_refresh_token_f2400b00-1111-4111-8111-111111111111');
delete from public.storage_purge_queue where source_table in ('documents', 'insurance_cards', 'profiles');
-- Cuentas del BLOQUE 26 (tarea #14, tutorial de bienvenida). Alcanza con
-- borrar las dos cuentas: sus filas de consejos_estado cuelgan con
-- ON DELETE CASCADE y ninguna de las dos tiene perfil con id fijo que
-- limpiar aparte (el trigger de alta les crea uno con id aleatorio, que se
-- va con el mismo CASCADE).
delete from auth.users where id in (
    'f2600aaa-1111-4111-8111-111111111111',
    'f2600bbb-2222-4222-8222-222222222222');

drop schema pruebas_rls cascade;

\echo ''
\echo 'Datos de prueba eliminados. La base queda como antes de correr el script.'
