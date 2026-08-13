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
delete from public.profiles  where id    in (:p_g, :p_g2);
delete from auth.users       where id    in (:u_a, :u_b);
delete from public.storage_purge_queue where source_table in ('documents', 'insurance_cards', 'profiles');


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

grant usage on schema pruebas_rls to anon, authenticated;
grant select, insert on pruebas_rls.resultado to anon, authenticated;
grant usage, select on sequence pruebas_rls.resultado_n_seq to anon, authenticated;


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
                     'confirmar_documento_recien_subido', 'descartar_documento_recien_subido')
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
-- -----------------------------------------------------------------------------
-- Orden obligatorio: los perfiles gestionados primero. Borrar antes las cuentas
-- haría que el CASCADE quitara el único can_manage de un perfil gestionado y el
-- trigger de no orfandad abortaría la limpieza — comportamiento correcto que el
-- BLOQUE 5 ya verifica de forma explícita.
-- =============================================================================

delete from public.profiles  where id in (:p_g, :p_g2);
delete from auth.users       where id in (:u_a, :u_b);
delete from public.storage_purge_queue where source_table in ('documents', 'insurance_cards', 'profiles');

drop schema pruebas_rls cascade;

\echo ''
\echo 'Datos de prueba eliminados. La base queda como antes de correr el script.'
