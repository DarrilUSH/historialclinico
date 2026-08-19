-- =============================================================================
-- Historial Médico — Migración 20260819210000: la lectura automática deja de
-- vivir sólo en una respuesta HTTP, y "Vincular" empieza a vincular de verdad
-- -----------------------------------------------------------------------------
-- Dos arreglos reportados por el dueño usando la app en su teléfono, en
-- producción, el 19/08/2026. Comparten migración porque los dos tocan la MISMA
-- fila provisional de `documents` -la que existe entre la subida y la
-- confirmación- y porque juntarlos evita dos `drop function` seguidos sobre
-- `confirmar_documento_recien_subido`.
--
-- =============================================================================
-- BUG 1 — "cuando está analizando un archivo y se bloquea el celular o se
--          cambia de aplicación se corta y larga error"
-- -----------------------------------------------------------------------------
-- QUÉ PASABA. `POST /api/documentos/extraer` devolvía la extracción COMPLETA
-- (título, fecha, categoría, institución, especialidad, médico, número de
-- orden, métricas de laboratorio y el duplicado semántico cotejado) ÚNICAMENTE
-- en el cuerpo de la respuesta HTTP. De todo eso, la fila sólo guardaba
-- `ai_summary` y `raw_ocr_text`. Si Android congelaba la pestaña -bloqueo de
-- pantalla, cambio de app- el `fetch` del cliente moría, y con él se perdía
-- TODO el trabajo: el servidor terminaba bien, gastaba la cuota de Gemini
-- igual, y la persona veía "No pudimos conectarnos para leer el documento".
-- Reproducido en local: con el `fetch` del cliente abortado a los 400 ms, la
-- fila quedaba con `ai_summary` escrito (el servidor SÍ había terminado) y la
-- pantalla mostraba el formulario vacío con el cartel de error.
--
-- QUÉ AGREGA ESTA MIGRACIÓN. Cinco columnas en `documents` para que el
-- RESULTADO de la lectura viva en la base, no en una respuesta que se puede
-- perder, más el estado de esa lectura para que el cliente pueda preguntar
-- "¿en qué anda?" cuando vuelve del bloqueo de pantalla:
--
--   ai_extraction            jsonb  — la extracción validada, tal cual la
--                                     entrega `validarExtraccion`.
--   ai_extraction_duplicate  jsonb  — el duplicado semántico cotejado (Capas
--                                     2/3), o NULL.
--   ai_extraction_status     text   — pendiente | procesando | listo | error.
--   ai_extraction_error      text   — el mensaje EN ESPAÑOL que corresponde
--                                     mostrar si la lectura falló de verdad.
--   ai_extraction_started_at timestamptz — cuándo se tomó la lectura en curso
--                                     (para poder retomar una que quedó
--                                     colgada; ver más abajo).
--
-- POR QUÉ NO HAY RPC NUEVO NI POLÍTICA NUEVA. Estas cinco columnas las escribe
-- `lib/documentos/extraccion-admin.ts` con `service_role`, exactamente por el
-- mismo motivo -y con el mismo contrato- que `lib/documentos/huella-admin.ts`
-- escribe `content_sha256`: `documents_update_administrador`
-- (`20260812220000_rls.sql`) exige `can_manage` para CUALQUIER `UPDATE` sobre
-- `documents`, y una cuidadora con SÓLO `can_upload` -el caso típico de un
-- perfil compartido- no lo tiene. Hasta hoy eso se notaba poco: el `UPDATE` de
-- `ai_summary` no se aplicaba y el route handler lo dejaba anotado en el log.
-- Desde que la RECUPERACIÓN depende de esa escritura, un no-op silencioso
-- dejaría el arreglo manco justo para quien más lo necesita. Y, como la
-- huella, esto NO es un dato que dicte el cliente: es 100 % derivado por el
-- servidor a partir de bytes que ya estaban en el bucket bajo ese mismo
-- `profile_id`, después de que el route handler verificó sesión + fila (RLS) +
-- `requerirPermiso(perfil, "upload")`. Sumar un SECURITY DEFINER más habría
-- agrandado justo la superficie que el hardening del Advisor
-- (`20260818190000_hardening_advisor.sql`) acababa de achicar.
--
-- POR QUÉ `ai_extraction_started_at` Y NO SÓLO EL ESTADO. Una lectura que se
-- toma el estado `procesando` y nunca lo suelta -la función serverless murió,
-- el proceso se reinició- dejaría el documento clavado para siempre. Con la
-- marca de tiempo, el módulo admin puede retomar una lectura cuya reserva ya
-- está vencida (`VENTANA_RECLAMO_MS`) en vez de esperar eternamente.
--
-- =============================================================================
-- BUG 2 — "cuando me detecta un doctor que ya está cargado aparece el botón
--          'Vincular' pero al tocarlo no hace absolutamente nada"
-- -----------------------------------------------------------------------------
-- QUÉ PASABA (la mitad que le toca a la base). `documents.doctor_id` existe
-- desde `20260812200000_schema_inicial.sql` con su índice y su
-- `on delete set null`, pero NINGÚN flujo lo escribía: "Vincular" sólo
-- normalizaba el TEXTO del campo "Médico", y `confirmar_documento_recien_subido`
-- ni siquiera recibía el id. El vínculo real -el que permitiría, mañana,
-- listar los estudios de un médico- no existía.
--
-- QUÉ AGREGA ESTA MIGRACIÓN. Un ONCEAVO parámetro `nuevo_doctor_id uuid` al
-- RPC de confirmación, con la MISMA verificación de pertenencia que ya hace
-- `resolverDoctorId` para `appointments.doctor_id`
-- (`app/(app)/(con-nav)/turnos/actions.ts`): el médico tiene que ser del MISMO
-- perfil del documento. Acá la verificación va adentro del RPC y no en la
-- Server Action, por dos motivos: el RPC ya tiene `fila.profile_id` a mano
-- (una consulta menos) y es la última palabra de todas las demás guardas de
-- esta confirmación, así que no tiene sentido que ésta viva en otro lado.
-- `documents_doctor_id_fkey` sólo exige que la fila exista en `doctors`, no
-- que sea del mismo perfil: sin este chequeo, un campo oculto editado a mano
-- dejaría el documento apuntando a un médico de otro historial.
--
-- POR QUÉ EL PARÁMETRO VA AL FINAL Y CON `DEFAULT NULL`. Mismo criterio que
-- las tres migraciones anteriores de este RPC: cualquier llamada existente con
-- 5, 6, 9 o 10 argumentos -incluidos los BLOQUES 8/8b/8e de
-- `scripts/test-rls.sql`, que esta migración no toca- sigue resolviendo contra
-- esta misma función sin ambigüedad.
--
-- POR QUÉ `drop function` Y NO SÓLO `create or replace`. Por cuarta vez, y por
-- la misma razón: `create or replace` con una lista de parámetros distinta NO
-- reemplaza, crea una SEGUNDA función sobrecargada, y entonces toda llamada
-- existente queda ambigua ("function ... is not unique"). Se dropea primero la
-- firma de diez parámetros para que quede una sola función viva -y para que el
-- BLOQUE 27 del arnés, que cuenta funciones por nombre, siga dando 20.
--
-- DE PASO: la confirmación LIMPIA lo que ya no hace falta. Una vez sellado
-- `confirmed_at`, la extracción cruda cumplió su función -los datos viven en
-- las columnas de verdad y en `lab_metrics`-, así que `ai_extraction`,
-- `ai_extraction_duplicate` y `ai_extraction_error` se ponen en NULL en el
-- MISMO `update`. Es el criterio de `docs/minimizacion-datos.md`: no se
-- conserva una segunda copia de datos de salud que ya no se usa para nada.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Las cinco columnas de la lectura automática
-- -----------------------------------------------------------------------------
alter table public.documents
    add column ai_extraction            jsonb,
    add column ai_extraction_duplicate  jsonb,
    add column ai_extraction_status     text        not null default 'pendiente',
    add column ai_extraction_error      text,
    add column ai_extraction_started_at timestamptz;

