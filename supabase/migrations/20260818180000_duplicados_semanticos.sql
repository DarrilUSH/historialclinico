-- =============================================================================
-- Historial Médico — Migración 20260818180000: duplicados SEMÁNTICOS — el
-- mismo estudio no entra dos veces aunque el PDF venga regenerado
-- -----------------------------------------------------------------------------
-- ── POR QUÉ LA HUELLA (20260818150000) NO ALCANZA
--
-- `content_sha256` compara BYTES. Funciona para "el mismo archivo, cargado dos
-- veces" -el caso del reenvío "RV:" que motivó esa migración-, pero las
-- clínicas argentinas REGENERAN los PDF: evidencia real del usuario, un par de
-- estudios del Sanatorio San Jorge con el MISMO N° DE ORDEN (1446188) y el
-- mismo contenido visible, pero bytes distintos -2 bytes de diferencia, mismo
-- nombre de adjunto-. La huella no los ve como duplicados. Esta migración
-- agrega las DOS capas que faltan, sobre datos que YA se extraen con Gemini:
--
--   Capa 2 — mismo laboratorio/institución + mismo N° de orden. Evidencia
--   directa: los laboratorios imprimen su número de orden/protocolo y ES la
--   identidad administrativa del estudio, más confiable que comparar bytes.
--
--   Capa 3 — TODOS los datos extraídos exactamente iguales (fecha, categoría,
--   institución, médico, cada métrica de lab_metrics con su valor y unidad).
--   La fecha es condición NECESARIA -regla explícita del usuario: un estudio
--   repetido en otra fecha con el mismo resultado NO es un duplicado, es un
--   dato clínico legítimo para Tendencias-.
--
-- El cotejo de las dos capas vive en TypeScript (`lib/documentos/
-- duplicados-semanticos.ts`, puro y testeado con literales) y en las consultas
-- que lo alimentan (`lib/documentos/duplicados-semanticos-consulta.ts` para
-- las tres puertas humanas, `lib/gmail/duplicados-semanticos-admin.ts` para la
-- carga automática). Esta migración solo agrega lo que la base necesita
-- guardar para que ese cotejo tenga con qué comparar.
--
-- ── LA COLUMNA: `documents.numero_orden`, Y POR QUÉ SE PERSISTE (no como
-- `paciente`, que nunca toca disco)
--
-- El patrón de "extraer para cotejar y NUNCA persistir" ya existe en el
-- proyecto: `paciente` (`SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE`,
-- `docs/minimizacion-datos.md` §10.7) se usa para decidir si un estudio es de
-- la persona correcta y se descarta -es un dato IDENTIFICATORIO de una tercera
-- persona (la madre, el hijo) que la app no necesita guardar para nada más-.
-- El número de orden es otra cosa: es un dato CLÍNICO-ADMINISTRATIVO del
-- ESTUDIO, no de una persona -no identifica a nadie por sí solo, ya viaja
-- impreso en el PDF que la app guarda igual en Storage, y sirve para siempre,
-- no solo para este cotejo puntual-. Guardarlo en `documents.numero_orden`:
--
--   - deja que el cotejo de la Capa 2 sea una consulta SQL directa contra la
--     próxima carga, en vez de tener que re-extraer o reprocesar nada;
--   - le da a la persona un dato útil en la pantalla del estudio ("N° de
--     orden: 1446188") para cuando llame al laboratorio a preguntar por un
--     resultado, el mismo tipo de metadato administrativo que ya son
--     `institution`/`doctor_name`;
--   - no viola ninguna regla de minimización: `docs/minimizacion-datos.md` §1
--     exige no guardar lo que no hace falta, no prohíbe guardar lo que SÍ hace
--     falta y que además ya es parte del documento visible.
--
-- Es NULLABLE y no UNIQUE, mismo criterio que `content_sha256`: no todos los
-- documentos traen número de orden (una receta o un informe de imágenes rara
-- vez lo tiene), y dos filas del mismo perfil pueden compartir número de orden
-- a propósito -la persona vio el aviso de la Capa 2 y decidió "Cargar igual"-.
--
-- ── SIN BACKFILL: LOS DOCUMENTOS VIEJOS QUEDAN EN NULL
--
-- Mismo razonamiento que `content_sha256` en `20260818150000`: el número de
-- orden solo existe en el TEXTO del documento, que vive en Storage -o ya se
-- perdió, si `raw_ocr_text` no lo capturó-, no en una columna que una
-- migración SQL pueda derivar. No hay backfill perezoso equivalente al de la
-- huella (que sí puede recalcularse desde los bytes con un hash determinístico):
-- extraer el número de orden de un documento viejo exigiría volver a llamar a
-- Gemini, un costo que esta migración no le impone a nadie en silencio. Los
-- documentos de ANTES de esta migración simplemente no participan de la Capa 2
-- -la Capa 1 (huella) y la Capa 3 (todos los datos) los siguen cubriendo
-- igual, porque no dependen de esta columna-.
--
-- ── LOS DOS RPC QUE SE EXTIENDEN, Y POR QUÉ CON `DROP FUNCTION` (otra vez)
--
-- Mismo patrón que `20260813030000_confirmacion_metadatos_completos.sql`:
-- agregar un parámetro más a una función existente con `create or replace`
-- crearía una SEGUNDA función sobrecargada si la lista de parámetros cambia de
-- tamaño, dejando ambigüedad entre las dos firmas para cualquier llamada
-- existente. Se `drop`ea la firma vieja primero para que quede una sola función
-- viva, y el parámetro nuevo va SIEMPRE al final con `DEFAULT NULL`, para que
-- las llamadas existentes -`scripts/test-rls.sql` BLOQUE 8/8b/8c y los RPC ya
-- desplegados- seguven resolviendo sin tocarlas:
--
--   1. `confirmar_documento_recien_subido` — nuevo DÉCIMO parámetro
--      `nuevo_numero_orden text default null`, mismo criterio de "trim, cadena
--      vacía -> NULL, tope de longitud" que institución/especialidad/médico
--      (guarda 6 extendida).
--   2. `ingresar_documento_automatico` — nuevo DUODÉCIMO parámetro
--      `p_numero_orden text default null`, mismo criterio, para que los
--      documentos que entran SOLOS por la carga automática (Sprint 17) también
--      guarden su número de orden -son estudios igual de reales, y la Capa 2
--      tiene que poder cotejar contra ellos en cargas futuras-.
--
-- ── ESTA MIGRACIÓN NO TOCA RLS
--
-- `numero_orden` es una columna más de una tabla ya cubierta por
-- `documents_select_puede_ver` / `documents_update_administrador`: hereda la
-- misma autorización que el resto de la fila, mismo razonamiento que
-- `20260818150000` §"ESTA MIGRACIÓN NO TOCA RLS" y que `20260817231000` para
-- las columnas de ciudad/provincia. Los dos RPC ya eran `SECURITY DEFINER`
-- (`confirmar_documento_recien_subido` corre con la autoridad del creador
-- verificada a mano; `ingresar_documento_automatico` solo lo ejecuta
-- `service_role`), así que agregarles un parámetro más no cambia a quién se le
-- concede EXECUTE.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema.
-- =============================================================================


-- =============================================================================
-- 1. LA COLUMNA
-- =============================================================================

alter table public.documents
    add column numero_orden text;

-- Tope generoso frente a lo que de verdad imprimen los laboratorios (números
-- de orden/protocolo de pocos dígitos, a veces con un prefijo de letras) —
-- mismo criterio que el resto de los campos de metadatos de esta tabla:
-- cierra la puerta a que alguien mande un párrafo entero disfrazado de
-- "número".
alter table public.documents
    add constraint documents_numero_orden_valido
        check (
            numero_orden is null
            or (char_length(btrim(numero_orden)) > 0 and char_length(numero_orden) <= 60)
        );

comment on column public.documents.numero_orden is
    'Número de orden/protocolo del estudio, tal como lo imprime el laboratorio o la institución (ej. "1446188", "OP-24601"). Se persiste porque es un dato clínico-administrativo legítimo del ESTUDIO -no identifica a una persona, y ya viaja impreso en el PDF que la app guarda igual en Storage-, a diferencia del nombre del paciente (SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE), que se usa para cotejar y se descarta sin tocar disco (docs/minimizacion-datos.md §10.7). NULL en documentos que no traen número de orden, y en TODO documento anterior a esta migración (20260818180000): no hay backfill posible sin volver a llamar a Gemini. Es la base de la Capa 2 del detector de duplicados semánticos (docs/gmail-ingesta.md §2.4): mismo profile_id + misma institution (normalizada) + mismo numero_orden (normalizado) = duplicado directo.';

-- Sostiene el prefiltro barato de la Capa 2: "¿este perfil tiene ALGÚN
-- documento con número de orden?" antes de traer las filas candidatas para
-- normalizar y comparar en TypeScript (institución y número se comparan
-- tolerando tildes/mayúsculas/espacios, algo que un índice de Postgres no
-- puede expresar sin una columna generada aparte -que esta migración no
-- necesita: el volumen por perfil es chico, y el prefiltro por profile_id ya
-- alcanza-). Parcial, mismo criterio que `documents_perfil_huella_idx`: no
-- paga espacio de índice en las filas sin número de orden (la mayoría).
create index documents_perfil_numero_orden_idx
    on public.documents (profile_id, numero_orden)
    where numero_orden is not null;

comment on index public.documents_perfil_numero_orden_idx is
    'Prefiltro de la Capa 2 del detector de duplicados semánticos: "¿profile_id ya tiene documentos con número de orden?" (lib/documentos/duplicados-semanticos-consulta.ts). La normalización de institución/número (tildes, mayúsculas, espacios) se hace en TypeScript, no acá. Parcial: solo indexa filas con numero_orden calculado.';


-- =============================================================================
-- 2. confirmar_documento_recien_subido — décimo parámetro `nuevo_numero_orden`
-- =============================================================================

drop function if exists public.confirmar_documento_recien_subido(
    uuid, text, text, date, text, jsonb, text, text, text);


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

    -- Guarda 5 (métricas de laboratorio). Sin cambios.
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

comment on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text, text) is
    'Confirmación acotada de la pantalla de revisión (Sprint 4, tareas 4.5/4.6; Sprint 5, metadatos; hotfix de duplicados semánticos, número de orden): permite al CREADOR actualizar título/categoría/fecha/resumen/institución/especialidad/médico/número de orden de SU PROPIO documento recién subido -solo dentro de la primera hora y solo si confirmed_at es NULL- e insertar sus métricas en lab_metrics, todo en una transacción. numero_orden (nuevo_numero_orden, opcional) persiste en documents.numero_orden, la columna que alimenta la Capa 2 del detector de duplicados semánticos (docs/gmail-ingesta.md §2.4). SECURITY DEFINER por el mismo motivo que la versión anterior: documents_update_administrador exige can_manage y can_upload no lo tiene.';

