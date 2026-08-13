-- =============================================================================
-- Historial Médico — Migración 20260813040000: alta idempotente de
-- suscripciones Web Push (Sprint 6, tarea 6.3)
-- -----------------------------------------------------------------------------
-- QUÉ **NO** HACE ESTA MIGRACIÓN. No crea `public.push_subscriptions`: la
-- tabla existe desde `20260812200000_schema_inicial.sql` §4.12 (endpoint
-- UNIQUE + CHECK https, p256dh, auth, user_agent, created_at, last_seen_at,
-- revoked_at) con `profile_id` ya pasado a `ON DELETE SET NULL` en
-- `20260812210000_ajustes_modelo.sql` (deuda D8), y sus cuatro políticas RLS
-- ya están aplicadas en `20260812220000_rls.sql` §5.5. Tampoco toca esas
-- políticas ni los privilegios de tabla: siguen diciendo exactamente lo
-- mismo que antes de esta migración.
--
-- QUÉ AGREGA. Un único punto de entrada, `registrar_suscripcion_push()`, para
-- el alta/renovación de una suscripción desde el navegador. Resuelve dos
-- problemas que el `upsert` directo del cliente NO puede resolver:
--
-- ── 1. El endpoint es único GLOBALMENTE, y un teléfono puede tener dos cuentas
--
-- `pushManager.subscribe()` devuelve un endpoint que identifica al
-- NAVEGADOR + la clave VAPID de la aplicación, no a la persona logueada. En
-- un dispositivo compartido -el caso más común de este producto: la hija que
-- administra el perfil de la madre entra con su cuenta en el mismo teléfono
-- donde la madre ya había activado las notificaciones- el segundo
-- `subscribe()` devuelve EXACTAMENTE el mismo endpoint que ya está guardado a
-- nombre de la primera cuenta.
--
-- Con un `upsert` hecho por el cliente pasa esto: el INSERT choca contra
-- `push_subscriptions_endpoint_unico`, el `ON CONFLICT DO UPDATE` cae bajo
-- `push_subscriptions_update_propias` (`using user_id = auth.uid()`), la fila
-- ajena no matchea, y el `UPDATE` no encuentra nada que actualizar. El
-- resultado es una activación que falla para siempre y que la persona no
-- puede arreglar de ninguna forma desde la aplicación (tendría que borrar los
-- datos del sitio en Chrome). La función arregla eso reasignando la fila a
-- quien acaba de suscribirse.
--
-- POR QUÉ REASIGNAR ES SEGURO — y qué se está aceptando. El endpoint es una
-- capability URL emitida por el Push Service para ESE navegador: cualquiera
-- que la conozca ya puede mandarle pushes a ese dispositivo sin pasar por
-- nuestra base. Presentarlo, entonces, es prueba de posesión del navegador,
-- que es justamente lo que la reasignación quiere premiar. El peor caso de
-- abuso -alguien que de algún modo consigue el endpoint de otra persona y lo
-- registra a su nombre- es una DENEGACIÓN de notificaciones para la víctima:
-- los envíos siguientes se cifran (aes128gcm, RFC 8291) con las claves
-- `p256dh`/`auth` del ATACANTE, así que el dispositivo de la víctima recibe
-- un mensaje que no puede descifrar y el service worker lo descarta. En
-- ningún escenario el atacante lee datos de la víctima: no obtiene acceso a
-- ninguna fila del historial, y las suscripciones ajenas siguen sin ser
-- listables (la política de SELECT no cambió).
--
-- ── 2. `profile_id` no lo valida ninguna política
--
-- `push_subscriptions_insert_propias` solo exige `user_id = auth.uid()`: un
-- cliente podría mandar el uuid de CUALQUIER perfil como `profile_id`. Hoy no
-- filtra nada (la fila sigue siendo visible solo para su dueño), pero
-- ensuciaría el dato con el que los envíos del Sprint 6.4 y de los Sprints 7
-- y 9 deciden a quién le hablan. La función descarta el `profile_id` que el
-- llamador no pueda ver -`puede_ver_perfil()`, la misma función SECURITY
-- DEFINER que usan las políticas- y guarda NULL en su lugar: el envío igual
-- resuelve destinatarios por `user_id` + `family_permissions`, así que perder
-- el perfil degrada la precisión del contexto, nunca la entrega.
--
-- POR QUÉ UNA FUNCIÓN Y NO UNA POLÍTICA MÁS. La reasignación del punto 1 es,
-- por definición, un `UPDATE` sobre una fila de OTRO usuario. Expresarla como
-- política de `UPDATE` abriría esa puerta a cualquier `UPDATE` directo desde
-- PostgREST -incluido "marcá revocada la suscripción de otro", que sí sería
-- una denegación de servicio trivial y sin pruebas de posesión-. La función
-- tiene superficie mínima: recibe el endpoint COMPLETO (que es el secreto) y
-- no permite ninguna otra operación sobre filas ajenas.
--
-- Nada de esto habilita el BORRADO ni la REVOCACIÓN de suscripciones ajenas:
-- "desactivar notificaciones" sigue siendo un `UPDATE` normal del cliente
-- bajo `push_subscriptions_update_propias`, que solo alcanza a las filas
-- propias. Marcar `revoked_at` por un 404/410 del Push Service lo hace el
-- servidor con `service_role` (`lib/push/servidor.ts`).
--
-- UTF-8 sin BOM. `set search_path = ''` y todo objeto calificado con su
-- esquema, igual que el resto de las funciones del proyecto.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. registrar_suscripcion_push(...)
-- -----------------------------------------------------------------------------
-- Alta o renovación idempotente de la suscripción del navegador que llama.
-- Devuelve el `id` de la fila resultante.
--
-- Errores que SÍ lanza (los tres son "el cliente mandó algo que no puede ser
-- cierto", no estados normales del flujo):
--   · 28000 — no hay sesión.
--   · 22023 — endpoint vacío, o claves de cifrado vacías.
-- El CHECK `push_subscriptions_endpoint_es_https` de la tabla sigue siendo
-- quien rechaza un endpoint que no sea https://.
create or replace function public.registrar_suscripcion_push(
    p_endpoint   text,
    p_p256dh     text,
    p_auth       text,
    p_profile_id uuid default null,
    p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id    uuid := (select auth.uid());
    v_profile_id uuid := null;
    v_id         uuid;
begin
    if v_user_id is null then
        raise exception 'Se requiere una sesión para registrar una suscripción push'
            using errcode = '28000';
    end if;

    if coalesce(btrim(p_endpoint), '') = '' then
        raise exception 'El endpoint de la suscripción push no puede estar vacío'
            using errcode = '22023';
    end if;

    if coalesce(btrim(p_p256dh), '') = '' or coalesce(btrim(p_auth), '') = '' then
        raise exception 'Faltan las claves de cifrado (p256dh / auth) de la suscripción push'
            using errcode = '22023';
    end if;

    -- Contexto opcional: si el llamador no puede ver ese perfil, se guarda
    -- NULL en vez de fallar. Ver punto 2 del encabezado.
    if p_profile_id is not null and public.puede_ver_perfil(p_profile_id) then
        v_profile_id := p_profile_id;
    end if;

    insert into public.push_subscriptions as s
        (user_id, profile_id, endpoint, p256dh, auth, user_agent)
    values
        (v_user_id, v_profile_id, btrim(p_endpoint), btrim(p_p256dh), btrim(p_auth),
         left(nullif(btrim(coalesce(p_user_agent, '')), ''), 512))
    on conflict on constraint push_subscriptions_endpoint_unico do update
        set user_id      = v_user_id,
            profile_id   = v_profile_id,
            p256dh       = excluded.p256dh,
            auth         = excluded.auth,
            user_agent   = coalesce(excluded.user_agent, s.user_agent),
            last_seen_at = now(),
            -- Volver a suscribirse REACTIVA la fila: si estaba marcada por un
            -- 410 previo o porque la persona había desactivado, el navegador
            -- acaba de decir lo contrario y él es la fuente de verdad.
            revoked_at   = null
    returning s.id into v_id;

    return v_id;
end;
$$;

comment on function public.registrar_suscripcion_push(text, text, text, uuid, text) is
    'Alta idempotente de una suscripción Web Push. Único punto de entrada del alta desde el navegador: reasigna al llamador la fila de un endpoint ya registrado por otra cuenta del mismo dispositivo (el endpoint es prueba de posesión del navegador) y descarta un profile_id que el llamador no pueda ver. No permite ninguna otra operación sobre filas ajenas.';

revoke execute on function
    public.registrar_suscripcion_push(text, text, text, uuid, text) from public;
grant execute on function
    public.registrar_suscripcion_push(text, text, text, uuid, text)
    to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. Índice para el barrido de envío (Sprint 6.4 en adelante)
-- -----------------------------------------------------------------------------
-- `push_subscriptions_user_activas_idx` (esquema inicial) ya cubre "las
-- suscripciones activas de ESTA persona", que es la consulta del envío. No
-- hace falta ningún índice nuevo; se deja anotado para que la próxima tarea
-- no lo agregue por las dudas.

-- Fin de la migración.
