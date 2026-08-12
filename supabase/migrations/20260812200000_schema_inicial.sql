-- =============================================================================
-- MiHistorialMédico — Migración 20260812200000: esquema inicial del dominio
-- -----------------------------------------------------------------------------
-- Contenido: extensiones, enums, funciones de trigger, 12 tablas de dominio,
--            comentarios de documentación e índices de acceso.
--
-- Alcance deliberado de esta migración:
--   * NO habilita Row Level Security ni crea políticas: eso vive en la
--     migración 0002_rls.sql (tarea siguiente del Sprint 1). Hasta que esa
--     migración se aplique, las tablas quedan accesibles para los roles
--     `anon` / `authenticated` por los privilegios por defecto de Supabase.
--   * NO crea buckets de Storage ni sus políticas (migración 0003_storage.sql).
--   * NO crea vistas de cálculo (por ejemplo `v_medicacion_estado`) ni jobs de
--     pg_cron: se agregan en los sprints que los necesitan.
--
-- Convenciones fijadas para todo el proyecto:
--   * Claves primarias: `uuid PRIMARY KEY DEFAULT gen_random_uuid()` (pgcrypto).
--     Prohibido el generador legacy de la extensión uuid-ossp.
--   * Fechas con hora: `timestamptz`. Fechas puras (día calendario): `date`.
--   * Dominios cerrados: enums nativos de Postgres.
--   * Archivos: se guarda SIEMPRE el path del objeto de Storage
--     (`storage_path`), NUNCA una URL pública. El acceso se hace por signed URL
--     de vida corta generada del lado del servidor.
--   * Identificadores de objetos en inglés; documentación y comentarios en
--     español (UTF-8 sin BOM).
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONES
-- =============================================================================

-- pgcrypto provee gen_random_uuid(). En Supabase ya viene instalada en el
-- esquema `extensions`; el IF NOT EXISTS la deja idempotente. En PostgreSQL 13+
-- la función además existe en el core, por lo que siempre resuelve sin prefijo.
create extension if not exists "pgcrypto" with schema extensions;


-- =============================================================================
-- 2. ENUMS (dominios cerrados)
-- =============================================================================

-- Rol funcional del perfil dentro del grupo familiar.
create type public.user_role as enum (
    'admin',
    'elder',
    'family_member',
    'caregiver'
);

-- Categoría del documento médico cargado.
create type public.doc_category as enum (
    'laboratory',
    'imaging',
    'prescription',
    'consultation',
    'other'
);

-- Estado del turno médico.
create type public.appointment_status as enum (
    'pending',
    'confirmed',
    'completed',
    'cancelled'
);

-- Tipo de signo vital registrado.
create type public.vital_sign_type as enum (
    'blood_pressure',
    'glucose',
    'weight'
);

-- Lado de la credencial de cobertura (frente / dorso).
create type public.insurance_card_side as enum (
    'front',
    'back'
);

-- Modo de administración de una medicación.
--   daily          -> horarios fijos del día (columna schedule_times)
--   interval_hours -> cada N horas (columna interval_hours)
--   as_needed      -> a demanda, sin horario programado
create type public.medication_frequency as enum (
    'daily',
    'interval_hours',
    'as_needed'
);

-- Estado de una toma de medicación programada.
create type public.medication_intake_status as enum (
    'pending',
    'taken',
    'skipped',
    'missed'
);

-- Acción auditada sobre datos de salud. Los literales están en español porque
-- son los que fija el ROADMAP para `access_logs` y los consume la vista de
-- accesos del titular (Sprint 2).
create type public.access_action as enum (
    'login',
    'logout',
    'ver_perfil',
    'ver_documento',
    'descargar_archivo',
    'ver_credencial',
    'exportar_ficha',
    'otorgar_permiso',
    'revocar_permiso'
);


-- =============================================================================
-- 3. FUNCIONES DE TRIGGER
-- =============================================================================

-- Mantiene `updated_at` en cada UPDATE. `search_path` vacío para cumplir el
-- lint de Supabase (function_search_path_mutable).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

comment on function public.set_updated_at() is
    'Trigger BEFORE UPDATE: refresca la columna updated_at con now().';

-- Marca cuándo se modificaron por última vez los datos vitales de emergencia.
-- Lo necesita la ficha SOS offline para mostrar "Datos actualizados el ...".
create or replace function public.set_sos_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        if new.blood_type is not null
            or coalesce(array_length(new.allergies, 1), 0) > 0
            or coalesce(array_length(new.chronic_conditions, 1), 0) > 0
            or coalesce(array_length(new.critical_medication, 1), 0) > 0
            or new.emergency_contact is not null
            or new.emergency_contact_phone is not null
            or new.emergency_contact_relationship is not null
            or new.sos_notes is not null
        then
            new.sos_updated_at := now();
        end if;
        return new;
    end if;

    if new.blood_type is distinct from old.blood_type
        or new.allergies is distinct from old.allergies
        or new.chronic_conditions is distinct from old.chronic_conditions
        or new.critical_medication is distinct from old.critical_medication
        or new.emergency_contact is distinct from old.emergency_contact
        or new.emergency_contact_phone is distinct from old.emergency_contact_phone
        or new.emergency_contact_relationship is distinct from old.emergency_contact_relationship
        or new.sos_notes is distinct from old.sos_notes
    then
        new.sos_updated_at := now();
    end if;

    return new;
