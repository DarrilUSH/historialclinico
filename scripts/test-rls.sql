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
delete from public.storage_purge_queue where source_table in ('documents', 'insurance_cards', 'profiles');

-- El BLOQUE 15 crea usuarios y perfiles propios.
-- Nota: la limpieza de estos perfiles al final de la corrida falla porque el
-- trigger evitar_perfil_gestionado_huerfano() previene borrar el administrador
-- de un perfil gestionado. Se deja para que `npx supabase db reset` lo limpie.

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

-- El default del producto es el modo grande, y toda fila existente lo heredó
-- del `ALTER TABLE ... DEFAULT` sin migración de datos.
select pruebas_rls.registrar('17. densidad',
       'Toda fila de profiles arranca en el modo grande (default de la columna)',
       '0 filas distintas de grande',
       count(*) || ' filas distintas de grande')
  from public.profiles where display_density <> 'grande';

-- ── El titular SÍ cambia la suya.
begin;
select set_config('request.jwt.claims', :jwt_a, true);
set local role authenticated;

do $$
declare v integer;
begin
    update public.profiles set display_density = 'chica'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    get diagnostics v = row_count;
    perform pruebas_rls.registrar('17. densidad',
        'A cambia SU PROPIA preferencia de tamaño  [CRITERIO DE ACEPTACIÓN]',
        '1 filas', v || ' filas');
end $$;

select pruebas_rls.registrar('17. densidad',
       'El valor quedó persistido en la fila de A', 'chica', display_density::text)
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
do $$
declare v text; n integer;
begin
    begin
        update public.profiles set display_density = 'chica'
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
        update public.profiles set display_density = 'grande'
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
       'La preferencia de A siguió intacta después del intento de B', 'chica',
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
       'chica',
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
do $$
declare v text; n integer;
begin
    begin
        update public.profiles set display_density = 'chica'
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
-- editado a los totales de otras corridas.
update public.profiles set display_density = 'grande' where id = :p_a;
update public.profiles set blood_type = 'A+'           where id = :p_a;


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
delete from public.storage_purge_queue where source_table in ('documents', 'insurance_cards', 'profiles');

drop schema pruebas_rls cascade;

\echo ''
\echo 'Datos de prueba eliminados. La base queda como antes de correr el script.'
