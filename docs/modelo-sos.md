# Modelo de la ficha SOS: dónde viven los datos vitales

> Sprint 8, tarea 8.2. **Sin migración propia**: los datos SOS ya existen desde
> `supabase/migrations/20260812200000_schema_inicial.sql` §4.1. Permisos:
> `docs/modelo-permisos.md` §6 (fila `profiles`, nota ②). Decisión de modelado:
> `docs/modelo-datos.md` §3.10.
>
> Este documento es la **fuente de verdad del contrato** que consumen las tres
> tareas siguientes del sprint: la ficha de lectura (8.3), el payload offline
> (8.4) y el indicador de frescura (8.5). Si el SQL y este documento se
> contradicen, gana el SQL y este archivo se corrige.

---

## 1. La decisión: ocho columnas en `profiles`, no una tabla `emergency_info`

El roadmap dejaba la puerta abierta a las dos opciones. **Se ratifica la de
columnas dedicadas en `profiles`**, que es la que el esquema inicial ya aplicó.

Los tres motivos, en orden de peso:

1. **Son 1:1 con la persona, sin excepción.** Nadie tiene dos grupos
   sanguíneos ni dos fichas de emergencia. Una tabla aparte modelaría una
   cardinalidad que no existe, y el precio de modelar de más se paga en cada
   lectura.

2. **Se leen siempre juntos, y en el peor escenario posible.** La ficha SOS no
   se abre "a veces": se abre en modo avión, con una mano, con alguien apurado
   mirando la pantalla. Un `JOIN` a `emergency_info` agrega en ese camino
   crítico un caso nuevo —**la fila que no existe**— que hay que manejar en el
   servidor, en el cliente, en el service worker y en el JSON cacheado. Con
   columnas en `profiles` ese caso simplemente no puede ocurrir: si hay perfil,
   hay ficha (posiblemente vacía, que es distinto de ausente).

3. **La marca de frescura ya vive ahí.** `sos_updated_at` y su trigger
   `set_sos_updated_at` están sobre `profiles`. Mudar los datos a otra tabla
   obligaría a mudar el trigger o a sincronizar dos marcas de tiempo, que es
   precisamente el tipo de duplicación que termina mintiéndole al indicador de
   "datos actualizados el ...".

**Lo que se pierde** (y se acepta a conciencia): `profiles` queda con 20
columnas, y una ficha SOS histórica —"qué decía la ficha en marzo"— no es
posible sin una tabla de versiones. Ninguna de las dos cosas es un problema
real acá: `profiles` es una tabla chica y de lectura constante, y la ficha SOS
es por definición **el estado actual**; una versión vieja de una ficha de
emergencia no tiene ningún uso clínico, tiene un uso de auditoría, y para eso
está `access_logs`.

**Lo que NO cambia esta decisión:** que los datos vivan en `profiles` no los
hace menos sensibles. Se rigen por las mismas políticas de la fila (§3) y por
el mismo criterio de minimización (§7).

---

## 2. Inventario exacto de campos

Las ocho columnas SOS de `public.profiles`
(`20260812200000_schema_inicial.sql` §4.1). "Regla de base" es lo que
PostgreSQL hace cumplir por sí solo; "regla de app" es lo que valida
`lib/validacion/sos.schema.ts` y **nadie más**.

| Columna | Tipo | Regla de base | Regla de app | En la ficha (8.3) |
|---|---|---|---|---|
| `blood_type` | `text` NULL | `profiles_blood_type_valido`: NULL o uno de `A+ A- B+ B- AB+ AB- O+ O-` | Enum Zod con **los mismos ocho** valores; `""` → NULL | Sí, arriba de todo |
| `allergies` | `text[]` NOT NULL DEFAULT `'{}'` | Tipo y default | Ítems trimeados, no vacíos, sin duplicados (sin distinguir mayúsculas), ≤ 120 caracteres c/u, ≤ 30 ítems | Sí, destacadas |
| `chronic_conditions` | `text[]` NOT NULL DEFAULT `'{}'` | Ídem | Ídem | Sí |
| `critical_medication` | `text[]` NOT NULL DEFAULT `'{}'` | Ídem | Ídem | Sí |
| `emergency_contact` | `text` NULL | — | ≤ 120 caracteres; **obligatorio si hay teléfono o vínculo** | Sí |
| `emergency_contact_phone` | `text` NULL | — | Dígitos y separadores visuales (`+ ( ) . -` y espacio), 6 a 20 caracteres, ≥ 6 dígitos | Sí, como enlace `tel:` |
| `emergency_contact_relationship` | `text` NULL | — | ≤ 60 caracteres | Sí, junto al nombre |
| `sos_notes` | `text` NULL | — | ≤ 2000 caracteres | Sí, al final |
| `sos_updated_at` | `timestamptz` NULL | Lo escribe **solo** el trigger | La app **nunca** lo escribe | Como sello de frescura (§6) |

