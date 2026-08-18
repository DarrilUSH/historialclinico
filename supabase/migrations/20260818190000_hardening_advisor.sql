-- =============================================================================
-- Historial Médico — Migración 20260818190000: hardening del Security Advisor
-- -----------------------------------------------------------------------------
-- QUÉ ARREGLA ESTA MIGRACIÓN, EN UNA LÍNEA: en producción, CUALQUIER usuario
-- con sesión iniciada podía ejecutar las 50 funciones SECURITY DEFINER del
-- esquema `public` por `/rest/v1/rpc/<nombre>`, incluida
-- `leer_refresh_token_gmail(uuid)` —que devuelve el refresh token de Gmail de
-- CUALQUIER cuenta, no solo la propia—. En local no pasaba, y por eso el arnés
-- decía que todo estaba bien.
--
-- -----------------------------------------------------------------------------
-- LA CAUSA: los privilegios POR DEFECTO del esquema public difieren entre el
-- stack local y el proyecto de Supabase cloud.
--
-- Supabase cloud arrastra, de cuando el esquema `public` se auto-exponía a la
-- Data API, un `alter default privileges in schema public grant execute on
-- functions to anon, authenticated, service_role`. O sea: cada `create
-- function` en `public` nace con EXECUTE otorgado a `anon` y a
-- `authenticated`, como dos entradas EXPLÍCITAS del ACL.
--
-- El CLI local, en cambio, ya defaultea al comportamiento nuevo ("nada se
-- auto-expone"); está descripto en `supabase/config.toml`, en el comentario de
-- `auto_expose_new_tables` (el flag se elimina el 2026-10-30, cuando el
-- always-revoked sea definitivo). Con el flag sin setear, el default local es
-- `{postgres=X/postgres}` y las funciones nacen cerradas.
--
-- Nuestro patrón de siempre fue `revoke all on function X from public; grant
-- ... to service_role`. Y ahí está la trampa: **`revoke ... from public` NO
-- borra un grant explícito a `anon` ni a `authenticated`**. PUBLIC es el
-- pseudo-rol "todos"; `anon` y `authenticated` son roles de verdad, con su
-- propia entrada en el ACL. Revocar de PUBLIC deja las dos entradas intactas.
-- En local no se notaba porque el default de cloud nunca las creaba.
--
-- -----------------------------------------------------------------------------
-- CÓMO SE COMPROBÓ (no es una deducción, es un experimento).
--
-- Se puso `auto_expose_new_tables = true` en `supabase/config.toml` —el flag
-- que reproduce el régimen de cloud—, se corrió `supabase db reset` y sobre esa
-- base se corrieron las dos cosas:
--
--   1. El linter `splinter` (el que alimenta el Security Advisor), completo:
--      100 warnings de SECURITY —50 de `anon_security_definer_function_
--      executable` + 50 de `authenticated_security_definer_function_
--      executable`— y 2 INFO de `rls_enabled_no_policy`. Con el
--      `extension_in_public` de `public.pg_net`, que en cloud sí dispara y en
--      local no (ver §5), da los 104 warnings + 2 info + 0 errores que muestra
--      el Advisor de producción. Coincidencia exacta en los tres números.
--
--   2. El arnés `scripts/test-rls.sql`: **32 de sus 521 casos FALLAN** bajo el
--      régimen de cloud. No son casos nuevos: son los que ya existían y que en
--      local pasaban. Entre ellos, textuales:
--        - "Elena ejecuta leer_refresh_token_gmail sobre la cuenta de Rubén"
--          → esperado `denegada (42501)`, obtenido `ejecutada:
--          RUBEN-REFRESH-TOKEN`.
--        - "A ejecuta configurar_cron_recordatorios() (escribe secretos del
--          Vault)" → esperado `denegado (42501)`, obtenido `ejecutado`.
--        - "A ejecuta destinatarios_de_avisos() (fuga de user_id ajenos)"
--        - "A ejecuta reclamar_recordatorios_turnos() (podría mandar avisos
--          ajenos)"
--        - "Ana ejecuta configurar_auto_ingesta_gmail" y, dos casos después,
--          "Y la fila queda intacta: sigue apagada" → esperado `false`,
--          obtenido `true`: la escritura ajena se consumó.
--
--      El arnés estaba bien escrito. Lo que estaba mal era el entorno donde se
--      lo corría: probaba una base cuyos privilegios por defecto no son los de
--      producción. Esta migración hace que las dos bases coincidan, y por eso
--      los 32 casos vuelven a pasar en los dos regímenes.
--
-- -----------------------------------------------------------------------------
-- QUÉ HACE, ENTONCES.
--
--   §1. Normaliza los privilegios por defecto de `public` para que dejen de
--       otorgar a `anon` y `authenticated`. OJO con lo que este paso NO logra:
--       ver la advertencia grande dentro de §1.
--   §2. Cierra lo ya creado: revoca EXECUTE de PUBLIC, anon, authenticated y
--       service_role sobre TODAS las funciones de `public`. **Éste es el paso
--       que hace el trabajo**; §1 solo acompaña.
--   §3–§4. Repone la lista blanca, explícita y enumerada: 19 funciones para
--       `authenticated`, 39 para `service_role`. No son una lista inventada
--       acá: son EXACTAMENTE los grants que las 33 migraciones anteriores
--       escribieron a mano, leídos del `pg_proc.proacl` de una base local
--       reseteada en régimen limpio. El estado final de esta migración es, ni
--       más ni menos, el estado que el arnés viene validando desde el Sprint 1.
--   §5. No toca nada: documenta las dos cosas de pg_net que se evaluaron y se
--       decidió NO hacer (mover la extensión de esquema, y revocarle a `anon` y
--       `authenticated` el acceso al esquema `net`). La segunda no se decidió:
--       se intentó, se midió que es imposible desde una migración, y ahí está
--       escrito el porqué.
--
-- QUÉ NO HACE, A PROPÓSITO: no mueve `pg_net` de esquema, y no toca `net`.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ NO PUEDE ROMPER LOS CRONS. Los cuatro jobs de pg_cron
-- (`recordatorios-turnos`, `generar-tomas-del-dia`, `alertas-medicacion`,
-- `barrido-gmail`) corren con `cron.job.username = 'postgres'`, que es el
-- DUEÑO de las funciones. Esta migración no toca ni un privilegio de
-- `postgres` ni de `supabase_admin` ni de `supabase_auth_admin` (el trigger de
-- alta de cuenta): solo PUBLIC, `anon`, `authenticated` y `service_role`, y a
-- los dos últimos les repone su lista completa. Las tres
-- `configurar_cron_*` y las tres `disparar_*` ya eran sólo-del-dueño en el
-- diseño original —el arnés lo afirma en el caso "Ni siquiera service_role
-- configura el cron: eso es del owner"—, así que quedan como estaban en local.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- §1. La fuente: privilegios por defecto de `public`
-- -----------------------------------------------------------------------------
-- `alter default privileges` se aplica al rol que ejecuta la sentencia, y las
-- migraciones corren como `postgres`, que es el que crea todas las funciones.
-- Esto deja la fila de `pg_default_acl` de (postgres, public, funciones) en
-- `{postgres=X/postgres}`: sin los grants explícitos a `anon`, `authenticated`
-- y `service_role` que arrastra el proyecto de cloud. Es idempotente: en el
-- stack local, donde el default ya es ése, no cambia nada. El valor de este
-- paso es que las dos bases queden con la MISMA fila, que es de lo que se
-- trata toda esta migración.
--
-- ⚠️ LO QUE ESTE PASO **NO** LOGRA, Y CONVIENE NO CREÉRSELO. Uno esperaría que
-- con esto una función nueva naciera cerrada. NO PASA. Se midió, en los dos
-- regímenes, con la fila ya en `{postgres=X/postgres}`:
--
--     create function public.zz() returns int language sql as $$ select 1 $$;
--     -- proacl                                  -> NULL
--     -- has_function_privilege('anon', ..., 'EXECUTE') -> true
--
-- `proacl = NULL` significa "el default interno de Postgres", que para una
-- función es `{=X/dueño, dueño=X/dueño}` — y ese `=X` es PUBLIC. O sea: el
-- EXECUTE de PUBLIC vuelve solo en cada `create function`, y `anon` y
-- `authenticated` lo heredan por ser parte de PUBLIC. El `alter default
-- privileges` sobre funciones no lo evita en esta versión.
--
-- CONSECUENCIA PRÁCTICA, Y ES IMPORTANTE: **toda migración futura que cree una
-- función en `public` tiene que revocarla a mano**, como se viene haciendo. No
-- hay red automática. La red es el arnés: el BLOQUE 27 tiene un caso que
-- cuenta cuántas funciones de `public` son ejecutables por `anon` y exige 0, y
-- otro que deja documentado -corriéndolo- este comportamiento de Postgres, para
-- que nadie vuelva a suponer que el default lo resuelve.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;
alter default privileges in schema public revoke execute on functions from service_role;


