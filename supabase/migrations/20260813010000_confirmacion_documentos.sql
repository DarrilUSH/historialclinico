-- =============================================================================
-- Historial Médico — Migración 20260813010000: confirmación acotada del
-- documento recién subido (Sprint 4, tarea 4.5)
-- -----------------------------------------------------------------------------
-- CONTEXTO. `documents_update_administrador` (20260812220000_rls.sql) exige
-- `can_manage` para CUALQUIER `UPDATE` de `documents`: quien solo tiene
-- `can_upload` (el caso típico de una cuidadora) puede SUBIR un estudio pero
-- no corregirlo después -ver el caso "3. can_upload" de `scripts/test-rls.sql`
-- ("B corrige SU PROPIA carga (requiere can_manage)" → 0 filas)-. Eso es
-- correcto como regla general, pero choca con el criterio de oro de la
-- pantalla de revisión del roadmap: **la IA nunca guarda sola** y quien acaba
-- de subir el documento tiene que poder revisar y corregir lo que la
-- extracción entendió ANTES de que quede guardado. Sin una vía intermedia,
-- can_upload quedaría sin poder confirmar su propia carga y la pantalla de
-- revisión sería inútil para el caso de uso más común del producto.
--
-- DECISIÓN (orquestador, Sprint 4). En vez de aflojar `documents_update_administrador`
-- -lo que le daría a can_upload un UPDATE general sobre cualquier documento,
-- viejo o ajeno-, se agrega una función `SECURITY DEFINER` MUY acotada que
-- permite al CREADOR confirmar (o descartar) EXCLUSIVAMENTE el documento que
-- él mismo acaba de subir, y solo durante una ventana corta. Es la aplicación
-- concreta de la deuda D2 que `docs/modelo-permisos.md` ya anticipaba:
--
--   "(a) [created_by_profile_id] habilitaría 'quien subió puede corregir su
--   propia carga', que hoy se resuelve haciendo que toda corrección requiera
--   can_manage (...) Recomendación: agregar la columna ahora (...) y mantener
--   la matriz como está hasta que un caso real de producto pida la corrección
--   propia." — docs/modelo-permisos.md §D2
--
-- La pantalla de revisión ES ese caso real. `created_by_profile_id` ya existe
-- desde `20260812210000_ajustes_modelo.sql`, sellado por trigger e inmutable:
-- exactamente el dato confiable que esta función necesita para no poder ser
-- falsificado.
--
-- LAS CUATRO GUARDAS (las mismas en las dos funciones, `confirmar` y
-- `descartar`, salvo que la primera además valida los valores nuevos):
--   1. El llamador es el CREADOR: documents.created_by_profile_id = perfil_actor().
--   2. Dentro de LA PRIMERA HORA desde documents.created_at.
--   3. El documento NUNCA fue confirmado: documents.confirmed_at IS NULL.
--   4. (solo confirmar) los valores nuevos son válidos: título no vacío y
--      ≤200 caracteres, categoría dentro del enum doc_category, fecha válida,
--      no futura y posterior a 1900.
--
-- Pasada la hora, o si el documento ya fue confirmado, la ÚNICA vía de
-- corrección vuelve a ser la general: pedirle a quien administra el perfil
-- (`can_manage`) que edite el documento — el UPDATE de siempre, sin cambios.
-- Esta migración NO toca `documents_update_administrador` ni ninguna otra
-- política de `20260812220000_rls.sql`.
--
-- POR QUÉ SECURITY DEFINER Y NO UNA POLÍTICA RLS NUEVA. La condición
-- "dentro de la primera hora" es una ventana de TIEMPO, no una relación
-- estable entre filas: expresarla en una política de UPDATE normal la
-- convertiría en una puerta abierta permanente que cualquier UPDATE directo
-- del cliente podría explotar apenas alguien tuviera can_upload, sin pasar
-- por la validación de campos ni por el sellado de `confirmed_at`. Una
-- función SECURITY DEFINER de superficie mínima -dos parámetros de control
-- (`doc_id`, y en el caso de confirmar, los cuatro valores nuevos) y CERO
-- flexibilidad adicional- es más auditable: un solo punto de entrada, con
-- las cuatro guardas explícitas en un único lugar.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Columna `confirmed_at`
-- -----------------------------------------------------------------------------
alter table public.documents
    add column confirmed_at timestamptz null;

