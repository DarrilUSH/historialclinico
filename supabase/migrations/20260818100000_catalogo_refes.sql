-- =============================================================================
-- Historial Médico — Migración 20260818100000: catálogo REFES de centros de
-- salud del país (Sprint 16, tarea 16.3)
-- -----------------------------------------------------------------------------
-- ── QUÉ ES ESTO
--
-- El Registro Federal de Establecimientos de Salud (REFES) del Ministerio de
-- Salud de la Nación publica, en datos.salud.gob.ar, el listado completo de
-- los establecimientos asistenciales del país: 36.046 filas en la edición de
-- diciembre de 2025, con nombre, tipología, provincia/departamento/localidad,
-- código postal, domicilio, sitio web y **coordenadas**. Licencia CC-BY-4.0.
--
-- Esta migración crea las DOS tablas que ese catálogo necesita:
--
--   1. `health_centers` — una fila por establecimiento, con
--      `establecimiento_id` (la clave natural del REFES) como PK para que la
--      sincronización sea un UPSERT idempotente.
--   2. `health_centers_sync` — UNA SOLA fila con el estado de la
--      sincronización: qué edición está vigente, qué corrida está en curso,
--      hasta qué byte del CSV se procesó, y quién apretó "Actualizar".
--
-- ── POR QUÉ UNA TABLA GLOBAL Y NO UNA POR PERFIL
--
-- Todo lo demás en esta base cuelga de un `profile_id` y se autoriza con la
-- matriz de docs/modelo-permisos.md. Este catálogo NO: es un dato público del
-- Estado, idéntico para todas las familias, y duplicarlo por perfil sería
-- guardar 36.046 filas por cada persona que usa la app. Es la primera tabla
-- del proyecto sin dueño — y por eso su RLS es distinta y se explica entera
-- más abajo (§3).
--
-- ── LA REGLA DE COSTO CERO
--
-- El CSV trae `longitud` y `latitud` ya cargadas: elegir un centro de este
-- catálogo en el formulario de turno precarga las coordenadas SIN una sola
-- llamada de geocodificación (`lib/ubicacion/geocodificacion.ts` sigue siendo
-- el respaldo para las direcciones tipeadas a mano). Cero peticiones a
-- Nominatim, cero API keys, cero costo.
--
-- ── LO QUE ESTA MIGRACIÓN **NO** HACE
--
-- No carga los 36.046 centros. La carga es la sincronización por tandas del
-- botón "Actualizar" (`app/api/lugares/sincronizar/route.ts`), que corre
-- contra el portal del Ministerio. `supabase/seed.sql` sí precarga una
-- muestra de 24 centros REALES del REFES para que el desarrollo y las
-- pruebas no dependan de internet.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema, mismo criterio que el
-- resto del proyecto.
-- =============================================================================


-- =============================================================================
-- 1. health_centers — el catálogo
-- =============================================================================