### 2.1 Por qué los tres arrays son `NOT NULL DEFAULT '{}'`

Para que la ficha nunca tenga que distinguir `NULL` de `{}`. Son dos formas de
"no hay nada" que en una pantalla de emergencia se leen igual y en el código se
tratan distinto; el default elimina la mitad de los `?? []` del proyecto y, con
ellos, la posibilidad de un `.map` sobre `null` en la única pantalla donde una
excepción no tiene reintento posible.

### 2.2 Por qué `text[]` y no un texto con comas

`"Alergia a la penicilina, con shock anafiláctico"` es **una** alergia. Un
campo de texto libre partido por comas la convertiría en dos entradas falsas, y
la lista es exactamente lo que alguien va a leer en voz alta en una guardia. Por
eso la carga es por **chips** (`components/sos/formulario-sos.tsx`), el mismo
patrón que los horarios de medicación: obliga a decidir dónde termina cada ítem
en el momento de escribirlo, no después.

### 2.3 Por qué el teléfono no se valida contra el plan de numeración argentino

Porque las formas reales en que la gente escribe un teléfono en Argentina
—`+54 9 2901 612345`, `02901 15-612345`, `(02901) 612345`, `2901612345`— son
demasiadas, y **rechazar un número correcto es peor que aceptar uno raro**: el
costo de un falso rechazo es que la ficha se guarde sin contacto de emergencia.
La validación es de forma (caracteres y largo), no de semántica. `tel:` acepta
separadores visuales (RFC 3966 §3), así que el enlace de la ficha funciona con
cualquiera de esas formas.

### 2.4 La única regla cruzada: teléfono o vínculo exigen nombre

No tiene contraparte en la base, a propósito. Un teléfono sin nombre produce
"Llamar a — (hija)" en la ficha: quien atiende no sabe a quién pidió. El
nombre solo, en cambio, sí sirve —identifica a quién buscar—, así que la regla
es unidireccional.

### 2.5 Guardar la ficha vacía es válido

