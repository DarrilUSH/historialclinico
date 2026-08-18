-- =============================================================================
-- Historial Médico — Migración 20260818090000: un médico puede tener varias
-- especialidades (Sprint 16, tarea 16.2)
-- -----------------------------------------------------------------------------
-- ── EL PROBLEMA QUE ESTO CORRIGE
--
-- `doctors.specialty` es, desde el Sprint 10, UN solo campo de texto libre.
-- Pedido real del usuario (ROADMAP_SPRINTS.md §Sprint 16, ítem 2): su médica
-- de cabecera es clínica Y cardióloga, y hoy tiene que elegir una sola
-- especialidad al cargarla en el directorio -perder la otra mitad de un dato
-- real por una limitación del modelo-.
--
-- ── LA DECISIÓN DE ESQUEMA: `text[]`, NO UNA TABLA N:M
--
-- El pedido del usuario (ROADMAP) sugería una tabla de unión
-- (`doctor_specialties`), y es la opción "de libro" para una relación N:M.
-- Se evalúan las dos:
--
--   1. Tabla N:M (`doctor_specialties(doctor_id, specialty)`, PK compuesta o
--      `id` propio): normaliza mejor -permitiría, por ejemplo, un catálogo
--      cerrado de especialidades con FK-, pero acá el catálogo NO es cerrado
--      (`lib/especialidades/catalogo.ts`: es una lista de sugerencias, la
--      tarea pide explícitamente que una especialidad rara no bloquee la
--      carga, así que una FK contra un catálogo cerrado no aplica). Sin FK
--      que la justifique, una tabla nueva solo suma: sus propias RLS
--      (`SELECT`/`INSERT`/`UPDATE`/`DELETE`, las cuatro calcadas letra por
--      letra de las de `doctors` porque la fila de especialidades no tiene
--      autorización propia, hereda la del médico dueño), su propio índice,
--      su propio trigger de `updated_at` si hiciera falta, y un nuevo bloque
--      en `scripts/test-rls.sql` para probar esas políticas -máquina real
--      para una relación que, en esta app, nunca va a tener más de un puñado
--      de valores por fila (un médico de una familia con 2-3 especialidades,
--      no una base de datos hospitalaria con miles de profesionales)-.
--   2. `doctors.specialties text[] not null default '{}'`, con la
--      `specialty` actual migrada como primer elemento. Es la opción
--      elegida: la fila de `doctors` sigue siendo la única unidad de
--      autorización -RLS simple, cero políticas nuevas, ver más abajo-, no
--      hay JOIN que armar en cada consulta que hoy ya trae `doctors.*` (la
--      tarjeta del médico, el selector de turnos, el formulario de edición:
--      los cuatro puntos de la tarea que "leen especialidades de un médico"
--      siguen siendo una lectura de columna, no una relación), y el tope de
--      Postgres para columnas `text[]` (1 GB por valor) no es una
--      restricción real para una lista de a lo sumo diez entradas cortas
--      (`doctors_specialties_cantidad_razonable`, más abajo). Mismo
--      razonamiento que ya usó el Sprint 8 para `profiles.allergies`/
--      `chronic_conditions`/`critical_medications` (`text[]`, sin tabla
--      propia) y el criterio explícito del ROADMAP para esta tarea: "RLS
--      simple, sin sobre-ingeniería para una app familiar".
--
-- ── RLS: CERO POLÍTICAS NUEVAS
--
-- `specialties` es una columna más de una fila de `doctors`, tabla que ya
-- tiene RLS habilitada y sus cuatro políticas por perfil
-- (`doctors_select_puede_ver`, `doctors_insert_puede_cargar`,
-- `doctors_update_administrador`, `doctors_delete_administrador`,
-- `20260812220000_rls.sql` §"doctors"): esas políticas evalúan por FILA
-- (`profile_id`), no por columna, así que una columna nueva -o una columna
-- que cambia de tipo- hereda exactamente la misma autorización sin que haga
-- falta tocar ni una política. Mismo razonamiento, letra por letra, que ya
-- documentaron `20260814120000_preferencia_tamano.sql` §4 para
-- `display_density` y `20260817231000_ciudad_provincia_direcciones.sql` para
-- `city`/`province`. `scripts/test-rls.sql` no tiene ningún bloque dedicado a
-- `doctors` -la tabla ya está cubierta por el chequeo genérico de
-- `select tablename from pg_tables where schemaname='public' and rowsecurity
-- = false` (línea ~737) y por el conteo de políticas por tabla (línea
-- ~751)-, así que la suite sigue siendo **357/357 ×2 sin casos nuevos**: no
-- hay ninguna autorización nueva que probar, solo una columna que cambió de
-- forma dentro de una fila que ya se autorizaba igual antes y después.
--
-- ── LA MIGRACIÓN DE DATOS: SIN PÉRDIDA, `specialty` COMO PRIMER ELEMENTO
--
-- `specialties` nace `text[] not null default '{}'` (todas las filas
-- existentes arrancan en `'{}'`) y el `UPDATE` que sigue completa, fila por
-- fila, `array[btrim(specialty)]` para todo médico que tenía `specialty` no
-- vacío -"clínica médica" migra a `{"clínica médica"}`, no se pierde nada-.
-- Un médico con `specialty is null` o `specialty` en blanco queda en
-- `'{}'` -mismo criterio que ya usó el Sprint 8 para arrays: `'{}'` es "no
-- hay ninguna cargada", no un valor de relleno-.
--
-- ── `specialty` SE ELIMINA, NO QUEDA COMO COLUMNA MUERTA
--
-- Se evaluó dejar `specialty` como una copia de solo lectura del primer
-- elemento (por si algo externo la leía todavía), pero mantener dos columnas
-- con la misma información -una siempre derivable de la otra- es la clase
-- exacta de fuente doble de verdad que este proyecto evita en otros lados
-- (`documents.doctor_name` es la ÚNICA excepción documentada, y es
-- deliberada porque captura un dato textual histórico que puede divergir del
-- `doctors` vigente -ver `20260812200000_schema_inicial.sql` §4.4-; acá no
-- hay ese motivo: `specialty` y `specialties[1]` significarían siempre lo
-- mismo, así que tener las dos solo crea la posibilidad de que un `UPDATE`
-- futuro toque una y no la otra). Se verificó que ninguna función, vista ni
-- trigger de la base lee `doctors.specialty` -el único índice que la usaba,
-- `doctors_profile_specialty_idx`, se reemplaza más abajo- y que el código
-- de la app (`app/(app)/(con-nav)/medicos/actions.ts`,
-- `app/(app)/(con-nav)/medicos/page.tsx`,
-- `app/(app)/(con-nav)/medicos/[id]/editar/page.tsx`,
-- `app/(app)/(con-nav)/turnos/nuevo/page.tsx`,
-- `app/(app)/(con-nav)/turnos/[id]/editar/page.tsx`,
-- `components/medicos/tarjeta-medico.tsx`,
-- `lib/turnos/autocompletar-medico.ts`) migra en el mismo commit que esta
-- migración. `appointments.specialty` y `documents.specialty` son columnas
-- INDEPENDIENTES (el turno es para UNA especialidad concreta, el documento
-- describe la especialidad del estudio) y esta migración no las toca.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema, mismo criterio que el
-- resto del proyecto.
-- =============================================================================