-- -----------------------------------------------------------------------------
-- §2. Lo ya creado: revocar todo y volver a otorgar solo lo enumerado
-- -----------------------------------------------------------------------------
-- Se revoca en bloque en vez de función por función a propósito: una lista de
-- "sacale el permiso a estas" se desactualiza sola en cuanto alguien agrega una
-- función y se olvida de sumarla. Revocar todo y reponer una lista blanca
-- explícita hace que el estado final sea el que dice el archivo, no el que
-- quede de arrastre. El arnés (BLOQUE 27) prueba justamente eso: que la lista
-- efectiva sea IGUAL a la lista blanca, ni una función de más.
--
-- `postgres` (dueño), `supabase_admin` y `supabase_auth_admin` no se nombran:
-- sus privilegios quedan intactos. `crear_perfil_de_cuenta()`, que el trigger
-- de `auth.users` ejecuta como `supabase_auth_admin`, sigue funcionando.
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from authenticated;
revoke execute on all functions in schema public from service_role;


-- -----------------------------------------------------------------------------
-- §3. Lista blanca de `authenticated` (19)
-- -----------------------------------------------------------------------------
-- Dos familias, las dos imprescindibles:
--
--   a) Los predicados de permisos que las POLÍTICAS RLS invocan —`es_titular`,
--      `puede_ver_perfil`, `puede_administrar_perfil`, `perfil_actor`,
--      `perfil_de_objeto_storage`, etc.—. Son SECURITY DEFINER porque leen
--      `profiles` y `family_permissions`, que están bajo RLS: si fueran
--      INVOKER, la política que las llama se llamaría a sí misma. Que
--      `authenticated` pueda ejecutarlas no es una fuga: cada una responde
--      SOLO sobre el `auth.uid()` de quien pregunta.
--
--   b) Los RPC que la app llama con la sesión del usuario: confirmar o
--      descartar un documento recién subido, crear un perfil gestionado,
--      registrar/revertir una toma, registrar la suscripción push, buscar un
--      perfil por email para invitarlo. Cada una hace su propio control de
--      autorización adentro, y el arnés tiene casos hostiles para todas.
--
-- Estas 19 siguen apareciendo en el lint 0029 ("Authenticated Can Execute
-- SECURITY DEFINER Function") y así debe ser: son la superficie de escritura
-- de la app. Están documentadas una por una en `docs/seguridad-rls.md`,
-- sección "Security Advisor".
grant execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text, text) to authenticated;
grant execute on function public.crear_perfil_gestionado(text, date, text, inet)                                              to authenticated;
grant execute on function public.descartar_documento_recien_subido(uuid)                                                      to authenticated;
grant execute on function public.es_perfil_gestionado(uuid)                                                                   to authenticated;
grant execute on function public.es_sesion_de_usuario()                                                                       to authenticated;
grant execute on function public.es_titular(uuid)                                                                             to authenticated;
grant execute on function public.nombres_de_perfiles_vinculados()                                                             to authenticated;
grant execute on function public.perfil_actor()                                                                               to authenticated;
grant execute on function public.perfil_de_objeto_storage(text)                                                               to authenticated;
grant execute on function public.perfil_id_por_email(text)                                                                    to authenticated;
grant execute on function public.puede_administrar_perfil(uuid)                                                               to authenticated;
grant execute on function public.puede_arrancar_administracion(uuid, uuid)                                                    to authenticated;
grant execute on function public.puede_cargar_en_perfil(uuid)                                                                 to authenticated;
grant execute on function public.puede_graduar_perfil(uuid)                                                                   to authenticated;
grant execute on function public.puede_otorgar_permisos(uuid)                                                                 to authenticated;
grant execute on function public.puede_ver_perfil(uuid)                                                                       to authenticated;
grant execute on function public.registrar_suscripcion_push(text, text, text, uuid, text)                                     to authenticated;
grant execute on function public.registrar_toma(uuid)                                                                         to authenticated;
grant execute on function public.revertir_toma(uuid)                                                                          to authenticated;


