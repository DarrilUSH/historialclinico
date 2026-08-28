# Tutorial de bienvenida — consejos contextuales de `/inicio` y `/ayuda`

> Tarea #14. Contrato de este subsistema: si vas a tocar un consejo nuevo, a
> cambiar el orden de prioridad, o a entender por qué "Ahora no" se comporta
> como se comporta, empezá por acá.

## 1. Qué es, en una frase

`/inicio` muestra, arriba de la grilla de accesos, **UN** consejo -el de
mayor prioridad entre los que siguen pendientes-, con un botón grande que
lleva a la función, y dos salidas: **"Ahora no"** (lo posterga hasta la
próxima sesión) y **"No mostrar más"** (lo descarta para siempre). Cada
consejo **desaparece solo** en cuanto la persona completa la función a la
que se refiere -nadie tiene que "marcarlo como hecho"-. `/ayuda` (el link
"¿Cómo empiezo?") muestra los seis siempre, con su estado real, ignorando
cualquier descarte.

## 2. Los seis consejos, en su orden de prioridad

El orden vive en un solo lugar: `CONSEJO_IDS` (`lib/consejos/tipos.ts`). El
ÍNDICE del array es la prioridad -0 es la más alta-, y toda la lógica de
selección (`lib/consejos/logica.ts#elegirConsejo`) recorre ese mismo array.

| # | id | Se muestra cuando... | CTA | Quién evalúa la condición |
|---|---|---|---|---|
| 1 | `instalar_app` | la PWA no corre instalada Y el viewport es de celular Y hay una señal utilizable (`beforeinstallprompt` capturado, o iOS) | "Instalar" (dispara `prompt()`) en Chrome/Edge; instrucción manual en iOS; SIN CTA -y sin competir por la tarjeta- si el navegador todavía no dio ninguna señal | **cliente**, tras montar |
| 2 | `ficha_sos` | el perfil PROPIO no tiene grupo sanguíneo NI contacto de emergencia | "Completar ficha SOS" → `/perfil/sos/enlace` | **servidor** |
| 3 | `notificaciones` | `Notification.permission !== "granted"` | activa el push, mismo flujo que el banner de siempre | **cliente**, tras montar |
| 4 | `gmail` | la cuenta no tiene fila en `gmail_connections` | "Conectar Gmail" → `/perfil/gmail` | **servidor** |
| 5 | `compartir_familia` | el perfil propio no otorgó ningún permiso | "Compartir mi historial" → `/familia/enlace` | **servidor** |
| 6 | `perfil_gestionado` | la cuenta ve un único perfil (el propio) | "Crear un perfil" → `/familia#crear-perfil-gestionado` | **servidor** |

Los seis son de la **CUENTA**, nunca del perfil activo -mismo criterio que la
card de Gmail de la grilla de `/inicio` y que `display_density`-: si María
está viendo el historial de Roberto, el consejo que ve sigue siendo el suyo.

## 3. Reparto servidor/cliente, y por qué no hay parpadeo

Cuatro de los seis (2, 4, 5, 6) el servidor los puede evaluar en el mismo
render de `/inicio` (`lib/consejos/servidor.ts#resolverConsejos`), porque son
consultas normales a `profiles`/`gmail_connections`/`family_permissions`. Los
otros dos (1, 3) dependen de señales que **solo el navegador tiene**
(`display-mode: standalone`, `Notification.permission`): el servidor no
puede saber si aplican.

La solución no son dos algoritmos de prioridad: es **uno solo**
(`elegirConsejo`) llamado dos veces con vistas distintas del mismo problema:

- **El servidor** lo llama con los cuatro que sabe evaluar en `pendiente`
  real, y los dos restantes en `pendiente: false` -"no sé, no propongo esto
  todavía"-. El resultado (`elegidoServidor`) es lo que efectivamente sale en
  el HTML que arma el servidor, así que es lo que se ve en el primer pintado.
- **El cliente** (`components/inicio/consejo.tsx`), tras montar, lo vuelve a
  llamar con `pendiente` real para `instalar_app`/`notificaciones`, y para
  los otros cuatro con `pendiente: id === elegidoServidor` -no necesita
  repetir las cuatro condiciones ni una segunda consulta a la base, solo
  necesita saber cuál ganó del lado servidor para que la comparación de
  prioridad sea correcta-.

