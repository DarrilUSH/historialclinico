-- =============================================================================
-- Historial Médico — Migración 20260812190000: extensiones requeridas
-- -----------------------------------------------------------------------------
-- Timestamped ANTES del esquema inicial a propósito: corre primero.
--
-- En el stack local el CLI habilita pg_cron y pg_net por configuración, así que
-- las migraciones que los usan (recordatorios 050000, alertas 070000) nunca
-- fallaron. En Supabase cloud las extensiones se habilitan por proyecto: sin
-- esta migración, `supabase db push` contra un proyecto nuevo se caería al
-- llegar al primer `cron.schedule`. `if not exists` la hace inocua en local
-- (donde ya están) y re-aplicable en cualquier entorno.
--
-- Vault (supabase_vault) no se toca: viene preinstalado en cloud y en el CLI.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;
