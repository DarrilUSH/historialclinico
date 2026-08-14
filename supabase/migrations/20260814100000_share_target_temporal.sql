-- =============================================================================
-- Historial Médico — Migración 20260814100000: almacenamiento temporal del
-- Web Share Target (Sprint 11, tarea 11.2)
-- =============================================================================
-- Cuando alguien comparte un PDF o una foto desde OTRA app (galería, Gmail,
-- WhatsApp) hacia "Historial Médico", el sistema operativo hace un POST a
-- `/api/compartir` (`share_target` en `app/manifest.ts`). En ese momento
-- todavía NO sabemos a qué PERFIL corresponde el archivo -es una app
-- multiperfil (ROADMAP_SPRINTS.md, tarea 11.2)-, así que no podemos usar el
-- pipeline normal de `lib/documentos/ingesta.ts`: ese pipeline exige un
-- `profile_id` desde el primer segmento del path de Storage (contrato de
-- `supabase/migrations/20260812230000_storage.sql` §"EL PUENTE ES LA
-- CONVENCIÓN DE PATH") y una fila de `documents` con `profile_id NOT NULL`.
--
-- Esta migración crea el área de espera: un bucket y una tabla que guardan el
-- archivo SOLO hasta que la persona elige el perfil de destino en
-- `/compartir` (`app/(app)/(sin-nav)/compartir/page.tsx`). En ese momento
-- `lib/documentos/ingesta.ts` toma la posta sin cambios: descarga el archivo
-- de acá, lo re-sube como un documento real del perfil elegido, y esta fila
-- se borra. Nunca hay una fila de `documents` sin perfil.
--
-- ── ALTERNATIVAS EVALUADAS (y por qué NO)
--
-- 1. "Prefijo `compartidos-temp/{user_id}/` DENTRO del bucket
--    `documentos-medicos`" (la sugerencia inicial de la tarea). Se descartó:
--    `perfil_de_objeto_storage()` interpreta el PRIMER segmento del path como
--    `profile_id`; un archivo sin perfil todavía rompería esa convención (o
--    exigiría una segunda función que distinga "esto es un profile_id" de
--    "esto es la palabra compartidos-temp", una rama más en una función que
--    hoy es simple y `immutable`). Mezclar objetos CON fila de `documents` y
--    objetos SIN ella en el mismo bucket también rompe el invariante "todo
--    objeto de `documentos-medicos` tiene una fila que lo referencia", útil
--    para cualquier auditoría futura de huérfanos.
-- 2. "Perfil `profile_id` nullable en `documents`, INSERT inmediato sin
--    perfil." Se descartó: son días de trabajo para revisar CADA política RLS
--    y CADA función `SECURITY DEFINER` de `documents` (todas asumen
--    `profile_id` no nulo), a cambio de nada -el documento sin perfil no se
--    puede mostrar en ningún lado igual-. Desproporcionado para este sprint.
-- 3. **Elegida: bucket propio (`compartidos-temp`) + tabla propia
--    (`shared_uploads_temp`), sin fila de `documents`.** El path usa
--    `user_id` (la CUENTA de Supabase Auth que compartió, no un perfil
--    todavía) como primer segmento -mismo espíritu que el `profile_id` como
--    puente en los otros tres buckets, pero acá el dueño real en este momento
--    es la cuenta, no un perfil-. Bucket sin NINGUNA política de
--    `storage.objects`: como todas las políticas existentes filtran por
--    `bucket_id in (...)` a los tres buckets del producto (§3 de
--    `20260812230000_storage.sql`), un bucket nuevo sin política propia queda
--    con RLS en negación por defecto para `anon`/`authenticated` sin escribir
--    una sola regla -exactamente lo que hace falta: nadie del lado cliente
--    puede leer ni escribir acá, solo `service_role`-.
--
-- ── TTL Y PURGA: LA MISMA DEUDA QUE `storage_purge_queue`, DECLARADA IGUAL
--
-- `expires_at` (default 1 hora, igual que la ventana de confirmación de
-- `confirmar_documento_recien_subido`) es el contrato: pasada esa hora, el
-- archivo se considera abandonado. La purga real corre del lado de la
-- aplicación (`lib/documentos/compartir-temporal.ts`,
-- `purgarCompartidosVencidos`) de forma PEREZOSA: cada vez que la MISMA
-- cuenta vuelve a compartir algo o abre `/compartir`, se barren sus propias
-- filas vencidas antes de seguir. Cubre el caso común (alguien comparte,
-- decide no continuar, y más tarde comparte otra cosa o el mismo archivo).
--
-- Lo que NO cubre: una cuenta que comparte una vez y nunca vuelve a tocar la
-- función dejaría su archivo temporal vivo más allá de la hora, hasta que
-- alguna corrida futura lo barra. Es la MISMA situación, con el MISMO
-- alcance, que `storage_purge_queue` (`20260812210000_ajustes_modelo.sql`):
-- ese comentario dice textualmente "el job que la drena... es del Sprint 6"
-- y, a la fecha de esta migración (Sprint 11), ese job todavía no se
-- escribió -es deuda declarada y aceptada del proyecto, no un olvido de esta
-- tarea-. Construir acá un TERCER job de `pg_cron` (que sí tiene precedente
-- funcionando: `20260813050000_recordatorios_turnos.sql`, `pg_cron` + `pg_net`
-- + secretos en Vault + `x-cron-secret`) sería MÁS automatización que la que
-- tiene hoy el propio mecanismo que le sirve de referencia, y exige
-- configuración manual de Vault en cada entorno (local y producción) que
-- nadie puede verificar sin desplegar. Se documenta como el mismo tipo de
-- deuda en `docs/share-target.md` §6, con la peor consecuencia acotada: el
-- archivo queda en un bucket privado sin política de cliente (nadie más lo
-- puede leer) hasta que se barra.
--
-- ── EL REVOKE NO ES DECORATIVO
--
-- Supabase trae `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
-- authenticated`: toda tabla nueva de `public` nace con TRUNCATE para los dos
-- roles públicos, y RLS no protege de un TRUNCATE. Sin este revoke, cualquier
-- sesión podría vaciar la tabla entera de archivos en espera de otras
-- cuentas.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema, igual que el resto
-- del proyecto.
-- =============================================================================


-- =============================================================================
-- 1. BUCKET
-- -----------------------------------------------------------------------------
-- Mismo límite que `documentos-medicos` (25 MiB) y los mismos cuatro MIME: es
-- literalmente el mismo archivo, todavía sin perfil asignado.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'compartidos-temp', 'compartidos-temp', false, 26214400,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- A propósito NO hay ninguna política de `storage.objects` para este bucket:
-- ver el punto 3 de "ALTERNATIVAS EVALUADAS" arriba. Sin una política que lo
-- mencione, `anon` y `authenticated` no pueden leer, subir, ni borrar ningún
-- objeto de `compartidos-temp` — la negación por defecto de RLS. Solo
-- `service_role` (que la salta) puede tocarlo, y solo lo toca
-- `lib/documentos/compartir-temporal.ts` (subida en el receptor, descarga y
-- borrado al elegir perfil o al descartar).


-- =============================================================================
-- 2. TABLA shared_uploads_temp
-- -----------------------------------------------------------------------------
-- Una fila = un archivo recibido por Share Target, todavía sin perfil de
-- destino. `user_id` (no `profile_id`: no hay perfil elegido todavía) ata la
-- fila a la CUENTA que compartió, la única identidad que existe en este
-- momento del flujo.
-- =============================================================================

create table public.shared_uploads_temp (
    id                 uuid primary key default gen_random_uuid(),
    user_id            uuid not null references auth.users (id) on delete cascade,
    storage_path       text not null,
    mime_type          text not null,
    original_filename  text not null,
    file_size_bytes    bigint not null,
    created_at         timestamptz not null default now(),
    expires_at         timestamptz not null default (now() + interval '1 hour'),

    constraint shared_uploads_temp_mime_valido
        check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
    constraint shared_uploads_temp_tamano_positivo
        check (file_size_bytes > 0),
    constraint shared_uploads_temp_nombre_no_vacio
        check (char_length(btrim(original_filename)) > 0),
    constraint shared_uploads_temp_path_no_es_url
        check (char_length(btrim(storage_path)) > 0
               and lower(storage_path) not like 'http%'),
    constraint shared_uploads_temp_expira_despues_de_crear
        check (expires_at > created_at)
);

comment on table public.shared_uploads_temp is
    'Área de espera del Web Share Target (Sprint 11, tarea 11.2): un archivo recibido desde otra app, todavía sin perfil de destino elegido. Sin políticas de INSERT/UPDATE para authenticated a propósito: solo la crea el receptor `/api/compartir` con service_role, después de verificar la sesión. La fila desaparece al elegir perfil (se re-ingesta con lib/documentos/ingesta.ts y se borra) o al descartar; si nadie vuelve, queda para la purga perezosa (ver el encabezado de esta migración).';
comment on column public.shared_uploads_temp.user_id is
    'Cuenta de Supabase Auth que compartió el archivo (auth.uid() en el momento del POST). NO es un profile_id: el perfil de destino todavía no se eligió.';
comment on column public.shared_uploads_temp.storage_path is
    'Path dentro del bucket compartidos-temp: "{user_id}/{uuid}.{ext}". Igual que en los otros buckets, nunca una URL (lo impide el CHECK).';
comment on column public.shared_uploads_temp.mime_type is
    'MIME real detectado por magic bytes en el receptor (lib/archivos/validacion.ts), no el que declaró el navegador.';
comment on column public.shared_uploads_temp.original_filename is
    'Nombre de archivo tal como lo mandó el sistema operativo al compartir. Se muestra en la vista previa de /compartir; lib/documentos/ingesta.ts lo vuelve a procesar con tituloDesdeNombre() al confirmar el perfil, igual que cualquier otra subida.';
comment on column public.shared_uploads_temp.file_size_bytes is
    'Tamaño en bytes, ya validado contra el mismo límite que documentos-medicos (25 MiB).';
comment on column public.shared_uploads_temp.expires_at is
    'Default: 1 hora desde created_at, la misma ventana que confirmar_documento_recien_subido. Pasada esta marca la fila se considera abandonada y la purga perezosa (lib/documentos/compartir-temporal.ts) la elimina junto con su objeto de Storage.';

-- "Mis propios archivos en espera, de más reciente a más viejo" — la consulta
-- de /compartir. También sirve para la purga perezosa (WHERE user_id = ...).
create index shared_uploads_temp_user_id_idx
    on public.shared_uploads_temp (user_id, created_at desc);

-- Sirve para una futura purga administrativa por lote (drenar TODAS las filas
-- vencidas, no solo las de una cuenta) si algún día se escribe ese job — el
-- mismo tipo de índice que storage_purge_queue_pendientes_idx.
create index shared_uploads_temp_vencidos_idx
    on public.shared_uploads_temp (expires_at);


-- =============================================================================
-- 3. RLS Y PRIVILEGIOS
-- =============================================================================

alter table public.shared_uploads_temp enable row level security;

revoke all on public.shared_uploads_temp from anon, authenticated;

-- Solo SELECT y DELETE para authenticated: leer la propia vista previa en
-- /compartir, y borrar la propia fila al descartar (o al purgar perezosamente
-- las propias filas vencidas). Sin INSERT ni UPDATE: la fila nace en el
-- receptor con service_role y nunca se edita, solo se borra.
grant select, delete on public.shared_uploads_temp to authenticated;
grant select, insert, update, delete on public.shared_uploads_temp to service_role;

create policy shared_uploads_temp_select_propio
    on public.shared_uploads_temp
    for select to authenticated
    using (user_id = auth.uid());

create policy shared_uploads_temp_delete_propio
    on public.shared_uploads_temp
    for delete to authenticated
    using (user_id = auth.uid());

comment on policy shared_uploads_temp_select_propio on public.shared_uploads_temp is
    'Una cuenta solo ve sus propios archivos en espera. auth.uid() directo (no hay perfil todavía, así que no aplica puede_ver_perfil ni perfil_actor()).';
comment on policy shared_uploads_temp_delete_propio on public.shared_uploads_temp is
    'Una cuenta solo borra sus propios archivos en espera: al descartar desde /compartir, o en la purga perezosa de sus propias filas vencidas.';

-- Fin de la migración.
