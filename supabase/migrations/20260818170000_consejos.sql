-- =============================================================================
-- Historial Médico — Migración 20260818170000: estado de los consejos del
-- tutorial de bienvenida (tarea #14)
-- -----------------------------------------------------------------------------
-- Tabla `consejos_estado` — un renglón por cada consejo que una CUENTA
-- posterga ("Ahora no") o descarta para siempre ("No mostrar más") en la
-- pantalla `/inicio`. Contrato completo del tutorial: `docs/tutorial-bienvenida.md`.
--
-- ── LOS SEIS CONSEJOS Y DÓNDE VIVE CADA CONDICIÓN
--
-- Esta tabla SOLO guarda la decisión de la persona (posterga/descarta). Si un
-- consejo aplica o no -"¿está vacía la ficha SOS?", "¿hay Gmail conectado?"-
-- no vive acá: lo evalúa la aplicación en caliente contra las tablas de
-- siempre (`profiles`, `gmail_connections`, `family_permissions`), porque es
-- información que cambia sola cuando la persona completa la función (la
-- fila de acá nunca se toca). Es lo que hace que un consejo "desaparezca
-- solo al completar la función": no hay nada que limpiar, la condición deja
-- de ser cierta.
--
-- ── POR QUÉ `user_id` APUNTA A `auth.users` Y NO A `profiles`
--
-- Los seis consejos son de la CUENTA, no de un perfil -mismo argumento que
-- `display_density` (20260814120000) y que `consents` (20260814130000): es
-- la única tabla con `user_id` como concepto de "esto es de esta cuenta"-.
-- "Completá tu ficha de emergencia" habla del perfil PROPIO de la cuenta,
-- nunca del perfil activo (que puede ser el de otra persona que administra).
--
-- ── POR QUÉ `consejo_id text` + CHECK Y NO UN ENUM
--
-- Mismo argumento que `consents.document` (20260814130000 §"POR QUÉ document
-- text"): es una lista que la INTERFAZ puede hacer crecer o encoger sin
-- ceremonia -el backlog ya anota "temas para la consulta" y otras funciones
-- nuevas que en algún momento van a querer su propio consejo-, y no un
-- dominio clínico que convenga blindar con `ALTER TYPE ... ADD VALUE`.
--
-- ── `estado`: SOLO DOS VALORES, Y EL SIGNIFICADO DE CADA UNO
--
--   'pospuesto'  → "Ahora no". Vuelve a aparecer en la PRÓXIMA SESIÓN, nunca
--                  en la próxima navegación dentro de la misma. El mecanismo
--                  completo -una cookie de sesión del navegador sin
--                  `maxAge`, comparada contra `updated_at`- vive en
--                  `lib/consejos/sesion.ts` y `lib/consejos/logica.ts`; esta
--                  tabla solo guarda EL MOMENTO en que se pospuso.
--   'descartado' → "No mostrar más". Definitivo: ninguna lectura futura
--                  vuelve a proponer este consejo para esta cuenta, ni
--                  siquiera si la función vuelve a quedar pendiente (por
--                  ejemplo, se desconecta Gmail después de haberlo
--                  conectado). Es la lectura estándar de "no mostrar más" en
--                  cualquier app: una decisión, no una condición que se
--                  reevalúa.
--
-- Un consejo nuevo por consejo_id REEMPLAZA a la fila anterior (upsert por la
-- restricción única de abajo): no hay historial de "postergué esto tres
-- veces", solo el estado vigente.
--
-- ── POR QUÉ SELECT/INSERT/UPDATE PARA `authenticated` (Y NO SOLO SELECT)
--
-- A diferencia de `consents` (registro probatorio, append-only) o de
-- `display_density` (que vive en `profiles` y su UPDATE lo arbitra un
-- trigger porque la fila es compartida con datos clínicos), esta es una
-- preferencia de INTERFAZ sin ningún valor clínico ni probatorio: acá el
-- cliente SÍ escribe lo suyo directo, con `auth.uid()` como única cerradura.
-- No hace falta ninguna función `security definer` ni ningún trigger de
-- protección -no hay una segunda persona cuyo permiso pudiera colarse acá,
-- como sí pasa con `family_permissions` sobre `profiles`-.
--
-- Sin DELETE para `authenticated`: no hay ninguna pantalla que ofrezca
-- "olvidate de que pospuse esto", y agregar el privilegio sin una política
-- que lo acompañe sería superficie de más sin ningún caso de uso.
--
-- ── EL REVOKE NO ES DECORATIVO
--
-- Misma lección que el resto del proyecto (`consents`, `gmail_connections`):
-- Supabase le da a toda tabla nueva de `public` un `GRANT ALL` (incluido
-- TRUNCATE) a `anon` y `authenticated` por `ALTER DEFAULT PRIVILEGES`. RLS no
-- cubre `TRUNCATE`. El revoke explícito es la primera línea, no un adorno.
--
-- UTF-8 sin BOM. `set search_path = ''` en cualquier función nueva y todo
-- objeto calificado con su esquema, igual que el resto del proyecto.
-- =============================================================================

create table public.consejos_estado (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references auth.users (id) on delete cascade,
    consejo_id   text not null,
    estado       text not null,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),

    constraint consejos_estado_unico
        unique (user_id, consejo_id)
);

alter table public.consejos_estado
    add constraint consejos_estado_consejo_id_valido
        check (consejo_id in (
            'instalar_app',
            'ficha_sos',
            'notificaciones',
            'gmail',
            'compartir_familia',
            'perfil_gestionado'
        ));

alter table public.consejos_estado
    add constraint consejos_estado_estado_valido
        check (estado in ('pospuesto', 'descartado'));

comment on table public.consejos_estado is
    'Estado por CUENTA de los consejos del tutorial de bienvenida (/inicio, docs/tutorial-bienvenida.md): "Ahora no" (pospuesto, vuelve en la próxima sesión) o "No mostrar más" (descartado, definitivo). No guarda si un consejo aplica -eso se evalúa en caliente contra profiles/gmail_connections/family_permissions-, solo la decisión de la persona.';
comment on column public.consejos_estado.user_id is
    'La CUENTA, no un perfil: los seis consejos son de la cuenta (mismo argumento que profiles.display_density y que consents.user_id).';
comment on column public.consejos_estado.consejo_id is
    'Uno de los seis ids fijos de lib/consejos/tipos.ts (CONSEJO_IDS). text + CHECK y no un enum: mismo argumento que consents.document, es una lista de la interfaz que puede crecer sin la ceremonia de ALTER TYPE.';
comment on column public.consejos_estado.estado is
    E'''pospuesto''(Ahora no, vuelve en la próxima sesión) o ''descartado''(No mostrar más, definitivo). Ver el encabezado de la migración para el mecanismo completo de la postergación.';
comment on column public.consejos_estado.updated_at is
    'Cuándo se tocó por última vez este consejo. Para "pospuesto" es el instante que lib/consejos/logica.ts compara contra el inicio de la sesión del navegador para decidir si la postergación sigue vigente.';

-- Trigger de refresco de updated_at: reutiliza la función genérica que ya
-- usan profiles, family_permissions, doctors, documents, etc. (definida en
-- 20260812200000_schema_inicial.sql §3).
create trigger consejos_estado_set_updated_at
    before update on public.consejos_estado
    for each row execute function public.set_updated_at();


-- =============================================================================
-- RLS Y PRIVILEGIOS
-- =============================================================================

alter table public.consejos_estado enable row level security;

revoke all on public.consejos_estado from anon, authenticated;

-- Sin DELETE para authenticated a propósito: ver el encabezado de la migración.
grant select, insert, update on public.consejos_estado to authenticated;
grant select, insert, update, delete on public.consejos_estado to service_role;

-- SELECT: cada cuenta ve únicamente sus propias filas.
create policy consejos_estado_select_propio
    on public.consejos_estado
    for select
    to authenticated
    using (user_id = (select auth.uid()));

comment on policy consejos_estado_select_propio on public.consejos_estado is
    'Cada cuenta lee únicamente sus propias filas de consejos. No hay visibilidad cruzada entre cuentas: es una preferencia de interfaz, no un dato compartible con nadie que administre un perfil gestionado.';

-- INSERT: solo a nombre propio.
create policy consejos_estado_insert_propio
    on public.consejos_estado
    for insert
    to authenticated
    with check (user_id = (select auth.uid()));

comment on policy consejos_estado_insert_propio on public.consejos_estado is
    'Una cuenta solo puede insertar su propio estado de consejos: user_id tiene que coincidir con auth.uid(). Mismo patrón que consents_insert_propio y push_subscriptions_insert_propias.';

-- UPDATE: solo la fila propia, y sin poder "regalarle" la fila a otra cuenta
-- (el WITH CHECK repite la misma condición sobre la fila resultante).
create policy consejos_estado_update_propio
    on public.consejos_estado
    for update
    to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

comment on policy consejos_estado_update_propio on public.consejos_estado is
    'Una cuenta solo puede actualizar su propia fila, y el UPDATE no puede reasignarla a otra cuenta (USING y WITH CHECK con la misma condición). Cubre el caso de "posponer" después de "descartar" o viceversa sobre el mismo consejo.';

-- SIN POLÍTICA DE DELETE: ver el encabezado de la migración (privilegio ni
-- siquiera concedido, esta es la segunda capa).

-- Fin de la migración.
