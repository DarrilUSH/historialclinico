-- =============================================================================
-- Historial Médico — Migración 20260813060000: estado de medicación
-- (Sprint 7, tarea 7.1 — "Modelo de medicación, tomas y cálculo de stock")
-- -----------------------------------------------------------------------------
-- QUÉ NO HACE ESTA MIGRACIÓN. No crea `medications` ni `medication_intakes`:
-- las dos existen desde `20260812200000_schema_inicial.sql` §4.7 y §4.8, con
-- sus CHECK de coherencia por frecuencia (`medications_esquema_coherente`), su
-- `UNIQUE (medication_id, scheduled_at)` y sus políticas RLS en
-- `20260812220000_rls.sql` §5. Tampoco toca ninguna de esas políticas.
--
-- QUÉ AGREGA. Las tres piezas que el modelo tenía escritas como pendientes y
-- que los sprints 7.2 a 7.5 necesitan como base:
--
--   1. `v_medicacion_estado`   — la fórmula de días de stock, materializada.
--   2. `registrar_toma()` / `revertir_toma()` — las dos escrituras atómicas que
--      RLS no puede expresar (nota ⑨ de `docs/modelo-permisos.md`).
--   3. `generar_tomas_del_dia()` + su job de `pg_cron` — las tomas programadas
--      que 7.3 marca y 7.4 vigila.
--
-- ── POR QUÉ UNA VISTA Y NO UNA COLUMNA `dias_restantes`
--
-- `dias_restantes` es una función de tres columnas que ya existen
-- (`stock_units`, `dose_amount`, y las tomas por día que salen de `frequency`)
-- y del calendario. Guardarla materializada obligaría a recalcularla en cada
-- toma, en cada edición de dosis y —lo peor— **cada vez que cambia el día**,
-- que es un evento que ninguna escritura dispara. Una columna así se
-- desincroniza en silencio: muestra "quedan 5 días" durante una semana.
--
-- La vista se calcula en el momento de la consulta, es siempre coherente y no
-- agrega ningún camino de escritura nuevo. El costo es despreciable: son
-- decenas de filas por perfil y el cálculo es aritmética sobre columnas ya
-- leídas.
--
-- ── POR QUÉ `security_invoker = true` NO ES OPCIONAL
--
-- Una vista se ejecuta, por defecto, con los permisos de su DUEÑO. El dueño acá
-- es `postgres`, que tiene `BYPASSRLS`: una vista normal sobre `medications`
-- sería un agujero que devuelve la medicación de TODAS las familias a
-- cualquiera con `SELECT` sobre la vista. Con `security_invoker = true`
-- (PostgreSQL 15+) las políticas de `medications` se evalúan contra quien
-- consulta, así que la vista hereda exactamente `medications_select_puede_ver`
-- y no hay una segunda matriz de permisos que mantener sincronizada.
--
-- ── LA LECCIÓN DEL TRUNCATE, OTRA VEZ (§3 de 20260813050000)
--
-- `pg_default_acl` de este proyecto le da a `anon` y `authenticated` los
-- privilegios `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) sobre **cada
-- relación nueva** del esquema `public`, y una vista ES una relación: aparece
-- en `information_schema.role_table_grants` igual que una tabla. Sin el
-- `revoke` de §5, el caso "Privilegios de anon sobre tablas de public" de
-- `scripts/test-rls.sql` (que exige 0) se pondría en rojo apenas se aplique
-- esta migración. El revoke está, y el arnés lo vigila.
-- =============================================================================


-- =============================================================================
-- 1. VISTA v_medicacion_estado
-- -----------------------------------------------------------------------------
-- Una fila por medicación ACTIVA (`is_active`), con el cálculo de stock ya
-- hecho. La medicación suspendida no aparece: el listado histórico de 7.2 lee
-- `medications` directamente, porque para una medicación suspendida "cuántos
-- días de stock quedan" no es una pregunta con respuesta.
--
-- ── LA FÓRMULA, EN TRES PASOS
--
--     tomas_por_dia      = daily          -> cardinality(schedule_times)
--                          interval_hours -> 24 / interval_hours
--                          as_needed      -> NULL
--
--     dosis_diaria_total = tomas_por_dia * dose_amount
--
--     dias_restantes     = floor(stock_units / dosis_diaria_total)
--
-- Ejemplo del ROADMAP: Metformina 850 mg, 2 tomas/día (8:00 y 20:00),
-- `dose_amount = 1`, `stock_units = 60` → 2 comprimidos/día → **30 días**.
--
-- ── POR QUÉ `floor` Y NO LA DIVISIÓN EXACTA
--
-- "Quedan 4,5 días" no es una frase que sirva para nada: lo accionable es
-- cuántos días COMPLETOS de tratamiento cubre el stock, y ese número es 4. El
-- redondeo hacia abajo también es el conservador, que es el que corresponde
-- cuando el error caro es quedarse sin remedio un domingo. `dias_restantes = 0`
-- significa "no alcanza para el día de hoy", no "no queda nada".
--
-- ── POR QUÉ `as_needed` NO TIENE DÍAS RESTANTES
--
-- Una medicación a demanda no tiene consumo diario: el ibuprofeno que se toma
-- "si duele" puede durar un mes o tres días. Inventar un denominador para que
-- la columna no quede vacía produciría una fecha de renovación falsa y una
-- alerta que grita sin motivo, que es la forma más rápida de que alguien apague
-- las notificaciones. `dosis_diaria_total`, `dias_restantes` y
-- `fecha_estimada_fin` son NULL, y `stock_units` queda como dato informativo:
-- la app muestra "quedan 20 comprimidos" sin proyectar nada.
--
-- ── `necesita_renovacion` VIVE ACÁ Y NO EN LA APP
--
-- El umbral de 5 días del ROADMAP (tarea 7.4) se expresa una sola vez, en esta
-- vista. El job de alertas, el banner y cualquier consulta futura leen la misma
-- columna en lugar de reimplementar `< 5` cada uno por su lado.
-- =============================================================================

create view public.v_medicacion_estado
with (security_invoker = true)
as
select
    m.id                       as medication_id,
    m.profile_id,
    m.name,
    m.active_ingredient,
    m.presentation,
    m.dose_amount,
    m.dose_unit,
    m.frequency,
    m.schedule_times,
    m.interval_hours,
    m.start_date,
    m.end_date,
    m.stock_units,
    m.prescription_document_id,
    m.notes,
    m.created_at,
    m.updated_at,
    t.tomas_por_dia,
    d.dosis_diaria_total,
    r.dias_restantes,
    case when r.dias_restantes is null then null
         else h.hoy + r.dias_restantes
    end                        as fecha_estimada_fin,
    (r.dias_restantes is not null and r.dias_restantes < 5)
                               as necesita_renovacion,
    (m.start_date <= h.hoy and (m.end_date is null or m.end_date >= h.hoy))
                               as vigente_hoy
  from public.medications m

  -- "Hoy" es el día de PARED en Ushuaia, no el día UTC. Sin esto, entre las
  -- 21:00 y la medianoche local la fecha estimada de fin se correría un día.
  cross join lateral (
      select (now() at time zone 'America/Argentina/Ushuaia')::date as hoy
  ) h

  cross join lateral (
      select case m.frequency
                 when 'daily'          then cardinality(m.schedule_times)::numeric
                 when 'interval_hours' then 24::numeric / m.interval_hours
                 else null::numeric
             end as tomas_por_dia
  ) t

  cross join lateral (
      select t.tomas_por_dia * m.dose_amount as dosis_diaria_total
  ) d

  cross join lateral (
      select case
                 -- Stock no cargado: se sabe cuánto se toma por día, pero no de
                 -- cuánto se dispone. Proyectar 0 días sería mentir.
                 when m.stock_units is null        then null::integer
                 when d.dosis_diaria_total is null then null::integer
                 -- Defensivo: hoy los CHECK impiden dose_amount <= 0 y
                 -- schedule_times vacío, pero una división por cero acá
                 -- rompería la pantalla entera de medicación.
                 when d.dosis_diaria_total <= 0    then null::integer
                 else floor(m.stock_units / d.dosis_diaria_total)::integer
             end as dias_restantes
  ) r

 where m.is_active;


comment on view public.v_medicacion_estado is
    'Estado calculado de cada medicación ACTIVA: tomas por día, consumo diario y días de stock restantes. Fórmula: dias_restantes = floor(stock_units / (dose_amount * tomas_por_dia)), con tomas_por_dia = cardinality(schedule_times) para daily, 24/interval_hours para interval_hours y NULL para as_needed. security_invoker = true: hereda las políticas RLS de medications en lugar de duplicar la matriz de permisos. Es la fuente única de la fórmula para las tareas 7.2 a 7.5 — ver docs/modelo-medicacion.md.';

comment on column public.v_medicacion_estado.medication_id is
    'medications.id. Se renombra para que un JOIN con medication_intakes no tenga dos columnas "id".';
comment on column public.v_medicacion_estado.tomas_por_dia is
    'Cuántas veces por día se toma. daily: cantidad de horarios. interval_hours: 24/interval_hours (numérico: "cada 5 horas" son 4,8 tomas diarias en promedio). as_needed: NULL.';
comment on column public.v_medicacion_estado.dosis_diaria_total is
    'Unidades consumidas por día = tomas_por_dia * dose_amount, en la misma unidad que dose_unit. NULL para as_needed.';
comment on column public.v_medicacion_estado.dias_restantes is
    'Días COMPLETOS de tratamiento que cubre el stock: floor(stock_units / dosis_diaria_total). NULL si la medicación es as_needed o si no se cargó stock. 0 significa "no alcanza ni para hoy".';
comment on column public.v_medicacion_estado.fecha_estimada_fin is
    'Fecha (hora de pared de Ushuaia) en la que se agota el stock al ritmo actual = hoy + dias_restantes. Proyecta desde HOY: no contempla que el tratamiento tenga end_date anterior ni que todavía no haya empezado.';
comment on column public.v_medicacion_estado.necesita_renovacion is
    'TRUE cuando quedan menos de 5 días de stock — el umbral del ROADMAP para la alerta preventiva de la tarea 7.4. El umbral se define UNA vez, acá: el job de alertas y el banner leen esta columna en lugar de reimplementarlo.';
comment on column public.v_medicacion_estado.vigente_hoy is
    'TRUE si hoy cae dentro de [start_date, end_date]. Una medicación activa puede no estar vigente todavía (empieza el mes que viene) o haber terminado su curso sin que nadie la suspendiera.';


-- =============================================================================
-- 2. registrar_toma(intake_id)
-- -----------------------------------------------------------------------------
-- LA NOTA ⑨, RESUELTA. `docs/modelo-permisos.md` §7.3 ya había anticipado esta
-- función palabra por palabra:
--
--   "⑨ descuento de stock al registrar la toma | Requiere escribir en dos
--    tablas con permisos distintos, atómicamente | Función SECURITY DEFINER
--    registrar_toma(...) que valida puede_cargar_en_perfil y hace ambas
--    escrituras"
--
-- El problema concreto: marcar una toma es un UPDATE sobre `medication_intakes`
-- que `can_upload` SÍ puede hacer (nota ⑩), pero descontar el stock es un
-- UPDATE sobre `medications`, tabla donde `can_upload` no escribe (política
-- `medications_update_administrador`). Aflojar esa política le daría a una
-- cuidadora la capacidad de editar dosis y suspender tratamientos, que es
-- exactamente lo que la matriz reserva para `can_manage`. La salida es una
-- función `SECURITY DEFINER` de superficie mínima: **un** parámetro, cuatro
-- guardas explícitas, dos escrituras en la misma transacción.
--
-- ── LAS CUATRO GUARDAS
--
--   1. La toma existe (y se bloquea con FOR UPDATE).
--   2. `puede_cargar_en_perfil(profile_id)` — el mismo predicado que la
--      política de INSERT de la tabla. No se inventa un permiso nuevo.
--   3. `status = 'pending'`. Es lo que hace imposible el doble descuento: la
--      segunda llamada encuentra 'taken' y aborta.
--   4. `scheduled_at` dentro de ±12 horas de ahora.
--
-- ── POR QUÉ ±12 HORAS
--
-- Doce horas es exactamente medio día, y eso le da a la ventana una propiedad
-- útil: en el esquema más común del producto (2 tomas por día, 8:00 y 20:00)
-- nunca hay más de una toma registrable hacia atrás y una hacia adelante, así
-- que "marcar la toma" no puede marcar por error la de otro momento del día.
-- Hacia atrás cubre el caso real de la persona que toma el remedio a la mañana
-- y confirma a la noche; hacia adelante cubre a quien se adelanta unas horas
-- porque sale de viaje.
--
-- Lo que queda afuera es deliberado: una toma de hace tres días no se
-- "registra", se CORRIGE, y corregir el pasado es administración
-- (`can_manage`, con el UPDATE normal de la tabla). Sin la guarda, cualquiera
-- con `can_upload` podría vaciar el stock marcando tomas viejas de golpe y la
-- alerta de renovación se dispararía sola.
--
-- ── EL STOCK ES UNA GUÍA, NO UN PORTERO
--
-- Stock en 0 **no** bloquea el registro. La abuela puede tener una caja extra
-- en el cajón que nadie cargó en la app, y una app que le conteste "no podés
-- haber tomado ese remedio" cuando ya se lo tomó es una app que miente sobre un
-- hecho para defender su propia contabilidad. Se registra la toma, el stock
-- queda en 0 (`GREATEST(0, ...)`) y la alerta de renovación seguirá encendida
-- hasta que alguien cargue la caja nueva. Ver docs/modelo-medicacion.md §5.
--
-- ── `dose_units` GUARDA LO DESCONTADO, NO LA DOSIS
--
-- Lo dice el COMMENT de la columna desde el esquema inicial: "unidades
-- efectivamente descontadas del stock (...) para que revertir una toma
-- restituya exactamente lo descontado". De ahí salen los dos casos borde:
--
--   · Sin stock cargado (`stock_units IS NULL`) no se descuenta nada
--     → `dose_units = NULL`.
--   · Con stock insuficiente se descuenta lo que había (1 unidad para una
--     dosis de 2) → `dose_units = 1`, y revertir devuelve 1, no 2.
--   · Con stock 0 el descuento es 0 → `dose_units = NULL` (el CHECK
--     `dose_units > 0` prohíbe guardar un 0, y con razón: "descontó cero" y
--     "no descontó" son lo mismo).
--
-- La dosis clínica nunca se pierde: está en `medications.dose_amount`.
-- =============================================================================

create or replace function public.registrar_toma(intake_id uuid)
returns public.medication_intakes
language plpgsql
security definer
set search_path = ''
as $$
declare
    toma       public.medication_intakes%rowtype;
    med        public.medications%rowtype;
    descontado numeric;
begin
    -- Guarda 1. FOR UPDATE serializa dos registros simultáneos de la MISMA
    -- toma: el segundo espera al primero y después encuentra 'taken', que la
    -- guarda 3 rechaza. Sin el bloqueo, dos toques del botón en el mismo
    -- instante descontarían el stock dos veces.
    select * into toma
      from public.medication_intakes mi
     where mi.id = intake_id
       for update;

    if not found then
        raise exception 'La toma indicada no existe.'
            using errcode = 'invalid_parameter_value';
    end if;

    -- Guarda 2 — el mismo predicado que la política de INSERT de la tabla.
    if not public.puede_cargar_en_perfil(toma.profile_id) then
        raise exception
            'No tenés permiso para registrar tomas de medicación en este perfil.'
            using errcode = 'insufficient_privilege';
    end if;

    -- Guarda 3 — la antiduplicación del descuento de stock.
    if toma.status <> 'pending'::public.medication_intake_status then
        raise exception
            'Esta toma ya no está pendiente (estado actual: %). Registrarla dos veces descontaría el stock dos veces.',
            toma.status
            using errcode = 'invalid_parameter_value';
    end if;

    -- Guarda 4 — la ventana de ±12 horas.
    if toma.scheduled_at < now() - interval '12 hours'
       or toma.scheduled_at > now() + interval '12 hours'
    then
        raise exception
            'La toma programada para % está fuera de la ventana de registro de ±12 horas. Corregir una toma de otro día es una edición y la hace quien administra el perfil.',
            toma.scheduled_at
            using errcode = 'invalid_parameter_value';
    end if;

    -- El descuento es un read-modify-write sobre `medications`: se bloquea la
    -- fila para que dos tomas de la misma medicación no se pisen el stock.
    -- El orden de bloqueo (intake y después medication) es el mismo en
    -- revertir_toma(), que es lo que evita un deadlock entre las dos.
    select * into med
      from public.medications m
     where m.id = toma.medication_id
       for update;

    -- Lo efectivamente descontable. `greatest(0, ...)` es el clamp que respeta
    -- el CHECK `medications_stock_no_negativo`; la resta contra el valor previo
    -- deja en `descontado` lo que el clamp dejó pasar de verdad, y `nullif`
    -- convierte "no descontó nada" en NULL (el CHECK de dose_units exige > 0).
    if med.stock_units is null then
        descontado := null;
    else
        descontado := nullif(
            med.stock_units - greatest(0, med.stock_units - med.dose_amount),
            0);
    end if;

    if descontado is not null then
        update public.medications
           set stock_units = stock_units - descontado
         where id = med.id;
    end if;

    update public.medication_intakes
       set status     = 'taken'::public.medication_intake_status,
           taken_at   = now(),
           dose_units = descontado
     where id = intake_id
    returning * into toma;

    return toma;
end;
$$;

comment on function public.registrar_toma(uuid) is
    'Nota ⑨ de docs/modelo-permisos.md: marca una toma pendiente como tomada Y descuenta el stock de la medicación en la MISMA transacción, sin ampliarle a can_upload el UPDATE sobre medications. Cuatro guardas: la toma existe, puede_cargar_en_perfil sobre su perfil, status = pending (antiduplicación) y scheduled_at dentro de ±12hs. Stock 0 no bloquea el registro: el stock es una guía, no un portero.';


-- =============================================================================
-- 3. revertir_toma(intake_id)
-- -----------------------------------------------------------------------------
-- El "me equivoqué" del ROADMAP: "permitir corregir una toma marcada por error
-- dentro del día".
--
-- ── POR QUÉ TAMBIÉN TIENE QUE SER UN RPC
--
-- Por partida doble. Primero, restituir el stock es otra vez un UPDATE sobre
-- `medications`. Y segundo, la transición es `taken → pending`, que la política
-- `medication_intakes_update_registrar_toma` **no** permite: esa política
-- habilita `pending → taken|skipped` y nada más. Es correcto que sea así —
-- deshacer no es la misma operación que hacer, y darle a `can_upload` un
-- camino genérico de vuelta abriría la puerta a reescribir el historial de
-- tomas de la semana.
--
-- ── POR QUÉ SOLO EL MISMO DÍA
--
-- Un botón de deshacer sirve para el error inmediato ("le di al botón que no
-- era"). Pasada la medianoche, cambiar si una persona tomó o no su medicación
-- ayer ya no es deshacer: es reescribir el registro clínico, y eso lo hace
-- quien administra el perfil por la vía normal. El día se mide en hora de pared
-- de **Ushuaia**, no en UTC: si se comparara en UTC, todo lo registrado después
-- de las 21:00 locales dejaría de ser reversible al instante, porque en UTC ya
-- sería el día siguiente.
--
-- ── LA RESTITUCIÓN ES EXACTA
--
-- Se devuelve `dose_units` —lo que la toma descontó de verdad—, no
-- `dose_amount`. Si la dosis cambió entre el registro y la corrección, o si el
-- descuento se había topado con el fondo del stock, el stock vuelve igual que
-- antes de la toma y no a un número inventado.
--
-- ── LO QUE NO CUBRE
--
-- Una toma marcada `skipped` por error: no descontó stock, y volverla a
-- `pending` es un UPDATE normal que la matriz le da a `can_manage`. Si el uso
-- real muestra que también hace falta deshacerla desde `can_upload`, se agrega
-- acá con la misma guarda de día — no se afloja la política.
-- =============================================================================

create or replace function public.revertir_toma(intake_id uuid)
returns public.medication_intakes
language plpgsql
security definer
set search_path = ''
as $$
declare
    toma public.medication_intakes%rowtype;
begin
    select * into toma
      from public.medication_intakes mi
     where mi.id = intake_id
       for update;

    if not found then
        raise exception 'La toma indicada no existe.'
            using errcode = 'invalid_parameter_value';
    end if;

    if not public.puede_cargar_en_perfil(toma.profile_id) then
        raise exception
            'No tenés permiso para corregir tomas de medicación en este perfil.'
            using errcode = 'insufficient_privilege';
    end if;

    if toma.status <> 'taken'::public.medication_intake_status then
        raise exception
            'Solo se puede deshacer una toma registrada como tomada (estado actual: %).',
            toma.status
            using errcode = 'invalid_parameter_value';
    end if;

    -- El mismo día CALENDARIO en Ushuaia, no "hace menos de 24 horas".
    if (toma.taken_at at time zone 'America/Argentina/Ushuaia')::date
       <> (now()          at time zone 'America/Argentina/Ushuaia')::date
    then
        raise exception
            'Una toma solo se puede deshacer el mismo día en que se registró (se registró el %). Corregir el historial de otro día lo hace quien administra el perfil.',
            (toma.taken_at at time zone 'America/Argentina/Ushuaia')::date
            using errcode = 'invalid_parameter_value';
    end if;

    -- Restitución exacta: vuelve lo que se descontó, no la dosis actual.
    if toma.dose_units is not null then
        update public.medications
           set stock_units = stock_units + toma.dose_units
         where id = toma.medication_id
           and stock_units is not null;
    end if;

    update public.medication_intakes
       set status     = 'pending'::public.medication_intake_status,
           taken_at   = null,
           dose_units = null
     where id = intake_id
    returning * into toma;

    return toma;
end;
$$;

comment on function public.revertir_toma(uuid) is
    'Deshace una toma registrada por error: la vuelve a pending, borra taken_at y restituye al stock exactamente lo que dose_units había descontado. Solo el mismo día calendario de America/Argentina/Ushuaia. Es un RPC y no un UPDATE porque la transición taken -> pending no la habilita ninguna política de medication_intakes, y porque la restitución escribe en medications.';


-- =============================================================================
-- 4. generar_tomas_del_dia(fecha)
-- -----------------------------------------------------------------------------
-- Materializa las tomas de un día. Sin esta función `medication_intakes` está
-- vacía y no hay nada que marcar: la pantalla de 7.3 muestra "las tomas de hoy"
-- y el job de 7.4 vigila el stock que esas tomas consumen.
--
-- ── LA IDEMPOTENCIA NO ES UN `if`, ES EL UNIQUE
--
-- Mismo criterio que los recordatorios de turnos: `ON CONFLICT DO NOTHING`
-- sobre `medication_intakes_toma_unica (medication_id, scheduled_at)`. Correrla
-- diez veces seguidas, o dos veces en paralelo, o a mano después del cron, no
-- puede duplicar una toma — no porque la función chequee antes, sino porque la
-- base no lo permite. Devuelve cuántas filas creó de verdad.
--
-- ── LOS TRES ESQUEMAS
--
-- `daily`: una toma por cada horario de `schedule_times`, en hora de PARED de
-- Ushuaia. `(fecha + hora) AT TIME ZONE 'America/Argentina/Ushuaia'` convierte
-- el "8 de la mañana" local al instante UTC que se guarda en `scheduled_at`;
-- guardar 8:00 sin zona haría que la toma de la mañana apareciera a las 5 de la
-- madrugada.
--
-- `interval_hours`: la grilla del día arranca en una HORA ANCLA y avanza de
-- `interval_hours` en `interval_hours`, dando vuelta al reloj (módulo 24hs) de
-- modo que todas las tomas caen dentro del mismo día calendario. El ancla es la
-- hora de pared de la toma más vieja que la medicación ya tenga y, si no tiene
-- ninguna, las 8:00 —la hora en que la gente arranca un tratamiento nuevo—.
-- Esa elección se sostiene sola: como la grilla es módulo 24, cualquiera de sus
-- puntos genera el mismo conjunto, así que a partir del segundo día el ancla ya
-- no puede moverse aunque la toma más vieja cambie de lugar.
--
-- `as_needed`: no genera nada. Una medicación a demanda no tiene horario; su
-- toma se crea cuando la persona dice que la tomó (tarea 7.3).
--
-- ── LA APROXIMACIÓN DE LOS INTERVALOS QUE NO DIVIDEN A 24
--
-- Con `interval_hours = 5` la grilla del día da `24 / 5 = 4` tomas (8:00,
-- 13:00, 18:00, 23:00) y el último hueco hasta la primera del día siguiente es
-- de 9 horas, no de 5. Es a propósito: un "cada 5 horas" estricto corre el
-- horario todos los días y termina despertando a la persona a las 3 de la
-- mañana. La vista, en cambio, usa el ritmo continuo (24/5 = 4,8 tomas diarias)
-- para proyectar el stock, que es el promedio honesto. Los intervalos reales
-- del producto —6, 8, 12, 24— dividen a 24 y no tienen esta diferencia.
--
-- ── QUIÉN LA LLAMA
--
-- El job de `pg_cron` de §6, todos los días. Y `service_role` a demanda: 7.2
-- debería llamarla al dar de alta una medicación para que las tomas de HOY
-- existan sin esperar a la medianoche. No se le da a `authenticated`: recorre
-- todos los perfiles de la base, y esa no es una operación de sesión de
-- usuario.
-- =============================================================================

create or replace function public.generar_tomas_del_dia(
    fecha date default (now() at time zone 'America/Argentina/Ushuaia')::date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    creadas integer := 0;
    n       integer;
begin
    -- --- daily: un horario fijo por toma -----------------------------------
    insert into public.medication_intakes
        (medication_id, profile_id, scheduled_at, status)
    select m.id,
           m.profile_id,
           (fecha + h.hora) at time zone 'America/Argentina/Ushuaia',
           'pending'::public.medication_intake_status
      from public.medications m
      cross join lateral unnest(m.schedule_times) as h(hora)
     where m.is_active
       and m.frequency = 'daily'::public.medication_frequency
       and m.start_date <= fecha
       and (m.end_date is null or m.end_date >= fecha)
    on conflict on constraint medication_intakes_toma_unica do nothing;

    get diagnostics n = row_count;
    creadas := creadas + n;

    -- --- interval_hours: grilla módulo 24hs desde la hora ancla ------------
    insert into public.medication_intakes
        (medication_id, profile_id, scheduled_at, status)
    select m.id,
           m.profile_id,
           (fecha::timestamp
            + make_interval(secs => (a.ancla_seg + g.k * m.interval_hours * 3600) % 86400))
               at time zone 'America/Argentina/Ushuaia',
           'pending'::public.medication_intake_status
      from public.medications m

      -- Hora ancla en segundos desde la medianoche local. La toma más vieja de
      -- la medicación fija el horario; sin tomas previas, las 8:00.
      cross join lateral (
          select coalesce(
                     (select extract(epoch from
                                 (min(mi.scheduled_at)
                                     at time zone 'America/Argentina/Ushuaia')::time
                             )::integer
                        from public.medication_intakes mi
                       where mi.medication_id = m.id),
                     8 * 3600
                 ) as ancla_seg
      ) a

      -- 24 / interval_hours es división ENTERA: cuántas tomas completas entran
      -- en el día. Con interval_hours = 24 da 1 (una sola toma diaria).
      cross join lateral generate_series(0, (24 / m.interval_hours) - 1) as g(k)

     where m.is_active
       and m.frequency = 'interval_hours'::public.medication_frequency
       and m.start_date <= fecha
       and (m.end_date is null or m.end_date >= fecha)
    on conflict on constraint medication_intakes_toma_unica do nothing;

    get diagnostics n = row_count;
    creadas := creadas + n;

    -- as_needed no genera nada: no tiene horario que materializar.

    return creadas;
end;
$$;

comment on function public.generar_tomas_del_dia(date) is
    'Materializa en medication_intakes las tomas programadas de un día para todas las medicaciones activas y vigentes: daily usa schedule_times, interval_hours arma una grilla módulo 24hs desde la hora de su toma más vieja (8:00 si no tiene ninguna) y as_needed no genera nada. Idempotente por ON CONFLICT DO NOTHING sobre el UNIQUE (medication_id, scheduled_at); devuelve cuántas filas creó. La llama el job diario de pg_cron y, a demanda, service_role. Por defecto trabaja sobre el día de pared de America/Argentina/Ushuaia.';


-- =============================================================================
-- 5. PRIVILEGIOS
-- -----------------------------------------------------------------------------
-- Nada de esta migración crea una tabla nueva, así que no hay RLS que habilitar
-- ni políticas que escribir: la vista hereda las de `medications` gracias a
-- `security_invoker`, y los tres RPC son `SECURITY DEFINER` que hacen su propia
-- validación con los mismos predicados de la matriz.
--
-- Lo que SÍ hay que hacer es desarmar los defaults de Supabase, que son
-- permisivos por diseño (ver el encabezado):
--
--   · La VISTA nace con `Dxtm` para `anon` y `authenticated`. Se revoca todo y
--     se otorga solo `SELECT` a quien corresponde. El caso "Privilegios de anon
--     sobre tablas de public" del arnés cuenta también las vistas y exige 0.
--   · Las FUNCIONES se revocan de `PUBLIC` (de donde `anon` heredaría) y se
--     otorgan una por una. `generar_tomas_del_dia` NO va para `authenticated`:
--     barre la base entera.
-- =============================================================================

revoke all on public.v_medicacion_estado from anon, authenticated;
grant  select on public.v_medicacion_estado to authenticated, service_role;

revoke execute on function public.registrar_toma(uuid)          from public;
revoke execute on function public.revertir_toma(uuid)           from public;
revoke execute on function public.generar_tomas_del_dia(date)   from public;

grant  execute on function public.registrar_toma(uuid)          to authenticated, service_role;
grant  execute on function public.revertir_toma(uuid)           to authenticated, service_role;
grant  execute on function public.generar_tomas_del_dia(date)   to service_role;


-- =============================================================================
-- 6. EL JOB DIARIO
-- -----------------------------------------------------------------------------
-- `pg_cron` ya está habilitado desde `20260813050000_recordatorios_turnos.sql`;
-- acá solo se suma un job.
--
-- ── LA HORA: 03:05 UTC = 00:05 EN USHUAIA
--
-- Las expresiones de `pg_cron` se interpretan en UTC (su `cron.timezone` es un
-- parámetro de servidor que no se puede tocar desde una migración, ni en
-- Supabase hosted). Argentina está en UTC−3 de forma continua desde 2009 y no
-- aplica horario de verano, así que `5 3 * * *` es 00:05 de Ushuaia.
--
-- Y si algún día eso cambiara, el daño está acotado: la función no recibe la
-- fecha del cron sino que la calcula ella misma como el día de pared de
-- Ushuaia en el instante de la corrida. Un corrimiento de una hora seguiría
-- cayendo dentro del mismo día local.
--
-- ── POR QUÉ A LAS 00:05 Y NO A LAS 00:00
--
-- Cinco minutos de colchón para que la medianoche ya haya pasado en cualquier
-- reloj involucrado. A esa hora no hay nadie usando la app y la corrida es un
-- puñado de INSERT.
--
-- ── REAPLICABLE
--
-- `cron.schedule` con un nombre ya existente REEMPLAZA el job, así que esta
-- migración se puede volver a aplicar sin dejar jobs duplicados.
-- =============================================================================

select cron.schedule(
    'generar-tomas-del-dia',
    '5 3 * * *',
    $cron$select public.generar_tomas_del_dia()$cron$
);

-- Fin de la migración.
