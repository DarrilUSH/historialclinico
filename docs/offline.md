# Modo offline: qué se guarda en el teléfono y qué no

> Sprint 8 tarea 8.4 (caché de datos vitales) y **Sprint 11 tarea 11.3**
> (consolidación: offline ampliado a tres pantallas más y ciclo de actualización
> controlado). Implementación: `public/sw.js`, `lib/pwa/registrar-sw.ts`,
> `components/pwa/aviso-actualizacion.tsx`,
> `components/pwa/registro-service-worker.tsx`,
> `app/api/sos/[perfilId]/route.ts`, `app/api/credenciales/[id]/imagen/route.ts`,
> `app/offline/page.tsx`.
>
> Contrato del payload: `docs/modelo-sos.md` §7. Permisos y ventana de
> revocación: `docs/modelo-permisos.md` §8.1. Notificaciones (el otro
> inquilino del mismo service worker): `docs/push.md`.
>
> **La matriz completa por ruta está en §3.2.** Si venís a responder "¿esta
> pantalla anda sin conexión?", esa es la tabla.

---

## 1. La promesa, y por qué obliga a un service worker

El producto existe para un momento muy concreto: **una guardia, sin señal, con
alguien que no puede hablar por sí mismo**. En ese momento la app tiene que
mostrar el grupo sanguíneo, las alergias, la medicación crítica, el teléfono de
quien hay que llamar y la credencial de la obra social. Si para eso hace falta
red, el producto no sirve justo cuando más se lo necesita.

Nada de eso se resuelve con caché HTTP. El navegador puede reusar respuestas,
pero no puede **garantizar** que una pantalla concreta esté disponible sin red,
ni decidir qué hacer cuando la red falla. Eso solo lo puede hacer código propio
corriendo entre la app y la red: un service worker.

**La contracara, escrita de entrada porque condiciona todo el resto:** todo lo
que este worker guarda queda escrito en el disco del teléfono y **sobrevive a la
revocación de un permiso familiar** hasta que el dispositivo vuelva a tener red
(§6). Ese es el precio, y por eso la lista de lo que se guarda es tan corta como
se pudo.

---

## 2. Lo que se guarda, y lo que explícitamente no

| Se guarda | Por qué |
|---|---|
| El HTML de `/sos` con los datos horneados | Es la pantalla entera de la promesa |
| El HTML de `/coberturas`, `/turnos` y `/medicacion` | Sprint 11: el criterio de aceptación las nombra por su nombre (§2.1) |
| `/api/sos/{perfilId}` (payload JSON del contrato) | Los mismos datos en forma legible por código, uno **por perfil** |
| Las fotos de la credencial principal (`/api/credenciales/{id}/imagen`) | El carnet que se pide en la ventanilla |
| `/offline` (pantalla pública, sin datos de nadie) | La respuesta honesta para todo lo demás |
| `/_next/static/**` **inmutables** | Sin la hoja de estilos, la ficha offline es texto pelado |

| NO se guarda | Por qué |
|---|---|
| `/inicio`, `/estudios`, `/signos`, `/medicos`, `/familia`, `/perfil` | No hacen falta sin conexión, y cada una multiplicaría los datos de salud escritos en el disco |
| Todas las subrutas de alta/edición (`/turnos/nuevo`, `/medicacion/{id}/editar`, …) | No hay edición offline (§8, límite 4): un formulario cacheado prometería lo contrario |
| Cualquier pantalla **con query** (`/turnos?perfil={id}`) | §3.3 — una entrada por ruta, y el deep link de push no puede borrar la copia buena |
| Documentos médicos (PDF, fotos de estudios) | Lo más sensible del producto, y nada de eso se lee en una guardia sin conexión |
| Cualquier **signed URL** de Supabase Storage | Ver §4 |
| Respuestas a `POST` (Server Actions) | Una mutación no se cachea nunca |
| Cualquier otro origen | El worker ni siquiera lo intercepta |

Sin red, una navegación a cualquier pantalla de la columna derecha devuelve
`/offline`, que desde el Sprint 11 **enlaza a las cuatro que sí están
guardadas**.

### 2.1 El Sprint 11 revirtió una decisión del Sprint 8, y conviene decirlo

La versión anterior de este documento decía, en esta misma tabla, que
`/turnos`, `/medicacion` y `/coberturas` **no** se guardaban, con este
argumento: *"una lista de turnos de hace tres semanas, sin ninguna señal de que
está vieja, es peor que decir «esto necesita conexión»"*.

El criterio de aceptación del Sprint 11 pide lo contrario, con todas las letras:
*"offline: SOS, coberturas y última lista de turnos y medicación se ven"*. La
decisión se revisó y se cambió. El argumento del Sprint 8 no era falso, era
**incompleto**: comparaba "lista vieja" contra "nada", cuando la comparación
real es contra la alternativa que de verdad tiene alguien en una sala de espera
sin señal, que es *no poder confirmar a qué hora era el turno ni qué dosis
tomaba*. Un dato viejo y fechado es útil; lo que es dañino es un dato viejo
**presentado como fresco**.

