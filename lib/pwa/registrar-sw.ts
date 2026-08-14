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
 *
 * ## Sprint 11 (tarea 11.3): este archivo también maneja el ciclo de actualización
 *
 * `public/sw.js` dejó de llamar a `skipWaiting()` en `install`. La mitad
 * navegador de esa decisión vive acá abajo (`debeAvisarActualizacion`,
 * `vigilarActualizacion`, `aplicarActualizacion`) y su interfaz en
 * `components/pwa/aviso-actualizacion.tsx`. El motivo completo está en el
 * encabezado de `public/sw.js`.
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
 * Mensaje que le pide al worker en espera que se ponga al mando
 * (`self.skipWaiting()`).
 *
 * ⚠️ Mismo caso de duplicación que `FAMILIAS_CON_DATOS`: el literal está
 * también en `public/sw.js` y `tests/unit/sw-offline.test.ts` verifica que
 * coincidan. Si divergen, el botón "Actualizar" deja de hacer nada **sin
 * ningún síntoma visible**: el aviso aparece, se toca, y no pasa nada.
 */
const MENSAJE_SALTAR_ESPERA = "saltar-espera"

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

/* ─────────────────── Ciclo de actualización (Sprint 11, 11.3) ───────────────────
   Desde esta tarea `public/sw.js` NO llama a `skipWaiting()` en `install`: una
   versión nueva se instala y espera. Estas tres funciones son el otro extremo
   del ciclo —detectar la espera, avisarle a la persona y aplicarla cuando lo
   pida—. El porqué completo está en el encabezado de `public/sw.js`, sección
   "EL CICLO DE ACTUALIZACIÓN"; la interfaz está en
   `components/pwa/aviso-actualizacion.tsx`.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * ¿Hay que mostrar el aviso "hay una versión nueva"?
 *
 * Función pura, separada del DOM justamente para poder probarla
 * (`tests/unit/actualizacion-sw.test.ts`), porque encierra la única regla del
 * ciclo que es fácil de romper y difícil de ver rota:
 *
 * - **`hayEnEspera`**: existe un worker instalado que no llegó a activarse. Sin
 *   esto no hay nada que aplicar y el botón "Actualizar" no tendría a quién
 *   mandarle el mensaje.
 * - **`hayControlador`** (`navigator.serviceWorker.controller !== null`): esta
 *   pestaña ya está siendo atendida por un worker. Es lo que distingue "hay una
 *   versión nueva" de "es la primera vez que se instala". En la primera
 *   instalación el worker se activa solo, sin desplazar a nadie, y avisar ahí
 *   sería pedirle a alguien que actualice una app que acaba de abrir por
 *   primera vez — y peor, la recarga posterior sería una recarga sorpresa en la
 *   primera visita.
 */
export function debeAvisarActualizacion(estado: {
  hayEnEspera: boolean
  hayControlador: boolean
}): boolean {
  return estado.hayEnEspera && estado.hayControlador
}

/**
 * Avisa (una vez, y cada vez que aparezca una versión nueva) mientras la
 * pantalla esté montada. Devuelve la función de limpieza.
 *
 * Cubre los dos caminos por los que aparece un worker en espera, que no son
 * intercambiables:
 *
 * 1. **Ya estaba esperando al montar.** Pasa siempre que la persona recarga la
 *    app con una versión nueva ya instalada de una visita anterior — que en un
 *    celular es el caso NORMAL, no el raro. Sin esta comprobación inicial, el
 *    aviso solo aparecería en la ventana de segundos en la que el worker se
 *    instala, y la actualización quedaría enterrada para siempre.
 * 2. **Se instala mientras la pantalla está abierta** (`updatefound` →
 *    `statechange` hasta `installed`).
 *
 * La condición se evalúa en el momento de avisar, no al suscribirse: en la
 * primera visita `navigator.serviceWorker.controller` es `null` al montar y
 * pasa a existir cuando el worker recién instalado llama a `clients.claim()`.
 */
export function vigilarActualizacion(
  registro: ServiceWorkerRegistration,
  alDetectar: () => void,
): () => void {
  if (!haySoporteServiceWorker()) {
    return () => {}
  }

  function evaluar(): void {
    if (
      debeAvisarActualizacion({
        hayEnEspera: Boolean(registro.waiting),
        hayControlador: Boolean(navigator.serviceWorker.controller),
      })
    ) {
      alDetectar()
    }
  }

  evaluar()

  const limpiezas: Array<() => void> = []

  function alEncontrarVersion(): void {
    const entrante = registro.installing
    if (!entrante) {
      return
    }
    const alCambiarEstado = () => {
      // `installed` es el estado en el que el worker quedó listo pero todavía
      // no tomó el control. Es exactamente el momento del aviso.
      if (entrante.state === "installed") {
        evaluar()
      }
    }
    entrante.addEventListener("statechange", alCambiarEstado)
    limpiezas.push(() => entrante.removeEventListener("statechange", alCambiarEstado))
  }

  registro.addEventListener("updatefound", alEncontrarVersion)

  return () => {
    registro.removeEventListener("updatefound", alEncontrarVersion)
    for (const limpiar of limpiezas) {
      limpiar()
    }
  }
}

/**
 * Marca de "ya pedimos la actualización en esta carga de página".
 *
 * Vive a nivel de módulo (no en un `useState`) porque tiene que sobrevivir a
 * cualquier desmontaje o re-render del aviso: lo que protege es la RECARGA, y
 * una recarga duplicada no es un detalle cosmético — dos `location.reload()`
 * encadenados sobre un worker que está cambiando son la receta del bucle de
 * recarga infinita, el modo de fallar más citado de este patrón.
 */
let actualizacionEnCurso = false

/**
 * Le pide al worker en espera que se ponga al mando y recarga la pantalla UNA
 * vez, cuando el cambio se concretó.
 *
 * **La recarga cuelga de `controllerchange`, no de un `setTimeout`.** Ese
 * evento es la señal de que el worker nuevo ya está activo Y ya reclamó esta
 * pestaña (`clients.claim()` en `activate`): recargar antes serviría la página
 * vieja otra vez, y recargar "por las dudas" a los N milisegundos sería
 * adivinar.
 *
 * **Por qué el listener se registra acá y no al arrancar la app.**
 * `controllerchange` también se dispara en la PRIMERA instalación, cuando el
 * worker recién activado reclama una pestaña que no tenía controlador. Un
 * listener global recargaría la app en medio de la primera visita, sin que
 * nadie haya pedido nada. Al colgarlo del gesto —y con `once: true`— solo
 * puede dispararse por la actualización que la persona aceptó.
 *
 * **La sesión no se toca.** Recargar no borra ninguna cookie; la purga de
 * cachés con datos cuelga de `/login` (`purgarCacheOffline`), no de una
 * recarga. Después de actualizar se sigue en la misma pantalla, con la misma
 * sesión y el mismo perfil activo.
 */
export function aplicarActualizacion(registro: ServiceWorkerRegistration): void {
  const enEspera = registro.waiting

  if (!enEspera || actualizacionEnCurso) {
    return
  }
  actualizacionEnCurso = true

  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => {
      window.location.reload()
    },
    { once: true },
  )

  enEspera.postMessage({ tipo: MENSAJE_SALTAR_ESPERA })
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
