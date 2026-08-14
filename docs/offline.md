# Modo offline: qué se guarda en el teléfono y qué no

> Sprint 8, tarea 8.4. Implementación: `public/sw.js`, `lib/pwa/registrar-sw.ts`,
> `app/api/sos/[perfilId]/route.ts`, `app/api/credenciales/[id]/imagen/route.ts`,
> `app/offline/page.tsx`.
>
> Contrato del payload: `docs/modelo-sos.md` §7. Permisos y ventana de
> revocación: `docs/modelo-permisos.md` §8.1. Notificaciones (el otro
> inquilino del mismo service worker): `docs/push.md`.

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
| `/api/sos/{perfilId}` (payload JSON del contrato) | Los mismos datos en forma legible por código, uno **por perfil** |
| Las fotos de la credencial principal (`/api/credenciales/{id}/imagen`) | El carnet que se pide en la ventanilla |
| `/offline` (pantalla pública, sin datos de nadie) | La respuesta honesta para todo lo demás |
| `/_next/static/**` **inmutables** | Sin la hoja de estilos, la ficha offline es texto pelado |

| NO se guarda | Por qué |
|---|---|
| `/estudios`, `/turnos`, `/medicacion`, `/coberturas`, `/inicio`, `/familia` | No son la promesa, y cada una multiplicaría los datos de salud escritos en el disco |
| Documentos médicos (PDF, fotos de estudios) | Lo más sensible del producto, y nada de eso se lee en una guardia sin conexión |
| Cualquier **signed URL** de Supabase Storage | Ver §4 |
| Respuestas a `POST` (Server Actions) | Una mutación no se cachea nunca |
| Cualquier otro origen | El worker ni siquiera lo intercepta |

Sin red, una navegación a cualquier pantalla de la columna derecha devuelve
`/offline`. **Es deliberado que no muestre datos viejos**: una lista de turnos
de hace tres semanas, sin ninguna señal de que está vieja, es peor que decir
"esto necesita conexión".

---

## 3. La matriz de estrategias

La decisión vive en una sola función pura, `clasificarSolicitud`
(`public/sw.js`), y está cubierta por `tests/unit/sw-offline.test.ts`.

| Recurso | Caché | Estrategia | Por qué esa y no otra |
|---|---|---|---|
| `/_next/static/**` con `immutable` | `estaticos` | **cache-first**, tope de 150 entradas | La URL lleva hash de contenido: si está en el caché, es la correcta. Revalidar sería gastar red para confirmar lo obvio |
| `/sos` (solo `mode: "navigate"`) | `paginas` | **red-primero**, cae al caché | Con red gana el dato fresco: nadie debería leer una ficha vieja teniendo la nueva a un toque. Sin red aparece la última copia |
| `/api/sos/{perfilId}` | `datos` | **red-primero**, cae al caché | Ídem, y una clave por perfil |
| `/api/credenciales/{id}/imagen` | `imagenes` | **caché-primero + revalidación de fondo** | En una guardia la foto tiene que aparecer ya, sin esperar un timeout de red. La revalidación es lo que hace que esa comodidad no se vuelva un agujero (§6) |
| `/offline` | `shell` | **precarga en `install`** | Tiene que existir antes del primer corte de red, no después |
| Cualquier otra navegación | — | **red**, y `/offline` si falla | La pantalla clara en vez del dinosaurio de Chrome |
| Todo lo demás | — | **no se intercepta** | Menos superficie, menos que pueda salir mal |

El roadmap pedía "cache-first para el shell, credenciales e imagen SOS;
network-first con fallback a cache para los datos SOS en JSON". Lo que está
implementado es eso, con **una precisión sobre `/sos`**: el HTML de la ficha se
sirve red-primero, no cache-first. La diferencia importa porque ese HTML **trae
los datos adentro** (es un Server Component, `docs/modelo-sos.md` §5): tratarlo
como un estático más significaría que alguien con señal, después de corregir su
grupo sanguíneo, siga viendo el valor anterior. Ofrecer el dato fresco cuando se
puede y el guardado cuando no se puede es exactamente lo que pide el criterio de
aceptación ("al volver la conexión el cache se refresca").

### 3.1 Por qué `/sos` solo se cachea en una navegación de verdad

Next.js pide la **misma URL** `/sos` de dos formas: HTML en una navegación
completa, y payload RSC (`text/x-component`) cuando el router hace una
navegación del lado del cliente. Guardar las dos bajo la clave `/sos` dejaría el
caché con un payload RSC que el navegador intentaría mostrar como página.

