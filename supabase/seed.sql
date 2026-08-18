-- =============================================================================
-- Historial Médico — Seed de datos de prueba
-- =============================================================================
-- Contenido:
--   - 2 usuarios en auth.users (María y Diego)
--   - 3 perfiles: María (con cuenta), Diego (con cuenta), Roberto (gestionado)
--   - Familia del modelo de permisos: María administra a Roberto, Diego solo ve
--   - Densidad (Sprint 14): María hereda el default nuevo ('chica'), Diego elige
--     'grande' explícito, Roberto la lleva inerte en el default por ser un
--     perfil gestionado. Las dos cuentas miran el MISMO perfil con densidades
--     distintas, que es la idea central de docs/densidad.md §1.
--   - Datos de Roberto: 5 documentos, 20 métricas de lab, 3 turnos, 2 medicaciones,
--     algunas tomas registradas, 10 signos vitales, 2 médicos, 1 cobertura, 1 suscripción push
--
-- Convenciones:
--   - Identificadores en inglés, documentación en español, UTF-8 sin BOM
--   - Storage paths: {profile_id}/{año}/{uuid}.ext
--   - Credenciales de prueba: password123
--   - Todas las fechas en 2025-2026 para contexto realista
--   - Datos de Roberto: completos para la ficha SOS (documento, teléfono, grupo
--     sanguíneo, alergias, condiciones crónicas, contacto de emergencia)
-- =============================================================================

-- UUIDs para reproducibilidad
-- Users
-- María: 550e8400-e29b-41d4-a716-446655440001
-- Diego: 550e8400-e29b-41d4-a716-446655440002
-- Profiles
-- María: 660e8400-e29b-41d4-a716-446655440001
-- Diego: 660e8400-e29b-41d4-a716-446655440002
-- Roberto: 660e8400-e29b-41d4-a716-446655440003


-- =============================================================================
-- 1. USUARIOS EN auth.users
-- =============================================================================

-- María Gómez (administrador, puede gestionar perfiles)
--
-- OJO: confirmation_token, recovery_token y email_change_token_new no tienen
-- default en el esquema de auth.users (default NULL, a diferencia de
-- phone_change_token / email_change_token_current / reauthentication_token,
-- que sí default a '' ). GoTrue los escanea como string no-nullable: un
-- login por password contra un usuario insertado sin estos tres campos en
-- '' falla con 500 "sql: Scan error ... converting NULL to string is
-- unsupported". Un signUp real vía API nunca lo sufre porque GoTrue inserta
-- '' él mismo; acá, insertando directo por SQL, hay que hacerlo a mano.
insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data
) values (
    '550e8400-e29b-41d4-a716-446655440001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    'maria@ejemplo.com.ar',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    now(),
    '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
) on conflict (id) do nothing;

-- Diego Gómez (familiar, solo visualización de Roberto)
insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data
) values (
    '550e8400-e29b-41d4-a716-446655440002'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    'diego@ejemplo.com.ar',
    crypt('password123', gen_salt('bf')),
    now(),
    now(),
    now(),
    '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
) on conflict (id) do nothing;


-- =============================================================================
-- 2. PERFILES
-- =============================================================================
-- Desde `20260814140000_alta_de_cuenta.sql`, el trigger
-- `auth_users_crear_perfil_de_cuenta` YA le creó a cada cuenta de arriba su
-- perfil propio (con un id aleatorio) y sus dos filas de `consents`. El seed
-- necesita ids FIJOS —los referencian todas las secciones siguientes—, así que
-- descarta ese perfil automático y carga el suyo. Los `consents` se dejan: son
-- correctos y hacen que las cuentas del seed se parezcan a una cuenta real.
--
-- El `id not in (...)` no es decorativo: sin él, correr el seed dos veces
-- borraría los perfiles definitivos de María y Diego —y con ellos, en cascada,
-- todos los datos de salud que cuelgan de sus perfiles—.
delete from public.profiles
 where user_id in (
           '550e8400-e29b-41d4-a716-446655440001'::uuid,
           '550e8400-e29b-41d4-a716-446655440002'::uuid
       )
   and id not in (
           '660e8400-e29b-41d4-a716-446655440001'::uuid,
           '660e8400-e29b-41d4-a716-446655440002'::uuid
       );

-- María Gómez (titular, con cuenta, administrador)
insert into public.profiles (
    id, user_id, full_name, date_of_birth, role,
    blood_type, allergies, chronic_conditions,
    created_at, updated_at
) values (
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    '550e8400-e29b-41d4-a716-446655440001'::uuid,
    'María Gómez',
    '1982-05-15'::date,
    'admin',
    'A+',
    '{"Penicilina"}',
    '{}',
    now(),
    now()
) on conflict (id) do nothing;

-- Diego Gómez (titular, con cuenta, familiar)
--
-- `display_density = 'grande'` EXPLÍCITO, y es el único lugar de todo el seed
-- donde esta columna se escribe a mano (Sprint 14, tarea 14.1). Tres cosas que
-- conviene tener claras antes de tocarlo:
--
--   1. **Desde el Sprint 14 el default de la columna es 'chica'** (migración
--      20260817150000). María, que no la declara, la hereda: es la cuenta que
--      "ve bien" del guion del ROADMAP y le corresponde la densidad nativa.
--   2. **Diego representa a quien prefiere el modo grande.** En el guion ese
--      papel es de Roberto (80 años), pero Roberto NO PUEDE tenerlo: su perfil
--      es gestionado (`user_id is null`), nunca inicia sesión, y el CHECK
--      `profiles_densidad_solo_con_cuenta` clava su densidad en el default
--      justamente porque un perfil que no mira nada no tiene preferencia (ver
--      la migración 20260814120000, "PERFILES GESTIONADOS"). La preferencia es
--      de quien MIRA, y en el seed los que miran son María y Diego.
--   3. **Es lo que hace demostrable la idea central del subsistema.** Con esta
--      línea, las dos cuentas del seed miran EL MISMO perfil (el de Roberto) y
--      lo ven con densidades distintas: María compacta, Diego grande. Sin ella,
--      después del cambio de default el seed entero sería chica y esa
--      distinción no se podría demostrar en la demo.
--
-- Sirve además de prueba viva de que una elección explícita convive con el
-- default nuevo: el CHECK la acepta (tiene cuenta) y ninguna migración la pisa.
insert into public.profiles (
    id, user_id, full_name, date_of_birth, role,
    blood_type, allergies, chronic_conditions,
    display_density,
    created_at, updated_at
) values (
    '660e8400-e29b-41d4-a716-446655440002'::uuid,
    '550e8400-e29b-41d4-a716-446655440002'::uuid,
    'Diego Gómez',
    '1985-09-22'::date,
    'family_member',
    'O-',
    '{}',
    '{}',
    'grande',
    now(),
    now()
) on conflict (id) do nothing;