Cuando ninguno de los dos consejos client-conocibles le gana al del
servidor -el caso más común-, las dos llamadas devuelven lo mismo y la
tarjeta que hidrata el cliente es un DOM idéntico al que ya pintó el
servidor: no hay nada que animar. Cuando sí le gana -el celular no tiene la
app instalada, o las notificaciones siguen sin activar-, la tarjeta cambia
de contenido recién después de montar, con un fundido (`animate-in
fade-in`, respeta `prefers-reduced-motion` por la regla global de
`app/globals.css`) disparado por un `key={elegido}` que cambia: nunca hay un
salto de layout, porque el lugar que ocupa la tarjeta (o la ausencia de
tarjeta) es el mismo antes y después, solo cambia lo que hay adentro.

`react-hooks/set-state-in-effect` (ESLint) exige que la función que llama a
`setState` esté declarada DENTRO del `useEffect` que la usa -no en un
`useCallback` de afuera-, mismo patrón que ya usaba
`components/notificaciones/activar-notificaciones.tsx#comprobar`. Por eso
`ConsejoInicio` reevalúa vía un `useReducer` contador (`version`) que fuerza
al efecto a volver a correr, en vez de exponer una función reevaluadora como
dependencia.

## 4. "Ahora no" vs "No mostrar más": el mecanismo completo

Tabla `consejos_estado` (`supabase/migrations/20260818170000_consejos.sql`):
`user_id + consejo_id + estado ('pospuesto' | 'descartado') + timestamps`.
RLS: SELECT/INSERT/UPDATE del dueño (`auth.uid() = user_id`), sin DELETE
-acá el cliente SÍ escribe lo suyo directo, es una preferencia de interfaz
sin valor clínico ni probatorio, no hace falta ningún RPC `security
definer`-.

- **"No mostrar más"** es trivial: `estado = 'descartado'`, para siempre. Ni
  `elegirConsejo` ni ninguna otra pieza vuelve a proponerlo, aunque la
  función vuelva a quedar pendiente más adelante (por ejemplo, alguien
  desconecta Gmail después de haberlo conectado).
- **"Ahora no"** es la pieza con diseño real: tiene que reaparecer **en la
  próxima sesión**, nunca en la próxima navegación dentro de la misma.

### El mecanismo de sesión

"Sesión" se define con el sentido más literal que tiene en la web: el tramo
de vida de una **cookie de sesión del navegador** (`consejos_sesion`, sin
`maxAge`/`Expires`, se borra cuando el navegador cierra del todo). No guarda
nada más que el instante en que se creó.
`lib/consejos/logica.ts#pospuestoSigueActivo` compara ese instante contra
`updated_at` de la fila pospuesta: si la sesión es MÁS NUEVA que la
postergación, ya quedó atrás y el consejo puede volver a proponerse.

```
fila.updated_at (cuándo se pospuso)  vs  sesión.iniciada_en (cuándo arrancó la sesión vigente)

pospuesto DESPUÉS de que arrancó la sesión → sigue activo (misma visita)
pospuesto ANTES de que arrancara la sesión vigente → ya no está activo (sesión nueva, reaparece)
```

**Por qué la cookie la escribe `proxy.ts` y no `/inicio` directamente**: un
Server Component no puede escribir cookies durante su render
(`lib/perfil-activo.ts` documenta el mismo límite de Next.js). Si la cookie
se creara perezosamente en `/inicio` la primera vez que falta, el `set()`
fallaría en silencio en CADA render (mismo caso que `fijarCookieTamano`) y
nunca llegaría a persistir -cada navegación generaría un instante "sesión
recién arrancada" nuevo, y CUALQUIER postergación parecería vieja de
inmediato-. El proxy (`lib/consejos/sesion.ts#asegurarSesionConsejos`, con el
mismo patrón de doble escritura -`request.cookies` y la respuesta- que ya usa
`lib/supabase/proxy.ts` para refrescar el token) corre en TODA request no
estática, así que es la única pieza que puede garantizar que la cookie exista
antes de que cualquier Server Component la lea.

**Por qué "sesión" se ata al cierre del NAVEGADOR y no al login/logout de
Supabase**: en esta app la persona casi nunca cierra sesión explícitamente
(sesión persistente típica de una PWA familiar). Atar "sesión" al
login/logout habría hecho que "Ahora no" equivaliera, en la práctica, "para
siempre" -lo opuesto de lo que la tarea pide-. `cerrarSesion`
(`app/(auth)/actions.ts`) además borra la cookie explícitamente
(`limpiarSesionConsejos`), así que un logout consciente TAMBIÉN cuenta como
frontera de sesión, aunque no sea el mecanismo principal.

