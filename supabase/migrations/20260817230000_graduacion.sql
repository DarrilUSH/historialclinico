-- =============================================================================
-- Historial Médico — Migración 20260817230000: graduación de perfiles
-- gestionados (Sprint 15, tarea 15.2)
-- -----------------------------------------------------------------------------
-- Un perfil gestionado (`profiles.user_id IS NULL`, caso B de
-- docs/modelo-permisos.md §3.2) es el historial de una persona que no entra a
-- la aplicación: un chico, o alguien mayor sin email. La GRADUACIÓN es el
-- momento en que esa persona pasa a tener cuenta propia y toma el control de
-- sus datos — el escenario que docs/modelo-permisos.md §8.6 dejó escrito
-- desde el Sprint 1 y que hasta hoy no tenía implementación:
--
--     "Roberto se compra un celular y quiere entrar él mismo. La operación es
--      UPDATE profiles SET user_id = <uuid nuevo> WHERE id = p-roberto, y es
--      la única operación del modelo que ningún rol puede hacer desde la
--      aplicación (nota ②)."
--
-- Esta migración construye ese "flujo dedicado, server-side" y cumple los
-- cinco requisitos que la sección enumera:
--
--   1. verifica `profiles.user_id IS NULL` (no se roba un perfil con dueño) →
--      es la cláusula `and user_id is null` del UPDATE de §2, y es una guarda
--      ATÓMICA, no una lectura previa: dos graduaciones simultáneas del mismo
--      perfil no pueden ganar las dos;
--   2. vincula una cuenta RECIÉN CREADA, nunca una preexistente → todo ocurre
--      dentro de la transacción en la que nace la cuenta (§3);
--   3. CONSERVA las filas de `family_permissions` → esta migración no las
--      toca; es además la decisión de producto cerrada con el usuario ("tras
--      la graduación los accesos existentes SE MANTIENEN y el nuevo titular
--      puede revocarlos desde /familia");
--   4. TRANSFIERE la autoridad de otorgamiento al nuevo titular **sola**, sin
--      migrar un solo dato: `puede_otorgar_permisos`, `es_perfil_gestionado` y
--      las notas ⚑ de la matriz leen `user_id IS NULL` en tiempo de consulta,
--      así que dejar de ser NULL les cambia la respuesta en la consulta
--      siguiente. Lo mismo vale para `evitar_perfil_gestionado_huerfano`
--      (20260812210000): el perfil deja de estar bajo su tutela y por eso el
--      nuevo titular SÍ puede revocarle el acceso a quien lo creó;
--   5. la auditoría con acción propia queda declarada como deuda abierta —
--      ver "LO QUE ESTA MIGRACIÓN NO HACE" al final del encabezado.
--
-- ── DE DÓNDE SALE EL PERFIL A VINCULAR: `raw_app_meta_data`, NO `raw_user_meta_data`
--
-- **Este es el punto de seguridad de toda la tarea y es un desvío deliberado
-- de la letra del ROADMAP**, que dice "metadata `perfil_existente: <uuid>`"
-- sin distinguir cuál de las dos metadatas de GoTrue.
--
-- `raw_user_meta_data` es lo que viaja en `options.data` de `signUp` y en
-- `data` de `updateUser`: **lo escribe el propio usuario, desde el navegador,
-- con la clave anónima**. `registrarse` (`app/(auth)/actions.ts`) lo usa para
-- `full_name` y `legales_version`, que son datos declarativos sobre uno mismo
-- y no otorgan nada. Si la graduación leyera de ahí, cualquiera podría
-- registrarse con
--
--     supabase.auth.signUp({ email, password,
--                            options: { data: { perfil_existente: '<uuid ajeno>' } } })
--
-- y adueñarse del historial médico de un perfil gestionado que no es suyo. El
-- `and user_id is null` del UPDATE no lo detiene: los perfiles gestionados
-- son justamente los que tienen `user_id IS NULL`, o sea que la guarda que
-- protege de robar un perfil CON dueño no protege de robar exactamente los
-- que esta tarea viene a proteger. Sería un agujero de escalada de
-- privilegios abierto a internet, y la única barrera restante sería adivinar
-- un uuid v4.
--
-- `raw_app_meta_data` es el mecanismo que GoTrue tiene para lo contrario:
-- claims que el usuario NO puede escribir ni modificar. Solo se puebla desde
-- la Admin API (`auth.admin.createUser({ app_metadata })`), que exige la
-- `service_role`; `signUp` no la acepta y `updateUser` no la toca.
--
-- Consecuencia práctica: un `perfil_existente` que aparezca en
-- `raw_user_meta_data` se IGNORA por completo. Ese alta se procesa como
-- cualquier otra —la cuenta nace con su propio perfil nuevo y sus dos
-- consentimientos— y el perfil ajeno que intentó tomar queda intacto, con su
-- `user_id` en NULL. No se levanta excepción: negarle el alta al atacante le
-- confirmaría que el uuid que probó existe, que es la misma razón por la que
-- `perfil_id_por_email` (20260812240000) contesta neutro. El BLOQUE 21 de
-- `scripts/test-rls.sql` prueba este caso hostil de forma explícita.
--
-- ── CÓMO ESCRIBE GoTrue ESE CLAIM: medido, no supuesto
--
-- La primera versión de esta migración enganchaba la graduación en el trigger
-- de alta que ya existía (`AFTER INSERT ON auth.users`,
-- `20260814140000_alta_de_cuenta.sql`) dando por sentado que el `INSERT` ya
-- traería el `app_metadata` completo. **En el dispositivo real no funcionó**:
-- la cuenta se creaba, el trigger no veía el claim, tomaba el camino normal y
-- le estrenaba un perfil propio en blanco — mientras el perfil gestionado
-- seguía sin dueño. La pantalla decía "listo" y no había pasado nada de lo
-- que decía. Es exactamente el fallo silencioso con apariencia de éxito que
-- este archivo declara inaceptable, y apareció porque el diseño descansaba en
-- una suposición sobre software ajeno.
--
-- Se midió, con dos triggers de diagnóstico sobre `auth.users` que registraban
-- `tg_op`, `txid_current()` y las dos metadatas en cada evento. Un
-- `auth.admin.createUser({ email, password, email_confirm: true,
-- user_metadata, app_metadata })` produce, todo en **una sola transacción**:
--
--     op      tx     raw_app_meta_data                              raw_user_meta_data
--     INSERT  3208   {provider, providers}                          {full_name}
--     UPDATE  3208   {provider, providers}                          {full_name}
--     UPDATE  3208   {provider, providers, perfil_existente: ...}   {full_name}
--     UPDATE  3208   {provider, providers, perfil_existente: ...}   {full_name}
--     UPDATE  3208   {provider, providers, perfil_existente: ...}   {full_name, email_verified}
--
-- Tres hechos que fijan el diseño:
--
--   · **`user_metadata` SÍ viaja en el INSERT; `app_metadata` NO.** Y es la
--     peor combinación posible: la metadata forjable llega temprano y la
--     confiable llega tarde. No hay forma de leer el claim confiable en el
--     `AFTER INSERT`.
--   · **Todo ocurre en la MISMA transacción.** Es lo que permite conservar la
--     garantía que hacía correcto al diseño original: si la vinculación falla,
--     la transacción entera se deshace y la cuenta no llega a existir.
--   · El claim aparece en un `UPDATE` de `raw_app_meta_data`. Ahí se engancha
--     el trigger de §3.
--
-- ── POR QUÉ EL TRIGGER NUEVO TIENE QUE DESHACER EL ALTA AUTOMÁTICA
--
-- Como el `INSERT` no puede saber que esta cuenta viene a graduar a alguien,
-- para cuando el claim aparece el alta normal YA CORRIÓ: la cuenta tiene un
-- perfil propio en blanco y sus dos filas de `consents`. Vincular el perfil
-- gestionado sin tocar eso es imposible —`profiles_user_id_unico` no admite
-- dos perfiles para la misma cuenta— y dejarlo sería peor que imposible:
-- la persona entraría a un selector con dos perfiles, uno vacío, y con un
-- consentimiento a su nombre que nunca dio.
--
-- Así que `vincular_perfil_graduado` deshace ese alta antes de vincular. Lo
-- hace **solo** sobre lo que se creó en ESTA MISMA TRANSACCIÓN, y esa
-- condición se verifica de forma exacta, no aproximada:
--
--     p.created_at = now()
--
-- `profiles.created_at` tiene `DEFAULT now()`, y `now()` en PostgreSQL es
-- `transaction_timestamp()`: es idéntico para todo lo insertado en una misma
-- transacción y distinto para cualquier otra. O sea que la igualdad es
-- verdadera si y solo si esa fila nació acá. No es una ventana de tiempo ni
-- una heurística: un perfil de ayer, o de otra transacción de hace un
-- milisegundo, no la cumple. Si alguien con `service_role` le estampara el
-- claim a una cuenta vieja y en uso, el `delete` no alcanzaría a su perfil
-- —que tiene datos de salud reales— y la operación terminaría rechazada por
-- la guarda "esta cuenta ya tiene un perfil propio" de §2. Falla ruidosa, y
-- ni un byte perdido.
--
-- Los dos `consents` de esa alta se borran junto con el perfil, y no es una
-- excepción a que la tabla sea append-only: no son la constancia de nada. Los
-- escribió un trigger 13 milisegundos antes, a nombre de alguien que nunca
-- vio los documentos y que todavía no inició sesión ni una vez. Dejarlos
-- serviría para una sola cosa: satisfacer en falso el gate de
-- `/aceptar-terminos` y hacer que el nuevo titular use la aplicación sin
-- haber aceptado nada — que es justo lo que la tarea 15.2 viene a impedir.
--
-- ── QUÉ PASA CUANDO LA VINCULACIÓN NO SE PUEDE HACER
--
-- La regla de oro tiene dos mitades y las dos son duras:
--
--   (a) un alta con metadata rota **no puede dejar una cuenta sin poder
--       entrar** —el bug del hotfix de agosto, que dejó a una persona real
--       con una cuenta viva e inservible—;
--   (b) un alta con metadata rota **no puede robar un perfil ajeno**.
--
-- La salida que satisface las dos a la vez es **abortar el alta**: la
-- excepción viaja por la misma transacción de GoTrue, todo se deshace y **la
-- cuenta no llega a existir**. No queda nadie afuera de su cuenta, porque no
-- hay cuenta; y no se toca ni un perfil ajeno. La alternativa —dejar el
-- perfil en blanco que el INSERT ya creó— dejaría a quien graduó creyendo que
-- su hijo ya tiene acceso a SU historial cuando en realidad tendría una
-- cuenta nueva y vacía, y el historial real seguiría sin dueño. Es
-- literalmente el bug que se encontró probando en el teléfono.
--
-- ── EL CONSENTIMIENTO DEL NUEVO TITULAR **NO** SE FIRMA ACÁ
--
-- Hasta la graduación rige el consentimiento del REPRESENTANTE
-- (`acceso_familiar_representante`, tarea 15.1): quien creó el perfil declaró
-- tener la representación legal de esa persona. Ese documento no se
-- transfiere: dice algo sobre el representante, no sobre el representado.
--
-- El nuevo titular tiene que aceptar la Política de Privacidad y los Términos
-- **él mismo**, y lo hace en su primer ingreso, en el gate
-- `/aceptar-terminos` (`app/(auth)/aceptar-terminos/`), que escribe las dos
-- filas de `consents` con SU `user_id` y con la versión que él tuvo a la
-- vista. Sellarlas acá, en nombre de alguien que todavía no inició sesión ni
-- una vez, sería fabricar la prueba de un hecho que no ocurrió — exactamente
-- lo que el backfill de `20260814140000` §3 se cuidó de NO hacer (ahí las
-- personas SÍ habían aceptado y solo faltaba la constancia; acá no aceptó
-- nadie todavía).
--
-- Por eso tampoco viaja `legales_version` en la metadata de la cuenta
-- graduada: guardar en `auth.users` la versión "vigente al graduar" invitaría
-- a que alguien, más adelante, la use para sellar un consentimiento que su
-- titular nunca dio.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE
--
-- · **No toca el trigger `auth_users_crear_perfil_de_cuenta` ni la función
--   `crear_perfil_de_cuenta()`.** `auth.users` es de `supabase_auth_admin` y
--   no de `postgres`: el rol que corre las migraciones puede `CREATE TRIGGER`
--   sobre ella pero NO `DROP TRIGGER` ni `COMMENT ON TRIGGER` (los dos fallan
--   con 42501) — lección documentada en `20260814140000_alta_de_cuenta.sql`
--   §2 y en docs/estado-proyecto.md. El trigger nuevo de §3 se AGREGA con el
--   mismo patrón `if not exists`.
--
-- · **No cambia `profiles.role`.** El perfil graduado conserva el `role` con
--   el que se creó (`family_member`, el DEFAULT). La columna es DESCRIPTIVA y
--   no otorga absolutamente nada (docs/modelo-permisos.md §2 y el criterio de
--   verificación de su §11: ninguna política puede nombrarla), la interfaz no
--   la muestra en ningún lado, y la autoridad del nuevo titular sale de
--   `user_id`, no de acá.
--
-- · **No borra ni degrada ninguna fila de `family_permissions`.** Decisión de
--   producto cerrada con el usuario: los accesos se MANTIENEN y es el nuevo
--   titular quien decide desde `/familia` cuáles conserva.
--
-- · **No agrega un literal al enum `access_action`.** El punto 5 de §8.6 pide
--   auditar la graduación con una acción propia. Queda DECLARADO COMO DEUDA
--   ABIERTA, y no por olvido: hoy `otorgar_permiso` y `revocar_permiso` —los
--   dos literales que el enum SÍ tiene para este ABM— tampoco se escriben
--   desde ninguna parte (ver la tabla "Dónde se llama" de `lib/auditoria.ts`),
--   así que agregar un tercero solo para esta operación produciría una lista
--   de accesos que muestra la graduación y sigue sin mostrar los
--   otorgamientos. Mientras tanto el hecho queda registrado igual, y de forma
--   no falsificable, en tres lugares: `profiles.created_by_profile_id`
--   (quién había creado el perfil, sellado por trigger y sobreviviente a la
--   graduación), `auth.users.created_at` de la cuenta nueva (cuándo) y su
--   `raw_app_meta_data.perfil_existente` (qué perfil vino a tomar).
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema, igual que el resto
-- del proyecto.
-- =============================================================================


-- =============================================================================
-- 1. `vincular_perfil_graduado(cuenta, claim)` — la operación de §8.6
-- -----------------------------------------------------------------------------
-- Está separada del trigger a propósito, por el mismo motivo que
-- `completar_alta_de_cuenta` lo está del suyo: tiene DOS llamadores que no
-- pueden tener copias distintas de la regla.
--
--   1. el trigger de §3, que es el camino real de hoy (el claim llega en un
--      `UPDATE` posterior al `INSERT`, ver el encabezado);
--   2. `completar_alta_de_cuenta` (§2), para el caso en que el claim YA venga
--      en el `INSERT`. Hoy GoTrue no lo hace, pero si una versión futura lo
--      hiciera, la graduación seguiría funcionando —y sin crear ningún perfil
--      en blanco que después haya que deshacer—. Que las dos formas estén
--      cubiertas es lo que hace que esta migración no vuelva a depender de un
--      detalle interno de software ajeno.
--
-- Y un tercer llamador de hecho: el BLOQUE 21 de `scripts/test-rls.sql`, que
-- prueba las dos formas.
--
-- `SECURITY DEFINER` porque el llamador es GoTrue (`supabase_auth_admin`), que
-- no tiene privilegios sobre `public.profiles` ni sobre `public.consents`, y
-- porque en el alta todavía no hay `auth.uid()` con el cual satisfacer sus
-- políticas. `set search_path = ''` por la razón de siempre: una función
-- DEFINER con `search_path` heredado es escalable por quien pueda crear
-- objetos en un esquema del path.
--
-- El UPDATE de `profiles.user_id` pasa por delante del trigger
-- `profiles_proteger_titularidad` (`20260812220000_rls.sql` §2.1), que existe
-- justamente para prohibir esta escritura. No la bloquea acá porque ese
-- trigger es `SECURITY INVOKER` y su guarda es `es_sesion_de_usuario()`:
-- adentro de esta función, invocada por GoTrue, `current_user` es el dueño de
-- la función (no 'authenticated' ni 'anon') y `auth.uid()` es NULL (la
-- conexión de GoTrue no lleva JWT), así que el trigger devuelve `new` sin
-- mirar nada. Es exactamente la excepción que su propio COMMENT anticipa:
-- "La transición de perfil gestionado a perfil con cuenta (sección 8.6) es un
-- flujo server-side dedicado, no una edición". Desde una sesión de usuario la
-- prohibición sigue en pie, intacta, y el BLOQUE 21 lo vuelve a probar.
-- =============================================================================

create or replace function public.vincular_perfil_graduado(
    p_user_id uuid,
    p_perfil  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    -- Forma de un uuid, verificada ANTES de castear. Un `::uuid` sobre basura
    -- levanta 22P02 con un mensaje de Postgres en inglés y sin contexto; acá
    -- se prefiere fallar con un mensaje propio que diga qué cuenta y qué
    -- valor, porque este error solo puede llegar de un llamador con
    -- `service_role` y quien lo lea va a estar depurando una integración.
    k_patron_uuid constant text :=
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

    v_perfil_id  uuid;
    v_vinculados integer;
begin
    if p_perfil !~* k_patron_uuid then
        raise exception
            'La cuenta % declara graduar el perfil "%", que no tiene forma de identificador válido. El alta se cancela: una cuenta a medio vincular no puede quedar creada.',
            p_user_id, p_perfil
            using errcode = 'invalid_parameter_value';
    end if;

    v_perfil_id := p_perfil::uuid;

    -- Ya estaba vinculado a ESTA cuenta: una pasada anterior lo hizo. Va
    -- primero de todo, antes de tocar nada, para que repetir la operación sea
    -- un no-op de verdad. Es lo que mantiene idempotente a
    -- `completar_alta_de_cuenta`, contrato del que dependen el backfill de
    -- 20260814140000 §3 y el BLOQUE 19 del arnés.
    if exists (
        select 1 from public.profiles p
         where p.id = v_perfil_id and p.user_id = p_user_id
    ) then
        return;
    end if;

    -- ── DESHACER el alta automática que el INSERT ya corrió en esta misma
    --    transacción. `created_at = now()` es exacto: `now()` es
    --    `transaction_timestamp()` y `profiles.created_at` lo toma como
    --    DEFAULT, así que la igualdad se cumple si y solo si la fila nació en
    --    esta transacción. Ver el encabezado.
    --
    --    `created_by_profile_id is null` es la segunda cinta del cinturón: el
    --    perfil que crea el alta no lo creó nadie más, y un perfil gestionado
    --    (que siempre tiene creador) no puede entrar acá ni por accidente.
    if exists (
        select 1 from public.profiles p
         where p.user_id = p_user_id
           and p.id <> v_perfil_id
           and p.created_at = now()
           and p.created_by_profile_id is null
    ) then
        -- Los dos consentimientos de esa alta. No son constancia de nada: los
        -- escribió el trigger a nombre de alguien que nunca vio los
        -- documentos. Dejarlos satisfaría en falso el gate de
        -- /aceptar-terminos. Ver el encabezado.
        delete from public.consents c
         where c.user_id = p_user_id
           and c.document in ('privacidad', 'terminos');

        delete from public.profiles p
         where p.user_id = p_user_id
           and p.id <> v_perfil_id
           and p.created_at = now()
           and p.created_by_profile_id is null;
    end if;

    -- Si después de eso la cuenta TODAVÍA tiene un perfil propio, no es una
    -- cuenta recién nacida: es una cuenta en uso a la que alguien le estampó
    -- el claim. Se rechaza en vez de tocarle nada.
    if exists (select 1 from public.profiles p where p.user_id = p_user_id) then
        raise exception
            'La cuenta % ya tiene un perfil propio: no se la puede vincular al perfil %.',
            p_user_id, v_perfil_id
            using errcode = 'insufficient_privilege';
    end if;

    -- LA operación de §8.6, con su guarda ATÓMICA. `user_id is null` no se
    -- consulta antes y se decide después: se evalúa dentro del mismo UPDATE,
    -- de modo que dos graduaciones simultáneas del mismo perfil no pueden
    -- ganar las dos (la segunda encuentra la fila ya escrita y afecta 0
    -- filas). Es la diferencia entre una verificación y una garantía.
    update public.profiles
       set user_id = p_user_id
     where id = v_perfil_id
       and user_id is null;

    get diagnostics v_vinculados = row_count;

    if v_vinculados = 1 then
        return;
    end if;

    -- Queda el caso que de verdad importa: el perfil no existe, o existe y YA
    -- TIENE DUEÑO. Se aborta la transacción entera —la cuenta no llega a
    -- crearse— en vez de dejar el perfil en blanco que aparentaría éxito.
    raise exception
        'El perfil % no se puede vincular a la cuenta %: no existe, o ya tiene una cuenta propia. El alta se cancela.',
        v_perfil_id, p_user_id
        using errcode = 'insufficient_privilege';
end;
$$;

comment on function public.vincular_perfil_graduado(uuid, text) is
    'GRADUACIÓN (Sprint 15, tarea 15.2; docs/modelo-permisos.md §8.6): vincula un perfil GESTIONADO a una cuenta recién creada (update profiles set user_id ... where id = <perfil> and user_id is null), deshaciendo antes el alta automática que el trigger de INSERT ya había corrido en la MISMA transacción -su perfil propio en blanco y sus dos consents, identificados de forma exacta con created_at = now(), que en PostgreSQL es transaction_timestamp()-. NO firma ningún consentimiento: el nuevo titular acepta los documentos él mismo en /aceptar-terminos. Si la vinculación no se puede hacer (perfil inexistente, con dueño, o cuenta que ya tenía perfil propio de otra transacción) levanta excepción y la transacción entera se deshace: no queda una cuenta a medio vincular ni se toca un perfil ajeno. La llaman el trigger auth_users_vincular_perfil_graduado (el camino real: GoTrue escribe app_metadata en un UPDATE posterior al INSERT, medido) y completar_alta_de_cuenta (por si una versión futura lo trajera ya en el INSERT).';

revoke execute on function public.vincular_perfil_graduado(uuid, text) from public;
grant  execute on function public.vincular_perfil_graduado(uuid, text) to service_role;


-- =============================================================================
-- 2. `completar_alta_de_cuenta` con la rama de graduación
-- -----------------------------------------------------------------------------
-- Reemplaza a la versión de `20260814140000_alta_de_cuenta.sql`. El camino
-- normal —cuenta nueva sin `perfil_existente`— queda IDÉNTICO: mismo INSERT en
-- `profiles`, mismo `on conflict (user_id) do nothing`, mismos dos `consents`
-- con el mismo `where not exists`, mismos fallbacks de `full_name` y
-- `legales_version`, misma constante espejo de `VERSION_LEGALES`. El BLOQUE 19
-- del arnés (que prueba ese camino, sus fallbacks y su idempotencia) tiene que
-- seguir pasando sin tocarle una línea, y es la forma de verificar que esta
-- migración no cambió lo que no vino a cambiar.
--
-- Lo único que se suma es la rama de graduación, que HOY NO SE EJECUTA NUNCA
-- desde GoTrue: en el `INSERT` el `app_metadata` todavía no trae el claim (ver
-- la medición del encabezado). Está igual porque es barata y porque es lo que
-- evita que esta migración vuelva a depender de un detalle interno de
-- software ajeno: si mañana GoTrue incluyera `app_metadata` en el `INSERT`, la
-- graduación pasaría por acá y ni siquiera haría falta deshacer nada. El
-- BLOQUE 21 prueba las dos formas.
-- =============================================================================

create or replace function public.completar_alta_de_cuenta(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    -- Espejo de VERSION_LEGALES (lib/legales.ts). Ver "DE DÓNDE SALEN LOS
    -- DATOS" en el encabezado de 20260814140000_alta_de_cuenta.sql: se usa
    -- solo cuando la cuenta no nació del formulario de registro y por lo
    -- tanto no trae `legales_version`.
    k_version_legales constant text := '2026-08-14-v1';

    v_nombre            text;
    v_version           text;
    v_aceptado_en       timestamptz;
    v_perfil_a_vincular text;
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
        coalesce(u.created_at, now()),
        -- GRADUACIÓN (Sprint 15, tarea 15.2). `raw_app_meta_data` y NO
        -- `raw_user_meta_data`: ver "DE DÓNDE SALE EL PERFIL A VINCULAR" en
        -- el encabezado. Esta columna solo la escribe la Admin API con
        -- `service_role`; el usuario no puede tocarla ni al registrarse ni
        -- después con `updateUser`.
        nullif(btrim(u.raw_app_meta_data ->> 'perfil_existente'), '')
    into v_nombre, v_version, v_aceptado_en, v_perfil_a_vincular
    from auth.users u
    where u.id = p_user_id;

    if not found then
        raise exception
            'No existe la cuenta % en auth.users: no hay alta que completar.', p_user_id
            using errcode = 'foreign_key_violation';
    end if;

    -- Esta cuenta viene a hacerse cargo de un perfil que YA EXISTE: no se crea
    -- ninguno nuevo y no se firma ningún consentimiento (lo firma su titular
    -- en /aceptar-terminos).
    if v_perfil_a_vincular is not null then
        perform public.vincular_perfil_graduado(p_user_id, v_perfil_a_vincular);
        return;
    end if;

    -- =========================================================================
    -- CAMINO NORMAL (idéntico al de 20260814140000): la cuenta estrena perfil.
    -- =========================================================================

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
    -- HACE EL TRIGGER" en el encabezado de 20260814140000.
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
    'Crea, de forma idempotente, todo lo que una cuenta nueva necesita para poder usar la aplicación: su perfil propio (user_id = la cuenta, role admin) y las dos filas de consents (privacidad y términos) con la versión que viaje en raw_user_meta_data.legales_version. Desde el Sprint 15 (tarea 15.2) tiene además una rama de GRADUACIÓN: si raw_app_meta_data trae perfil_existente, delega en vincular_perfil_graduado() y no crea nada. Esa rama hoy no se ejecuta desde GoTrue -en el INSERT el app_metadata todavía no trae el claim, que llega en un UPDATE posterior de la misma transacción; de eso se ocupa el trigger auth_users_vincular_perfil_graduado- y existe para que la graduación siga funcionando si una versión futura lo incluyera en el INSERT. La llaman el trigger auth_users_crear_perfil_de_cuenta, el backfill de 20260814140000 y los BLOQUES 19 y 21 de scripts/test-rls.sql. SECURITY DEFINER porque corre en el alta, cuando todavía no hay auth.uid() que satisfaga las políticas de INSERT de esas dos tablas.';

-- Se repiten los privilegios: `create or replace function` conserva los grants
-- existentes, pero declararlos acá deja la migración completa por sí sola.
revoke execute on function public.completar_alta_de_cuenta(uuid) from public;
grant  execute on function public.completar_alta_de_cuenta(uuid) to service_role;


-- =============================================================================
-- 3. EL TRIGGER: `AFTER UPDATE OF raw_app_meta_data ON auth.users`
-- -----------------------------------------------------------------------------
-- Es el camino real de la graduación, por lo que se midió (ver el encabezado):
-- `auth.admin.createUser` inserta la fila SIN el `app_metadata` propio y lo
-- agrega en un `UPDATE` posterior, dentro de la MISMA transacción. Enganchar
-- ahí conserva la garantía entera: si la vinculación falla, la transacción de
-- GoTrue se deshace y la cuenta no llega a existir.
--
-- La cláusula `WHEN` hace todo el filtrado, y hace falta que sea así: este
-- trigger corre en CADA update de `raw_app_meta_data` de CUALQUIER cuenta —un
-- cambio de proveedor de login, un `ban`, lo que sea—. Solo dispara cuando el
-- claim **aparece**, es decir cuando `new` lo tiene y `old` no. Un update que
-- no lo toca, o que lo deja igual, ni siquiera invoca la función.
--
-- `AFTER UPDATE OF raw_app_meta_data` (con lista de columnas) es una segunda
-- criba, más barata todavía: un update de `last_sign_in_at` no llega ni a
-- evaluar el `WHEN`.
--
-- Devuelve NULL porque en un trigger AFTER ... FOR EACH ROW el valor de
-- retorno se ignora (mismo criterio que `crear_perfil_de_cuenta`).
-- =============================================================================

create or replace function public.vincular_perfil_graduado_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.vincular_perfil_graduado(
        new.id,
        btrim(new.raw_app_meta_data ->> 'perfil_existente'));
    return null;
end;
$$;

comment on function public.vincular_perfil_graduado_trigger() is
    'Trigger AFTER UPDATE OF raw_app_meta_data sobre auth.users: cuando aparece el claim perfil_existente -que solo puede escribir la Admin API con service_role-, vincula ese perfil gestionado a la cuenta, delegando en vincular_perfil_graduado. Existe porque GoTrue escribe el app_metadata propio en un UPDATE posterior al INSERT y en la misma transacción (medido con triggers de diagnóstico, ver el encabezado de 20260817230000_graduacion.sql): en el AFTER INSERT el claim todavía no está, y el trigger de alta le estrena a la cuenta un perfil propio en blanco que este trigger deshace antes de vincular.';

revoke execute on function public.vincular_perfil_graduado_trigger() from public;

-- El EXECUTE de una función de trigger se verifica al CREAR el trigger, no al
-- dispararlo, así que este grant es defensivo. Se hace igual —y guardado por
-- la existencia del rol, para que la migración no se caiga en un entorno que
-- no lo tenga— porque el costo es cero y el modo de falla que evita es que
-- nadie pueda graduar a nadie en producción.
do $$
begin
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'supabase_auth_admin') then
        execute 'grant execute on function public.vincular_perfil_graduado_trigger() to supabase_auth_admin';
    end if;
end;
$$;

-- `auth.users` NO es de `postgres`: la tiene `supabase_auth_admin`. El rol que
-- corre las migraciones tiene el privilegio TRIGGER sobre ella (alcanza para
-- CREATE TRIGGER) pero NO es su dueño, así que ni `drop trigger if exists`
-- antes del create ni `comment on trigger` son posibles (los dos fallan con
-- 42501). Mismo patrón `if not exists` que usa
-- `20260814140000_alta_de_cuenta.sql` §2 para el trigger de alta; la
-- explicación vive en el `comment on function` de arriba, que es donde alguien
-- que audite el esquema la va a buscar.
do $$
begin
    if not exists (
        select 1
        from pg_catalog.pg_trigger
        where tgrelid = 'auth.users'::regclass
          and tgname = 'auth_users_vincular_perfil_graduado'
          and not tgisinternal
    ) then
        execute 'create trigger auth_users_vincular_perfil_graduado'
             || ' after update of raw_app_meta_data on auth.users'
             || ' for each row'
             || ' when ('
             || '     new.raw_app_meta_data ->> ''perfil_existente'' is not null'
             || '     and old.raw_app_meta_data ->> ''perfil_existente'''
             || '         is distinct from new.raw_app_meta_data ->> ''perfil_existente'''
             || ' )'
             || ' execute function public.vincular_perfil_graduado_trigger()';
    end if;
end;
$$;


-- =============================================================================
-- 4. `puede_graduar_perfil(perfil)` — la autoridad para graduar, en la BASE
-- -----------------------------------------------------------------------------
-- La graduación la ejecuta la Admin API con `service_role`, que por definición
-- no pasa por RLS: la clave no la puede autorizar la base en el momento de
-- escribir. Entonces la autorización tiene que ocurrir ANTES, y tiene que ser
-- verificable — "solo el creador ve el botón" no es una garantía, es una
-- decoración.
--
-- Esta función es esa verificación, y vive en la base por la misma razón que
-- `puede_ver_perfil` y sus hermanas (`lib/auth/guardas.ts`: "Reescribir el
-- predicado en TypeScript garantizaría que algún día la app y la base opinen
-- distinto"). La usan los DOS lados de la operación:
--
--   · la pantalla `/familia`, para decidir si muestra la sección;
--   · `graduarPerfilGestionado` (`app/(app)/(con-nav)/familia/actions.ts`),
--     como condición de entrada antes de tocar la Admin API — y esa es la que
--     de verdad manda, porque un `formData` se puede alterar.
--
-- El predicado son tres condiciones y ninguna sobra:
--
--   1. `user_id is null` — el perfil todavía es GESTIONADO. Graduar uno ya
--      graduado no es "un intento fallido", es una operación sin sentido: esa
--      persona ya tiene su cuenta. Rechazarlo acá le da a la interfaz un
--      mensaje en español en vez de dejar que reviente el UPDATE de §1.
--   2. `created_by_profile_id = perfil_actor()` — es EL CREADOR, no un
--      `can_manage` cualquiera. Es más estricto que la autoridad de
--      otorgamiento de §4.4 (que sobre un gestionado alcanza a todos sus
--      administradores) y es deliberado: darle una cuenta a alguien es
--      decidir sobre su identidad, no sobre sus datos. Quien creó el perfil es
--      quien declaró ser su representante legal y firmó
--      `acceso_familiar_representante` (tarea 15.1); un familiar al que
--      después le dieron `can_manage` para que cargue estudios no heredó esa
--      representación. `created_by_profile_id` es confiable para esto porque
--      lo sella el trigger `profiles_proteger_titularidad`, no el cliente
--      (deuda D1).
--   3. `created_by_profile_id is not null` — explícito aunque `perfil_actor()`
--      devolvería NULL para una cuenta sin perfil y la comparación daría NULL
--      igual: un perfil sin creador conocido (los que se autocrean al
--      registrarse, o los del seed) no tiene "creador" que pueda graduarlo, y
--      conviene que eso se lea sin razonar sobre la lógica ternaria de SQL.
--
-- `STABLE` + `SECURITY DEFINER` + `set search_path = ''`, exactamente el molde
-- de `puede_otorgar_permisos` (20260812220000_rls.sql §1). DEFINER porque
-- tiene que poder leer `profiles` sin volver a entrar en la política de
-- `profiles` (recursión 42P17) y porque `perfil_actor()` ya lo es.
--
-- Que `authenticated` pueda invocarla no filtra nada: responde exclusivamente
-- sobre la autoridad del propio invocante sobre un perfil que él ya conoce, y
-- para un perfil que no creó devuelve FALSE igual que para uno inexistente
-- —mismo criterio de no-oráculo que `ErrorPermisoDenegado` en
-- `lib/auth/guardas.ts`—.
-- =============================================================================

create or replace function public.puede_graduar_perfil(perfil uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.profiles p
         where p.id = perfil
           and p.user_id is null
           and p.created_by_profile_id is not null
           and p.created_by_profile_id = public.perfil_actor()
    );
$$;

comment on function public.puede_graduar_perfil(uuid) is
    'TRUE si la sesión actual puede GRADUAR ese perfil, es decir darle su propia cuenta (Sprint 15, tarea 15.2; docs/modelo-permisos.md §8.6). Exige las tres cosas a la vez: que el perfil siga siendo gestionado (user_id IS NULL), que tenga creador conocido y que ese creador sea el perfil actor. Es MÁS ESTRICTA que la autoridad de otorgamiento de §4.4 -que sobre un gestionado alcanza a cualquier can_manage- a propósito: darle una cuenta a una persona es decidir sobre su identidad, no sobre sus datos, y quien lo puede hacer es únicamente quien declaró ser su representante al crear el perfil. La consultan la pantalla /familia y, como condición de entrada real, la Server Action graduarPerfilGestionado antes de llamar a la Admin API de Supabase (que corre con service_role y por lo tanto no pasa por RLS).';

revoke execute on function public.puede_graduar_perfil(uuid) from public;
grant  execute on function public.puede_graduar_perfil(uuid) to authenticated, service_role;

-- Fin de la migración.
