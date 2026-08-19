-- =============================================================================
-- Historial Médico — Migración 20260819190000: resultados CUALITATIVOS de
-- laboratorio — "Negativo", "No reactivo", "No se observan espermatozoides"
-- ya no se pierden
-- -----------------------------------------------------------------------------
-- ── EL PROBLEMA
--
-- `lab_metrics.value` es `numeric not null` desde el esquema inicial: pensada
-- para "Glucemia: 95", nunca contempló un estudio cuyo resultado ES texto.
-- Evidencia real del dueño del historial: "Strep A: Negativo", "HIV: no
-- reactivo", "VDRL: no reactivo", "HBsAg: no reactivo", "Plaquetas:
-- aumentadas", "No se observan espermatozoides" (su control post-vasectomía)
-- — seis resultados clínicamente relevantes que HOY se descartan en silencio
-- (`lib/laboratorio/normalizacion.ts#prepararMetricas` tira cualquier métrica
-- sin `valor` numérico, antes de esta migración).
--
-- ── EL DISEÑO: `value` PASA A NULLABLE, `value_text` ES LA COLUMNA NUEVA
--
-- Se evaluaron dos alternativas:
--
--   a) Una tabla aparte para resultados cualitativos (`lab_metrics_texto` o
--      similar). Descartada: duplicaría metric_name/metric_canonical/unit/
--      reference_range/measurement_date/document_id/profile_id -las OCHO
--      columnas que ya tiene `lab_metrics` y que un resultado cualitativo
--      necesita EXACTAMENTE IGUAL-, más el JOIN o el UNION que cualquier
--      pantalla necesitaría para mostrar "todos los resultados de este
--      estudio" sin importar si son numéricos o de texto (el detalle de
--      `/estudios/{id}` es precisamente ese caso).
--
--   b) `value` nullable + `value_text` nueva, con un CHECK que exija AL
--      MENOS UNO de los dos. Elegida: una métrica sigue siendo una fila de
--      `lab_metrics` sea cual sea la forma de su resultado -mismo lugar,
--      mismos índices, misma política RLS, mismo `UNIQUE (document_id,
--      metric_name)`-, y el 100% del código que YA filtra o pide
--      `value is not null` (Tendencias, la ficha para Gemini) sigue
--      funcionando sin cambiar de forma, con un `.not("value", "is", null)`
--      explícito donde hacía falta (`lib/laboratorio/series.ts`,
--      `lib/ficha/contexto.ts`) en vez de tocar el resto de la cadena.
--
-- `value` y `value_text` NO son mutuamente excluyentes a propósito -pueden
-- coexistir si algún día un caso los necesita a los dos (un valor numérico
-- con una interpretación cualitativa adjunta)-, pero SIEMPRE tiene que haber
-- al menos uno: una fila con los dos en NULL no es una métrica, es basura.
--
-- ── SIN BACKFILL, MISMO CRITERIO QUE `numero_orden`/`content_sha256`
--
-- Las 20 filas de `lab_metrics` que ya existen en la base local (seed +
-- pruebas) tienen `value` numérico: `alter column value drop not null` no
-- las toca, y el CHECK nuevo las deja pasar igual (`value is not null` ya
-- alcanza). No hace falta ningún UPDATE.
--
-- ── EL RPC: MISMA FIRMA, `create or replace` alcanza
--
-- A diferencia de `numero_orden` (20260818180000), acá NO se agrega ningún
-- parámetro nuevo a `confirmar_documento_recien_subido` -lo que cambia es
-- QUÉ acepta cada elemento del jsonb `metricas` que ya existía-, así que no
-- hace falta `drop function` primero: la firma (tipos y cantidad de
-- parámetros) es idéntica, un `create or replace` la reemplaza sin crear una
-- sobrecarga ambigua.
--
-- ── ESTA MIGRACIÓN NO TOCA RLS
--
-- `value_text` es una columna más de una tabla ya cubierta por
-- `lab_metrics_select_puede_ver` / `lab_metrics_insert_puede_cargar`: hereda
-- la misma autorización que el resto de la fila, mismo razonamiento que
-- `20260818180000` §"ESTA MIGRACIÓN NO TOCA RLS". El RPC ya era
-- `SECURITY DEFINER`, así que tampoco cambia a quién se le concede EXECUTE.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema.
-- =============================================================================


