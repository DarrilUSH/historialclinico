/**
 * La cookie espejo del perfil activo: el único dato del perfil activo que el
 * NAVEGADOR puede leer por su cuenta.
 *
 * Este archivo no lleva `import "server-only"` a propósito -es el único de la
 * familia `perfil-activo*` que no lo lleva-: lo importan las dos mitades.
 * `lib/perfil-activo.ts` (servidor) escribe y borra la cookie;
 * `components/perfiles/guardia-perfil.tsx` (cliente) la lee. Mismo reparto que
 * `lib/densidad/tamano.ts` con `lib/densidad/servidor.ts`.
 *
 * ## Por qué existe una cookie espejo, si ya está `perfil_activo`
 *
 * `perfil_activo` es `httpOnly` y tiene que seguir siéndolo. La guardia de
 * perfil (`components/perfiles/guardia-perfil.tsx`) necesita responder, desde
 * JavaScript y sin ir al servidor, a una sola pregunta: *¿el perfil con el que
 * se dibujó esta pantalla sigue siendo el perfil activo?* Sin un valor legible
 * desde el cliente no hay forma de contestarla: una pantalla congelada -una
 * pestaña vieja, una restauración de bfcache, la sesión que Chrome reabre al
 * arrancar- no hace ningún request, así que ninguna purga del servidor la
 * alcanza.
 *
 * La alternativa era sacarle el `httpOnly` a `perfil_activo`. No se hizo: esa
 * cookie la leen `obtenerPerfilActivo` y las Server Actions en cada request, y
 * no hay ningún motivo para ampliar su superficie. El espejo es una copia de
 * SOLO LECTURA para el navegador, sin ningún consumidor del lado del servidor.
 *
 * ## Por qué no es un secreto (y por qué esto no debilita nada)
 *
 * El valor es el uuid de un perfil que ESE navegador ya tiene permitido ver
 * -acaba de elegirlo en el selector-, expuesto solo a ese mismo navegador, en
 * su propio origen. No habilita nada: la autorización real sigue siendo 100%
 * del lado del servidor y no cambió ni una línea. `obtenerPerfilActivo`
 * (`lib/perfil-activo.ts`) revalida `requerirPermiso(perfilId, "view")` contra
 * la base en CADA request, y por debajo está RLS. Nadie puede ver datos de un
 * perfil porque haya escrito su uuid en `document.cookie`: lo único que
 * conseguiría es que la guardia recargue su propia pantalla.
 *
 * Sí es información: quien pueda correr JavaScript en este origen aprende qué
 * perfil está activo. Pero quien pueda correr JavaScript en este origen ya está
 * viendo la pantalla de ese perfil -con el nombre en el encabezado-, así que no
 * aprende nada nuevo.
 *
 * ## La invariante que hay que mantener
 *
 * **`perfil_activo_publico` se escribe y se borra EXCLUSIVAMENTE en
 * `fijarPerfilActivo` y `limpiarPerfilActivo`** (`lib/perfil-activo.ts`), las
 * mismas dos funciones que escriben y borran `perfil_activo`, en la misma
 * llamada y con las mismas opciones. Todo cambio de perfil de la aplicación
 * pasa por ahí -el selector, los cuatro deep links, "abrir en su perfil", el
 * logout-, así que las dos cookies no pueden separarse.
 *
 * De esa invariante depende que la guardia NO pueda entrar en un bucle de
 * recargas: si las dos cookies siempre valen lo mismo, después de una recarga
 * el servidor dibuja la pantalla con exactamente el valor que el cliente va a
 * leer, y la comparación siguiente coincide. Romper la invariante -sembrar el
 * espejo desde `proxy.ts`, escribirlo desde un componente, dejar de borrarlo en
 * el logout- es lo único que podría convertir esto en un bucle.
 */

/**
 * Nombre de la cookie espejo. `publico` en el sentido de "no `httpOnly`":
 * visible para el JavaScript de este origen, no para nadie más.
 */
export const COOKIE_PERFIL_ACTIVO_PUBLICO = "perfil_activo_publico"

/**
 * Extrae el perfil activo de un `document.cookie`.
 *
 * Función pura y sin DOM (recibe la cadena, no la lee): así se puede probar en
 * el entorno `node` de vitest, sin jsdom.
 *
 * Devuelve `null` tanto si la cookie no está como si su valor no tiene forma de
 * uuid. Las dos cosas significan lo mismo para quien llama -"el navegador no
 * sabe qué perfil está activo"- y la guardia trata ese caso como "no hacer
 * nada", nunca como "recargar": ver el comentario de
 * `components/perfiles/guardia-perfil.tsx` sobre las sesiones anteriores al
 * despliegue.
 */
export function leerPerfilActivoDelNavegador(cookies: string): string | null {
  const prefijo = `${COOKIE_PERFIL_ACTIVO_PUBLICO}=`

  for (const trozo of cookies.split(";")) {
    const cookie = trozo.trim()

    if (!cookie.startsWith(prefijo)) {
      continue
    }

    // `decodeURIComponent` puede lanzar con un `%` suelto (una cookie ajena mal
    // formada, o forjada a mano). Un valor ilegible es exactamente lo mismo que
    // no tener cookie.
    let valor: string
    try {
      valor = decodeURIComponent(cookie.slice(prefijo.length))
    } catch {
      return null
    }

    return esUuid(valor) ? valor : null
  }

  return null
}

const PATRON_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Mismo patrón que usa `obtenerPerfilActivo` para descartar cookies forjadas. */
export function esUuid(valor: string): boolean {
  return PATRON_UUID.test(valor)
}