create table public.health_centers (
    -- Clave natural del REFES (`establecimiento_id`): 14 dígitos, estable
    -- entre ediciones. Es la PK a propósito, no un uuid propio con un índice
    -- único al lado: el upsert de la sincronización necesita exactamente esta
    -- columna como `onConflict`, y un uuid interno solo agregaría una
    -- indirección que nadie usa (ninguna otra tabla referencia a esta — ver
    -- la nota de `appointments` al final de este archivo).
    refes_id            text        primary key,

    name                text        not null,

    -- Tipología: el REFES clasifica cada establecimiento con un id numérico
    -- (la CATEGORÍA: 10-15 con internación, 17 residencias, 50-52 sin
    -- internación, 53 complementarios, 55/80 no asistenciales), una sigla
    -- (ESCIG, ESSIDT, ESSID, …) y un nombre largo. Se guardan los tres: el id
    -- es lo que filtra la UI (`lib/lugares/tipologias.ts` agrupa los ids en
    -- categorías con nombre en castellano), la sigla y el nombre son lo que
    -- se le muestra a la persona.
    typology_id         integer,
    typology_code       text,
    typology_name       text,

    -- `origen_financiamiento` del CSV: Privado, Provincial, Municipal,
    -- Seguridad Social, Nacional, Mutual, FFAA/Seguridad, Universitario…
    funding_origin      text,

    -- Provincia TAL CUAL viene del REFES (en mayúsculas y con abreviaturas
    -- propias: "CABA", "TIERRA DEL FUEGO"). Se conserva para poder auditar
    -- contra la fuente sin adivinar qué se transformó.
    province_refes      text        not null,

    -- Provincia NORMALIZADA a los 24 valores de `lib/ubicacion/provincias.ts`
    -- (`PROVINCIAS_ARGENTINAS`), que es lo que aceptan
    -- `appointments_location_province_valida` y `doctors_province_valida`
    -- (`20260817231000_ciudad_provincia_direcciones.sql`). Sin esta columna,
    -- elegir un centro de CABA en el formulario de turno intentaría guardar
    -- "CABA" en `appointments.location_province` y el CHECK lo rechazaría:
    -- la normalización se hace UNA vez, al ingerir
    -- (`lib/lugares/normalizar.ts#provinciaCanonica`), no en cada lectura.
    -- Nullable porque una edición futura del REFES podría traer una
    -- jurisdicción que el mapa no conozca: en ese caso el centro se guarda
    -- igual (el catálogo no pierde filas por un nombre nuevo) y solo queda
    -- sin precarga de provincia.
    province            text,

    department_name     text,
    locality_name       text,
    postal_code         text,
    address             text,

    -- El REFES publica los sitios sin esquema ("www.tcba.com.ar"). Se guarda
    -- tal cual y el enlace se arma al renderizar
    -- (`lib/lugares/formato.ts#urlSitioWeb`): normalizarlo acá obligaría a
    -- re-sincronizar el catálogo entero si mañana se cambia el criterio.
    website             text,

    -- Mismo tipo y mismos CHECK que `appointments`/`doctors`
    -- (`20260812200000_schema_inicial.sql` §4.2 y §4.5): numeric(9,6) alcanza
    -- para ~10 cm de precisión y las dos van juntas o no va ninguna.
    latitude            numeric(9, 6),
    longitude           numeric(9, 6),

    -- Texto de búsqueda: nombre + localidad + departamento + provincia, todo
    -- en minúsculas y SIN tildes (`lib/lugares/normalizar.ts#normalizarBusqueda`,
    -- la misma función que normaliza lo que la persona teclea). Existe para
    -- que "san jorge ushuaia" encuentre "CLINICA SAN JORGE" de USHUAIA con un
    -- solo `like` sobre una columna ya normalizada, sin depender de las
    -- extensiones `unaccent`/`pg_trgm` -que en Supabase cloud viven en el
    -- esquema `extensions` y en local en otro, una divergencia que este
    -- proyecto prefiere no arrastrar por una búsqueda sobre 36 mil filas
    -- cortas-.
    search_text         text        not null,

    -- Solo la LOCALIDAD, normalizada con la misma función. El filtro
    -- "Localidad" de /lugares no puede ir contra `search_text` -que también
    -- tiene el nombre del centro-, porque entonces escribir "ushuaia"
    -- devolvería además cualquier "CLINICA USHUAIA" de otra ciudad. Y
    -- tampoco puede ser un desplegable: el país tiene miles de localidades,
    -- y armarlo exigiría un `distinct` que PostgREST no expone. Una columna
    -- propia lo resuelve con un `like` exacto y barato.
    locality_search     text,

    -- Cuándo lo tocó por última vez una sincronización. Sirve para detectar,
    -- después de una corrida completa, las filas que la edición nueva ya no
    -- trae (§2, `health_centers_sync.run_started_at`).
    synced_at           timestamptz not null default now(),

    constraint health_centers_refes_id_no_vacio
        check (btrim(refes_id) <> ''),
    constraint health_centers_name_no_vacio
        check (btrim(name) <> ''),
    constraint health_centers_latitude_valida
        check (latitude is null or latitude between -90 and 90),
    constraint health_centers_longitude_valida
        check (longitude is null or longitude between -180 and 180),
    constraint health_centers_coordenadas_completas
        check ((latitude is null) = (longitude is null))
);