-- Roberto Gómez (GESTIONADO, sin cuenta, creado por María)
-- Datos SOS completos para pruebas offline.
--
-- `national_id` y `phone` están cargados a propósito, y no solo para que la
-- ficha SOS muestre el DNI en vez de "DNI no registrado"
-- (`components/sos/ficha-sos.tsx`): son los dos campos que el criterio de
-- aceptación de la tarea 10.2 exige buscar —y no encontrar— en el contexto que
-- se le manda a Gemini. Con las columnas en NULL, esa verificación contra el
-- seed sería vacua: no se puede probar que no viaja un dato que no existe.
-- Ver `docs/minimizacion-datos.md` §7.3.
--
-- `display_density = 'chica'` EXPLÍCITO, y no significa que Roberto prefiera la
-- letra chica: significa que **no tiene preferencia**. Un perfil gestionado no
-- tiene cuenta, nunca inicia sesión y nunca mira nada, así que su densidad es
-- inerte y el CHECK `profiles_densidad_solo_con_cuenta` la clava en el DEFAULT
-- de la columna —que desde el Sprint 14 es 'chica' (migración 20260817150000)—.
-- La densidad con la que se ve el historial de Roberto sale siempre de la fila
-- de la cuenta que lo esté mirando: María lo ve compacto, Diego lo ve grande.
--
-- Se escribe a mano en vez de dejarlo al default a propósito: si algún día el
-- default de la columna volviera a moverse, este INSERT se caería contra el
-- CHECK y obligaría a revisar este comentario, en vez de quedar desalineado en
-- silencio. Es la misma clase de red que la constante de legales duplicada en
-- `completar_alta_de_cuenta`.
insert into public.profiles (
    id, user_id, full_name, national_id, phone, date_of_birth, role,
    created_by_profile_id,
    blood_type, allergies, chronic_conditions,
    critical_medication, emergency_contact, emergency_contact_phone,
    emergency_contact_relationship, sos_notes,
    display_density,
    created_at, updated_at
) values (
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    null,
    'Roberto Gómez',
    '8234567',
    '+54 9 2901 445566',
    '1945-11-03'::date,
    'elder',
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    'O+',
    '{"Penicilina","Ibuprofeno"}',
    '{"Hipertensión arterial","Diabetes tipo 2","Insuficiencia cardíaca"}',
    '{"Enalapril 10 mg","Metformina 850 mg"}',
    'Gabriela Gómez',
    '+54 9 2901 234567',
    'Hija',
    'Marcapasos colocado en 2019. Usa lentes. Prefiere atención en español.',
    'chica',
    now(),
    now()
) on conflict (id) do nothing;


-- =============================================================================
-- 3. PERMISOS FAMILIARES (modelo de permisos)
-- =============================================================================

-- María → Roberto: administración total (can_view, can_upload, can_manage)
insert into public.family_permissions (
    owner_profile_id, granted_profile_id,
    can_view, can_upload, can_manage,
    created_at, updated_at
) values (
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    true, true, true,
    now(), now()
) on conflict (owner_profile_id, granted_profile_id) do nothing;

-- Diego → Roberto: solo lectura (can_view)
insert into public.family_permissions (
    owner_profile_id, granted_profile_id,
    can_view, can_upload, can_manage,
    created_at, updated_at
) values (
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    '660e8400-e29b-41d4-a716-446655440002'::uuid,
    true, false, false,
    now(), now()
) on conflict (owner_profile_id, granted_profile_id) do nothing;


-- =============================================================================
-- 4. MÉDICOS (directorio de profesionales)
-- =============================================================================

-- Clínica médica Y cardióloga (Sprint 16, tarea 16.2: caso real del usuario
-- -"mi médica real es clínica y cardióloga"-, sembrado acá para poder probar
-- el directorio con multi-especialidad sin cargar nada a mano).
insert into public.doctors (
    id, profile_id, full_name, specialties, license_number,
    institution, phone, address, city, province,
    latitude, longitude, is_active,
    created_by_profile_id,
    created_at, updated_at
) values (
    '990e8400-e29b-41d4-a716-446655440001'::uuid,
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Dr. Carlos Rodríguez',
    array['Clínica Médica', 'Cardiología'],
    'MN 45678',
    'Clínica Ushuaia',
    '+54 2901 234000',
    'Gob. Paz 150',
    'Ushuaia',
    'Tierra del Fuego, Antártida e Islas del Atlántico Sur',
    -54.8083,
    -68.3000,
    true,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now(), now()
) on conflict (id) do nothing;

-- Endocrinóloga
insert into public.doctors (
    id, profile_id, full_name, specialties, license_number,
    institution, phone, address, city, province,
    latitude, longitude, is_active,
    created_by_profile_id,
    created_at, updated_at
) values (
    '990e8400-e29b-41d4-a716-446655440002'::uuid,
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Dra. Marcela Torres',
    array['Endocrinología'],
    'MN 56789',
    'Consultorio Torres',
    '+54 2901 234111',
    'Maipú 345',
    'Ushuaia',
    'Tierra del Fuego, Antártida e Islas del Atlántico Sur',
    -54.8078,
    -68.2999,
    true,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now(), now()
) on conflict (id) do nothing;