-- -----------------------------------------------------------------------------
-- §4. Lista blanca de `service_role` (39)
-- -----------------------------------------------------------------------------
-- `service_role` es la clave del servidor: los route handlers de Next.js y los
-- jobs que se disparan por HTTP. Incluye las 19 de arriba —el servidor a veces
-- hace lo mismo que el cliente, por ejemplo al confirmar un documento que subió
-- la auto-ingesta— más las 20 que son estrictamente de servidor: leer y
-- guardar el token de Gmail, ingresar documentos y turnos automáticos, reclamar
-- lotes de recordatorios y alertas, cerrar los que se enviaron, resolver
-- destinatarios de avisos, tomar el lock del catálogo REFES.
--
-- Las 23 funciones que NO están acá tampoco lo estaban antes: las tres
-- `configurar_cron_*` y las tres `disparar_*` (sólo del dueño, porque escriben
-- secretos del Vault y reprograman pg_cron), `crear_perfil_de_cuenta()` (es de
-- `supabase_auth_admin`) y las 16 funciones de trigger y de CHECK, que Postgres
-- ejecuta por su cuenta y para las que el privilegio del llamador se verifica
-- al crear el trigger, no al dispararlo.
grant execute on function public.borrar_conexion_gmail(uuid)                                                                  to service_role;
grant execute on function public.cerrar_alerta_medicacion(uuid, integer, integer)                                             to service_role;
grant execute on function public.cerrar_recordatorio_turno(uuid, integer, integer)                                            to service_role;
grant execute on function public.completar_alta_de_cuenta(uuid)                                                               to service_role;
grant execute on function public.configurar_auto_ingesta_gmail(uuid, boolean, uuid)                                           to service_role;
grant execute on function public.confirmar_documento_recien_subido(uuid, text, text, date, text, jsonb, text, text, text, text) to service_role;
grant execute on function public.crear_perfil_gestionado(text, date, text, inet)                                              to service_role;
grant execute on function public.cuenta_administra_perfil(uuid, uuid)                                                         to service_role;
grant execute on function public.descartar_documento_recien_subido(uuid)                                                      to service_role;
grant execute on function public.destinatarios_de_avisos(uuid)                                                                to service_role;
grant execute on function public.es_perfil_gestionado(uuid)                                                                   to service_role;
grant execute on function public.es_sesion_de_usuario()                                                                       to service_role;
grant execute on function public.es_titular(uuid)                                                                             to service_role;
grant execute on function public.generar_alertas_medicacion()                                                                 to service_role;
grant execute on function public.generar_recordatorios_pendientes()                                                           to service_role;
grant execute on function public.generar_tomas_del_dia(date)                                                                  to service_role;
grant execute on function public.guardar_conexion_gmail(uuid, text, text, text, text, text)                                   to service_role;
grant execute on function public.ingresar_documento_automatico(uuid, uuid, text, text, bigint, text, text, text, date, text, text, text) to service_role;
grant execute on function public.ingresar_turno_automatico(uuid, uuid, text, text, timestamp with time zone, text, text, text, text, text) to service_role;
grant execute on function public.leer_refresh_token_gmail(uuid)                                                               to service_role;
grant execute on function public.marcar_conexion_gmail_activa(uuid)                                                           to service_role;
grant execute on function public.marcar_conexion_gmail_vencida(uuid)                                                          to service_role;
grant execute on function public.nombres_de_perfiles_vinculados()                                                             to service_role;
grant execute on function public.perfil_actor()                                                                               to service_role;
grant execute on function public.perfil_de_objeto_storage(text)                                                               to service_role;
grant execute on function public.perfil_id_por_email(text)                                                                    to service_role;
grant execute on function public.puede_administrar_perfil(uuid)                                                               to service_role;
grant execute on function public.puede_arrancar_administracion(uuid, uuid)                                                    to service_role;
grant execute on function public.puede_cargar_en_perfil(uuid)                                                                 to service_role;
grant execute on function public.puede_graduar_perfil(uuid)                                                                   to service_role;
grant execute on function public.puede_otorgar_permisos(uuid)                                                                 to service_role;
grant execute on function public.puede_ver_perfil(uuid)                                                                       to service_role;
grant execute on function public.reclamar_alertas_medicacion(integer)                                                         to service_role;
grant execute on function public.reclamar_recordatorios_turnos(integer)                                                       to service_role;
grant execute on function public.reclamar_sincronizacion_refes(uuid, integer)                                                 to service_role;
grant execute on function public.registrar_suscripcion_push(text, text, text, uuid, text)                                     to service_role;
grant execute on function public.registrar_toma(uuid)                                                                         to service_role;
grant execute on function public.revertir_toma(uuid)                                                                          to service_role;
grant execute on function public.vincular_perfil_graduado(uuid, text)                                                         to service_role;


