-- =============================================================================
-- Historial Médico — Migración 20260819200000: sacarle a `anon` el EXECUTE de
-- `especialidades_todas_no_vacias` (ajuste del fix 20260818200000)
-- -----------------------------------------------------------------------------
-- `20260818200000_fix_check_especialidades.sql` devolvió el EXECUTE que el
-- hardening del Security Advisor le había sacado a la función del CHECK
-- `doctors_specialties_sin_vacios` —sin ese permiso, toda alta o edición de un
-- médico fallaba con 42501 en producción—. Ese fix era correcto y sigue en pie
-- para `authenticated` y `service_role`.
--
-- Lo que se corrige acá es un exceso de ese fix: **también se lo concedió a
-- `anon`**, con el argumento de que "el CHECK se evalúa con el rol que escribe
-- la fila, así que una escritura de anon debería fallar por RLS y no por un
-- permiso de función". El argumento no se sostiene:
--
--   · `anon` no tiene ninguna política de INSERT/UPDATE sobre `public.doctors`
--     (20260812220000_rls.sql), así que **Postgres lo rechaza por RLS antes de
--     llegar a evaluar el CHECK**: la función nunca se ejecuta en su nombre y
--     el mensaje de error que recibe es el de la política, no el del permiso.
--   · El BLOQUE 27 del arnés (`scripts/test-rls.sql`) tiene como CRITERIO DE
--     ACEPTACIÓN que **ninguna función de `public` sea ejecutable por `anon`**.
--     Ese invariante vale más que la hipótesis de arriba: es la línea que
--     separa "la superficie anónima es cero" de "es casi cero".
--
-- La función es pura (`IMMUTABLE`, sin acceso a tablas, sin SECURITY DEFINER),
-- así que el grant a `anon` no exponía datos — pero un invariante que se
-- respeta "casi siempre" deja de ser un invariante, y el arnés lo detectó al
-- primer intento. Se revoca.
--
-- UTF-8 sin BOM.
-- =============================================================================

revoke execute on function public.especialidades_todas_no_vacias(text[]) from anon;

-- Verificación: `authenticated` y `service_role` DEBEN conservarlo (si no, el
-- alta de médicos vuelve a romperse), y `anon` NO debe tenerlo.
do $$
declare
    v_anon    boolean;
    v_auth    boolean;
    v_service boolean;
begin
    select
        bool_or(g.rolname = 'anon'),
        bool_or(g.rolname = 'authenticated'),
        bool_or(g.rolname = 'service_role')
      into v_anon, v_auth, v_service
      from pg_catalog.pg_proc p
      cross join lateral aclexplode(p.proacl) a
      join pg_catalog.pg_roles g on g.oid = a.grantee
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'especialidades_todas_no_vacias'
       and a.privilege_type = 'EXECUTE';

    if coalesce(v_anon, false) then
        raise exception 'anon todavía puede ejecutar especialidades_todas_no_vacias.';
    end if;

    if not coalesce(v_auth, false) or not coalesce(v_service, false) then
        raise exception
            'Falta EXECUTE para authenticated o service_role: el alta de médicos quedaría rota.';
    end if;
end;
$$;

-- Fin de la migración.