-- =============================================================================
-- 5. DOCUMENTOS (estudios, recetas)
-- =============================================================================

-- Análisis de laboratorio (2026-08-01)
insert into public.documents (
    id, profile_id, title, category, specialty, institution,
    doctor_name, doctor_id, document_date, storage_path,
    mime_type, file_size_bytes, ai_summary, ai_confidence,
    created_by_profile_id,
    created_at, updated_at
) values (
    '770e8400-e29b-41d4-a716-446655440001'::uuid,
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Análisis de sangre completo — Laboratorio Central',
    'laboratory',
    'Hematología',
    'Laboratorio Central Ushuaia',
    'Lic. Juan Pérez',
    null,
    '2026-08-01'::date,
    '660e8400-e29b-41d4-a716-446655440003/2026/d8f4c1b9.pdf',
    'application/pdf',
    245632,
    'Análisis completo con glucemia elevada (145 mg/dL). Hemoglobina normal.',
    0.87,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now() - interval '15 days',
    now() - interval '15 days'
) on conflict (storage_path) do nothing;

-- Receta — Metformina (2026-07-20)
insert into public.documents (
    id, profile_id, title, category, specialty, doctor_name,
    doctor_id, document_date, storage_path,
    mime_type, file_size_bytes,
    created_by_profile_id,
    created_at, updated_at
) values (
    '770e8400-e29b-41d4-a716-446655440002'::uuid,
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Receta — Metformina 850 mg',
    'prescription',
    'Endocrinología',
    'Dra. Marcela Torres',
    '990e8400-e29b-41d4-a716-446655440002'::uuid,
    '2026-07-20'::date,
    '660e8400-e29b-41d4-a716-446655440003/2026/d4a7f2e1.pdf',
    'application/pdf',
    128456,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now() - interval '22 days',
    now() - interval '22 days'
) on conflict (storage_path) do nothing;

-- Electrocardiograma (2026-06-15)
insert into public.documents (
    id, profile_id, title, category, specialty, institution,
    doctor_name, document_date, storage_path,
    mime_type, file_size_bytes, ai_summary, ai_confidence,
    created_by_profile_id,
    created_at, updated_at
) values (
    '770e8400-e29b-41d4-a716-446655440003'::uuid,
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Electrocardiograma',
    'imaging',
    'Cardiología',
    'Centro Cardiovascular Ushuaia',
    'Dr. Carlos Rodríguez',
    '2026-06-15'::date,
    '660e8400-e29b-41d4-a716-446655440003/2026/d2c8e9b3.pdf',
    'application/pdf',
    356789,
    'ECG dentro de los límites normales para la edad. No se detectan arritmias.',
    0.92,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now() - interval '58 days',
    now() - interval '58 days'
) on conflict (storage_path) do nothing;

-- Consulta — Notas médicas (2026-07-25)
insert into public.documents (
    id, profile_id, title, category, specialty, doctor_name,
    doctor_id, document_date, storage_path,
    mime_type, file_size_bytes,
    created_by_profile_id,
    created_at, updated_at
) values (
    '770e8400-e29b-41d4-a716-446655440004'::uuid,
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Consulta — Control de diabetes y presión',
    'consultation',
    'Medicina General',
    'Dr. Carlos Rodríguez',
    '990e8400-e29b-41d4-a716-446655440001'::uuid,
    '2026-08-05'::date,
    '660e8400-e29b-41d4-a716-446655440003/2026/d5b9a1c2.pdf',
    'application/pdf',
    67234,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now() - interval '7 days',
    now() - interval '7 days'
) on conflict (storage_path) do nothing;

-- Informe diversos (2026-05-10)
insert into public.documents (
    id, profile_id, title, category, specialty, institution,
    document_date, storage_path,
    mime_type, file_size_bytes,
    created_by_profile_id,
    created_at, updated_at
) values (
    '770e8400-e29b-41d4-a716-446655440005'::uuid,
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Informe administrativo — Antecedentes médicos',
    'other',
    null,
    'Centro de Salud Municipal',
    '2026-05-10'::date,
    '660e8400-e29b-41d4-a716-446655440003/2026/d7e3f8a4.pdf',
    'application/pdf',
    89456,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now() - interval '94 days',
    now() - interval '94 days'
) on conflict (storage_path) do nothing;


-- =============================================================================
-- 6. MÉTRICAS DE LABORATORIO (series temporales)
-- =============================================================================

-- Glucosa: 5 mediciones en diferentes fechas
insert into public.lab_metrics (
    profile_id, metric_name, metric_canonical, value, unit,
    reference_range, reference_min, reference_max, measurement_date,
    document_id, created_by_profile_id,
    created_at
) values
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Glucemia', 'glucosa', 145, 'mg/dL', '70-100', 70, 100, '2026-08-01'::date, '770e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '15 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Glucemia', 'glucosa', 138, 'mg/dL', '70-100', 70, 100, '2026-07-25'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '22 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Glucemia', 'glucosa', 142, 'mg/dL', '70-100', 70, 100, '2026-07-18'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '29 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Glucemia', 'glucosa', 135, 'mg/dL', '70-100', 70, 100, '2026-07-11'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '36 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Glucemia', 'glucosa', 148, 'mg/dL', '70-100', 70, 100, '2026-06-28'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '50 days')
on conflict do nothing;

-- Colesterol: 5 mediciones
insert into public.lab_metrics (
    profile_id, metric_name, metric_canonical, value, unit,
    reference_range, reference_min, reference_max, measurement_date,
    document_id, created_by_profile_id,
    created_at
) values
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Colesterol total', 'colesterol_total', 215, 'mg/dL', '<200', null, 200, '2026-08-01'::date, '770e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '15 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Colesterol total', 'colesterol_total', 208, 'mg/dL', '<200', null, 200, '2026-07-25'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '22 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Colesterol total', 'colesterol_total', 220, 'mg/dL', '<200', null, 200, '2026-07-11'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '36 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Colesterol total', 'colesterol_total', 205, 'mg/dL', '<200', null, 200, '2026-06-28'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '50 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Colesterol total', 'colesterol_total', 212, 'mg/dL', '<200', null, 200, '2026-06-15'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '58 days')
on conflict do nothing;

