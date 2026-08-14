/**
 * Matriz de rutas públicas / privadas de la aplicación.
 *
 * Es **lógica pura**: no importa `next/headers`, ni el cliente de Supabase,
 * ni toca la red. Eso la hace testeable sin levantar nada
 * (`tests/unit/rutas.test.ts`) y usable desde los tres lugares que la
 * necesitan: el borde (`proxy.ts`), las guardas de servidor
 * (`lib/auth/guardas.ts`) y la pantalla de login (para el `?desde=`).
 *
 * Regla del proyecto: **privado por defecto**. Todo lo que no esté declarado
 * público acá exige sesión — incluidas las rutas que todavía no existen
 * (`/estudios`, `/turnos`, `/familia`, ...). Agregar una pantalla nueva no
 * requiere acordarse de protegerla; requiere acordarse de *desprotegerla* si
 * de verdad tiene que ser pública. Es el sentido correcto del olvido para una
 * app que guarda datos de salud.
 */

/** Nombre del parámetro que recuerda a dónde volver después de iniciar sesión. */
export const PARAM_DESDE = "desde"

/** Pantalla de login: destino de quien entra sin sesión a una ruta privada. */
export const RUTA_LOGIN = "/login"

/** Destino por defecto después de iniciar sesión (selector de perfiles). */
export const RUTA_POST_LOGIN = "/perfiles"

/**
 * El service worker (`public/sw.js`), que **tiene que ser público** aunque no
 * sea una pantalla.
 *
 * `navigator.serviceWorker.register()` descarga el script con una request que
 * NO sigue redirecciones: si el proxy le contesta `307 → /login`, el registro
 * falla con `The script resource is behind a redirect, which is disallowed` y
 * las notificaciones no funcionan nunca. Y la regla "privado por defecto" de
 * este archivo hace justamente eso, porque el `matcher` de `proxy.ts` solo
 * excluye imágenes y los estáticos de `_next`, no un `.js` de `public/`.
 *
 * Que sea público no expone nada: `sw.js` es código que se descarga igual
 * dentro de cualquier bundle del cliente y no contiene ni un dato de nadie.
 * Además el navegador lo pide SIN cookies en el registro inicial, así que
 * "protegerlo" con la sesión sería, además de inútil, imposible.
 *
 * Se descubrió probando en un teléfono real: en la máquina de desarrollo el
 * archivo se sirve igual de mal (`307`) y nada lo delata hasta que se intenta
 * registrar el worker.
 */
export const RUTA_SERVICE_WORKER = "/sw.js"

/**
 * Barrido de recordatorios de turnos (Sprint 6.4). **"Público" acá significa
 * "no lo autentica la cookie de sesión", NO "cualquiera puede llamarlo".**
 *
 * Quien lo consume es `pg_cron` a través de `pg_net`: un proceso de la base de
 * datos, sin navegador, sin cookies y sin ninguna cuenta con la cual iniciar
 * sesión. La sesión de Supabase es el mecanismo equivocado para esta request,
 * y dejarla bajo la regla "privado por defecto" solo produce un `401` que
 * ningún login puede resolver.
 *
 * La autenticación la hace el propio Route Handler
 * (`app/api/push/procesar-recordatorios/route.ts`) comparando el header
 * `x-cron-secret` contra `CRON_SECRET` en tiempo constante, y sin la variable
 * cargada responde `503` en vez de quedar abierto. El endpoint no devuelve
 * ningún dato -tres números- ni acepta parámetros: no se le puede pedir que le
 * mande una notificación a nadie en particular.
 *
 * Mismo criterio que `RUTA_SERVICE_WORKER`: la excepción se declara con nombre
 * propio, comentada, y `tests/unit/rutas.test.ts` la cubre.
 */
export const RUTA_CRON_RECORDATORIOS = "/api/push/procesar-recordatorios"

/**
 * Barrido de alertas de renovación de receta (Sprint 7.4). Misma excepción y
 * mismo razonamiento que `RUTA_CRON_RECORDATORIOS`, del que es gemelo: lo llama
 * `pg_cron` a través de `pg_net`, dos veces por día, y se autentica con el
 * mismo header `x-cron-secret` contra la misma variable `CRON_SECRET`.
 *
 * Se declara con nombre propio en vez de hacer pública toda la rama
 * `/api/push/`: `/api/push/probar` y `/api/push/suscribir` tienen que seguir
 * exigiendo sesión, y una regla por prefijo se las llevaría puestas.
 */