comment on table public.health_centers is
    'Catálogo de establecimientos de salud del país, sincronizado desde el Registro Federal de Establecimientos de Salud (REFES) del Ministerio de Salud de la Nación — datos.salud.gob.ar, licencia CC-BY-4.0 (Sprint 16, tarea 16.3). Tabla GLOBAL: no cuelga de ningún profile_id, es el mismo dato público para todas las familias. Solo lectura para authenticated; la escriben únicamente las tandas de sincronización con service_role (app/api/lugares/sincronizar/route.ts). La clave es el establecimiento_id del REFES, para que cada tanda sea un UPSERT idempotente y reanudable.';

comment on column public.health_centers.refes_id is
    'establecimiento_id del REFES (14 dígitos). Clave natural y onConflict del upsert de sincronización.';
comment on column public.health_centers.province_refes is
    'provincia_nombre tal cual lo publica el REFES ("CABA", "TIERRA DEL FUEGO", en mayúsculas). Se conserva sin transformar para poder auditar contra la fuente.';
comment on column public.health_centers.province is
    'La misma provincia normalizada a uno de los 24 valores de PROVINCIAS_ARGENTINAS (lib/ubicacion/provincias.ts), que es lo que aceptan los CHECK de appointments.location_province y doctors.province. NULL si una edición futura trae una jurisdicción que lib/lugares/normalizar.ts todavía no mapea: el centro se guarda igual, solo pierde la precarga de provincia en el formulario de turno.';
comment on column public.health_centers.search_text is
    'nombre + localidad + departamento + provincia, en minúsculas y sin tildes (lib/lugares/normalizar.ts#normalizarBusqueda). La búsqueda de /lugares hace `like %consulta%` sobre esta columna con la consulta normalizada por la MISMA función, así "cordoba" encuentra "CÓRDOBA" sin extensiones de Postgres.';
comment on column public.health_centers.locality_search is
    'locality_name normalizado con lib/lugares/normalizar.ts#normalizarBusqueda. Alimenta el filtro "Localidad" de /lugares, que es un campo de texto y no un desplegable porque el país tiene miles de localidades. Va aparte de search_text para que filtrar por "ushuaia" no traiga además los centros LLAMADOS "ushuaia" que están en otra ciudad.';
comment on column public.health_centers.synced_at is
    'Marca de la última tanda que escribió esta fila. Después de una corrida completa, las filas con synced_at anterior al inicio de la corrida son las que la edición nueva ya no trae (ver health_centers_sync.run_started_at).';

-- Índices. Los tres filtros reales de /lugares -provincia, localidad y
-- categoría de tipología- más el orden por nombre.
create index health_centers_province_idx      on public.health_centers (province);
create index health_centers_locality_idx      on public.health_centers (province, locality_search);
create index health_centers_typology_idx      on public.health_centers (typology_id);
create index health_centers_search_text_idx   on public.health_centers (search_text text_pattern_ops);
create index health_centers_synced_at_idx     on public.health_centers (synced_at);

comment on index public.health_centers_search_text_idx is
    'text_pattern_ops soporta `like ''prefijo%''`. La búsqueda de /lugares usa `like ''%consulta%''` (subcadena en cualquier posición, mismo criterio generoso que el autocompletar de especialidades de la tarea 16.2), que este índice NO puede resolver: sobre 36 mil filas cortas el barrido secuencial mide ~30 ms, así que no se paga una extensión (pg_trgm) ni un índice GIN para ganar milisegundos. El índice queda para el caso -habitual en el autocompletar de "Lugar"- en que la consulta ya viene acotada por provincia o localidad y Postgres puede combinarlo con los índices de arriba.';