end;
$$;

comment on function public.set_sos_updated_at() is
    'Trigger sobre profiles: actualiza sos_updated_at solo cuando cambia algún dato de la ficha SOS.';


-- =============================================================================
-- 4. TABLAS DE DOMINIO
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4.1 profiles — persona cuyo historial se gestiona
-- -----------------------------------------------------------------------------
create table public.profiles (
    id                              uuid primary key default gen_random_uuid(),
    user_id                         uuid references auth.users (id) on delete cascade,
    full_name                       text not null,
    date_of_birth                   date,
    role                            public.user_role not null default 'family_member',
    national_id                     text,
    phone                           text,
    avatar_storage_path             text,

    -- Datos vitales para la ficha SOS (se leen offline).
    blood_type                      text,
    allergies                       text[] not null default '{}'::text[],
    chronic_conditions              text[] not null default '{}'::text[],
    critical_medication             text[] not null default '{}'::text[],
    emergency_contact               text,
    emergency_contact_phone         text,
    emergency_contact_relationship  text,
    sos_notes                       text,
    sos_updated_at                  timestamptz,

    created_at                      timestamptz not null default now(),
    updated_at                      timestamptz not null default now(),

    constraint profiles_user_id_unico
        unique (user_id),
    constraint profiles_full_name_no_vacio
        check (char_length(btrim(full_name)) > 0),
    constraint profiles_blood_type_valido
        check (blood_type is null
               or blood_type in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    constraint profiles_avatar_no_es_url
        check (avatar_storage_path is null
               or lower(avatar_storage_path) not like 'http%')
);

comment on table public.profiles is
    'Persona cuyo historial médico se gestiona. Puede tener cuenta propia en Supabase Auth o ser un perfil gestionado por un familiar.';
comment on column public.profiles.user_id is
    'NULLABLE A PROPÓSITO. Si apunta a auth.users, el perfil tiene cuenta propia. Si es NULL, es un perfil GESTIONADO: un adulto mayor sin cuenta cuyo historial administra un familiar a través de family_permissions. Nunca completar con un uuid inventado para "evitar el NULL": el NULL es la señal de perfil gestionado y de él dependen las políticas RLS.';
comment on column public.profiles.role is
    'Rol funcional dentro del grupo familiar (admin, elder, family_member, caregiver). No es un rol de base de datos ni reemplaza a family_permissions.';
comment on column public.profiles.national_id is
    'DNI o documento equivalente. Dato identificatorio: se excluye del contexto que se envía a la IA (minimización, Ley 25.326).';
comment on column public.profiles.phone is
    'Teléfono de la persona titular del perfil. Dato identificatorio: excluido del contexto enviado a la IA.';
comment on column public.profiles.avatar_storage_path is
    'Path del avatar dentro del bucket privado correspondiente. Nunca una URL: la imagen se sirve por signed URL.';
comment on column public.profiles.blood_type is
    'Grupo y factor sanguíneo, validado contra los 8 valores posibles (A+, A-, B+, B-, AB+, AB-, O+, O-).';
comment on column public.profiles.allergies is
    'Alergias declaradas. Arreglo de texto con default {} para que la ficha SOS nunca tenga que manejar NULL.';
comment on column public.profiles.chronic_conditions is
    'Enfermedades crónicas declaradas. Arreglo de texto con default {}.';
comment on column public.profiles.critical_medication is
    'Medicación crítica en texto libre para la ficha SOS. Es una copia legible offline; la fuente de verdad operativa es la tabla medications.';
comment on column public.profiles.emergency_contact is
    'Nombre del contacto de emergencia.';
comment on column public.profiles.emergency_contact_phone is
    'Teléfono del contacto de emergencia (se usa en el enlace tel: de la ficha SOS).';
comment on column public.profiles.emergency_contact_relationship is
    'Vínculo del contacto de emergencia con la persona (hija, esposo, vecina, etc.).';
comment on column public.profiles.sos_notes is
    'Observaciones libres para personal de emergencia (marcapasos, prótesis, idioma, etc.).';
comment on column public.profiles.sos_updated_at is
    'Última modificación de cualquier dato de la ficha SOS. Lo mantiene el trigger set_sos_updated_at y lo muestra el indicador de "datos actualizados el ..." cuando la app está offline.';

-- No se agrega índice sobre user_id: la constraint profiles_user_id_unico ya
-- crea el índice único que usan las políticas RLS y el selector de perfiles.

create trigger profiles_set_updated_at
    before update on public.profiles
    for each row execute function public.set_updated_at();

create trigger profiles_set_sos_updated_at
    before insert or update on public.profiles
    for each row execute function public.set_sos_updated_at();


-- -----------------------------------------------------------------------------
-- 4.2 family_permissions — acceso delegado entre perfiles
-- -----------------------------------------------------------------------------
create table public.family_permissions (
    id                  uuid primary key default gen_random_uuid(),
    owner_profile_id    uuid not null references public.profiles (id) on delete cascade,
    granted_profile_id  uuid not null references public.profiles (id) on delete cascade,
    can_view            boolean not null default true,
    can_upload          boolean not null default false,
    can_manage          boolean not null default false,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint family_permissions_par_unico
        unique (owner_profile_id, granted_profile_id),
    constraint family_permissions_sin_autoreferencia
        check (owner_profile_id <> granted_profile_id)
);

comment on table public.family_permissions is
    'Eje del modelo de acceso: qué perfil (granted_profile_id) puede operar sobre el historial de qué otro perfil (owner_profile_id). Todas las políticas RLS derivan de esta tabla. Revocar un permiso es borrar la fila; el rastro queda en access_logs.';
comment on column public.family_permissions.owner_profile_id is
    'Perfil dueño de los datos (la persona cuyo historial se comparte).';
comment on column public.family_permissions.granted_profile_id is
    'Perfil al que se le otorga el acceso. Debe tener cuenta propia (profiles.user_id no nulo) para poder autenticarse.';
comment on column public.family_permissions.can_view is
    'Permite leer historial, documentos, turnos, medicación y signos vitales del dueño. Default true: es el mínimo con el que se otorga un acceso (minimización, Ley 25.326).';
comment on column public.family_permissions.can_upload is
    'Permite crear documentos, turnos, medicación y mediciones sobre el perfil del dueño. Default false.';
comment on column public.family_permissions.can_manage is
    'Permite editar y borrar datos del dueño y administrar sus permisos. Es también el destinatario de las alertas clínicas y de renovación de recetas. Default false.';

create index family_permissions_granted_profile_id_idx
    on public.family_permissions (granted_profile_id);
create index family_permissions_owner_profile_id_idx
    on public.family_permissions (owner_profile_id);

create trigger family_permissions_set_updated_at
    before update on public.family_permissions
    for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4.3 doctors — directorio de profesionales del perfil
-- -----------------------------------------------------------------------------
create table public.doctors (
    id              uuid primary key default gen_random_uuid(),
    profile_id      uuid not null references public.profiles (id) on delete cascade,
    full_name       text not null,
    specialty       text,
    license_number  text,
    institution     text,
    phone           text,
    address         text,
    latitude        numeric(9, 6),
    longitude       numeric(9, 6),
    notes           text,
    is_active       boolean not null default true,
    deactivated_at  timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint doctors_full_name_no_vacio
        check (char_length(btrim(full_name)) > 0),
    constraint doctors_latitud_valida
        check (latitude is null or latitude between -90 and 90),
    constraint doctors_longitud_valida
        check (longitude is null or longitude between -180 and 180),
    constraint doctors_coordenadas_completas
        check ((latitude is null) = (longitude is null)),
    constraint doctors_baja_coherente
        check (is_active or deactivated_at is not null)
);

comment on table public.doctors is
    'Agenda de profesionales de un perfil. La baja es lógica (is_active = false) para no romper turnos ni documentos que ya lo referencian.';
comment on column public.doctors.profile_id is
    'Perfil dueño de la agenda. Cada perfil mantiene su propio directorio; no hay catálogo global de médicos.';
comment on column public.doctors.license_number is
    'Matrícula profesional (MN / MP).';
comment on column public.doctors.is_active is
    'Baja lógica. Al pasar a false se completa deactivated_at; el profesional deja de ofrecerse en los selectores pero sigue visible en el historial.';
comment on column public.doctors.latitude is
    'Latitud del consultorio para el deep link de "Cómo llegar". Se guarda junto con longitude o ninguna de las dos.';

create index doctors_profile_id_idx
    on public.doctors (profile_id);
create index doctors_profile_activos_idx
    on public.doctors (profile_id, full_name)
    where is_active;
create index doctors_profile_specialty_idx
    on public.doctors (profile_id, specialty);

create trigger doctors_set_updated_at
    before update on public.doctors
    for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4.4 documents — estudios, recetas e informes cargados
-- -----------------------------------------------------------------------------
create table public.documents (
    id              uuid primary key default gen_random_uuid(),
    profile_id      uuid not null references public.profiles (id) on delete cascade,
    title           text not null,
    category        public.doc_category not null default 'other',
    specialty       text,
    institution     text,
    doctor_name     text,
    doctor_id       uuid references public.doctors (id) on delete set null,
    document_date   date not null,
    storage_path    text not null,
    mime_type       text,
    file_size_bytes bigint,
    ai_summary      text,
    raw_ocr_text    text,
    ai_confidence   numeric(4, 3),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint documents_title_no_vacio
        check (char_length(btrim(title)) > 0),
    constraint documents_storage_path_unico
        unique (storage_path),
    constraint documents_storage_path_no_es_url
        check (char_length(btrim(storage_path)) > 0
               and lower(storage_path) not like 'http%'),
    constraint documents_ai_confidence_valida
        check (ai_confidence is null or ai_confidence between 0 and 1),
    constraint documents_file_size_valido
        check (file_size_bytes is null or file_size_bytes > 0)
);

comment on table public.documents is
    'Documento médico digitalizado (análisis, imagen, receta, consulta). El archivo vive en el bucket privado documentos-medicos.';
comment on column public.documents.storage_path is
    'Path del objeto dentro del bucket privado documentos-medicos, con el formato {profile_id}/{anio}/{uuid}.{ext}. NUNCA una URL: el CHECK rechaza cualquier valor que empiece con http. La visualización se hace exclusivamente por signed URL de vida corta generada en el servidor.';
comment on column public.documents.doctor_id is
    'Vínculo opcional con el directorio de médicos. Es ON DELETE SET NULL: si se depura el profesional, el documento no se pierde y conserva doctor_name como texto.';
comment on column public.documents.doctor_name is
    'Nombre del profesional tal como lo detectó la IA o lo escribió la persona. Se conserva aunque exista doctor_id, porque es el dato textual del documento.';
comment on column public.documents.ai_summary is
    'Resumen generado por IA. Es asistencia, no diagnóstico: la UI debe declararlo.';
comment on column public.documents.raw_ocr_text is
    'Texto crudo devuelto por el OCR/modelo. Se guarda para poder reprocesar sin volver a leer el archivo.';
comment on column public.documents.ai_confidence is
    'Confianza declarada por el modelo sobre la extracción (0 a 1). Si es baja, la pantalla de revisión avisa que conviene corregir a mano.';

create index documents_profile_fecha_idx
    on public.documents (profile_id, document_date desc);
create index documents_profile_categoria_fecha_idx
    on public.documents (profile_id, category, document_date desc);
create index documents_doctor_id_idx
    on public.documents (doctor_id)
    where doctor_id is not null;
create index documents_profile_institution_idx
    on public.documents (profile_id, institution);

create trigger documents_set_updated_at
    before update on public.documents
    for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4.5 lab_metrics — valores de laboratorio para las series temporales
-- -----------------------------------------------------------------------------
create table public.lab_metrics (
    id                uuid primary key default gen_random_uuid(),
    document_id       uuid references public.documents (id) on delete cascade,
    profile_id        uuid not null references public.profiles (id) on delete cascade,
    metric_name       text not null,
    metric_canonical  text,
    value             numeric not null,
    unit              text,
    reference_range   text,
    reference_min     numeric,
    reference_max     numeric,
    measurement_date  date not null,
    created_at        timestamptz not null default now(),

    constraint lab_metrics_metric_name_no_vacio
        check (char_length(btrim(metric_name)) > 0),
    constraint lab_metrics_rango_coherente
        check (reference_min is null
               or reference_max is null
               or reference_min <= reference_max),
    constraint lab_metrics_unica_por_documento
        unique (document_id, metric_name)
);

comment on table public.lab_metrics is
    'Métrica numérica extraída de un estudio de laboratorio. Es la fuente de las series temporales y de las tarjetas de "último valor".';
comment on column public.lab_metrics.document_id is
    'Documento de origen. Nullable a propósito: permite cargar una métrica a mano (por ejemplo dictada por el médico) sin obligar a subir un archivo. Cuando existe, el borrado del documento arrastra la métrica (ON DELETE CASCADE).';
comment on column public.lab_metrics.metric_name is
    'Nombre tal como figura en el estudio ("Glucemia en ayunas", "GLU"). Se conserva textual para poder auditar la extracción.';
comment on column public.lab_metrics.metric_canonical is
    'Nombre normalizado por el diccionario de sinónimos ("glucosa"). Es la columna por la que se agrupan las series; se completa en el Sprint 4.';
comment on column public.lab_metrics.reference_range is
    'Rango de referencia tal como aparece impreso en el estudio ("70 - 110 mg/dL").';
comment on column public.lab_metrics.reference_min is
    'Extremo inferior del rango de referencia ya parseado, para dibujar la banda del gráfico sin reinterpretar texto en cada render.';
comment on column public.lab_metrics.reference_max is
    'Extremo superior del rango de referencia ya parseado.';
comment on constraint lab_metrics_unica_por_documento on public.lab_metrics is
    'Evita duplicar la misma métrica al reprocesar un documento y habilita el upsert con ON CONFLICT. No aplica a métricas manuales (document_id NULL).';

create index lab_metrics_profile_nombre_fecha_idx
    on public.lab_metrics (profile_id, metric_name, measurement_date desc);
create index lab_metrics_profile_canonico_fecha_idx
    on public.lab_metrics (profile_id, metric_canonical, measurement_date desc)
    where metric_canonical is not null;
create index lab_metrics_document_id_idx
    on public.lab_metrics (document_id)
    where document_id is not null;


-- -----------------------------------------------------------------------------
-- 4.6 appointments — turnos médicos
-- -----------------------------------------------------------------------------
create table public.appointments (
    id                 uuid primary key default gen_random_uuid(),
    profile_id         uuid not null references public.profiles (id) on delete cascade,
    specialty          text not null,
    doctor_name        text,
    doctor_id          uuid references public.doctors (id) on delete set null,
    appointment_date   timestamptz not null,
    location_name      text,
    location_address   text,
    latitude           numeric(9, 6),
    longitude          numeric(9, 6),
    preparation_notes  text,
    status             public.appointment_status not null default 'pending',
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),

    constraint appointments_specialty_no_vacia
        check (char_length(btrim(specialty)) > 0),
    constraint appointments_latitud_valida
        check (latitude is null or latitude between -90 and 90),
    constraint appointments_longitud_valida
        check (longitude is null or longitude between -180 and 180),
    constraint appointments_coordenadas_completas
        check ((latitude is null) = (longitude is null))
);

