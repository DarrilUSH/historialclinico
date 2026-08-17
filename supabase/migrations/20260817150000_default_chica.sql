-- =============================================================================
-- Historial Médico — Migración 20260817150000: la densidad por defecto pasa a
-- CHICA (Sprint 14, tarea 14.1)
-- -----------------------------------------------------------------------------
-- ── QUÉ CAMBIA Y POR QUÉ
--
-- La 20260814120000 creó `profiles.display_density` con `default 'grande'`, y
-- ese default era la decisión correcta con la información de entonces: la app
-- se había diseñado entera para adultos mayores y el modo compacto era una
-- opción para quien viera bien y la pidiera.
--
-- Lo que cambió es el modo compacto, no la decisión de accesibilidad. La letra
-- chica del Sprint 13 era una REDUCCIÓN del modo grande (cuerpo de 16px,
-- espaciado de 4px) y el usuario, con el sitio ya en producción, la describió
-- como "sigue siendo enorme". El Sprint 14 la retokenizó contra métricas de
-- apps nativas —cuerpo de 14px (body-medium de Material 3), secundario de
-- 12-13px, títulos de pantalla de 20px, bottom nav de 64px, radios de 10px—:
-- ver `app/globals.css` §5 y `docs/densidad.md` §5-bis. Con esa v2, el modo
-- compacto ya no es "la app apretada" sino "la app como una app de celular", y
-- el default razonable para quien abre la aplicación por primera vez es ése.
--
-- El modo grande NO desaparece ni se degrada: sigue intacto hasta el píxel,
-- sigue siendo el modo pensado para el caso más exigente, y sigue estando a un
-- toque de distancia (el botón A/a del encabezado, siempre visible, más la
-- pregunta del selector de perfiles). Lo que cambia es cuál de los dos se
-- muestra a quien todavía no eligió.
--
-- ── EL BACKFILL: POR QUÉ SE PISAN LAS FILAS EXISTENTES
--
-- Un `set default` solo afecta a las filas FUTURAS. Las que ya existen se
-- quedarían en 'grande', y eso convertiría a cada cuenta viva —incluidas las
-- de producción— en una excepción permanente al default nuevo.
--
-- Pisarlas es legítimo, y el motivo es preciso: **hasta hoy nadie eligió
-- 'grande' explícitamente.** El valor que tienen esas filas no es una
-- preferencia expresada, es el default heredado del `ALTER TABLE ... DEFAULT`
-- de la 20260814120000 (el arnés de RLS lo verifica en el BLOQUE 17: "toda
-- fila de profiles arranca en el modo por defecto"). Cambiar el default y
-- dejar el backfill afuera preservaría un dato que nunca existió.
--
-- De acá en adelante deja de ser cierto: desde este deploy, tocar el A/a o
-- responder la pregunta del selector SÍ es una elección explícita, queda
-- guardada en la fila y ninguna migración futura tiene derecho a pisarla. Si
-- alguna vez hiciera falta otro cambio de default, primero habría que agregar
-- una columna que distinga "elegido" de "heredado" — hoy no existe y hoy no
-- hace falta, porque hoy todavía no hay nada elegido que perder.
--
-- ── LAS DOS PIEZAS QUE PODÍAN INTERFERIR CON EL UPDATE MASIVO (y no lo hacen)
--
--   1. **El trigger `profiles_proteger_densidad`** (20260814120000 §3) rechaza
--      con 42501 cualquier cambio de esta columna hecho por alguien que no sea
--      el titular de la fila. Un UPDATE masivo sería, para esa regla, el peor
--      caso imaginable.
--
--      No dispara, y no por casualidad: su primera línea es
--      `if not public.es_sesion_de_usuario() then return new; end if;`, y esa
--      función es `current_user in ('authenticated','anon') or auth.uid() is
--      not null`. Una migración corre como `postgres` y sin `request.jwt.claims`
--      en la conexión, así que las dos condiciones son falsas y el trigger se
--      abstiene — exactamente igual que en el backfill de la 20260814140000 §3
--      y en el seed. Es el patrón de todos los triggers de protección del
--      proyecto, y está puesto justamente para que las migraciones puedan
--      escribir lo que una sesión de usuario no puede.
--
--      Por eso NO se toca `session_replication_role`: además de exigir un
--      privilegio que no hace falta pedir, apagaría de paso las FK y los demás
--      triggers de la tabla. Se prefiere apoyarse en la guarda que ya existe y
--      VERIFICAR el resultado (§4) en vez de desarmar el mecanismo.
--
--   2. **El CHECK `profiles_densidad_solo_con_cuenta`**, que dice
--      `user_id is not null or display_density = 'grande'`. Ese SÍ interfiere,
--      y de dos maneras: rechazaría el UPDATE de todo perfil gestionado, y —peor
--      todavía— después del `set default` rechazaría el INSERT de cualquier
--      perfil gestionado nuevo, porque la columna tomaría 'chica' del default y
--      el CHECK exige 'grande'. La aplicación no manda esta columna al crear un
--      perfil desde `/familia`: el alta entera se rompería.
--
--      El CHECK no expresa "los perfiles gestionados son grandes": expresa
--      "los perfiles gestionados no tienen preferencia y se quedan en EL
--      DEFAULT" (ver "PERFILES GESTIONADOS" en la 20260814120000). Ese sentido
--      se conserva; lo que cambia es cuál es el default. Por eso el
--      constraint se recrea con el valor nuevo, y por eso queda anotado acá que
--      **el literal del CHECK y el DEFAULT de la columna tienen que moverse
--      siempre juntos**.
--
-- ── EFECTO COLATERAL DECLARADO
--
-- El UPDATE dispara `profiles_set_updated_at`, así que todas las filas quedan
-- con `updated_at = now()`. Se acepta: ninguna pantalla lee esa columna. La que
-- sí se lee —`sos_updated_at`, que alimenta el "datos actualizados el ..." de
-- la ficha offline— NO se toca, porque su trigger (`set_sos_updated_at`) solo
-- se activa cuando cambia algún campo de la ficha SOS y `display_density` no es
-- uno de ellos.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE
--
--   · **No toca el enum.** Siguen siendo los mismos dos modos.
--   · **No toca las políticas ni el trigger de protección.** Quién puede
--     escribir la columna no cambió ni un ápice: sigue siendo solo el titular
--     de la fila (docs/densidad.md §8).
--   · **No decide por nadie.** Sigue sin haber heurística por edad, `role` ni
--     user-agent: el modo lo elige la persona. Lo único que cambia es qué ve
--     mientras no lo haya elegido.
--   · **No define qué significa 'chica' en píxeles.** Eso vive en
--     `app/globals.css` §5 y está documentado en `docs/densidad.md`.
--
-- El espejo del lado de la aplicación es `TAMANO_POR_DEFECTO` en
-- `lib/densidad/tamano.ts`, que pasa a 'chica' en el mismo commit;
-- `tests/unit/densidad.test.ts` verifica que los dos lados digan lo mismo
-- contra el enum generado.
--
-- UTF-8 sin BOM. Todo objeto calificado con su esquema, igual que el resto del
-- proyecto.
-- =============================================================================


-- =============================================================================
-- 1. FUERA EL CHECK VIEJO
-- -----------------------------------------------------------------------------
-- Tiene que salir ANTES del UPDATE: mientras exija 'grande' para los perfiles
-- sin cuenta, el backfill de §3 no puede tocarlos. Se recrea en §4 con el valor
-- nuevo, dentro de la misma migración y por lo tanto de la misma transacción:
-- la tabla nunca queda sin la garantía.
-- =============================================================================

alter table public.profiles
    drop constraint profiles_densidad_solo_con_cuenta;


-- =============================================================================
-- 2. EL DEFAULT NUEVO
-- -----------------------------------------------------------------------------
-- Solo el default. La columna sigue siendo `not null` y del mismo tipo, así que
-- esto es un cambio de catálogo: no reescribe la tabla ni toca una sola fila.
-- =============================================================================

alter table public.profiles
    alter column display_density set default 'chica';

comment on column public.profiles.display_density is
    'Preferencia de tamaño de letra DE LA CUENTA COMO ESPECTADORA, no un dato del paciente: es "con qué densidad ve la app quien inicia sesión con esta cuenta", y NO tiene nada que ver con el perfil que esa persona esté mirando. Cuando María (grande) mira el perfil de Roberto, manda la de María. Desde el Sprint 14 el default es "chica" —la densidad nativa retokenizada de app/globals.css §5—; quien prefiera "grande" lo elige con el botón A/a y su elección queda guardada. Solo la escribe el titular de la fila — lo garantiza el trigger profiles_proteger_densidad, porque ni un privilegio de columna ni una política RLS pueden expresar "esta columna sí, para esta fila". En perfiles gestionados (user_id null) es inerte y queda clavada en el default por profiles_densidad_solo_con_cuenta.';


-- =============================================================================
-- 3. BACKFILL — las filas que heredaron el default viejo
-- -----------------------------------------------------------------------------
-- Filtrado por `= 'grande'` y no incondicional: así el UPDATE no toca las filas
-- que ya estén en 'chica' (las de quien probó el modo compacto durante el
-- Sprint 13), y el `updated_at` de esas filas no se mueve al pedo.
--
-- Cubre las dos clases de fila a la vez, y las dos por el mismo motivo:
--   · las de CUENTA, porque su 'grande' es el default heredado y no una
--     elección (ver el encabezado);
--   · las GESTIONADAS, porque su valor es inerte por definición y tiene que
--     seguir siendo igual al default de la columna — si no, el CHECK que se
--     recrea en §4 no las dejaría pasar.
-- =============================================================================

do $$
declare
    v_filas integer;
begin
    update public.profiles
       set display_density = 'chica'
     where display_density = 'grande';

    get diagnostics v_filas = row_count;

    raise notice
        'Default chica: % fila(s) de profiles migradas de grande a chica (ninguna había elegido grande explícitamente).',
        v_filas;
end;
$$;


-- =============================================================================
-- 4. EL CHECK, RECREADO CONTRA EL DEFAULT NUEVO
-- -----------------------------------------------------------------------------
-- Misma regla de siempre —"un perfil sin cuenta no mira nada, así que su
-- preferencia se queda en el default"— con el literal actualizado. Sin `not
-- valid`: se quiere que Postgres revise las filas existentes acá y ahora, que
-- es la forma más barata de comprobar que el backfill de §3 no dejó ninguna
-- atrás.
-- =============================================================================

alter table public.profiles
    add constraint profiles_densidad_solo_con_cuenta
        check (user_id is not null or display_density = 'chica');


-- =============================================================================
-- 5. VERIFICACIÓN — que el backfill haya pasado de verdad
-- -----------------------------------------------------------------------------
-- El §3 se apoya en que `profiles_proteger_densidad` se abstiene fuera de una
-- sesión de usuario. Es un razonamiento sobre el comportamiento de otra
-- migración, y un razonamiento puede estar mal: si algún día alguien le sacara
-- la guarda `es_sesion_de_usuario()` a ese trigger, el UPDATE de §3 empezaría a
-- fallar (lanzando 42501, que abortaría la migración: ruidoso, está bien) o
-- —peor— a no hacer nada si alguien lo convirtiera en un trigger que conserva
-- en silencio.
--
-- Este bloque cierra ese segundo escenario: si quedara UNA sola fila en
-- 'grande', la migración se cae acá en vez de dejar la base a mitad de camino.
-- Es la misma clase de red que el `raise exception` de
-- `completar_alta_de_cuenta` cuando no encuentra la cuenta.
-- =============================================================================

do $$
declare
    v_pendientes integer;
begin
    select count(*) into v_pendientes
      from public.profiles
     where display_density = 'grande';

    if v_pendientes > 0 then
        raise exception
            'El backfill de densidad no se aplicó: quedan % fila(s) de profiles en grande. Revisar si profiles_proteger_densidad dejó de abstenerse fuera de una sesión de usuario.',
            v_pendientes
            using errcode = 'raise_exception';
    end if;
end;
$$;

-- Fin de la migración.
