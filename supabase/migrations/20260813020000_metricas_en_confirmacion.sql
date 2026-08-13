-- =============================================================================
-- Historial Médico — Migración 20260813020000: persistencia atómica de
-- métricas de laboratorio en la confirmación (Sprint 4, tarea 4.6)
-- -----------------------------------------------------------------------------
-- CONTEXTO. `components/documentos/formulario-revision.tsx` (tarea 4.5) ya
-- muestra las métricas que detectó Gemini y las hace viajar en un campo
-- oculto (`metricas`, JSON) dentro del mismo `<form>` que confirma el
-- documento. La Server Action `confirmarDocumento`
-- (`app/(app)/(con-nav)/estudios/actions.ts`) las parseaba de forma
-- defensiva pero las descartaba sin persistir -deuda explícita de la 4.5,
-- resuelta acá-.
--
-- DECISIÓN (orquestador, Sprint 4): las métricas se insertan DENTRO del RPC
-- `confirmar_documento_recien_subido`, en la MISMA transacción que sella
-- `confirmed_at`. La alternativa -un segundo `insert` desde la Server Action,
-- después del RPC- dejaría una ventana donde el documento queda confirmado
-- pero sin sus métricas si el segundo paso fallara (red, timeout, el proceso
-- de Node se cae entre medio): el estudio quedaría confirmado y "vacío" de
-- resultados sin que la persona lo note. Con el parámetro `metricas` dentro
-- del RPC, o se confirma CON sus métricas, o no se confirma nada -el `raise
-- exception` de cualquier guarda hace rollback de la transacción completa,
-- incluido el `update` de `documents`-.
--
-- POR QUÉ `drop function` Y NO SOLO `create or replace`. Postgres identifica
-- una función por su nombre Y la lista de tipos de sus parámetros. Agregar
-- `metricas jsonb DEFAULT NULL` como sexto parámetro cambia esa firma
-- (uuid, text, text, date, text) -> (uuid, text, text, date, text, jsonb):
-- un `create or replace function` con una firma distinta NO reemplaza nada,
-- CREA una segunda función sobrecargada. Con las dos firmas vivas, una
-- llamada con los 5 argumentos originales (como las que ya probaba
-- `scripts/test-rls.sql` antes de esta migración) queda AMBIGUA entre
-- ambas y Postgres la rechaza con "function ... is not unique". Se dropea
-- primero la firma de 5 parámetros para que quede una sola función viva, con
-- el sexto parámetro `DEFAULT NULL`: así una llamada con 5 argumentos (sin
-- métricas) y una con 6 (con métricas) resuelven ambas contra la misma
-- función, sin ambigüedad.
--
-- LAS GUARDAS 1-4 (creador, ventana de 1h, no confirmado antes, valores del
-- documento válidos) quedan EXACTAMENTE IGUAL que en
-- `20260813010000_confirmacion_documentos.sql` -no se afloja ni se reordena
-- ninguna-. Se agrega una GUARDA 5, exclusiva de `metricas`, que corre en el
-- mismo punto que la 4 (antes de tocar la fila): array de a lo sumo 50
-- elementos, cada uno con nombre no vacío (≤200 caracteres) y valor numérico
-- finito. `unit`/`reference_range` (≤50 y ≤200 caracteres si vienen) y
-- `reference_min`/`reference_max` son opcionales -ya llegan resueltos desde
-- `lib/laboratorio/normalizacion.ts`, que hizo la deduplicación y el parseo
-- del rango de referencia del lado de TypeScript; acá se revalida el
-- contrato mínimo, no se repite esa lógica-.
--
-- `measurement_date` NO se toma del JSON: se fuerza SIEMPRE a `nueva_fecha`
-- (la fecha ya validada por la guarda 4, la que efectivamente queda en
-- `documents.document_date`). Es la aplicación literal del criterio del
-- roadmap ("measurement_date = fecha CONFIRMADA del documento") y además
-- cierra una vía de manipulación: aunque alguien mandara un
-- `measurement_date` distinto en el campo oculto, el RPC lo ignora.
--
-- `ON CONFLICT (document_id, metric_name) DO NOTHING` usa el mismo UNIQUE que
-- ya existe en `lab_metrics` desde el esquema inicial
-- (`lab_metrics_unica_por_documento`): es la red de seguridad del lado de la
-- base para el caso -no esperado, porque `prepararMetricas` ya deduplica-
-- de que igual lleguen dos filas con el mismo `metric_name` para el mismo
-- documento.
-- =============================================================================


drop function if exists public.confirmar_documento_recien_subido(uuid, text, text, date, text);


