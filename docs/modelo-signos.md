# Modelo de signos vitales: umbrales clínicos y alertas

> Sprint 9, tarea 9.2. Migración: `supabase/migrations/20260814080000_signos_umbrales.sql`.
> Tabla base: `20260812200000_schema_inicial.sql` §4.9 (`vital_signs`). Permisos:
> `docs/modelo-permisos.md` §4.3 y §6.1. Carga rápida (9.1):
> `app/(app)/(con-nav)/signos/`.
>
> **Fuente de verdad única** de los umbrales, del motor de evaluación y del
> contrato que consumen las tareas 9.3 (notificación y banner) y 9.4 (historial
> y gráficos). Si este documento y el SQL se contradicen, gana el SQL y este
> archivo se corrige.

---

## 1. Lo que ya existía y lo que se agregó

`vital_signs` está desde el esquema inicial y **esta migración no la toca**: la
medición se guarda igual que antes, con sus `CHECK` de plausibilidad
(`vital_signs_sistolica_plausible` 50–300, `vital_signs_diastolica_plausible`
30–200, `vital_signs_sistolica_mayor_diastolica`, `vital_signs_pulso_plausible`
20–250, `vital_signs_valor_positivo`) y sus políticas de la matriz.

Lo que se agrega son tres piezas:

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| `vital_sign_thresholds` | migración §2 | Los umbrales, con defaults globales y una fila **opcional** por perfil |
| `vital_sign_alerts` | migración §3 | Una fila por **regla violada** por una medición. Fuente del banner y del push de la 9.3 |
| El motor | `lib/signos/evaluar.ts` + `lib/signos/umbrales.ts` | TypeScript **puro**: decide qué reglas viola una medición y qué texto le corresponde |

Y una cuarta que las conecta: `lib/signos/registrar-alertas.ts`, el módulo
`server-only` que `registrarSigno` llama después del `INSERT`.

---

## 2. Plausibilidad ≠ peligro

Es la distinción que ordena todo lo demás.

| Capa | Qué rechaza | Dónde |
|---|---|---|
| **Plausibilidad** | Una sistólica de 500, un peso de −3, una diastólica mayor que la sistólica. Son **errores de carga**. | `lib/validacion/signo.schema.ts` (Zod) **y** los `CHECK` de `vital_signs` |
| **Peligro** | Una sistólica de 170. Es un **dato correcto que preocupa**. | `lib/signos/evaluar.ts` |

Las dos capas no se solapan a propósito. Si el motor de umbrales además
validara plausibilidad habría dos definiciones del rango válido, y el día que
una cambiara sin la otra la app rechazaría cargas legítimas o guardaría basura.
**Un valor imposible nunca llega al motor**: lo frena Zod antes del viaje de red
y lo frenaría el `CHECK` en la base.

Corolario para quien lea los tests: el caso "valor imposible" del criterio de
aceptación del ROADMAP se prueba en `tests/unit/umbrales.test.ts` demostrando
que `validarSigno` lo rechaza, no que `evaluarSigno` lo rechace.

---

## 3. Los umbrales

### 3.1 Las seis columnas y sus defaults