revoke execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text, text) from public;
grant execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text, text) to authenticated, service_role;


-- =============================================================================
-- 3. ingresar_documento_automatico — duodécimo parámetro `p_numero_orden`
-- =============================================================================

drop function if exists public.ingresar_documento_automatico(
    uuid, uuid, text, text, bigint, text, text, text, date, text, text);


create or replace function public.ingresar_documento_automatico(
    p_usuario      uuid,
    p_correo       uuid,
    p_storage_path text,
    p_mime         text,
    p_bytes        bigint,
    p_sha256       text,
    p_titulo       text,
    p_categoria    text,
    p_fecha        date,
    p_resumen      text,
    p_texto_ocr    text,
    p_numero_orden text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_conexion    public.gmail_connections%rowtype;
    v_correo      public.gmail_messages%rowtype;
    v_perfil      uuid;
    v_titulo      text;
    v_categoria   public.doc_category;
    v_numero_orden text;
    v_documento   uuid;
begin
    select * into v_conexion
      from public.gmail_connections c
     where c.user_id = p_usuario
     for update;

    if not found then
        raise exception 'Esa cuenta no tiene ninguna casilla de Gmail conectada.'
            using errcode = 'insufficient_privilege';
    end if;

    if not v_conexion.auto_ingest_enabled or v_conexion.auto_ingest_profile_id is null then
        raise exception 'La carga automática está apagada para esta cuenta.'
            using errcode = 'insufficient_privilege';
    end if;

    v_perfil := v_conexion.auto_ingest_profile_id;

    if not public.cuenta_administra_perfil(p_usuario, v_perfil) then
        raise exception 'Esa cuenta ya no administra el perfil de destino.'
            using errcode = 'insufficient_privilege';
    end if;

    select * into v_correo
      from public.gmail_messages m
     where m.id = p_correo
       and m.user_id = p_usuario
     for update;

    if not found then
        raise exception 'No encontramos ese correo en el registro de esta cuenta.'
            using errcode = 'insufficient_privilege';
    end if;

    if v_correo.status <> 'pendiente_revision' or v_correo.document_id is not null then
        return jsonb_build_object('estado', 'ya_resuelto');
    end if;

    if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
        raise exception 'La huella del archivo no tiene forma válida.'
            using errcode = '22023';
    end if;

    if exists (
        select 1
          from public.documents d
         where d.profile_id = v_perfil
           and d.content_sha256 = p_sha256
    ) then
        return jsonb_build_object('estado', 'duplicado');
    end if;

    v_titulo := btrim(coalesce(p_titulo, ''));
    if char_length(v_titulo) = 0 or char_length(v_titulo) > 200 then
        raise exception 'El título no puede estar vacío ni superar los 200 caracteres.'
            using errcode = 'invalid_parameter_value';
    end if;

    begin
        v_categoria := p_categoria::public.doc_category;
    exception when invalid_text_representation then
        raise exception 'La categoría no es válida.' using errcode = 'invalid_parameter_value';
    end;

    if p_fecha is null or p_fecha > current_date or p_fecha <= date '1900-12-31' then
        raise exception 'La fecha del estudio no es válida: no puede ser futura ni anterior a 1900.'
            using errcode = 'invalid_parameter_value';
    end if;

    v_numero_orden := nullif(btrim(coalesce(p_numero_orden, '')), '');
    if v_numero_orden is not null and char_length(v_numero_orden) > 60 then
        raise exception 'El número de orden es demasiado largo (máx. 60 caracteres).'
            using errcode = 'invalid_parameter_value';
    end if;

    insert into public.documents (
        profile_id, title, category, document_date, storage_path, mime_type,
        file_size_bytes, content_sha256, ai_summary, raw_ocr_text, numero_orden,
        created_by_profile_id, confirmed_at, auto_ingest_source
    ) values (
        v_perfil, v_titulo, v_categoria, p_fecha, p_storage_path, p_mime,
        p_bytes, p_sha256, nullif(btrim(coalesce(p_resumen, '')), ''),
        nullif(btrim(coalesce(p_texto_ocr, '')), ''), v_numero_orden,
        null, now(), 'gmail'
    )
    returning id into v_documento;

    update public.gmail_messages
       set status             = 'ingresado',
           document_id        = v_documento,
           resolved_at        = now(),
           auto_ingested_at   = now(),
           auto_review_reason = null
     where id = p_correo
       and user_id = p_usuario;

    return jsonb_build_object('estado', 'creado', 'documento_id', v_documento);
end;
$$;

comment on function public.ingresar_documento_automatico(uuid, uuid, text, text, bigint, text, text, text, date, text, text, text) is
    'Crea el documento de una carga AUTOMÁTICA desde Gmail y deja el correo resuelto, en una transacción (Sprint 17; hotfix de duplicados semánticos agrega p_numero_orden). Mismas cuatro guardas que la versión anterior (interruptor, autoridad AHORA, correo propio y pendiente, sin huella duplicada). p_numero_orden (opcional) persiste en documents.numero_orden, para que la Capa 2 del detector de duplicados semánticos pueda cotejar contra estudios que entraron solos igual que contra los que cargó una persona. Solo service_role.';

revoke execute on function public.ingresar_documento_automatico(uuid, uuid, text, text, bigint, text, text, text, date, text, text, text) from public;
grant  execute on function public.ingresar_documento_automatico(uuid, uuid, text, text, bigint, text, text, text, date, text, text, text) to service_role;


-- =============================================================================
-- 4. LO QUE ESTA MIGRACIÓN NO HACE
-- -----------------------------------------------------------------------------
-- - **No agrega ninguna política RLS.** Ver el bloque de comentarios del
--   encabezado.
-- - **No toca `ingresar_turno_automatico`** ni ninguna otra función: un turno
--   no tiene número de orden.
-- - **No backfillea `numero_orden` de documentos existentes.** Ver el bloque
--   "SIN BACKFILL" del encabezado.
-- - **No agrega una capa 4.** El cotejo semántico completo (Capa 3) y el
--   cotejo administrativo (Capa 2) son los dos que pidió el usuario; la Capa 1
--   (huella SHA-256, `20260818150000`) no se toca.
-- =============================================================================

-- Fin de la migración.