-- HDL (colesterol bueno): 5 mediciones
insert into public.lab_metrics (
    profile_id, metric_name, metric_canonical, value, unit,
    reference_range, reference_min, reference_max, measurement_date,
    document_id, created_by_profile_id,
    created_at
) values
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'HDL colesterol', 'hdl', 42, 'mg/dL', '>40', 40, null, '2026-08-01'::date, '770e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '15 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'HDL colesterol', 'hdl', 44, 'mg/dL', '>40', 40, null, '2026-07-25'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '22 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'HDL colesterol', 'hdl', 41, 'mg/dL', '>40', 40, null, '2026-07-11'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '36 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'HDL colesterol', 'hdl', 45, 'mg/dL', '>40', 40, null, '2026-06-28'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '50 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'HDL colesterol', 'hdl', 38, 'mg/dL', '>40', 40, null, '2026-06-15'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '58 days')
on conflict do nothing;

-- Hemoglobina: 5 mediciones
insert into public.lab_metrics (
    profile_id, metric_name, metric_canonical, value, unit,
    reference_range, reference_min, reference_max, measurement_date,
    document_id, created_by_profile_id,
    created_at
) values
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Hemoglobina', 'hemoglobina', 13.8, 'g/dL', '13.5-17.5', 13.5, 17.5, '2026-08-01'::date, '770e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '15 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Hemoglobina', 'hemoglobina', 13.9, 'g/dL', '13.5-17.5', 13.5, 17.5, '2026-07-25'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '22 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Hemoglobina', 'hemoglobina', 13.6, 'g/dL', '13.5-17.5', 13.5, 17.5, '2026-07-11'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '36 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Hemoglobina', 'hemoglobina', 14.1, 'g/dL', '13.5-17.5', 13.5, 17.5, '2026-06-28'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '50 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'Hemoglobina', 'hemoglobina', 13.7, 'g/dL', '13.5-17.5', 13.5, 17.5, '2026-06-15'::date, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '58 days')
on conflict do nothing;


-- =============================================================================
-- 7. TURNOS (appointments)
-- =============================================================================

-- Turno futuro 1: Cardiología (2 días desde ahora)
insert into public.appointments (
    profile_id, specialty, doctor_name, doctor_id,
    appointment_date, location_name, location_address, location_city, location_province,
    latitude, longitude, preparation_notes,
    status, created_by_profile_id,
    created_at, updated_at
) values (
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Cardiología',
    'Dr. Carlos Rodríguez',
    '990e8400-e29b-41d4-a716-446655440001'::uuid,
    (now() + interval '2 days')::timestamptz,
    'Clínica Ushuaia',
    'Gob. Paz 150',
    'Ushuaia',
    'Tierra del Fuego, Antártida e Islas del Atlántico Sur',
    -54.8083,
    -68.3000,
    'Llevar análisis recientes. Ayuno de 8 horas antes del ECG.',
    'pending',
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now(), now()
) on conflict (id) do nothing;

-- Turno futuro 2: Endocrinología (1 semana desde ahora)
insert into public.appointments (
    profile_id, specialty, doctor_name, doctor_id,
    appointment_date, location_name, location_address, location_city, location_province,
    latitude, longitude, preparation_notes,
    status, created_by_profile_id,
    created_at, updated_at
) values (
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Endocrinología',
    'Dra. Marcela Torres',
    '990e8400-e29b-41d4-a716-446655440002'::uuid,
    (now() + interval '7 days')::timestamptz,
    'Consultorio Torres',
    'Maipú 345',
    'Ushuaia',
    'Tierra del Fuego, Antártida e Islas del Atlántico Sur',
    -54.8078,
    -68.2999,
    'Traer registro de glucemias de la última semana.',
    'confirmed',
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now(), now()
) on conflict (id) do nothing;

-- Turno pasado: Consulta general (20 días atrás)
insert into public.appointments (
    profile_id, specialty, doctor_name, doctor_id,
    appointment_date, location_name, location_address, location_city, location_province,
    status, created_by_profile_id,
    created_at, updated_at
) values (
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Medicina General',
    'Dr. Carlos Rodríguez',
    '990e8400-e29b-41d4-a716-446655440001'::uuid,
    (now() - interval '20 days')::timestamptz,
    'Centro de Salud Municipal',
    'Avenida Maipú',
    'Ushuaia',
    'Tierra del Fuego, Antártida e Islas del Atlántico Sur',
    'completed',
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now() - interval '20 days',
    now() - interval '20 days'
) on conflict (id) do nothing;


-- =============================================================================
-- 8. MEDICACIONES (plan de medicación)
-- =============================================================================

-- Medicación 1: Metformina — diaria a horarios fijos
insert into public.medications (
    id, profile_id, name, active_ingredient, presentation,
    dose_amount, dose_unit, frequency, schedule_times,
    start_date, end_date, stock_units,
    prescription_document_id,
    notes, is_active,
    created_by_profile_id,
    created_at, updated_at
) values (
    '880e8400-e29b-41d4-a716-446655440001'::uuid,
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Glucophage',
    'Metformina',
    'Comprimidos 850 mg',
    1,
    'comprimido',
    'daily',
    '{08:00,20:00}'::time[],
    '2026-06-01'::date,
    null,
    120,
    '770e8400-e29b-41d4-a716-446655440002'::uuid,
    'Tomar con las comidas. No suspender sin consultar.',
    true,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now() - interval '60 days',
    now()
) on conflict (id) do nothing;