-- =============================================================================
-- 2. health_centers_sync — el estado de la sincronización (una sola fila)
-- -----------------------------------------------------------------------------
-- El botón "Actualizar" no puede resolverse en un solo request: una función
-- serverless de Vercel Hobby tiene un techo de duración de decenas de
-- segundos, y sincronizar 36.046 filas contra Supabase no entra ahí. El
-- cliente entonces orquesta un LOOP de requests, y cada tanda necesita saber
-- dónde quedó la anterior. Ese "dónde quedó" NO puede vivir en memoria del
-- servidor (cada request puede caer en otra instancia) ni en el cliente (si
-- cierra la pestaña se pierde): vive acá.
--
-- Una sola fila, con el patrón singleton clásico: PK booleana con DEFAULT
-- true y un CHECK que solo admite true. Así `insert` de una segunda fila
-- falla por PK y cualquier `update` sin `where` toca exactamente una fila.
-- =============================================================================

create table public.health_centers_sync (
    id                    boolean     primary key default true,

    -- ── Edición VIGENTE (la última corrida que terminó entera)
    current_resource_id   text,
    current_resource_url  text,
    current_last_modified timestamptz,
    current_etag          text,
    current_row_count     integer,
    current_synced_at     timestamptz,

    -- ── Corrida en curso (o la última que terminó/falló)
    -- 'idle' = no hay nada corriendo · 'running' = hay una tanda activa
    -- (el lock) · 'error' = la última corrida se cortó con un problema.
    status                text        not null default 'idle',

    run_resource_id       text,
    run_resource_url      text,
    run_last_modified     timestamptz,
    run_etag              text,
    -- Path del CSV dentro del bucket privado `refes-sync` mientras dura la
    -- corrida (§4). Se borra al terminar.
    run_storage_path      text,
    run_total_bytes       bigint,
    -- Filas de datos que tiene el CSV descargado. Se cuentan de una pasada
    -- durante la preparación (`lib/lugares/csv.ts#contarFilasCsv`, ~40 ms
    -- sobre 9 MB) para que el velo de espera pueda decir "Sincronizando 12.000
    -- de 36.046" con el número REAL y no con una estimación.
    run_total_rows        integer,
    -- Byte del CSV donde arranca la PRÓXIMA tanda. Siempre cae en un borde de
    -- fila: cada tanda descarta la fila parcial del final de su ventana y
    -- deja el offset justo después del último `\r\n` que consumió entero.
    run_byte_offset       bigint      not null default 0,
    run_rows_processed    integer     not null default 0,
    -- Momento en que se DESCARGÓ el CSV de esta corrida. Es la marca de agua
    -- para la limpieza final: al terminar, las filas de health_centers con
    -- `synced_at` anterior a esto son las que la edición nueva ya no trae.
    -- Es una columna aparte de `run_started_at` justamente porque
    -- `run_started_at` se REINICIA cada vez que se toma el lock -incluso al
    -- REANUDAR una corrida cortada-, y usarla como marca de agua borraría
    -- todo lo que las tandas anteriores de la misma corrida ya habían
    -- escrito bien.
    run_data_since        timestamptz,
    run_started_at        timestamptz,
    -- Latido del lock: cada tanda lo pisa. Una corrida cuyo latido quedó
    -- viejo (la persona cerró la pestaña, se cortó internet) deja de bloquear
    -- a la siguiente — ver `reclamar_sincronizacion_refes()` en §5.
    run_heartbeat_at      timestamptz,
    -- Auditoría: qué CUENTA apretó "Actualizar". No es un profile_id: el
    -- catálogo es global y no pertenece a ningún perfil. ON DELETE SET NULL
    -- porque el registro de la corrida sobrevive a la baja de la cuenta.
    run_started_by        uuid        references auth.users (id) on delete set null,
    run_error             text,

    constraint health_centers_sync_fila_unica
        check (id),
    constraint health_centers_sync_status_valido
        check (status in ('idle', 'running', 'error')),
    constraint health_centers_sync_offset_no_negativo
        check (run_byte_offset >= 0),
    constraint health_centers_sync_filas_no_negativas
        check (run_rows_processed >= 0)
);

