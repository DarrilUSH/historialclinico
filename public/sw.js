/**
 * Service Worker de Historial Médico. **Hay uno solo y este es** (registro
 * único en `lib/pwa/registrar-sw.ts`).
 *
 * Tres responsabilidades, agregadas en tres sprints distintos:
 *
 * 1. **Notificaciones** (Sprint 6, tarea 6.3): handlers `push` y
 *    `notificationclick`. Verificados contra un teléfono real; no se tocan.
 * 2. **Cache offline de datos vitales** (Sprint 8, tarea 8.4): handler
 *    `fetch` con estrategia diferenciada por tipo de recurso, más `install`
 *    (precarga de la pantalla `/offline`), `activate` (limpieza de versiones
 *    viejas de caché) y `message` (precarga y purga a pedido de la página).
 * 3. **Offline ampliado + ciclo de actualización controlado** (Sprint 11,
 *    tarea 11.3): tres pantallas de datos más en el caché de páginas, y el
 *    `skipWaiting()` automático reemplazado por uno **a pedido de la persona**
 *    (mensaje `saltar-espera`, abajo).
 *
 * **La matriz de estrategias, el modelo de amenaza y los límites conocidos
 * están en `docs/offline.md`.** Este encabezado documenta solo lo que hay que
 * saber para editar ESTE archivo sin romperlo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE SE CACHEA Y LO QUE NO — la lista explícita que el Sprint 6 pedía
 *
 * Se cachea, y nada más que esto:
 *
 * | Recurso | Caché | Estrategia |
 * |---|---|---|
 * | `/offline` (pantalla pública, sin datos de nadie) | `shell` | precarga en `install` |
 * | `/_next/static/**` **inmutables** | `estaticos` | cache-first con tope |
 * | `/sos` (HTML con los datos horneados) | `paginas` | red-primero, cae al caché |
 * | `/coberturas`, `/turnos`, `/medicacion` (ídem) | `paginas` | red-primero, cae al caché |
 * | `/api/sos/{perfilId}` (payload del contrato) | `datos` | red-primero, cae al caché |
 * | `/api/credenciales/{id}/imagen?lado=` | `imagenes` | caché-primero + revalidación |
 *
 * **Todo lo demás pasa de largo**: `/inicio`, `/estudios`, `/signos`,
 * `/medicos`, `/familia`, `/perfil`, todas las subrutas de alta y edición, los
 * documentos médicos, las signed URLs de Supabase, las Server Actions (`POST`)
 * y cualquier otro origen. Sin red, una navegación a cualquiera de esas
 * pantallas devuelve `/offline`, que es una respuesta honesta: "esto necesita
 * conexión", en vez de datos viejos sin fecha.
 *
 * Las cuatro pantallas de la lista se cachean **solo cuando alguien las abre
 * con red** (no hay precarga de las tres nuevas): quien nunca entra a
 * `/medicacion` no tiene su medicación escrita en el disco. La única que sí se
 * precarga es `/sos`, porque es la que hace falta en el momento en que ya no
 * se puede navegar a buscarla.
 *
 * Por qué la lista sigue siendo corta: `docs/modelo-permisos.md` §8.1. Todo lo
 * que queda escrito en el disco del teléfono **sobrevive a la revocación de un
 * permiso familiar** hasta que el dispositivo vuelva a tener red. Ese precio se
 * paga solo por lo que justifica el producto —la ficha de emergencia, la
 * credencial, y las tres listas que el roadmap del Sprint 11 declaró
 * imprescindibles sin señal— y por nada más. Las tres nuevas viven en la caché
 * `paginas`, que **se borra entera al llegar a `/login`**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNA ENTRADA POR RUTA: las páginas con query NO se cachean
 *
 * `/turnos?perfil={id}` y `/medicacion?perfil={id}` son deep links de una
 * notificación push: **redirigen** a `/…/enlace` para cambiar el perfil activo
 * y vuelven. Si se cachearan, pasarían dos cosas malas a la vez: una entrada
 * nueva por cada perfil que llegue por push, y —peor— `decidirDestinoDeCache`
 * vería una respuesta `redirected` y **borraría** la copia buena de esa lista.
 *
 * Por eso `clasificarSolicitud` exige que la URL no traiga query. El deep link
 * viaja por red, aterriza en la ruta pelada tras la redirección, y ESA
 * navegación es la que llena el caché.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NUNCA se cachea una signed URL
 *
 * Las fotos de credenciales se sirven por una **URL estable**
 * (`/api/credenciales/{id}/imagen?lado=front`) que verifica sesión y permiso
 * en cada request que llega al servidor. Las signed URLs de
 * `/api/credenciales/{id}/url` viven 300 segundos y cambian en cada emisión:
 * como clave de caché son inservibles (cada apertura generaría una entrada
 * nueva que nace vencida) y como contenido cacheado serían un enlace público
 * al objeto guardado en el disco del teléfono. El visor online sigue usando
 * signed URLs; el caché offline usa la URL estable. `docs/offline.md` §4.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL CICLO DE ACTUALIZACIÓN: `skipWaiting()` dejó de ser automático (Sprint 11)
 *
 * Hasta el Sprint 8 este archivo llamaba a `self.skipWaiting()` dentro de
 * `install`: la versión nueva se ponía al mando sola, en el acto. La razón era
 * buena y sigue siendo cierta —en un celular las pestañas no se cierran nunca,
 * así que sin `skipWaiting()` una corrección de este archivo se queda en
 * `waiting` para siempre; ya pasó en un teléfono real (Sprint 6,
 * `docs/push.md` §4.3)—. Pero el precio también es cierto: **cambiar de worker
 * bajo los pies de una pestaña que ya está renderizada** la deja controlada por
 * código nuevo con HTML y chunks viejos, y con un caché que `activate` acaba de
 * podar.
 *
 * La salida no es elegir uno de los dos males: es **darle el control a la
 * persona**. El worker nuevo se instala y se queda esperando; la página detecta
 * `registration.waiting` y muestra un aviso discreto ("Hay una versión nueva —
 * Actualizar"); recién si lo tocan llega el mensaje `saltar-espera`, este
 * worker hace `skipWaiting()`, dispara `controllerchange` y la página se
 * recarga UNA vez. El resultado es una actualización atómica: worker nuevo,
 * HTML nuevo y chunks nuevos empiezan juntos.
 *
 * **Lo que NO cambia mientras el worker nuevo espera** —y es lo que hacía falta
 * verificar antes de tocar esto—:
 *
 * - El worker VIEJO sigue activo y sigue siendo el que recibe `push` y
 *   `notificationclick`. Un `waiting` no recibe eventos push. Las
 *   notificaciones no dependen en ningún punto de que el worker más nuevo esté
 *   al mando, así que el aviso puede quedar sin tocar durante días sin que se
 *   pierda un solo recordatorio.
 * - El caché sigue siendo el de la versión vieja, coherente con el HTML viejo
 *   que la pestaña ya tiene. `activate` (y con él la poda de versiones) no
 *   corre hasta que alguien acepte.
 * - La sesión no se toca: recargar la página no borra ninguna cookie, y la
 *   purga de cachés con datos cuelga de `/login`, no de una recarga.
 *
 * **La primera instalación no muestra nada.** Sin worker previo
 * (`navigator.serviceWorker.controller === null`) no hay "versión nueva": el
 * worker se instala, activa y reclama sin aviso y sin recarga. Avisar ahí sería
 * pedirle a alguien que "actualice" una app que acaba de abrir por primera vez.
 * La comprobación vive en `lib/pwa/registrar-sw.ts#debeAvisarActualizacion`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `clients.claim()` SÍ se mantiene, y no es lo mismo que `skipWaiting()`
 *
 * `skipWaiting()` decide CUÁNDO una versión nueva pasa a estar activa;
 * `clients.claim()` decide si, ya activa, atiende también las pestañas que
 * estaban abiertas. Sacar el primero no da ningún motivo para sacar el segundo,
 * y el segundo es obligatorio: sin él, la pestaña desde la que se acaban de
 * activar las notificaciones queda SIN CONTROLAR y `WindowClient.navigate()`
 * —lo que usa `notificationclick`— rechaza con "Cannot navigate a window that
 * is not controlled". Se detectó exactamente así en un teléfono real
 * (Sprint 6). Desde el Sprint 8 es además lo que hace que el handler `fetch`
 * empiece a atender la pestaña actual sin esperar una recarga.
 *
 * El riesgo que el Sprint 6 dejó anotado para `claim()` con caché versionada
 * sigue acotado por lo mismo de siempre: los estáticos de Next tienen **URL con
 * hash de contenido**, así que un build nuevo no pisa las entradas del
 * anterior; `activate` **solo borra cachés de otra VERSIÓN** (`VERSION`, abajo,
 * se sube a mano); y una pestaña que pida un chunk que ya no está cae a la red
 * y sigue funcionando.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `install` NUNCA puede fallar
 *
 * Si la promesa de `install` rechaza, el service worker no se instala — y con
 * él se caen TAMBIÉN las notificaciones, que no tienen nada que ver con el
 * caché. Por eso la precarga de `/offline` está envuelta en un `try/catch` que
 * se traga cualquier error: sin red al instalar, el worker igual queda vivo y
 * la pantalla offline se precarga en la próxima activación.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Este archivo se sirve tal cual desde `public/`: no pasa por el compilador de
 * Next.js. Por eso es JavaScript plano de navegador, sin imports ni sintaxis
 * que dependa de un bundler. `tests/unit/sw-offline.test.ts` lo evalúa en un
 * contexto simulado y ejercita los helpers puros de abajo.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   NOTIFICACIONES (Sprint 6, tarea 6.3)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Ícono grande de la notificación (`scripts/generar-iconos-push.mjs`). */