Por eso el cambio no viene solo. Viene con tres cosas que lo hacen honesto:

1. **La barra "Sin conexión — estás viendo datos guardados"**
   (`components/base/indicador-conexion.tsx`, Sprint 8.5) ya está en el layout
   de `(con-nav)`: aparece arriba de estas tres pantallas apenas se corta la
   red. La lista vieja nunca se ve sin ese cartel.
2. **Solo se guarda lo que alguien abrió.** No hay precarga de las tres nuevas
   (§7): quien nunca entra a `/medicacion` no tiene su medicación en el disco.
   La precarga sigue siendo exclusiva de `/sos`, que es la que hace falta
   justamente cuando ya no se puede navegar a buscarla.
3. **Las tres viven en la caché `paginas`**, que es una de las tres familias con
   datos personales: se borra entera al llegar a `/login` (§6.2) y se revalida
   contra el servidor en cuanto vuelve la red (§6.1).

Lo que **no** cambió: los documentos médicos, los estudios y las signed URLs
siguen fuera, y siguen fuera por el mismo motivo de siempre
(`docs/modelo-permisos.md` §8.1).

---

## 3. La matriz de estrategias

La decisión vive en una sola función pura, `clasificarSolicitud`
(`public/sw.js`), y está cubierta por `tests/unit/sw-offline.test.ts`.

| Recurso | Caché | Estrategia | Por qué esa y no otra |
|---|---|---|---|
| `/_next/static/**` con `immutable` | `estaticos` | **cache-first**, tope de 150 entradas | La URL lleva hash de contenido: si está en el caché, es la correcta. Revalidar sería gastar red para confirmar lo obvio |
| `/sos`, `/coberturas`, `/turnos`, `/medicacion` (solo `mode: "navigate"` y **sin query**) | `paginas` | **red-primero**, cae al caché | Con red gana el dato fresco: nadie debería leer una ficha ni una agenda vieja teniendo la nueva a un toque. Sin red aparece la última copia |
| `/api/sos/{perfilId}` | `datos` | **red-primero**, cae al caché | Ídem, y una clave por perfil |
| `/api/credenciales/{id}/imagen` | `imagenes` | **caché-primero + revalidación de fondo** | En una guardia la foto tiene que aparecer ya, sin esperar un timeout de red. La revalidación es lo que hace que esa comodidad no se vuelva un agujero (§6) |
| `/offline` | `shell` | **precarga en `install`** | Tiene que existir antes del primer corte de red, no después |
| Cualquier otra navegación | — | **red**, y `/offline` si falla | La pantalla clara en vez del dinosaurio de Chrome |
| Todo lo demás | — | **no se intercepta** | Menos superficie, menos que pueda salir mal |

**Por qué las tres pantallas nuevas no necesitan cachear ningún endpoint
aparte.** Las cuatro son Server Components: el `fetch` a Supabase ocurre en el
servidor durante el render, y lo que llega al navegador es HTML con los datos
**adentro**. No hay un `GET /api/turnos` que el navegador dispare y que hubiera
que guardar en paralelo — guardar el HTML *es* guardar la lista. La única
excepción son las miniaturas de `/coberturas`, que sí son un `fetch` del
navegador y sí quedan afuera (§3.4).

El roadmap pedía "cache-first para el shell, credenciales e imagen SOS;
network-first con fallback a cache para los datos SOS en JSON". Lo que está
implementado es eso, con **una precisión sobre `/sos`**: el HTML de la ficha se
sirve red-primero, no cache-first. La diferencia importa porque ese HTML **trae
los datos adentro** (es un Server Component, `docs/modelo-sos.md` §5): tratarlo
como un estático más significaría que alguien con señal, después de corregir su
grupo sanguíneo, siga viendo el valor anterior. Ofrecer el dato fresco cuando se
puede y el guardado cuando no se puede es exactamente lo que pide el criterio de
aceptación ("al volver la conexión el cache se refresca").

### 3.1 Por qué una pantalla solo se cachea en una navegación de verdad

Next.js pide la **misma URL** de dos formas: HTML en una navegación completa, y
payload RSC (`text/x-component`) cuando el router hace una navegación del lado
del cliente. Guardar las dos bajo la misma clave dejaría el caché con un payload
RSC que el navegador intentaría mostrar como página.

Por eso la clasificación exige `request.mode === "navigate"`. El RSC pasa de
largo, y si falla por falta de red **el router de Next cae a una navegación
completa**, que sí encuentra el HTML cacheado. El camino "tocar el botón SOS sin
señal" —o "tocar Turnos en la bottom nav sin señal"— funciona por esa caída, no
a pesar de ella.

### 3.2 La matriz completa por ruta

