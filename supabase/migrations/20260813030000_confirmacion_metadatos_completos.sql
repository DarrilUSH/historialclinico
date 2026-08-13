-- =============================================================================
-- Historial Médico — Migración 20260813030000: la confirmación persiste
-- institución, especialidad y médico extraídos (Sprint 5, tarea correctiva)
-- -----------------------------------------------------------------------------
-- CONTEXTO. `SCHEMA_DOCUMENTO_MEDICO` (`lib/gemini/schemas.ts`) ya le pide a
-- Gemini `institucion`, `especialidad` y `medico` desde el Sprint 4, y
-- `formulario-revision.tsx` los usaba para armar el TÍTULO sugerido
-- (`lib/documentos/sugerir-titulo.ts`) -pero nunca los mostraba como campos
-- propios ni los mandaba a `confirmarDocumento`-. El resultado: los tres
-- datos se leían de la extracción, se usaban una vez para componer un string,
-- y se descartaban. `documents.institution` / `.specialty` / `.doctor_name`
-- (columnas que existen desde `20260812200000_schema_inicial.sql`) quedaban
-- NULL para todo documento nuevo, dejando sin datos:
--   - el filtro de institución de `/estudios` (tarea 5.2,
--     `lib/estudios/consultas.ts::obtenerInstitucionesDistintas`),
--   - la tarjeta de la galería (tarea 5.1, `TarjetaEstudio` ya muestra
--     `documento.institution` si existe),
--   - el detalle del estudio (tarea 5.3, `[id]/page.tsx` ya selecciona y
--     muestra `institution`/`specialty`/`doctor_name` si existen).
-- Ninguna de esas tres pantallas necesita cambios: YA leen las columnas.
-- Lo único que faltaba era que algo las escribiera.
--
-- DECISIÓN: mismo patrón que `20260813020000_metricas_en_confirmacion.sql`
-- -los tres campos nuevos se agregan al RPC `confirmar_documento_recien_subido`,
-- se validan con la MISMA guarda-antes-de-tocar-la-fila que título/fecha/
-- resumen, y se persisten en el MISMO `update` que sella `confirmed_at`-. La
-- alternativa de un segundo `update` desde la Server Action reabriría la
-- misma ventana de inconsistencia que ya se descartó para las métricas: el
-- documento podría quedar confirmado sin sus metadatos si el segundo paso
-- fallara entre medio.
--
-- POR QUÉ `drop function` Y NO SOLO `create or replace` (otra vez). La firma
-- vigente es `(uuid, text, text, date, text, jsonb)` -seis parámetros, el
-- sexto (`metricas`) con `DEFAULT NULL`-. Agregar tres parámetros MÁS
-- cambiaría esa firma a `(uuid, text, text, date, text, jsonb, text, text, text)`:
-- un `create or replace function` con una lista de parámetros distinta NO
-- reemplaza la función existente, crea una SEGUNDA función sobrecargada (la
-- misma lección que ya dejó por escrito la migración anterior). Con las dos
-- firmas vivas, cualquier llamada existente -con 5 argumentos
-- (`scripts/test-rls.sql` BLOQUE 8) o con 6 (BLOQUE 8b, `confirmarDocumento`
-- desplegado)- quedaría ambigua entre ambas y Postgres la rechazaría con
-- "function ... is not unique". Se dropea primero la firma de seis
-- parámetros para que quede una sola función viva.
--
-- POR QUÉ LOS TRES PARÁMETROS NUEVOS VAN AL FINAL (posiciones 7-9, no
-- intercalados). Los tres son `DEFAULT NULL`, igual que `metricas`: así,
-- CUALQUIER llamada existente con 5 argumentos (sin métricas ni metadatos) o
-- con 6 (con métricas, sin metadatos) -incluidas las de BLOQUE 8 y BLOQUE 8b
-- de `scripts/test-rls.sql`, que esta migración NO toca- sigue resolviendo
-- contra esta MISMA función sin ambigüedad y sin que haga falta tocarlas.
-- Intercalarlos antes de `metricas` hubiera roto esa compatibilidad posicional
-- sin necesidad.
--
-- GUARDAS 1-5 (creador, ventana de 1h, no confirmado antes, valores del
-- documento válidos, métricas válidas) quedan EXACTAMENTE IGUAL que en
-- `20260813020000_metricas_en_confirmacion.sql` -no se afloja ni se reordena
-- ninguna-. Se agrega una GUARDA 6, exclusiva de institución/especialidad/
-- médico, con el mismo criterio que la 4: trim, cadena vacía → NULL (mismo
-- patrón que ya usa `resumen_limpio` con `nullif(btrim(coalesce(...)), '')`),
-- y un tope de longitud por campo (150 para institución, 100 para
-- especialidad y médico -los tres son opcionales, así que un valor NULL
-- nunca dispara el CHECK, igual que el resumen-). Los tres topes son
-- deliberadamente generosos frente a lo que Gemini suele devolver (nombres de
-- laboratorios, especialidades médicas, nombres de profesionales) pero cierran
-- la puerta a que un campo oculto manipulado mande un párrafo entero disfrazado
-- de "institución".
-- =============================================================================


