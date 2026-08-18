-- =============================================================================
-- Historial Médico — Migración 20260818120000: contracción de doctors.specialty
-- (Sprint 17; cierra la fase 2 del expandir-contraer abierto en 20260818090000)
-- -----------------------------------------------------------------------------
-- La 20260818090000 (Sprint 16, tarea 16.2) migró a `doctors.specialties`
-- (text[]) y dejó `specialty` EN DESUSO —nullable, sin lectores— en vez de
-- eliminarla, porque el código que la leía seguía vivo en producción durante
-- la ventana entre el `db push` y el deploy (ver su encabezado, sección
-- "`specialty` QUEDA EN DESUSO ACÁ").
--
-- Esta migración es la fase de CONTRACCIÓN. Viaja en el ciclo de `db push`
-- del Sprint 17: para cuando se aplique, el código desplegado hace días que
-- consulta columnas explícitas sin `specialty` (verificado en la auditoría de
-- 16.2: cero referencias en app/, components/, lib/; los tipos generados la
-- listan pero ningún SELECT la pide). La ventana db-push→deploy de ESTE ciclo
-- no la afecta: el código viejo de este ciclo ya es el que no la usa.
--
-- El helper `especialidades_todas_no_vacias()` y los CHECKs de `specialties`
-- NO se tocan: pertenecen a la columna nueva, que sigue.
--
-- UTF-8 sin BOM.
-- =============================================================================

alter table public.doctors
    drop column specialty;

-- Fin de la migración.