Lo que hay que mirar para responder "¿esta pantalla anda sin conexión?". La
columna "Offline" dice qué ve alguien **sin red**, no qué se cachea.

| Ruta | Offline | Se guarda al… | Notas |
|---|---|---|---|
| `/sos` | ✅ última copia | **precargarse** al abrir la app + al visitarla | La única con precarga. §7 |
| `/coberturas` | ✅ última copia, **sin miniaturas** | visitarla con red | §3.4 |
| `/turnos` | ✅ última lista | visitarla con red | Sprint 11 |
| `/medicacion` | ✅ última lista | visitarla con red | Sprint 11 |
| `/api/credenciales/{id}/imagen?lado=` | ✅ | verse dentro de `/sos` | Caché-primero. §4 |
| `/api/sos/{perfilId}` | ✅ | precargarse | Alimenta el sello "Copia descargada el…" |
| `/offline` | ✅ (es la pantalla) | `install` | Pública, sin un solo dato. §6.4 |
| `/inicio` | ❌ → `/offline` | — | Es un índice de accesos: sin red no lleva a ningún lado nuevo |
| `/estudios`, `/estudios/**` | ❌ → `/offline` | — | Documentos médicos: lo más sensible, y nada de eso se lee sin conexión |
| `/signos`, `/signos/**` | ❌ → `/offline` | — | |
| `/medicos` | ❌ → `/offline` | — | |
| `/familia`, `/familia/accesos` | ❌ → `/offline` | — | Pantalla de permisos: mostrarla vieja sería mostrar permisos que ya no rigen |
| `/perfil`, `/perfiles` | ❌ → `/offline` | — | |
| `/turnos/nuevo`, `/turnos/{id}/editar`, `/medicacion/nuevo`, `/coberturas/nuevo`, `/perfil/sos` y toda alta o edición | ❌ → `/offline` | — | No hay edición offline (§8, límite 4) |
| `/turnos/enlace`, `/medicacion/enlace`, `/signos/enlace` | ❌ → `/offline` | — | Son redirecciones: sin red no hay a dónde redirigir |
| `/turnos?perfil=…`, `/medicacion?perfil=…` (deep link de push) | ❌ → `/offline` | — | §3.3 |
| `/login`, `/registro`, `/recuperar` | ❌ → `/offline` | — | Sin red no hay autenticación posible |
| Signed URLs de Supabase Storage | ❌ | — | Otro origen: el worker ni las intercepta. §4 |

La fuente de verdad de las cuatro primeras filas es `RUTAS_PAGINA_OFFLINE` en
`public/sw.js`, y `tests/unit/sw-offline.test.ts` verifica que la lista de
enlaces de `app/offline/page.tsx` diga exactamente lo mismo.

### 3.3 Una entrada por ruta: las páginas con query no se cachean

`/turnos?perfil={id}` y `/medicacion?perfil={id}` son deep links del payload de
una notificación push (`lib/turnos/recordatorios.ts`,
`docs/recordatorios.md` §9). Esas páginas **redirigen** a `/…/enlace` para
cambiar el perfil activo —una cookie solo se puede escribir en un Route
Handler— y vuelven.

Si cayeran en la estrategia de página pasarían dos cosas malas a la vez:

1. Una entrada de caché nueva por cada perfil que llegue por push, y ninguna que
   una navegación pelada a `/turnos` pueda volver a encontrar.
2. Peor: `fetch` sigue las redirecciones, así que la respuesta llegaría al worker
   con `redirected === true` y `decidirDestinoDeCache` la marcaría
   **"descartar"** — es decir, **tocar el recordatorio de un turno borraría la
   lista de turnos guardada**, justo la que esta tarea promete.

Por eso `clasificarSolicitud` exige que `url.search` esté vacío. El deep link
viaja por red, aterriza en la ruta pelada tras la redirección, y **esa**
navegación es la que llena el caché.

### 3.4 Offline, `/coberturas` muestra los datos pero no las fotos

Las miniaturas de la billetera (`components/coberturas/miniatura-credencial.tsx`)
piden su propia **signed URL** con `?miniatura=1` y cargan la imagen desde
Supabase Storage: otro origen, vida de 300 segundos, imposible de cachear (§4).
Sin red, esa carga falla y —por diseño previo, no por esta tarea— la miniatura
simplemente no se ve.

Lo que sí se ve es lo que se necesita para una ventanilla: obra social, plan y
**número de afiliado**, que están en el HTML. Y la foto de la credencial
principal sigue disponible a un toque en `/sos`, que la sirve por la URL estable
`/api/credenciales/{id}/imagen` y sí está cacheada. La pantalla `/offline` lo
dice explícitamente en vez de dejar que se descubra con una foto rota.

---

## 4. La decisión difícil: las fotos de credencial no pueden ir por signed URL

Hasta el Sprint 8.1, la única forma de ver una credencial era
`GET /api/credenciales/{id}/url`, que devuelve una **signed URL** de Supabase
Storage. Para el caché offline eso no sirve, por tres motivos independientes:

1. **La URL cambia en cada emisión.** La firma incluye el momento de creación:
   abrir la misma credencial dos veces produce dos URL distintas. Como clave de
   caché, eso es una entrada nueva por apertura y ninguna que se pueda volver a
   encontrar.
2. **Vive 300 segundos** (`TTL_MAXIMO_SEGUNDOS`). Una entrada de caché que nace
   vencida no sirve para modo avión: la gracia es abrir la credencial una semana
   después.
3. **No lleva sesión.** Es un enlace que funciona para cualquiera que lo tenga.
   Guardarlo en el disco del teléfono sería peor que guardar la foto: la foto
   requiere abrir la app; el enlace, no.

**La solución es una URL estable:** `GET /api/credenciales/{id}/imagen?lado=front|back`
devuelve los bytes de la imagen, con el mismo orden de guardas que el endpoint
hermano —sesión → leer la fila con el cliente del **usuario** (RLS decide) →
recién entonces `service_role` para leer el objeto— y `Cache-Control: private, no-cache`.
Es siempre la misma para la misma cara, así que el service worker la puede
guardar y volver a encontrar.

**Los dos caminos conviven, porque resuelven cosas distintas:**

| | Signed URL (`/url`) | URL estable (`/imagen`) |
|---|---|---|
| Quién la usa | El visor a pantalla completa y las miniaturas de `/coberturas` | El `<img>` de la ficha SOS y el caché offline |
| Los bytes viajan | De Storage al navegador, sin pasar por Node | Por el servidor de la app |
| Vida | 300 s | Estable |
| Cacheable | No | Sí |
| Audita `ver_credencial` | **Sí** (salvo `?miniatura=1`) | **No** — ver abajo |

### 4.1 Por qué `/imagen` no audita

`docs/modelo-permisos.md` §6.3 distingue "alguien abrió la credencial a mirarla"
de "una pantalla renderizó una imagen". Esta ruta es lo segundo: la pide el
`<img>` de la ficha SOS en cada render, exactamente como `?miniatura=1` en la
billetera, y auditarla llenaría de filas automáticas la lista que el titular usa
para controlar quién mira sus datos.

Hay además una razón estructural más fuerte: **offline la request no llega al
servidor**. La foto sale del caché del dispositivo sin que nadie se entere, así
que una auditoría por esta vía sería sistemáticamente incompleta — y un registro
incompleto que *parece* completo es peor que uno que declara no cubrir ese
camino. La apertura deliberada (el visor a pantalla completa) sigue auditando
`ver_credencial` igual que antes, y ese es el evento que el registro promete.

### 4.2 Por qué la ficha SOS usa `<img>` y no `next/image`

`next/image` reescribe el `src` a `/_next/image?url=…&w=…&q=…`: **otra URL**,
con su propio caché y su propia negociación de formato, que el service worker no
puede seguir. Además haría pasar una foto médica privada por el optimizador. Es
el mismo criterio que ya aplicaban el visor y la miniatura de la billetera.

---

## 5. Versionado y claves de caché

Cinco cachés, todas con el prefijo `historial-medico-` y el sufijo de versión:

```
historial-medico-shell-v2       ← /offline y el ícono
historial-medico-estaticos-v2   ← /_next/static/** inmutables (tope 150)
historial-medico-paginas-v2     ← /sos, /coberturas, /turnos, /medicacion
historial-medico-datos-v2       ← /api/sos/{perfilId}
historial-medico-imagenes-v2    ← /api/credenciales/{id}/imagen
```

`v1` → `v2` en el Sprint 11 (tarea 11.3), porque cambió la matriz de
clasificación. Subirla es lo que garantiza que un dispositivo que venía del
Sprint 8 arranque con las cinco cachés limpias en vez de arrastrar entradas
guardadas con las reglas anteriores.

- **`VERSION` se sube a mano** cuando cambia la lógica de `public/sw.js`, no en
  cada deploy de la aplicación. En `activate`, el worker borra todo lo que lleve
  el prefijo y **no** sea de la versión vigente (`cachesAEliminar`), y no toca
  ninguna caché ajena del mismo origen.
- **La clave es la URL absoluta sin fragmento** (`claveDeCache`), nunca el
  objeto `Request`. Con un `Request` como clave, la Cache API aplica `Vary`, y
  Next responde con `Vary: rsc, next-router-state-tree, …`: dos pedidos de la
  misma pantalla podrían no encontrarse entre sí por un header que no cambia el
  contenido. Una clave de texto elimina esa clase entera de sorpresas.
- El caché de estáticos tiene **tope de entradas** porque los nombres llevan
  hash: sin tope, cada build dejaría sus chunks para siempre. Al pasarse se
  borran los más viejos (la Cache API conserva el orden de inserción).