comment on table public.health_centers_sync is
    'Estado de la sincronización del catálogo REFES (Sprint 16, tarea 16.3). UNA sola fila (patrón singleton: PK booleana + CHECK id). Guarda la edición vigente, la corrida en curso con su byte de reanudación, el lock contra sincronizaciones concurrentes (status + run_heartbeat_at) y la auditoría de quién la disparó. Solo lectura para authenticated -la pantalla de /lugares muestra "última actualización"-; la escriben únicamente public.reclamar_sincronizacion_refes() y las tandas con service_role.';

comment on column public.health_centers_sync.status is
    'idle = no hay corrida activa · running = hay una tanda en curso (lock) · error = la última corrida se cortó. El lock NO es eterno: reclamar_sincronizacion_refes() se lo lleva si run_heartbeat_at quedó viejo.';
comment on column public.health_centers_sync.run_byte_offset is
    'Byte del CSV donde arranca la próxima tanda. Siempre en un borde de fila: cada tanda descarta la fila parcial del final de su ventana. Es lo que hace la sincronización REANUDABLE — si el navegador se cierra a la mitad, la corrida siguiente sigue desde acá en vez de empezar de cero.';
comment on column public.health_centers_sync.run_data_since is
    'Momento de la DESCARGA del CSV de esta corrida, y marca de agua de la limpieza final: al terminar, las filas de health_centers con synced_at anterior a este valor son las que la edición nueva ya no trae y se borran. Distinta de run_started_at a propósito -esa se reinicia cada vez que se toma el lock, también al reanudar, y usarla acá borraría lo que las tandas anteriores de la misma corrida ya habían escrito bien-.';
comment on column public.health_centers_sync.run_started_by is
    'Cuenta (auth.users) que apretó "Actualizar". Auditoría del evento, pedida por la tarea: el catálogo es global y cualquier persona con sesión puede sincronizarlo, así que queda registrado quién y cuándo.';

-- La fila única nace acá. Sin ella, la primera lectura de /lugares no
-- tendría nada que leer y la primera tanda no tendría qué actualizar.
insert into public.health_centers_sync (id) values (true);


-- =============================================================================
-- 3. RLS — la primera tabla del proyecto sin dueño
-- -----------------------------------------------------------------------------
-- La regla de `20260812220000_rls.sql` §4 (`revoke all on all tables in schema
-- public from anon, authenticated` + GRANT explícito) se aplicó a las tablas
-- que EXISTÍAN en ese momento: un `revoke ... on all tables` es una foto, no
-- una regla viva, así que una tabla creada después nace con los privilegios
-- que Postgres le dé por default. Ese fue exactamente el hallazgo del Sprint 6
-- con `appointment_reminders` (ver el comentario largo de
-- `20260813050000_recordatorios_turnos.sql` §3) y la lección quedó anotada:
-- **toda tabla nueva repite su propio revoke.** Se repite acá, para las dos.
--
-- El modelo de acceso de este catálogo:
--
--   · `anon`        — NADA. Ni SELECT. No hay pantalla pública que lo lea.
--   · `authenticated` — SELECT y solo SELECT, sobre TODAS las filas. No hay
--                     nada que filtrar por perfil: es un dato público del
--                     Estado, igual para todo el mundo.
--   · `service_role` — todo. Es quien corre las tandas de sincronización.
--
-- Las dos tablas tienen política de SELECT (y ninguna de escritura), así que
-- el invariante del BLOQUE 7 de `scripts/test-rls.sql` -"tablas de public sin
-- ninguna política: solo las dos de infraestructura"- sigue devolviendo
-- exactamente `appointment_reminders, storage_purge_queue`.
--
-- Que no haya política de INSERT/UPDATE/DELETE **más** que no haya privilegio
-- son dos candados independientes: aunque alguien agregara una política de
-- escritura por error, sin el GRANT no se puede escribir; y aunque alguien
-- otorgara el GRANT por error, sin política RLS tampoco. El arnés
-- (`scripts/test-rls.sql`, BLOQUE 22) verifica las dos capas por separado.
-- =============================================================================

