-- =============================================================================
-- Historial Médico — Migración 20260817220000: perfiles gestionados desde
-- /familia (Sprint 15, tarea 15.1)
-- -----------------------------------------------------------------------------
-- El modelo YA soporta perfiles sin cuenta desde el Sprint 1
-- (`profiles.user_id IS NULL`, docs/modelo-permisos.md §3.2, caso B) y la
-- base YA sabe crearlos: la política `profiles_insert_propio_o_gestionado` +
-- `family_permissions_insert_arranque_gestionado` +
-- `puede_arrancar_administracion()` (las tres de
-- `20260812220000_rls.sql`) habilitan que cualquier autenticado inserte un
-- perfil gestionado y se autoasigne la fila de arranque con DOS INSERT
-- sueltos desde el cliente — es exactamente lo que ya prueba el BLOQUE 5 del
-- arnés (`scripts/test-rls.sql`) con Diego creando a "Elsa Quiroga". Ese
-- camino queda intacto: esta migración no toca ni una política de
-- `20260812220000_rls.sql`.
--
-- Lo que faltaba, y lo que agrega este archivo, son dos cosas:
--
--   1. UN TERCER INSERT en la misma operación: el consentimiento del
--      representante (deuda D6 de docs/modelo-permisos.md §10, abierta desde
--      el Sprint 1 y todavía abierta en `docs/seguridad-rls.md` §5 al
--      empezar este sprint). Todo el caso B descansa en que quien crea el
--      perfil de un tercero TIENE su consentimiento o su representación
--      legal (Ley 25.326, art. 4: minimización; patria potestad / tutela
--      para quien no puede consentir por sí mismo). Hasta ahora esa
--      declaración no quedaba registrada en ningún lado.
--
--   2. ATOMICIDAD DE VERDAD entre los tres INSERT. Dos (o tres) llamadas
--      sueltas desde un Server Action -por más que RLS autorice cada una por
--      separado- dejan una ventana real: si el INSERT de `profiles` tiene
--      éxito y el de `family_permissions` falla (red, timeout, el usuario
--      cierra la pestaña), el perfil recién creado queda con
--      `user_id IS NULL` y CERO filas de `can_manage` — el estado
--      PROHIBIDO por docs/modelo-permisos.md §8.2 ("perfil huérfano"),
--      invisible incluso para quien lo creó (`puede_ver_perfil` exige
--      titularidad o una fila de permiso, y ninguna de las dos existe). El
--      trigger `family_permissions_evitar_huerfano` (deuda D4) no ayuda acá:
--      vigila que no se LLEGUE a la orfandad borrando o bajando una fila
--      existente, no que se CREE un perfil sin ninguna.
--
--      La función `crear_perfil_gestionado()` de abajo hace los tres INSERT
--      -perfil, fila de arranque, consentimiento- dentro de una única
--      transacción PL/pgSQL: si cualquiera de los tres falla, Postgres
--      deshace los tres. Es SECURITY DEFINER (mismo criterio que
--      `registrar_toma()`, `supabase/migrations/20260813060000_medicacion_
--      estado.sql`): no amplía ningún privilegio de tabla a `authenticated`,
--      solo empaqueta una operación que ya era legal en una unidad atómica.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema, igual que el resto
-- del proyecto.
-- =============================================================================


-- =============================================================================
-- 1. Nuevo tipo de consentimiento: 'acceso_familiar_representante'
-- -----------------------------------------------------------------------------
-- `consents.document` es `text` + `CHECK` (no un enum) a propósito — ver el
-- porqué completo en el encabezado de `20260814130000_consents.sql`: permite
-- agregar un documento nuevo con un `ALTER TABLE ... ADD CONSTRAINT` en vez
-- de la ceremonia de `ALTER TYPE ... ADD VALUE` (que ni siquiera se puede
-- usar en la misma transacción en la que el valor nuevo se inserta — y esta
-- migración SÍ inserta filas con el valor nuevo, en el arnés y en producción
-- el mismo día que se aplica).
--
-- Es un documento DISTINTO de 'acceso_familiar' (Sprint 12, tarea 12.1) y no
-- una reutilización: 'acceso_familiar' certifica que una CUENTA otorga
-- acceso a OTRA CUENTA sobre un perfil que ya existe
-- (`invitarFamiliar`, `app/(app)/(con-nav)/familia/actions.ts`).
-- 'acceso_familiar_representante' certifica algo previo y distinto: que
-- quien crea un perfil NUEVO para una persona que no puede consentir por sí
-- misma (un chico, un adulto mayor sin cuenta) declara ser su representante
-- legal o tener su consentimiento. Conflar los dos números perdería la
-- distinción legal entre "delego el acceso a algo mío" y "actúo en nombre de
-- alguien que no puede actuar".
alter table public.consents
    drop constraint consents_document_valido;

