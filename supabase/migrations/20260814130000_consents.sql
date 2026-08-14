-- =============================================================================
-- Historial Médico — Migración 20260814130000: consentimiento registrado
-- (Ley 25.326, Sprint 12, tarea 12.1)
-- =============================================================================
-- Tabla `consents` — un renglón por cada vez que una CUENTA acepta un
-- documento legal del proyecto: la Política de Privacidad, los Términos y
-- Condiciones (juntos, al registrarse), o el otorgamiento de acceso a los
-- datos de salud de un perfil a otra persona (`acceso_familiar`, cada vez
-- que se otorga un acceso desde `/familia`).
--
-- Criterio de aceptación (ROADMAP_SPRINTS.md línea 745): no se puede
-- completar el registro sin aceptar explícitamente, y el consentimiento
-- queda registrado con VERSIÓN y TIMESTAMP.
--
-- ── POR QUÉ `user_id` APUNTA A `auth.users` Y NO A `profiles`
--
-- Todas las demás tablas del dominio cuelgan de un `profile_id`: son datos
-- DE un perfil. El consentimiento no lo es — es un acto de la CUENTA, previo
-- e independiente de cualquier perfil. Al momento de aceptar Privacidad y
-- Términos en `/registro` todavía no existe ningún perfil (se crea un
-- instante después, en el mismo flujo). Mismo argumento que
-- `display_density` (20260814120000): la única tabla del esquema con
-- `user_id` como concepto de "esta fila es de esta cuenta" es la que puede
-- expresar esto sin inventar un perfil de más.
--
-- ── POR QUÉ `document text` + CHECK Y NO UN ENUM
--
-- El resto del proyecto prefiere enums para dominios cerrados que lee la
-- interfaz (`access_action`, `display_density`, `vital_sign_alert_rule`), y
-- acá se rompe el patrón a propósito: agregar un documento nuevo (por
-- ejemplo si el día de mañana aparece un consentimiento específico para
-- compartir la ficha SOS por fuera de la familia) es un `ALTER TABLE ...
-- ADD CONSTRAINT` que reemplaza el CHECK, sin la ceremonia de
-- `ALTER TYPE ... ADD VALUE` (que en Postgres no se puede usar en la misma
-- transacción en la que el valor nuevo se inserta). Es una tabla de
-- cumplimiento legal, no de dominio clínico: el costo de iterarla rápido
-- pesa más que la garantía extra de un enum.
--
-- ── POR QUÉ ES APPEND-ONLY (SIN UPDATE NI DELETE)
--
-- Es un registro PROBATORIO: existe para poder demostrar, ante la AAIP o
-- ante la propia persona, que tal cuenta aceptó tal versión de tal documento
-- en tal momento. Igual que `consultation_sheets` (fichas emitidas) y
-- `access_logs` (accesos), permitir editarlo o borrarlo le quitaría todo su
-- valor como prueba. Se aplica DESDE EL PRIMER DÍA el tratamiento de las dos
-- capas que la auditoría 11.4 tuvo que agregarle a `consultation_sheets`
-- después de los hechos (hallazgo A-01): el privilegio de UPDATE/DELETE NI
-- SIQUIERA SE CONCEDE a `authenticated`, no se confía solo en la ausencia de
-- política.
--
-- ── `ON DELETE CASCADE`
--
-- Si el titular ejerce su derecho de SUPRESIÓN (Ley 25.326, arts. 14-16) y
-- borra la cuenta, su rastro de consentimiento se borra con ella —mismo
-- criterio que el resto del esquema (`profiles`, `documents`,
-- `consultation_sheets`: todo cuelga del titular con CASCADE)—. No hay caso
-- de uso del proyecto que necesite retener la prueba de consentimiento de
-- una cuenta que ya no existe.
--
-- ── EL REVOKE NO ES DECORATIVO
--
-- Supabase trae `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
-- authenticated`: toda tabla nueva de `public` nace con TRUNCATE para los
-- dos roles públicos, y RLS no protege de un TRUNCATE. Sin este revoke,
-- cualquier sesión podría vaciar el registro probatorio de consentimiento de
-- TODAS las cuentas.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema, igual que el resto
-- del proyecto.
-- =============================================================================

create table public.consents (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users (id) on delete cascade,
    document    text not null,
    version     text not null,
    accepted_at timestamptz not null default now(),
    ip          inet
);