| Columna | Default | De dónde sale el número |
|---|---|---|
| `sistolica_max` | **160** mmHg | Hipertensión grado 2 en la clasificación ESC/ESH. Es el `16` del `16/10` del ROADMAP |
| `diastolica_max` | **100** mmHg | El `10` del mismo par |
| `glucemia_min` | **70** mg/dL | El *alert value* de hipoglucemia de la ADA |
| `glucemia_max` | **250** mg/dL | Zona en la que la guía habitual ya indica control de cetonas |
| `peso_variacion_kg` | **2,0** kg | Ver [§4](#4-la-regla-de-peso-argumentada) |
| `peso_ventana_dias` | **7** días | Ídem |

Los mismos seis números están en `lib/signos/umbrales.ts#UMBRALES_POR_DEFECTO`.

### 3.2 La fila es opcional, y eso es el diseño

**Sin fila rigen los defaults globales** —hoy, el caso de todos los perfiles— y
la base ni siquiera se consulta para decidirlo: `combinarUmbrales(null)`
devuelve los defaults. La ausencia de fila *es* el dato: "nadie personalizó esto
todavía".

Materializar una fila por perfil habría exigido un trigger sobre `profiles`, un
backfill, y —lo peor— habría congelado los defaults del día en que se creó cada
perfil. Con la fila opcional, mejorar un default alcanza a todos los perfiles no
revisados y deja intactos los que un médico ajustó.

### 3.3 Las columnas son `NOT NULL`: no hay override parcial por columna

La alternativa era columnas nullable (`NULL` = "usá el default de esa columna").
Se descartó porque los `CHECK` de coherencia dejan de ser evaluables dentro de
la fila: `glucemia_min < glucemia_max` no se puede comprobar si uno de los dos
es `NULL`, y la base admitiría un perfil con `glucemia_min = 300` heredando
`glucemia_max = 250` — que dispara las dos alertas de glucemia a la vez para los
valores del medio.

Con `NOT NULL` + `DEFAULT`, la ergonomía del override parcial se conserva
igual:

```sql
insert into public.vital_sign_thresholds (profile_id, sistolica_max)
values ('…', 150);   -- las otras cinco columnas quedan en su default
```

…y **cada** coherencia se verifica dentro de la fila.

### 3.4 La doble fuente, y cómo no diverge

Los seis números viven dos veces: en el `DEFAULT` de las columnas (para que un
`INSERT` parcial sea coherente) y en `lib/signos/umbrales.ts` (para el caso "no
hay fila"). No hay forma de expresar una sola fuente cruzando SQL y TypeScript,
así que la divergencia se cubre con una **prueba**: `scripts/test-rls.sql`
BLOQUE 14 inserta una fila con solo el `profile_id` y verifica que las seis
columnas queden en `160 / 100 / 70 / 250 / 2 / 7`. Cambiar un lado sin el otro
pone el arnés en rojo.

### 3.5 Quién lee y quién edita

| Operación | Predicado | Por qué |
|---|---|---|
| `SELECT` | `puede_ver_perfil` (titular, `can_view`, `can_upload` o `can_manage`) | Quien carga mediciones necesita saber contra qué se comparan |
| `INSERT` / `UPDATE` / `DELETE` | `puede_administrar_perfil` (titular o `can_manage`) | Cambiar el umbral de alerta de una persona mayor es una decisión clínica, no "cargar el dato del día" |

Es la regla general de `docs/modelo-permisos.md` §6.1 sin ninguna excepción.

---

## 4. La regla de peso, argumentada

El ROADMAP pide "variación de peso significativa" y deja la regla abierta. La
elegida es:

> **|peso nuevo − mediana de los pesos de la ventana| ≥ `peso_variacion_kg`**,
> con la ventana = los `peso_ventana_dias` días **anteriores** a la medición
> nueva (extremo izquierdo inclusivo, derecho exclusivo).

Tres decisiones, cada una con su motivo:

1. **2 kg, no 3 ni 5.** La referencia clínica más difundida para insuficiencia
   cardíaca descompensada es "2 a 3 kg en pocos días", y el criterio conservador
   manda quedarse en el borde bajo: acá un falso positivo cuesta una mirada y un
   falso negativo puede costar una internación. Por debajo de 2 kg se empieza a
   competir con el ruido real de una balanza doméstica y de la hora del día.
2. **Contra la MEDIANA, no contra la última medición.** Un solo error de tipeo
   (78,5 tecleado como 7,85) envenena la referencia si se compara contra la
   última: la siguiente medición correcta dispararía una alerta falsa, y la
   anterior también. La mediana de la ventana aguanta un valor absurdo sin
   moverse. Con **una sola** medición previa la mediana *es* esa medición, así
   que la regla degrada exactamente a "contra la última" y nunca queda sin
   definir.
3. **Siete días, y en los dos sentidos.** Es el horizonte en el que 2 kg no
   pueden explicarse por composición corporal: o es líquido (retención) o es
   deshidratación / pérdida de masa. Las dos direcciones importan, así que la
   comparación es en **valor absoluto**.

**Sin ninguna medición en la ventana no hay regla.** La primera vez que alguien
se pesa no puede haber "variación", y afirmarla sería inventar un dato.

---

## 5. El borde: el umbral pertenece siempre al lado que alerta

El criterio de aceptación del ROADMAP lo pide explícito —*"16/10 exacto dispara
según la regla definida y queda documentado si el límite es inclusivo"*—. **Es
inclusivo**, y de forma **uniforme en las cinco reglas**:

| Regla | Dispara cuando | Con los defaults |
|---|---|---|
| `sistolica_alta` | `sistólica >= sistolica_max` | 160 dispara · 159 no |
| `diastolica_alta` | `diastólica >= diastolica_max` | 100 dispara · 99 no |
| `glucemia_baja` | `glucemia <= glucemia_min` | 70 dispara · 71 no |
| `glucemia_alta` | `glucemia >= glucemia_max` | 250 dispara · 249 no |
| `peso_variacion` | `\|Δ\| >= peso_variacion_kg` | 2,0 kg dispara · 1,9 no |

**Por qué uniforme.** La alternativa era la lectura literal del *ejemplo* del
ROADMAP ("sistólica ≥ 160 … glucemia < 70 o > 250"), que mezcla inclusivo para
presión y exclusivo para glucemia. Un motor con dos convenciones de borde es una
fábrica de errores off-by-one: a los seis meses nadie recuerda cuál columna era
cuál. Acá las columnas se llaman `max`/`min` porque son **umbrales de alerta**
—el primer valor que ya preocupa—, no los extremos del rango normal.

**Por qué inclusivo.** La asimetría del costo: un falso positivo cuesta que
alguien mire un número, un falso negativo cuesta que nadie lo mire. Y los
defaults acompañan la lectura: 70 mg/dL es literalmente el *alert value* de la
ADA (el valor **en** el que hay que actuar), y 250 mg/dL la zona de control de
cetonas.

**Quien necesite el corte exclusivo no necesita tocar código**: los umbrales son
por perfil, y un `glucemia_min` de 69 reproduce exactamente el "< 70".

Una nota sobre coma flotante: las comparaciones usan una tolerancia de 1e-9
(`EPSILON` en `evaluar.ts`) porque `64,1 − 62,1` da `1.999999999999993` en
binario. Sin ella, "2 kg exactos disparan" sería verdad o mentira según en qué
parte de la recta esté pesando la persona.

---

## 6. El motor

```
evaluarSigno(medicion, umbrales, historialPesoReciente?) → ReglaViolada[]
```

Puro: sin IO, sin Supabase, sin reloj. Devuelve **todas** las reglas violadas,
no la primera — 160/100 viola dos y son dos hechos distintos para quien atiende
(una sistólica alta con diastólica normal no es lo mismo que las dos altas).

`ReglaViolada` trae exactamente lo que se persiste: `regla`, `tipo`, `valor`
observado, `umbral` aplicado, `referencia` (solo peso) y `mensaje` ya redactado.

### 6.1 El descargo es una constraint, no una convención

*"Los umbrales son orientativos, no diagnóstico: el texto debe decirlo"*
(ROADMAP). Todo mensaje termina con:

> Valor orientativo — no reemplaza el criterio médico.

Y la base lo hace cumplir: `vital_sign_alerts_mensaje_con_descargo` exige el
fragmento `no reemplaza el criterio médico` dentro de `mensaje`. Un refactor de
copy que se lo olvide **no puede persistir la alerta**. El fragmento verificado
es el estable; la redacción de alrededor se puede mejorar sin una migración.

---

## 7. La alerta persistida

### 7.1 Una fila por regla, no por medición

`unique (vital_sign_id, regla)`. Alcanza un UNIQUE a secas —y no hace falta la
ventana deslizante de `medication_renewal_alerts`— porque el evento es
**discreto**: una medición ocurre una vez y su evaluación es determinista.
Reevaluar la misma medición no puede duplicar la alerta; dos cargas del mismo
valor son dos mediciones distintas y sí producen dos alertas, porque son dos
hechos clínicos distintos.

### 7.2 Se guarda redundante a propósito

`valor` y `umbral` son derivables, y sin embargo se persisten. Si mañana un
médico sube `sistolica_max` a 170, **la alerta de ayer tiene que seguir diciendo
que se disparó contra 160**. Un banner que recalcula contra los umbrales de hoy
reescribe el pasado, y `acknowledged_by` estaría firmando un texto que ya no
existe. `mensaje` sigue el mismo criterio llevado hasta el final: se guarda el
texto **que se mostró**, no los ingredientes para recomponerlo.

Es la misma familia de decisión que `medication_renewal_alerts.dias_restantes`.

### 7.3 `profile_id` lo sella la base

Es la columna que decide **qué familia ve la alerta**. El trigger
`vital_sign_alerts_sellar_perfil` la deriva de `vital_signs` ignorando lo que
traiga el `INSERT`: un bug de una línea en el módulo que escribe no puede
filtrar un dato de salud a otra familia. El arnés lo prueba insertando a nombre
de otro perfil y verificando que la base lo corrige.

---

## 8. Quién escribe las alertas: `service_role`, no el cliente

Se evaluó una política `INSERT` estrecha para `authenticated`
(`with check (public.puede_cargar_en_perfil(profile_id))`): la carga la hace
quien tiene `can_upload` y la alerta deriva de su propia medición. Se descartó
por tres motivos, en orden de peso:

1. **RLS autoriza autores, no verifica derivaciones.** La fila de alerta es una
   *afirmación sobre otra fila* ("la sistólica fue 170 y el umbral era 160").
   Ninguna política puede comprobar esa aritmética. Con `INSERT` desde el
   cliente, una sesión podría colgar de una medición de 120/80 una alerta que
   dice 300, con `created_at` y todo: un dato clínico falso con aspecto de
   rastro auditable. **Insertar una medición falsa no es equivalente**: queda a
   la vista en `/signos` y `can_manage` puede corregirla; una alerta falsa no la
   ve nadie hasta que suena el push.
2. **La tabla es un emisor de notificaciones a terceros.** La 9.3 convierte cada
   fila en un Web Push a todos los `can_manage` del perfil. Una política de
   `INSERT` le daría a cualquier `can_upload` un primitivo para notificar a la
   familia con el texto que quiera.
3. **Coherencia con la otra tabla de alertas.** `medication_renewal_alerts` ya
   tomó esta decisión y la escribió. Dos tablas de alerta con modelos de
   escritura opuestos serían una trampa para quien lea la segunda.

En consecuencia:

| Rol | Privilegio sobre `vital_sign_alerts` |
|---|---|
| `anon` | **ninguno** (`revoke all`, incluido el `TRUNCATE` que trae el default de Supabase) |
| `authenticated` | `SELECT` (política: titular o `can_manage`) + `UPDATE (acknowledged_at)` y nada más |
| `service_role` | todo |

Y **quien carga con `can_upload` no ve la alerta que su propia carga generó.**
Ve la medición —`vital_signs` es monótona en lectura— pero el escalamiento es
asunto de quien administra. Es `docs/modelo-permisos.md` §4.3 aplicado a la
tabla: quien no recibe el aviso tampoco ve la fila que lo generó.

---

## 9. El enganche: `registrarSigno` → `registrarAlertasDeSigno`

```
registrarSigno (Server Action, cliente del usuario)
   ├─ requerirPermiso(perfil, "upload")
   ├─ validarSigno(...)                       ← Zod: plausibilidad
   ├─ INSERT en vital_signs ... .select("id") ← CHECK de la base
   └─ try { registrarAlertasDeSigno(id) } catch { console.error }   ← BEST-EFFORT
          │  (lib/signos/registrar-alertas.ts, SERVICE_ROLE_KEY)
          ├─ relee la medición persistida
          ├─ lee vital_sign_thresholds del perfil (o defaults)
          ├─ si es peso: lee las últimas 30 mediciones anteriores
          ├─ evaluarSigno(...)                ← el motor puro
          └─ upsert en vital_sign_alerts, ignoreDuplicates
```

Tres propiedades del enganche, las tres deliberadas:

- **La carga nunca falla porque la evaluación falle.** Mismo contrato que
  `generarTomasDelDiaComoServicio()` en `crearMedicacion`. Una medición guardada
  sin su alerta es un problema; una medición que **no se guarda** porque la
  alerta falló es peor: la persona reintenta, no entiende el error y termina sin
  el dato.
- **Recibe un `id` y relee todo.** La alerta es un registro clínico sobre lo que
  quedó **persistido**, no sobre lo que había en memoria antes del viaje. De paso
  vuelve al módulo reutilizable por un backfill.
- **No es un trigger.** Un trigger convertiría un fallo de la evaluación en un
  fallo de la carga, que es exactamente la regla contraria. El precio, declarado:
  **la base no garantiza que toda medición fuera de umbral tenga su alerta.** Si
  la evaluación falla, quedan el log y la medición.

---

## 10. Contrato para la tarea 9.3 (notificación y banner)

Lo que la 9.3 encuentra ya hecho:

| Necesita | Dónde está |
|---|---|
| **De dónde lee el banner** | `select * from public.vital_sign_alerts where profile_id = :perfil and acknowledged_at is null order by created_at desc`. Sirve el índice parcial `vital_sign_alerts_sin_ver_idx` |
| **Qué mostrar** | `mensaje` — ya redactado, ya con el descargo. `regla` es un enum tipado en `types/database.types.ts` para el `switch` del ícono/color; `valor`, `umbral` y `referencia` están si el banner quiere componer otra cosa |
| **Qué significa `acknowledged`** | `acknowledged_at IS NULL` = el banner sigue visible. No hay estado intermedio ni cola de envío en esta tabla |
| **`marcarAlertaVista`** | `update public.vital_sign_alerts set acknowledged_at = <cualquier cosa no nula> where id = :id`. El trigger `vital_sign_alerts_sellar_visto` reemplaza el valor por `now()` y sella `acknowledged_by` con `perfil_actor()`. La política exige titular o `can_manage`; el privilegio de columna impide tocar cualquier otra cosa. **Una alerta ya vista no se puede "desver"**: el `UPDATE` no falla —para que la acción sea idempotente— pero no cambia nada |
| **Quiénes reciben el push** | `destinatarios_de_avisos(profile_id)` (`20260813050000_recordatorios_turnos.sql` §4.4), **la misma** función que usan los recordatorios de turnos y las alertas de renovación. Resuelve `perfil → family_permissions con can_manage → granted_profile_id → profiles.user_id → push_subscriptions activas`. Es exactamente el conjunto que la política de `SELECT` deja leer |
| **Enviar** | `enviarPushAUsuario()` de `lib/push/servidor.ts`, con su política de bajas 404/410 |

Lo que la 9.3 **tiene que decidir** (esta tarea no lo prejuzga):

- Si el envío es sincrónico dentro de `registrarSigno` o diferido por una cola.
  A diferencia de la renovación de receta, acá el evento es **inmediato y
  puntual** —el ROADMAP pide "menos de 30 segundos"—, así que la forma
  `pg_cron` + cola de las alertas de medicación probablemente **no** aplique. Si
  se elige diferir, esta tabla no tiene columnas de cola (`estado`,
  `claimed_at`, `sent_at`): habría que agregarlas en una migración propia, y la
  decisión quedaría documentada acá.
- El texto del **push** (título y cuerpo), que no es el mismo que el del banner:
  el push necesita el nombre de pila del perfil, como en
  `lib/medicacion/alertas.ts`. `mensaje` es la línea del banner.

### 10.1 Lo que la 9.3 decidió

- **Síncrono, dentro de `registrarSigno`.** `lib/signos/notificar.ts#notificarAlertasDeSigno`
  se llama inmediatamente después de `registrarAlertasDeSigno`, en la misma
  cadena de la Server Action, con su propio `try/catch` (best-effort: un push
  que falla no deshace la medición ni la alerta, ya guardadas). No se agregó
  ninguna columna de cola a `vital_sign_alerts` — el evento es puntual y el
  <30s del ROADMAP se verificó en un dispositivo real en **menos de 15
  segundos** (`docs/capturas/dispositivo-real/README.md`, sección de la 9.3).
- **UN push por carga, agrupando todas las reglas violadas.** 170/110 crea dos
  filas en `vital_sign_alerts` pero un solo `PayloadPush`:
  `lib/signos/notificar.ts#armarTextoAlertaSignos` arma "170/110 (umbral
  160/100)" cuando `sistolica_alta` y `diastolica_alta` llegan juntas, y un
  texto por-regla cuando llega una sola (tensión con una sola regla,
  glucemia, peso). `tag: signo-{vital_sign_id}` — no `alerta-{id}` — para que
  el reemplazo del lado del dispositivo opere por MEDICIÓN.
- **El texto del push no es `mensaje`.** Es propio de `notificar.ts`, más
  corto y agrupado; `mensaje` sigue siendo exclusivo del banner (una línea por
  regla, con el detalle completo).
- **Deep link: `/signos/enlace`**, calcado de `/medicacion/enlace` (Route
  Handler fuera de `/api`, mismos tres porqués). Cambia el perfil activo con
  `cambiarPerfilDesdeParametro` y redirige a `/signos`, donde vive el banner.
- **El banner vive en `/signos` Y `/inicio`** (`components/signos/banner-alerta.tsx`),
  no solo en `/signos`: el ROADMAP pide "banner persistente en la app" y
  `/inicio` es la primera pantalla que ve quien administra el perfil, aunque
  no haya entrado todavía a `/signos` esta sesión. Mismo query en las dos
  (`lib/signos/alertas-sin-ver.ts`), detrás de `activo.permisos.canManage`.
- **`marcarAlertaVista` es una sola acción, por alerta** — el artefacto que
  pide el ROADMAP —, y no redirige (a diferencia del resto de las Server
  Actions de `/signos`): el banner puede estar en `/signos` o en `/inicio`, y
  redirigir siempre a una de las dos rompería la otra. Con dos o más alertas
  sin ver, el banner agrega "Marcar todas como vistas", que invoca la MISMA
  acción una vez por `id` desde el cliente (`useTransition`, sin Server Action
  nueva) — decisión Senior UX documentada en el encabezado del componente.

---

## 11. Contrato para la tarea 9.4 (historial y gráficos)

- "Los valores fuera de umbral se marcan visualmente y con etiqueta textual":
  la marca sale de `vital_sign_alerts` por `vital_sign_id` —el índice único
  `(vital_sign_id, regla)` sirve el lookup—, **no** de recalcular contra los
  umbrales de hoy. Una medición vieja marcada contra el umbral de hoy contaría
  una historia que no pasó.
- "Rangos de referencia sombreados": ahí sí van los umbrales **actuales**
  (`combinarUmbrales` sobre la fila del perfil), porque la banda describe el
  criterio vigente, no el pasado.

---

## 12. Límites conocidos

1. **No cubre hipotensión ni bradicardia.** El ROADMAP enumera tres reglas y el
   alcance se respetó al pie. Una sistólica de 85 —relevante de verdad en una
   persona mayor, por el riesgo de caída— y un pulso de 40 **no disparan nada
   hoy**. Queda anotado para que nadie lea el silencio de la app como una
   validación: el descargo de cada alerta dice que es orientativa, y la ausencia
   de alerta lo es todavía más. Sumar `sistolica_min`, `diastolica_min` y
   `pulso_min`/`pulso_max` es una migración con `alter type … add value` sobre
   `vital_sign_alert_rule` y dos ramas en `evaluar.ts`.
2. **No hay evaluación retroactiva.** Las mediciones ya cargadas no reciben
   alertas por esta migración. El seed trae escritas a mano las dos de su
   presión 165/102 para que la 9.3 tenga un banner contra el cual desarrollar;
   si en algún momento hace falta un backfill,
   `registrarAlertasDeSigno(id)` ya sirve para eso tal como está.
3. **Cambiar un umbral no reevalúa el pasado**, y es a propósito (§7.2).
4. **La glucemia se asume en mg/dL y el peso en kg.** `vital_signs.unit` es
   texto libre y el motor no lo mira: una carga en mmol/L compararía contra
   umbrales de mg/dL. Hoy el formulario de la 9.1 no ofrece cambiar la unidad,
   así que no puede ocurrir desde la app; una carga por API sí podría.
5. **No hay historial de cambios de umbrales.** `vital_sign_thresholds` guarda
   el estado actual con `updated_at`; quién lo cambió y desde qué valor no se
   registra. Las alertas emitidas conservan el umbral que se les aplicó, que es
   lo que hace falta para leer el pasado.

---

## 13. Cómo se verifica

```bash
# Motor puro: 43 casos (normal, borde exacto 160/100, por encima, glucemia
# baja y alta, ventana y mediana de peso, valor imposible, descargo).
npm run test -- umbrales

# Armado del texto del push de la 9.3 (agrupación de reglas en un mensaje).
npm run test -- notificar-signos

# Base: 47 casos nuevos en el BLOQUE 14 (223 en total, todos PASS).
npx supabase db reset
docker exec -i supabase_db_historialclinico psql -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -f - < scripts/test-rls.sql
```

El BLOQUE 14 cubre lo que ningún test de TypeScript puede ejercitar: los `CHECK`
de coherencia de las dos tablas (incluido el del descargo), los dos triggers de
sellado, el antidup, el `CASCADE`, y la superficie expuesta en las dos
direcciones —`can_manage` lee y marca vista; `can_upload` no ve ni marca; `anon`
nada; `TRUNCATE` denegado; y nadie inserta una alerta desde el cliente—.