-- =============================================================================
-- 1. Columna nueva: doctors.specialties
-- =============================================================================

alter table public.doctors
    add column specialties text[] not null default '{}';

comment on column public.doctors.specialties is
    'Especialidades del médico (Sprint 16, tarea 16.2), cero o más. La primera es la PRINCIPAL: lib/turnos/autocompletar-medico.ts la usa para precargar appointments.specialty al elegir este médico en un turno, y components/medicos/formulario-medico.tsx la ofrece primera en los chips. Texto libre -no hay FK ni CHECK contra un catálogo cerrado-: lib/especialidades/catalogo.ts solo alimenta el autocompletar, nunca bloquea una especialidad que no está en la lista. Reemplaza a la columna specialty (un solo valor), eliminada más abajo en esta misma migración.';


-- =============================================================================
-- 2. Backfill: specialty -> specialties[1], sin pérdida de datos
-- =============================================================================

update public.doctors
   set specialties = array[btrim(specialty)]
 where specialty is not null
   and btrim(specialty) <> '';

-- Todo médico con specialty NULL o en blanco ya quedó en '{}' por el DEFAULT
-- de la columna nueva: no hace falta un segundo UPDATE para ese caso.


-- =============================================================================
-- 3. CHECKs: sin elementos vacíos, tope de cantidad razonable
-- =============================================================================