const ICONO = "/icono-192.png"

/**
 * Silueta monocroma que Android pinta en la barra de estado. Si falta, Chrome
 * muestra un cuadrado gris genérico.
 */
const BADGE = "/badge-96.png"

/** A dónde se va si el payload no trae `url` (o si viene basura). */
const URL_POR_DEFECTO = "/inicio"

/**
 * Interpreta el cuerpo cifrado que mandó `lib/push/servidor.ts`.
 *
 * Tolerante a propósito: si el JSON no parsea -un push mandado a mano desde
 * otra herramienta, o una versión futura del servidor con otro formato- se
 * muestra igual algo razonable en vez de no mostrar NADA. En Chrome, un
 * handler `push` que no llama a `showNotification()` hace que el navegador
 * muestre por su cuenta un "Este sitio se actualizó en segundo plano", que es
 * peor que un aviso genérico nuestro.
 */
function leerPayload(event) {
  const porDefecto = {
    titulo: "Historial Médico",
    cuerpo: "Tenés un aviso nuevo.",
    url: URL_POR_DEFECTO,
    tag: undefined,
  }

  if (!event.data) {
    return porDefecto
  }

  let datos
  try {
    datos = event.data.json()
  } catch {
    const texto = event.data.text()
    return texto ? { ...porDefecto, cuerpo: texto } : porDefecto
  }

  if (!datos || typeof datos !== "object") {
    return porDefecto
  }

  // Solo se acepta una ruta relativa. Una URL absoluta acá haría que tocar la
  // notificación abriera un origen ajeno: el servidor ya lo valida
  // (`serializarPayload`), y esta es la segunda cerradura, del lado del
  // cliente, que no depende de que el emisor se haya portado bien.
  const url =
    typeof datos.url === "string" && datos.url.startsWith("/") && !datos.url.startsWith("//")
      ? datos.url
      : URL_POR_DEFECTO

  return {
    titulo: typeof datos.titulo === "string" && datos.titulo ? datos.titulo : porDefecto.titulo,
    cuerpo: typeof datos.cuerpo === "string" ? datos.cuerpo : porDefecto.cuerpo,
    url,
    tag: typeof datos.tag === "string" && datos.tag ? datos.tag : undefined,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CACHÉ OFFLINE (Sprint 8, tarea 8.4)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Versión del caché. **Se sube a mano cuando cambia la lógica de este
 * archivo**, no en cada deploy de la aplicación: `activate` borra todo lo que
 * lleve el prefijo y no sea de esta versión (ver el encabezado).
 *
 * `v2` (Sprint 11, tarea 11.3): entraron tres pantallas más a la caché
 * `paginas`. Subirla acá es lo que garantiza que un dispositivo que venía del
 * Sprint 8 arranque con las cinco cachés limpias en vez de arrastrar entradas
 * clasificadas con la matriz anterior.
 */
const VERSION = "v2"

/** Prefijo común. `activate` lo usa para no tocar cachés de otras apps del origen. */
const PREFIJO_CACHE = "historial-medico-"

const CACHE_SHELL = PREFIJO_CACHE + "shell-" + VERSION
const CACHE_ESTATICOS = PREFIJO_CACHE + "estaticos-" + VERSION
const CACHE_PAGINAS = PREFIJO_CACHE + "paginas-" + VERSION
const CACHE_DATOS = PREFIJO_CACHE + "datos-" + VERSION
const CACHE_IMAGENES = PREFIJO_CACHE + "imagenes-" + VERSION

/** Las cinco cachés vigentes. Cualquier otra con el prefijo se borra en `activate`. */
const CACHES_VIGENTES = [
  CACHE_SHELL,
  CACHE_ESTATICOS,
  CACHE_PAGINAS,
  CACHE_DATOS,
  CACHE_IMAGENES,
]

/**
 * Las tres familias de caché que guardan **datos personales**. Se borran al
 * llegar a `/login` (`lib/pwa/registrar-sw.ts#purgarCacheOffline`): un
 * teléfono compartido no puede conservar la ficha SOS de la sesión anterior.
 *
 * ⚠️ Esta lista está DUPLICADA en `lib/pwa/registrar-sw.ts` porque un archivo
 * de `public/` no se puede importar desde TypeScript. `tests/unit/sw-offline.test.ts`
 * verifica que las dos listas digan exactamente lo mismo.
 */
const FAMILIAS_CON_DATOS = ["paginas", "datos", "imagenes"]

/**
 * El único mensaje que hace que una versión nueva de este archivo pase a estar
 * al mando (Sprint 11, ver "EL CICLO DE ACTUALIZACIÓN" en el encabezado).
 *
 * ⚠️ Está DUPLICADO en `lib/pwa/registrar-sw.ts` por el mismo motivo que
 * `FAMILIAS_CON_DATOS`, y `tests/unit/sw-offline.test.ts` verifica que los dos
 * literales coincidan. Si divergen, el botón "Actualizar" deja de hacer nada y
 * **no hay forma de darse cuenta mirando la pantalla**: el aviso se muestra, se
 * toca, y no pasa absolutamente nada.
 */
const MENSAJE_SALTAR_ESPERA = "saltar-espera"

/** Pantalla pública de "sin conexión". Se precarga en `install`. */
const RUTA_OFFLINE = "/offline"

/** La ficha de emergencia: la pantalla que además se PRECARGA (no solo se cachea al visitarla). */
const RUTA_SOS = "/sos"

/**
 * Las cuatro pantallas con datos que se guardan para verse sin red, en el orden
 * en que las nombra el criterio de aceptación del Sprint 11: SOS, coberturas y
 * "la última lista de turnos y medicación".
 *
 * Las cuatro son Server Components que traen **los datos horneados en el HTML**
 * (no hay un endpoint JSON detrás que haga falta cachear aparte: el `fetch`
 * pasa por el servidor durante el render, no desde el navegador). Guardar el
 * HTML es guardar la lista. La única excepción son las miniaturas de
 * `/coberturas`, que el navegador pide por signed URL a Supabase y por lo tanto
 * **no** se ven sin red: los datos de la credencial —obra social, plan, número
 * de afiliado— sí, la foto no. `docs/offline.md` §3 y §8.
 *
 * ⚠️ Agregar una ruta acá **escribe datos de salud en el disco del teléfono**.
 * No es una lista de conveniencia: cada entrada tiene que justificarse contra
 * `docs/modelo-permisos.md` §8.1.
 */
const RUTAS_PAGINA_OFFLINE = ["/sos", "/coberturas", "/turnos", "/medicacion"]

/** Payload JSON del contrato (`docs/modelo-sos.md` §7), uno por perfil. */
const PREFIJO_API_SOS = "/api/sos/"

/** Estáticos de Next con hash de contenido en el nombre. */
const PREFIJO_ESTATICOS = "/_next/static/"

/** URL estable de la foto de una credencial. NUNCA una signed URL (ver encabezado). */
const PATRON_IMAGEN_CREDENCIAL = /^\/api\/credenciales\/[^/]+\/imagen$/

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Tope de entradas del caché de estáticos. Sin tope, cada build deja sus
 * chunks para siempre y el caché crece sin techo en el disco del teléfono.
 * Al pasarse se borran las entradas más viejas (la Cache API conserva el orden
 * de inserción en `keys()`).
 */
const TOPE_ESTATICOS = 150

/* ───────────────────────────── Helpers PUROS ─────────────────────────────
   Sin `fetch`, sin `caches`, sin estado. Son los que ejercita
   `tests/unit/sw-offline.test.ts` evaluando este archivo en un contexto
   simulado. Mantenerlos puros es lo que hace testeable un service worker.
   ─────────────────────────────────────────────────────────────────────── */

/**
 * Decide qué estrategia le toca a una request. **Es la matriz de
 * `docs/offline.md` §3 escrita en código**, y el único lugar donde se decide
 * qué se cachea.
 *
 * `esNavegacion` (`request.mode === "navigate"`) no es un detalle: Next.js
 * pide la MISMA URL de dos formas distintas -HTML en una navegación completa,
 * payload RSC (`text/x-component`) en una navegación del router-. Guardar las
 * dos bajo la misma clave dejaría el caché con un payload RSC que el navegador
 * intentaría mostrar como página. Por eso una pantalla solo entra al caché
 * cuando la request es una navegación de verdad; el RSC pasa de largo y, si
 * falla por falta de red, el router de Next cae a una navegación completa, que
 * sí encuentra el HTML cacheado.
 *
 * `busqueda` (`url.search`) tampoco es cosmético: es lo que mantiene **una
 * entrada por ruta** y lo que impide que un deep link de push
 * (`/turnos?perfil={id}`, que redirige) borre la copia buena de la lista. Ver
 * "UNA ENTRADA POR RUTA" en el encabezado.
 *
 * @param {string} pathname
 * @param {boolean} esNavegacion
 * @param {string} [busqueda] `url.search`: `""` o `"?perfil=…"`.
 * @returns {"estatico"|"pagina"|"datos-sos"|"imagen-credencial"|"navegacion"|"red"}
 */
function clasificarSolicitud(pathname, esNavegacion, busqueda) {
  // La imagen de credencial primero: se puede pedir como subrecurso de `<img>`
  // o como navegación (abrirla en una pestaña), y en los dos casos le toca la
  // misma estrategia.
  if (PATRON_IMAGEN_CREDENCIAL.test(pathname)) {
    return "imagen-credencial"
  }
  if (pathname.startsWith(PREFIJO_ESTATICOS)) {
    return "estatico"
  }
  if (pathname.startsWith(PREFIJO_API_SOS)) {
    return "datos-sos"
  }

  const sinQuery = !busqueda || busqueda === "?"
  if (esNavegacion && sinQuery && RUTAS_PAGINA_OFFLINE.indexOf(pathname) !== -1) {
    return "pagina"
  }
  if (esNavegacion) {
    return "navegacion"
  }
  return "red"
}

/**
 * Qué hacer con el caché ante una respuesta de red. **Es la decisión de
 * seguridad del archivo**, aislada acá justamente para poder probarla.
 *
 * - `"guardar"`: la respuesta es buena y viene de la ruta que se pidió.
 * - `"descartar"`: el servidor dijo que esta sesión ya no puede ver esto
 *   (401/403), que el recurso ya no existe (404), o **redirigió** —lo que en
 *   esta app significa `307 → /login`, o sea sesión vencida—. En los tres
 *   casos hay que **borrar la copia local**: es el mecanismo por el que una
 *   revocación de permiso se propaga al teléfono en cuanto vuelve la red.
 * - `"conservar"`: un 5xx o cualquier otra cosa rara. El servidor tuvo un mal
 *   momento; no es motivo para tirar la ficha de emergencia guardada.
 *
 * El caso `redirigido` es el más traicionero de los tres: `fetch` sigue las
 * redirecciones por defecto, así que un `307 → /login` llega acá como un
 * `200 OK` con el HTML del login. Sin este chequeo, el caché de `/sos`
 * terminaría conteniendo la pantalla de login.
 *
 * @param {number} estado
 * @param {boolean} redirigido
 * @param {boolean} mismaRuta
 * @returns {"guardar"|"descartar"|"conservar"}
 */
function decidirDestinoDeCache(estado, redirigido, mismaRuta) {
  if (redirigido || !mismaRuta) {
    return "descartar"
  }
  if (estado === 401 || estado === 403 || estado === 404) {
    return "descartar"
  }
  if (estado >= 200 && estado < 300) {
    return "guardar"
  }
  return "conservar"
}

/**
 * Cachés con el prefijo del proyecto que ya no corresponden a esta versión.
 * Nunca devuelve una caché ajena: si otra aplicación del mismo origen tiene la
 * suya, no es asunto de este worker.
 *
 * @param {string[]} nombres Todo lo que devolvió `caches.keys()`.
 * @param {string[]} vigentes
 * @returns {string[]}
 */
function cachesAEliminar(nombres, vigentes) {
  return nombres.filter(
    (nombre) => nombre.startsWith(PREFIJO_CACHE) && vigentes.indexOf(nombre) === -1,
  )
}

/**
 * Saca de un HTML las URL de los recursos que hay que cachear para que esa
 * página se vea COMPLETA sin red: los estáticos de Next (`/_next/static/...`,
 * hojas de estilo y chunks) y las fotos de credencial servidas por la URL
 * estable.
 *
 * Es una búsqueda por texto sobre atributos `href=` y `src=`, no un parser de
 * HTML: en un service worker no hay DOM (`DOMParser` no existe en el scope de
 * un worker). Alcanza de sobra porque las dos formas que interesan son
 * literales fijos generados por Next y por `components/sos/ficha-sos.tsx`, y
 * un falso negativo solo significa que ese recurso se cachea más tarde, cuando
 * el navegador lo pida por su cuenta.
 *
 * @param {string} html
 * @returns {string[]} Rutas absolutas del mismo origen, sin repetidos.
 */
function extraerRecursosDeHtml(html) {
  const encontradas = []
  const patron = /(?:href|src)="(\/[^"]*)"/g
  let coincidencia = patron.exec(html)

  while (coincidencia !== null) {
    // Las entidades HTML de un atributo: `&amp;` es la única que Next y React
    // generan en una URL (`?lado=front&amp;algo=`), y sin desescaparla el
    // `fetch` pediría una URL que no existe.
    const ruta = coincidencia[1].replace(/&amp;/g, "&")
    const soloRuta = ruta.split("#")[0]
    const sinQuery = soloRuta.split("?")[0]

    const interesa =
      sinQuery.startsWith(PREFIJO_ESTATICOS) || PATRON_IMAGEN_CREDENCIAL.test(sinQuery)

    if (interesa && encontradas.indexOf(soloRuta) === -1) {
      encontradas.push(soloRuta)
    }
    coincidencia = patron.exec(html)
  }

  return encontradas
}

