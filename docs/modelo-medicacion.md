# Modelo de medicación: stock, tomas y días restantes

> Sprint 7, tarea 7.1. Migración: `supabase/migrations/20260813060000_medicacion_estado.sql`.
> Tablas base: `20260812200000_schema_inicial.sql` §4.7 y §4.8. Permisos:
> `docs/modelo-permisos.md` §6 (matriz) y §7.3 (notas ⑨ y ⑩).

Este documento cierra el **diseño** de la medicación: qué se calcula, con qué
fórmula, quién puede escribir qué y qué contrato queda para las tareas 7.2 a
7.5. No describe pantallas: las pantallas las construyen esas tareas sobre lo
que está acá.

---

## 1. Lo que ya existía y lo que se agregó

Las dos tablas del dominio están desde el esquema inicial y **esta migración no
las toca**:

| Objeto | Dónde nació | Qué aporta |
|---|---|---|
| `medications` | `20260812200000` §4.7 | El plan: droga, presentación, dosis, esquema, stock, receta asociada |
| `medication_intakes` | `20260812200000` §4.8 | El libro mayor: una fila por toma programada, que pasa a `taken` cuando alguien confirma |
| Políticas RLS de ambas | `20260812220000` §5 | La matriz de `docs/modelo-permisos.md`, incluida la excepción ⑩ |

Lo que faltaba —y agrega `20260813060000`— son las tres piezas que convierten
esas tablas en algo usable:

1. **`v_medicacion_estado`** — la fórmula de días de stock, materializada.
2. **`registrar_toma()` / `revertir_toma()`** — las escrituras atómicas que RLS
   no puede expresar (nota ⑨).
3. **`generar_tomas_del_dia()` + job de `pg_cron`** — las tomas programadas que
   7.3 marca y 7.4 vigila.

Ninguna tabla nueva ⇒ ninguna RLS nueva. La vista hereda la de `medications`
por `security_invoker`; los tres RPC son `SECURITY DEFINER` y validan con los
**mismos** predicados de la matriz (`puede_cargar_en_perfil`).

---

## 2. Las fórmulas

### 2.1 Tomas por día, según la frecuencia

`medications.frequency` decide qué columna manda; el CHECK
`medications_esquema_coherente` ya impide filas incoherentes.

| `frequency` | `tomas_por_dia` | Ejemplo |
|---|---|---|
| `daily` | `cardinality(schedule_times)` | `{08:00, 20:00}` → **2** |
| `interval_hours` | `24 / interval_hours` (numérico) | cada 8 hs → **3**; cada 5 hs → **4,8** |
| `as_needed` | `NULL` | — |

### 2.2 Consumo diario y días restantes

```
dosis_diaria_total = tomas_por_dia * dose_amount
dias_restantes     = floor(stock_units / dosis_diaria_total)
fecha_estimada_fin = hoy + dias_restantes          -- "hoy" = día de pared en Ushuaia
necesita_renovacion = dias_restantes < 5
```

El ejemplo del ROADMAP, punta a punta: *Metformina 850 mg, 2 tomas por día
(8:00 y 20:00), `dose_amount = 1`, `stock_units = 60`* → 2 comprimidos por día →
**30 días**.

**Por qué `floor` y no la división exacta.** "Quedan 4,5 días" no es accionable;
lo que sirve es cuántos días **completos** cubre el stock, y son 4. El redondeo
hacia abajo además es el conservador, que es el que corresponde cuando el error
caro es quedarse sin remedio un domingo. `dias_restantes = 0` significa "no
alcanza ni para hoy", no "no queda nada".

### 2.3 Dónde se materializa: una vista, no una columna

`dias_restantes` es función de tres columnas que ya existen **y del
calendario**. Una columna materializada habría que recalcularla en cada toma, en
cada edición de dosis y —lo que rompe el esquema— **cada vez que cambia el
día**, un evento que ninguna escritura dispara. Una columna así se desincroniza
en silencio y muestra "quedan 5 días" durante una semana.

La vista se calcula al consultar, es siempre coherente y no agrega ningún camino
de escritura. El costo es despreciable: decenas de filas por perfil y aritmética
sobre columnas que ya se leen.

### 2.4 `security_invoker = true` no es un detalle