alter table public.consents
    add constraint consents_document_valido
        check (document in ('privacidad', 'terminos', 'acceso_familiar', 'acceso_familiar_representante'));

comment on column public.consents.document is
    'Qué se aceptó: "privacidad" y "terminos" se firman juntos al registrarse; "acceso_familiar" se firma cada vez que la cuenta otorga acceso sobre un perfil EXISTENTE a otra cuenta (docs/modelo-permisos.md §4.4); "acceso_familiar_representante" se firma al CREAR un perfil gestionado nuevo (Sprint 15, tarea 15.1; docs/modelo-permisos.md §8.4 y §9.4, deuda D6): declara que quien crea el perfil tiene el consentimiento del titular o su representación legal (Ley 25.326, patria potestad/tutela). text + CHECK y no un enum: ver el porqué en el encabezado de 20260814130000_consents.sql.';


-- =============================================================================
-- 2. crear_perfil_gestionado(...)
-- -----------------------------------------------------------------------------
-- Tres INSERT atómicos: profiles, family_permissions (fila de arranque) y
-- consents (consentimiento del representante). Devuelve la fila de profiles
-- recién creada.
--
-- Guardas, en orden:
--   1. El actor tiene su propio perfil (perfil_actor() no NULL). No debería
--      poder faltar para una cuenta que ya completó el alta -el trigger
--      `auth_users_crear_perfil_de_cuenta` (20260814140000) se lo crea
--      siempre-, pero una función que va a hacer tres INSERT con
--      SECURITY DEFINER no asume nada que pueda verificar gratis.
--   2. `full_name` no vacío -mismo criterio que
--      `profiles_full_name_no_vacio`, verificado ACÁ porque esta función
--      bypassea RLS y los CHECK de la tabla igual se aplican pero con un
--      mensaje de Postgres crudo; se prefiere fallar antes con un mensaje en
--      español-.
--   3. `date_of_birth` presente y no futura. Es un requisito de ESTA
--      operación -el formulario de /familia lo pide siempre-, no de la
--      columna en general: `profiles.date_of_birth` sigue siendo nullable
--      para otros caminos (el seed, el alta de cuenta propia, BLOQUE 5 del
--      arnés). "No futura" se compara como FECHA DE CALENDARIO en Ushuaia,
--      nunca contra un instante: no hay bug de huso posible entre dos
--      `date` sin hora, pero igual se ancla a la zona del proyecto
--      (`lib/turnos/fecha.ts#hoyIsoUshuaia` es el equivalente TypeScript).
--   4. `legales_version` presente -el espejo de VERSION_LEGALES,
--      `lib/legales.ts`, que la Server Action manda como parámetro porque
--      PL/pgSQL no puede importar la constante de TypeScript-.
--
-- `p_ip` es `inet` opcional: mismo dato y mismo origen que
-- `registrarConsentimiento()` (`lib/legales.ts`) ya captura para
-- 'acceso_familiar', normalizado del lado de la aplicación con
-- `normalizarIp()` (`lib/auditoria.ts`) antes de llegar acá.
create or replace function public.crear_perfil_gestionado(
    p_full_name       text,
    p_date_of_birth   date,
    p_legales_version text,
    p_ip              inet default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor       uuid;
    v_full_name   text;
    v_version     text;
    v_hoy_ushuaia date;
    v_perfil      public.profiles%rowtype;
begin
    v_actor := public.perfil_actor();
    if v_actor is null then
        raise exception
            'Necesitás tener tu propio perfil en Historial Médico antes de poder crear uno gestionado.'
            using errcode = 'insufficient_privilege';
    end if;

    v_full_name := nullif(btrim(p_full_name), '');
    if v_full_name is null then
        raise exception 'El nombre completo no puede estar vacío.'
            using errcode = 'invalid_parameter_value';
    end if;

    if p_date_of_birth is null then
        raise exception 'La fecha de nacimiento es obligatoria para crear un perfil gestionado.'
            using errcode = 'invalid_parameter_value';
    end if;

    v_hoy_ushuaia := (now() at time zone 'America/Argentina/Ushuaia')::date;
    if p_date_of_birth > v_hoy_ushuaia then
        raise exception 'La fecha de nacimiento no puede ser futura.'
            using errcode = 'invalid_parameter_value';
    end if;

    v_version := nullif(btrim(p_legales_version), '');
    if v_version is null then
        raise exception 'Falta la versión de los términos aceptados.'
            using errcode = 'invalid_parameter_value';
    end if;

    -- 1. El perfil gestionado. `user_id` explícitamente NULL: es la señal de
    --    perfil gestionado (docs/modelo-permisos.md §3.2). El trigger
    --    `profiles_proteger_titularidad` (20260812220000_rls.sql) sella
    --    igual `created_by_profile_id := perfil_actor()` en el INSERT -acá
    --    se declara explícito además para que la intención se lea sin tener
    --    que ir a buscar el trigger, y porque coincide byte a byte con lo
    --    que el trigger va a poner-.
    insert into public.profiles (full_name, date_of_birth, user_id, created_by_profile_id)
    values (v_full_name, p_date_of_birth, null, v_actor)
    returning * into v_perfil;

    -- 2. Fila de arranque: el creador queda con administración total sobre
    --    el perfil que acaba de crear. Los mismos tres flags en `true` que
    --    exige docs/modelo-permisos.md §3.2 y que ya prueba el BLOQUE 5 del
    --    arnés para el camino de dos INSERT sueltos -acá es un segundo
    --    INSERT dentro de la MISMA transacción PL/pgSQL en vez de un
    --    segundo viaje de red-.
    insert into public.family_permissions
        (owner_profile_id, granted_profile_id, can_view, can_upload, can_manage)
    values (v_perfil.id, v_actor, true, true, true);

    -- 3. Consentimiento del representante (deuda D6). `user_id` es la CUENTA
    --    que declara la representación -`auth.uid()`, no `v_actor`, que es
    --    un `profiles.id`-, mismo criterio que `consents.user_id` en el
    --    resto del esquema (20260814130000_consents.sql: "el consentimiento
    --    es de la CUENTA, no de un perfil").
    insert into public.consents (user_id, document, version, ip)
    values ((select auth.uid()), 'acceso_familiar_representante', v_version, p_ip);

    return v_perfil;
end;
$$;

comment on function public.crear_perfil_gestionado(text, date, text, inet) is
    'Sprint 15, tarea 15.1: crea un perfil GESTIONADO (user_id NULL) y sus dos filas dependientes -la de arranque de family_permissions (can_view/upload/manage en true) y el consentimiento del representante (consents, document = acceso_familiar_representante, deuda D6)- en una única transacción. SECURITY DEFINER para que las tres escrituras corran atómicas: sin esto, un fallo de red entre el INSERT de profiles y el de family_permissions deja un perfil sin ningún can_manage -el estado de "perfil huérfano" que docs/modelo-permisos.md §8.2 declara prohibido-, invisible incluso para quien lo creó. Complementa, no reemplaza, el camino de INSERT directos que ya habilitan profiles_insert_propio_o_gestionado y family_permissions_insert_arranque_gestionado (20260812220000_rls.sql, probado en el BLOQUE 5 del arnés): ese camino sigue vigente tal cual estaba; la UI de /familia usa este RPC.';

revoke execute on function public.crear_perfil_gestionado(text, date, text, inet) from public;
grant  execute on function public.crear_perfil_gestionado(text, date, text, inet) to authenticated, service_role;

-- Fin de la migración.