/**
 * ¿Este estático se puede guardar para siempre?
 *
 * Solo si el servidor lo declara `immutable`, que es lo que hace `next start`
 * con `/_next/static/**` (URL con hash de contenido). **En `next dev` los
 * chunks NO son inmutables** y se sirven con `no-store`: cachearlos dejaría al
 * desarrollo sirviendo código viejo después de cada edición, el bug más
 * confuso posible. Por eso el modo offline se prueba contra
 * `next build && next start` (la propia documentación de Next lo dice) y en
 * `next dev` el caché de estáticos queda, correctamente, vacío.
 *
 * @param {string|null} cacheControl Header `Cache-Control` de la respuesta.
 * @returns {boolean}
 */
function esEstaticoGuardable(cacheControl) {
  return typeof cacheControl === "string" && cacheControl.indexOf("immutable") !== -1
}

/** Clave de caché estable: la URL absoluta sin fragmento. Ver `docs/offline.md` §5. */
function claveDeCache(url) {
  const limpia = new URL(url)
  limpia.hash = ""
  return limpia.href
}

/* ─────────────────────────── Helpers con efectos ─────────────────────────── */

/** Respuesta de último recurso cuando no hay red NI copia local. */
function respuestaSinConexion() {
  return new Response("Sin conexión y sin copia guardada de este recurso.", {
    status: 504,
    statusText: "Sin conexión",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}

/** La pantalla `/offline` precargada, o el texto pelado si ni eso hay. */
async function pantallaOffline() {
  const guardada = await caches.match(new URL(RUTA_OFFLINE, self.location.origin).href)
  return guardada || respuestaSinConexion()
}

/**
 * Aplica `decidirDestinoDeCache` a una respuesta ya obtenida.
 * Devuelve `true` si la respuesta quedó guardada.
 */
async function sincronizarCache(cache, clave, solicitudUrl, respuesta) {
  let mismaRuta = false
  try {
    // `respuesta.url` viene vacía en respuestas construidas a mano; con una
    // respuesta de red real siempre trae la URL FINAL (post-redirección).
    mismaRuta =
      !respuesta.url || new URL(respuesta.url).pathname === new URL(solicitudUrl).pathname
  } catch {
    mismaRuta = false
  }

  const destino = decidirDestinoDeCache(respuesta.status, respuesta.redirected === true, mismaRuta)

  if (destino === "guardar") {
    await cache.put(clave, respuesta.clone())
    return true
  }
  if (destino === "descartar") {
    await cache.delete(clave)
  }
  return false
}

/** Guarda en el caché de estáticos y recorta las entradas más viejas si se pasó del tope. */
async function guardarEstatico(cache, clave, respuesta) {
  await cache.put(clave, respuesta)

  const claves = await cache.keys()
  const sobran = claves.length - TOPE_ESTATICOS
  for (let i = 0; i < sobran; i += 1) {
    await cache.delete(claves[i])
  }
}

/* ─────────────────────────────── Estrategias ─────────────────────────────── */

/**
 * Cache-first para `/_next/static/**`. Son inmutables por hash de contenido:
 * si están, están bien, y no hay motivo para revalidarlos nunca.
 */
async function estrategiaEstatico(event, request) {
  const cache = await caches.open(CACHE_ESTATICOS)
  const clave = claveDeCache(request.url)

  const guardada = await cache.match(clave)
  if (guardada) {
    return guardada
  }

  const respuesta = await fetch(request)
  if (respuesta.ok && esEstaticoGuardable(respuesta.headers.get("Cache-Control"))) {
    event.waitUntil(guardarEstatico(cache, clave, respuesta.clone()))
  }
  return respuesta
}

/**
 * Red-primero con caída al caché. Es la estrategia de las cuatro pantallas de
 * `RUTAS_PAGINA_OFFLINE` y del payload JSON: **con red siempre gana el dato
 * fresco** —nadie debería leer una ficha de emergencia vieja, ni una lista de
 * turnos vieja, teniendo la nueva a un toque— y sin red aparece la última copia
 * bajada, que es exactamente lo que el producto promete ("la ÚLTIMA lista").
 */
async function estrategiaRedPrimero(request, nombreCache) {
  const cache = await caches.open(nombreCache)
  const clave = claveDeCache(request.url)

  try {
    const respuesta = await fetch(request)
    await sincronizarCache(cache, clave, request.url, respuesta)

    // Un 5xx transitorio no debería tapar la copia local, que sigue siendo
    // información válida y fechada.
    if (!respuesta.ok) {
      const guardada = await cache.match(clave)
      if (guardada) return guardada
    }
    return respuesta
  } catch {
    const guardada = await cache.match(clave)
    if (guardada) return guardada
    if (request.mode === "navigate") return pantallaOffline()
    return respuestaSinConexion()
  }
}

/**
 * Caché-primero con revalidación en segundo plano, para la foto de la
 * credencial.
 *
 * Es cache-first porque en una guardia la foto tiene que aparecer **ya**, sin
 * esperar un timeout de red. La revalidación en segundo plano es lo que hace
 * que esa comodidad no se convierta en un agujero: cuando hay red, la copia
 * local se refresca y —si el servidor contesta 401/403/404 porque el permiso
 * se revocó o la credencial se borró— `decidirDestinoDeCache` la **borra del
 * teléfono**.
 */
async function estrategiaImagenCredencial(event, request) {
  const cache = await caches.open(CACHE_IMAGENES)
  const clave = claveDeCache(request.url)
  const guardada = await cache.match(clave)

  const enRed = fetch(request).then(async (respuesta) => {
    await sincronizarCache(cache, clave, request.url, respuesta)
    return respuesta
  })

  if (guardada) {
    event.waitUntil(enRed.catch(() => undefined))
    return guardada
  }

  try {
    return await enRed
  } catch {
    if (request.mode === "navigate") return pantallaOffline()
    return respuestaSinConexion()
  }
}

/**
 * Cualquier otra navegación: red pura. Sin red, la pantalla `/offline` —clara,
 * en español y con un camino a las cuatro pantallas que sí están guardadas— en
 * vez del dinosaurio de Chrome. **No se cachea nada acá**: el resto de la app
 * no tiene copia local, a propósito.
 */
async function estrategiaNavegacion(request) {
  try {
    return await fetch(request)
  } catch {
    return pantallaOffline()
  }
}

/* ────────────────────────── Precarga y purga ────────────────────────── */

/**
 * Precarga la pantalla `/offline` y los estáticos que necesita para verse como
 * la app y no como texto pelado.
 *
 * Cachear solo el HTML no alcanza: sin su hoja de estilos, la pantalla de
 * "sin conexión" aparece sin diseño, que es justo la sensación de "esto se
 * rompió" que se quiere evitar. Por eso se lee el HTML y se precargan los
 * `/_next/static/**` que referencia (`extraerRecursosDeHtml`).
 */
async function precargarPantallaOffline() {
  const cache = await caches.open(CACHE_SHELL)
  const url = new URL(RUTA_OFFLINE, self.location.origin).href

  // `cache: "reload"` evita que el HTTP cache del navegador devuelva una copia
  // vieja justo en el momento de fundar el caché offline.
  const respuesta = await fetch(url, { cache: "reload", credentials: "same-origin" })
  if (!respuesta.ok || respuesta.redirected) {
    throw new Error("No se pudo precargar /offline")
  }

  const html = await respuesta.clone().text()
  await cache.put(url, respuesta)

  await precargarEstaticosDe(html)

  // El ícono lo usa la propia pantalla offline y ya está en `public/`.
  await cache.add(ICONO).catch(() => undefined)
}

/** Mete en el caché de estáticos los `/_next/static/**` que referencia un HTML. */
async function precargarEstaticosDe(html) {
  const cache = await caches.open(CACHE_ESTATICOS)
  const rutas = extraerRecursosDeHtml(html).filter((ruta) => ruta.startsWith(PREFIJO_ESTATICOS))

  for (const ruta of rutas) {
    const url = new URL(ruta, self.location.origin).href
    try {
      if (await cache.match(url)) continue
      const respuesta = await fetch(url, { credentials: "same-origin" })
      if (respuesta.ok && esEstaticoGuardable(respuesta.headers.get("Cache-Control"))) {
        await guardarEstatico(cache, url, respuesta)
      }
    } catch {
      // Un estático que no se pudo bajar se vuelve a intentar la próxima vez
      // que el navegador lo pida. No es motivo para abortar la precarga.
    }
  }
}

/**
 * Baja y guarda TODO lo que hace falta para que `/sos` abra completa sin red:
 * el HTML con los datos horneados, los estáticos que referencia, las fotos de
 * la credencial principal y el payload JSON del perfil.
 *
 * La dispara la página (`components/pwa/registro-service-worker.tsx`) con un
 * `postMessage`, una vez por sesión de pestaña y por perfil. **Que la haga el
 * worker y no la página no es un capricho**: apenas registrado, el service
 * worker todavía no controla la pestaña que lo registró, así que un `fetch`
 * hecho desde la página no pasaría por el handler `fetch` y no se cachearía
 * nada. Acá el worker escribe el caché directamente y esa carrera desaparece.
 *
 * Precargar en vez de esperar a que alguien abra `/sos` con red es el punto
 * entero de la tarea: "acordate de abrir la ficha antes de quedarte sin señal"
 * no es un producto, es una trampa.
 *
 * @param {string} perfilId UUID validado por quien llama.
 */
async function precargarSos(perfilId) {
  const origen = self.location.origin

  // 1. El HTML de la ficha, bajo la misma clave que usará la navegación.
  const urlSos = new URL(RUTA_SOS, origen).href
  let html = ""
  try {
    const cache = await caches.open(CACHE_PAGINAS)
    const respuesta = await fetch(urlSos, {
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    })
    const guardada = await sincronizarCache(cache, urlSos, urlSos, respuesta)
    if (guardada) {
      html = await respuesta.text()
    }
  } catch {
    // Sin red no hay nada que precargar; la copia anterior (si la hay) sigue
    // intacta porque `sincronizarCache` ni se llegó a ejecutar.
  }

  // 2. Lo que ese HTML necesita para verse completo.
  if (html) {
    await precargarEstaticosDe(html)
    await precargarImagenesDe(html)
  }

  // 3. El payload del contrato (`docs/modelo-sos.md` §7), uno por perfil.
  try {
    const cache = await caches.open(CACHE_DATOS)
    const urlPayload = new URL(PREFIJO_API_SOS + perfilId, origen).href
    const respuesta = await fetch(urlPayload, { credentials: "same-origin" })
    await sincronizarCache(cache, urlPayload, urlPayload, respuesta)
  } catch {
    // Ídem: la copia vieja sobrevive.
  }
}

/** Precarga las fotos de credencial que referencia un HTML de `/sos`. */
async function precargarImagenesDe(html) {
  const cache = await caches.open(CACHE_IMAGENES)
  const rutas = extraerRecursosDeHtml(html).filter((ruta) =>
    PATRON_IMAGEN_CREDENCIAL.test(ruta.split("?")[0]),
  )

  for (const ruta of rutas) {
    const url = new URL(ruta, self.location.origin).href
    try {
      const respuesta = await fetch(url, { credentials: "same-origin" })
      await sincronizarCache(cache, url, url, respuesta)
    } catch {
      // Ídem.
    }
  }
}

/** Borra las tres familias de caché con datos personales. Ver `FAMILIAS_CON_DATOS`. */
async function purgarCachesConDatos() {
  const nombres = await caches.keys()
  await Promise.all(
    nombres
      .filter(
        (nombre) =>
          nombre.startsWith(PREFIJO_CACHE) &&
          FAMILIAS_CON_DATOS.some((familia) => nombre.startsWith(PREFIJO_CACHE + familia + "-")),
      )
      .map((nombre) => caches.delete(nombre)),
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   HANDLERS
   ═══════════════════════════════════════════════════════════════════════════ */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        await precargarPantallaOffline()
      } catch {
        // Ver "install NUNCA puede fallar" en el encabezado: sin red al
        // instalar, el worker igual queda vivo y las notificaciones siguen
        // funcionando. La pantalla offline se precarga en la próxima
        // instalación.
      }

      // NO hay `skipWaiting()` acá (Sprint 11). Este worker se queda en
      // `waiting` hasta que la persona toque "Actualizar" en el aviso de
      // `components/pwa/aviso-actualizacion.tsx`, que manda el mensaje
      // `saltar-espera` (handler `message`, abajo). Ver "EL CICLO DE
      // ACTUALIZACIÓN" en el encabezado: mientras espera, el worker VIEJO sigue
      // activo y sigue atendiendo los pushes, así que la espera no cuesta
      // ninguna notificación.
      //
      // En la PRIMERA instalación no hay nada que esperar: sin un worker activo
      // al que desplazar, el navegador pasa de `installed` a `activated` solo.
      // El aviso no aparece en ese caso porque la página lo condiciona a que ya
      // exista un controlador (`lib/pwa/registrar-sw.ts#debeAvisarActualizacion`).
    })(),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Limpieza de versiones viejas ANTES de reclamar los clientes: así una
      // pestaña recién controlada nunca ve un caché a medio borrar.
      const nombres = await caches.keys()
      await Promise.all(cachesAEliminar(nombres, CACHES_VIGENTES).map((n) => caches.delete(n)))

      // `clients.claim()` hace que este service worker tome el control de las
      // pestañas que YA estaban abiertas, sin esperar a que se recarguen.
      //
      // No es cosmético: sin esto, la pestaña desde la que la persona acaba de
      // activar las notificaciones queda SIN CONTROLAR, y `WindowClient.navigate()`
      // -lo que usa `notificationclick` para llevarla al turno- rechaza con
      // "Cannot navigate a window that is not controlled". Se detectó exactamente
      // así en un teléfono real: la notificación se abría, la app pasaba al frente
      // y se quedaba en la pantalla donde estaba, en silencio.
      //
      // Desde el Sprint 8 también es lo que hace que el handler `fetch` empiece
      // a atender la pestaña actual sin esperar una recarga.
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request

  // Nada que hacer con escrituras: las Server Actions son `POST` a la ruta
  // donde se usan, y una respuesta de mutación no se cachea jamás.
  if (request.method !== "GET") {
    return
  }

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  // Otro origen (las signed URLs de Supabase Storage, por ejemplo): pasa de
  // largo. Ver "NUNCA se cachea una signed URL" en el encabezado.
  if (url.origin !== self.location.origin) {
    return
  }

  const estrategia = clasificarSolicitud(url.pathname, request.mode === "navigate", url.search)

  switch (estrategia) {
    case "estatico":
      event.respondWith(estrategiaEstatico(event, request))
      return
    case "pagina":
      event.respondWith(estrategiaRedPrimero(request, CACHE_PAGINAS))
      return
    case "datos-sos":
      event.respondWith(estrategiaRedPrimero(request, CACHE_DATOS))
      return
    case "imagen-credencial":
      event.respondWith(estrategiaImagenCredencial(event, request))
      return
    case "navegacion":
      event.respondWith(estrategiaNavegacion(request))
      return
    default:
      // `"red"`: no se intercepta. Que el navegador haga lo suyo.
      return
  }
})