comment on table public.appointments is
    'Turno médico del perfil, con la logística necesaria para llegar (dirección, coordenadas, preparación previa).';
comment on column public.appointments.appointment_date is
    'Fecha y hora del turno en timestamptz. La app trabaja con la zona America/Argentina/Ushuaia y convierte en el borde, nunca guarda hora local sin zona.';
comment on column public.appointments.latitude is
    'Latitud del lugar de atención, usada por los deep links de Maps, Uber, DiDi y Cabify. Se guarda junto con longitude o ninguna de las dos.';
comment on column public.appointments.preparation_notes is
    'Indicaciones previas (ayuno, llevar estudios, suspender medicación). Se muestra en el recordatorio push.';
comment on column public.appointments.status is
    'Estado del turno. El enum impide estados inventados desde la aplicación.';

create index appointments_profile_fecha_idx
    on public.appointments (profile_id, appointment_date);
create index appointments_profile_proximos_idx
    on public.appointments (profile_id, appointment_date)
    where status in ('pending', 'confirmed');
create index appointments_doctor_id_idx
    on public.appointments (doctor_id)
    where doctor_id is not null;

create trigger appointments_set_updated_at
    before update on public.appointments
    for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4.7 medications — plan de medicación
-- -----------------------------------------------------------------------------
create table public.medications (
    id                        uuid primary key default gen_random_uuid(),
    profile_id                uuid not null references public.profiles (id) on delete cascade,
    name                      text not null,
    active_ingredient         text,
    presentation              text,
    dose_amount               numeric not null,
    dose_unit                 text not null default 'comprimido',
    frequency                 public.medication_frequency not null default 'daily',
    schedule_times            time[],
    interval_hours            smallint,
    start_date                date not null default current_date,
    end_date                  date,
    stock_units               numeric,
    prescription_document_id  uuid references public.documents (id) on delete set null,
    notes                     text,
    is_active                 boolean not null default true,
    suspended_at              timestamptz,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),

    constraint medications_name_no_vacio
        check (char_length(btrim(name)) > 0),
    constraint medications_dose_amount_positiva
        check (dose_amount > 0),
    constraint medications_stock_no_negativo
        check (stock_units is null or stock_units >= 0),
    constraint medications_interval_hours_valido
        check (interval_hours is null or interval_hours between 1 and 24),
    constraint medications_fechas_coherentes
        check (end_date is null or end_date >= start_date),
    constraint medications_suspension_coherente
        check (is_active or suspended_at is not null),
    constraint medications_esquema_coherente
        check (
            (frequency = 'daily'
                and schedule_times is not null
                and array_length(schedule_times, 1) >= 1
                and interval_hours is null)
            or (frequency = 'interval_hours'
                and interval_hours is not null
                and schedule_times is null)
            or (frequency = 'as_needed'
                and schedule_times is null
                and interval_hours is null)
        )
);