create or replace function public.confirmar_documento_recien_subido(
    doc_id          uuid,
    nuevo_titulo    text,
    nueva_categoria text,
    nueva_fecha     date,
    nuevo_resumen   text,
    metricas        jsonb default null
)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
    fila             public.documents%rowtype;
    titulo_limpio    text;
    categoria_valida public.doc_category;
    resumen_limpio   text;
    metrica          jsonb;
    v_nombre         text;
begin
    -- Guarda 4 (valores del documento). Se valida ANTES de tocar la fila: si
    -- el envío es inválido, no tiene sentido ni bloquearla con SELECT ... FOR
    -- UPDATE. Idéntica a la versión anterior de esta función.
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

    -- Guarda 5 (métricas de laboratorio, nueva de esta migración). Mismo
    -- criterio que la guarda 4: se valida ANTES de tocar la fila, para que un
    -- array inválido rechace la llamada completa sin efectos parciales.
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

            -- JSON no puede representar NaN ni Infinity (son inválidos como
            -- literal JSON), así que "jsonb_typeof = 'number'" ya garantiza
            -- un valor numérico finito: no hace falta un chequeo aparte.
            if metrica->'value' is null or jsonb_typeof(metrica->'value') is distinct from 'number' then
                raise exception
                    'El valor de la métrica "%" debe ser un número.', v_nombre
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

    -- FOR UPDATE: bloquea la fila para que dos confirmaciones simultáneas
    -- (dos pestañas, doble toque) no pasen las guardas 1-3 a la vez.
    select * into fila from public.documents d where d.id = doc_id for update;

    -- Guarda 1 (implícita si no hay fila): "no existe" y "no sos el creador"
    -- devuelven el mismo tipo de rechazo, mismo principio 3 de
    -- docs/modelo-permisos.md ("la app nunca debe distinguir 'no existe' de
    -- 'no tenés permiso'"), aunque acá el contexto ya no es RLS sino un RPC:
    -- de cualquier manera no hay motivo para diferenciarlos ante quien llama.
    if not found then
        raise exception
            'No encontramos ese documento, o no podés confirmarlo.'
            using errcode = 'insufficient_privilege';
    end if;

    -- Guarda 1.
    if fila.created_by_profile_id is distinct from public.perfil_actor() then
        raise exception
            'Solo la persona que subió este documento puede confirmarlo.'
            using errcode = 'insufficient_privilege';
    end if;

    -- Guarda 2.
    if fila.created_at < now() - interval '1 hour' then
        raise exception
            'Pasó más de una hora desde que se subió este documento. Pedile a quien administra este perfil que lo corrija.'
            using errcode = 'insufficient_privilege';
    end if;

    -- Guarda 3.
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
           confirmed_at  = now()
     where id = doc_id
    returning * into fila;

    -- Persistencia atómica de las métricas: mismo `update` de arriba, misma
    -- transacción. `measurement_date` se fuerza a `nueva_fecha` a propósito
    -- -ver el encabezado del archivo-, nunca se lee del JSON.
    if metricas is not null and jsonb_array_length(metricas) > 0 then
        insert into public.lab_metrics (
            document_id,
            profile_id,
            metric_name,
            metric_canonical,
            value,
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
            (m->>'value')::numeric,
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

comment on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb) is
    'Confirmación acotada de la pantalla de revisión (Sprint 4, tareas 4.5 y 4.6): permite al CREADOR (created_by_profile_id = perfil_actor()) actualizar título/categoría/fecha/resumen de SU PROPIO documento recién subido -solo dentro de la primera hora desde created_at y solo si confirmed_at todavía es NULL- y, en la MISMA transacción, insertar sus métricas de laboratorio normalizadas en lab_metrics (parámetro metricas, jsonb, opcional). SECURITY DEFINER porque documents_update_administrador exige can_manage para cualquier UPDATE y can_upload no lo tiene, y porque el INSERT en lab_metrics se hace a nombre del creador sin depender de que además tenga can_upload vigente al momento de confirmar (docs/modelo-permisos.md §4.2). measurement_date se fuerza SIEMPRE a nueva_fecha, nunca se lee del JSON. No relaja ninguna política de 20260812220000_rls.sql: pasada la ventana, o ya confirmado, la única vía sigue siendo el UPDATE general (can_manage) más un INSERT normal en lab_metrics.';


-- -----------------------------------------------------------------------------
-- Privilegios de ejecución
-- -----------------------------------------------------------------------------
-- Mismo patrón que la migración anterior: CREATE FUNCTION otorga EXECUTE a
-- PUBLIC por defecto; se revoca y se vuelve a otorgar solo a authenticated y
-- service_role. anon no puede invocar la función.
revoke execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb) from public;
grant execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb) to authenticated, service_role;

-- Fin de la migración.
