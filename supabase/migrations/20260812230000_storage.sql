-- =============================================================================
-- MiHistorialMédico — Migración 20260812230000: buckets privados y su RLS
-- -----------------------------------------------------------------------------
-- Crea los tres buckets del producto, todos PRIVADOS, y las políticas de
-- `storage.objects` que replican la matriz de docs/modelo-permisos.md.
--
-- POR QUÉ ESTA MIGRACIÓN NO ES OPCIONAL NI PUEDE SER MÁS LAXA QUE LA BASE:
-- la fila de `documents` la filtra RLS, pero el PDF del análisis vive en el
-- bucket. Si Storage quedara más permisivo que las tablas, el modelo entero es
-- decorativo, porque **el archivo *es* el dato de salud** (§7.4 del contrato).
--
-- EL PUENTE ES LA CONVENCIÓN DE PATH: el primer segmento del nombre del objeto
-- es SIEMPRE el `profile_id` del titular de los datos.
--
--     documentos-medicos      {profile_id}/{anio}/{uuid}.{ext}
--     credenciales-cobertura  {profile_id}/{card_id}/{side}.jpg
--     avatares                {profile_id}/{uuid}.{ext}
--
-- De ahí las políticas derivan el perfil y llaman a las MISMAS funciones
-- auxiliares que gobiernan las tablas (`20260812220000_rls.sql`). No hay una
-- segunda implementación del modelo de permisos: hay una sola, invocada desde
-- dos lugares. Es lo que garantiza que no puedan divergir.
--
-- NOTA SOBRE PRIVILEGIOS: en Supabase, `anon` y `authenticated` tienen GRANT de
-- SELECT/INSERT/UPDATE/DELETE sobre `storage.objects` a nivel de tabla. Es decir
-- que en Storage **RLS es la única capa de protección**, a diferencia del
-- esquema `public`, donde además revocamos privilegios. Por eso toda política de
-- este archivo declara `to authenticated` de forma explícita: una política sin
-- cláusula `TO` aplicaría también a `anon`.
-- =============================================================================


-- =============================================================================
-- 1. BUCKETS
-- -----------------------------------------------------------------------------
-- `public = false` en los tres: el acceso es exclusivamente por signed URL de
-- vida corta generada en el servidor. Un bucket público serviría datos de salud
-- por HTTP sin autenticación a cualquiera que adivine —o filtre— el path.
--
-- `allowed_mime_types` y `file_size_limit` los aplica el servicio de Storage al
-- subir, antes de escribir el objeto: son la primera barrera contra subir un
-- ejecutable disfrazado o llenar el disco.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    -- 25 MiB: un estudio escaneado de varias páginas entra holgado.
    ('documentos-medicos', 'documentos-medicos', false, 26214400,
     array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),

    -- 5 MiB: es la foto de una credencial, no un estudio. Sin PDF a propósito:
    -- la credencial se muestra a pantalla completa para que la lea un lector de
    -- códigos, y un PDF no sirve para eso.
    ('credenciales-cobertura', 'credenciales-cobertura', false, 5242880,
     array['image/jpeg', 'image/png', 'image/webp']),

    -- 2 MiB: una foto de perfil. Sin PDF, por lo mismo.
    ('avatares', 'avatares', false, 2097152,
     array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;


-- =============================================================================
-- 2. DERIVACIÓN DEL PERFIL DESDE EL PATH
-- -----------------------------------------------------------------------------
-- `storage.foldername(name)` devuelve el arreglo de carpetas del objeto, sin el
-- nombre de archivo. El primer elemento es, por convención, el profile_id.
--
-- EL CAST TIENE QUE SER TOLERANTE. Si se escribiera `(storage.foldername(name))[1]::uuid`
-- directo, un solo objeto con un primer segmento que no sea un uuid —subido a
-- mano, migrado de otro lado, o puesto ahí a propósito— haría que el cast
-- levante `22P02 invalid input syntax for type uuid` y **la consulta entera
-- falle**. En una política eso no es un rechazo: es un error 500 que rompe el
-- listado de estudios de todo el mundo. Por eso se valida con una expresión
-- regular y se devuelve NULL cuando no corresponde.
--
-- NULL es seguro: `puede_ver_perfil(NULL)` es FALSE (ningún perfil tiene id
-- NULL y ninguna fila de family_permissions matchea), así que un objeto con
-- path inválido —o suelto en la raíz del bucket— queda inaccesible para todos
-- los usuarios. Negación por defecto, igual que en las tablas.
-- =============================================================================

create or replace function public.perfil_de_objeto_storage(objeto text)
returns uuid
language sql
immutable
set search_path = ''
as $$
    select case
        when (storage.foldername(objeto))[1] ~*
             '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(objeto))[1])::uuid
    end;
$$;

comment on function public.perfil_de_objeto_storage(text) is
    'Extrae el profile_id del primer segmento del path de un objeto de Storage, o NULL si ese segmento no es un uuid (objeto en la raíz del bucket, path con otra convención, etc.). IMMUTABLE porque storage.foldername también lo es. Devolver NULL en lugar de castear a ciegas evita que un solo objeto mal nombrado convierta la política en un error 22P02 para todas las consultas del bucket.';

revoke execute on function public.perfil_de_objeto_storage(text) from public;
grant  execute on function public.perfil_de_objeto_storage(text) to authenticated, service_role;


-- =============================================================================
-- 3. POLÍTICAS DE storage.objects
-- -----------------------------------------------------------------------------
-- Traducción de la §7.4 del contrato:
--
--     leer / emitir signed URL  ->  puede_ver_perfil(perfil del path)
--     subir                     ->  puede_cargar_en_perfil(...)
--     reemplazar / borrar       ->  puede_administrar_perfil(...)
--
-- Todas se acotan por `bucket_id` a los tres buckets del producto: si mañana se
-- agrega un bucket para otra cosa, no hereda estas reglas por accidente.
-- =============================================================================

-- 3.1 LEER — es también lo que habilita emitir una signed URL con el JWT del
-- usuario. Cubre los tres buckets: si alguien puede ver el historial de un
-- perfil, puede ver sus estudios, sus credenciales y su avatar.
create policy objetos_select_puede_ver_perfil
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id in ('documentos-medicos', 'credenciales-cobertura', 'avatares')
        and public.puede_ver_perfil(public.perfil_de_objeto_storage(name))
    );