comment on table public.medications is
    'Medicación indicada a un perfil, con su esquema de administración y el stock disponible. La baja es lógica (is_active = false) para conservar trazabilidad.';
comment on column public.medications.name is
    'Nombre comercial tal como figura en la caja ("Glucophage").';
comment on column public.medications.active_ingredient is
    'Droga o principio activo ("Metformina"). Permite detectar duplicaciones entre marcas distintas.';
comment on column public.medications.presentation is
    'Presentación y concentración ("comprimidos 850 mg", "solución 100 mg/ml").';
comment on column public.medications.dose_amount is
    'Cantidad por toma, expresada en dose_unit (por ejemplo 1 comprimido, 10 ml).';
comment on column public.medications.dose_unit is
    'Unidad de la toma. Texto libre y no enum: las presentaciones reales (comprimido, ml, gotas, puff, sobre, unidades de insulina) cambian más rápido de lo que conviene migrar un tipo.';
comment on column public.medications.frequency is
    'Modo de administración. Determina qué columna de esquema es obligatoria: daily usa schedule_times, interval_hours usa interval_hours, as_needed no programa tomas.';
comment on column public.medications.schedule_times is
    'Horarios fijos del día como arreglo de time (hora de pared local, por ejemplo {08:00, 20:00}). Se eligió time[] sobre jsonb/text[] porque Postgres valida el formato, el arreglo ordena y compara sin parsear, y array_length da directamente las tomas por día.';