alter table public.consents
    add constraint consents_document_valido
        check (document in ('privacidad', 'terminos', 'acceso_familiar'));

comment on table public.consents is
    'Registro probatorio e inmutable de consentimiento (Ley 25.326, Sprint 12, tarea 12.1). Una fila = una cuenta aceptando un documento en un momento dado, con qué versión y desde qué IP. Append-only: sin UPDATE ni DELETE para authenticated, ni siquiera para el propio titular (mismo tratamiento que access_logs y consultation_sheets). ON DELETE CASCADE: el derecho de supresión de la cuenta se lleva su propio rastro de consentimiento.';
comment on column public.consents.user_id is
    'La CUENTA que aceptó, no un perfil: el consentimiento es anterior e independiente de cualquier perfil (mismo argumento que profiles.display_density en 20260814120000).';
comment on column public.consents.document is
    'Qué se aceptó: "privacidad" y "terminos" se firman juntos al registrarse; "acceso_familiar" se firma cada vez que la cuenta otorga acceso sobre un perfil a otra persona (docs/modelo-permisos.md §4.4). text + CHECK y no un enum: ver el porqué en el encabezado de esta migración.';
comment on column public.consents.version is
    'La constante VERSION_LEGALES vigente en lib/legales.ts al momento de aceptar (formato AAAA-MM-DD-vN). Permite saber, más adelante, si el consentimiento guardado corresponde a la versión vigente del documento o a una anterior.';
comment on column public.consents.accepted_at is
    'Cuándo se aceptó. Es la fecha que exige el criterio de aceptación del ROADMAP junto con la versión.';
comment on column public.consents.ip is
    'IP de origen, normalizada con la misma función que access_logs.ip (lib/auditoria.ts). NULL si la cabecera no traía una dirección utilizable: nunca se descarta la fila entera por este dato, el menos importante que lleva.';

-- Consulta típica: "¿esta cuenta ya aceptó este documento, y cuándo fue la
-- última vez?". `desc` porque lo que casi siempre importa es lo más reciente.
create index consents_por_cuenta_y_documento_idx
    on public.consents (user_id, document, accepted_at desc);


-- =============================================================================
-- RLS Y PRIVILEGIOS
-- =============================================================================

alter table public.consents enable row level security;

revoke all on public.consents from anon, authenticated;

-- Append-only desde el primer día (auditoría 11.4, hallazgo A-01): SOLO
-- select e insert. Ni siquiera se concede UPDATE/DELETE para después
-- confiar en que "no hay política que lo ejerza" — el privilegio no existe.
grant select, insert on public.consents to authenticated;
grant select, insert, update, delete on public.consents to service_role;

-- SELECT: cada cuenta ve únicamente sus propias filas. A diferencia de
-- access_logs, acá no hay "el titular de un perfil ve los accesos de sus
-- gestionados": el consentimiento es de QUIEN LO DIO, no hay forma de darlo
-- por otra cuenta ni razón para que un administrador lo audite desde acá
-- -family_permissions y access_logs ya dejan ese rastro-.
create policy consents_select_propio
    on public.consents
    for select
    to authenticated
    using (user_id = (select auth.uid()));

comment on policy consents_select_propio on public.consents is
    'Cada cuenta lee únicamente sus propias filas de consentimiento. No hay visibilidad cruzada entre cuentas, ni siquiera para quien administra un perfil gestionado: el consentimiento es de la cuenta, no del perfil.';

-- INSERT: solo a nombre propio. Sin este WITH CHECK, cualquier sesión podría
-- fabricar un consentimiento firmado por otra cuenta.
create policy consents_insert_propio
    on public.consents
    for insert
    to authenticated
    with check (user_id = (select auth.uid()));

comment on policy consents_insert_propio on public.consents is
    'Una cuenta solo puede insertar consentimiento a su propio nombre: user_id tiene que coincidir con auth.uid(). Firmar a nombre de otra cuenta queda rechazado por RLS, igual que access_logs_insert_actor_propio.';

-- SIN POLÍTICA DE UPDATE Y SIN POLÍTICA DE DELETE, A PROPÓSITO. El registro
-- es probatorio: cambiar de opinión sobre un documento se resuelve
-- aceptando una versión nueva (una fila más), nunca editando ni borrando la
-- que ya existe. La ausencia de privilegio (arriba) ya lo garantiza; la
-- ausencia de política es la segunda capa.

-- Fin de la migración.
