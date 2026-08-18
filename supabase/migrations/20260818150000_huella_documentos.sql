-- =============================================================================
-- Historial Médico — Migración 20260818150000: huella digital de archivos para
-- no cargar dos veces el mismo estudio (hotfix de producto, Sprint 17 en vivo)
-- -----------------------------------------------------------------------------
-- ── EL BUG QUE ESTO CORRIGE
--
-- Primer uso real de la ingesta de Gmail (17.2): al usuario le llegaron dos
-- correos DISTINTOS -un reenvío "RV:" con segundos de diferencia sobre el
-- original- con EL MISMO PDF adjunto. El dedup por `gmail_message_id`
-- funcionó exactamente como tenía que funcionar (`20260818140000` §"la clave
-- de dedup"): eran dos mensajes de Gmail genuinamente distintos, así que las
-- dos filas de `gmail_messages` se registraron, sin que eso sea un error. Lo
-- que faltaba es la capa siguiente: nada compara el CONTENIDO del archivo, así
-- que si la persona toca "Revisar este estudio" en los dos correos, el estudio
-- entra dos veces al historial sin ningún aviso.
--
-- ── LA COLUMNA: UNA HUELLA, NO UNA RESTRICCIÓN
--
-- `content_sha256` guarda el hash SHA-256 (hex, 64 caracteres) de los BYTES del
-- archivo, calculado en el servidor en `ingestarDocumento`
-- (`lib/documentos/ingesta.ts`) antes de subir nada a Storage. Es NULLABLE y NO
-- lleva UNIQUE: el cotejo es una AYUDA para que la persona decida, no un
-- candado. "Cargar igual" (lib/documentos/huella.ts) es una decisión legítima
-- -dos estudios distintos pueden coincidir byte a byte en casos raros, y sobre
-- todo, la persona es quien más sabe si dos archivos idénticos son en
-- realidad el mismo estudio o dos copias que sí quiere conservar-, así que la
-- base tiene que PERMITIR que dos filas del mismo perfil compartan huella.
--
-- ── SIN BACKFILL EN SQL, A PROPÓSITO
--
-- Los BYTES de un documento ya cargado viven en Storage, no en esta tabla:
-- una migración SQL no puede leerlos ni hashearlos. Los documentos anteriores
-- a esta migración nacen con `content_sha256 = NULL` y se completan RECIÉN
-- cuando hace falta -la próxima vez que esa persona sube algo a ESE perfil, el
-- cotejo dispara un backfill perezoso y acotado
-- (`lib/documentos/huella-admin.ts#backfillHuellasFaltantes`, patrón admin ya
-- usado por `lib/storage-admin.ts#descargarObjeto`)-. No hace falta ningún
-- script one-shot contra producción: el primer cotejo de cada perfil hace el
-- trabajo solo, de a tandas razonables, y si Storage falla para alguna fila el
-- cotejo sigue sin ella -best-effort, nunca bloquea una carga nueva-.
--
-- ── ESTA MIGRACIÓN NO TOCA RLS
--
-- Las políticas vigentes (`documents_select_puede_ver`,
-- `documents_insert_puede_cargar`, `documents_update_administrador`,
-- `20260812220000_rls.sql`) ya operan por FILA sobre `public.documents`, y una
-- columna nueva de una tabla ya cubierta hereda exactamente la misma decisión
-- de autorización sin que haga falta tocar ninguna política -mismo
-- razonamiento que ya documentaron `20260814120000` §4 para
-- `display_density` y `20260817231000` (tarea 16.1) para las columnas de
-- ciudad/provincia-. En particular: quien puede VER un documento de un perfil
-- ya puede ver su `content_sha256` (no es un dato más sensible que el resto de
-- la fila), y el backfill perezoso escribe la columna con `service_role`
-- -mismo criterio que `lib/gmail/mensajes-admin.ts`- para no depender de que
-- quien dispara el cotejo tenga `can_manage` sobre el perfil: alcanza con el
-- `can_upload` que `ingestarDocumento` ya exige más arriba en la pila, y el
-- valor que se escribe es 100% derivado por el servidor a partir de bytes que
-- YA estaban en el bucket -no es un dato que el cliente pueda dictar-.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema.
-- =============================================================================

alter table public.documents
    add column content_sha256 text;

alter table public.documents
    add constraint documents_content_sha256_valido
        check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

comment on column public.documents.content_sha256 is
    'SHA-256 (hex, 64 caracteres) de los BYTES del archivo, calculado en ingestarDocumento antes de subir a Storage. NULL en documentos anteriores a esta migración hasta que un cotejo posterior los backfillea perezosamente (lib/documentos/huella-admin.ts). NO es UNIQUE: dos filas del mismo perfil pueden compartir huella a propósito -el cotejo avisa, no bloquea-. Detecta archivos BYTE A BYTE IDÉNTICOS; un PDF regenerado por la clínica con el mismo contenido visible pero bytes distintos no matchea (deuda declarada, docs/gmail-ingesta.md).';

-- El cotejo de duplicados es "¿este perfil ya tiene un documento con esta
-- huella?" -exactamente lo que puede resolver un índice parcial por
-- (profile_id, content_sha256), sin pagar espacio de índice en las filas que
-- todavía no tienen huella (la mayoría, hasta que el backfill perezoso las
-- alcance).
create index documents_perfil_huella_idx
    on public.documents (profile_id, content_sha256)
    where content_sha256 is not null;

comment on index public.documents_perfil_huella_idx is
    'Sostiene el cotejo de duplicados por contenido: "¿profile_id ya tiene un documento con esta huella?" (lib/documentos/huella.ts#buscarDuplicadoPorHuella). Parcial: solo indexa filas con huella calculada.';

-- Fin de la migración.