comment on column public.medications.interval_hours is
    'Intervalo en horas cuando la frecuencia es "cada N horas" (1 a 24). Las tomas del día se derivan como 24 / interval_hours.';
comment on column public.medications.stock_units is
    'Unidades disponibles en la misma unidad que dose_unit. Base del cálculo de días restantes = stock_units / (dose_amount * tomas por día).';
comment on column public.medications.prescription_document_id is
    'Receta asociada (documento de categoría prescription). ON DELETE SET NULL: borrar la receta no borra la medicación.';
comment on column public.medications.is_active is
    'Medicación vigente. Suspender en lugar de borrar preserva el historial de tomas.';

create index medications_profile_id_idx
    on public.medications (profile_id);
create index medications_profile_activas_idx
    on public.medications (profile_id, name)
    where is_active;
create index medications_prescription_document_id_idx
    on public.medications (prescription_document_id)
    where prescription_document_id is not null;

create trigger medications_set_updated_at
    before update on public.medications
    for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4.8 medication_intakes — tomas programadas y registradas
-- -----------------------------------------------------------------------------
create table public.medication_intakes (
    id             uuid primary key default gen_random_uuid(),
    medication_id  uuid not null references public.medications (id) on delete cascade,
    profile_id     uuid not null references public.profiles (id) on delete cascade,
    scheduled_at   timestamptz not null,
    taken_at       timestamptz,
    status         public.medication_intake_status not null default 'pending',
    dose_units     numeric,
    notes          text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),

    constraint medication_intakes_toma_unica
        unique (medication_id, scheduled_at),
    constraint medication_intakes_taken_at_coherente
        check ((status = 'taken') = (taken_at is not null)),
    constraint medication_intakes_dose_units_valida
        check (dose_units is null or dose_units > 0)
);

