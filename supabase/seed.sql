-- =============================================================================
-- Historial Médico — Seed de datos de prueba
-- =============================================================================
-- Contenido:
--   - 2 usuarios en auth.users (María y Diego)
--   - 3 perfiles: María (con cuenta), Diego (con cuenta), Roberto (gestionado)
--   - Familia del modelo de permisos: María administra a Roberto, Diego solo ve
--   - Datos de Roberto: 5 documentos, 20 métricas de lab, 3 turnos, 2 medicaciones,
--     algunas tomas registradas, 10 signos vitales, 2 médicos, 1 cobertura, 1 suscripción push
--
-- Convenciones:
--   - Identificadores en inglés, documentación en español, UTF-8 sin BOM
--   - Storage paths: {profile_id}/{año}/{uuid}.ext
--   - Credenciales de prueba: password123
--   - Todas las fechas en 2025-2026 para contexto realista
--   - Datos de Roberto: completos para la ficha SOS (grupo sanguíneo, alergias,
--     condiciones crónicas, contacto de emergencia)
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
insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
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
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
) on conflict (id) do nothing;

-- Diego Gómez (familiar, solo visualización de Roberto)
insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
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
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
) on conflict (id) do nothing;


-- =============================================================================
-- 2. PERFILES
-- =============================================================================

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
insert into public.profiles (
    id, user_id, full_name, date_of_birth, role,
    blood_type, allergies, chronic_conditions,
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
    now(),
    now()
) on conflict (id) do nothing;

-- Roberto Gómez (GESTIONADO, sin cuenta, creado por María)
-- Datos SOS completos para pruebas offline
insert into public.profiles (
    id, user_id, full_name, date_of_birth, role,
    created_by_profile_id,
    blood_type, allergies, chronic_conditions,
    critical_medication, emergency_contact, emergency_contact_phone,
    emergency_contact_relationship, sos_notes,
    created_at, updated_at
) values (
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    null,
    'Roberto Gómez',
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

-- Cardiólogo
insert into public.doctors (
    id, profile_id, full_name, specialty, license_number,
    institution, phone, address,
    latitude, longitude, is_active,
    created_by_profile_id,
    created_at, updated_at
) values (
    '990e8400-e29b-41d4-a716-446655440001'::uuid,
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Dr. Carlos Rodríguez',
    'Cardiología',
    'MN 45678',
    'Clínica Ushuaia',
    '+54 2901 234000',
    'Gob. Paz 150, Ushuaia',
    -54.8083,
    -68.3000,
    true,
    '660e8400-e29b-41d4-a716-446655440001'::uuid,
    now(), now()
) on conflict (id) do nothing;

-- Endocrinólogo
insert into public.doctors (
    id, profile_id, full_name, specialty, license_number,
    institution, phone, address,
    latitude, longitude, is_active,
    created_by_profile_id,
    created_at, updated_at
) values (
    '990e8400-e29b-41d4-a716-446655440002'::uuid,
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Dra. Marcela Torres',
    'Endocrinología',
    'MN 56789',
    'Consultorio Torres',
    '+54 2901 234111',
    'Maipú 345, Ushuaia',
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
    appointment_date, location_name, location_address,
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
    'Gob. Paz 150, Ushuaia',
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
    appointment_date, location_name, location_address,
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
    'Maipú 345, Ushuaia',
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
    appointment_date, location_name, location_address,
    status, created_by_profile_id,
    created_at, updated_at
) values (
    '660e8400-e29b-41d4-a716-446655440003'::uuid,
    'Medicina General',
    'Dr. Carlos Rodríguez',
    '990e8400-e29b-41d4-a716-446655440001'::uuid,
    (now() - interval '20 days')::timestamptz,
    'Centro de Salud Municipal',
    'Avenida Maipú, Ushuaia',
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
-- Fin del seed
-- =============================================================================
