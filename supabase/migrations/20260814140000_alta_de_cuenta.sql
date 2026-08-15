-- =============================================================================
-- Historial Médico — Migración 20260814140000: el alta de cuenta crea el perfil
-- propio y los consentimientos (HOTFIX de producción)
-- -----------------------------------------------------------------------------
-- ── EL BUG QUE ARREGLA (reportado por una persona real, no por un test)
--
-- Hasta esta migración, `registrarse` (`app/(auth)/actions.ts`) creaba la fila
-- de `profiles` y las dos de `consents` DESPUÉS del `signUp`, usando la sesión
-- que ese mismo `signUp` devuelve. En LOCAL eso funciona porque
-- `supabase/config.toml` tiene `[auth.email] enable_confirmations = false`: el
-- alta autoconfirma, `data.session` viene con token y el `insert` viaja
-- autenticado, que es lo que exigen `profiles_insert_propio_o_gestionado` y
-- `consents_insert_propio` (ambas piden `user_id = auth.uid()`).
--
-- En PRODUCCIÓN la confirmación por correo está ENCENDIDA. Ahí `signUp`
-- devuelve `data.session = null`: la sesión recién existe cuando la persona
-- toca el enlace del correo, en otra request, sin el `formData` del registro a
-- la vista. El código lo contemplaba a medias —no intentaba el insert, para no
-- estrellarse contra RLS— y le pedía a la persona que confirmara el correo.
-- Pero después de confirmar NADIE creaba el perfil: la cuenta quedaba viva en
-- `auth.users`, sin fila en `profiles` y sin fila en `consents`. Al entrar, el
-- selector de perfiles (`/perfiles`) mostraba "Todavía no hay perfiles
-- disponibles para tu cuenta" y el único botón era "Cerrar sesión". La cuenta
-- existía y era inutilizable.
--
-- Y en el plano legal era peor que un bug de UX: sin las filas de `consents`,
-- la prueba del consentimiento informado que exige la Ley 25.326 (art. 5) —el
-- criterio de aceptación de la tarea 12.1— simplemente no se guardaba.
--
-- ── POR QUÉ LA BASE Y NO LA APLICACIÓN
--
-- La aplicación no puede arreglarlo bien. Las tres alternativas que se
-- descartaron:
--
--   1. **Crear el perfil en el callback de confirmación del correo.** Ese
--      callback hoy no existe (el enlace lleva a `/login`) y, aunque
--      existiera, dependería de que la persona vuelva por ESE enlace. Un
--      login directo posterior —o un magic link, o cualquier flujo futuro de
--      OAuth— dejaría el mismo agujero.
--   2. **Crear el perfil "al primer login que no encuentre uno".** Es lógica
--      de reparación esparcida por el camino caliente de toda sesión, y no
--      tiene de dónde sacar el consentimiento: en ese momento nadie firmó
--      nada, así que la fila de `consents` sería inventada.
--   3. **Escribir con `service_role` desde el server action del alta.** Le da
--      a la aplicación web una clave que puede escribir CUALQUIER fila de
--      CUALQUIER cuenta salteando RLS, para resolver un caso donde la
--      información necesaria ya está en la base. Es exactamente el privilegio
--      que el resto del proyecto evita (ver `lib/legales.ts`: "las dos
--      escriben con el cliente del USUARIO, nunca con service_role").
--
-- El hecho que dispara el alta no es "alguien completó el formulario", es
-- "existe una cuenta nueva". Ese hecho ocurre en `auth.users`, y ahí es donde
-- corresponde engancharlo: un trigger `AFTER INSERT` cubre por construcción
-- TODOS los caminos de creación de cuenta —autoconfirmada, confirmada por
-- correo, invitada, o la que traiga el día de mañana un proveedor OAuth—, sin
-- que ninguno tenga que acordarse de llamar a nada.
--
-- ── DE DÓNDE SALEN LOS DATOS: `raw_user_meta_data`
--
-- `signUp` manda `options.data` y GoTrue lo guarda tal cual en
-- `auth.users.raw_user_meta_data`. `registrarse` pasa ahí:
--
--   · `full_name`       — el nombre que la persona tipeó en el formulario.
--   · `legales_version` — la constante `VERSION_LEGALES` de `lib/legales.ts`
--                         vigente al momento de aceptar.
--
-- Los dos tienen fallback, porque una cuenta puede nacer por fuera del
-- formulario (invitación desde el panel de Supabase, seed, arnés de pruebas) y
-- una cuenta sin perfil es justamente lo que esta migración vino a hacer
-- imposible:
--
--   · sin `full_name` → la parte del correo anterior a la arroba, y si ni eso
--     hubiera, el literal 'Mi perfil'. Nunca cadena vacía: `profiles` tiene el
--     CHECK `profiles_full_name_no_vacio`.
--   · sin `legales_version` → la constante hardcodeada de abajo. Está
--     duplicada respecto de `lib/legales.ts` A PROPÓSITO: la base no puede
--     importar un módulo de TypeScript, y dejar la columna `version` en NULL o
--     en 'desconocida' arruinaría el único dato que le da valor probatorio a
--     la fila. La duplicación está protegida por
--     `tests/unit/alta-de-cuenta.test.ts`, que falla si las dos constantes se
--     separan. **Al cambiar `VERSION_LEGALES` hay que cambiarla también acá,
--     en una migración nueva.**
--
-- ── QUÉ NO HACE EL TRIGGER
--
-- · **No toca los perfiles GESTIONADOS.** Un perfil gestionado tiene
--   `user_id IS NULL` y no nace de una cuenta: lo crea un familiar desde
--   `/familia`, y esa vía sigue exactamente igual. El trigger solo inserta
--   perfiles PROPIOS (`user_id = NEW.id`), que es el caso A de
--   docs/modelo-permisos.md §3.1.
-- · **No completa `created_by_profile_id`.** Un perfil propio no lo crea
--   nadie más: la columna queda NULL, que es lo que su comentario ya declara
--   ("NULL para los perfiles que se autocrean al registrarse una cuenta").
--   `proteger_titularidad_de_perfil` no lo pisa porque
--   `es_sesion_de_usuario()` devuelve FALSE acá: adentro de una función
--   SECURITY DEFINER `current_user` es `postgres` y no hay JWT en la conexión
--   de GoTrue.
-- · **No guarda la IP del consentimiento.** El trigger corre en la base, sin
--   acceso a las cabeceras HTTP. Se pierde un dato accesorio —el propio
--   comentario de `consents.ip` lo llama "el menos importante que lleva" y ya
--   admite NULL— a cambio de que el consentimiento SE GUARDE, que es la
--   diferencia entre tener prueba y no tenerla. No se resuelve pasando la IP
--   por `options.data`: ese objeto queda en `raw_user_meta_data`, que la
--   propia cuenta puede reescribir con `updateUser`, y una prueba falsificable
--   por el interesado no es una prueba.
--
-- ── SI EL TRIGGER FALLA, EL ALTA FALLA (y está bien)
--
-- La función no atrapa excepciones. Un error acá aborta la transacción de
-- GoTrue y la cuenta no se crea: la persona ve un error y puede volver a
-- intentar. La alternativa —tragarse el error y devolver NULL— reproduce
-- exactamente el bug que esta migración arregla, pero en silencio y sin
-- reporte. Entre "no pudiste registrarte" y "te registraste y tu cuenta no
-- sirve", la primera es infinitamente preferible.
--
-- ── BACKFILL
--
-- La migración repara además las cuentas que YA quedaron rotas —al menos una
-- real en producción— con la misma función que usa el trigger. Ver §3.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema, igual que el resto del
-- proyecto.
-- =============================================================================


-- =============================================================================
-- 1. LA FUNCIÓN QUE COMPLETA EL ALTA
-- -----------------------------------------------------------------------------
-- Está separada del trigger a propósito. Tiene TRES llamadores y ninguno puede
-- tener una copia distinta de la regla:
--
--   1. el trigger de §2, en cada cuenta nueva;
--   2. el backfill de §3, sobre las cuentas que ya estaban rotas;
--   3. `scripts/test-rls.sql` BLOQUE 19, que la llama dos veces seguidas para
--      demostrar que es idempotente.
--
-- Una función de trigger no se puede invocar a mano (Postgres exige contexto
-- de trigger), así que sin esta separación el backfill y el arnés tendrían que
-- reescribir el mismo INSERT — y la lección de las migraciones anteriores es
-- que dos copias de una regla se separan.
--
-- `SECURITY DEFINER` porque el llamador natural es GoTrue (`supabase_auth_admin`),
-- que no tiene privilegios sobre `public.profiles` ni sobre `public.consents`,
-- y porque en el momento del alta todavía no hay `auth.uid()` con el cual
-- satisfacer las políticas de INSERT de esas dos tablas. `set search_path = ''`
-- por la misma razón que en todo el proyecto: una función DEFINER con
-- `search_path` heredado es escalable por quien pueda crear objetos en un
-- esquema del path.
--
-- IDEMPOTENTE, y no de adorno: es lo que permite que el backfill se pueda
-- correr de nuevo sin fabricar perfiles duplicados ni un segundo
-- consentimiento a nombre de alguien que ya firmó (lección de 948fe4a).
--   · `profiles`  → `on conflict (user_id) do nothing`, sobre la constraint
--     `profiles_user_id_unico` que ya existía.
--   · `consents`  → `where not exists`, porque la tabla NO tiene constraint
--     única y no debe tenerla: firmar una versión nueva del mismo documento es
--     una fila más, legítima. La guarda es por (cuenta, documento), no por
--     (cuenta, documento, versión): si la cuenta ya firmó privacidad, el alta
--     no tiene nada que agregar aunque la versión vigente haya cambiado.
-- =============================================================================

create or replace function public.completar_alta_de_cuenta(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    -- Espejo de VERSION_LEGALES (lib/legales.ts). Ver "DE DÓNDE SALEN LOS
    -- DATOS" en el encabezado: se usa solo cuando la cuenta no nació del
    -- formulario de registro y por lo tanto no trae `legales_version`.
    k_version_legales constant text := '2026-08-14-v1';

    v_nombre      text;
    v_version     text;
    v_aceptado_en timestamptz;
begin
    select
        -- El nombre del formulario; si no vino, la parte local del correo; si
        -- ni eso, un literal. Nunca vacío: lo prohíbe profiles_full_name_no_vacio.
        coalesce(
            nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
            nullif(btrim(split_part(coalesce(u.email, ''), '@', 1)), ''),
            'Mi perfil'
        ),
        coalesce(
            nullif(btrim(u.raw_user_meta_data ->> 'legales_version'), ''),
            k_version_legales
        ),
        -- CUÁNDO se aceptó es el momento en que nació la cuenta, no el momento
        -- en que corre esta función. En el trigger las dos cosas coinciden; en
        -- el backfill NO, y fechar hoy un consentimiento que se dio hace días
        -- sería falsear el registro probatorio. `coalesce` porque
        -- `auth.users.created_at` es nullable y un INSERT directo por SQL
        -- (seed, arnés) puede no completarlo.
        coalesce(u.created_at, now())
    into v_nombre, v_version, v_aceptado_en
    from auth.users u
    where u.id = p_user_id;

    if not found then
        raise exception
            'No existe la cuenta % en auth.users: no hay alta que completar.', p_user_id
            using errcode = 'foreign_key_violation';
    end if;

    -- El perfil PROPIO (caso A de docs/modelo-permisos.md §3.1). `role` es
    -- 'admin' porque quien se registra con cuenta propia es, por definición
    -- del modelo, titular y administrador de su propio perfil — el mismo valor
    -- que ponía el `insert` que este trigger reemplaza. Recordar que
    -- `profiles.role` es DESCRIPTIVO y no otorga nada (§2 del mismo documento):
    -- la autoridad sobre el perfil sale de ser su titular, no de esta columna.
    insert into public.profiles (user_id, full_name, role)
    values (p_user_id, v_nombre, 'admin')
    on conflict (user_id) do nothing;

    -- Los DOS documentos que se firman juntos al registrarse
    -- (DOCUMENTOS_DE_ALTA en lib/legales.ts). `ip` queda NULL: ver "QUÉ NO
    -- HACE EL TRIGGER" en el encabezado.
    insert into public.consents (user_id, document, version, accepted_at)
    select p_user_id, d.documento, v_version, v_aceptado_en
    from (values ('privacidad'), ('terminos')) as d (documento)
    where not exists (
        select 1
        from public.consents c
        where c.user_id = p_user_id
          and c.document = d.documento
    );
end;
$$;

comment on function public.completar_alta_de_cuenta(uuid) is
    'Crea, de forma idempotente, todo lo que una cuenta nueva necesita para poder usar la aplicación: su perfil propio (user_id = la cuenta, role admin) y las dos filas de consents (privacidad y términos) con la versión que viaje en raw_user_meta_data.legales_version. La llaman el trigger auth_users_crear_perfil_de_cuenta, el backfill de su misma migración y el BLOQUE 19 de scripts/test-rls.sql. SECURITY DEFINER porque corre en el alta, cuando todavía no hay auth.uid() que satisfaga las políticas de INSERT de esas dos tablas.';

-- Nadie la llama desde una sesión de usuario: el trigger la invoca como
-- definer y el backfill como parte de la migración. Se revoca el EXECUTE que
-- Postgres concede a PUBLIC por defecto —si no, cualquier sesión autenticada
-- podría dispararla contra el uuid de otra cuenta—.
revoke execute on function public.completar_alta_de_cuenta(uuid) from public;
grant  execute on function public.completar_alta_de_cuenta(uuid) to service_role;


-- =============================================================================
-- 2. EL TRIGGER SOBRE auth.users
-- -----------------------------------------------------------------------------
-- `AFTER INSERT` y no `BEFORE`: el perfil y el consentimiento apuntan por FK a
-- `auth.users.id`, así que la fila de la cuenta tiene que existir antes. Corre
-- en la MISMA transacción que el INSERT de GoTrue, de modo que cuando `signUp`
-- responde el perfil ya está — es lo que hace que en local (autoconfirm) el
-- redirect inmediato a `/perfiles` encuentre el perfil recién creado, y lo que
-- hace que en producción la persona lo encuentre después de confirmar el
-- correo, sin ningún paso extra.
--
-- Devuelve NULL porque en un trigger AFTER ... FOR EACH ROW el valor de
-- retorno se ignora (mismo criterio que `encolar_purga_storage`).
--
-- NO se condiciona a "que el INSERT venga de GoTrue" (por ejemplo mirando
-- `current_user = 'supabase_auth_admin'`). Sería una optimización para que el
-- seed y el arnés no tuvieran que acomodarse, y a cambio dejaría el arreglo
-- colgando de un nombre de rol interno de Supabase: si ese nombre cambiara, el
-- trigger dejaría de crear perfiles EN SILENCIO y volveríamos exactamente a
-- este bug. Se prefiere que dispare siempre y que los fixtures se adapten
-- (lo hacen: supabase/seed.sql §2 y scripts/test-rls.sql).
-- =============================================================================

create or replace function public.crear_perfil_de_cuenta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.completar_alta_de_cuenta(new.id);
    return null;
end;
$$;

comment on function public.crear_perfil_de_cuenta() is
    'Trigger AFTER INSERT sobre auth.users: le crea a cada cuenta nueva su perfil propio y sus dos consentimientos de alta, delegando en completar_alta_de_cuenta. Existe porque en producción el signUp no devuelve sesión (confirmación por correo) y la aplicación no puede escribir esas filas bajo RLS: sin este trigger la cuenta queda creada, sin perfil y sin prueba de consentimiento.';

revoke execute on function public.crear_perfil_de_cuenta() from public;

-- El EXECUTE de una función de trigger se verifica al CREAR el trigger, no al
-- dispararlo, así que este grant es defensivo. Se hace igual —y guardado por
-- la existencia del rol, para que la migración no se caiga en un entorno que
-- no lo tenga— porque el costo es cero y el modo de falla que evita es que
-- nadie pueda registrarse en producción.
do $$
begin
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'supabase_auth_admin') then
        execute 'grant execute on function public.crear_perfil_de_cuenta() to supabase_auth_admin';
    end if;
end;
$$;

-- `auth.users` NO es de `postgres`: la tiene `supabase_auth_admin`. El rol que
-- corre las migraciones tiene el privilegio TRIGGER sobre ella (alcanza para
-- CREATE TRIGGER, que es lo que pide el manual), pero NO es su dueño — y eso
-- descarta dos cosas que en cualquier otra tabla del proyecto se darían por
-- sentadas:
--
--   · `drop trigger if exists ... on auth.users` antes del create, el patrón
--     de idempotencia habitual. DROP TRIGGER exige ser dueño de la tabla.
--     Se reemplaza por el `if not exists` de abajo, que consigue lo mismo sin
--     pedir un privilegio que no tenemos.
--   · `comment on trigger ... on auth.users`. También exige ser dueño (falla
--     con 42501). La explicación queda entonces en este comentario de SQL, no
--     en el catálogo: cada cuenta nueva nace con su perfil propio y su
--     consentimiento registrado, por TODOS los caminos de alta —autoconfirmada,
--     confirmada por correo, invitada— y no solo por el formulario de
--     `/registro`. La función SÍ lleva `comment on function`, que es donde
--     alguien que audite el esquema va a buscar el porqué.
do $$
begin
    if not exists (
        select 1
        from pg_catalog.pg_trigger
        where tgrelid = 'auth.users'::regclass
          and tgname = 'auth_users_crear_perfil_de_cuenta'
          and not tgisinternal
    ) then
        execute 'create trigger auth_users_crear_perfil_de_cuenta'
             || ' after insert on auth.users'
             || ' for each row execute function public.crear_perfil_de_cuenta()';
    end if;
end;
$$;


-- =============================================================================
-- 3. BACKFILL — las cuentas que ya quedaron rotas
-- -----------------------------------------------------------------------------
-- El trigger arregla de acá en adelante. Esta sección arregla lo que ya pasó:
-- en producción hay al menos una cuenta real que confirmó su correo, inició
-- sesión y se encontró con "Todavía no hay perfiles disponibles para tu
-- cuenta". Sin este bloque seguiría rota después del deploy.
--
-- Corre sobre TODAS las cuentas, no solo sobre las que se sabe rotas, porque
-- `completar_alta_de_cuenta` es idempotente: para una cuenta sana no hace
-- nada. Es la forma de no tener que adivinar cuáles están mal.
--
-- ── SOBRE COMPLETAR EL CONSENTIMIENTO DE ALGUIEN QUE NO ESTÁ MIRANDO
--
-- Merece justificarse, porque `consents` es un registro PROBATORIO y llenarlo
-- por su titular sería falsificarlo. No lo es acá: el único camino de alta que
-- existe hoy es `/registro`, y ese camino ya exige el checkbox de
-- consentimiento y lo REVALIDA en el servidor (`registrarse` rechaza el alta
-- sin él, y `tests/unit/registro-consentimiento.test.ts` lo prueba). O sea:
-- estas personas SÍ aceptaron; lo que falló fue el registro de esa aceptación.
-- El backfill escribe la constancia de un hecho ocurrido, no un hecho nuevo —
-- y por eso `accepted_at` es `auth.users.created_at` (el momento real en que
-- aceptaron) y no `now()`, y por eso la fila no lleva IP: no se inventa un
-- dato que nadie capturó.
-- =============================================================================

do $$
declare
    r                  record;
    v_perfiles_creados integer;
    v_consents_creados integer;
    v_perfiles_antes   integer;
    v_consents_antes   integer;
begin
    select count(*) into v_perfiles_antes from public.profiles where user_id is not null;
    select count(*) into v_consents_antes from public.consents;

    for r in select u.id from auth.users u order by u.created_at nulls first, u.id loop
        perform public.completar_alta_de_cuenta(r.id);
    end loop;

    select count(*) - v_perfiles_antes into v_perfiles_creados
      from public.profiles where user_id is not null;
    select count(*) - v_consents_antes into v_consents_creados
      from public.consents;

    raise notice
        'Backfill del alta de cuenta: % perfil(es) propio(s) y % consentimiento(s) creados sobre cuentas preexistentes.',
        v_perfiles_creados, v_consents_creados;
end;
$$;

-- Fin de la migración.
