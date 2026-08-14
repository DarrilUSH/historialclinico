-- =============================================================================
-- Historial Médico — Migración 20260814110000: correcciones de la auditoría de
-- seguridad de RLS y Storage (Sprint 11, tarea 11.4)
-- =============================================================================
-- Dos hallazgos de la auditoría sistemática documentada en
-- `docs/auditoria-seguridad.md`. Ninguno de los dos es una fuga: los dos son
-- desviaciones respecto del contrato que el propio proyecto declara, y que
-- hoy solo NO se explotan porque una segunda capa las tapa. Corregirlas
-- devuelve el sistema al modelo de tres capas de `docs/seguridad-rls.md` §1,
-- donde las tres dicen lo mismo a propósito.
--
-- ── HALLAZGO A-01 (severidad MEDIA): `consultation_sheets` concede UPDATE y
--    DELETE a `authenticated` sin ninguna política que los ejerza.
--
-- `20260814090000_fichas.sql` declara textualmente en su encabezado:
--
--     ·  UPDATE ni DELETE: es un documento emitido. Cambió de opinión o hay
--        un error → regenera (inserta una fila nueva). Esto mantiene el
--        historial exacto de lo que se generó y cuándo.
--
-- y acto seguido ejecuta `grant select, insert, update, delete ... to
-- authenticated`. Hoy no hay fuga: sin política de UPDATE ni de DELETE, RLS
-- filtra CERO filas y las dos operaciones no tocan nada (lo verifica el
-- BLOQUE 15 del arnés). Pero la inmutabilidad de una ficha clínica emitida
-- queda sostenida por una sola capa —la AUSENCIA de una política—, que es la
-- más fácil de perder: alcanza con que una migración futura agregue un
-- `for all` o un `for update` amplio sobre la tabla para que el privilegio
-- que ya está concedido se vuelva efectivo, sin que nadie note que se está
-- habilitando la reescritura de un documento emitido.
--
-- El propio proyecto ya tiene el precedente de cómo se hace bien:
-- `access_logs` es append-only y lo es porque `authenticated` **no tiene el
-- privilegio** de UPDATE ni de DELETE (`20260812220000_rls.sql` §5.5), no
-- porque falte la política. El BLOQUE 7 del arnés lo vigila con una
-- aserción explícita desde el Sprint 1. Esta migración le da a
-- `consultation_sheets` exactamente el mismo tratamiento, y el arnés suma la
-- aserción equivalente para que no se pueda volver atrás en silencio.
--
-- Efecto observable del cambio: un UPDATE o un DELETE del cliente sobre
-- `consultation_sheets` pasa de "afecta 0 filas en silencio" a "error 42501
-- insufficient_privilege". Es el mismo cambio de forma que ya tienen
-- `storage_purge_queue` y `appointment_reminders`, y el que espera cualquiera
-- que lea el encabezado de la migración de fichas. Ningún código de la
-- aplicación hace UPDATE ni DELETE sobre esta tabla (verificado en la
-- auditoría: `grep -rn "consultation_sheets" lib/ app/` no tiene un solo
-- `.update(` ni `.delete(`), así que no hay nada que adaptar.
--
-- ── HALLAZGO A-02 (severidad BAJA): las dos políticas de
--    `shared_uploads_temp` llaman a `auth.uid()` sin envolver.
--
-- `20260814100000_share_target_temporal.sql` escribió `using (user_id =
-- auth.uid())`. Las otras 58 políticas del proyecto usan `(select
-- auth.uid())`. La diferencia NO es de seguridad —el predicado decide
-- exactamente lo mismo— sino de plan: sin el `select`, Postgres trata a
-- `auth.uid()` como una expresión correlacionada y la vuelve a evaluar UNA VEZ
-- POR FILA examinada; con el `select` la convierte en un InitPlan que se
-- evalúa una sola vez por sentencia. Es el patrón `auth_rls_initplan` que
-- recomienda el linter de Supabase y la convención declarada en
-- `docs/seguridad-rls.md` §2.3 ("`STABLE`: el planner las evalúa una vez por
-- sentencia, no una vez por fila").
--
-- Se corrige acá, y no se deja como deuda, porque el costo es una línea y
-- porque una excepción sin motivo a una convención de seguridad es
-- justamente lo que hace que la próxima persona no sepa cuál de las dos
-- formas es la correcta.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema, igual que el resto
-- del proyecto.
-- =============================================================================


-- =============================================================================
-- 1. A-01 — `consultation_sheets` vuelve a ser append-only también en la capa
--    de privilegio, no solo en la de políticas.
-- =============================================================================

revoke update, delete on public.consultation_sheets from authenticated;

comment on table public.consultation_sheets is
    'Historial inmutable de fichas de consulta generadas (Sprint 10, tarea 10.5). Append-only para las sesiones de usuario en las DOS capas: `authenticated` tiene GRANT solo de SELECT e INSERT (auditoría 11.4, hallazgo A-01), y no existe política de UPDATE ni de DELETE. Corregir una ficha se hace generando otra: el historial guarda lo que se emitió y cuándo. Mismo tratamiento que access_logs.';


-- =============================================================================
-- 2. A-02 — `shared_uploads_temp`: `auth.uid()` envuelto en `(select ...)`,
--    igual que las otras 58 políticas del proyecto.
-- =============================================================================
-- `alter policy` reescribe el predicado sin soltar la política en ningún
-- momento: no hay una ventana en la que la tabla quede sin regla.

alter policy shared_uploads_temp_select_propio
    on public.shared_uploads_temp
    using (user_id = (select auth.uid()));

alter policy shared_uploads_temp_delete_propio
    on public.shared_uploads_temp
    using (user_id = (select auth.uid()));

-- Fin de la migración.