alter table public.health_centers      enable row level security;
alter table public.health_centers_sync enable row level security;

revoke all on public.health_centers      from anon, authenticated;
revoke all on public.health_centers_sync from anon, authenticated;

grant select on public.health_centers      to authenticated;
grant select on public.health_centers_sync to authenticated;

grant select, insert, update, delete on public.health_centers      to service_role;
grant select, insert, update, delete on public.health_centers_sync to service_role;

-- SELECT: cualquier sesión con cuenta, todas las filas.
create policy health_centers_select_con_sesion
    on public.health_centers
    for select
    to authenticated
    using (true);

comment on policy health_centers_select_con_sesion on public.health_centers is
    'El catálogo REFES es un dato público del Estado (CC-BY-4.0), idéntico para todas las familias: no hay nada que filtrar por perfil. `using (true)` es deliberado y NO una política olvidada. Lo que sí está acotado es el rol: `to authenticated` -anon no tiene ni privilegio ni política-, porque ninguna pantalla sin sesión lo consulta y una tabla de 36 mil filas expuesta a anon sería un blanco de scraping gratis contra la cuota del proyecto.';

create policy health_centers_sync_select_con_sesion
    on public.health_centers_sync
    for select
    to authenticated
    using (true);

comment on policy health_centers_sync_select_con_sesion on public.health_centers_sync is
    'La pantalla /lugares muestra "última actualización: {fecha}, {N} centros" y el botón "Actualizar" necesita saber si ya hay una corrida en curso. Es una sola fila con metadatos de un catálogo público: no hay dato de salud de nadie acá.';

-- Sin políticas de INSERT/UPDATE/DELETE en ninguna de las dos: escribir el
-- catálogo es exclusivo de service_role, que las saltea por BYPASSRLS.


-- =============================================================================
-- 4. Bucket privado de la sincronización (`refes-sync`)
-- -----------------------------------------------------------------------------
-- ── EL PROBLEMA MEDIDO
--
-- El CSV del REFES pesa 8.970.242 bytes. El portal ANUNCIA `Accept-Ranges:
-- bytes` pero **no honra el header `Range`**: pedirle `bytes=0-200` devuelve
-- HTTP 200 con los 8.970.242 bytes enteros (medido el 2026-08-18 con curl y
-- con node:https; ver el Resumen de Entrega de la tarea). Es decir: no se
-- puede "pedir la rebanada que le toca a esta tanda" directo al Ministerio —
-- cada tanda tendría que bajar los 9 MB completos (~2,6 s medidos) y tirar el
-- 90%.
--
-- ── LA SOLUCIÓN
--
-- El CSV se descarga UNA sola vez (la tanda de preparación) y se deja acá,
-- en un bucket privado, mientras dura la corrida. Supabase Storage SÍ honra
-- `Range`: medido, `bytes=1000000-1000500` devuelve HTTP 206 con 501 bytes en
-- 33 ms. Cada tanda pide solo su ventana. Al terminar (o al abandonar una
-- corrida vieja) el objeto se borra.
--
-- El bucket es PRIVADO y **sin ninguna política de `storage.objects`**, ni
-- siquiera para `authenticated`: solo se toca con `lib/storage-admin.ts`
-- (service_role). Mismo patrón exacto que `compartidos-temp`
-- (`20260814100000_share_target_temporal.sql`), y por el mismo motivo: nadie
-- con sesión tiene nada que hacer con este archivo. No participa de
-- `encolar_purga_storage()` porque su objeto no cuelga de ninguna fila de
-- `documents`/`insurance_cards`/`profiles`; lo borra la propia sincronización.
--
-- 12 MB de tope: el CSV vigente pesa 8,97 MB y las ediciones vienen creciendo
-- (6,0 MB en 2019, 7,4 MB en 2021, 8,97 MB en 2025). 12 MB deja lugar para
-- las próximas dos o tres sin volver a tocar la base, y sigue siendo un techo
-- que corta en seco si algún día la URL devuelve algo que no es este CSV.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'refes-sync',
    'refes-sync',
    false,
    12582912,
    array['text/csv', 'text/plain', 'application/octet-stream']
)
on conflict (id) do nothing;