export const RUTA_CRON_ALERTAS_MEDICACION = "/api/push/procesar-alertas-medicacion"

/**
 * Pantalla de "sin conexión" (Sprint 8.4, `app/offline/page.tsx`). Es pública
 * por dos motivos independientes, y cada uno alcanzaría solo:
 *
 * 1. **El service worker la precarga durante `install`**, con un `fetch` que
 *    puede ocurrir antes de que exista cualquier sesión. Si el proxy
 *    respondiera `307 → /login`, lo que quedaría guardado en el teléfono sería
 *    la pantalla de login, y el modo offline mostraría "iniciá sesión" a
 *    alguien que ya tiene la sesión abierta y solo se quedó sin señal.
 * 2. **Es la respuesta a una navegación fallida**, incluidas las de alguien
 *    sin sesión. Mandarlo al login sin red produciría otra navegación fallida:
 *    un rebote que termina en el error del navegador, que es exactamente lo
 *    que esta pantalla viene a evitar.
 *
 * Que sea pública no expone nada: la pantalla **no consulta absolutamente
 * nada** —vive fuera de `app/(app)/`, no llama a `obtenerPerfilActivo()` y es
 * estática—, precisamente porque queda escrita en el disco del dispositivo y
 * sobrevive al cierre de sesión.
 */
export const RUTA_OFFLINE = "/offline"

/**
 * El manifest de instalación (Sprint 11, tarea 11.1: `app/manifest.ts`, que
 * Next resuelve a esta ruta exacta). Misma familia de excepción que
 * `RUTA_SERVICE_WORKER`: Chrome lo pide para decidir si la app es
 * instalable, y esa comprobación puede ocurrir sin sesión (la primera vez
 * que alguien llega a `/login`, el navegador ya puede estar evaluando
 * instalabilidad en segundo plano). Un `307 → /login` acá no es JSON válido
 * de manifest: Chrome lo descarta en silencio y la app deja de ofrecerse
 * como instalable, sin ningún error visible.
 *
 * A diferencia de los íconos (`public/icons/*.png`), que el `matcher` de
 * `proxy.ts` ya excluye por extensión de imagen, `/manifest.webmanifest` no
 * tiene una extensión de imagen y sí llega al proxy — necesita esta
 * excepción con nombre propio. `tests/unit/rutas.test.ts` la cubre.
 */
export const RUTA_MANIFEST = "/manifest.webmanifest"

/**
 * Rutas públicas: se sirven con o sin sesión. Cada entrada cubre la ruta
 * exacta y sus subrutas (`/recuperar` cubre `/recuperar/confirmar`), salvo
 * `/` que se compara exacta —si no, cubriría toda la aplicación—.
 */
export const RUTAS_PUBLICAS = [
  "/",
  "/login",
  "/registro",
  "/recuperar",
  RUTA_SERVICE_WORKER,
  RUTA_OFFLINE,
  RUTA_MANIFEST,
  RUTA_CRON_RECORDATORIOS,
  RUTA_CRON_ALERTAS_MEDICACION,
] as const

/**
 * Rutas que solo tienen sentido sin sesión: si ya hay sesión activa, entrar
 * acá manda al selector de perfiles en vez de mostrarle un formulario de
 * login a alguien que ya está adentro.
 *
 * `/recuperar` NO está en esta lista a propósito: cambiar la contraseña con
 * la sesión abierta es un caso legítimo, y a `/recuperar/confirmar` se llega
 * con una sesión recién creada por el enlace del correo.
 */
export const RUTAS_SOLO_ANONIMAS = ["/login", "/registro"] as const

/**
 * Rutas de diagnóstico públicas **solo en desarrollo**. En producción
 * `/estado` y `/estilos` ya se autobloquean con `notFound()`, pero igual no se declaran
 * públicas ahí: defensa en profundidad, por si mañana alguien saca ese guard.
 */
export const RUTAS_PUBLICAS_DEV = ["/estado", "/estilos"] as const

/** Prefijo de los Route Handlers. Sin sesión responden 401, no redirect. */
export const PREFIJO_API = "/api"

export interface OpcionesDeRuta {
  /**
   * Si se consideran públicas las rutas de `RUTAS_PUBLICAS_DEV`.
   * Por defecto se deduce de `NODE_ENV`; los tests lo pasan explícito.
   */
  incluirRutasDeDesarrollo?: boolean
}

