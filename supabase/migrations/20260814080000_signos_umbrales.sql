-- =============================================================================
-- Historial Médico — Migración 20260814080000: umbrales clínicos por perfil y
-- registro de alertas de signos vitales (Sprint 9, tarea 9.2)
-- -----------------------------------------------------------------------------
-- El ROADMAP la nombraba `0012_signos_umbrales.sql`. Trae dos tablas:
--
--   · `vital_sign_thresholds` — los umbrales, con defaults globales y una fila
--     OPCIONAL por perfil que los reemplaza. Sin fila = defaults.
--   · `vital_sign_alerts`     — una fila por REGLA VIOLADA de una medición.
--                               Es la fuente del banner y del push de la 9.3.
--
-- ── LOS UMBRALES SON ORIENTATIVOS, Y ESO ESTÁ ESCRITO EN LA BASE
--
-- El ROADMAP es explícito: "los umbrales son orientativos, no diagnóstico: el
-- texto debe decirlo". Acá eso no es una convención de la capa de aplicación
-- sino un `CHECK`: `vital_sign_alerts_mensaje_con_descargo` exige que el texto
-- de CADA alerta contenga la frase "no reemplaza el criterio médico". Un
-- refactor de copy que se olvide del descargo no compila contra la base.
--
-- ── DÓNDE VIVE EL MOTOR, Y POR QUÉ NO ACÁ
--
-- La evaluación (¿esta medición viola alguna regla?) es TypeScript puro:
-- `lib/signos/evaluar.ts`, cubierto por `tests/unit/umbrales.test.ts`. La base
-- guarda el resultado, no lo calcula. Es lo contrario de lo que hizo el Sprint
-- 7 con `v_medicacion_estado.necesita_renovacion` y la diferencia tiene un
-- motivo concreto:
--
--   · El umbral de renovación se evalúa sobre TODA la base, dos veces por día,
--     desde `pg_cron`. No hay ningún proceso de aplicación involucrado: tenía
--     que ser SQL.
--   · Un umbral clínico se evalúa sobre UNA medición, en el instante en que
--     alguien la carga, dentro de una Server Action que ya tiene los valores
--     validados en la mano (`lib/validacion/signo.schema.ts`). Bajarlo a un
--     trigger convertiría un fallo de la evaluación en un fallo de la CARGA —y
--     la regla de producto es la contraria: la medición se guarda siempre, la
--     alerta es best-effort (mismo contrato que `generarTomasDelDiaComoServicio`
--     en `crearMedicacion`).
--
-- Consecuencia declarada: **esta migración no impide que exista una medición
-- fuera de umbral sin su fila de alerta.** Si la evaluación falla, queda el
-- log y la medición. Nada se pierde y nada se bloquea.
--
-- ── QUIÉN ESCRIBE LAS ALERTAS: `service_role`, NO EL CLIENTE
--
-- Se evaluó una política `INSERT` estrecha para `authenticated`
-- (`with check (public.puede_cargar_en_perfil(profile_id))`): la carga la hace
-- quien tiene `can_upload` y la alerta deriva de su propia medición, así que
-- "quien puede cargar puede alertar" suena razonable. Se descarta por tres
-- motivos, en orden de peso:
--
--   1. **RLS autoriza autores, no verifica derivaciones.** La fila de alerta es
--      una AFIRMACIÓN sobre otra fila ("la sistólica fue 170 y el umbral era
--      160"). Ninguna política puede comprobar esa aritmética. Con INSERT desde
--      el cliente, una sesión podría colgar de una medición de 120/80 una
--      alerta que dice 300, con `created_at` y todo: un dato clínico falso con
--      aspecto de rastro auditable. Insertar una medición falsa NO es
--      equivalente —queda a la vista en `/signos` y `can_manage` puede
--      corregirla—; una alerta falsa no la ve nadie hasta que suena el push.
--   2. **La tabla es un emisor de notificaciones a terceros.** La 9.3 convierte
--      cada fila en un Web Push a todos los `can_manage` del perfil. Una
--      política de INSERT para `authenticated` le da a cualquier `can_upload`
--      un primitivo para notificar a la familia con el texto que quiera.
--   3. **Coherencia con la otra tabla de alertas.** `medication_renewal_alerts`
--      (20260813070000 §2) ya tomó exactamente esta decisión y la escribió:
--      "una sesión que pudiera borrar sus alertas podría hacerse mandar el
--      mismo aviso en loop". Dos tablas de alerta con modelos de escritura
--      opuestos serían una trampa para quien lea la segunda.
--
-- Lo que el cliente SÍ puede hacer es marcarlas vistas, y eso es un `UPDATE`
-- de UNA columna: ver §3.3 (privilegio de columna + trigger de sellado).
--
-- El módulo que escribe es `lib/signos/registrar-alertas.ts`, calcado de
-- `lib/medicacion/generar-tomas-admin.ts`: `server-only`, `SERVICE_ROLE_KEY`,
-- y recibe solo el `id` de la medición —relee de la base lo que va a evaluar,
-- así la alerta describe lo que quedó PERSISTIDO y no lo que había en memoria—.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema y toda función con
-- `set search_path = ''`, igual que el resto del proyecto.
-- =============================================================================


-- =============================================================================
-- 1. EL ENUM DE REGLAS
-- -----------------------------------------------------------------------------
-- Cinco reglas, en español como `access_action` y por el mismo motivo: son las
-- que lee la interfaz. Un enum de verdad y no `text` + CHECK (lo que sí usa
-- `medication_renewal_alerts.estado`) porque acá el conjunto es un DOMINIO
-- CERRADO del producto y no una máquina de estados: `npm run types:gen` lo
-- baja a una unión de literales de TypeScript, y la 9.3 escribe el `switch` del
-- banner con exhaustividad verificada por el compilador.
--
-- Sumar una regla nueva es una migración con `alter type ... add value`, y eso
-- es una virtud: cada regla clínica nueva queda registrada en el historial de
-- migraciones con su fecha y su justificación.
-- =============================================================================

create type public.vital_sign_alert_rule as enum (
    'sistolica_alta',
    'diastolica_alta',
    'glucemia_baja',
    'glucemia_alta',
    'peso_variacion'
);

comment on type public.vital_sign_alert_rule is
    'Regla clínica orientativa que disparó una alerta de signos vitales. El motor que las evalúa es lib/signos/evaluar.ts; los umbrales salen de vital_sign_thresholds.';


-- =============================================================================
-- 2. TABLA vital_sign_thresholds
-- -----------------------------------------------------------------------------
-- Una fila = "este perfil tiene umbrales propios". SIN FILA = los defaults
-- globales, que están en `lib/signos/umbrales.ts#UMBRALES_POR_DEFECTO` y
-- repetidos acá como `DEFAULT` de columna (ver "la doble fuente", abajo).
--
-- ── POR QUÉ LA FILA ES OPCIONAL Y NO SE CREA CON EL PERFIL
--
-- Materializar una fila por perfil obligaría a un trigger sobre `profiles`, a
-- un backfill, y —lo peor— congelaría los defaults del día en que se creó cada
-- perfil. Con la fila opcional, mejorar un default global alcanza a todos los
-- perfiles que nunca fueron revisados, que son la enorme mayoría, y deja
-- intactos los que un médico ajustó a mano. La ausencia de fila ES el dato:
-- "nadie personalizó esto todavía".
--
-- ── POR QUÉ LAS COLUMNAS SON `NOT NULL` Y NO UN OVERRIDE PARCIAL
--
-- La alternativa era columnas nullable (NULL = "usá el default de esa
-- columna"). Se descarta: con overrides parciales los `CHECK` de coherencia
-- dejan de ser evaluables dentro de la fila —`glucemia_min < glucemia_max` no
-- se puede comprobar si uno de los dos es NULL— y la base admitiría un perfil
-- con `glucemia_min = 300` y `glucemia_max` heredado en 250, que dispara las
-- dos alertas de glucemia a la vez para valores intermedios.
--
-- Con columnas `NOT NULL` + `DEFAULT`, la ergonomía del override parcial se
-- conserva igual —`insert into vital_sign_thresholds (profile_id,
-- sistolica_max) values (:p, 150)` completa el resto con los defaults— y CADA
-- coherencia se verifica dentro de la fila. Es la misma forma que
-- `medications.dose_unit`: default sensato, columna obligatoria.
--
-- ── LA DOBLE FUENTE DE LOS DEFAULTS, Y CÓMO NO DIVERGE
--
-- Los números viven dos veces: acá (para que un `INSERT` parcial sea coherente)
-- y en `lib/signos/umbrales.ts` (para el caso "no hay fila", que es el 100% de
-- los perfiles hoy y donde la base ni siquiera se consulta). No hay forma de
-- expresar una sola fuente cruzando dos lenguajes, así que se cubre con una
-- PRUEBA: `scripts/test-rls.sql` BLOQUE 14 lee los `DEFAULT` reales de
-- `pg_attrdef` y los compara contra los literales documentados. Si alguien
-- cambia un lado y no el otro, el arnés se pone en rojo.
--
-- ── EL CRITERIO DE LOS RANGOS DE CADA `CHECK`
--
-- No son plausibilidad del VALOR MEDIDO —eso ya lo hace `vital_signs` §4.9—
-- sino plausibilidad del UMBRAL: impiden configurar un umbral que convierta la
-- alerta en ruido permanente (`sistolica_max = 100` alerta con toda medición
-- normal) o en silencio permanente (`glucemia_max = 900` no alerta nunca,
-- porque `vital_signs_valor_positivo` no pone techo pero la clínica sí).
-- =============================================================================

create table public.vital_sign_thresholds (
    profile_id        uuid primary key
                      references public.profiles (id) on delete cascade,

    sistolica_max     smallint    not null default 160,
    diastolica_max    smallint    not null default 100,
    glucemia_min      numeric     not null default 70,
    glucemia_max      numeric     not null default 250,
    peso_variacion_kg numeric     not null default 2.0,
    peso_ventana_dias smallint    not null default 7,

    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    constraint vital_sign_thresholds_sistolica_plausible
        check (sistolica_max between 100 and 250),
    constraint vital_sign_thresholds_diastolica_plausible
        check (diastolica_max between 60 and 160),
    -- Coherente con `vital_signs_sistolica_mayor_diastolica`: un par de
    -- umbrales invertido describiría una medición que la base no acepta.
    constraint vital_sign_thresholds_sistolica_mayor_diastolica
        check (sistolica_max > diastolica_max),
    constraint vital_sign_thresholds_glucemia_min_plausible
        check (glucemia_min between 40 and 120),
    constraint vital_sign_thresholds_glucemia_max_plausible
        check (glucemia_max between 140 and 500),
    constraint vital_sign_thresholds_glucemia_min_menor_max
        check (glucemia_min < glucemia_max),
    -- Menos de medio kilo entra en el ruido de la balanza doméstica y de la
    -- hora del día; más de 20 kg no es una variación, es otra persona.
    constraint vital_sign_thresholds_peso_variacion_plausible
        check (peso_variacion_kg between 0.5 and 20),
    constraint vital_sign_thresholds_peso_ventana_plausible
        check (peso_ventana_dias between 1 and 90)
);

comment on table public.vital_sign_thresholds is
    'Umbrales clínicos ORIENTATIVOS de un perfil (Sprint 9.2). La fila es opcional: sin fila rigen los defaults globales de lib/signos/umbrales.ts, que son los mismos que los DEFAULT de estas columnas. Las columnas son NOT NULL a propósito — un override parcial dejaría los CHECK de coherencia sin poder evaluarse dentro de la fila.';
comment on column public.vital_sign_thresholds.profile_id is
    'Es también la clave primaria: como mucho una fila de umbrales por perfil. Sin fila = defaults globales.';
comment on column public.vital_sign_thresholds.sistolica_max is
    'Sistólica (mmHg) a partir de la cual se alerta, INCLUSIVE: 160 exactos disparan. Default 160 (hipertensión grado 2 de la clasificación ESC/ESH). Ver lib/signos/evaluar.ts, "el umbral pertenece al lado que alerta".';
comment on column public.vital_sign_thresholds.diastolica_max is
    'Diastólica (mmHg) a partir de la cual se alerta, INCLUSIVE: 100 exactos disparan. Default 100. Junto con sistolica_max es el caso 16/10 del criterio de aceptación del ROADMAP.';
comment on column public.vital_sign_thresholds.glucemia_min is
    'Glucemia (mg/dL) en o por debajo de la cual se alerta, INCLUSIVE: 70 exactos disparan. Default 70, el "alert value" de hipoglucemia de la ADA.';
comment on column public.vital_sign_thresholds.glucemia_max is
    'Glucemia (mg/dL) en o por encima de la cual se alerta, INCLUSIVE: 250 exactos disparan. Default 250.';
comment on column public.vital_sign_thresholds.peso_variacion_kg is
    'Variación de peso en kg, en valor absoluto, que dispara la alerta al compararse con la MEDIANA de los pesos de la ventana. Inclusive: 2,0 kg exactos disparan. Default 2.0.';
comment on column public.vital_sign_thresholds.peso_ventana_dias is
    'Días hacia atrás desde la medición nueva que forman la ventana de referencia del peso. Default 7. Sin ninguna medición previa en la ventana no hay regla de peso: no se puede afirmar una variación sin referencia.';

create trigger vital_sign_thresholds_set_updated_at
    before update on public.vital_sign_thresholds
    for each row execute function public.set_updated_at();


-- =============================================================================
-- 3. TABLA vital_sign_alerts
-- -----------------------------------------------------------------------------
-- Una fila = "la medición M violó la regla R". UNA MEDICIÓN PUEDE PRODUCIR
-- VARIAS FILAS: 160/100 viola `sistolica_alta` y `diastolica_alta`, y las dos
-- son información distinta para quien atiende.
--
-- ── QUÉ SE GUARDA Y POR QUÉ SE GUARDA REDUNDANTE
--
-- `valor` y `umbral` son derivables (el primero de `vital_signs`, el segundo de
-- `vital_sign_thresholds`), y sin embargo se persisten. El motivo es que la
-- alerta es un REGISTRO CLÍNICO con fecha: si mañana un médico sube
-- `sistolica_max` a 170, la alerta de ayer tiene que seguir diciendo que se
-- disparó contra 160. Un banner que recalcula contra los umbrales de hoy
-- reescribe el pasado, y `acknowledged_by` estaría firmando un texto que ya no
-- existe. Misma familia de decisión que
-- `medication_renewal_alerts.dias_restantes` ("registro histórico de por qué se
-- disparó el aviso").
--
-- `mensaje` sigue el mismo criterio llevado hasta el final: se guarda el texto
-- QUE SE MOSTRÓ, no los ingredientes para recomponerlo. Es lo que la persona
-- leyó y lo que marcó como visto.
--
-- ── EL DESCARGO ES UNA CONSTRAINT
--
-- `vital_sign_alerts_mensaje_con_descargo` exige la frase "no reemplaza el
-- criterio médico" dentro de `mensaje`. Es la traducción literal del ROADMAP
-- ("los umbrales son orientativos, no diagnóstico: el texto debe decirlo") a
-- algo que no depende de que nadie se acuerde. La frase completa vive en
-- `lib/signos/evaluar.ts#DESCARGO_CLINICO`; el CHECK verifica el fragmento
-- estable, no la puntuación, para que mejorar la redacción alrededor no exija
-- una migración.
--
-- ── ANTIDUPLICACIÓN
--
-- `unique (vital_sign_id, regla)`. Acá alcanza con un UNIQUE a secas —y no hace
-- falta la ventana deslizante de `medication_renewal_alerts`— porque el evento
-- es DISCRETO: una medición ocurre una vez y su evaluación es determinista.
-- Reintentar la evaluación de la misma medición (un doble submit del
-- formulario que reusa la fila, una corrida manual de reparación) no puede
-- duplicar la alerta. Dos cargas distintas del mismo valor son dos mediciones
-- distintas y SÍ producen dos alertas: son dos hechos clínicos distintos.
-- =============================================================================

create table public.vital_sign_alerts (
    id              uuid primary key default gen_random_uuid(),
    vital_sign_id   uuid not null references public.vital_signs (id) on delete cascade,
    -- Desnormalizado por el mismo motivo que `medication_intakes.profile_id`
    -- (docs/modelo-datos.md decisión 6): las políticas y el banner filtran por
    -- perfil y no pueden pagar un join contra `vital_signs` en cada evaluación
    -- de RLS. Lo sella el trigger de §3.2 — no se confía en quien inserta.
    profile_id      uuid not null references public.profiles (id) on delete cascade,
    tipo            public.vital_sign_type       not null,
    regla           public.vital_sign_alert_rule not null,
    valor           numeric not null,
    umbral          numeric not null,
    referencia      numeric,
    mensaje         text    not null,
    created_at      timestamptz not null default now(),
    acknowledged_at timestamptz,
    acknowledged_by uuid references public.profiles (id) on delete set null,

    -- El tipo no es libre: se deduce de la regla. Guardarlo igual permite
    -- filtrar "alertas de tensión" sin desarmar el enum de reglas en la
    -- consulta; el CHECK impide que las dos columnas se contradigan.
    constraint vital_sign_alerts_regla_coherente_con_tipo
        check (
            (regla in ('sistolica_alta', 'diastolica_alta') and tipo = 'blood_pressure')
            or (regla in ('glucemia_baja', 'glucemia_alta') and tipo = 'glucose')
            or (regla = 'peso_variacion'                    and tipo = 'weight')
        ),
    -- `referencia` es la mediana de la ventana de peso: existe exactamente en
    -- la regla que compara contra un historial, y en ninguna otra.
    constraint vital_sign_alerts_referencia_solo_en_peso
        check ((regla = 'peso_variacion') = (referencia is not null)),
    constraint vital_sign_alerts_valor_positivo
        check (valor > 0),
    constraint vital_sign_alerts_umbral_positivo
        check (umbral > 0),
    constraint vital_sign_alerts_referencia_positiva
        check (referencia is null or referencia > 0),
    -- El ROADMAP, hecho constraint: "los umbrales son orientativos, no
    -- diagnóstico: el texto debe decirlo".
    constraint vital_sign_alerts_mensaje_con_descargo
        check (position('no reemplaza el criterio médico' in mensaje) > 0),
    -- Quién y cuándo son un solo hecho: o están los dos o no está ninguno.
    constraint vital_sign_alerts_visto_coherente
        check ((acknowledged_at is null) = (acknowledged_by is null))
);

comment on table public.vital_sign_alerts is
    'Una fila por REGLA violada por una medición de vital_signs (Sprint 9.2). Es la fuente del banner persistente y del push de la 9.3. Nadie la escribe desde el cliente: las filas las crea lib/signos/registrar-alertas.ts con service_role. Lo único que una sesión puede hacer es marcarlas vistas (privilegio de columna sobre acknowledged_at + trigger de sellado).';
comment on column public.vital_sign_alerts.vital_sign_id is
    'La medición que disparó la alerta. ON DELETE CASCADE: borrar una medición mal cargada (can_manage) se lleva sus alertas, que dejarían de tener referente.';
comment on column public.vital_sign_alerts.profile_id is
    'De quién es la medición. Desnormalizado desde vital_signs y SELLADO por el trigger vital_sign_alerts_sellar_perfil: es la columna que decide qué familia ve la alerta, y no puede depender de que quien inserta la mande bien.';
comment on column public.vital_sign_alerts.tipo is
    'Tipo del signo medido. Redundante con regla y verificado contra ella por vital_sign_alerts_regla_coherente_con_tipo; existe para filtrar por tipo sin enumerar reglas.';
comment on column public.vital_sign_alerts.valor is
    'Valor OBSERVADO en la unidad del tipo (mmHg la sistólica o la diastólica según la regla, mg/dL la glucemia, kg el peso). En peso_variacion es el peso nuevo, no la diferencia: la diferencia es valor - referencia.';
comment on column public.vital_sign_alerts.umbral is
    'Umbral APLICADO en el momento de la evaluación. Se persiste, en vez de releerse de vital_sign_thresholds, para que cambiar un umbral no reescriba las alertas ya emitidas ni el texto que alguien marcó como visto.';
comment on column public.vital_sign_alerts.referencia is
    'Solo en peso_variacion: la mediana de los pesos de la ventana contra la que se comparó. NULL en las demás reglas (lo exige vital_sign_alerts_referencia_solo_en_peso).';
comment on column public.vital_sign_alerts.mensaje is
    'El texto que se mostró, ya redactado por lib/signos/evaluar.ts. Se guarda en vez de recomponerse porque es lo que la persona leyó y marcó como visto. El CHECK vital_sign_alerts_mensaje_con_descargo garantiza que contenga el descargo "no reemplaza el criterio médico".';
comment on column public.vital_sign_alerts.acknowledged_at is
    'Cuándo alguien marcó la alerta como vista. NULL = el banner de la 9.3 sigue mostrándola. Lo sella el trigger vital_sign_alerts_sellar_visto con now(): el cliente no elige la hora.';
comment on column public.vital_sign_alerts.acknowledged_by is
    'Qué perfil la marcó vista. Lo sella el trigger con perfil_actor(); authenticated ni siquiera tiene privilegio de UPDATE sobre esta columna, así que nadie puede atribuir el visto a otra persona.';

-- Antidup (ver el encabezado de §3): la evaluación de una medición es
-- determinista, así que la misma regla sobre la misma medición es siempre la
-- misma alerta. Sirve además como índice de lookup por `vital_sign_id`, que es
-- como la 9.4 va a marcar los puntos fuera de umbral en el gráfico.
create unique index vital_sign_alerts_una_por_regla
    on public.vital_sign_alerts (vital_sign_id, regla);

-- LA CONSULTA DEL BANNER (9.3): "¿este perfil tiene alertas sin ver?".
-- Parcial: las vistas son el 100% de la tabla pasadas unas horas y no se
-- consultan nunca por esta vía.
create index vital_sign_alerts_sin_ver_idx
    on public.vital_sign_alerts (profile_id, created_at desc)
 where acknowledged_at is null;

-- FK de `profile_id`: PostgreSQL no lo crea solo y sin él cada DELETE sobre
-- `profiles` hace scan secuencial (docs/modelo-datos.md §4). Sirve también al
-- listado histórico de alertas de un perfil, que no filtra por vistas.
create index vital_sign_alerts_profile_fecha_idx
    on public.vital_sign_alerts (profile_id, created_at desc);


-- -----------------------------------------------------------------------------
-- 3.2 El perfil de la alerta se sella desde la medición
-- -----------------------------------------------------------------------------
-- `profile_id` decide QUÉ FAMILIA VE LA ALERTA. Dejarlo en manos de quien
-- inserta —aunque hoy quien inserta sea `service_role` y el módulo lo mande
-- bien— haría que un bug de una línea filtrara un dato de salud a otra familia.
-- El trigger lo deriva de `vital_signs`, siempre, ignorando lo que llegó: la
-- columna pasa a ser opcional en el INSERT y a la vez imposible de falsear.
--
-- `SECURITY DEFINER` para que la lectura de `vital_signs` no dependa de las
-- políticas de quien escribe: el sellado tiene que dar el mismo resultado
-- venga de donde venga la fila.
create or replace function public.sellar_perfil_de_alerta_signo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_profile_id uuid;
begin
    select v.profile_id into v_profile_id
      from public.vital_signs v
     where v.id = new.vital_sign_id;

    if v_profile_id is null then
        raise exception 'La alerta referencia una medición inexistente (%)', new.vital_sign_id
            using errcode = '23503';
    end if;

    new.profile_id := v_profile_id;
    return new;
end;
$$;

comment on function public.sellar_perfil_de_alerta_signo() is
    'Deriva vital_sign_alerts.profile_id de la medición referenciada, ignorando el valor que traiga el INSERT/UPDATE. profile_id es la columna que resuelve las políticas de lectura: no puede depender de que quien escribe la mande bien.';

create trigger vital_sign_alerts_sellar_perfil
    before insert or update on public.vital_sign_alerts
    for each row execute function public.sellar_perfil_de_alerta_signo();


-- -----------------------------------------------------------------------------
-- 3.3 "Marcar como vista": una sola columna, sellada
-- -----------------------------------------------------------------------------
-- El ROADMAP pide para la 9.3 que el banner "quede hasta que se lo marca visto
-- y eso se registre con usuario y hora". Esta migración deja el camino armado
-- para que esa tarea sea solo la Server Action `marcarAlertaVista`:
--
--   · Privilegio de COLUMNA: `authenticated` tiene `UPDATE (acknowledged_at)` y
--     nada más. No es una convención de la aplicación —es el catálogo—: un
--     `update` que toque `mensaje`, `umbral` o `acknowledged_by` recibe 42501
--     aunque la política de fila lo autorice.
--   · Política de FILA: solo `can_manage` (y el titular). Son los mismos que
--     reciben el push y los mismos que ven la alerta.
--   · Trigger de SELLADO: la hora la pone `now()` y el autor `perfil_actor()`.
--     El cliente manda cualquier valor no nulo en `acknowledged_at` y la base
--     lo reemplaza por el verdadero.
--
-- Y una vez vista, la alerta no se puede "desver": el registro de quién la
-- atendió es el rastro de que alguien se hizo cargo. Volver a NULL borraría esa
-- responsabilidad; el trigger conserva los valores viejos en silencio en vez de
-- fallar, para que un `update` idempotente de la 9.3 no tenga que distinguir el
-- caso.
create or replace function public.sellar_visto_de_alerta_signo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if old.acknowledged_at is not null then
        -- Ya estaba vista: es inmutable.
        new.acknowledged_at := old.acknowledged_at;
        new.acknowledged_by := old.acknowledged_by;
    elsif new.acknowledged_at is not null then
        new.acknowledged_at := now();
        new.acknowledged_by := public.perfil_actor();
    else
        new.acknowledged_by := null;
    end if;

    return new;
end;
$$;

comment on function public.sellar_visto_de_alerta_signo() is
    'Sella acknowledged_at con now() y acknowledged_by con perfil_actor() cuando una alerta se marca vista, y hace inmutable el par una vez fijado. Impide atribuir el visto a otra persona o a otra hora, y que alguien "desvea" una alerta ya atendida.';

create trigger vital_sign_alerts_sellar_visto
    before update on public.vital_sign_alerts
    for each row execute function public.sellar_visto_de_alerta_signo();


-- =============================================================================
-- 4. RLS Y PRIVILEGIOS
-- -----------------------------------------------------------------------------
-- ── UMBRALES: `can_view` lee, `can_manage` edita
--
-- Es la regla general de las tablas de contenido (docs/modelo-permisos.md
-- §6.1) sin ninguna excepción: leer con `puede_ver_perfil`, escribir con
-- `puede_administrar_perfil`. `can_upload` NO edita umbrales —cambiar el umbral
-- de alerta de una persona mayor es una decisión clínica del administrador, no
-- "cargar el dato del día"—, pero sí los LEE, porque la lectura es monótona
-- (§4.1: `can_upload` implica `can_view`) y porque quien carga necesita, en la
-- 9.3 y la 9.4, ver contra qué se está comparando lo que carga.
--
-- ── ALERTAS: las ve quien las va a atender
--
-- `puede_administrar_perfil` = titular OR `can_manage`, que es exactamente el
-- conjunto de `destinatarios_de_avisos()` (20260813050000 §4.4) más el titular
-- con cuenta. La regla del proyecto, otra vez: quien recibe el push puede ver
-- la fila que lo generó, y quien no lo recibe no ve ninguna de las dos cosas
-- (docs/modelo-permisos.md §4.3, "los can_view y can_upload no las reciben").
--
-- Consecuencia buscada y anotada: **quien carga la medición con `can_upload` no
-- ve la alerta que su propia carga generó.** Ve la medición —`vital_signs` es
-- monótona en lectura— pero el escalamiento es asunto de quien administra. Es
-- la minimización del Sprint 6 aplicada acá.
--
-- ── EL REVOKE NO ES DECORATIVO (la lección de 20260813050000 §3)
--
-- Supabase trae `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
-- authenticated`: toda tabla nueva de `public` nace con TRUNCATE para los dos
-- roles públicos, y RLS no protege de un TRUNCATE. Sin estos revokes un
-- visitante sin sesión podría vaciar las dos tablas —y con ellas los umbrales
-- personalizados de toda la base—. El caso "Privilegios de anon sobre tablas de
-- public" del BLOQUE 7 de `scripts/test-rls.sql` exige 0.
-- =============================================================================

alter table public.vital_sign_thresholds enable row level security;
alter table public.vital_sign_alerts     enable row level security;

revoke all on public.vital_sign_thresholds from anon, authenticated;
revoke all on public.vital_sign_alerts     from anon, authenticated;

grant select, insert, update, delete on public.vital_sign_thresholds to authenticated;
grant select, insert, update, delete on public.vital_sign_thresholds to service_role;

-- Lectura completa; escritura acotada a UNA columna (§3.3). El INSERT no
-- aparece: las alertas las crea el servicio.
grant select                        on public.vital_sign_alerts to authenticated;
grant update (acknowledged_at)      on public.vital_sign_alerts to authenticated;
grant select, insert, update, delete on public.vital_sign_alerts to service_role;

create policy vital_sign_thresholds_select_puede_ver
    on public.vital_sign_thresholds
    for select to authenticated
    using (public.puede_ver_perfil(profile_id));

create policy vital_sign_thresholds_insert_administrador
    on public.vital_sign_thresholds
    for insert to authenticated
    with check (public.puede_administrar_perfil(profile_id));

create policy vital_sign_thresholds_update_administrador
    on public.vital_sign_thresholds
    for update to authenticated
    using (public.puede_administrar_perfil(profile_id))
    with check (public.puede_administrar_perfil(profile_id));

create policy vital_sign_thresholds_delete_administrador
    on public.vital_sign_thresholds
    for delete to authenticated
    using (public.puede_administrar_perfil(profile_id));

comment on policy vital_sign_thresholds_select_puede_ver on public.vital_sign_thresholds is
    'Regla general de lectura (docs/modelo-permisos.md §6.1): titular, can_view, can_upload o can_manage. Quien carga mediciones necesita saber contra qué se comparan.';
comment on policy vital_sign_thresholds_update_administrador on public.vital_sign_thresholds is
    'Cambiar el umbral de alerta de una persona es una decisión clínica: solo el titular o can_manage. can_upload no edita umbrales aunque cargue las mediciones.';

create policy vital_sign_alerts_select_administrador
    on public.vital_sign_alerts
    for select to authenticated
    using (public.puede_administrar_perfil(profile_id));

create policy vital_sign_alerts_update_visto_administrador
    on public.vital_sign_alerts
    for update to authenticated
    using (public.puede_administrar_perfil(profile_id))
    with check (public.puede_administrar_perfil(profile_id));

comment on policy vital_sign_alerts_select_administrador on public.vital_sign_alerts is
    'Los administradores de un perfil (can_manage) y su titular leen sus alertas clínicas: son los mismos que reciben el push, según destinatarios_de_avisos(). No hay política de INSERT ni de DELETE a propósito — las filas las escribe lib/signos/registrar-alertas.ts con service_role, porque RLS puede autorizar a un autor pero no verificar que la alerta describa de verdad a su medición.';
comment on policy vital_sign_alerts_update_visto_administrador on public.vital_sign_alerts is
    'Habilita marcarAlertaVista (Sprint 9.3). El alcance real de este UPDATE no lo fija la política sino el privilegio de columna: authenticated solo tiene UPDATE (acknowledged_at), y el trigger vital_sign_alerts_sellar_visto reemplaza el valor por now() y sella el autor con perfil_actor().';


-- =============================================================================
-- 5. LO QUE ESTA MIGRACIÓN NO HACE
-- -----------------------------------------------------------------------------
--   · **No notifica.** El push y el banner son la tarea 9.3. Esta migración
--     deja la cola (`acknowledged_at is null`) y su índice.
--   · **No cubre hipotensión ni bradicardia.** El ROADMAP enumera tres reglas
--     (sistólica/diastólica altas, glucemia fuera de rango, variación de peso) y
--     el alcance se respeta al pie. Una sistólica de 85 —relevante de verdad en
--     una persona mayor por el riesgo de caída— NO dispara nada hoy. Queda
--     anotado como deuda explícita en `docs/modelo-signos.md` §8 para que nadie
--     lea el silencio de la app como una validación.
--   · **No evalúa el pasado.** Las mediciones ya cargadas (las del seed
--     incluidas) no reciben alertas retroactivas por esta migración; el seed
--     trae las suyas escritas a mano para que la 9.3 tenga un banner contra el
--     cual desarrollar.
-- =============================================================================

-- Fin de la migración.
