# La guardia de perfil

> Ninguna pantalla congelada sobrevive al foco.

Capa **de cliente** que garantiza que lo que se ve en pantalla corresponde al
perfil activo de ahora, no al de hace horas. Vive en
`components/perfiles/guardia-perfil.tsx`, montada en `app/(app)/layout.tsx`.

Es la segunda mitad del arreglo de la fuga de perfil. La primera (commit
`770959c`) cerró todo lo que se podía cerrar **del lado del servidor**: el
detalle de estudio incoherente, la fuga offline del service worker y
`revalidatePath("/", "layout")` en `fijarPerfilActivo`. Después de ese trabajo,
toda carga fresca responde SIEMPRE el perfil de la cookie —verificado— y sin
embargo el dueño seguía viendo los estudios del perfil equivocado.

La explicación es que lo que veía no era una pantalla mal servida: era una
pantalla vieja que el navegador revivía **sin tocar el servidor**. Ninguna purga
del servidor puede alcanzar eso, porque no hay ningún request que purgar.

---

## 1. Las dos clases de pantalla vieja (y las dos capas que las matan)

### Clase A — la pantalla ENTERA es vieja

Una pestaña que quedó abierta en `/estudios` de un perfil hace horas; una
restauración de bfcache (el gesto "atrás" de Android devuelve una foto completa
de la página, con su DOM y su estado de JavaScript); las pestañas que Chrome
reabre al arrancar. En todos los casos, layout y página vienen del mismo momento
del pasado.

**Capa 1 — la comparación.** En `pageshow` (incluido `event.persisted`),
`visibilitychange` (al volver a `visible`) y `focus`, se compara el perfil con el
que el servidor dibujó la pantalla contra el perfil activo actual del navegador.
Si difieren, `location.reload()`.

### Clase B — el layout es fresco y el SEGMENTO DE PÁGINA es viejo

El frankenstein que reportó el dueño desde el teléfono: eligió otro perfil,
aterrizó en `/inicio` correctamente (encabezado nuevo, datos nuevos), y con dos
gestos de "atrás" llegó a `/estudios` con el **encabezado del perfil nuevo y los
estudios del perfil viejo**.

Esto es comportamiento **documentado** de Next.js, no un accidente. El glosario
de la versión instalada, entrada "Client Cache"
(`node_modules/next/dist/docs/01-app/04-glossary.md`):

> *Pages are not cached by default but are reused during browser back/forward
> navigation.*

Y `staleTimes` no ofrece manija para apagarlo
(`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md`):

> *This doesn't change back/forward caching behavior to prevent layout shift and
> to prevent losing the browser scroll position.*

O sea: en atrás/adelante el router **reusa el segmento de página cacheado a
propósito**, sin preguntarle nada al servidor.

Para la capa 1 este caso es invisible: el layout está fresco, así que el perfil
que le llega a la guardia coincide con la cookie y no hay nada que reportar.

**Capa 2 — el refresco.** En `popstate` la guardia **no compara: refresca
siempre**, con `router.refresh()`, que según la documentación de la versión
instalada (`.../04-functions/use-router.md`) *"clears the Client Cache for the
current route"* y vuelve a pedirle al servidor todos los segmentos de la ruta.

`popstate` es exactamente el evento correcto: el navegador lo dispara SOLO al
recorrer el historial. Las navegaciones normales del router usan `pushState`,
que no lo dispara, así que un toque en la bottom nav no paga nada.

**Costo:** un viaje RSC extra por cada atrás/adelante. Se paga con gusto: es una
aplicación de salud y la alternativa es que alguien lea en pantalla los estudios
de otra persona bajo el nombre correcto.

---

## 2. La cookie espejo

`perfil_activo` es `httpOnly` y sigue siéndolo. Para que la capa 1 pueda
comparar sin ir al servidor hace falta un valor legible desde JavaScript: la
cookie **`perfil_activo_publico`**, copia exacta, NO `httpOnly`, definida en
`lib/perfil-activo-espejo.ts`.

- **No es un secreto.** Es el uuid de un perfil que ese navegador ya tiene
  permitido ver, expuesto solo a ese navegador en su propio origen. La
  autorización real no cambió ni una línea: `obtenerPerfilActivo` revalida
  `requerirPermiso(perfilId, "view")` contra la base en cada request, y abajo
  está RLS. Escribirse un uuid ajeno en `document.cookie` no habilita nada:
  lo único que consigue es que la guardia recargue su propia pantalla.
