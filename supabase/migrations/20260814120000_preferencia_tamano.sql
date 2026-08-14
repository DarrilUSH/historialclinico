-- =============================================================================
-- Historial Médico — Migración 20260814120000: preferencia de tamaño de letra
-- de la CUENTA QUE MIRA (Sprint 13, tarea 13.1)
-- -----------------------------------------------------------------------------
-- Una sola columna, `profiles.display_density`, y sin embargo es la migración
-- con el modelo de escritura más raro del proyecto. Vale la pena explicar por
-- qué antes de leer el DDL.
--
-- ── QUÉ ES ESTE DATO (y qué NO es)
--
-- Todas las demás columnas de `profiles` describen al PACIENTE: su nombre, su
-- grupo sanguíneo, sus alergias, su fecha de nacimiento. Son datos DE la
-- persona del perfil, y por eso las edita quien administra ese perfil
-- (`profiles_update_administrador`, docs/modelo-permisos.md nota ②).
--
-- `display_density` no describe al paciente. Describe a QUIEN MIRA LA PANTALLA:
-- es "esta cuenta ve mejor con letra grande" o "esta cuenta prefiere la app
-- compacta". Vive en `profiles` por una razón puramente física —es la tabla que
-- tiene `user_id`, o sea la única forma que hay en el esquema de decir "esta
-- fila es de esta cuenta"— y no porque sea información clínica.
--
-- La consecuencia práctica está en el escenario del ROADMAP: María (49, ve
-- bien) administra el perfil gestionado de Roberto (80). Cuando María mira los
-- datos de Roberto, la app tiene que verse CHICA, porque la que mira es María.
-- La preferencia que manda es la de la fila de María —la del perfil ACTIVO no
-- interviene nunca—. Roberto, entrando con su propia cuenta si algún día la
-- tuviera, vería su propia preferencia. Nunca se enteran del modo del otro.
--
-- ── QUIÉN PUEDE ESCRIBIRLA: SOLO EL TITULAR, Y ESO NO SALE DE UNA POLÍTICA
--
-- La política vigente `profiles_update_administrador` autoriza el UPDATE de
-- `profiles` al titular **o a cualquier `can_manage`**. Para el resto de las
-- columnas eso es correcto y buscado (María corrige la ficha SOS de Roberto).
-- Para esta columna es incorrecto: María no tiene por qué poder decidir con
-- qué tamaño de letra ve la app la cuenta de Diego, ni Diego la de María. Es
-- una preferencia de espectador, no un dato del paciente.
--
-- Se evaluaron las tres formas de restringirlo y las dos primeras NO SIRVEN:
--
--   1. **Privilegio de columna** (`revoke update (display_density) ... from
--      authenticated`). No sirve: los privilegios de columna miran la COLUMNA,
--      no la FILA. Revocarlo dejaría afuera también al titular, que es
--      justamente el único que tiene que poder escribirla. La distinción que
--      necesitamos es por fila ("¿esta fila es tuya?"), y ese eje no existe en
--      el sistema de privilegios. Es la diferencia exacta con
--      `vital_sign_alerts` (20260814080000 §3.3), donde el privilegio de
--      columna SÍ era la herramienta correcta porque ahí el recorte era por
--      columna para TODOS los roles por igual.
--
--   2. **Una política RLS aparte.** Tampoco sirve: RLS evalúa la fila, no las
--      columnas que el UPDATE toca. No hay forma de escribir "podés actualizar
--      esta fila salvo esta columna" en una `policy`, ni de comparar `new`
--      contra `old` desde un `with check`. Es la misma limitación que ya
--      obligó a resolver la inmutabilidad de `user_id` con un trigger
--      (20260812220000 §2.1, nota ②) en vez de con una política.
--
--   3. **Un trigger `BEFORE UPDATE`** que compare el valor nuevo contra el
--      viejo y exija que el actor sea el titular de la fila. Es la única de
--      las tres que puede expresar la regla, y es la que se implementa acá
--      (§3), calcada de `proteger_titularidad_de_perfil`.
--
-- El trigger RECHAZA con `insufficient_privilege` en vez de conservar el valor
-- viejo en silencio. Es deliberado y es la diferencia con
-- `sellar_visto_de_alerta_signo`, que sí conserva: allá el silencio existía
-- para que un `update` idempotente no tuviera que distinguir el caso ("marcar
-- vista una alerta ya vista" es una operación legítima que no debe fallar).
-- Acá no hay ninguna operación legítima que intente esto: ninguna pantalla de
-- la app manda `display_density` en el UPDATE de un perfil ajeno, así que un
-- intento es un bug o un abuso, y las dos cosas conviene que hagan ruido.
--
-- Nótese que un UPDATE de terceros que NO toque la columna sigue funcionando
-- exactamente igual que antes: el trigger solo mira `is distinct from`. La
-- edición de la ficha SOS de Roberto por parte de María no cambia.
--
-- ── LA LECTURA SÍ ES VISIBLE PARA LA FAMILIA (y se acepta)
--
-- `profiles_select_visible` devuelve la fila entera, así que un `can_view` de
-- María puede leer que María usa letra chica. No se restringe, y conviene
-- dejar escrito por qué: (a) no es un dato de salud ni un identificador —es
-- una preferencia de interfaz de dos valores posibles—; (b) esconder UNA
-- columna del `select *` exigiría una vista aparte o un `revoke select
-- (display_density)`, y esto último rompería `select *` en todo el proyecto,
-- que es como consultan `profiles` tanto `lib/perfil-activo.ts` como el
-- selector de perfiles. El costo de ocultarla es desproporcionado frente a lo
-- que revela. Queda anotado en docs/densidad.md §6.
--
-- ── PERFILES GESTIONADOS: LA COLUMNA EXISTE PERO ES INERTE
--
-- Un perfil gestionado (`user_id is null`) no tiene cuenta: nadie inicia
-- sesión como él, así que nunca "mira" la app y su preferencia no significa
-- nada. En vez de dejar el valor a la deriva, el CHECK
-- `profiles_densidad_solo_con_cuenta` lo clava en el default. Así la columna
-- no admite estados sin sentido ni siquiera desde `service_role` (donde el
-- trigger de §3 se abstiene a propósito, igual que todos los del proyecto).
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema y toda función con
-- `set search_path = ''`, igual que el resto del proyecto.
-- =============================================================================


-- =============================================================================
-- 1. EL ENUM DE DENSIDADES
-- -----------------------------------------------------------------------------
-- Dos valores, en español y no en inglés, por el mismo criterio que
-- `access_action` y `vital_sign_alert_rule` (20260814080000 §1): **son valores
-- que lee la interfaz**. El nombre de la columna es inglés porque el esquema
-- entero lo es (`full_name`, `birth_date`, `can_manage`); los valores del enum
-- son castellano porque el botón A/a y la pregunta del selector los muestran.
--
-- Enum de verdad y no `text` + CHECK, otra vez por el mismo motivo de la 9.2:
-- es un DOMINIO CERRADO del producto, y `npm run types:gen` lo baja a la unión
-- `"grande" | "chica"` de TypeScript. `lib/densidad/tamano.ts` deriva su tipo
-- `Tamano` de ahí, así que agregar un modo nuevo (si algún día apareciera un
-- "extra grande") es una migración y el compilador señala cada `switch` que
-- quedó incompleto. Un `text` + CHECK dejaría el tipo en `string` y esa red se
-- perdería.
-- =============================================================================

create type public.display_density as enum ('grande', 'chica');

comment on type public.display_density is
    'Modo de densidad visual de la interfaz elegido por una CUENTA: grande (el diseño Senior UX por defecto) o chica (compacto, Sprint 13). Los valores están en castellano porque los muestra la interfaz, igual que access_action.';


-- =============================================================================
-- 2. LA COLUMNA
-- -----------------------------------------------------------------------------
-- `not null default 'grande'`: el default del PRODUCTO es el modo grande y eso
-- no es una casualidad de implementación sino la decisión de accesibilidad del
-- proyecto —quien nunca eligió nada ve la app pensada para adultos mayores—.
-- Que sea `not null` evita el tercer estado ("null = no eligió") que en la
-- práctica se comportaría igual que 'grande' pero obligaría a un `?? 'grande'`
-- en cada lectura; con el default, el backfill de las filas existentes lo hace
-- el propio `ALTER TABLE` y todo el mundo arranca en grande sin escribir una
-- sola línea de migración de datos.
-- =============================================================================

alter table public.profiles
    add column display_density public.display_density not null default 'grande';

comment on column public.profiles.display_density is
    'Preferencia de tamaño de letra DE LA CUENTA COMO ESPECTADORA, no un dato del paciente: es "con qué densidad ve la app quien inicia sesión con esta cuenta", y NO tiene nada que ver con el perfil que esa persona esté mirando. Cuando María (chica) mira el perfil de Roberto (grande), manda la de María. Solo la escribe el titular de la fila — lo garantiza el trigger profiles_proteger_densidad, porque ni un privilegio de columna ni una política RLS pueden expresar "esta columna sí, para esta fila". En perfiles gestionados (user_id null) es inerte y queda clavada en grande por profiles_densidad_solo_con_cuenta.';

-- Un perfil sin cuenta no mira nada: su preferencia no puede tener otro valor
-- que el default. Ver "PERFILES GESTIONADOS" en el encabezado. El CHECK cubre
-- también a `service_role`, donde el trigger de §3 se abstiene.
alter table public.profiles
    add constraint profiles_densidad_solo_con_cuenta
        check (user_id is not null or display_density = 'grande');


-- =============================================================================
-- 3. EL TRIGGER: LA PREFERENCIA LA CAMBIA SU DUEÑO Y NADIE MÁS
-- -----------------------------------------------------------------------------
-- Calcado de `proteger_titularidad_de_perfil` (20260812220000 §2.1), incluido
-- el `es_sesion_de_usuario()` de la primera línea: el seed, las migraciones y
-- cualquier job con `service_role` quedan afuera de la regla, igual que en
-- todos los triggers de protección del proyecto. La regla protege de sesiones
-- de usuario, que son el único vector real.
--
-- `security invoker` (no `definer`) también por la misma razón que allá: la
-- función necesita ver el `auth.uid()` verdadero de quien está escribiendo. Un
-- `definer` haría que `current_user` fuera siempre `postgres` y la guarda
-- mentiría.
--
-- El predicado compara contra `old.user_id` y no contra `new.user_id`: si en
-- el mismo UPDATE alguien intentara cambiar la titularidad Y la densidad, el
-- valor viejo es el que dice de quién ERA la fila. (De todos modos ese UPDATE
-- ya muere en `profiles_proteger_titularidad`; el orden de disparo entre dos
-- triggers `BEFORE UPDATE` es alfabético por nombre y no conviene depender de
-- él para una regla de seguridad.)
-- =============================================================================

create or replace function public.proteger_densidad_de_perfil()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if not public.es_sesion_de_usuario() then
        return new;
    end if;

    if new.display_density is distinct from old.display_density
       and old.user_id is distinct from (select auth.uid()) then
        raise exception
            'El tamaño de letra es una preferencia de cada cuenta: solo puede cambiarlo quien inicia sesión con ella, ni siquiera quien administra su perfil.'
            using errcode = 'insufficient_privilege';
    end if;

    return new;
end;
$$;

comment on function public.proteger_densidad_de_perfil() is
    'Rechaza cualquier cambio de profiles.display_density hecho desde una sesión de usuario que no sea la titular de esa fila. Existe porque la política profiles_update_administrador autoriza a can_manage a editar el perfil entero, y la densidad es lo único de esa fila que NO es un dato del paciente sino una preferencia de quien mira. RLS no puede comparar new contra old y los privilegios de columna no miran filas: el trigger es la única herramienta que expresa la regla.';

create trigger profiles_proteger_densidad
    before update on public.profiles
    for each row execute function public.proteger_densidad_de_perfil();


-- =============================================================================
-- 4. RLS Y PRIVILEGIOS: NADA QUE AGREGAR, Y ESO ES UNA AFIRMACIÓN
-- -----------------------------------------------------------------------------
-- Esta migración NO crea ni modifica ninguna política, y no es un olvido:
--
--   · **SELECT** — `profiles_select_visible` ya alcanza. Quien puede ver la
--     fila puede ver la columna; ver "LA LECTURA SÍ ES VISIBLE" arriba.
--   · **UPDATE** — `profiles_update_administrador` ya alcanza, y estrecharla
--     sería un retroceso: sacarle el `can_manage` para proteger esta columna
--     rompería la edición de la ficha SOS de un perfil gestionado, que es el
--     caso de uso central del Sprint 8. La política sigue diciendo "quien
--     administra edita el perfil"; el trigger de §3 le pone la única excepción.
--   · **Privilegios de tabla** — `authenticated` ya tiene `UPDATE` sobre
--     `public.profiles` (20260812220000 §4). Una columna nueva de una tabla ya
--     concedida hereda el privilegio: no hace falta un GRANT, y tampoco un
--     REVOKE (ver §1 de la 20260814080000 sobre por qué los revokes existen —
--     acá no hay tabla nueva, así que el default privilege de Supabase no
--     entra en juego).
--
-- Los casos de este comportamiento están en `scripts/test-rls.sql` BLOQUE 4
-- (María cambia la suya: OK; Diego con can_manage cambia la de María:
-- rechazado 42501; Diego edita otra columna de María: sigue funcionando; nadie
-- puede darle densidad a un perfil gestionado).
-- =============================================================================


-- =============================================================================
-- 5. LO QUE ESTA MIGRACIÓN NO HACE
-- -----------------------------------------------------------------------------
--   · **No define los tokens.** Qué significa "chica" en píxeles vive en
--     `app/globals.css` bajo `html[data-tamano="chica"]` y está documentado en
--     `docs/densidad.md`. La base guarda la elección, no el diseño.
--   · **No decide por nadie.** No hay heurística por edad, por `role` ni por
--     user-agent: el modo lo elige la persona, siempre, y hasta que lo elija
--     ve el modo grande.
--   · **No toca el perfil activo.** `perfil_activo` sigue siendo una cookie de
--     contexto de interfaz (`lib/perfil-activo.ts`) y no tiene ninguna
--     relación con esta columna. Confundirlos es el error que este archivo
--     entero está escrito para evitar.
-- =============================================================================

-- Fin de la migración.
