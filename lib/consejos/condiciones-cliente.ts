/**
 * Condiciones "client-conocibles" del tutorial de bienvenida (tarea #14):
 * las dos que dependen del navegador y que, por lo tanto, el servidor no
 * puede evaluar (`lib/consejos/servidor.ts` documenta por qué). Separadas en
 * funciones puras -sin tocar `window`/`Notification` directamente- para
 * poder probarlas sin DOM en `tests/unit/consejos-logica.test.ts`, mismo
 * patrón que `lib/pwa/boton-instalar.ts#debeMostrarBotonInstalar`.
 */

export type PermisoNotificacionPush = NotificationPermission | "sin_soporte"

/**
 * Condición del consejo `notificaciones`: `Notification.permission !==
 * "granted"` -consigna literal de la tarea-, salvo cuando el navegador ni
 * siquiera tiene la API (`"sin_soporte"`): ahí no hay nada que activar,
 * mismo criterio que el estado `sin_soporte` de
 * `components/notificaciones/activar-notificaciones.tsx`, que tampoco
 * ofrece nada en ese caso.
 */
export function notificacionesPendiente(permiso: PermisoNotificacionPush): boolean {
  return permiso !== "granted" && permiso !== "sin_soporte"
}

export interface SenalesInstalarApp {
  /** `display-mode: standalone` (Android/desktop) o `navigator.standalone` (iOS). */
  enModoStandalone: boolean
  /** Ancho de viewport por debajo del breakpoint `md` de Tailwind (767px). */
  esViewportMovil: boolean
}

/**
 * Condición del consejo `instalar_app`: no corre ya instalada Y el viewport
 * es de celular. "Instalá la app en tu teléfono" es, a propósito, un
 * consejo de TELÉFONO -el paso concreto que describe es "menú del navegador
 * → Instalar aplicación / Agregar a pantalla de inicio", un gesto que en
 * desktop ya se resuelve con el ícono nativo de instalación de la barra de
 * direcciones-, así que en un viewport de escritorio o tablet ancha esta
 * función siempre da `false`, sin importar si está instalada o no.
 */
export function instalarAppPendiente(senales: SenalesInstalarApp): boolean {
  return senales.esViewportMovil && !senales.enModoStandalone
}