-- Medicación 2: Enalapril — cada 24 horas
insert into public.medications (
    id, profile_id, name, active_ingredient, presentation,
    dose_amount, dose_unit, frequency, interval_hours,
    start_date, end_date, stock_units,
    notes, is_active,
    created_by_profile_id,
    created_at, updated_at
) values (
    '880e8400-e29b-41d4-a716-446655440002'::uuid,
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Enalapril',
    'Enalapril',
    'Comprimidos 10 mg',
    1,
    'comprimido',
    'interval_hours',
    24,
    '2026-04-15'::date,
    null,
    90,
    'Tomar por la mañana. Reportar mareos o tos seca.',
    true,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now() - interval '120 days',
    now()
) on conflict (id) do nothing;


-- =============================================================================
-- 9. TOMAS DE MEDICACIÓN (medication_intakes)
-- =============================================================================

-- Algunas tomas registradas de Metformina (últimos 5 días)
insert into public.medication_intakes (
    medication_id, profile_id, scheduled_at, taken_at, status,
    dose_units, notes,
    created_by_profile_id,
    created_at, updated_at
) values
    ('880e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440003'::uuid, (now() - interval '5 days 08:00'), (now() - interval '5 days 08:05'), 'taken', 1, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '5 days', now() - interval '5 days'),
    ('880e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440003'::uuid, (now() - interval '5 days 20:00'), (now() - interval '5 days 20:02'), 'taken', 1, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '5 days', now() - interval '5 days'),
    ('880e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440003'::uuid, (now() - interval '4 days 08:00'), (now() - interval '4 days 08:10'), 'taken', 1, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '4 days', now() - interval '4 days'),
    ('880e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440003'::uuid, (now() - interval '4 days 20:00'), null, 'skipped', null, 'Olvidó tomar por la noche', '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '4 days', now() - interval '4 days'),
    ('880e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440003'::uuid, (now() - interval '3 days 08:00'), (now() - interval '3 days 08:15'), 'taken', 1, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '3 days', now() - interval '3 days'),
    ('880e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440003'::uuid, (now() - interval '3 days 20:00'), (now() - interval '3 days 20:08'), 'taken', 1, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '3 days', now() - interval '3 days'),
    ('880e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440003'::uuid, (now() - interval '2 days 08:00'), null, 'pending', null, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '2 days', now() - interval '2 days'),
    ('880e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440003'::uuid, (now() - interval '2 days 20:00'), (now() - interval '2 days 20:12'), 'taken', 1, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '2 days', now() - interval '2 days'),
    ('880e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440003'::uuid, (now() - interval '1 day 08:00'), (now() - interval '1 day 08:20'), 'taken', 1, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '1 day', now() - interval '1 day'),
    ('880e8400-e29b-41d4-a716-446655440001'::uuid, '660e8400-e29b-41d4-a716-446655440003'::uuid, (now() - interval '1 day 20:00'), null, 'pending', null, null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '1 day', now() - interval '1 day')
on conflict do nothing;


-- =============================================================================
-- 10. SIGNOS VITALES (vital_signs)
-- =============================================================================

-- Presiones (blood_pressure) — 6 mediciones con una presión alta
insert into public.vital_signs (
    profile_id, type, systolic, diastolic, pulse, measured_at,
    notes, created_by_profile_id,
    created_at, updated_at
) values
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'blood_pressure', 138, 82, 76, (now() - interval '5 days 08:30'), null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '5 days', now() - interval '5 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'blood_pressure', 142, 85, 79, (now() - interval '4 days 08:15'), null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '4 days', now() - interval '4 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'blood_pressure', 165, 102, 88, (now() - interval '3 days 08:00'), 'Presión elevada. Reportado a médico.', '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '3 days', now() - interval '3 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'blood_pressure', 135, 80, 72, (now() - interval '2 days 08:45'), null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '2 days', now() - interval '2 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'blood_pressure', 140, 83, 74, (now() - interval '1 day 08:30'), null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '1 day', now() - interval '1 day'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'blood_pressure', 139, 81, 75, (now() - interval '2 hours'), null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '2 hours', now() - interval '2 hours')
on conflict do nothing;

-- Glucemia (glucose) — 2 mediciones
insert into public.vital_signs (
    profile_id, type, value, unit, measured_at,
    notes, created_by_profile_id,
    created_at, updated_at
) values
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'glucose', 148, 'mg/dL', (now() - interval '3 days 07:30'), 'En ayunas', '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '3 days', now() - interval '3 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'glucose', 156, 'mg/dL', (now() - interval '1 day 07:15'), 'En ayunas', '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '1 day', now() - interval '1 day')
on conflict do nothing;

-- Peso (weight) — 2 mediciones
insert into public.vital_signs (
    profile_id, type, value, unit, measured_at,
    notes, created_by_profile_id,
    created_at, updated_at
) values
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'weight', 78.5, 'kg', (now() - interval '7 days 09:00'), null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '7 days', now() - interval '7 days'),
    ('660e8400-e29b-41d4-a716-446655440003'::uuid, 'weight', 79.2, 'kg', (now() - interval '1 day 09:15'), null, '660e8400-e29b-41d4-a716-446655440001'::uuid, now() - interval '1 day', now() - interval '1 day')
on conflict do nothing;

-- Alertas de umbral (vital_sign_alerts, Sprint 9.2) de la presión 165/102 de
-- hace tres días. En la aplicación real las escribe
-- `lib/signos/registrar-alertas.ts` justo después de la carga; acá van a mano
-- porque el seed inserta las mediciones directamente en la base, sin pasar por
-- `registrarSigno`. Sin ellas el seed sería incoherente —una medición fuera de
-- umbral sin su alerta— y la 9.3 no tendría contra qué desarrollar el banner.
--
-- El texto es EXACTAMENTE el que produce `lib/signos/evaluar.ts` para esos
-- valores con los umbrales por defecto (160/100): si se cambia la redacción
-- allá, hay que cambiarla acá. El descargo no es opcional — lo exige el CHECK
-- `vital_sign_alerts_mensaje_con_descargo`.
--
-- Quedan sin marcar como vistas (`acknowledged_at` NULL) a propósito: así el
-- banner persistente aparece apenas se levanta el entorno.
insert into public.vital_sign_alerts (
    vital_sign_id, profile_id, tipo, regla, valor, umbral, referencia, mensaje, created_at
)
select v.id, v.profile_id, 'blood_pressure', datos.regla,
       datos.valor, datos.umbral, null, datos.mensaje, v.measured_at
  from public.vital_signs v
 cross join (values
        ('sistolica_alta'::public.vital_sign_alert_rule, 165, 160,
         'Presión sistólica alta: 165 mmHg (umbral de alerta: 160). Valor orientativo — no reemplaza el criterio médico.'),
        ('diastolica_alta'::public.vital_sign_alert_rule, 102, 100,
         'Presión diastólica alta: 102 mmHg (umbral de alerta: 100). Valor orientativo — no reemplaza el criterio médico.')
     ) as datos(regla, valor, umbral, mensaje)
 where v.profile_id = '660e8400-e29b-41d4-a716-446655440003'::uuid
   and v.type       = 'blood_pressure'
   and v.systolic   = 165
   and v.diastolic  = 102
