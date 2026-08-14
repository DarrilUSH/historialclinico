/**
 * Registro del service worker — lado NAVEGADOR. **Punto único de registro de
 * toda la aplicación** (Sprint 8, tarea 8.4).
 *
 * Antes vivía en `lib/push/registrar-sw.ts`, cuando el worker servía solo para
 * notificaciones. Desde que además guarda el caché offline de la ficha SOS, la
 * dependencia correcta es al revés —el push es *un* consumidor del worker, no
 * su dueño—, así que el módulo se mudó acá y `lib/push/registrar-sw.ts` quedó
 * como reexportación para no tocar las pantallas de notificaciones.
 * **Hay un solo `navigator.serviceWorker.register()` en todo el proyecto y es
 * el de este archivo**: dos service workers en el mismo scope se pisan, el
 * último registrado gana, y las notificaciones se apagarían en silencio.
 *
 * ## El registro SÍ subió al arranque, y por qué eso cambió
 *
 * El Sprint 6 registraba el worker recién cuando la persona pedía activar los
 * recordatorios, por dos motivos: no gastar la primera carga en algo que no
 * todos iban a usar, y no instalar infraestructura antes de un gesto explícito
 * (el patrón que marca `mobile-ux-patterns`). Ese mismo archivo dejó anotado
 * que la PWA offline iba a invertir la decisión, y así fue:
 *
 * - El caché offline **no puede depender de un gesto**. "Activá el modo
 *   offline antes de quedarte sin señal" es exactamente el tipo de instrucción
 *   que nadie recuerda en una guardia; la ficha SOS tiene que estar en el
 *   teléfono *antes* de que haga falta.
 * - Registrar el worker no pide ningún permiso al sistema operativo. Lo que
 *   `mobile-ux-patterns` marca es pedir permisos en el pageload, y eso sigue
 *   sin pasar: `Notification.requestPermission()` continúa detrás del botón
 *   "Activar recordatorios" y ni se lo menciona acá.
 *
 * El registro se dispara desde `components/pwa/registro-service-worker.tsx`,
 * montado en el layout de `(con-nav)` —es decir, con sesión y perfil activo ya
 * resueltos—, no en el layout raíz: `/login` y `/registro` no tienen ninguna
 * ficha que precargar.
 */

/** Scope y ruta del service worker. Un solo SW para toda la app (ver `public/sw.js`). */
const RUTA_SW = "/sw.js"

/**
 * Familias de caché que guardan datos personales, tal como las nombra
 * `public/sw.js`.
 *
 * ⚠️ La lista está DUPLICADA a propósito: `public/sw.js` se sirve tal cual
 * desde `public/` y no se puede importar desde TypeScript. `tests/unit/sw-offline.test.ts`
 * lee el archivo real y verifica que las dos listas digan lo mismo, así que la
 * duplicación no puede divergir en silencio.
 */
const PREFIJO_CACHE = "historial-medico-"
const FAMILIAS_CON_DATOS = ["paginas", "datos", "imagenes"] as const

/**
 * ¿Este navegador soporta service workers?
 *
 * Es la única condición que necesita el modo offline. Falta en contextos no
 * seguros y en el modo incógnito de algunos navegadores.
 *
 * Contempla el render en servidor (`typeof window === "undefined"`), donde
 * nada de esto existe.
 */
export function haySoporteServiceWorker(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator
}

/**
 * ¿Este navegador puede recibir Web Push?
 *
 * Es **más estricto** que `haySoporteServiceWorker`, y los tres chequeos son
 * necesarios sin que ninguno implique a los otros:
 * - `serviceWorker`: donde vive el handler `push`.
 * - `PushManager`: **Safari en iOS solo lo expone si la app fue agregada a la
 *   pantalla de inicio**. En el Safari normal esta comprobación da `false`, y
 *   está bien que dé `false`: ahí no hay push posible.
 * - `Notification`: la API de presentación.
 *
 * Que sean dos funciones distintas importa: en ese Safari sin `PushManager`
 * **el modo offline igual funciona**, y usar la comprobación de push para
 * decidir si se registra el worker le sacaría la ficha SOS offline a todo un
 * sistema operativo por una capacidad que no tiene nada que ver.
 */