alter table public.documents
    add constraint documents_ai_extraction_status_valido
        check (ai_extraction_status in ('pendiente', 'procesando', 'listo', 'error'));

comment on column public.documents.ai_extraction is
    'Extracción de Gemini YA VALIDADA (lib/validacion/documento.schema.ts), guardada entera para que la pantalla de revisión pueda recuperarla si el teléfono se bloqueó mientras se leía el documento. Vive sólo durante la revisión: la confirmación la pone en NULL porque para entonces los datos ya están en title/document_date/category/institution/specialty/doctor_name/numero_orden y en lab_metrics.';

comment on column public.documents.ai_extraction_duplicate is
    'Duplicado SEMÁNTICO (Capas 2/3, lib/documentos/duplicados-semanticos.ts) cotejado junto con la extracción, con la fecha ya formateada para mostrar. NULL si no se encontró ninguno o si el cotejo -que es best-effort- falló. Se limpia al confirmar, igual que ai_extraction.';

comment on column public.documents.ai_extraction_status is
    'En qué anda la lectura automática de este documento: pendiente (nadie la disparó todavía), procesando (hay una corrida tomada, ver ai_extraction_started_at), listo (ai_extraction tiene el resultado) o error (ai_extraction_error tiene el mensaje en español). Lo escribe lib/documentos/extraccion-admin.ts; la pantalla de revisión lo consulta con GET /api/documentos/extraer para poder retomar después de un bloqueo de pantalla.';

