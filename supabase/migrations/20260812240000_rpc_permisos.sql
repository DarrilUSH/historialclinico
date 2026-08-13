-- =============================================================================
-- Historial Médico — Migración 20260812240000: RPCs de la pantalla de Familia
-- -----------------------------------------------------------------------------
-- Dos funciones SECURITY DEFINER mínimas para el ABM de `family_permissions`
-- (Sprint 2, `app/(app)/familia/`). Ninguna relaja una política RLS existente:
-- las dos devuelven el mínimo dato necesario y todo lo demás sigue pasando por
-- las políticas normales del cliente del usuario.
--
-- 1. `nombres_de_perfiles_vinculados()` — cierra la limitación conocida que
--    `docs/seguridad-rls.md` §5 ("Limitación conocida que hereda el Sprint 2")
--    dejó documentada: `profiles_select_visible` no cubre la relación inversa,
--    así que quien otorgó acceso no puede leer el `full_name` de a quién se lo
--    otorgó y la pantalla de Familia vería uuids sin nombre. Se resuelve con
--    una función que expone SOLO `(perfil_id, full_name)` — nada de fecha de
--    nacimiento, ficha SOS ni ningún otro campo — y solo de los perfiles que
--    son `granted_profile_id` en una fila cuyo `owner_profile_id` el llamador
--    posee o administra. No se toca `profiles_select_visible`: ensancharla
--    para este caso expondría la ficha SOS completa de un cuidador a todas las
--    familias que atiende.
--
-- 2. `perfil_id_por_email(text)` — resuelve el perfil CON CUENTA de un email
--    exacto, insumo del formulario "invitar por email". Necesita SECURITY
--    DEFINER porque el cliente autenticado no tiene privilegio sobre
--    `auth.users` ni ve el `profiles` de un tercero antes de tener permiso
--    sobre él (es justamente el problema que resuelve esta función).
--
--    RIESGO DE ENUMERACIÓN ACEPTADO: alguien con una cuenta válida puede usar
--    esta función para probar si un email tiene perfil en el sistema, un
--    email a la vez. Se acepta a propósito para una app de uso familiar (no
--    hay una superficie pública, hace falta estar autenticado, y no hay
--    búsqueda por patrón: se pide el email completo y exacto). La mitigación
--    vive en `app/(app)/familia/actions.ts`: el mensaje final que ve quien
--    invita no distingue "ese email no tiene cuenta" de "no se pudo agregar"
--    -devuelve el mismo texto neutro en los dos casos-, así que un actor no
--    puede usar la respuesta de la UI (a diferencia de la del RPC crudo) para
--    confirmar membresía. Documentado porque `puede_ver_perfil` y compañía sí
--    siguen negación-por-defecto estricta y esta función es la única
--    excepción deliberada a ese patrón en el esquema de permisos.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. nombres_de_perfiles_vinculados()
-- -----------------------------------------------------------------------------
-- Devuelve (perfil_id, full_name) de cada perfil que tiene acceso otorgado
-- -como granted_profile_id- sobre algún perfil que el llamador posee (es
-- titular) o administra (can_manage). Es literalmente
-- `public.puede_administrar_perfil(owner_profile_id)`: la misma función que ya
-- usan las políticas de UPDATE/DELETE de `profiles` y el ABM de
-- `family_permissions`, para que "quién puede ver esta lista" nunca diverja de
-- "quién puede tocar esos permisos".
--
-- A propósito NO expone: fecha de nacimiento, DNI, teléfono, ficha SOS, ni los
-- flags can_view/can_upload/can_manage (esos se leen aparte con el cliente del
-- usuario, vía `family_permissions_select_propia_o_administrada`, que ya
-- filtra correctamente por RLS y no necesita bypass).
create or replace function public.nombres_de_perfiles_vinculados()
returns table (perfil_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
    select distinct p.id as perfil_id, p.full_name
      from public.family_permissions fp
      join public.profiles p on p.id = fp.granted_profile_id
     where public.puede_administrar_perfil(fp.owner_profile_id);
$$;

comment on function public.nombres_de_perfiles_vinculados() is
    'Nombres de los perfiles con acceso otorgado sobre algo que el llamador posee o administra (mismo predicado que puede_administrar_perfil). Cierra la limitación de profiles_select_visible documentada en docs/seguridad-rls.md §5 sin relajar esa política: devuelve solo id y full_name, nunca la ficha completa de un tercero.';


-- -----------------------------------------------------------------------------
-- 2. perfil_id_por_email(text)
-- -----------------------------------------------------------------------------
-- Resuelve el profiles.id de la cuenta cuyo auth.users.email coincide EXACTO
-- (case-insensitive: los emails no se distinguen por mayúsculas) con el que
-- se pasa. Devuelve NULL si no hay cuenta con ese email, o si la cuenta existe
-- pero todavía no tiene perfil propio -el join contra profiles.user_id filtra
-- ambos casos por igual, y es intencional que la función no los distinga: la
-- UI de invitar trata "no existe" y "existe pero no tiene perfil" del mismo
-- modo (ninguno es invitable todavía).
--
-- No hace falta-ni conviene-una versión "buscar por patrón": el formulario de
-- invitar pide el email completo, no ofrece autocompletado de contactos
-- ajenos, y una búsqueda parcial (ILIKE '%...%') es la vía directa a un
-- oráculo de enumeración masiva en vez de acotada. Ver el riesgo aceptado en
-- el encabezado de este archivo.
create or replace function public.perfil_id_por_email(email_buscado text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select p.id
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where lower(u.email) = lower(email_buscado)
     limit 1;
$$;

comment on function public.perfil_id_por_email(text) is
    'Resuelve el profiles.id de la cuenta cuyo email coincide exacto (case-insensitive) con el buscado, o NULL. Insumo del formulario de invitar por email (app/(app)/familia/actions.ts). Riesgo de enumeración aceptado y documentado en el encabezado del archivo; la mitigación es que la UI nunca traduce el NULL en un mensaje distinto de "no se pudo agregar".';


-- -----------------------------------------------------------------------------
-- 3. Privilegios de ejecución
-- -----------------------------------------------------------------------------
-- CREATE FUNCTION otorga EXECUTE a PUBLIC por defecto: se revoca y se vuelve a
-- otorgar solo a los roles que la matriz de la sección 4 de
-- docs/seguridad-rls.md ya reconoce (mismo patrón que
-- 20260812220000_rls.sql). `anon` no puede invocar ninguna de las dos, ni por
-- RPC directo ni heredando de PUBLIC.
revoke execute on function public.nombres_de_perfiles_vinculados() from public;
revoke execute on function public.perfil_id_por_email(text)        from public;

grant execute on function public.nombres_de_perfiles_vinculados() to authenticated, service_role;
grant execute on function public.perfil_id_por_email(text)        to authenticated, service_role;