### 5.1 El ciclo de actualización: `skipWaiting()` dejó de ser automático

**Esta sección reemplaza la del Sprint 8, que decía lo contrario.** Hasta la
tarea 11.3, `install` llamaba a `self.skipWaiting()`: la versión nueva se ponía
al mando sola, en el acto.

Los dos lados del problema, los dos reales:

- **Con `skipWaiting()` automático**, una pestaña ya renderizada queda de golpe
  controlada por código nuevo, con el HTML y los chunks viejos que ya tiene, y
  con un caché que `activate` acaba de podar. Nada de eso avisa; se descubre
  cuando algo no anda.
- **Sin `skipWaiting()` y sin nada más**, en un celular las pestañas no se
  cierran nunca, así que una corrección de `sw.js` se queda en `waiting` para
  siempre con el worker viejo atendiendo los pushes. **Ya pasó en un teléfono
  real** (Sprint 6, `docs/push.md` §4.3).

La salida no es elegir uno de los dos males: es **darle el control a la
persona**.

```
 deploy con sw.js nuevo
   → el navegador lo instala y lo deja en `waiting`   (NO toma el control)
   → `vigilarActualizacion` lo detecta                (lib/pwa/registrar-sw.ts)
   → barra "Hay una versión nueva — Actualizar"       (components/pwa/aviso-actualizacion.tsx)
   → toque en "Actualizar"
   → `aplicarActualizacion` → postMessage {tipo:"saltar-espera"} al worker en espera
   → el worker hace `skipWaiting()` y, al activarse, `clients.claim()`
   → `controllerchange` → UNA recarga, misma pantalla, misma sesión
```

**Lo que no se rompe mientras el worker nuevo espera** —lo que había que
verificar antes de tocar esto—:

| | Estado durante la espera |
|---|---|
| **Push** | El worker **viejo** sigue activo y es el que recibe `push` y `notificationclick`. Un worker en `waiting` no recibe eventos push. El aviso puede quedar sin tocar durante días sin perder un recordatorio |
| **Caché** | Sigue el de la versión vieja, coherente con el HTML viejo que la pestaña ya tiene. `activate` —y con él la poda de versiones— no corre hasta que alguien acepte |
| **Sesión** | Intacta. Recargar no borra ninguna cookie, y la purga de cachés con datos cuelga de `/login` (§6.2), no de una recarga |
| **Pantalla** | Se vuelve a la misma URL con el mismo perfil activo |

**Las cuatro trampas de este patrón, y cómo las evita el código:**

1. **Avisar en la primera instalación.** Sin worker previo
   (`navigator.serviceWorker.controller === null`) no hay "versión nueva": el
   worker se instala, activa y reclama solo. Avisar ahí sería pedirle a alguien
   que actualice una app que acaba de abrir. La regla vive aislada en
   `debeAvisarActualizacion` y está cubierta por
   `tests/unit/actualizacion-sw.test.ts`.
2. **Recargar en la primera visita.** `controllerchange` **también** se dispara
   cuando el worker recién instalado reclama una pestaña que no tenía
   controlador. Un listener global recargaría la app en medio de la primera
   visita, sin que nadie pidiera nada. Por eso el listener se registra dentro de
   `aplicarActualizacion`, colgado del gesto, y con `once: true`.
3. **El bucle de recarga.** Doble guarda: la bandera de módulo
   `actualizacionEnCurso` y el `once: true`. Después de la recarga no queda
   nadie en `waiting`, así que el aviso no vuelve a aparecer.
4. **Detectar solo el caso raro.** Además de `updatefound`, `vigilarActualizacion`
   comprueba `registration.waiting` **al montar**: en un celular, recargar la app
   con una versión ya instalada de una visita anterior es el caso *normal*, no
   el excepcional. Sin esa comprobación inicial el aviso solo aparecería en la
   ventana de segundos en la que el worker se instala.

### 5.2 `clients.claim()` sí se mantiene, y no es lo mismo que `skipWaiting()`

`skipWaiting()` decide **cuándo** una versión pasa a estar activa;
`clients.claim()` decide si, ya activa, atiende también las pestañas abiertas.
Sacar el primero no da ningún motivo para sacar el segundo, y el segundo es
obligatorio: sin él, la pestaña desde la que se acaban de activar las
notificaciones queda sin controlar y `WindowClient.navigate()` rechaza con
"Cannot navigate a window that is not controlled" — la notificación abre la app
y se queda donde estaba, en silencio. Se detectó así en un teléfono real
(Sprint 6). Desde el Sprint 8 es además lo que hace que el handler `fetch`
empiece a atender la pestaña actual sin esperar una recarga.

El riesgo que el Sprint 6 anotó para `claim()` con caché versionada sigue
acotado por lo mismo de siempre: los estáticos de Next tienen **URL con hash de
contenido**, así que un build nuevo no pisa las entradas del anterior;
`activate` **solo borra cachés de otra versión**; y una pestaña que pida un
chunk que ya no está cae a la red y sigue funcionando.