comment on column public.documents.confirmed_at is
    'Momento en que el CREADOR confirmó la extracción (o la carga manual) desde la pantalla de revisión, vía el RPC confirmar_documento_recien_subido(). NULL = todavía no confirmado. Es el semáforo que hace irrepetible la confirmación: una vez seteado, ni siquiera el propio creador puede volver a llamar al RPC sobre este documento (tiene que pedirle a un can_manage que lo corrija por la vía general). No lo pisa ningún UPDATE del flujo administrador -documents_update_administrador no lo toca-: solo lo escribe este RPC.';


-- -----------------------------------------------------------------------------
-- 2. confirmar_documento_recien_subido(...)
-- -----------------------------------------------------------------------------
-- Actualiza título, categoría, fecha y resumen del documento SI (y solo si)
-- las cuatro guardas se cumplen, y sella confirmed_at = now(). Se devuelve la
-- fila completa para que la Server Action no tenga que hacer un SELECT
-- aparte -el creador ya tiene, por definición, acceso legítimo a estos datos.
create or replace function public.confirmar_documento_recien_subido(
    doc_id          uuid,
    nuevo_titulo    text,
    nueva_categoria text,
    nueva_fecha     date,
    nuevo_resumen   text
)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
    fila             public.documents%rowtype;
    titulo_limpio    text;
    categoria_valida public.doc_category;
    resumen_limpio   text;
