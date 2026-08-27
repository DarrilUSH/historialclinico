/**
 * Los enlaces que CAMBIAN el perfil activo, y la regla que los protege del
 * prefetch.
 *
 * Este archivo no lleva `import "server-only"` a propósito: la mitad de arriba
 * (detección de prefetch, la respuesta vacía) la usan los Route Handlers en el
 * servidor, y la de abajo (`esRutaDeEnlaceDePerfil`) la usan componentes
 * cliente para no prefetchear lo que no se debe. Todo lo de acá es puro: no
 * importa nada de `lib/perfil-activo.ts` —que sí es `server-only`— para no
 * arrastrar el servidor al bundle del cliente.
 *
 * ## El bug que existe este archivo para que no vuelva
 *
 * Capturado con un espía CDP contra el teléfono real, en producción, y
 * reproducido dos veces idéntico en noventa segundos:
 *
 *     9,3 s   POST /perfiles                              ← elegir a León
 *    11,0 s   Set-Cookie: perfil_activo=<León>            ← correcto
 *    11,4 s   GET /familia/enlace?perfil=<Darío>&_rsc=…   ← PREFETCH del router
 *    13,1 s   Set-Cookie: perfil_activo=<Darío>           ← ¡lo revirtió!
 *
 * La pantalla `/familia`, vista desde un perfil gestionado, dibuja un enlace a
 * `/familia/enlace?perfil=<el propio>` (el CTA "Compartí con tu familia", que
 * tiene que operar sobre el perfil de la CUENTA y no sobre el que se está
 * mirando). El router de Next prefetchea los `<Link>` que entran en pantalla
 * —eso es lo que tiene que hacer—, y ese prefetch **ejecutó el Route Handler**:
 * `fijarPerfilActivo`, `Set-Cookie`, auditoría y todo. Dos segundos después de
 * elegir a León, el navegador volvía solo a Darío sin que nadie tocara nada.
 *
 * Explica el reporte entero: la intermitencia (depende de qué entra en el lote
 * de prefetch), las mezclas de encabezado y contenido (la cookie cambia entre
 * un render y el siguiente) y que la guardia de perfil "corrigiera" hacia el
 * perfil equivocado —la cookie REALMENTE había vuelto a Darío; la guardia hizo
 * exactamente lo que se le pidió—.
 *
 * ## La regla
 *
 * **Ningún GET prefetcheable escribe cookies.** Un prefetch es una lectura
 * especulativa que el navegador hace sin que nadie haya pedido nada: no puede
 * tener efectos. Los cinco Route Handlers de enlace
 * (`RUTAS_ENLACE_DE_PERFIL`) responden a un prefetch con `204 No Content` y sin
 * tocar una sola cookie.
 *
 * La regla se aplica en DOS capas independientes, a propósito:
 *
 * 1. **En el servidor** (`esSolicitudDePrefetch`): es la que de verdad cierra
 *    el agujero. Vale para cualquier origen del prefetch —el router de Next, la
 *    Speculation Rules API del navegador, una extensión, un `<link
 *    rel=prefetch>` que alguien agregue mañana—, y no depende de que quien
 *    escriba el enlace se acuerde de nada.
 * 2. **En el cliente** (`esRutaDeEnlaceDePerfil` → `prefetch={false}`): defensa
 *    en profundidad, y además es lo semánticamente correcto —pedirle al router
 *    que precargue un endpoint cuyo único trabajo es redirigir no sirve para
 *    nada, ni siquiera cuando es inofensivo—.
 */

/**
 * El censo completo de rutas que cambian el perfil activo desde un GET.
 *
 * Está acá como DATO, y no solo como cinco archivos sueltos, por dos motivos:
 * `esRutaDeEnlaceDePerfil` lo usa para decidir qué no prefetchear, y
 * `tests/unit/enlaces-perfil-prefetch.test.ts` lo usa para verificar contra el disco que
 * no exista un sexto Route Handler que escriba el perfil activo sin pasar por
 * `responderEnlaceDePerfil`. Si mañana aparece uno, el test falla acá.
 */
export const RUTAS_ENLACE_DE_PERFIL = [
  "/turnos/enlace",
  "/medicacion/enlace",
  "/signos/enlace",
  "/familia/enlace",
  "/perfil/sos/enlace",
] as const

/**
 * Los tres encabezados que marcan un prefetch. Hacen falta los tres y no
 * alcanza con uno:
 *
 * - `next-router-prefetch`: el del router de Next. Es la constante
 *   `NEXT_ROUTER_PREFETCH_HEADER` de
 *   `node_modules/next/dist/client/components/app-router-headers.js`, y es
 *   exactamente el que disparó el bug. Su valor es `"1"`; alcanza con que esté.
 * - `sec-purpose`: el estándar moderno, el que manda Chrome en las cargas
 *   especulativas. Su valor puede traer más de un token (`prefetch;prerender`),
 *   así que se busca por contenido y no por igualdad.
 * - `purpose`: el legado, todavía vigente en varios navegadores.
 *
 * Los dos últimos no son invención: Next los lista juntos en sus propios
 * ejemplos de `proxy.ts` para saltear prefetches
 * (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`,
 * "missing: [{ key: 'next-router-prefetch' }, { key: 'purpose', value:
 * 'prefetch' }]") y los dos figuran en la lista de encabezados conocidos de
 * `node_modules/next/dist/server/use-cache/use-cache-wrapper.js`.
 */