-- Postgres no permite una subquery directa dentro de la expresión de un
-- CHECK ("cannot use subquery in check constraint") -y `unnest(...) ...
-- where ...` es exactamente eso-, así que la validación elemento por
-- elemento se envuelve en una función `IMMUTABLE`: no toca ninguna tabla,
-- solo opera sobre el array que recibe como argumento, así que es segura
-- para usar dentro de un CHECK (que Postgres puede reevaluar en cualquier
-- momento y necesita poder confiar en que el resultado es determinístico).
create function public.especialidades_todas_no_vacias(valores text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
    select not exists (
        select 1 from unnest(valores) as valor
         where btrim(coalesce(valor, '')) = ''
    )
$$;

comment on function public.especialidades_todas_no_vacias(text[]) is
    'Helper IMMUTABLE del CHECK doctors_specialties_sin_vacios (supabase/migrations/20260818090000_especialidades_multiples.sql): Postgres no admite una subquery directa dentro de un CHECK, así que la validación "ningún elemento del array es NULL ni una cadena en blanco" vive acá. A propósito NO lleva `revoke execute ... from public` -a diferencia de todas las funciones SECURITY DEFINER de este proyecto (`puede_ver_perfil`, `registrar_toma`, etc., ver docs/modelo-permisos.md)-: esta función no es SECURITY DEFINER, no lee ninguna tabla y no expone nada -solo transforma el array que recibe-, y el CHECK que la usa se evalúa con los privilegios del rol que hace el INSERT/UPDATE (`authenticated`), así que revocar EXECUTE de `public` rompería cualquier alta o edición de un médico. El `EXECUTE` a `PUBLIC` que Postgres otorga por default en toda función nueva es exactamente lo que hace falta acá.';

alter table public.doctors
    add constraint doctors_specialties_sin_vacios
        check (public.especialidades_todas_no_vacias(specialties));

comment on constraint doctors_specialties_sin_vacios on public.doctors is
    'Ninguna especialidad puede ser NULL ni una cadena en blanco disfrazada de entrada -mismo criterio que doctors_full_name_no_vacio, aplicado elemento por elemento del array vía public.especialidades_todas_no_vacias(). lib/validacion/medico.schema.ts ya descarta los vacíos antes de llegar acá (mismo patrón que listaSos en sos.schema.ts); este CHECK es la red de la base para cualquier escritura que no pase por ese schema.';

alter table public.doctors
    add constraint doctors_specialties_cantidad_razonable
        check (array_length(specialties, 1) is null or array_length(specialties, 1) <= 10);

comment on constraint doctors_specialties_cantidad_razonable on public.doctors is
    'Tope de 10 especialidades por médico, calcado de MAX_ESPECIALIDADES_POR_MEDICO en lib/especialidades/catalogo.ts (misma duplicación documentada que PROVINCIAS_ARGENTINAS/doctors_province_valida): una app familiar no tiene médicos con más de diez especialidades cargadas de verdad, así que un valor más alto solo dejaría pasar carga basura.';


-- =============================================================================
-- 4. Índice: GIN sobre el array reemplaza al btree sobre la columna vieja
-- =============================================================================

drop index if exists public.doctors_profile_specialty_idx;

create index doctors_specialties_gin_idx
    on public.doctors using gin (specialties);

comment on index public.doctors_specialties_gin_idx is
    'Soporta filtros por especialidad (operadores de arrays: @>, &&) si el directorio de médicos alguna vez necesita "mostrame los que son cardiólogos". Reemplaza a doctors_profile_specialty_idx (btree sobre la columna specialty, eliminada abajo).';


-- =============================================================================
-- 5. Columna vieja: se elimina (ver "specialty SE ELIMINA" en el encabezado)
-- =============================================================================

alter table public.doctors
    drop column specialty;

-- Fin de la migración.
