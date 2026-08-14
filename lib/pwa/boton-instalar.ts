/**
 * Lógica pura de `components/pwa/boton-instalar.tsx` (Sprint 11, tarea 11.1).
 *
 * Separada del componente para poder probarla con Vitest sin DOM (el
 * proyecto corre los tests en `environment: "node"`, ver `vitest.config.ts`):
 * `tests/unit/boton-instalar.test.ts`. El componente resuelve las dos señales
 * de abajo contra el navegador (evento `beforeinstallprompt`,
 * `display-mode: standalone`) y le pasa el resultado a esta función.
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
 * El botón solo se ofrece con el prompt en mano y sin estar ya instalada.
 * Sin el evento no hay nada que disparar (iOS, o un Chrome que todavía no lo
 * emitió); ya instalada, "Instalar la app" no tiene ninguna acción útil que
 * ofrecer.
 */
export function debeMostrarBotonInstalar(senales: SenalesInstalacion): boolean {
  return senales.promptCapturado && !senales.enModoStandalone
}