-- -----------------------------------------------------------------------------
-- §5. pg_net: por qué NO se mueve la extensión y por qué NO se cierra `net`
-- -----------------------------------------------------------------------------
-- El Advisor de producción tira un `extension_in_public` por `public.pg_net`.
-- Aparece en cloud y no en local por la misma clase de divergencia que el resto
-- de esta migración: `20260812190000_extensiones.sql` dice `create extension if
-- not exists pg_net;` sin `with schema`. En el stack local el CLI ya trae
-- pg_net preinstalada en `extensions`, así que el `if not exists` no hace nada;
-- en un proyecto de cloud nuevo la crea, y sin `with schema` la registra en el
-- primer esquema del search_path, que es `public`.
--
-- NO SE MUEVE, y la decisión es deliberada:
--
--   1. No cambia NADA de la superficie de ataque. `pg_net` declara
--      `relocatable = false` y crea sus objetos en un esquema propio, `net`,
--      esté la extensión registrada donde esté. En `public` no queda ni una
--      función de pg_net: lo único que vive ahí es la ANOTACIÓN de
--      `pg_extension.extnamespace`. El lint es correcto como regla general
--      (una extensión en `public` suele dejar funciones expuestas a PostgREST)
--      y es un falso positivo para este caso concreto.
--
--   2. Moverla es caro y peligroso. Al ser `relocatable = false`, `alter
--      extension pg_net set schema extensions` FALLA. El único camino es
--      `drop extension pg_net` + `create extension pg_net with schema
--      extensions`, y el `drop` se lleva puesto el esquema `net` entero, con la
--      cola de pedidos HTTP adentro. Peor: el background worker de pg_net queda
--      apuntando a tablas que ya no existen y hay que reiniciarlo a mano
--      (`select net.worker_restart()`). Si eso no sale bien, `net.http_post`
--      acepta la escritura y no dispara nunca: los cuatro crons dejarían de
--      mandar recordatorios, alertas y el barrido de Gmail **en silencio**, sin
--      un error que lo delate. Cambiar una anotación cosmética no vale ese
--      riesgo sobre avisos de medicación.
--
--   3. Para proyectos NUEVOS la corrección es gratis y va documentada en
--      `docs/seguridad-rls.md`: `create extension if not exists pg_net with
--      schema extensions;`. No se edita `20260812190000_extensiones.sql`
--      porque en producción ya está aplicada y reescribir una migración
--      aplicada no la vuelve a correr — solo ensucia el historial.
--
-- -----------------------------------------------------------------------------
-- Y UNA SEGUNDA COSA, QUE SE INTENTÓ Y NO SE PUEDE (queda como deuda conocida).
--
-- pg_net otorga por su cuenta USAGE sobre el esquema `net` y EXECUTE sobre
-- `net.http_post` / `net.http_get` a `anon` y a `authenticated`. Eso es, en
-- potencia, un SSRF con la identidad del servidor de base de datos: pedidos
-- HTTP arbitrarios salientes, contra endpoints internos inclusive.
--
-- La primera versión de esta migración traía los `revoke` correspondientes.
-- **No funcionan, y encima no fallan**: se ejecutan, devuelven `REVOKE` y
-- emiten un `WARNING: no privileges could be revoked for "net"` que en un
-- `db push` pasa completamente desapercibido. El motivo es de Postgres, no
-- nuestro: un `revoke` solo puede sacar privilegios que otorgó el rol que lo
-- ejecuta (o el dueño del objeto). El esquema `net` y sus funciones son de
-- `supabase_admin`, y `postgres` -en cloud y también en el stack local, donde
-- `rolsuper = false` para `postgres`- no es miembro suyo. Desde una migración
-- del proyecto esos grants NO son revocables.
--
-- Se sacaron los `revoke` en vez de dejarlos "por las dudas" justamente por lo
-- que esta auditoría vino a arreglar: una sentencia que parece cerrar algo y no
-- lo cierra es peor que no tenerla, porque el próximo que lea el archivo va a
-- creer que el tema está resuelto.
--
-- POR QUÉ SE ACEPTA MIENTRAS TANTO: `net` no está entre los esquemas que
-- PostgREST expone (`public, graphql_public`), así que `net.http_post` no es
-- alcanzable por `/rest/v1/rpc/`. Para llegar haría falta ejecución de SQL
-- arbitrario, y quien tenga eso ya no necesita pg_net. El riesgo residual es
-- real pero de segundo orden, y está fuera de nuestro alcance corregirlo.
--
-- El arnés (BLOQUE 27) lo deja MEDIDO en dos casos, no comentado: si Supabase
-- algún día cambia ese default, o si alguien suma `net` a los esquemas
-- expuestos, los casos cambian de valor y el tema vuelve a la mesa.


