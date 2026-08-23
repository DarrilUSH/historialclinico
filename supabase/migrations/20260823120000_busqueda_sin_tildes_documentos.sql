-- =============================================================================
-- Historial Médico — Migración 20260823120000: búsqueda sin tildes en /estudios
-- -----------------------------------------------------------------------------
-- ── EL BUG
--
-- El buscador de `/estudios` exigía tildes: escribir "hepatico" no encontraba
-- "Absceso hepático". Es el único buscador de la app con este problema — los
-- demás (`/lugares`, especialidades, médicos, laboratorio, gmail) ya
-- normalizan con NFD o `Intl.Collator sensitivity:"base"`. Normalizar SOLO lo
-- que la persona tipea (el needle) no alcanza: el pajar
-- (`documents.title`/`ai_summary`/`institution`) sigue teniendo tildes en la
-- base, así que `ILIKE '%hepatico%'` no matchea `'Absceso hepático'`. Hacen
-- falta los DOS lados normalizados igual.
--
-- ── POR QUÉ UNA COLUMNA GENERADA Y NO `unaccent`
--
-- `20260818100000_catalogo_refes.sql` (§ comentario de `health_centers.
-- search_text`) ya evaluó y descartó `unaccent`/`pg_trgm` para el caso
-- idéntico de `/lugares`: esas extensiones viven en el esquema `extensions`
-- en Supabase cloud y en otro distinto en local, una divergencia de schema
-- que este proyecto prefiere no arrastrar por una búsqueda sobre un puñado de
-- filas por perfil. Se repite acá la misma solución: una columna generada
-- STORED que pre-normaliza el texto, calculada con `lower()` + `translate()`
-- -las dos son IMMUTABLE, así que Postgres las acepta en una columna
-- generada- y el mismo criterio en JS (`lib/estudios/normalizar-busqueda.ts`)
-- aplicado al lado de la consulta.
--
-- Al ser una columna generada de `documents`, hereda la RLS de la tabla sin
-- crear ninguna función ni policy nueva: no hay que tocar el censo de grants
-- del BLOQUE 27 de `scripts/test-rls.sql`.
--
-- ── LA Ñ SE PRESERVA
--
-- Criterio argentino ya usado en `lib/lugares/normalizar.ts#normalizarBusqueda`:
-- "año" no es "ano". En el mapa de `translate()` de abajo, 'ñ' se traduce a
-- 'ñ' (no se lista para borrarla, se lista para conservarla explícitamente
-- frente a cualquier futura edición del mapa). Las dos cadenas de `translate`
-- tienen que tener EXACTAMENTE la misma cantidad de caracteres -si no
-- coinciden, Postgres descarta en silencio los caracteres sobrantes del lado
-- más largo, un bug invisible-: se verificaron las 39 posiciones de cada
-- cadena con un script antes de escribir esta migración.
--
-- ── SIN ÍNDICE, A PROPÓSITO
--
-- `LIKE '%...%'` (comodín en las dos puntas) no puede usar un índice btree
-- -mismo motivo por el que `health_centers_search_text_idx` con
-- `text_pattern_ops` tampoco lo resuelve del todo, ver su comentario-, y acá
-- ni siquiera hay ese caso de uso parcial: los documentos de un perfil son
-- decenas, ya acotados por `documents.profile_id` (que sí tiene índice desde
-- `20260812200000_schema_inicial.sql`). Un índice funcional sobre
-- `search_text` no pagaría su costo de escritura para este volumen.
--
-- UTF-8 sin BOM.
-- =============================================================================

alter table public.documents
    add column search_text text
    generated always as (
        translate(
            lower(coalesce(title, '') || ' ' || coalesce(ai_summary, '') || ' ' || coalesce(institution, '')),
            'áàäâãåéèëêíìïîóòöôõúùüûýÿçñšžāēīōūăĕĭŏŭ',
            'aaaaaaeeeeiiiiooooouuuuyycñszaeiouaeiou'
        )
    ) stored;

comment on column public.documents.search_text is
    'title + ai_summary + institution concatenados, en minúsculas y sin tildes/diéresis (translate() — la ñ se preserva a propósito, "año" ≠ "ano"). Alimenta el buscador de /estudios: lib/estudios/consultas.ts hace un único `ilike ''%needle%''` acá en vez de un .or() de tres ILIKE contra las columnas crudas, y lib/estudios/normalizar-busqueda.ts normaliza el needle con el MISMO criterio antes de consultar. Sin índice: LIKE con comodín en las dos puntas no puede usar un btree, y los documentos por perfil son decenas acotadas por el índice existente de profile_id.';