/**
 * Mensajes de la página. Solo tres, y los tres con la forma validada: el `data`
 * de un `postMessage` es entrada no confiable como cualquier otra.
 *
 * El tercero (`saltar-espera`) es el que cierra el ciclo de actualización; ver
 * `MENSAJE_SALTAR_ESPERA` arriba y "EL CICLO DE ACTUALIZACIÓN" en el
 * encabezado.
 */
self.addEventListener("message", (event) => {
  const datos = event.data

  if (!datos || typeof datos !== "object") {
    return
  }

  if (datos.tipo === "precargar-sos" && PATRON_UUID.test(String(datos.perfilId))) {
    event.waitUntil(precargarSos(datos.perfilId))
    return
  }

  if (datos.tipo === "purgar-datos") {
    event.waitUntil(purgarCachesConDatos())
    return
  }

  // El único camino por el que una versión nueva de este archivo pasa a estar
  // al mando (Sprint 11). Lo manda `aplicarActualizacion()` al worker en
  // `waiting`, y solo después de que alguien toque "Actualizar".
  //
  // Que este mensaje llegue "de más" no rompe nada: `skipWaiting()` sobre un
  // worker que ya está activo no hace absolutamente nada, y sobre uno en
  // `waiting` hace exactamente lo que se pidió. Por eso no hace falta ninguna
  // validación extra más allá del tipo.
  if (datos.tipo === MENSAJE_SALTAR_ESPERA) {
    event.waitUntil(self.skipWaiting())
  }
})