### 5.3 `install` nunca puede fallar

Si la promesa de `install` rechaza, el worker no se instala — y con él se caen
**también las notificaciones**, que no tienen nada que ver con el caché. Por eso
la precarga de `/offline` está envuelta en un `try/catch` que se traga cualquier
error: sin red al instalar, el worker queda vivo igual y la pantalla offline se
precarga en la instalación siguiente.

---

## 6. Modelo de amenaza: qué pasa cuando se revoca un permiso

`docs/modelo-permisos.md` §8.1 ya reconocía que una signed URL emitida sobrevive
hasta 300 segundos a la revocación. **El caché offline alarga esa ventana**, y
conviene decirlo sin eufemismos: una copia guardada de la ficha SOS de Roberto
sigue en el teléfono de Diego hasta que ocurra alguna de estas tres cosas.

**El Sprint 11 amplió esa superficie** —ahora también puede haber una copia de
la medicación, la agenda de turnos y las coberturas de Roberto— sin cambiar
ninguno de los tres mecanismos: las tres pantallas nuevas viven en la caché
`paginas`, que ya era una de las tres familias con datos personales. El §2.1
explica por qué el intercambio se consideró aceptable.

### 6.1 Vuelve la red sobre ese recurso

Es el mecanismo principal. Toda respuesta de red pasa por
`decidirDestinoDeCache`, que es la decisión de seguridad del worker:

| Respuesta | Qué hace | Por qué |
|---|---|---|
| 2xx de la misma ruta | **guardar** | Es el dato bueno |
| 401 / 403 / 404 | **borrar la copia local** | El servidor dijo que esta sesión ya no puede ver esto |
| Redirigida (`307 → /login`) | **borrar la copia local** | La sesión venció |
| 5xx u otra | **conservar** | Un servidor caído no es motivo para tirar la ficha de emergencia |

El caso de la redirección es el más traicionero: `fetch` sigue las
redirecciones por defecto, así que un `307 → /login` llega al worker disfrazado
de `200 OK` con el HTML del login. Sin ese chequeo, el caché de `/sos`
terminaría **conteniendo la pantalla de login**.

La estrategia caché-primero de las imágenes revalida siempre en segundo plano
justamente por esto: la comodidad de ver la foto al instante no puede costar que
una revocación no llegue nunca.

### 6.2 Cierra sesión, o la sesión vence

Al llegar a `/login` se borran las tres cachés con datos personales
(`paginas`, `datos`, `imagenes`) —
`purgarCacheOffline`. Cuelga de `/login` y no del botón "Cerrar sesión" a
propósito: cubre también la sesión que vence sola y el rebote de `proxy.ts`, dos
casos en los que nadie tocó ningún botón y el resultado es el mismo. Y `/login`
es, por `esRutaSoloAnonima`, una pantalla a la que no se llega con sesión
activa: no puede borrar el caché de una sesión viva por accidente.

### 6.3 Se desinstala la app o se limpian los datos del navegador

**Lo que queda como límite real:** un dispositivo revocado que nunca más se
conecta conserva la última copia. No hay forma de borrar datos de un teléfono
que no habla con el servidor —ninguna aplicación puede—, y es exactamente el
mismo riesgo que una foto de la credencial sacada con la cámara. Está declarado
acá, en §8, y en `docs/modelo-permisos.md` §8.1.

### 6.4 Por qué `/offline` no puede tener ni un dato

`/offline` se precarga en `install`, con un `fetch` que puede ocurrir antes de
que exista cualquier sesión, y vive en la caché `shell`, que **no se purga al
cerrar sesión**. Cualquier dato de una persona que se filtrara ahí quedaría
escrito en el disco sin nadie que lo revise. Por eso la pantalla vive fuera de
`app/(app)/`, no llama a `obtenerPerfilActivo()`, es estática y es pública
(`lib/auth/rutas.ts`, `RUTA_OFFLINE`).

---

## 7. Cómo se llena el caché: la precarga (solo `/sos`) y la visita

Hay **dos** formas de que algo entre al caché, y la diferencia es una decisión,
no un detalle de implementación:

| | Precarga | Visita |
|---|---|---|
| Qué | `/sos` + sus estáticos, sus fotos de credencial y `/api/sos/{perfilId}` | `/coberturas`, `/turnos`, `/medicacion` |
| Cuándo | Al abrir la app, sin que nadie haga nada | Cuando alguien abre esa pantalla con red |
| Por qué así | "Acordate de abrir la ficha antes de quedarte sin señal" no es un producto, es una trampa | Nadie necesita su lista de turnos sin haberla mirado nunca — y no cachearla es no escribirla en el disco |

Esa asimetría es deliberada. `/sos` existe para el momento en que ya no se puede
navegar a buscarla; las otras tres son pantallas que se usan a diario, y quien
nunca entra a `/medicacion` no tiene su medicación guardada en el teléfono. Es
la aplicación directa del principio de §2: cada byte que se escribe en el disco
tiene que justificarse.

