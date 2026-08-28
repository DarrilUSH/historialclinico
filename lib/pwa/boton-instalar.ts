/**
 * Lógica pura de instalación de la PWA (Sprint 11, tarea 11.1; extendida
 * para el bug reportado por el dueño de la app: la tarjeta "Instalá la app
 * en tu teléfono" de `/inicio` tenía "Ahora no" y "No mostrar más", pero
 * NINGÚN botón de instalar -"sino es al pedo ese cartel"-).
 *
 * Separada del componente para poder probarla con Vitest sin DOM (el
 * proyecto corre los tests en `environment: "node"`, ver `vitest.config.ts`):
 * `tests/unit/boton-instalar.test.ts`. Los componentes (`components/pwa/
 * boton-instalar.tsx`, `components/inicio/consejo.tsx`,
 * `components/ayuda/lista-pasos.tsx`) resuelven las señales de abajo contra
 * el navegador -vía `hooks/usar-instalacion-pwa.ts` para las dos que vienen
 * de `beforeinstallprompt`/`appinstalled`- y le pasan el resultado a estas
 * funciones.
 *
 * Extiende este archivo, en vez de crear uno nuevo, porque las tres
 * funciones de acá responden la MISMA pregunta ("¿qué le ofrezco a esta
 * persona sobre instalar la app?") con distinto nivel de detalle:
 * `debeMostrarBotonInstalar` para el botón chico y suelto del final de
 * `/inicio` (binario: sí/no), `estadoTarjetaInstalar` para la tarjeta de
 * consejo, que además de sí/no necesita distinguir CÓMO ofrecerlo (Chrome
 * con el prompt nativo vs. Safari/iOS, que no lo tiene).
 */

export interface SenalesInstalacion {
  /** ¿Llegó `beforeinstallprompt` y todavía no se usó (ni se descartó)? */
  promptCapturado: boolean
  /**
   * ¿La app ya corre instalada? (`display-mode: standalone` en Android/
   * desktop, o el flag `navigator.standalone` propio de iOS).
   */
  enModoStandalone: boolean
}

/**
 * El botón chico y suelto del final de `/inicio` solo se ofrece con el
 * prompt en mano y sin estar ya instalada. Sin el evento no hay nada que
 * disparar (iOS, o un Chrome que todavía no lo emitió); ya instalada,
 * "Instalar la app" no tiene ninguna acción útil que ofrecer.
 */
export function debeMostrarBotonInstalar(senales: SenalesInstalacion): boolean {
  return senales.promptCapturado && !senales.enModoStandalone
}

/**
 * Detecta iOS/iPadOS a partir de señales de identificación del navegador,
 * sin tocar `navigator` directamente -para poder probarla sin DOM-.
 *
 * iPadOS 13+ finge ser una Mac de escritorio en el `userAgent` a propósito
 * (Apple lo hizo así para que los sitios dejen de mandarle la versión
 * "mobile" liviana): la señal que lo delata es que reporta más de un punto
 * de contacto táctil, cosa que ninguna Mac de verdad hace. Sin esta segunda
 * pata, un iPad -frecuente en el público adulto mayor de este proyecto-
 * quedaría afuera de "instrucciones_ios" para siempre, y como Safari nunca
 * dispara `beforeinstallprompt`, terminaría en "oculto": el peor de los
 * tres estados de `estadoTarjetaInstalar`, el mismo problema que este
 * cambio vino a resolver.
 */
export function detectarIOS(senales: { userAgent: string; maxTouchPoints: number }): boolean {
  const esIPhoneOIPadClasico = /iphone|ipad|ipod/i.test(senales.userAgent)
  const esIPadDisfrazadoDeMac = /macintosh/i.test(senales.userAgent) && senales.maxTouchPoints > 1
  return esIPhoneOIPadClasico || esIPadDisfrazadoDeMac
}

export interface SenalesTarjetaInstalar extends SenalesInstalacion {
  /** ¿El navegador identifica el dispositivo como iOS/iPadOS? Ver `detectarIOS`. */
  esIOS: boolean
  /** Ancho de viewport por debajo del breakpoint `md` de Tailwind (767px) — mismo corte que `lib/consejos/condiciones-cliente.ts#instalarAppPendiente`. */
  esViewportMovil: boolean
}

/**
 * Los TRES estados posibles de la tarjeta "Instalá la app en tu teléfono"
 * (`components/inicio/consejo.tsx`) y de la fila equivalente en
 * `components/ayuda/lista-pasos.tsx`:
 *
 * - `"instalar"`: llegó `beforeinstallprompt` (Chrome/Edge en Android) y la
 *   app no está instalada. Se ofrece un botón real "Instalar" que dispara
 *   `evento.prompt()` -ver `hooks/usar-instalacion-pwa.ts`-.
 * - `"instrucciones_ios"`: Safari en iOS/iPadOS nunca dispara
 *   `beforeinstallprompt` -no hay ningún evento que capturar, ni ahora ni
 *   más tarde-, así que en vez de un botón se ofrece la instrucción manual
 *   real: "Compartí → Agregar a pantalla de inicio".
 * - `"oculto"`: la app ya corre instalada, el viewport no es de celular
 *   (este consejo es específicamente de teléfono, igual que documenta
 *   `lib/consejos/condiciones-cliente.ts#instalarAppPendiente`), o -el caso
 *   que motivó este archivo- todavía no hay NINGUNA señal utilizable
 *   (Android/Chrome que aún no emitió `beforeinstallprompt`, o cualquier
 *   navegador de escritorio sin soporte). Acá NO se muestra ni la tarjeta ni
 *   un botón: un botón sin ninguna acción detrás -la falla original que
 *   reportó el dueño de la app, apenas al revés- es peor que ningún cartel.
 */
export type EstadoTarjetaInstalar = "instalar" | "instrucciones_ios" | "oculto"

export function estadoTarjetaInstalar(senales: SenalesTarjetaInstalar): EstadoTarjetaInstalar {
  if (!senales.esViewportMovil || senales.enModoStandalone) {
    return "oculto"
  }
  if (senales.promptCapturado) {
    return "instalar"
  }
  return senales.esIOS ? "instrucciones_ios" : "oculto"
}