Una vista se ejecuta por defecto con los permisos de su **dueño**, que acá es
`postgres` y tiene `BYPASSRLS`: una vista normal sobre `medications` devolvería
la medicación de **todas las familias** a cualquiera con `SELECT`. Con
`security_invoker = true` (PostgreSQL 15+) las políticas se evalúan contra quien
consulta, así que la vista hereda exactamente `medications_select_puede_ver` y
no hay una segunda matriz de permisos que mantener sincronizada.

### 2.5 Columnas de la vista

Una fila por medicación **activa** (`is_active`). Además de las columnas de
`medications`:

| Columna | Tipo | Qué es |
|---|---|---|
| `medication_id` | `uuid` | `medications.id`, renombrado para poder joinear con `medication_intakes` sin dos `id` |
| `tomas_por_dia` | `numeric` | §2.1. `NULL` para `as_needed` |
| `dosis_diaria_total` | `numeric` | §2.2, en la unidad de `dose_unit`. `NULL` para `as_needed` |
| `dias_restantes` | `integer` | §2.2. `NULL` si es `as_needed` o si no hay stock cargado |
| `fecha_estimada_fin` | `date` | `hoy + dias_restantes`, hora de pared de Ushuaia |
| `necesita_renovacion` | `boolean` | `dias_restantes < 5` — el umbral de la tarea 7.4, definido **una sola vez** |
| `vigente_hoy` | `boolean` | Hoy cae dentro de `[start_date, end_date]` |

**El histórico no está acá.** Una medicación suspendida no aparece: para ella
"cuántos días de stock quedan" no es una pregunta con respuesta. El listado
histórico de 7.2 lee `medications` directamente.

---

## 3. `as_needed`: sin días restantes, con stock informativo

Una medicación a demanda no tiene consumo diario. El ibuprofeno que se toma "si
duele" puede durar un mes o tres días, y **no hay denominador honesto**.

`dosis_diaria_total`, `dias_restantes` y `fecha_estimada_fin` son `NULL`, y
`necesita_renovacion` es `false`. `stock_units` se conserva como dato
informativo: la app muestra *"quedan 20 comprimidos"* y no proyecta nada.

Inventar un denominador para que las columnas no queden vacías produciría una
fecha de renovación falsa y una alerta que grita sin motivo — que es la forma
más rápida de que alguien apague las notificaciones para siempre.

Como corolario: **`generar_tomas_del_dia()` no programa tomas para
`as_needed`**. Su toma se crea en el momento en que la persona dice que la tomó
(tarea 7.3), no antes.

---

## 4. Registrar una toma: la nota ⑨, resuelta

### 4.1 El problema

Marcar una toma es un `UPDATE` sobre `medication_intakes` que `can_upload` **sí**
puede hacer (nota ⑩: la transición `pending → taken|skipped` es la excepción de
la matriz). Pero descontar el stock es un `UPDATE` sobre `medications`, tabla
donde `can_upload` **no escribe** (`medications_update_administrador`).

Aflojar esa política le daría a una cuidadora la capacidad de editar dosis y
suspender tratamientos, que es justamente lo que la matriz reserva para
`can_manage`. `docs/modelo-permisos.md` §7.3 ya había escrito la salida:

> ⑨ descuento de stock al registrar la toma · Requiere escribir en dos tablas
> con permisos distintos, atómicamente · Función `SECURITY DEFINER`
> `registrar_toma(...)` que valida `puede_cargar_en_perfil` y hace ambas
> escrituras

### 4.2 `registrar_toma(intake_id uuid) → medication_intakes`

Superficie mínima: **un** parámetro, cuatro guardas, dos escrituras en la misma
transacción.

| # | Guarda | Si falla |
|---|---|---|
| 1 | La toma existe (se toma con `FOR UPDATE`) | `22023` |
| 2 | `puede_cargar_en_perfil(profile_id)` — el mismo predicado que el `INSERT` de la tabla | `42501` |
| 3 | `status = 'pending'` | `22023` |
| 4 | `scheduled_at` dentro de **±12 horas** de ahora | `22023` |

Efectos, atómicos:

- `status = 'taken'`, `taken_at = now()`, `dose_units = <lo descontado>`.
- `medications.stock_units = GREATEST(0, stock_units - dose_amount)`.

El `FOR UPDATE` sobre la toma es lo que hace que **dos toques simultáneos del
botón no descuenten dos veces**: el segundo espera al primero y después
encuentra `taken`, que la guarda 3 rechaza. La antiduplicación no es una
condición de carrera resuelta con un `if`, es un bloqueo de fila.

### 4.3 La ventana de ±12 horas