- **Invariante (la que sostiene el anti-bucle):** se escribe y se borra
  **exclusivamente** en `fijarPerfilActivo` y `limpiarPerfilActivo`
  (`lib/perfil-activo.ts`), en la misma llamada y con las mismas opciones que
  `perfil_activo`. Todo cambio de perfil de la aplicación pasa por ahí (el
  selector, los cuatro deep links, "abrir en su perfil", el logout).
- Se descartó sembrarla desde `proxy.ts`: cerraría la ventana de las sesiones
  viejas (ver §5) al precio de romper la invariante de un único escritor, que es
  de donde sale la garantía de que esto no puede ciclar.

El perfil con el que se dibujó la pantalla lo aporta `idDePerfilActivoEnCookie()`
(`lib/perfil-activo.ts`), que **lee la cookie y no consulta la base**. Por eso
montar la guardia en el layout que cubre TODAS las pantallas con sesión no le
cuesta ninguna consulta nueva a `/perfiles` ni a `/compartir`, las dos únicas de
`app/(app)` que hoy no resuelven perfil activo.

---

## 3. La reproducción, antes y después

Local, `next build` + `next start` en `http://localhost:3000`, base local con el
seed (`scripts/seed.md`): **María Gómez** (titular) con dos estudios propios
—sembrados a mano para el ensayo, con "SOLO DE MARIA" en el título— y **Roberto
Gómez** (gestionado por ella) con los cinco del seed. Service worker **activo**
en los dos casos. Automatizado con el Playwright del entorno.

### 3.1 Dos pestañas (el reporte literal del dueño)

1. Pestaña A: perfil María → `/estudios` (navegación de cliente) → `/inicio`.
2. Pestaña B: `/perfiles` → elegir Roberto. La cookie del navegador —compartida
   entre las dos pestañas— pasa a Roberto.
3. Volver a enfocar la pestaña A.

| | encabezado | estudios de María | estudios de Roberto | espejo |
|---|---|---|---|---|
| **Antes** | "Tu historial" (María) | 2 | 0 | Roberto |
| **Después** | "Viendo a Roberto Gómez" | 0 | 3 | Roberto |

Antes del arreglo, la pestaña A seguía mostrando a María con la cookie ya
apuntando a Roberto. Después, al enfocarla se recarga sola.

> **Nota de método:** el Chromium headless no dispara `visibilitychange` /
> `focus` de forma confiable al traer una pestaña al frente. Cuando no
> dispararon solos, el evento se despachó con `page.evaluate`
> (`window.dispatchEvent(new Event("focus"))`), que es exactamente lo que el
> navegador manda en el caso real.

### 3.2 El frankenstein por "atrás", con la capa 1 CIEGA a propósito

Para probar que la capa 2 se sostiene sola, se repitió el escenario anterior
congelando el getter de `document.cookie` en la pestaña A —de modo que la
comparación viera "todo en orden" y no pudiera recargar nada— y recién entonces
se disparó el "atrás".

| | contexto de JS | encabezado | de María | de Roberto |
|---|---|---|---|---|
| **Antes** | vivo (sin recarga) | "Tu historial" | 2 | 0 |
| **Después** | vivo (sin recarga) | "Viendo a Roberto Gómez" | 0 | 3 |

En los dos casos la pestaña NO se recargó (el contexto de JavaScript sobrevivió,
así que la capa 1 efectivamente no intervino). Antes del arreglo, el "atrás"
mostraba el segmento de página viejo; después, `router.refresh()` lo mata.

### 3.3 El ciclo repetido

El dueño avisó: *"probalo varias veces de ir y venir, en la primera capaz no
aparece"*. Se corrió el ciclo completo tres veces seguidas —`/estudios` →
`Cambiar` → elegir el otro perfil → `/inicio` → dos "atrás"— con todo de
navegación de cliente. Las nueve lecturas (encabezado, estudios y cookie espejo
en cada etapa) coincidieron siempre con el perfil activo. Ninguna fuga.

---

## 4. Lo que se descartó, y por qué

- **El service worker cacheando payloads RSC.** Era la hipótesis más fuerte y es
  **falsa**. `clasificarSolicitud` (`public/sw.js`) manda a `"red"` toda request
  que no sea `mode === "navigate"` —un pedido RSC lo es—, y la rama `default` del
  `switch` de `fetch` devuelve sin `respondWith`: el worker **ni siquiera
  intercepta** esos pedidos. Verificado además en vivo con el worker activo y
  controlando la página: sus cachés contenían solo estáticos con hash de
  contenido, `/sos` y `/api/sos/{perfil}`. Ni un payload RSC, ni `/estudios`, ni
  `/inicio`. **`public/sw.js` no se tocó en este trabajo**, así que el modo sin
  señal (una pantalla por ruta, un perfil a la vez, purga al cambiar de perfil
  desde `components/pwa/registro-service-worker.tsx`) sigue exactamente igual.