**Límite declarado**: en Android, un Chrome/WebAPK que el sistema mantiene
vivo en segundo plano puede conservar la cookie de sesión más tiempo del
esperable. El peor caso es que "Ahora no" tarde un poco más en reaparecer,
nunca que desaparezca para siempre -no hay downside de seguridad ni de
datos, es una preferencia de UI-.

## 5. El problema del perfil activo vs el perfil propio (y los `.../enlace`)

Los consejos son de la cuenta, así que sus condiciones hablan del perfil
**PROPIO** -nunca del perfil activo-. Pero dos de las pantallas de destino
(`/perfil/sos`, la sección "Invitar" de `/familia`) operan sobre el perfil
**ACTIVO**. Si María está viendo el historial de Roberto y toca "Completar
ficha SOS", un `<Link href="/perfil/sos">` pelado la dejaría editando la
ficha de Roberto, no la suya.

La solución es la misma que ya usa el proyecto para este problema
(`/turnos/enlace`, Sprint 6.6): un Route Handler chico que primero fija el
perfil PROPIO como activo (`cambiarPerfilDesdeParametro`) y recién después
redirige a la pantalla real:

- `app/(app)/(con-nav)/perfil/sos/enlace/route.ts` → `/perfil/sos`
- `app/(app)/(con-nav)/familia/enlace/route.ts` → `/familia#invitar`

El consejo `perfil_gestionado` NO pasa por ningún `.../enlace`: la sección
"Crear un perfil para un familiar sin cuenta" de `/familia` ya es
independiente del perfil activo (se renderiza siempre, para cualquiera), así
que su CTA es un `<Link href="/familia#crear-perfil-gestionado">` directo.

`lib/consejos/contenido.ts#hrefCta` resuelve la URL final según el tipo de
CTA (`enlace`, `enlace_perfil_propio`, o `null` para `activar_notificaciones`
e `instalar_app`, que no navegan: disparan una acción en el lugar). Es la
misma función pura que usan tanto `components/inicio/consejo.tsx` como
`components/ayuda/lista-pasos.tsx`.

### `instalar_app`: tres estados, no un CTA fijo

A diferencia de los otros cinco, el CTA (y el cuerpo) de `instalar_app` NO
son estáticos: dependen de `lib/pwa/boton-instalar.ts#estadoTarjetaInstalar`,
resuelto contra tres señales del navegador -`beforeinstallprompt` capturado,
`display-mode: standalone`, y si el dispositivo es iOS/iPadOS (Safari nunca
dispara ese evento)-:

| Estado | Cuándo | Qué se ve |
|---|---|---|
| `"instalar"` | Chrome/Edge ya emitió `beforeinstallprompt` | Botón "Instalar" que dispara `prompt()` |
| `"instrucciones_ios"` | iOS/iPadOS (Safari nunca dispara el evento) | Instrucción manual ("Compartir → Agregar a pantalla de inicio"), sin botón |
| `"oculto"` | Ya instalada, desktop, o ningún navegador dio señal todavía | Sin tarjeta: `pendiente` da `false` y el siguiente consejo gana la prioridad |

`"oculto"` por falta de señal (típicamente Android/Chrome antes de que
dispare el evento, sin garantía de cuándo) es la corrección del bug
reportado por el dueño de la app -la tarjeta tenía "Ahora no"/"No mostrar
más" pero NINGÚN botón que instalara nada-: un botón sin ninguna acción
detrás es peor que ceder el lugar al siguiente consejo pendiente.

La captura de `beforeinstallprompt`/`appinstalled` -y la función `instalar()`
que dispara `prompt()`- vive en `hooks/usar-instalacion-pwa.ts`, compartida
entre esta tarjeta y el botón suelto de `components/pwa/boton-instalar.tsx`.

## 6. `/ayuda` — la referencia completa

`app/(app)/(con-nav)/ayuda/page.tsx`. A diferencia del consejo contextual,
esta pantalla:

- Muestra los SEIS pasos siempre, con su estado real (✓ Hecho / Pendiente),
  **ignorando el descarte por completo** -un paso que ya se descartó como
  consejo en `/inicio` sigue apareciendo acá-. Por eso usa
  `lib/consejos/servidor.ts#resolverEstadoPasos` (las condiciones puras, sin
  cruzar con `consejos_estado`) y no `resolverConsejos`.