-- -----------------------------------------------------------------------------
-- §6. Red de seguridad: que la migración se caiga si no logró lo que dice
-- -----------------------------------------------------------------------------
-- Un `revoke` sobre un rol que no existe, o un `grant` a una firma que cambió,
-- puede pasar sin ruido y dejar el esquema a medio cerrar. Esta verificación
-- corre dentro de la misma transacción que todo lo de arriba: si los números no
-- dan, `supabase db push` aborta y no queda nada aplicado a medias.
do $$
declare
    v_publico   integer;
    v_anon      integer;
    v_auth      integer;
    v_srv       integer;
begin
    select count(*) into v_publico
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
           lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0;

    select count(*) filter (where pg_get_userbyid(a.grantee) = 'anon'),
           count(*) filter (where pg_get_userbyid(a.grantee) = 'authenticated'),
           count(*) filter (where pg_get_userbyid(a.grantee) = 'service_role')
      into v_anon, v_auth, v_srv
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
           lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'public' and a.privilege_type = 'EXECUTE';

    if v_publico <> 0 then
        raise exception 'Hardening incompleto: % funciones de public siguen con EXECUTE de PUBLIC', v_publico;
    end if;
    if v_anon <> 0 then
        raise exception 'Hardening incompleto: % funciones de public siguen ejecutables por anon', v_anon;
    end if;
    if v_auth <> 19 then
        raise exception 'Hardening incompleto: authenticated quedó con EXECUTE sobre % funciones, se esperaban 19', v_auth;
    end if;
    if v_srv <> 39 then
        raise exception 'Hardening incompleto: service_role quedó con EXECUTE sobre % funciones, se esperaban 39', v_srv;
    end if;
end $$;