self.addEventListener("push", (event) => {
  const payload = leerPayload(event)

  const opciones = {
    body: payload.cuerpo,
    icon: ICONO,
    badge: BADGE,
    lang: "es-AR",
    // `data` es lo único que sobrevive hasta `notificationclick`.
    data: { url: payload.url },
    // Dos avisos con el mismo tag se REEMPLAZAN en vez de apilarse: es la
    // antiduplicación del lado del dispositivo (ver `PayloadPush.tag`).
    ...(payload.tag ? { tag: payload.tag, renotify: true } : {}),
    // Vibración corta: perceptible sin ser alarmante. Un recordatorio de
    // turno no es una emergencia.
    vibrate: [120, 60, 120],
  }

  // `waitUntil` mantiene vivo al service worker hasta que la notificación se
  // muestra. Sin esto el navegador puede terminarlo antes y el aviso no
  // aparece nunca.
  event.waitUntil(self.registration.showNotification(payload.titulo, opciones))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const destino = new URL(event.notification.data?.url || URL_POR_DEFECTO, self.location.origin)

  event.waitUntil(
    (async () => {
      // `includeUncontrolled`: al abrir la app desde una notificación puede
      // haber pestañas que este SW todavía no controla (por ejemplo si se
      // registró después de que se abrieran). Sin esta opción no se las ve y
      // se termina abriendo una segunda pestaña de una app que ya estaba
      // abierta.
      const ventanas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })

      const mismoOrigen = ventanas.filter((ventana) => {
        try {
          return new URL(ventana.url).origin === destino.origin
        } catch {
          return false
        }
      })

      // 1. Ya hay una pestaña EXACTAMENTE en el destino: alcanza con traerla
      //    al frente.
      const exacta = mismoOrigen.find((ventana) => ventana.url === destino.href)
      if (exacta) {
        await exacta.focus()
        return
      }

      // 2. Hay una pestaña de la app en otra pantalla: se la navega y se la
      //    trae al frente.
      //
      //    El try/catch NO es decorativo. `navigate()` solo funciona sobre un
      //    cliente CONTROLADO por este service worker; si la pestaña se abrió
      //    antes de que el worker se activara, rechaza. El `clients.claim()`
      //    del handler `activate` cubre el caso normal, pero la carrera sigue
      //    existiendo (una notificación tocada en el segundo exacto en que el
      //    worker se está activando), y sin este catch la promesa rechazada se
      //    la traga `waitUntil`: la app pasa al frente, se queda donde estaba
      //    y no hay ningún error visible en ningún lado. Es exactamente el
      //    síntoma que apareció probando en un teléfono real.
      const abierta = mismoOrigen[0]
      if (abierta && "navigate" in abierta) {
        try {
          const navegada = await abierta.navigate(destino.href)
          await (navegada ?? abierta).focus()
          return
        } catch {
          // Se cae al paso 3: mejor una pestaña nueva en la pantalla correcta
          // que una vieja en la pantalla equivocada.
        }
      }

      // 3. No había ninguna pestaña usable: se abre una.
      await self.clients.openWindow(destino.href)
    })(),
  )
})