Doce horas es **exactamente medio día**, y de ahí sale la propiedad que la hace
elegible: en el esquema más común del producto (2 tomas por día, 8:00 y 20:00)
nunca hay más de una toma registrable hacia atrás y una hacia adelante, así que
"marcar la toma" no puede marcar por error la de otro momento del día.

- **Hacia atrás** cubre a quien toma el remedio a la mañana y confirma a la
  noche, que es el caso real más frecuente.
- **Hacia adelante** cubre a quien se adelanta unas horas porque sale de viaje.

Lo que queda afuera es deliberado: **una toma de hace tres días no se
"registra", se corrige**, y corregir el pasado es administración (`can_manage`,
con el `UPDATE` normal de la tabla). Sin esta guarda, cualquiera con
`can_upload` podría vaciar el stock marcando de golpe todas las tomas viejas
pendientes, y la alerta de renovación se dispararía sola.

### 4.4 `dose_units` guarda **lo descontado**, no la dosis

Lo dice el `COMMENT` de la columna desde el esquema inicial: *"unidades
efectivamente descontadas del stock (…) para que revertir una toma restituya
exactamente lo descontado"*. De ahí salen los tres casos borde:

| Situación | `dose_units` | Stock después |
|---|---|---|
| Stock no cargado (`NULL`) | `NULL` | sigue `NULL` |
| Stock 5, dosis 1 | `1` | `4` |
| Stock 1, dosis 2 (insuficiente) | `1` | `0` |
| Stock 0 | `NULL` | `0` |

El `NULL` con stock 0 no es un descuido: el CHECK `dose_units > 0` prohíbe
guardar un `0`, y con razón —"descontó cero" y "no descontó" son lo mismo—.

La dosis **clínica** nunca se pierde: está en `medications.dose_amount`. Esta
columna existe para que la restitución sea exacta aunque después cambie la
dosis.

---

## 5. Stock 0 no bloquea nada: el stock es una guía, no un portero

**Decisión de producto, explícita.** Registrar una toma con `stock_units = 0`
está permitido y no falla.

La abuela puede tener una caja extra en el cajón que nadie cargó en la app. Una
app que le conteste *"no podés haber tomado ese remedio"* cuando **ya se lo
tomó** está defendiendo su propia contabilidad contra un hecho consumado, y el
que pierde es el registro clínico: la toma real desaparece del historial para
que un número siga cerrando.

Qué pasa entonces:

- La toma se registra igual (`status = 'taken'`, `taken_at` real).
- No se descuenta nada, `dose_units` queda `NULL`.
- El stock se mantiene en 0 gracias a `GREATEST(0, …)`, que también respeta el
  CHECK `medications_stock_no_negativo`.
- `dias_restantes` sigue en 0 y `necesita_renovacion` sigue en `true`: la alerta
  de la tarea 7.4 **no se apaga sola**, se apaga cuando alguien carga la caja
  nueva.

El corolario para la interfaz de 7.2/7.3: el stock se presenta como **ayuda**
("te quedan ~30 días, conviene pedir la receta"), nunca como **validación**. El
único lugar donde el stock manda es la alerta preventiva, y su función es
recordar que hay que renovar, no impedir nada.

---

## 6. Deshacer una toma: `revertir_toma(intake_id) → medication_intakes`

El *"me equivoqué"* del ROADMAP: "permitir corregir una toma marcada por error
dentro del día".

**Por qué también tiene que ser un RPC**, por partida doble: restituir el stock
es otra vez un `UPDATE` sobre `medications`, y la transición es
`taken → pending`, que la política `medication_intakes_update_registrar_toma`
**no** permite (habilita `pending → taken|skipped` y nada más). Es correcto que
sea así: deshacer no es la misma operación que hacer, y un camino genérico de
vuelta le permitiría a `can_upload` reescribir el historial de tomas de la
semana.

| # | Guarda | Si falla |
|---|---|---|
| 1 | La toma existe | `22023` |
| 2 | `puede_cargar_en_perfil(profile_id)` | `42501` |
| 3 | `status = 'taken'` | `22023` |
| 4 | `taken_at` cae **el mismo día calendario** que hoy, en `America/Argentina/Ushuaia` | `22023` |

Efectos: `status = 'pending'`, `taken_at = NULL`, `dose_units = NULL`, y
`stock_units += dose_units` — **lo que la toma descontó de verdad**, no la dosis
actual. Si la dosis cambió entre el registro y la corrección, o si el descuento
se había topado con el fondo del stock, el stock vuelve igual que antes de la
toma y no a un número inventado.