Por eso la clasificación exige `request.mode === "navigate"`. El RSC pasa de
largo, y si falla por falta de red **el router de Next cae a una navegación
completa**, que sí encuentra el HTML cacheado. El camino "tocar el botón SOS sin
señal" funciona por esa caída, no a pesar de ella.

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
historial-medico-shell-v1       ← /offline y el ícono
historial-medico-estaticos-v1   ← /_next/static/** inmutables (tope 150)
historial-medico-paginas-v1     ← /sos
historial-medico-datos-v1       ← /api/sos/{perfilId}
historial-medico-imagenes-v1    ← /api/credenciales/{id}/imagen
```

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

### 5.1 `skipWaiting()` + `clients.claim()`: se revisaron y se mantienen

El encabezado del Sprint 6 dejó anotado que estas dos líneas había que
revisarlas el día que apareciera el caché, porque tomar el control de una
pestaña ya cargada puede dejarla pidiendo chunks que la versión nueva borró.
Revisado, se mantienen:

- Los estáticos de Next tienen **URL con hash de contenido**: un build nuevo no
  pisa las entradas del anterior. La colisión "mismo nombre, otro contenido" no
  existe.
- `activate` **solo borra cachés de otra versión**, y la versión se sube a mano.
  Un deploy normal no borra nada.
- Si aun así una pestaña vieja pide un chunk que ya no está, cae a la red y
  sigue funcionando. Solo lo pierde *offline*, en una ventana muy angosta.

Del otro lado, sacarlos tendría un costo cierto: en un celular las pestañas no
se cierran nunca, así que una corrección de `sw.js` se quedaría en `waiting` con
el worker viejo atendiendo los pushes. **Ya pasó en un teléfono real** (Sprint
6, `docs/push.md` §4).

### 5.2 `install` nunca puede fallar

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

**1. Diego vuelve a tener red sobre ese recurso.** Es el mecanismo principal.
Toda respuesta de red pasa por `decidirDestinoDeCache`, que es la decisión de
seguridad del worker:

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

**2. Diego cierra sesión, o la sesión vence.** Al llegar a `/login` se borran
las tres cachés con datos personales (`paginas`, `datos`, `imagenes`) —
`purgarCacheOffline`. Cuelga de `/login` y no del botón "Cerrar sesión" a
propósito: cubre también la sesión que vence sola y el rebote de `proxy.ts`, dos
casos en los que nadie tocó ningún botón y el resultado es el mismo. Y `/login`
es, por `esRutaSoloAnonima`, una pantalla a la que no se llega con sesión
activa: no puede borrar el caché de una sesión viva por accidente.

**3. Se desinstala la app o se limpian los datos del navegador.**

**Lo que queda como límite real:** un dispositivo revocado que nunca más se
conecta conserva la última copia. No hay forma de borrar datos de un teléfono
que no habla con el servidor —ninguna aplicación puede—, y es exactamente el
mismo riesgo que una foto de la credencial sacada con la cámara. Está declarado
acá, en §8, y en `docs/modelo-permisos.md` §8.1.

### 6.1 Por qué `/offline` no puede tener ni un dato

`/offline` se precarga en `install`, con un `fetch` que puede ocurrir antes de
que exista cualquier sesión, y vive en la caché `shell`, que **no se purga al
cerrar sesión**. Cualquier dato de una persona que se filtrara ahí quedaría
escrito en el disco sin nadie que lo revise. Por eso la pantalla vive fuera de
`app/(app)/`, no llama a `obtenerPerfilActivo()`, es estática y es pública
(`lib/auth/rutas.ts`, `RUTA_OFFLINE`).

---

## 7. Cómo se llena el caché: la precarga

El caché no se llena solo. Y **no alcanza con esperar a que alguien abra `/sos`
con señal**: "acordate de abrir la ficha antes de quedarte sin conexión" no es
un producto, es una trampa.

El flujo es:

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

---

## 9. Cómo se verifica

### 9.1 Automático

```bash
# Helpers puros del service worker: matriz de estrategias, decisión de caché,
# versionado, extracción de recursos. Evalúa el `public/sw.js` REAL.
npm run test -- sw-offline

# Contrato del payload (docs/modelo-sos.md §7): forma, reglas duras, ausencias.
npm run test -- sos-payload

# Que `/offline` sea pública y que el payload NO lo sea.
npm run test -- rutas
```

`tests/unit/sw-offline.test.ts` además verifica dos cosas que ningún type
checker puede: que `sw.js` siga registrando los seis handlers (agregar caché no
apagó las notificaciones) y que la lista de familias de caché con datos
personales sea **idéntica** en `public/sw.js` y en `lib/pwa/registrar-sw.ts`,
que están duplicadas porque un archivo de `public/` no se puede importar desde
TypeScript.

Lo que **no** se prueba en unit y se prueba en el dispositivo: las estrategias
con efectos (`fetch`, `caches.put`) y el ciclo de vida
`install`/`activate`/`fetch`. Un mock de la Cache API demostraría que el mock
funciona.

### 9.2 En un dispositivo real

`docs/capturas/dispositivo-real/README.md`, sección del Sprint 8.4.

**Con `next build && next start`, no con `next dev`** (límite 5).

⚠️ **El modo avión NO corta `adb reverse`**: el túnel USB es loopback y sigue
vivo con el avión activado. Para simular el corte de red de verdad:

```bash
adb reverse --remove tcp:3000          # cortar
adb reverse tcp:3000 tcp:3000          # restaurar
```

Confundir las dos cosas hace que "funciona en modo avión" no demuestre nada.
