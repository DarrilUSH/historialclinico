-- =============================================================================
-- Historial Médico — Migración 20260814090000: historial inmutable de fichas
-- generadas (Sprint 10, tarea 10.5)
-- =============================================================================
-- Tabla `consultation_sheets` — una fila por ficha generada de un perfil.
-- Cada ficha es un JSON inmutable (no se modifica, se regenera) con los datos
-- de la sesión de Gemini validados contra `FichaGeneradaSchema` de
-- `lib/gemini/schemas.ts`. La persistencia es best-effort: un fallo de INSERT
-- NO detiene la generación (el cliente la recibe igual); si falla, queda el log.
--
-- Criterio de aceptación (ROADMAP_SPRINTS.md línea 655):
--   · Generar dos fichas deja dos filas.
--   · Abrir una ficha vieja renderiza el contenido GUARDADO, byte a byte,
--     sin llamar a Gemini ni regenerar.
--
-- ── RLS: SOLO LECTURA (SELECT) Y ESCRITURA CON GENERATED_BY
--
-- Una sesión `authenticated` puede:
--   · LEER una ficha si tiene `puede_ver_perfil` (titular, can_view, can_upload
--     o can_manage sobre el profile_id). Los antecedentes SÍ pueden leerlo: la
--     ficha está compilada con datos ya cargados (documentos, medicación,
--     signos); quien puede VER el perfil puede ver la ficha que resume lo
--     visible.
--   · ESCRIBIR (INSERT) una ficha si tiene `puede_cargar_en_perfil` (la misma
--     que exige `POST /api/ficha/generar`) Y si `generated_by_profile_id =
--     perfil_actor()`. La política lo valida; el cliente manda su perfil_id en
--     `generated_by_profile_id` y la política lo rechaza si no coincide.
--
-- Una sesión NO puede:
--   · UPDATE ni DELETE: es un documento emitido. Cambió de opinión o hay un
--     error → regenera (inserta una fila nueva). Esto mantiene el historial
--     exacto de lo que se generó y cuándo.
--   · Escribir una ficha que no sea la suya: la política WITH CHECK valida
--     `generated_by_profile_id = perfil_actor()`.
--
-- ── EL REVOKE NO ES DECORATIVO
--
-- Supabase trae `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
-- authenticated`: toda tabla nueva de `public` nace con TRUNCATE para los dos
-- roles públicos, y RLS no protege de un TRUNCATE. Sin estos revokes un
-- visitante sin sesión podría vaciar toda la historia de fichas.
--
-- ── LA COLUMNA `content` ADMITE JSON ANTIGUO
--
-- FichaGeneradaSchema se versiona en Zod junto con el schema de Gemini. Si una
-- vieja ficha de hace seis meses no pasa el schema de HOY, `app/(app)/(sin-nav)/
-- ficha/historial/[id]/page.tsx` simplemente la mostrará con un mensaje claro
-- (no silenciadora ni desecha). Eso no es un problema: es historia.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema, toda función con
-- `set search_path = ''`, igual que el resto del proyecto.
-- =============================================================================

create table public.consultation_sheets (
    id              uuid primary key default gen_random_uuid(),
    profile_id      uuid not null references public.profiles (id) on delete cascade,
    generated_by_profile_id uuid not null references public.profiles (id) on delete set null,
    content         jsonb not null,
    created_at      timestamptz not null default now()
);

comment on table public.consultation_sheets is
    'Historial inmutable de fichas de resumen para consulta (Sprint 10, tarea 10.5). Una fila = una ficha generada, identificada por fecha y por quién la generó. No hay UPDATE ni DELETE desde el cliente: es un documento emitido. El contenido JSON se valida contra FichaGeneradaSchema en el Route Handler antes de persistir; si es viejo y ya no valida contra el schema actual, se muestra con mensaje claro — no es un error, es historia.';
comment on column public.consultation_sheets.profile_id is
    'El perfil de quién es la ficha. ON DELETE CASCADE: borrar un perfil borra su historial de fichas.';
comment on column public.consultation_sheets.generated_by_profile_id is
    'El perfil que ejecutó la generación. ON DELETE SET NULL: si se borra el perfil del generador la ficha queda huérfana (no se borra, porque el documento ya se emitió). Puede ser igual a profile_id (alguien generó su propia ficha) o distinto (un can_manage generó la ficha de otro).';
comment on column public.consultation_sheets.content is
    'El JSON de la ficha, validado contra FichaGeneradaSchema en el Route Handler. Se persiste tal cual, sin transformación ni sanitización: es el documento.';
comment on column public.consultation_sheets.created_at is
    'Cuándo se generó la ficha. La única columna de fecha que tiene (no hay updated_at: es inmutable).';

-- Índice para las consultas del historial: "(profile_id, created_at desc)" es
-- el patrón de "listar fichas de un perfil, ordenadas de más reciente a más vieja".
create index consultation_sheets_historial_idx
    on public.consultation_sheets (profile_id, created_at desc);


-- =============================================================================
-- RLS Y PRIVILEGIOS
-- =============================================================================

alter table public.consultation_sheets enable row level security;

revoke all on public.consultation_sheets from anon, authenticated;

grant select, insert, update, delete on public.consultation_sheets to authenticated;
grant select, insert, update, delete on public.consultation_sheets to service_role;

-- Lectura: quien puede ver el perfil ve sus fichas. Este es el patrón de
-- lectura monótona de datos (docs/modelo-permisos.md §6.1): titular, can_view,
-- can_upload o can_manage. Las fichas son un derivado de datos ya cargados,
-- así que quien puede verlos puede ver el resumen.
create policy consultation_sheets_select_puede_ver
    on public.consultation_sheets
    for select to authenticated
    using (public.puede_ver_perfil(profile_id));

-- Escritura (INSERT): quien tiene `puede_cargar_en_perfil` (can_upload o
-- can_manage sobre el perfil) y manda generated_by_profile_id = su propio id.
-- El cliente manda generated_by_profile_id en el INSERT; la política rechaza
-- si no coincide con perfil_actor().
create policy consultation_sheets_insert_generador
    on public.consultation_sheets
    for insert to authenticated
    with check (
        public.puede_cargar_en_perfil(profile_id)
        and generated_by_profile_id = public.perfil_actor()
    );

-- NO hay UPDATE ni DELETE desde authenticated. La ficha es un documento
-- emitido: cambia de opinión → regenera (INSERT nuevo).

comment on policy consultation_sheets_select_puede_ver on public.consultation_sheets is
    'Lectura de fichas del perfil. Mismo patrón que vital_signs: quien puede ver el perfil ve el historial de fichas que resumen sus datos.';
comment on policy consultation_sheets_insert_generador on public.consultation_sheets is
    'Insertar una ficha nueva: requiere permiso de carga (can_upload o can_manage) Y que la ficha sea del perfil actor. Previene que una sesión (por ejemplo Marcela con can_upload sobre el perfil de Juan) genere fichas de otros perfiles.';

-- Fin de la migración.