**Por qué solo el mismo día.** Un botón de deshacer sirve para el error
inmediato ("le di al botón que no era"). Pasada la medianoche, cambiar si una
persona tomó o no su medicación ayer ya no es deshacer: es reescribir el
registro clínico, y eso lo hace quien administra el perfil.

**Por qué el día se mide en Ushuaia y no en UTC.** Si se comparara en UTC, todo
lo registrado después de las 21:00 locales dejaría de ser reversible al
instante, porque en UTC ya sería el día siguiente. Es el mismo criterio de
`lib/turnos/fecha.ts` y de `docs/recordatorios.md` §"Zona horaria".

**Lo que no cubre:** una toma marcada `skipped` por error. No descontó stock, y
volverla a `pending` es un `UPDATE` normal que la matriz le da a `can_manage`.
Si el uso real muestra que también hace falta deshacerla desde `can_upload`, se
agrega con la misma guarda de día — no se afloja la política.

---

## 7. Programar el día: `generar_tomas_del_dia(fecha)`

Sin esta función `medication_intakes` está vacía y no hay nada que marcar: la
pantalla de 7.3 muestra "las tomas de hoy" y el job de 7.4 vigila el stock que
esas tomas consumen.

Firma: `generar_tomas_del_dia(fecha date default <hoy en Ushuaia>) → integer`
(cuántas filas creó de verdad).

### 7.1 Qué genera cada esquema

- **`daily`** — una toma por cada horario de `schedule_times`, en hora de
  **pared** de Ushuaia: `(fecha + hora) AT TIME ZONE 'America/Argentina/Ushuaia'`.
  Guardar 8:00 sin zona haría que la toma de la mañana apareciera a las 5 de la
  madrugada.
- **`interval_hours`** — una grilla que arranca en una **hora ancla** y avanza
  de `interval_hours` en `interval_hours`, dando la vuelta al reloj (módulo
  24 hs) para que todas las tomas caigan dentro del mismo día calendario. El
  ancla es la hora de pared de la toma **más vieja** que la medicación ya tenga
  y, si no tiene ninguna, **las 8:00**.
- **`as_needed`** — nada (§3).

Solo entran medicaciones **activas y vigentes**: `is_active`,
`start_date <= fecha` y `end_date IS NULL OR end_date >= fecha`.

**El ancla se sostiene sola.** Como la grilla es módulo 24, cualquiera de sus
puntos genera el mismo conjunto: a partir del segundo día el ancla ya no puede
moverse aunque la toma más vieja cambie de lugar. Con `interval_hours = 8` y
ancla 8:00, la grilla es `{08:00, 16:00, 00:00}`; tomando 00:00 como ancla al
día siguiente sale `{00:00, 08:00, 16:00}` — el mismo conjunto.

### 7.2 La idempotencia es el `UNIQUE`, no un `if`

`ON CONFLICT DO NOTHING` sobre `medication_intakes_toma_unica
(medication_id, scheduled_at)`. Correrla diez veces seguidas, dos veces en
paralelo, o a mano después del cron, **no puede** duplicar una toma — no porque
la función chequee antes, sino porque la base no lo permite. Mismo criterio que
`appointment_reminders` en `docs/recordatorios.md`.

### 7.3 La aproximación de los intervalos que no dividen a 24

Con `interval_hours = 5` la grilla del día tiene `24 / 5 = 4` tomas (8:00, 13:00,
18:00, 23:00) y el último hueco hasta la primera del día siguiente es de 9
horas, no de 5.

Es **a propósito**: un "cada 5 horas" estricto corre el horario todos los días y
termina despertando a la persona a las 3 de la mañana. La vista, en cambio, usa
el ritmo continuo (`24/5 = 4,8` tomas diarias) para proyectar el stock, que es
el promedio honesto. Los intervalos reales del producto —6, 8, 12, 24— dividen a
24 y no tienen esta diferencia.

### 7.4 El job diario

```sql
select cron.schedule('generar-tomas-del-dia', '5 3 * * *',
                     $$select public.generar_tomas_del_dia()$$);
```

**03:05 UTC = 00:05 en Ushuaia.** Las expresiones de `pg_cron` se interpretan en
UTC (su `cron.timezone` es un parámetro de servidor que no se puede tocar desde
una migración, ni en Supabase hosted). Argentina está en UTC−3 de forma continua
desde 2009 y no aplica horario de verano.