comment on column public.documents.ai_extraction_error is
    'Mensaje EN ESPAÑOL, listo para mostrar, de la última lectura automática que falló de verdad (cuota, timeout de Gemini, respuesta ilegible). NULL mientras no haya fallado. Nunca guarda el error técnico crudo: eso va al log del servidor.';

comment on column public.documents.ai_extraction_started_at is
    'Cuándo se tomó la corrida de lectura que está en curso. Existe para poder RETOMAR una lectura que quedó colgada (la función serverless murió a mitad de camino): pasada la ventana de lib/documentos/extraccion-admin.ts, otra corrida puede reclamarla. NULL si no hay ninguna en curso.';

-- Índice parcial pensado para el único acceso que no es por `id`: buscar
-- lecturas colgadas. Chico por construcción (sólo las filas en curso).
create index documents_extraccion_en_curso_idx
    on public.documents (ai_extraction_started_at)
    where ai_extraction_status = 'procesando';


-- -----------------------------------------------------------------------------
-- 2. confirmar_documento_recien_subido — onceavo parámetro `nuevo_doctor_id`
-- -----------------------------------------------------------------------------
-- Todo lo demás queda EXACTAMENTE igual que en
-- `20260819190000_lab_metrics_resultados_cualitativos.sql`: no se afloja ni se
-- reordena ninguna de las seis guardas.
-- -----------------------------------------------------------------------------

drop function if exists public.confirmar_documento_recien_subido(
    uuid, text, text, date, text, jsonb, text, text, text, text
);

create or replace function public.confirmar_documento_recien_subido(
    doc_id             uuid,
    nuevo_titulo       text,
    nueva_categoria    text,
    nueva_fecha        date,
    nuevo_resumen      text,
    metricas           jsonb default null,
    nueva_institucion  text default null,
    nueva_especialidad text default null,
    nuevo_medico       text default null,
    nuevo_numero_orden text default null,
    nuevo_doctor_id    uuid default null
)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
    fila                public.documents%rowtype;
    titulo_limpio       text;
    categoria_valida    public.doc_category;
    resumen_limpio      text;
    institucion_limpia  text;
    especialidad_limpia text;
    medico_limpio       text;
    numero_orden_limpio text;
    metrica             jsonb;
    v_nombre            text;
    v_tiene_valor       boolean;
    v_tiene_valor_texto boolean;
