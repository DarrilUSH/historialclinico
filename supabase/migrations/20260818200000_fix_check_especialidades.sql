-- =============================================================================
-- Historial Médico — Migración 20260818200000: devolver el EXECUTE que el
-- hardening le sacó a la función del CHECK de especialidades
-- -----------------------------------------------------------------------------
-- ── EL BUG QUE ESTO CORRIGE (introducido por 20260818190000, mismo día)
--
-- `20260818090000_especialidades_multiples.sql` §3 creó
-- `especialidades_todas_no_vacias(text[])` para poder validar elemento por
-- elemento dentro del CHECK `doctors_specialties_sin_vacios` (Postgres no
-- admite una subquery dentro de un CHECK, así que la validación vive en una
-- función `IMMUTABLE`). Su propio COMMENT dejó escrito, con todas las letras,
-- por qué esa función es la ÚNICA del proyecto que NO lleva
-- `revoke execute ... from public`:
--
--     "esta función no es SECURITY DEFINER, no lee ninguna tabla y no expone
--      nada -solo transforma el array que recibe-, y el CHECK que la usa se
--      evalúa con los privilegios del rol que hace el INSERT/UPDATE
--      (`authenticated`), así que revocar EXECUTE de `public` rompería
--      cualquier alta o edición de un médico."
--
-- El hardening del Security Advisor (`20260818190000`) revoca EXECUTE sobre
-- **todas** las funciones de `public` y repone una lista blanca enumerada. Esa
-- lista se construyó leyendo del catálogo los grants explícitos que las
-- migraciones anteriores habían escrito a mano — y esta función no tenía
-- ninguno, justamente porque dependía del EXECUTE implícito de PUBLIC. Quedó
-- afuera, y con eso **toda alta o edición de un médico falla en producción**
-- con `42501: permission denied for function especialidades_todas_no_vacias`.
--
-- Es exactamente el modo de falla que el COMMENT de la 090000 anticipó. La
-- lección queda anotada acá y en docs/seguridad-rls.md §9: un `revoke` masivo
-- tiene que mirar también las funciones usadas por CHECKs, DEFAULTs y
-- políticas, no solo las que se llaman por RPC —esas se evalúan con el
-- privilegio de quien escribe la fila, no del dueño de la tabla—.
--
-- Las otras tres funciones que aparecen en un CHECK del esquema
-- (`puede_administrar_perfil`, `puede_cargar_en_perfil`,
-- `puede_otorgar_permisos`) SÍ estaban en la lista blanca de `authenticated`:
-- verificado una por una antes de escribir esta migración, así que este es el
-- único caso.
--
-- Se concede a `authenticated` y a `anon` -no por simetría, sino porque el
-- CHECK se evalúa con el rol que escribe la fila, y una escritura de `anon`
-- que RLS rechace tiene que fallar por RLS (política), no por un permiso de
-- función: el mensaje de error correcto importa-. Y a `service_role`, que
-- escribe `doctors` en el camino automático.
--
-- UTF-8 sin BOM.
-- =============================================================================

grant execute on function public.especialidades_todas_no_vacias(text[])
    to anon, authenticated, service_role;

-- Verificación: si el grant no quedó, la migración aborta en vez de dejar
-- producción con el alta de médicos rota (mismo criterio que el bloque final
-- de 20260818190000).
do $$
declare
    v_faltan text;
begin
    select string_agg(r.rolname, ', ')
      into v_faltan
      from unnest(array['anon', 'authenticated', 'service_role']) as r(rolname)
     where not exists (
        select 1
          from pg_catalog.pg_proc p
          cross join lateral aclexplode(p.proacl) a
          join pg_catalog.pg_roles g on g.oid = a.grantee
         where p.pronamespace = 'public'::regnamespace
           and p.proname = 'especialidades_todas_no_vacias'
           and a.privilege_type = 'EXECUTE'
           and g.rolname = r.rolname
     );

    if v_faltan is not null then
        raise exception
            'El grant sobre especialidades_todas_no_vacias no quedó para: %. El alta de médicos seguiría rota.',
            v_faltan;
    end if;
end;
$$;

-- Fin de la migración.