Y si eso cambiara, el daño está acotado: la función **no recibe la fecha del
cron**, la calcula ella misma como el día de pared de Ushuaia en el instante de
la corrida. Un corrimiento de una hora seguiría cayendo dentro del mismo día
local.

Los 5 minutos de colchón son para que la medianoche ya haya pasado en cualquier
reloj involucrado. A esa hora no hay nadie usando la app y la corrida es un
puñado de `INSERT`.

Verificarlo:

```sql
select jobid, schedule, jobname, active from cron.job;
select * from cron.job_run_details where jobid = 2 order by start_time desc limit 5;
```

---

## 8. Privilegios de lo nuevo

Ninguna tabla nueva ⇒ ninguna RLS ni política nueva. Lo que **sí** hubo que
hacer es desarmar los defaults permisivos de Supabase.

### 8.1 La vista es una relación, y la lección del TRUNCATE aplica

`pg_default_acl` de este proyecto le da a `anon` y `authenticated` los
privilegios `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) sobre **cada
relación nueva** de `public`, y una vista **es** una relación: aparece en
`information_schema.role_table_grants` igual que una tabla.

Es el mismo agujero que `20260813050000_recordatorios_turnos.sql` §3 documenta
para las tablas. Sin el `revoke`, el caso *"Privilegios de anon sobre tablas de
public"* de `scripts/test-rls.sql` —que exige 0— se pondría en rojo apenas se
aplique la migración.

```sql
revoke all    on public.v_medicacion_estado from anon, authenticated;
grant  select on public.v_medicacion_estado to   authenticated, service_role;
```

### 8.2 Las funciones

```sql
revoke execute on function public.registrar_toma(uuid)        from public;
revoke execute on function public.revertir_toma(uuid)         from public;
revoke execute on function public.generar_tomas_del_dia(date) from public;

grant  execute on function public.registrar_toma(uuid)        to authenticated, service_role;
grant  execute on function public.revertir_toma(uuid)         to authenticated, service_role;
grant  execute on function public.generar_tomas_del_dia(date) to service_role;
```

`generar_tomas_del_dia` **no** va para `authenticated`: recorre todos los
perfiles de la base y esa no es una operación de sesión de usuario. Las tres
llevan `SET search_path = ''`, que es lo que exige el lint
`function_search_path_mutable` de Supabase y lo que vigila el caso *"Funciones de
public sin search_path fijado"* del arnés.

---

## 9. Contrato para las tareas 7.2 a 7.5

### 7.2 — ABM de medicación con horarios

- **Leer:** `v_medicacion_estado` para la lista de activas (ya trae
  `dias_restantes` y `necesita_renovacion`); `medications` directo para el
  histórico de suspendidas.
- **Escribir:** `INSERT`/`UPDATE` normales sobre `medications` con las políticas
  de siempre — alta con `can_upload`, edición y suspensión con `can_manage`.
- **Suspender** es `is_active = false` **y** `suspended_at = now()`: el CHECK
  `medications_suspension_coherente` exige las dos cosas.
- **Los horarios** son `time[]`; `supabase-js` los entrega como
  `["08:00:00","20:00:00"]`, que es exactamente lo que consume el campo de chips
  de hora (ver `docs/modelo-datos.md` decisión 2).
- **Al dar de alta** una medicación `daily` o `interval_hours`, llamar a
  `generar_tomas_del_dia()` con `service_role` para que las tomas de **hoy**
  existan sin esperar a la medianoche.
- Correr `npm run types:gen`: la vista y los tres RPC todavía no están en
  `types/database.types.ts`.

### 7.3 — Registro de tomas y descuento de stock

- **Marcar:** `rpc('registrar_toma', { intake_id })`. Nunca un `UPDATE` directo
  a `medication_intakes` desde la app: perdería el descuento de stock y la
  atomicidad.
- **Deshacer:** `rpc('revertir_toma', { intake_id })`, y ofrecer el botón solo
  para tomas de hoy —el RPC lo va a rechazar igual, pero un botón que siempre
  falla es peor que no tenerlo—.
- **Errores esperables y qué mostrar:**

  | SQLSTATE | Causa | Mensaje sugerido |
  |---|---|---|
  | `42501` | Sin `can_upload` sobre el perfil | "No tenés permiso para registrar tomas en este perfil" |
  | `22023` | Ya registrada / fuera de ventana / no es de hoy | El mensaje del RPC ya está redactado en español y es mostrable tal cual |

- Después de registrar, releer `v_medicacion_estado` para refrescar el stock y
  los días restantes de la tarjeta.

### 7.4 — Alerta preventiva de renovación

- La condición es **una columna**, no una fórmula reimplementada:
  `select * from v_medicacion_estado where necesita_renovacion`.
- El umbral (5 días) vive en la vista. Cambiarlo es una migración, no un
  `find & replace`.
- Los destinatarios se resuelven con `public.destinatarios_de_avisos(profile_id)`,
  igual que los recordatorios de turnos (`docs/recordatorios.md` §"Quién
  recibe"): titular + `can_manage`, nunca un `can_view`.
- La antiduplicación de 48 hs necesita su propia tabla de infraestructura, con
  el mismo patrón `UNIQUE` + `ON CONFLICT DO NOTHING` de
  `appointment_reminders`. **No** alcanza con mirar `updated_at`.
- Ojo con `stock_units IS NULL`: `necesita_renovacion` es `false` y no dispara
  nada. Es correcto —no se puede alertar sobre un stock que nadie cargó— pero
  conviene que la interfaz invite a cargarlo.

### 7.5 — Vinculación de la receta

- `medications.prescription_document_id` ya existe, con
  `ON DELETE SET NULL`: borrar la receta no borra la medicación.
- La vista lo expone, así que la tarjeta no necesita un `JOIN` extra para saber
  si hay receta.
- El archivo sigue las reglas de siempre: bucket privado y signed URL de vida
  corta (`docs/modelo-permisos.md` §7.4).

---

## 10. Cómo se verifica

`scripts/test-rls.sql`, **BLOQUE 11** — 30 casos, corridos contra la base local
con sesiones simuladas reales:

```bash
npx supabase db reset
docker exec -i supabase_db_historialclinico psql -U postgres -d postgres \
    -v ON_ERROR_STOP=1 < scripts/test-rls.sql