begin
    -- Guarda 4 (valores del documento). Idéntica a la versión anterior.
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

    -- Guarda 5 (métricas de laboratorio). Idéntica a la versión anterior: una
    -- métrica vale con valor numérico, con value_text cualitativo, o con los
    -- dos — nunca con ninguno.
    if metricas is not null then
        if jsonb_typeof(metricas) is distinct from 'array' then
            raise exception
                'Las métricas deben enviarse como una lista.'
                using errcode = 'invalid_parameter_value';
        end if;

        if jsonb_array_length(metricas) > 50 then
            raise exception
                'No se pueden guardar más de 50 métricas por documento.'
                using errcode = 'invalid_parameter_value';
        end if;

        for metrica in select * from jsonb_array_elements(metricas)
        loop
            if jsonb_typeof(metrica) is distinct from 'object' then
                raise exception
                    'Cada métrica debe ser un objeto con nombre y valor.'
                    using errcode = 'invalid_parameter_value';
            end if;

            v_nombre := nullif(btrim(metrica->>'metric_name'), '');
            if v_nombre is null then
                raise exception
                    'Cada métrica debe tener un nombre.'
                    using errcode = 'invalid_parameter_value';
            end if;

            if char_length(v_nombre) > 200 then
                raise exception
                    'El nombre de la métrica "%" es demasiado largo (máx. 200 caracteres).', v_nombre
                    using errcode = 'invalid_parameter_value';
            end if;

            v_tiene_valor := metrica ? 'value'
                and jsonb_typeof(metrica->'value') = 'number';
            v_tiene_valor_texto := metrica ? 'value_text'
                and jsonb_typeof(metrica->'value_text') = 'string'
                and char_length(btrim(metrica->>'value_text')) > 0;

            if not v_tiene_valor and not v_tiene_valor_texto then
                raise exception
                    'La métrica "%" necesita un valor numérico o un resultado cualitativo (texto).', v_nombre
                    using errcode = 'invalid_parameter_value';
            end if;

            if metrica ? 'value_text'
               and jsonb_typeof(metrica->'value_text') = 'string'
               and char_length(metrica->>'value_text') > 300
            then
                raise exception
                    'El resultado cualitativo de la métrica "%" es demasiado largo (máx. 300 caracteres).', v_nombre
                    using errcode = 'invalid_parameter_value';
            end if;

            if metrica ? 'unit'
               and jsonb_typeof(metrica->'unit') = 'string'
               and char_length(metrica->>'unit') > 50
            then
                raise exception
                    'La unidad de la métrica "%" es demasiado larga (máx. 50 caracteres).', v_nombre
                    using errcode = 'invalid_parameter_value';
            end if;

            if metrica ? 'reference_range'
               and jsonb_typeof(metrica->'reference_range') = 'string'
               and char_length(metrica->>'reference_range') > 200
            then
                raise exception
                    'El rango de referencia de la métrica "%" es demasiado largo (máx. 200 caracteres).', v_nombre
                    using errcode = 'invalid_parameter_value';
            end if;
        end loop;
    end if;

    -- Guarda 6 (institución, especialidad, médico, número de orden). Idéntica.
    institucion_limpia := nullif(btrim(coalesce(nueva_institucion, '')), '');
    if institucion_limpia is not null and char_length(institucion_limpia) > 150 then
        raise exception
            'La institución es demasiado larga (máx. 150 caracteres).'
            using errcode = 'invalid_parameter_value';
    end if;

    especialidad_limpia := nullif(btrim(coalesce(nueva_especialidad, '')), '');
    if especialidad_limpia is not null and char_length(especialidad_limpia) > 100 then
        raise exception
            'La especialidad es demasiado larga (máx. 100 caracteres).'
            using errcode = 'invalid_parameter_value';
    end if;

    medico_limpio := nullif(btrim(coalesce(nuevo_medico, '')), '');
    if medico_limpio is not null and char_length(medico_limpio) > 100 then
        raise exception
            'El nombre del médico es demasiado largo (máx. 100 caracteres).'
            using errcode = 'invalid_parameter_value';
    end if;

    numero_orden_limpio := nullif(btrim(coalesce(nuevo_numero_orden, '')), '');
    if numero_orden_limpio is not null and char_length(numero_orden_limpio) > 60 then
        raise exception
            'El número de orden es demasiado largo (máx. 60 caracteres).'
            using errcode = 'invalid_parameter_value';
    end if;

    select * into fila from public.documents d where d.id = doc_id for update;

    if not found then
        raise exception
            'No encontramos ese documento, o no podés confirmarlo.'
            using errcode = 'insufficient_privilege';
    end if;

    if fila.created_by_profile_id is distinct from public.perfil_actor() then
        raise exception
            'Solo la persona que subió este documento puede confirmarlo.'
            using errcode = 'insufficient_privilege';
    end if;

    if fila.created_at < now() - interval '1 hour' then
        raise exception
            'Pasó más de una hora desde que se subió este documento. Pedile a quien administra este perfil que lo corrija.'
            using errcode = 'insufficient_privilege';
    end if;

    if fila.confirmed_at is not null then
        raise exception
            'Este documento ya fue confirmado.'
            using errcode = 'insufficient_privilege';
    end if;

    -- Guarda 7 (médico vinculado — nueva de esta migración). Va DESPUÉS del
    -- SELECT porque necesita `fila.profile_id`: el médico tiene que ser del
    -- MISMO perfil del documento. Ver el encabezado para el porqué.
    if nuevo_doctor_id is not null
       and not exists (
           select 1
             from public.doctors d
            where d.id = nuevo_doctor_id
              and d.profile_id = fila.profile_id
       )
    then
        raise exception
            'El médico elegido no es válido, o no pertenece a este directorio. Volvé a elegirlo de la lista.'
            using errcode = 'invalid_parameter_value';
    end if;

    update public.documents
       set title                   = titulo_limpio,
           category                = categoria_valida,
           document_date           = nueva_fecha,
           ai_summary              = resumen_limpio,
           institution             = institucion_limpia,
           specialty               = especialidad_limpia,
           doctor_name             = medico_limpio,
           doctor_id               = nuevo_doctor_id,
           numero_orden            = numero_orden_limpio,
           confirmed_at            = now(),
           -- La revisión terminó: la copia cruda de la lectura automática ya
           -- no se usa para nada (docs/minimizacion-datos.md).
           ai_extraction           = null,
           ai_extraction_duplicate = null,
           ai_extraction_error     = null
     where id = doc_id
    returning * into fila;

    if metricas is not null and jsonb_array_length(metricas) > 0 then
        insert into public.lab_metrics (
            document_id,
            profile_id,
            metric_name,
            metric_canonical,
            value,
            value_text,
            unit,
            reference_range,
            reference_min,
            reference_max,
            measurement_date
        )
        select
            doc_id,
            fila.profile_id,
            btrim(m->>'metric_name'),
            nullif(btrim(m->>'metric_canonical'), ''),
            case when jsonb_typeof(m->'value') = 'number' then (m->>'value')::numeric end,
            nullif(btrim(m->>'value_text'), ''),
            nullif(btrim(m->>'unit'), ''),
            nullif(btrim(m->>'reference_range'), ''),
            case when jsonb_typeof(m->'reference_min') = 'number' then (m->>'reference_min')::numeric end,
            case when jsonb_typeof(m->'reference_max') = 'number' then (m->>'reference_max')::numeric end,
            nueva_fecha
          from jsonb_array_elements(metricas) as m
         on conflict (document_id, metric_name) do nothing;
    end if;

    return fila;