No es un formulario incompleto: es "esta persona no tiene alergias conocidas",
que es información. Y vaciar un campo que dejó de ser cierto ("ya no toma
anticoagulantes") es una edición legítima que **tiene que persistir**. Por eso
`guardarFichaSos` escribe **las ocho columnas siempre**, nunca un `PATCH` de lo
que cambió: un update parcial dejaría el dato viejo vivo justo en la pantalla
donde algo desactualizado hace más daño.

---

## 3. Permisos: los de la fila de `profiles`, sin excepción

Los datos SOS **no tienen políticas propias**. Son columnas, y RLS opera por
fila: heredan literalmente lo que dice `docs/modelo-permisos.md` §6 para
`profiles`.

| Operación | Predicado | Política |
|---|---|---|
| **Leer** la ficha | `puede_ver_perfil(id)` — titular, `can_view`, `can_upload` o `can_manage` | `profiles_select_visible` |
| **Editar** la ficha | `puede_administrar_perfil(id)` — titular o `can_manage` | `profiles_update_administrador` (nota ②) |

**`can_upload` no alcanza para editar, y eso es deliberado.** Quien puede
*agregar* un estudio no puede *reescribir* el grupo sanguíneo de otra persona.
La ficha SOS es lo que un paramédico va a leer sin poder preguntarle a nadie:
sobreescribirla es administración, no carga.

En la aplicación:

- `app/(app)/(con-nav)/perfil/sos/page.tsx` redirige a `/inicio` si no hay
  `canManage`. Es guarda de **interfaz**.
- `app/(app)/(con-nav)/perfil/sos/actions.ts` llama a
  `requerirPermiso(perfilId, "manage")`, que ejecuta la **misma función**
  `puede_administrar_perfil` que usa la política. No es una segunda opinión: es
  un espejo, para que app y base no puedan divergir.
- RLS es la última palabra. Si alguien saltea las dos guardas, el `UPDATE`
  afecta **cero filas** —no da error—, y por eso la acción usa
  `count: "exact"`: sin ese conteo, "cero filas" se mostraría como un guardado
  exitoso que no guardó nada.

Verificado con sesiones simuladas en `scripts/test-rls.sql`, BLOQUE 13 (§8).

---

## 4. Qué NO entra en la ficha SOS

### 4.1 El teléfono del titular (`profiles.phone`) — fuera

No le sirve a nadie: quien está leyendo la ficha tiene el teléfono de esa
persona en la mano. El número útil en una emergencia es el del **contacto**, y
ese tiene su propia columna.

### 4.2 El DNI (`profiles.national_id`) — **sí entra**, y es una decisión de esta tarea

Es el punto que el roadmap dejó explícitamente abierto. La decisión es
**incluirlo**, en solo lectura, y conviene dejar escrito el razonamiento porque
choca de frente con el comentario de la propia columna en el esquema ("dato
identificatorio: se excluye del contexto que se envía a la IA").

**No son la misma regla porque no son la misma amenaza.**

- La exclusión del contexto de IA es **minimización frente a un tercero**
  (Ley 25.326, art. 4 inc. 1; `docs/modelo-permisos.md` §9.1): el DNI no
  aporta nada al análisis clínico que hace Gemini, así que mandarlo sería
  entregar un identificador a un procesador externo a cambio de cero valor.
  Esa exclusión **se mantiene sin cambios**.
- La ficha SOS es **el titular y quienes él autorizó, mirando su propia
  pantalla**. No hay tercero. Y para llegar a la ficha hace falta una sesión
  iniciada en la app, la misma sesión que ya puede ver todo el historial
  clínico —incomparablemente más sensible que un número de documento—. El
  riesgo marginal de mostrar el DNI ahí es prácticamente nulo.

Del otro lado del balance hay un beneficio concreto y argentino: en la
ventanilla de una guardia lo primero que piden es el DNI, y la persona puede
estar inconsciente, confundida o sin la billetera encima. Es exactamente el
mismo motivo por el que la credencial de la obra social está en la app.

**La condición que hace válida a esta decisión** —y que la tarea 8.3 tiene que
respetar— es que la ficha SOS **no sea accesible sin sesión**: nada de pantalla
de bloqueo, nada de URL pública, nada de "modo emergencia" sin autenticar. Si
alguna vez se quiere una ficha accesible con el teléfono bloqueado, el DNI es
**el primer campo que hay que sacar**, y esta sección hay que reabrirla.

### 4.3 La cobertura principal — entra, pero **no se copia**

Sale de `insurance_cards` con `is_primary = true` (tarea 8.1). No hay ninguna
columna de cobertura en `profiles` y no debe agregarse: sería un dato duplicado
que se desactualiza en silencio, y el índice parcial
`insurance_cards_una_principal_idx` ya garantiza que hay a lo sumo una por
perfil. Es el **único** dato de la ficha SOS que vive fuera de `profiles`, y por
eso `/perfil/sos` lo muestra en solo lectura con un enlace a `/coberturas`: para
que quede claro dónde se cambia.

---

## 5. Contrato de LECTURA para la ficha SOS (tarea 8.3)

Dos consultas, ambas filtradas por RLS. No hace falta `requerirPermiso("view")`
extra: `obtenerPerfilActivo()` ya lo hizo y **ya trae la fila entera de
`profiles`** (`select("*")`, memoizada con `cache()` por request), así que las
ocho columnas SOS están en memoria sin ningún viaje adicional.

```ts
// 1. La ficha: ya viene en el perfil activo, sin consulta nueva.
const { perfil } = await obtenerPerfilActivo()   // null → redirect("/perfiles")

// 2. La cobertura principal: la única consulta propia.
const { data: coberturaPrincipal } = await supabase
  .from("insurance_cards")
  .select("provider, plan, member_number, front_storage_path, back_storage_path")
  .eq("profile_id", perfil.id)
  .eq("is_primary", true)
  .maybeSingle()                                  // puede no haber ninguna
```

Reglas de presentación que la ficha debe cumplir:

| Situación | Qué muestra la ficha |
|---|---|
| `blood_type IS NULL` | **"Grupo sanguíneo: no registrado"**. Nunca en blanco ni con un guion suelto: la ausencia tiene que leerse como ausencia, no como algo que se pasó por alto |
| Array vacío | "Sin alergias registradas" (y equivalentes). **"Registradas" no es adorno**: no afirma que no tenga alergias, afirma que nadie cargó ninguna |
| Sin contacto de emergencia | Se omite el bloque entero, no se muestra un botón de llamar inerte |
| Sin cobertura principal | Se omite el bloque |
| `sos_updated_at IS NULL` | "Todavía no se cargó ningún dato vital" (ver §6) |

El teléfono va en un `<a href="tel:...">`. **No se normaliza el número**: se usa
tal como fue guardado. `tel:` tolera separadores visuales, y "arreglar" el
número es la forma más fácil de romper una llamada que funcionaba.

---

## 6. `sos_updated_at`: qué significa y qué NO significa (tarea 8.5)

Es **cuándo se editó por última vez algún dato vital**. Lo escribe el trigger
`set_sos_updated_at` (`20260812200000` §3) y **solo** cuando alguna de las ocho
columnas cambió de verdad: corregir el `full_name` o subir un avatar no lo
mueven. Ese acotamiento es el motivo entero de que la columna exista en vez de
usar `updated_at` —si dependiera de `updated_at`, cambiar un teléfono haría
parecer que los datos vitales se revisaron cuando no fue así— y está verificado
en el BLOQUE 13 del arnés RLS.

**`NULL` significa "nunca se cargó ningún dato SOS".** No es "hoy" ni la fecha
de creación del perfil. Mostrar cualquiera de esas dos cosas le haría creer a
quien lee la ficha que los datos fueron revisados cuando nunca existieron.

### 6.1 Son DOS marcas de tiempo distintas, y confundirlas es el error a evitar

El indicador de la tarea 8.5 tiene que distinguirlas, porque responden a
preguntas diferentes:

| Marca | Pregunta que responde | De dónde sale |
|---|---|---|
| `sos_updated_at` | *¿Hace cuánto que un humano revisó estos datos?* | La columna |
| `generado_at` | *¿Hace cuánto que este dispositivo bajó esta copia?* | Lo estampa el endpoint al armar el payload (§7) |

Una ficha puede estar **fresca de cache y vieja de contenido** (se sincronizó
hace un minuto, pero nadie toca las alergias desde 2024) o al revés (se editó
esta mañana desde otro teléfono, pero este viene sin señal desde ayer). El
indicador tiene que poder decir las dos cosas:

- Copia local: *"Datos guardados en este dispositivo el 12/08 14:30"* →
  `generado_at`.
- Contenido: *"Última revisión de los datos vitales: 03/04/2026 09:12"* →
  `sos_updated_at`.

El formato es uno solo para las tres pantallas y vive en
`lib/sos/frescura.ts#formatearRevisionSos` → `"12/08/2026 14:30"`, hora de
Ushuaia, 24 horas, `null` si nunca hubo revisión. **No armar otro
`Intl.DateTimeFormat`**: tres pantallas mostrando la misma revisión con tres
formatos distintos es un bug de confianza, no de estilo.

---

## 7. Contrato del PAYLOAD OFFLINE (tarea 8.4)

`app/api/sos/[perfilId]/route.ts` devuelve el JSON que el service worker
cachea. Forma propuesta —los nombres son parte del contrato, porque el
service worker los va a leer de una copia vieja después de un deploy—:

```jsonc
{
  "version": 1,                       // sube si cambia la forma; el SW descarta lo que no entiende
  "generado_at": "2026-08-14T17:30:00.000Z",   // cuándo se armó ESTA copia (§6.1)
  "perfil": {
    "id": "uuid",
    "nombre_completo": "Roberto Gómez",
    "documento": "12345678",          // profiles.national_id — ver §4.2
    "fecha_nacimiento": "1948-03-02"  // la edad orienta una dosis; el dato ya está en profiles
  },
  "vitales": {
    "grupo_sanguineo": "O+",          // null si no se sabe
    "alergias": ["Penicilina"],       // siempre array, nunca null
    "condiciones_cronicas": ["Hipertensión arterial"],
    "medicacion_critica": ["Acenocumarol 4 mg"],
    "observaciones": "Marcapasos desde 2019.",  // null si no hay
    "actualizado_at": "2026-04-03T12:12:00.000Z"  // profiles.sos_updated_at, null si nunca
  },
  "contacto_emergencia": {            // null entero si no hay contacto cargado
    "nombre": "María Gómez",
    "telefono": "+54 9 2901 612345",
    "vinculo": "hija"
  },
  "cobertura_principal": {            // null si no hay ninguna con is_primary
    "proveedor": "OSDE",
    "plan": "210",
    "numero_afiliado": "61234567801"
  }
}
```

Reglas duras del payload:

1. **Nada de URLs firmadas adentro.** Las imágenes de la credencial se cachean
   como recursos aparte (estrategia cache-first de 8.4); una signed URL vive
   minutos y este JSON tiene que seguir sirviendo en modo avión dentro de una
   semana.
2. **Los arrays son siempre arrays.** Nunca `null`, nunca ausentes. Es la misma
   garantía que da el `NOT NULL DEFAULT '{}'` de la base y no hay motivo para
   perderla al serializar.
3. **`generado_at` lo estampa el servidor**, nunca el cliente: es la única
   forma de que "hace cuánto bajé esto" no dependa del reloj del teléfono.
4. **Un payload por perfil.** El endpoint lleva `perfilId` en la ruta y exige
   `puede_ver_perfil` como cualquier otra lectura: una hija que administra dos
   perfiles necesita las dos fichas cacheadas por separado, y cachear "la ficha
   del perfil activo" en una sola clave le mostraría la de su papá cuando
   quería la de su mamá.
5. **Es una vista de LECTURA.** No hay `POST` a este endpoint: editar la ficha
   sin conexión no está en el alcance del sprint, y una edición offline de datos
   vitales que se sincroniza tarde y pisa una edición más nueva es peor que no
   poder editar.

---

## 8. Cómo se verifica

```bash
# Arnés RLS completo (BLOQUE 13 = ficha SOS). 176 casos, todos PASS.
docker exec -i supabase_db_historialclinico \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/test-rls.sql

# Validación de entrada (grupo sanguíneo, teléfono, tildes, límites).
npm run test -- sos-schema sos-frescura
```

El BLOQUE 13 del arnés cubre, con sesiones simuladas
(`set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE authenticated`):

| Caso | Qué demuestra |
|---|---|
| `B (can_view) lee las OCHO columnas SOS` | El `can_view` ve la ficha entera de un perfil gestionado |
| `B (can_view) cambia el GRUPO SANGUÍNEO` → 0 filas | El `can_view` no escribe **ninguna** columna SOS |
| `B (can_view + can_upload) escribe las OBSERVACIONES` → 0 filas | `can_upload` tampoco alcanza |
| `A (can_manage) edita la ficha SOS completa` → 1 fila | El administrador sí |
| `Ida y vuelta UTF-8 de la ficha completa` | `"Alergia a penicilína, ñoquis"` vuelve idéntica |
| `La alergia con coma quedó como UN solo elemento` | El `text[]` no se parte por comas |
| `sos_updated_at se movió al editar la ficha` | El trigger dispara |
| `Editar full_name NO mueve sos_updated_at` | Y solo dispara con datos SOS |
| `UPDATE crudo con grupo sanguíneo inválido` → 23514 | El CHECK sostiene solo, sin la app |
| `Los 8 grupos del CHECK se aceptan` | Y no es demasiado estrecho |
| `B REVOCADO ya no lee la fila` | El criterio de aceptación del roadmap, completo |

Los casos preexistentes que ya cubrían la parte general y que el BLOQUE 13 no
repite: BLOQUE 1 (`B lee la fila de profiles de A` → 0 filas sin permiso),
BLOQUE 2 (`B lee la ficha SOS de A` → 1 fila; `B EDITA el perfil de A` → 0
filas) y BLOQUE 6 (`anon lee profiles` → denegado 42501, una barrera **anterior**
a RLS: `anon` no tiene ni el privilegio de `SELECT`).

---

## 9. Límites conocidos

1. **Sin historial de la ficha.** No se sabe qué decía en marzo. Decisión
   consciente (§1); si alguna vez hace falta, es una tabla de versiones nueva y
   no un cambio a lo de acá.
2. **Sin campo de "confirmado por un profesional".** Todo lo que hay es
   autodeclarado. La ficha no debe insinuar validación clínica en ninguna
   redacción: por eso "sin alergias **registradas**" y no "sin alergias".
3. **La medicación crítica se carga a mano y puede divergir de `medications`.**
   Es a propósito —el comentario de la columna lo dice: "es una copia legible
   offline; la fuente de verdad operativa es la tabla `medications`"—, pero
   nadie avisa cuando divergen. Candidato natural a una mejora futura: sugerir
   en el formulario las medicaciones activas del perfil.
4. **La regla "teléfono exige nombre" solo vive en la app** (§2.4). Una
   escritura por fuera de la aplicación puede dejar un teléfono huérfano; la
   ficha tiene que tolerarlo sin romperse.