comment on table public.medication_intakes is
    'Toma de medicación: una fila por horario programado, que pasa a taken cuando la persona confirma. Es el libro mayor del descuento de stock.';
comment on column public.medication_intakes.profile_id is
    'Perfil dueño de la toma. Está desnormalizado desde medications a propósito: las políticas RLS y las consultas del día filtran por perfil sin necesidad de un JOIN adicional.';
comment on column public.medication_intakes.scheduled_at is
    'Momento en que estaba programada la toma. Junto con medication_id forma la clave única que impide registrar dos veces la misma toma.';
comment on column public.medication_intakes.taken_at is
    'Momento real de la toma. Obligatorio si status = taken y prohibido en cualquier otro estado (lo garantiza el CHECK).';
comment on column public.medication_intakes.dose_units is
    'Unidades efectivamente descontadas del stock al registrar la toma. Se guarda acá para que revertir una toma restituya exactamente lo descontado, aunque después cambie la dosis de la medicación.';

create index medication_intakes_medication_id_idx
    on public.medication_intakes (medication_id);
create index medication_intakes_profile_fecha_idx
    on public.medication_intakes (profile_id, scheduled_at desc);
create index medication_intakes_pendientes_idx
    on public.medication_intakes (profile_id, scheduled_at)
    where status = 'pending';

create trigger medication_intakes_set_updated_at
    before update on public.medication_intakes
    for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4.9 vital_signs — tensión arterial, glucemia y peso