El flujo de la precarga es: 

1. `components/pwa/registro-service-worker.tsx` se monta en el layout de
   `(con-nav)` —o sea, en cualquier pantalla con sesión y perfil activo— y
   registra el worker (`lib/pwa/registrar-sw.ts`, **punto único de registro de
   todo el proyecto**).
2. Le manda un `postMessage({ tipo: "precargar-sos", perfilId })`.
3. El worker baja y guarda, en este orden: el HTML de `/sos`, los
   `/_next/static/**` que ese HTML referencia, las fotos de credencial que ese
   HTML referencia y el payload `/api/sos/{perfilId}`.

**Por qué la precarga la hace el worker y no la página.** Apenas registrado, el
service worker todavía no controla la pestaña que lo registró: un `fetch` desde
la página no pasaría por el handler `fetch` y no se cachearía nada. Es una
carrera que aparece **solo en la primera visita**, es decir justo en la que
importa. El worker escribe su caché directamente y la carrera desaparece.

**Por qué el worker lee el HTML para saber qué más bajar.** Cachear solo el HTML
deja la pantalla sin hoja de estilos —texto pelado, la sensación exacta de "esto
se rompió"— y sin las fotos, que son subrecursos que el navegador solo pide
cuando renderiza la página. `extraerRecursosDeHtml` los saca del HTML con una
búsqueda de texto sobre `href=`/`src=`; en el scope de un worker no hay DOM
(`DOMParser` no existe), y un falso negativo solo significa que ese recurso se
cachea más tarde, cuando el navegador lo pida por su cuenta.

**Una vez por sesión de pestaña y por perfil.** La marca va en `sessionStorage`
(no en `localStorage`) porque el criterio es "una vez cada vez que la persona
abre la app": abrir la app de nuevo es justamente cuando conviene refrescar. La
clave incluye el `perfilId`, así que **cambiar de perfil vuelve a precargar** —
indispensable, porque `/sos` se guarda bajo una sola clave y una copia offline
de la ficha equivocada en una guardia es peor que no tener ninguna.

**Las tres pantallas nuevas se guardan por el camino normal**, sin ningún
mecanismo extra: son una navegación más que cae en `estrategiaRedPrimero` y
queda en la caché `paginas`. No hay nada que "activar", y por eso tampoco hay
nada que pueda quedar a medio activar.

### 7.1 El registro subió al arranque, y eso cambia una decisión del Sprint 6

El Sprint 6 registraba el worker recién cuando la persona pedía activar los
recordatorios. Ese mismo archivo dejó anotado que la PWA offline iba a invertir
la decisión, y así fue: **el caché offline no puede depender de un gesto**.

Lo que **no** cambió: registrar un worker no pide ningún permiso al sistema
operativo. `Notification.requestPermission()` sigue detrás del botón "Activar
recordatorios", que es lo que `mobile-ux-patterns` marca de verdad.

---

## 8. Límites conocidos

1. **Un dispositivo revocado que nunca vuelve a conectarse conserva la última
   copia.** §6. No tiene solución técnica y es el mismo riesgo que una foto de
   la credencial sacada con la cámara.
2. **Solo se guarda la ficha del perfil que se estuvo mirando.** El payload es
   por perfil, pero la precarga la dispara el perfil activo: quien administra
   tres perfiles y solo abrió uno tiene una sola ficha offline. Cambiar de
   perfil con señal deja la nueva guardada.
3. **`/sos` se guarda bajo una única clave**, así que hay una sola ficha HTML
   offline por dispositivo: la del último perfil precargado. El payload JSON sí
   convive por perfil. Unificarlo (una URL de ficha por perfil) es un cambio de
   ruta que excede esta tarea.
4. **No hay edición offline.** Es la regla dura 5 del contrato: una edición de
   datos vitales que se sincroniza tarde y pisa una más nueva es peor que no
   poder editar.
5. **En `next dev` el caché de estáticos queda vacío**, a propósito: los chunks
   de desarrollo no son inmutables y cachearlos serviría código viejo después de
   cada edición. El modo offline se prueba contra `next build && next start`, y
   la documentación de Next dice lo mismo.
6. **La primera instalación necesita una navegación con red** para que el caché
   de estáticos tenga los chunks de la app. `/offline` sí queda completa desde
   `install` (el worker precarga sus propios estáticos), pero `/sos` necesita la
   precarga del paso 7.
7. **El indicador de frescura todavía no muestra `generado_at`.** La ficha
   muestra `sos_updated_at` ("Datos revisados el …"), que responde otra
   pregunta (`docs/modelo-sos.md` §6.1). Mostrar "esta copia se bajó el …" es la
   tarea 8.5, que ya tiene el dato servido en el payload.