- **`experimental.staleTimes: { dynamic: 0 }`.** Ya es el default desde Next 15
  y su propia documentación aclara que no toca el atrás/adelante.
- **`router.refresh()` para el desajuste de la capa 1.** Refrescar conserva el
  estado de React, que es justo lo que hay que tirar cuando la pantalla entera
  quedó vieja (formularios a medio llenar con datos de otra persona, diálogos
  abiertos). Una recarga completa ocurre una sola vez, al volver a una pestaña
  que ya estaba equivocada.
- **`router.bfcacheId`.** Existe en Next 16 pero resuelve otro problema
  (preservación de estado de componentes cliente), no la frescura de los datos.

---

## 5. Anti-bucle: las tres reglas y el corta-corriente

La guardia recarga **solo** si el espejo está PRESENTE y es DISTINTO.

1. **Sin perfil en la pantalla** (`/perfiles`, o una pantalla que ya está
   redirigiendo porque el permiso se revocó): inerte. Si recargara, el caso
   "permiso revocado" sería un bucle infinito —`obtenerPerfilActivo` intenta
   borrar las cookies durante el render de un Server Component, el borrado lanza
   y se traga, el espejo sobrevive, y la pantalla recargada volvería a llegar sin
   perfil—.
2. **Sin cookie espejo**: inerte. Es una sesión **anterior al despliegue**: tiene
   `perfil_activo` pero no `perfil_activo_publico`, porque el espejo se siembra
   al ELEGIR perfil y no en cada render (escribir cookies durante el render de un
   Server Component no está permitido). Recargar no lo sembraría: sería el mismo
   bucle. **El compromiso, explícito: para esas sesiones la capa 1 queda inerte
   hasta el primer cambio de perfil**, que es justo el momento en que empieza a
   hacer falta. La capa 2 (`popstate`) sí las cubre desde el minuto cero, porque
   no compara nada.
3. **Presente y distinto**: recarga.

El anti-bucle **estructural** es la invariante de §2: las dos cookies se escriben
y se borran siempre juntas, así que después de una recarga el servidor dibuja la
pantalla con exactamente el valor que el cliente va a leer.

Y hay un **corta-corriente** explícito para el único escenario donde ese
razonamiento no aplica, porque la recarga no llega al servidor: **sin señal**. Si
una de las cuatro pantallas guardadas para offline (`/sos`, `/coberturas`,
`/turnos`, `/medicacion`) quedara en el disco con un perfil y el espejo dijera
otro, la recarga volvería a servir la misma copia y sería un bucle de recargas en
una aplicación de salud sin conexión —mucho peor que el bug original—. Por eso se
anota en `sessionStorage` el par `pantalla→espejo` que motivó la recarga, y si al
volver a comprobar el par es exactamente el mismo, no se recarga de nuevo. **Una
recarga por desajuste, nunca dos.**

La anotación se levanta en los dos momentos correctos: cuando la comparación
vuelve a coincidir (el problema se resolvió) y cuando llega el evento `online`
(volvió la señal, y ahora sí una recarga puede traer la pantalla buena).

Se anota el PAR y no solo el espejo por un caso raro pero real: si se recargó por
"espejo = X", después la pantalla pasó a mostrar Y sin que ningún evento
comprobara nada, y el espejo volvió a X, la anotación vieja bloquearía una
recarga que esta vez sí corresponde.

---

## 6. Lo que esta guardia NO es

**No es una capa de autorización**, ni siquiera un poco. Corre en el cliente y
compara dos valores que el cliente ya tiene; cualquiera puede desactivarla desde
la consola y lo único que consigue es quedarse mirando su propia pantalla vieja.
Los datos siguen protegidos donde siempre: `requerirPermiso` en cada request
(`lib/auth/guardas.ts`) y RLS en la base. Esto es una guardia de **frescura**.

---

## 7. Dónde mirar

| Archivo | Qué hace |
|---|---|
| `components/perfiles/guardia-perfil.tsx` | El componente. Las dos capas, el corta-corriente. |
| `lib/perfil-activo-espejo.ts` | Nombre de la cookie espejo, lectura pura, la invariante. |
| `lib/perfil-activo.ts` | Escribe/borra las dos cookies juntas; `idDePerfilActivoEnCookie()`. |
| `app/(app)/layout.tsx` | El único punto que cubre `(con-nav)` y `(sin-nav)` de una vez. |
| `tests/unit/guardia-perfil.test.tsx` | 29 casos: comparación, atrás/adelante, corta-corriente, ciclo de vida. |