- No tiene límite de "uno por vez": las seis filas conviven.
- Suma un mini-FAQ estático con las preguntas reales que el usuario hizo en
  producción (qué lee la app de Gmail, qué significa que la conexión es de
  la cuenta, cómo funciona la carga automática y su Deshacer, qué es un
  perfil gestionado y la graduación).

Alcanzable desde el pie de cualquier pantalla con nav
(`components/legal/pie-paginas-legales.tsx`, prop `mostrarAyuda` para que
las cuatro pantallas de `/login` etc. -que no tienen sesión, y por lo tanto
no pueden aterrizar en una ruta bajo sesión- no lo ofrezcan) y desde un link
propio dentro de `/inicio`, DEBAJO de la grilla de accesos.

**Por qué no es un tile más de la grilla de `/inicio`**: esa grilla está
afinada para caer en filas exactas de 3 columnas en modo compacto (ver el
comentario de cabecera de `app/(app)/(con-nav)/inicio/page.tsx`). Sumarle un
tile la rompe casi siempre -7, 8, 9 o 10 tiles según los permisos de la
cuenta, y ninguno de esos números es múltiplo de 3 salvo el 9, que ya usa
todo el espacio disponible-. El link vive fuera de la grilla, con su propio
trato visual.

## 7. Archivos

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/20260818170000_consejos.sql` | Tabla `consejos_estado` + RLS |
| `lib/consejos/tipos.ts` | `CONSEJO_IDS` (el orden de prioridad), guardas, nombre de la cookie de sesión |
| `lib/consejos/logica.ts` | `elegirConsejo`, `pospuestoSigueActivo`, `estaDescartado` — puro, sin DOM ni Supabase |
| `lib/consejos/condiciones-cliente.ts` | `instalarAppPendiente`, `notificacionesPendiente` — puro |
| `lib/consejos/contenido.ts` | Copy de los seis consejos + `hrefCta` + `cuerpoInstalarApp` (el cuerpo de `instalar_app` por estado) |
| `lib/consejos/sesion.ts` | `asegurarSesionConsejos` — la escribe `proxy.ts` |
| `lib/consejos/servidor.ts` | `resolverConsejos` (para `/inicio`), `resolverEstadoPasos` (para `/ayuda`), `limpiarSesionConsejos` |
| `lib/pwa/boton-instalar.ts` | `debeMostrarBotonInstalar`, `detectarIOS`, `estadoTarjetaInstalar` (los tres estados de `instalar_app`) — puro |
| `hooks/usar-instalacion-pwa.ts` | Captura compartida de `beforeinstallprompt`/`appinstalled` + `instalar()`, usada por la tarjeta y por `components/pwa/boton-instalar.tsx` |
| `lib/push/activar.ts` | Orquestación de "activar notificaciones", extraída para compartirla entre el banner de siempre y el consejo `notificaciones` |
| `app/(app)/(con-nav)/inicio/actions.ts` | `posponerConsejo`, `descartarConsejo` |
| `components/inicio/consejo.tsx` | La tarjeta contextual de `/inicio` |
| `app/(app)/(con-nav)/ayuda/page.tsx` + `components/ayuda/lista-pasos.tsx` | "¿Cómo empiezo?" |
| `app/(app)/(con-nav)/perfil/sos/enlace/route.ts`, `app/(app)/(con-nav)/familia/enlace/route.ts` | Deep links al perfil propio |

## 8. Deuda y decisiones postergadas

- **Sin sincronización en vivo entre pestañas del mismo dispositivo.** Si dos
  pestañas tienen `/inicio` abierto y una descarta un consejo, la otra no se
  entera hasta que navegue. Mismo compromiso que el resto de las
  preferencias de este proyecto (`tamano`, `perfil_activo`).
- **El corte de "viewport móvil"** para `instalar_app` es el breakpoint `md`
  de Tailwind (767px), sin heurística de dispositivo. Una tablet ancha con
  Chrome no ve este consejo aunque técnicamente pudiera instalarse.
- **No hay forma de "traer de vuelta" un consejo descartado** desde la
  interfaz (ni falta hoy: no lo pidió la tarea, y agregar el privilegio de
  DELETE sin una pantalla que lo use sería superficie de más).