/**
 * Normaliza el pathname para comparar: garantiza barra inicial y saca las
 * barras finales (`/login/` y `/login` son la misma pantalla para Next).
 */
function normalizarRuta(pathname: string): string {
  const conBarraInicial = pathname.startsWith("/") ? pathname : `/${pathname}`
  const sinBarraFinal = conBarraInicial.replace(/\/+$/, "")
  return sinBarraFinal === "" ? "/" : sinBarraFinal
}

/** ¿`ruta` es exactamente `base` o una subruta suya? (`/` solo matchea exacto). */
function coincideConBase(ruta: string, base: string): boolean {
  if (base === "/") {
    return ruta === "/"
  }
  return ruta === base || ruta.startsWith(`${base}/`)
}

function enDesarrollo(opciones: OpcionesDeRuta): boolean {
  return opciones.incluirRutasDeDesarrollo ?? process.env.NODE_ENV !== "production"
}

/** Se puede servir sin sesión. */
export function esRutaPublica(pathname: string, opciones: OpcionesDeRuta = {}): boolean {
  const ruta = normalizarRuta(pathname)

  if (RUTAS_PUBLICAS.some((base) => coincideConBase(ruta, base))) {
    return true
  }

  return (
    enDesarrollo(opciones) &&
    RUTAS_PUBLICAS_DEV.some((base) => coincideConBase(ruta, base))
  )
}

/** Exige sesión. Es el complemento exacto de `esRutaPublica`. */
export function esRutaPrivada(pathname: string, opciones: OpcionesDeRuta = {}): boolean {
  return !esRutaPublica(pathname, opciones)
}

/** Con sesión activa, estas rutas redirigen al selector de perfiles. */
export function esRutaSoloAnonima(pathname: string): boolean {
  const ruta = normalizarRuta(pathname)
  return RUTAS_SOLO_ANONIMAS.some((base) => coincideConBase(ruta, base))
}

/** Route Handler: sin sesión responde 401 en JSON en vez de redirigir a una pantalla. */
export function esRutaDeApi(pathname: string): boolean {
  return coincideConBase(normalizarRuta(pathname), PREFIJO_API)
}

/**
 * Caracteres de control (C0 y DEL). Se detectan recorriendo la cadena y no
 * con una expresión regular, para no meter bytes de control en el código
 * fuente: un carácter de control literal dentro de un `.ts` es exactamente el
 * tipo de cosa que rompe un diff, un editor o una auditoría de charset.
 */
function tieneCaracteresDeControl(valor: string): boolean {
  for (let i = 0; i < valor.length; i += 1) {
    const codigo = valor.charCodeAt(i)
    if (codigo < 0x20 || codigo === 0x7f) {
      return true
    }
  }
  return false
}

/**
 * Valida el `?desde=` antes de redirigir a él. Sin esta validación, un enlace
 * `/login?desde=https://sitio-falso.ar` convertiría al login propio en un
 * trampolín de phishing con dominio legítimo (open redirect).
 *
 * Se acepta únicamente una ruta interna: barra inicial, sin `//` ni `/\`
 * (que el navegador interpreta como protocol-relative → dominio externo) y
 * sin caracteres de control (partirían el header `Location`). También se
 * descartan las rutas solo-anónimas, porque volver a `/login` después de
 * loguearse sería un rebote infinito.
 */
export function destinoSeguro(valor: string | null | undefined): string | null {
  if (typeof valor !== "string" || valor.length === 0) {
    return null
  }
  if (!valor.startsWith("/") || valor.startsWith("//") || valor.startsWith("/\\")) {
    return null
  }
  if (tieneCaracteresDeControl(valor)) {
    return null
  }

  const soloPathname = valor.split(/[?#]/)[0]
  if (esRutaSoloAnonima(soloPathname)) {
    return null
  }

  return valor
}

/**
 * Arma la URL de login que preserva el destino original.
 * Devuelve `/login` pelado si el destino no pasa `destinoSeguro`.
 */
export function rutaDeLoginCon(desde: string | null | undefined): string {
  const destino = destinoSeguro(desde)
  if (!destino) {
    return RUTA_LOGIN
  }
  return `${RUTA_LOGIN}?${PARAM_DESDE}=${encodeURIComponent(destino)}`
}