export function haySoportePush(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

/**
 * Registra `/sw.js` y espera a que quede LISTO para usarse.
 *
 * `navigator.serviceWorker.ready` no es decorativo: `register()` resuelve
 * apenas el navegador acepta el archivo, pero `pushManager.subscribe()`
 * necesita un registro ya *activo*. Sin la espera, la primera activación
 * falla con `InvalidStateError` en un navegador limpio y funciona en el
 * segundo intento — el peor tipo de bug, el que no se reproduce cuando lo
 * mirás.
 *
 * Devuelve `null` si el navegador no soporta service workers; propaga el
 * error si el registro falla de verdad (archivo inaccesible, contexto no
 * seguro), para que la interfaz pueda decirlo.
 */
export async function registrarServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!haySoporteServiceWorker()) {
    return null
  }

  await navigator.serviceWorker.register(RUTA_SW, { scope: "/" })
  return navigator.serviceWorker.ready
}

/**
 * Devuelve el registro existente sin crear uno nuevo.
 *
 * Sirve para la carga inicial de la pantalla de notificaciones: hay que saber
 * si ya hay una suscripción activa SIN instalar un service worker de paso.
 */
export async function obtenerRegistroExistente(): Promise<ServiceWorkerRegistration | null> {
  if (!haySoporteServiceWorker()) {
    return null
  }
  return (await navigator.serviceWorker.getRegistration("/")) ?? null
}

/**
 * Le pide al service worker que baje y guarde todo lo necesario para que
 * `/sos` abra completa sin red, para ESTE perfil.
 *
 * **Se lo pide al worker en vez de hacerlo acá.** Un `fetch()` desde la página
 * recién registrada no pasaría por el handler `fetch` del worker —todavía no
 * controla esta pestaña— y no se cachearía nada: una carrera que aparece solo
 * en la primera visita, es decir justo en la que importa. El worker, en
 * cambio, escribe su caché directamente.
 *
 * No devuelve nada ni espera confirmación a propósito: es una mejora de fondo,
 * no un paso del que dependa ninguna pantalla.
 */
export function precargarFichaSos(
  registro: ServiceWorkerRegistration,
  perfilId: string,
): void {
  const trabajador = registro.active
  if (!trabajador) {
    return
  }
  trabajador.postMessage({ tipo: "precargar-sos", perfilId })
}

/**
 * Borra del dispositivo las cachés con datos personales (ficha SOS, payload y
 * fotos de credenciales).
 *
 * **Se llama al llegar a `/login`**, no al tocar "Cerrar sesión". Es a
 * propósito y cubre más casos: a `/login` se llega también cuando la sesión
 * vence sola y cuando `proxy.ts` rebota a alguien sin cookie, situaciones en
 * las que nadie tocó ningún botón pero el resultado es el mismo —este
 * dispositivo ya no tiene una sesión que justifique tener guardada la ficha de
 * salud de nadie—. Y `/login` es, por `esRutaSoloAnonima`, una pantalla a la
 * que no se llega con sesión activa: no puede borrar el caché de una sesión
 * viva por accidente.
 *
 * Usa la Cache API directamente en vez de pasar por el worker porque
 * `caches` también existe en el scope de la ventana, y así la purga funciona
 * aunque el service worker no esté activo (o no exista, en un navegador que no
 * los soporta).
 *
 * Nunca lanza: una purga fallida no puede impedirle a nadie iniciar sesión.
 */
export async function purgarCacheOffline(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) {
    return
  }

  try {
    const nombres = await caches.keys()
    await Promise.all(
      nombres
        .filter((nombre) =>
          FAMILIAS_CON_DATOS.some((familia) =>
            nombre.startsWith(`${PREFIJO_CACHE}${familia}-`),
          ),
        )
        .map((nombre) => caches.delete(nombre)),
    )
  } catch {
    // Storage lleno, modo privado, permisos del navegador: nada de esto
    // justifica romper la pantalla de login.
  }
}