-- =============================================================================
-- 1. LA COLUMNA Y EL CHECK
-- =============================================================================

alter table public.lab_metrics
    alter column value drop not null;

alter table public.lab_metrics
    add column value_text text;

alter table public.lab_metrics
    add constraint lab_metrics_valor_o_texto
        check (value is not null or value_text is not null);

comment on column public.lab_metrics.value is
    'Valor numérico medido ("Glucemia: 95"). Nullable desde 20260819190000: una fila puede tener en cambio (o además de) un value_text cualitativo — el CHECK lab_metrics_valor_o_texto exige que al menos uno de los dos no sea NULL.';
comment on column public.lab_metrics.value_text is
    'Resultado CUALITATIVO tal como lo informa el laboratorio ("Negativo", "No reactivo", "No se observan espermatozoides", "Aumentadas") para un estudio que no produce un número. NULL en toda fila puramente numérica (la inmensa mayoría). Ver el encabezado de esta migración para el porqué de sumarlo acá en vez de una tabla aparte.';
comment on constraint lab_metrics_valor_o_texto on public.lab_metrics is
    'Una fila de lab_metrics tiene que tener AL MENOS UNO de value/value_text — los dos en NULL no describen ninguna medición. Los dos a la vez están permitidos (valor numérico con interpretación cualitativa adjunta), no es un XOR.';


-- =============================================================================
-- 2. confirmar_documento_recien_subido — guarda 5 acepta métricas cualitativas
-- -----------------------------------------------------------------------------
-- Antes: `metrica->'value'` tenía que ser un número SIEMPRE, sin excepción.
-- Ahora: alcanza con que la métrica traiga UN valor numérico O un
-- value_text de texto no vacío (mismo criterio que el CHECK de arriba). El
-- resto de las seis guardas (documento, título, categoría, fecha, resumen,
-- institución/especialidad/médico/número de orden) queda EXACTAMENTE igual.
-- =============================================================================

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
    nuevo_numero_orden text default null
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

    -- Guarda 5 (métricas de laboratorio). ÚNICA que cambia en esta migración:
    -- una métrica ahora es válida con valor numérico, con value_text
    -- cualitativo, o con los dos — nunca con ninguno.
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

    -- Guarda 6 (institución, especialidad, médico, número de orden). Mismo
    -- criterio para los cuatro: trim, cadena vacía -> NULL, tope de longitud
    -- solo si no quedó en NULL.
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

    update public.documents
       set title         = titulo_limpio,
           category      = categoria_valida,
           document_date = nueva_fecha,
           ai_summary    = resumen_limpio,
           institution   = institucion_limpia,
           specialty     = especialidad_limpia,
           doctor_name   = medico_limpio,
           numero_orden  = numero_orden_limpio,
           confirmed_at  = now()
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

comment on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text, text) is
    'Confirmación acotada de la pantalla de revisión (Sprint 4, tareas 4.5/4.6; Sprint 5, metadatos; hotfix de duplicados semánticos, número de orden; Sprint 18, resultados cualitativos): permite al CREADOR actualizar título/categoría/fecha/resumen/institución/especialidad/médico/número de orden de SU PROPIO documento recién subido -solo dentro de la primera hora y solo si confirmed_at es NULL- e insertar sus métricas en lab_metrics, todo en una transacción. Cada métrica necesita un value numérico, un value_text cualitativo, o los dos -nunca ninguno- desde esta migración (lab_metrics_valor_o_texto). SECURITY DEFINER por el mismo motivo que la versión anterior: documents_update_administrador exige can_manage y can_upload no lo tiene.';