export const ENCABEZADO_PREFETCH_ROUTER = "next-router-prefetch"
export const ENCABEZADO_PREFETCH_ESTANDAR = "sec-purpose"
export const ENCABEZADO_PREFETCH_LEGADO = "purpose"

/**
 * ¿Esta request es una carga especulativa (prefetch) y no un pedido de una
 * persona?
 *
 * Se le pasa la request entera y no los encabezados sueltos para que quien la
 * llame no pueda equivocarse de fuente. `Headers.get` ya es insensible a
 * mayúsculas en el NOMBRE; los valores se comparan en minúsculas a mano.
 *
 * Ante la duda, `false`: un falso positivo convertiría un click real en un 204
 * y rompería el deep link de una notificación, que es peor que el bug. Por eso
 * `purpose` y `sec-purpose` tienen que decir `prefetch` de verdad —no cualquier
 * valor— y solo `next-router-prefetch`, que no existe fuera de un prefetch del
 * router, se acepta por presencia.
 */
export function esSolicitudDePrefetch(request: Request): boolean {
  const encabezados = request.headers

  if (encabezados.has(ENCABEZADO_PREFETCH_ROUTER)) {
    return true
  }

  return (
    diceQueEsPrefetch(encabezados.get(ENCABEZADO_PREFETCH_ESTANDAR)) ||
    diceQueEsPrefetch(encabezados.get(ENCABEZADO_PREFETCH_LEGADO))
  )
}

function diceQueEsPrefetch(valor: string | null): boolean {
  return valor !== null && valor.toLowerCase().includes("prefetch")
}

/**
 * La respuesta a un prefetch: **204 No Content**, sin cuerpo, sin cookies y sin
 * cachear.
 *
 * ## Por qué 204 y no 405, 404 ni la redirección de siempre
 *
 * Lo que hay que garantizar es que el prefetch no tenga efectos **y que no
 * estorbe al click real posterior**. Las cuatro opciones se miran contra eso:
 *
 * - **La redirección de siempre, salteando el cambio de perfil**: parece la más
 *   inocente y es la peor. El router se quedaría con una entrada de prefetch
 *   para esa URL —una redirección a `/turnos`— y el click real podría
 *   resolverse desde ahí, sin volver al servidor: el deep link no cambiaría el
 *   perfil nunca. Convertiría un bug ruidoso en uno silencioso.
 * - **405 Method Not Allowed**: miente. El método GET sí está permitido; lo que
 *   no corresponde es el PROPÓSITO. Y un 4xx en un prefetch es ruido en
 *   cualquier panel de errores que el proyecto tenga o llegue a tener.
 * - **404**: peor, por lo mismo y porque la ruta existe.
 * - **204 No Content**: es exactamente lo que pasó —"te escuché, no hay nada
 *   que precargar"—. Es una respuesta exitosa, así que no dispara ningún camino
 *   de error del router; y como no tiene cuerpo, no hay ningún payload RSC que
 *   el router pueda guardar y reusar en el click.
 *
 * `Cache-Control: no-store` es el cinturón: ni el caché HTTP del navegador, ni
 * un CDN, ni nada intermedio puede quedarse con este 204 y devolvérselo al
 * click real. Verificado en local, con `next build` + `next start`: después del
 * prefetch, el click sobre el mismo enlace cambia el perfil como siempre.
 */
export function respuestaDePrefetchSinEfectos(): Response {
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  })
}

/**
 * ¿Este `href` apunta a un enlace que cambia el perfil activo?
 *
 * La usan los componentes que dibujan los CTA del tutorial
 * (`components/inicio/consejo.tsx`, `components/ayuda/lista-pasos.tsx`) para
 * pasarle `prefetch={false}` al `<Link>`. Acepta el href con query string
 * (`/familia/enlace?perfil=…`) porque es como llega de `hrefCta`.
 *
 * Compara contra el censo y no contra un `endsWith("/enlace")` genérico: si
 * mañana existe un `/algo/enlace` que NO cambia el perfil, no hay motivo para
 * dejarlo sin prefetch.
 */
export function esRutaDeEnlaceDePerfil(href: string | null | undefined): boolean {
  if (!href) {
    return false
  }

  const ruta = href.split("?")[0].split("#")[0]

  return (RUTAS_ENLACE_DE_PERFIL as readonly string[]).includes(ruta)
}