8. **`/coberturas`, `/turnos` y `/medicacion` se guardan bajo una única clave
   cada una**, igual que `/sos` (límite 3): la copia offline es la del último
   perfil que se estuvo mirando. Es consistente consigo misma —el HTML cacheado
   incluye el encabezado con el nombre del perfil, así que offline se ve
   "Roberto" arriba de la medicación de Roberto— pero **no** hay una copia por
   perfil.
9. **Sin red, `/coberturas` no muestra las miniaturas.** §3.4: son signed URLs
   de Supabase, que no se pueden cachear. Los datos de la credencial sí se ven,
   y la foto de la principal sigue disponible en `/sos`.
10. **Ninguna de las tres pantallas nuevas tiene sello de "copia descargada
    el…".** `/sos` sí lo tiene (`FrescuraOffline`, tarea 8.5) porque su payload
    JSON trae `generado_at`; las otras tres son HTML y no hay un dato equivalente
    horneado adentro. Lo que sí aparece en las tres es la barra global "Sin
    conexión — estás viendo datos guardados" (`IndicadorConexion`), que dice lo
    esencial —esto no está al día— sin fingir una precisión que no hay.
11. **Una actualización aceptada en otra pestaña no recarga esta.** La recarga
    cuelga del gesto (§5.1, trampa 2), así que una pestaña que no tocó
    "Actualizar" queda con HTML viejo bajo un worker nuevo hasta que se navegue.
    En un celular hay una sola pestaña, así que en la práctica no ocurre; en
    escritorio, cae a la red y funciona igual.

---

## 9. Cómo se verifica

### 9.1 Automático

```bash
# Helpers puros del service worker: matriz de estrategias, decisión de caché,
# versionado, extracción de recursos, ciclo de actualización. Evalúa el
# `public/sw.js` REAL.
npm run test -- sw-offline

# La regla de cuándo mostrar el aviso "hay una versión nueva".
npm run test -- actualizacion-sw

# Contrato del payload (docs/modelo-sos.md §7): forma, reglas duras, ausencias.
npm run test -- sos-payload

# Que `/offline` sea pública y que el payload NO lo sea.
npm run test -- rutas
```

`tests/unit/sw-offline.test.ts` además verifica cinco cosas que ningún type
checker puede:

1. Que `sw.js` siga registrando los seis handlers — agregar caché, y después
   cambiar el ciclo de actualización, no apagó las notificaciones.
2. Que la lista de familias de caché con datos personales sea **idéntica** en
   `public/sw.js` y en `lib/pwa/registrar-sw.ts`.
3. Que el literal del mensaje `saltar-espera` sea **el mismo** en los dos
   archivos. Si divergen, el aviso se muestra, se toca "Actualizar" y no pasa
   absolutamente nada: no hay error, no hay log, no hay síntoma.
4. Que `install` **no** llame a `skipWaiting()` y que `activate` **sí** llame a
   `clients.claim()`. Son las dos líneas que más fácil se vuelven a colar de
   vuelta (§5.1, §5.2).
5. Que los enlaces de `app/offline/page.tsx` sean exactamente las rutas que el
   worker guarda. Ofrecer un enlace a una pantalla no cacheada lleva de vuelta a
   la propia pantalla offline.

Los puntos 2 y 3 existen porque un archivo de `public/` no se puede importar
desde TypeScript y los literales están duplicados a mano.

Lo que **no** se prueba en unit y se prueba en el dispositivo: las estrategias
con efectos (`fetch`, `caches.put`), el ciclo de vida
`install`/`activate`/`fetch` y el cableado del ciclo de actualización
(`updatefound`, `statechange`, `controllerchange`, `postMessage`). Un mock de la
Cache API demostraría que el mock funciona.

### 9.2 En un dispositivo real

`docs/capturas/dispositivo-real/README.md`, secciones del Sprint 8.4 y del
Sprint 11.3.

Para probar el **ciclo de actualización** hace falta publicar una versión nueva
de verdad, que es exactamente lo que el criterio de aceptación pide:

```bash
# 1. Cambiar VERSION en public/sw.js (o cualquier byte del archivo).
# 2. Rebuild y restart: el navegador compara el sw.js byte a byte.
npm run build && npm run start
# 3. Recargar la app en el teléfono → aparece "Hay una versión nueva".
# 4. Tocar "Actualizar" → una sola recarga, misma pantalla, sesión intacta.
```

Un `next dev` no sirve para esto por el mismo motivo que no sirve para el resto
(límite 5).

**Con `next build && next start`, no con `next dev`** (límite 5).

⚠️ **El modo avión NO corta `adb reverse`**: el túnel USB es loopback y sigue
vivo con el avión activado. Para simular el corte de red de verdad:

```bash
adb reverse --remove tcp:3000          # cortar
adb reverse tcp:3000 tcp:3000          # restaurar
```

Confundir las dos cosas hace que "funciona en modo avión" no demuestre nada.