-- -----------------------------------------------------------------------------
create table public.vital_signs (
    id          uuid primary key default gen_random_uuid(),
    profile_id  uuid not null references public.profiles (id) on delete cascade,
    type        public.vital_sign_type not null,
    systolic    smallint,
    diastolic   smallint,
    pulse       smallint,
    value       numeric,
    unit        text,
    measured_at timestamptz not null default now(),
    notes       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    constraint vital_signs_campos_por_tipo
        check (
            (type = 'blood_pressure'
                and systolic is not null
                and diastolic is not null
                and value is null)
            or (type in ('glucose', 'weight')
                and value is not null
                and systolic is null
                and diastolic is null)
        ),
    constraint vital_signs_sistolica_plausible
        check (systolic is null or systolic between 50 and 300),
    constraint vital_signs_diastolica_plausible
        check (diastolic is null or diastolic between 30 and 200),
    constraint vital_signs_sistolica_mayor_diastolica
        check (systolic is null or diastolic is null or systolic > diastolic),
    constraint vital_signs_pulso_plausible
        check (pulse is null or pulse between 20 and 250),
    constraint vital_signs_valor_positivo
        check (value is null or value > 0)
);

comment on table public.vital_signs is
    'Medición diaria de un signo vital. Se modeló con columnas tipadas nullable y un CHECK por tipo en lugar de un jsonb: los valores son numéricos, se grafican y se comparan contra umbrales, y con columnas nativas el motor de alertas y los índices funcionan sin castear.';
comment on column public.vital_signs.type is
    'Tipo de medición. Determina qué columnas deben estar completas (lo garantiza vital_signs_campos_por_tipo).';
comment on column public.vital_signs.systolic is
    'Presión sistólica en mmHg. Obligatoria y exclusiva del tipo blood_pressure.';
comment on column public.vital_signs.diastolic is
    'Presión diastólica en mmHg. Obligatoria y exclusiva del tipo blood_pressure.';
comment on column public.vital_signs.pulse is
    'Pulso en latidos por minuto. Opcional: la mayoría de los tensiómetros domésticos lo informa junto con la presión.';
comment on column public.vital_signs.value is
    'Valor único para glucemia (mg/dL) y peso (kg). Obligatorio y exclusivo de esos dos tipos.';
comment on column public.vital_signs.unit is
    'Unidad del valor cuando difiere del default esperado (mg/dL para glucemia, kg para peso).';
comment on column public.vital_signs.measured_at is
    'Momento de la medición. Se precarga con "ahora" pero es editable, por eso no se deriva de created_at.';

create index vital_signs_profile_tipo_fecha_idx
    on public.vital_signs (profile_id, type, measured_at desc);
create index vital_signs_profile_fecha_idx
    on public.vital_signs (profile_id, measured_at desc);

create trigger vital_signs_set_updated_at
    before update on public.vital_signs
    for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4.10 insurance_cards — billetera de coberturas
-- -----------------------------------------------------------------------------
create table public.insurance_cards (
    id                  uuid primary key default gen_random_uuid(),
    profile_id          uuid not null references public.profiles (id) on delete cascade,
    provider            text not null,
    member_number       text,
    plan                text,
    is_primary          boolean not null default false,
    valid_until         date,
    front_storage_path  text,
    back_storage_path   text,
    notes               text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint insurance_cards_provider_no_vacio
        check (char_length(btrim(provider)) > 0),
    constraint insurance_cards_cobertura_unica
        unique (profile_id, provider, member_number),
    constraint insurance_cards_front_no_es_url
        check (front_storage_path is null
               or lower(front_storage_path) not like 'http%'),
    constraint insurance_cards_back_no_es_url
        check (back_storage_path is null
               or lower(back_storage_path) not like 'http%')
);

comment on table public.insurance_cards is
    'Cobertura de salud del perfil (OSDE, PAMI, IOMA, obra social sindical, prepaga) con las fotos de frente y dorso de la credencial. Se modeló una fila por cobertura con dos paths, en vez de una fila por lado: evita duplicar provider/plan/número en dos filas que pueden divergir y hace que la billetera se liste sin agrupar. El enum insurance_card_side identifica el lado en la capa de aplicación (parámetro de subida y convención de path en Storage).';
comment on column public.insurance_cards.provider is
    'Nombre de la obra social o prepaga tal como figura en la credencial.';
comment on column public.insurance_cards.member_number is
    'Número de afiliado.';
comment on column public.insurance_cards.is_primary is
    'Marca la cobertura principal del perfil, que es la que muestra la ficha SOS. El índice parcial insurance_cards_una_principal_idx garantiza una sola por perfil.';
comment on column public.insurance_cards.front_storage_path is
    'Path del frente de la credencial en el bucket privado credenciales-cobertura (side = front). Nunca una URL.';
comment on column public.insurance_cards.back_storage_path is
    'Path del dorso de la credencial en el bucket privado credenciales-cobertura (side = back). Nunca una URL.';

create unique index insurance_cards_una_principal_idx
    on public.insurance_cards (profile_id)
    where is_primary;
create index insurance_cards_profile_id_idx
    on public.insurance_cards (profile_id);

create trigger insurance_cards_set_updated_at
    before update on public.insurance_cards
    for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4.11 access_logs — auditoría append-only de accesos a datos sensibles
