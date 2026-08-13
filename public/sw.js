/**
 * Service Worker de Historial Médico — Sprint 6, tarea 6.3.
 *
 * ALCANCE DE ESTE ARCHIVO, HOY: **solo notificaciones**. Dos handlers, `push`
 * y `notificationclick`, y nada más.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRATO CON LOS SPRINTS QUE VIENEN — leer antes de agregar nada acá.
 *
 * · **Nada de caching todavía.** No hay `install` con `cache.addAll`, no hay
 *   `fetch` con estrategias, no hay página offline. Eso es la tarea de PWA
 *   instalable + modo offline (Sprint 8 / Sprint 11, skill `init-pwa`), que
 *   tiene que decidir con cuidado qué se puede guardar en el dispositivo:
 *   este producto sirve documentos médicos por signed URLs de vida corta y
 *   una estrategia de caché ingenua los dejaría escritos en el disco del
 *   celular, sobreviviendo a la revocación del permiso familiar
 *   (`docs/modelo-permisos.md` §8.1). No es una omisión: es una decisión
 *   deliberada de no meter un `fetch` handler hasta que exista la lista
 *   explícita de qué se cachea y qué NO.
 *
 * · **Un solo service worker.** Cuando llegue el Sprint 8/11, se AMPLÍA este
 *   archivo; no se registra un segundo SW. Dos service workers en el mismo
 *   scope se pisan: el último registrado gana y las notificaciones se
 *   apagarían en silencio.
 *
 * · **`skipWaiting()` + `clients.claim()` — y por qué, hoy, corresponden.**
 *   Sin ellos, una versión nueva de este archivo queda en estado `waiting`
 *   hasta que se cierren TODAS las pestañas de la app, y en un celular las
 *   pestañas no se cierran nunca: se verificó en un teléfono real, donde una
 *   corrección del handler `notificationclick` se quedó esperando detrás de
 *   pestañas abiertas hacía horas, con el worker viejo atendiendo los pushes.
 *   Para un worker que SOLO muestra notificaciones -sin caché, sin handler
 *   `fetch`, sin estado que migrar- activar la versión nueva de inmediato no
 *   tiene ningún riesgo y es la única forma de que un arreglo llegue.
 *
 *   **Esto cambia cuando llegue el caché (Sprint 8/11).** Con caché
 *   versionada, tomar el control de una pestaña ya cargada puede dejarla
 *   pidiendo chunks que la versión nueva ya borró. Esa tarea tiene que
 *   revisar estas dos líneas juntas y decidir entre versionar el caché con
 *   cuidado o avisar a la pestaña para que se recargue. El invariante que las
 *   habilita hoy es "este SW no sirve ni un byte de red".
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Este archivo se sirve tal cual desde `public/`: no pasa por el compilador de
 * Next.js. Por eso es JavaScript plano de navegador, sin imports ni sintaxis
 * que dependa de un bundler.
 */

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

self.addEventListener("install", (event) => {
  // Ver el contrato del encabezado: sin esto, una versión nueva espera a que
  // se cierren todas las pestañas de la app, cosa que en un celular no pasa
  // nunca. Es seguro mientras este worker no tenga handler `fetch`.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
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
  // Es seguro justamente porque este service worker NO tiene handler `fetch`:
  // tomar el control no cambia cómo se sirve ni una sola request. El día que
  // se agregue caché (Sprint 8/11) hay que volver a mirar esta línea junto con
  // el versionado del caché.
  event.waitUntil(self.clients.claim())
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