comment on policy objetos_select_puede_ver_perfil on storage.objects is
    'Predicado de LECTURA de la matriz aplicado al archivo: titular o autorizado con can_view/can_upload/can_manage sobre el perfil del primer segmento del path. Sin permiso: cero objetos, igual que las tablas devuelven cero filas.';

-- 3.2 SUBIR (documentos y credenciales) — can_upload. Es la contraparte exacta
-- del INSERT de `documents` e `insurance_cards`: la cuidadora saca la foto del
-- análisis y la sube.
create policy objetos_insert_puede_cargar_en_perfil
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id in ('documentos-medicos', 'credenciales-cobertura')
        and public.puede_cargar_en_perfil(public.perfil_de_objeto_storage(name))
    );

comment on policy objetos_insert_puede_cargar_en_perfil on storage.objects is
    'Predicado de CREACIÓN de la matriz: can_upload sube estudios y fotos de credencial. No incluye el bucket de avatares (ver objetos_insert_avatar_administrador).';

-- 3.3 SUBIR (avatares) — can_manage, NO can_upload. Es deliberadamente MÁS
-- estricto que los otros dos buckets, y la razón es de coherencia con la base:
-- el avatar no es contenido del historial, es un campo de `profiles`
-- (`avatar_storage_path`), y editar `profiles` requiere can_manage (nota ②).
-- Si acá se aceptara can_upload, Storage quedaría más laxo que la tabla que lo
-- referencia, que es precisamente lo que la §7.4 prohíbe.
create policy objetos_insert_avatar_administrador
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'avatares'
        and public.puede_administrar_perfil(public.perfil_de_objeto_storage(name))
    );

comment on policy objetos_insert_avatar_administrador on storage.objects is
    'El avatar se sube con can_manage y no con can_upload, porque no es contenido del historial sino un campo de profiles (avatar_storage_path) y editar el perfil es administración (nota ②). Mantener Storage al mismo nivel que la tabla que lo referencia, nunca más laxo.';

-- 3.4 REEMPLAZAR — can_manage. Sobrescribir un objeto destruye el anterior sin
-- dejar rastro; es una edición, no una carga. Lleva USING (objeto viejo) y
-- WITH CHECK (objeto nuevo): sin el segundo, se podría mover un archivo al
-- prefijo de otro perfil.
create policy objetos_update_administrador
    on storage.objects
    for update
    to authenticated
    using (
        bucket_id in ('documentos-medicos', 'credenciales-cobertura', 'avatares')
        and public.puede_administrar_perfil(public.perfil_de_objeto_storage(name))
    )
    with check (
        bucket_id in ('documentos-medicos', 'credenciales-cobertura', 'avatares')
        and public.puede_administrar_perfil(public.perfil_de_objeto_storage(name))
    );

comment on policy objetos_update_administrador on storage.objects is
    'Reemplazar un objeto es edición: can_manage. El WITH CHECK impide mover un archivo al prefijo de otro perfil, que sería la versión Storage de "mover una fila a un profile_id ajeno".';

-- 3.5 BORRAR — can_manage, igual que el DELETE de la fila que lo referencia.
create policy objetos_delete_administrador
    on storage.objects
    for delete
    to authenticated
    using (
        bucket_id in ('documentos-medicos', 'credenciales-cobertura', 'avatares')
        and public.puede_administrar_perfil(public.perfil_de_objeto_storage(name))
    );

comment on policy objetos_delete_administrador on storage.objects is
    'Borrar el archivo es administración, igual que borrar la fila de documents o insurance_cards que lo referencia.';


-- =============================================================================
-- 4. LO QUE ESTA MIGRACIÓN DELIBERADAMENTE NO HACE
-- -----------------------------------------------------------------------------
-- * NO crea políticas sobre `storage.buckets`. Esa tabla tiene RLS habilitada y
--   cero políticas, así que ni `anon` ni `authenticated` pueden enumerar los
--   buckets ni leer sus límites. El servicio de Storage resuelve la metadata del
--   bucket con su propia conexión administrativa, así que subir y descargar
--   funciona igual. Menos superficie expuesta, sin costo.
--
-- * NO toca los triggers `protect_objects_delete` / `protect_buckets_delete` que
--   trae Supabase, y que rechazan el DELETE por SQL directo con el mensaje
--   "Direct deletion from storage tables is not allowed. Use the Storage API
--   instead.". Es un anti-footgun, no una frontera de seguridad (se destraba con
--   el GUC `storage.allow_delete_query`), pero tiene una consecuencia práctica
--   importante: **el job que drene `storage_purge_queue` en el Sprint 6 tiene
--   que borrar por la Storage API, no con un DELETE contra storage.objects**,
--   porque el borrado por SQL deja el archivo físico huérfano en el backend.
--   `borrarObjeto()` de `lib/storage-admin.ts` ya usa la API por ese motivo.
--
-- * NO define retención ni versionado de objetos. Se evalúa junto con la purga.
-- =============================================================================

-- Fin de la migración.