on conflict do nothing;


-- =============================================================================
-- 11. COBERTURA DE SALUD (insurance_cards)
-- =============================================================================

-- PAMI — cobertura principal
insert into public.insurance_cards (
    id, profile_id, provider, member_number, plan,
    is_primary, valid_until,
    front_storage_path, back_storage_path,
    notes, created_by_profile_id,
    created_at, updated_at
) values (
    'aa0e8400-e29b-41d4-a716-446655440001'::uuid,
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'PAMI — Pensionados',
    '2890154780',
    'Cobertura integral',
    true,
    '2027-12-31'::date,
    '660e8400-e29b-41d4-a716-446655440003/2026/pami-front.jpg',
    '660e8400-e29b-41d4-a716-446655440003/2026/pami-back.jpg',
    'Cobertura principal. Farmacia: red de más de 1000 farmacias.',
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now() - interval '180 days',
    now() - interval '180 days'
) on conflict (profile_id, provider, member_number) do nothing;


-- =============================================================================
-- 12. SUSCRIPCIONES WEB PUSH (push_subscriptions)
-- =============================================================================

-- Suscripción de María (necesaria para notificaciones)
insert into public.push_subscriptions (
    id, profile_id, user_id, endpoint, p256dh, auth,
    user_agent, created_at, last_seen_at
) values (
    'bb0e8400-e29b-41d4-a716-446655440001'::uuid,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    '550e8400-e29b-41d4-a716-446655440001'::uuid,
    'https://fcm.googleapis.com/fcm/send/ficticio-seed-token',
    'clave-p256dh-base64url',
    'secreto-auth-base64url',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    now() - interval '30 days',
    now() - interval '1 hour'
) on conflict (endpoint) do nothing;