-- -----------------------------------------------------------------------------
create table public.access_logs (
    id                uuid primary key default gen_random_uuid(),
    actor_user_id     uuid references auth.users (id) on delete set null,
    actor_profile_id  uuid references public.profiles (id) on delete set null,
    profile_id        uuid references public.profiles (id) on delete set null,
    action            public.access_action not null,
    resource_type     text,
    resource_id       uuid,
    ip                inet,
    user_agent        text,
    metadata          jsonb,
    created_at        timestamptz not null default now()
);

comment on table public.access_logs is
    'Registro APPEND-ONLY de accesos a datos de salud (Ley 25.326, trazabilidad). Se escribe y se lee, nunca se actualiza ni se borra: por eso la tabla no tiene updated_at ni trigger de updated_at. La prohibición efectiva de UPDATE y DELETE para usuarios finales se implementa con políticas RLS en la migración de auditoría.';
comment on column public.access_logs.actor_user_id is
    'Cuenta de Supabase Auth que realizó el acceso. ON DELETE SET NULL para que el borrado de una cuenta no destruya el rastro de auditoría.';
comment on column public.access_logs.actor_profile_id is
    'Perfil desde el que se estaba operando al momento del acceso (perfil activo del selector).';
comment on column public.access_logs.profile_id is
    'Perfil cuyos datos se accedieron. ON DELETE SET NULL: si el titular ejerce su derecho de supresión, el registro sobrevive pero deja de apuntar a la persona.';
comment on column public.access_logs.action is
    'Acción auditada. Los literales del enum access_action son los que consume la vista de accesos del titular.';
comment on column public.access_logs.resource_type is
    'Tabla o recurso afectado ("documents", "insurance_cards", "ficha"), en texto libre para no acoplar la auditoría al esquema.';
comment on column public.access_logs.resource_id is
    'Identificador del recurso accedido. Sin FK a propósito: el registro debe sobrevivir al borrado del recurso.';
comment on column public.access_logs.ip is
    'Dirección IP de origen (tipo inet).';
comment on column public.access_logs.metadata is
    'Contexto adicional del evento en JSON (por ejemplo el motivo de un rechazo). No debe contener datos de salud ni identificatorios.';

create index access_logs_profile_fecha_idx
    on public.access_logs (profile_id, created_at desc);
create index access_logs_actor_fecha_idx
    on public.access_logs (actor_user_id, created_at desc);
create index access_logs_recurso_idx
    on public.access_logs (resource_type, resource_id)
    where resource_id is not null;


-- -----------------------------------------------------------------------------
-- 4.12 push_subscriptions — suscripciones Web Push (VAPID)
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
    id           uuid primary key default gen_random_uuid(),
    profile_id   uuid references public.profiles (id) on delete cascade,
    user_id      uuid not null references auth.users (id) on delete cascade,
    endpoint     text not null,
    p256dh       text not null,
    auth         text not null,
    user_agent   text,
    created_at   timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    revoked_at   timestamptz,

    constraint push_subscriptions_endpoint_unico
        unique (endpoint),
    constraint push_subscriptions_endpoint_es_https
        check (lower(endpoint) like 'https://%')
);

comment on table public.push_subscriptions is
    'Suscripción Web Push de un navegador/dispositivo. Una fila por endpoint del Push Service.';
comment on column public.push_subscriptions.profile_id is
    'Perfil activo al momento de suscribirse. Es opcional porque una misma persona puede gestionar varios perfiles desde el mismo dispositivo: el destinatario efectivo de cada envío se resuelve por user_id más family_permissions.';
comment on column public.push_subscriptions.user_id is
    'Cuenta de Supabase Auth dueña de la suscripción. Obligatoria: sin cuenta no hay push.';
comment on column public.push_subscriptions.endpoint is
    'Endpoint del Push Service devuelto por pushManager.subscribe. Único: si el navegador reemplaza la suscripción, se hace upsert sobre esta clave.';
comment on column public.push_subscriptions.p256dh is
    'Clave pública P-256 del cliente (base64url), necesaria para el cifrado aes128gcm del payload.';
comment on column public.push_subscriptions.auth is
    'Secreto de autenticación del cliente (base64url), necesario para el cifrado aes128gcm del payload.';
comment on column public.push_subscriptions.last_seen_at is
    'Última vez que la suscripción se revalidó desde el navegador. Sirve para depurar suscripciones dormidas.';
comment on column public.push_subscriptions.revoked_at is
    'Momento en que el Push Service devolvió 410 Gone o la persona desactivó las notificaciones. Las filas revocadas no se borran para poder auditar entregas pasadas.';

create index push_subscriptions_user_activas_idx
    on public.push_subscriptions (user_id)
    where revoked_at is null;
create index push_subscriptions_profile_id_idx
    on public.push_subscriptions (profile_id)
    where profile_id is not null;

-- Fin de la migración.