begin
    -- Guarda 4 (valores). Se valida ANTES de tocar la fila: si el envío es
    -- inválido, no tiene sentido ni bloquearla con SELECT ... FOR UPDATE.
    titulo_limpio := btrim(coalesce(nuevo_titulo, ''));
    if char_length(titulo_limpio) = 0 or char_length(titulo_limpio) > 200 then
        raise exception
            'El título no puede estar vacío ni superar los 200 caracteres.'
            using errcode = 'invalid_parameter_value';
    end if;

    begin
        categoria_valida := nueva_categoria::public.doc_category;
    exception when invalid_text_representation then
        raise exception
            'La categoría no es válida.'
            using errcode = 'invalid_parameter_value';
    end;

    if nueva_fecha is null
       or nueva_fecha > current_date
       or nueva_fecha <= date '1900-12-31'
    then
        raise exception
            'La fecha del estudio no es válida: no puede ser futura ni anterior a 1900.'
            using errcode = 'invalid_parameter_value';
    end if;

    resumen_limpio := nullif(btrim(coalesce(nuevo_resumen, '')), '');
    if resumen_limpio is not null and char_length(resumen_limpio) > 2000 then
        raise exception
            'El resumen es demasiado largo (máx. 2000 caracteres).'
            using errcode = 'invalid_parameter_value';
    end if;

    -- FOR UPDATE: bloquea la fila para que dos confirmaciones simultáneas
    -- (dos pestañas, doble toque) no pasen las guardas 1-3 a la vez.
    select * into fila from public.documents d where d.id = doc_id for update;

    -- Guarda 1 (implícita si no hay fila): "no existe" y "no sos el creador"
    -- devuelven el mismo tipo de rechazo, mismo principio 3 de
    -- docs/modelo-permisos.md ("la app nunca debe distinguir 'no existe' de
    -- 'no tenés permiso'"), aunque acá el contexto ya no es RLS sino un RPC:
    -- de cualquier manera no hay motivo para diferenciarlos ante quien llama.
    if not found then
        raise exception
            'No encontramos ese documento, o no podés confirmarlo.'
            using errcode = 'insufficient_privilege';
    end if;

    -- Guarda 1.
    if fila.created_by_profile_id is distinct from public.perfil_actor() then
        raise exception
            'Solo la persona que subió este documento puede confirmarlo.'
            using errcode = 'insufficient_privilege';
    end if;

    -- Guarda 2.
    if fila.created_at < now() - interval '1 hour' then
        raise exception
            'Pasó más de una hora desde que se subió este documento. Pedile a quien administra este perfil que lo corrija.'
            using errcode = 'insufficient_privilege';
    end if;

    -- Guarda 3.
    if fila.confirmed_at is not null then
        raise exception
            'Este documento ya fue confirmado.'
            using errcode = 'insufficient_privilege';
    end if;

    update public.documents
       set title         = titulo_limpio,
           category      = categoria_valida,
           document_date = nueva_fecha,
           ai_summary    = resumen_limpio,
           confirmed_at  = now()
     where id = doc_id
    returning * into fila;

    return fila;
end;
$$;

comment on function public.confirmar_documento_recien_subido(uuid, text, text, date, text) is
    'Confirmación acotada de la pantalla de revisión (Sprint 4, tarea 4.5): permite al CREADOR (created_by_profile_id = perfil_actor()) actualizar título/categoría/fecha/resumen de SU PROPIO documento recién subido, solo dentro de la primera hora desde created_at y solo si confirmed_at todavía es NULL. SECURITY DEFINER porque documents_update_administrador exige can_manage para cualquier UPDATE y can_upload no lo tiene — ver el encabezado del archivo para la decisión completa. No relaja ninguna política de 20260812220000_rls.sql: pasada la ventana, o ya confirmado, la única vía sigue siendo el UPDATE general (can_manage).';


-- -----------------------------------------------------------------------------
-- 3. descartar_documento_recien_subido(...)
-- -----------------------------------------------------------------------------
-- Función hermana: borra el documento en vez de confirmarlo, con las mismas
-- guardas 1-3 (no aplica la 4, no hay valores nuevos que validar). Es el
-- "Cancelar" de la pantalla de revisión: la persona sube un documento por
-- error, o la extracción falló y no quiere cargar los datos a mano, y borra
-- la carga entera -fila y archivo- antes de que llegue a formar parte de
-- ningún historial.
--
-- El DELETE dispara el trigger `documents_encolar_purga_storage`
-- (20260812210000_ajustes_modelo.sql, AFTER DELETE, también SECURITY
-- DEFINER), que encola el storage_path en storage_purge_queue exactamente
-- igual que cualquier otro borrado de documents: no hace falta -ni se
-- duplica acá- ninguna lógica de purga propia. Se devuelve la fila borrada
-- (con su storage_path) para que la Server Action pueda además borrar el
-- objeto DE INMEDIATO con `lib/storage-admin.ts` (patrón "belt-and-suspenders"
-- del roadmap: la purga en cola es la red de seguridad, el borrado inmediato
-- es la vía rápida cuando todo sale bien).
create or replace function public.descartar_documento_recien_subido(doc_id uuid)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
    fila public.documents%rowtype;
begin
    select * into fila from public.documents d where d.id = doc_id for update;

    if not found then
        raise exception
            'No encontramos ese documento, o no podés descartarlo.'
            using errcode = 'insufficient_privilege';
    end if;

    if fila.created_by_profile_id is distinct from public.perfil_actor() then
        raise exception
            'Solo la persona que subió este documento puede descartarlo.'
            using errcode = 'insufficient_privilege';
    end if;

    if fila.created_at < now() - interval '1 hour' then
        raise exception
            'Pasó más de una hora desde que se subió este documento. Pedile a quien administra este perfil que lo elimine.'
            using errcode = 'insufficient_privilege';
    end if;

    if fila.confirmed_at is not null then
        raise exception
            'Este documento ya fue confirmado: para eliminarlo hace falta permiso de administración.'
            using errcode = 'insufficient_privilege';
    end if;

    delete from public.documents where id = doc_id;

    return fila;
end;
$$;

comment on function public.descartar_documento_recien_subido(uuid) is
    'Descarte acotado de la pantalla de revisión (Sprint 4, tarea 4.5): función hermana de confirmar_documento_recien_subido() con las mismas guardas de creador+1h+no-confirmado, que BORRA en vez de actualizar. El AFTER DELETE trigger documents_encolar_purga_storage encola el storage_path en storage_purge_queue automáticamente; la Server Action además borra el objeto de inmediato con lib/storage-admin.ts (belt-and-suspenders). Devuelve la fila borrada para que la Server Action tenga el storage_path sin un SELECT aparte.';


-- -----------------------------------------------------------------------------
-- 4. Privilegios de ejecución
-- -----------------------------------------------------------------------------
-- Mismo patrón que 20260812240000_rpc_permisos.sql: CREATE FUNCTION otorga
-- EXECUTE a PUBLIC por defecto; se revoca y se vuelve a otorgar solo a
-- authenticated y service_role. anon no puede invocar ninguna de las dos.
revoke execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text) from public;
revoke execute on function public.descartar_documento_recien_subido(uuid)                         from public;

grant execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text) to authenticated, service_role;
grant execute on function public.descartar_documento_recien_subido(uuid)                         to authenticated, service_role;

-- Fin de la migración.