drop function if exists public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb);


create or replace function public.confirmar_documento_recien_subido(
    doc_id             uuid,
    nuevo_titulo       text,
    nueva_categoria    text,
    nueva_fecha        date,
    nuevo_resumen      text,
    metricas           jsonb default null,
    nueva_institucion  text default null,
    nueva_especialidad text default null,
    nuevo_medico       text default null
)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
    fila               public.documents%rowtype;
    titulo_limpio      text;
    categoria_valida   public.doc_category;
    resumen_limpio     text;
    institucion_limpia text;
    especialidad_limpia text;
    medico_limpio      text;
    metrica            jsonb;
    v_nombre           text;
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

    -- Guarda 5 (métricas de laboratorio). Sin cambios respecto de
    -- 20260813020000_metricas_en_confirmacion.sql.
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

    -- Guarda 6 (institución, especialidad, médico — nueva de esta migración).
    -- Mismo criterio que resumen_limpio: trim, cadena vacía -> NULL, tope de
    -- longitud solo si el valor no quedó en NULL (los tres campos son
    -- opcionales, no hay equivalente al "no puede estar vacío" del título).
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
           institution   = institucion_limpia,
           specialty     = especialidad_limpia,
           doctor_name   = medico_limpio,
           confirmed_at  = now()
     where id = doc_id
    returning * into fila;

    -- Persistencia atómica de las métricas: mismo `update` de arriba, misma
    -- transacción. `measurement_date` se fuerza a `nueva_fecha` a propósito
    -- -ver el encabezado de 20260813020000_metricas_en_confirmacion.sql-,
    -- nunca se lee del JSON.
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

comment on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text) is
    'Confirmación acotada de la pantalla de revisión (Sprint 4, tareas 4.5/4.6; Sprint 5, tarea correctiva de metadatos): permite al CREADOR (created_by_profile_id = perfil_actor()) actualizar título/categoría/fecha/resumen/institución/especialidad/médico de SU PROPIO documento recién subido -solo dentro de la primera hora desde created_at y solo si confirmed_at todavía es NULL- y, en la MISMA transacción, insertar sus métricas de laboratorio normalizadas en lab_metrics (parámetro metricas, jsonb, opcional). institución/especialidad/médico (nueva_institucion/nueva_especialidad/nuevo_medico, los tres opcionales) persisten en documents.institution/specialty/doctor_name -las mismas columnas que ya leen el filtro de /estudios, la tarjeta de galería y el detalle del estudio-. SECURITY DEFINER porque documents_update_administrador exige can_manage para cualquier UPDATE y can_upload no lo tiene, y porque el INSERT en lab_metrics se hace a nombre del creador sin depender de que además tenga can_upload vigente al momento de confirmar (docs/modelo-permisos.md §4.2). measurement_date se fuerza SIEMPRE a nueva_fecha, nunca se lee del JSON. No relaja ninguna política de 20260812220000_rls.sql: pasada la ventana, o ya confirmado, la única vía sigue siendo el UPDATE general (can_manage) más un INSERT normal en lab_metrics.';


-- -----------------------------------------------------------------------------
-- Privilegios de ejecución
-- -----------------------------------------------------------------------------
-- Mismo patrón que las dos migraciones anteriores: CREATE FUNCTION otorga
-- EXECUTE a PUBLIC por defecto; se revoca y se vuelve a otorgar solo a
-- authenticated y service_role. anon no puede invocar la función.
revoke execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text) from public;
grant execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text) to authenticated, service_role;

-- Fin de la migración.