-- =============================================================================
-- 5. reclamar_sincronizacion_refes() — el lock, atómico
-- -----------------------------------------------------------------------------
-- Dos personas pueden apretar "Actualizar" en el mismo minuto. Sin lock, las
-- dos corridas pisarían el MISMO `run_byte_offset` y el catálogo terminaría a
-- medias (cada una avanzando el offset de la otra, saltándose filas).
--
-- El lock es una sola sentencia UPDATE con la condición en el WHERE: Postgres
-- la evalúa con la fila bloqueada, así que de dos llamadas simultáneas
-- exactamente una ve `status <> 'running'` y se lleva el lock; la otra
-- actualiza cero filas y recibe `false`. No hace falta `for update`, ni
-- advisory locks, ni un `serializable`.
--
-- El lock CADUCA: si `run_heartbeat_at` quedó más viejo que `p_ttl_segundos`
-- (la pestaña se cerró, el celular perdió señal a mitad de corrida), la
-- llamada siguiente se lo lleva igual. Sin esa cláusula, una corrida
-- interrumpida dejaría el botón "Actualizar" muerto para siempre y la única
-- salida sería tocar la base a mano.
--
-- SECURITY DEFINER porque `authenticated` no tiene -y no debe tener- UPDATE
-- sobre `health_centers_sync`. `set search_path = ''` y `revoke execute from
-- public` como todas las funciones de este proyecto (docs/modelo-permisos.md
-- §6): la ejecuta el Route Handler con service_role, no una sesión del
-- navegador.
-- =============================================================================

create function public.reclamar_sincronizacion_refes(
    p_usuario       uuid,
    p_ttl_segundos  integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_tomado boolean;
begin
    update public.health_centers_sync
       set status           = 'running',
           run_started_at   = now(),
           run_heartbeat_at = now(),
           run_started_by   = p_usuario,
           run_error        = null
     where id
       and (status <> 'running'
            or run_heartbeat_at is null
            or run_heartbeat_at < now() - make_interval(secs => greatest(p_ttl_segundos, 1)))
    returning true into v_tomado;

    return coalesce(v_tomado, false);
end;
$$;

comment on function public.reclamar_sincronizacion_refes(uuid, integer) is
    'Toma el lock de la sincronización del catálogo REFES de forma atómica (Sprint 16, tarea 16.3). Devuelve true si esta llamada se quedó con el lock y false si ya hay otra corrida viva. El lock caduca a los p_ttl_segundos sin latido, para que una corrida abandonada -pestaña cerrada, señal perdida- no deje el botón "Actualizar" muerto. Registra en run_started_by qué cuenta lo disparó.';

-- `revoke ... from public` + `grant ... to service_role`, y NO a
-- `authenticated`: el mismo patrón que `reclamar_recordatorios_turnos` y
-- `generar_alertas_medicacion` (`20260813050000` §7, `20260813070000` §6), y
-- por el mismo motivo. Quien llama es un Route Handler que ya verificó la
-- sesión y corre con service_role, no el navegador; darle EXECUTE a
-- `authenticated` permitiría que una pestaña tomara el lock por RPC sin pasar
-- por el endpoint que descarga y procesa. `scripts/test-rls.sql` (BLOQUE 22)
-- verifica las dos cosas: que María no pueda ejecutarla y que service_role sí.
revoke execute on function public.reclamar_sincronizacion_refes(uuid, integer) from public;
grant  execute on function public.reclamar_sincronizacion_refes(uuid, integer) to service_role;

-- Fin de la migración.
