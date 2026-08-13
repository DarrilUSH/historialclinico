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
 * Rutas públicas: se sirven con o sin sesión. Cada entrada cubre la ruta
 * exacta y sus subrutas (`/recuperar` cubre `/recuperar/confirmar`), salvo
 * `/` que se compara exacta —si no, cubriría toda la aplicación—.
 */
export const RUTAS_PUBLICAS = ["/", "/login", "/registro", "/recuperar"] as const

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
 * `/estado` ya se autobloquea con `notFound()`, pero igual no se declara
 * pública ahí: defensa en profundidad, por si mañana alguien saca ese guard.
 */
export const RUTAS_PUBLICAS_DEV = ["/estado"] as const

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