```

Qué cubre:

- **La aritmética:** `daily` con 2 horarios (30 días), `interval_hours` cada
  8 hs (20 días), `as_needed` (todo `NULL`), stock 0 (0 días y alerta
  encendida), suspendida (no aparece), y los datos **reales de
  `supabase/seed.sql`** (Glucophage 120/2 = 60 días, Enalapril 90/1 = 90 días).
- **`registrar_toma`:** descuenta y marca; el doble registro se rechaza; una
  toma de hace 30 hs queda fuera de la ventana; con stock 0 se registra igual y
  `dose_units` queda `NULL`.
- **`revertir_toma`:** el mismo día restituye el stock exacto; la de ayer se
  rechaza.
- **Los permisos:** `can_view` no registra (`42501`); `can_upload` sí registra
  por el RPC **y sigue sin poder editar `medications` por la vía directa** —que
  es la nota ⑨ demostrada en las dos direcciones.
- **`generar_tomas_del_dia`:** materializa la grilla de cada esquema, no toca
  `as_needed` ni las suspendidas, y la segunda corrida crea **0** filas.
- **La superficie:** `anon` no lee la vista, `authenticated` no ejecuta el
  generador, y el job aparece en `cron.job`.

El bloque es autolimpiante: usa un perfil gestionado propio y una fecha
sintética lejana (2099-06-15) para la grilla, y borra ambos al terminar.

---

## 11. Límites conocidos

1. **No hay estado `missed`.** Una toma que nadie marcó se queda en `pending`
   para siempre. Marcarlas como perdidas requiere decidir a partir de cuánto
   tiempo —y esa decisión tiene consecuencias clínicas—, así que se deja para
   cuando haya uso real. Mientras tanto la ventana de ±12 hs alcanza para que
   las viejas no sean registrables por accidente.
2. **Deshacer un `skipped` requiere `can_manage`** (§6).
3. **El generador es diario, no por medicación.** Una medicación creada a las
   10 de la mañana no tiene tomas hasta que alguien llame a
   `generar_tomas_del_dia()`; por eso 7.2 debe llamarlo al dar de alta.
4. **`fecha_estimada_fin` proyecta desde hoy** al ritmo actual: no contempla que
   el tratamiento tenga un `end_date` anterior ni que todavía no haya empezado.
   `vigente_hoy` está para que la interfaz distinga esos casos.
5. **Los intervalos que no dividen a 24** tienen una toma menos por día en la
   grilla que la que proyecta la vista (§7.3). Documentado y acotado a
   intervalos que el producto no usa.