end;
$$;

comment on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text, text, uuid) is
    'Confirmación acotada de la pantalla de revisión (Sprint 4, tareas 4.5/4.6; Sprint 5, metadatos; hotfix de duplicados semánticos, número de orden; Sprint 18, resultados cualitativos; hotfix 19/08/2026, médico vinculado): permite al CREADOR actualizar título/categoría/fecha/resumen/institución/especialidad/médico/número de orden de SU PROPIO documento recién subido -sólo dentro de la primera hora y sólo si confirmed_at es NULL- e insertar sus métricas en lab_metrics, todo en una transacción. nuevo_doctor_id (opcional) persiste el vínculo con el directorio en documents.doctor_id y se verifica contra doctors del MISMO perfil del documento -documents_doctor_id_fkey sólo exige que la fila exista, no que sea del mismo historial-. La confirmación además limpia la copia cruda de la lectura automática (ai_extraction / ai_extraction_duplicate / ai_extraction_error), que ya cumplió su función. SECURITY DEFINER por el mismo motivo de siempre: documents_update_administrador exige can_manage y can_upload no lo tiene.';


-- -----------------------------------------------------------------------------
-- 3. Privilegios de ejecución de la firma nueva
-- -----------------------------------------------------------------------------
-- Mismo patrón que todas las migraciones anteriores de este RPC, y misma lista
-- blanca que fijó `20260818190000_hardening_advisor.sql`: CREATE FUNCTION
-- otorga EXECUTE a PUBLIC por defecto, así que se revoca y se vuelve a otorgar
-- SÓLO a authenticated y service_role. `anon` no puede invocarla.
revoke execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text, text, uuid) from public;
grant execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text, text, uuid) to authenticated;
grant execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text, text, uuid) to service_role;

-- Fin de la migración.