-- =============================================================================
-- 13. CATÁLOGO DE CENTROS DE SALUD (health_centers) — Sprint 16, tarea 16.3
-- -----------------------------------------------------------------------------
-- 24 establecimientos REALES del Registro Federal (REFES), copiados tal cual de
-- la edición de diciembre de 2025 del CSV del Ministerio de Salud
-- (datos.salud.gob.ar, licencia CC-BY-4.0): mismos ids, mismos nombres en
-- mayúsculas, mismos domicilios sin normalizar y mismas coordenadas.
--
-- ── POR QUÉ HAY SEED SI EL CATÁLOGO SE DESCARGA SOLO
--
-- Porque `npx supabase db reset` tiene que dejar una base USABLE sin internet.
-- Sin estas filas, después de cada reset habría que apretar "Actualizar" y
-- esperar la descarga de 9 MB del portal del Ministerio para poder probar
-- /lugares o el autocompletar de "Lugar" de un turno — y las pruebas quedarían
-- atadas a que un servidor público esté arriba.
--
-- ── POR QUÉ ESTOS 24 Y NO 24 INVENTADOS
--
-- Son los que la familia del usuario usa de verdad (Clínica San Jorge de
-- Ushuaia y sus anexos, Hospital Regional de Ushuaia, TCba Salguero, Instituto
-- Médico Platense, Hospital Británico) más una muestra elegida para cubrir los
-- casos que el código tiene que saber manejar:
--
--   · las cinco categorías de tipología que /lugares muestra por defecto
--     (10/13/14 con internación, 50 consultorios, 51 laboratorios,
--     52 tratamiento) y una "residencia" (17), que el filtro por defecto NO
--     muestra: sirve para verificar que el filtro filtra de verdad;
--   · centros CON coordenadas -precarga del turno sin geocodificar- y SIN
--     coordenadas -"Pedir viaje" no aparece y "Cómo llegar" cae en la
--     búsqueda por dirección-;
--   · centros con y sin sitio web (el REFES lo publica sin esquema:
--     "www.tcba.com.ar", ver lib/lugares/formato.ts#urlSitioWeb);
--   · las formas de provincia que hay que normalizar: "CABA" → "Ciudad
--     Autónoma de Buenos Aires", "TIERRA DEL FUEGO" → el nombre completo, y
--     las que ya coinciden ("SANTA FE", "MENDOZA");
--   · nombres con puntos y siglas ("O.S.E.C.A.C. - BIOQUIMICA - CAPITAL.-") y
--     cinco homónimos parciales de "SAN JORGE" en tres provincias, que es lo
--     que hace realista probar la búsqueda.
--
-- `search_text` y `locality_search` se escriben ya normalizados, con el mismo
-- criterio de lib/lugares/normalizar.ts (minúsculas, sin tildes, ñ conservada):
-- son columnas derivadas y la sincronización real las recalcula igual.
--
-- Una sincronización real REEMPLAZA estas filas (upsert por refes_id) y da de
-- baja las que la edición vigente ya no traiga: el seed no es una fuente
-- paralela de verdad, es un punto de partida.
-- =============================================================================

insert into public.health_centers (
    refes_id, name, typology_id, typology_code, typology_name, funding_origin,
    province_refes, province, department_name, locality_name, postal_code, address, website,
    latitude, longitude, search_text, locality_search
) values
    ('10940142395005', 'CLINICA SAN JORGE', 10, 'ESCIG', 'Alto riesgo con terapia intensiva', 'Privado',
     'TIERRA DEL FUEGO', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur', 'USHUAIA', 'USHUAIA', '9410', 'ONACHAGA 184', 'www.sanatoriosanjorge.com.ar',
     -54.815326, -68.326034, 'clinica san jorge ushuaia ushuaia tierra del fuego', 'ushuaia'),
    ('50940142395650', 'CENTRO MEDICO CLINICA SAN JORGE', 50, 'ESSIDT', 'Con atención médica diaria y con especialidades y/o otras profesiones', 'Privado',
     'TIERRA DEL FUEGO', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur', 'USHUAIA', 'USHUAIA', '9410', 'DE LA ESTANCIA Nº 1955', null,
     -54.815323, -68.325766, 'centro medico clinica san jorge ushuaia ushuaia tierra del fuego', 'ushuaia'),
    ('50940142395377', 'CONSULTORIOS EXTERNOS ANEXOS SANATORIO SAN JORGE', 50, 'ESSIDT', 'Con atención médica diaria y con especialidades y/o otras profesiones', 'Privado',
     'TIERRA DEL FUEGO', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur', 'USHUAIA', 'USHUAIA', '9410', 'Jainen N° 133', null,
     -54.815516, -68.324803, 'consultorios externos anexos sanatorio san jorge ushuaia ushuaia tierra del fuego', 'ushuaia'),
    ('50940142395026', 'CENTRO DE PEDIATRIA SANATORIO SAN JORGE', 50, 'ESSIDT', 'Con atención médica diaria y con especialidades y/o otras profesiones', 'Privado',
     'TIERRA DEL FUEGO', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur', 'USHUAIA', 'USHUAIA', '9410', 'ONACHANGA 136', null,
     -54.815187, -68.32512, 'centro de pediatria sanatorio san jorge ushuaia ushuaia tierra del fuego', 'ushuaia'),
    ('10940142195003', 'HOSPITAL REGIONAL USHUAIA GOBERNADOR ERNESTO M. CAMPOS', 10, 'ESCIG', 'Alto riesgo con terapia intensiva', 'Provincial',
     'TIERRA DEL FUEGO', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur', 'USHUAIA', 'USHUAIA', '9410', '12 de Octubre 65', null,
     -54.813728, -68.320214, 'hospital regional ushuaia gobernador ernesto m. campos ushuaia ushuaia tierra del fuego', 'ushuaia'),
    ('10940142495001', 'HOSPITAL NAVAL USHUAIA.', 10, 'ESCIG', 'Mediano riesgo con internación con cuidados especiales', 'FFAA/Seguridad',
     'TIERRA DEL FUEGO', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur', 'USHUAIA', 'USHUAIA', '9410', 'YAGANES Nº 299', null,
     -54.80281, -68.299309, 'hospital naval ushuaia. ushuaia ushuaia tierra del fuego', 'ushuaia'),
    ('52940142395384', 'CENTRO DE NEFROLOGIA Y HEMODIALISIS USHUAIA (CENHEUS)', 52, 'ESSIT', 'Centro de Diálisis', 'Privado',
     'TIERRA DEL FUEGO', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur', 'USHUAIA', 'USHUAIA', '9410', 'KUANIP N° 49', null,
     -54.82901, -68.347605, 'centro de nefrologia y hemodialisis ushuaia (cenheus) ushuaia ushuaia tierra del fuego', 'ushuaia'),
    ('10940072195002', 'HOSPITAL REGIONAL NUESTRA SEÑORA DE LA CANDELARIA.', 10, 'ESCIG', 'Alto riesgo con terapia intensiva', 'Provincial',
     'TIERRA DEL FUEGO', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur', 'RÍO GRANDE', 'RIO GRANDE', '9420', 'FLORENTINO AMEGHINO 709', null,
     -53.782896, -67.697358, 'hospital regional nuestra señora de la candelaria. rio grande rio grande tierra del fuego', 'rio grande'),
    ('50020012318151', 'CENTRO MEDICO  TCBA SALGUERO CENTRO DE DIAGNOSTICO', 50, 'ESSIDT', 'Con atención médica diaria y con especialidades y/o otras profesiones', 'Privado',
     'CABA', 'Ciudad Autónoma de Buenos Aires', 'COMUNA 5', 'ALMAGRO', '1177', 'Jerónimo Salguero 554', 'www.tcba.com.ar',
     -34.604114, -58.419633, 'centro medico tcba salguero centro de diagnostico almagro comuna 5 caba', 'almagro'),
    ('10020012315207', 'HOSPITAL BRITANICO DE BUENOS AIRES', 10, 'ESCIG', 'Alto riesgo con terapia intensiva', 'Privado',
     'CABA', 'Ciudad Autónoma de Buenos Aires', 'COMUNA 4', 'BARRACAS', '1275', 'Perdriel 74', 'www.hospitalbritanico.org.ar',
     -34.634408, -58.388236, 'hospital britanico de buenos aires barracas comuna 4 caba', 'barracas'),
    ('50020042319733', 'CONSULTORIOS EXTERNOS HOSPITAL BRITANICO', 50, 'ESSIDT', 'Con atención médica diaria y con especialidades y/o otras profesiones', 'Privado',
     'CABA', 'Ciudad Autónoma de Buenos Aires', 'COMUNA 4', 'PARQUE PATRICIOS', '1134', 'Solis 2171', null,
     -34.63323, -58.38905, 'consultorios externos hospital britanico parque patricios comuna 4 caba', 'parque patricios'),
    ('10020012315256', 'HOSPITAL ITALIANO DE BUENOS AIRES', 10, 'ESCIG', 'Alto riesgo con terapia intensiva especializada', 'Privado',
     'CABA', 'Ciudad Autónoma de Buenos Aires', 'COMUNA 5', 'BOEDO', '1199', 'Gascón 450', 'www.hospitalitaliano.org.ar',
     -34.606654, -58.424782, 'hospital italiano de buenos aires boedo comuna 5 caba', 'boedo'),
    ('10020012315204', 'HOSPITAL ALEMAN', 10, 'ESCIG', 'Alto riesgo con terapia intensiva', 'Privado',
     'CABA', 'Ciudad Autónoma de Buenos Aires', 'COMUNA 2', 'RECOLETA', '1118', 'Avenida Pueyrredón 1650', 'www.hospitalaleman.com.ar',
     -34.592258, -58.401241, 'hospital aleman recoleta comuna 2 caba', 'recoleta'),
    ('10020012315173', 'CEMIC - HOSPITAL UNIVERSITARIO SEDE SAAVEDRA', 10, 'ESCIG', 'Alto riesgo con terapia intensiva', 'Privado',
     'CABA', 'Ciudad Autónoma de Buenos Aires', 'COMUNA 12', 'COGHLAN', '1431', 'Galván 4102', 'www.cemic.edu.ar',
     -34.556857, -58.495186, 'cemic - hospital universitario sede saavedra coghlan comuna 12 caba', 'coghlan'),
    ('14020012315319', 'FLENI - SEDE BELGRANO', 14, 'ESCIE', 'Alto riesgo con terapia intensiva especializada', 'Privado',
     'CABA', 'Ciudad Autónoma de Buenos Aires', 'COMUNA 13', 'BELGRANO', '1428', 'Montañeses 2325', 'www.fleni.org.ar/web/fleni_sedebelgrano.php',
     -34.555381, -58.450656, 'fleni - sede belgrano belgrano comuna 13 caba', 'belgrano'),
    ('10020012515209', 'HOSPITAL DE CLINICAS JOSE DE SAN MARTIN', 10, 'ESCIG', 'Alto riesgo con terapia intensiva', 'Universitario público',
     'CABA', 'Ciudad Autónoma de Buenos Aires', 'COMUNA 2', 'RECOLETA', '1120', 'AV. CÓRDOBA 2351', 'www.hospitaldeclinicas.uba.ar',
     -34.599408, -58.400341, 'hospital de clinicas jose de san martin recoleta comuna 2 caba', 'recoleta'),
    ('14020012315317', 'INSTITUTO DE CARDIOLOGIA Y CIRUGIA CARDIOVASCULAR - FUNDACION FAVALORO (EDIFICIO CENTRAL)', 14, 'ESCIE', 'Alto riesgo con terapia intensiva especializada', 'Privado',
     'CABA', 'Ciudad Autónoma de Buenos Aires', 'COMUNA 1', 'MONSERRAT', 'C1093AAS', 'Av. Belgrano 1746', 'www.fundacionfavaloro.org',
     -34.61382, -58.391089, 'instituto de cardiologia y cirugia cardiovascular - fundacion favaloro (edificio central) monserrat comuna 1 caba', 'monserrat'),
    ('10064412300422', 'INSTITUTO MEDICO PLATENSE SA', 10, 'ESCIG', 'Alto riesgo con terapia intensiva', 'Privado',
     'BUENOS AIRES', 'Buenos Aires', 'LA PLATA', 'LA PLATA', '1900', 'Calle 51 Nº 315', null,
     -34.911133, -57.944427, 'instituto medico platense sa la plata la plata buenos aires', 'la plata'),
    ('14064412300637', 'CENTRO GASTROENTEROLOGICO PLATENSE', 14, 'ESCIE', 'Bajo riesgo con internación simple', 'Privado',
     'BUENOS AIRES', 'Buenos Aires', 'LA PLATA', 'LA PLATA', '1900', 'CALLE 3 1096', null,
     -34.913408, -57.942394, 'centro gastroenterologico platense la plata la plata buenos aires', 'la plata'),
    ('13064412319051', 'CLINICA SAN JORGE NEUROPSIQUIATRICA S.A.', 13, 'ESCIESM', 'Bajo riesgo con internación simple', 'Privado',
     'BUENOS AIRES', 'Buenos Aires', 'LA PLATA', 'LA PLATA', '1900', 'Avenida 7 124', null,
     -34.902593, -57.965862, 'clinica san jorge neuropsiquiatrica s.a. la plata la plata buenos aires', 'la plata'),
    ('10820842384220', 'SANATORIO BRITANICO', 10, 'ESCIG', 'Alto riesgo con terapia intensiva especializada', 'Privado',
     'SANTA FE', 'Santa Fe', 'ROSARIO', 'ROSARIO', '2000', 'PARAGUAY 40', null,
     -32.936865, -60.641824, 'sanatorio britanico rosario rosario santa fe', 'rosario'),
    ('51500072758974', 'O.S.E.C.A.C. - BIOQUIMICA - CAPITAL.-', 51, 'ESSID', 'Laboratorio de Análisis Clínicos', 'Privado',
     'MENDOZA', 'Mendoza', 'CAPITAL', '3A. SECCION', '5500', 'RIOJA 267', 'www.osecac.org.ar',
     -32.901229, -68.837618, 'o.s.e.c.a.c. - bioquimica - capital.- 3a. seccion capital mendoza', '3a. seccion'),
    ('51140142335474', 'LABORATORIO LABSIB SALUD INTEGRAL BIOQUIMICA', 51, 'ESSID', 'Laboratorio de Análisis Clínicos', 'Privado',
     'CÓRDOBA', 'Córdoba', 'CAPITAL', 'CORDOBA', '5000', 'Obispo Salguero 732 Subsuelo A Barrio Nueva Cordoba', null,
     null, null, 'laboratorio labsib salud integral bioquimica cordoba capital cordoba', 'cordoba'),
    ('15300842343638', 'GERIATRICO SAN JORGE II', 17, 'ESCIRES', 'Vivienda para personas mayores', 'Privado',
     'ENTRE RÍOS', 'Entre Ríos', 'PARANÁ', 'PARANA', '3100', 'PRESIDENTE PERON 670', null,
     null, null, 'geriatrico san jorge ii parana parana entre rios', 'parana')
on conflict (refes_id) do nothing;


-- =============================================================================
-- Fin del seed
-- =============================================================================
