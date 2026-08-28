"use client"

/**
 * Captura compartida de la señal nativa de instalación de la PWA. Antes de
 * este hook, `components/pwa/boton-instalar.tsx` (el botón chico y suelto
 * al final de `/inicio`) y `components/inicio/consejo.tsx` (la tarjeta de
 * consejo) resolvían esto por su cuenta, sin comunicarse entre sí: dos
 * copias del mismo `useEffect` sobre `beforeinstallprompt`/`appinstalled`,
 * un gate independiente cada una. Ese doble camino es la otra mitad del bug
 * que reportó el dueño de la app -"sino es al pedo ese cartel": la tarjeta
 * ya tenía "Ahora no"/"No mostrar más" pero ningún botón de instalar, y la
 * lógica que SÍ sabía instalar vivía únicamente en el botón suelto, sin
 * forma de que la tarjeta la usara-. Este archivo es esa lógica, extraída
 * una sola vez.
 *
 * ## Qué captura y por qué
 *
 * `beforeinstallprompt` es el único momento en que el navegador (Chrome/Edge
 * en Android; Safari/iOS nunca lo dispara) ofrece instalar la PWA: llega en
 * algún momento después de cargar la página, sin garantía de cuándo.
 * Cancelarlo con `preventDefault()` es lo que permite guardarlo y disparar
 * `prompt()` más tarde, con un toque real de la persona en el medio -
 * `mobile-ux-patterns` marca pedir prompts nativos fuera de un gesto del
 * usuario, y por eso `instalar()` de abajo solo se llama desde un
 * `onClick`, nunca desde este hook ni desde ningún `useEffect`-. El evento
 * se usa UNA sola vez: tras `prompt()` + `userChoice` se descarta -si el
 * navegador quiere volver a ofrecerlo, dispara el evento de nuevo por su
 * cuenta-.
 *
 * `enModoStandalone` combina `display-mode: standalone` (Android/escritorio)
 * con `navigator.standalone` (el flag propio de iOS, sin tipar en el DOM
 * estándar) y se actualiza también al recibir `appinstalled` -cubre a quien
 * instala desde el menú del navegador en vez de cualquiera de los dos
 * botones de esta app-.
 *
 * ## Cada quien que llama a este hook tiene su PROPIA instancia
 *
 * Esto es un hook común, no un Contexto: si dos componentes montados a la
 * vez lo llaman -como pasa hoy en `/inicio`, la tarjeta de consejo y el
 * botón suelto de `components/inicio/acciones-diferidas.tsx`-, cada uno
 * registra sus propios listeners de `window` y guarda su propia copia del
 * evento. Eso no es un problema: el objeto de evento que reciben los dos es
 * el mismo que dispara el navegador, y las dos copias se actualizan igual
 * ante `appinstalled`. Lo que unifica este hook es el CÓDIGO -antes
 * divergía de a poco entre los dos lugares-, no una única fuente de verdad
 * en tiempo de ejecución; nada en la tarea pidió lo segundo.
 */

import * as React from "react"

/**
 * `BeforeInstallPromptEvent` no forma parte del DOM estándar (es una
 * extensión de Chromium): se tipa a mano acá, como ya hacía
 * `components/pwa/boton-instalar.tsx` antes de este hook.
 */
interface EventoAntesDeInstalar extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

function enModoStandalone(): boolean {
  const standaloneIOS = (window.navigator as Navigator & { standalone?: boolean }).standalone
  return window.matchMedia("(display-mode: standalone)").matches || standaloneIOS === true
}

/**
 * Estado inicial de `instalada`, resuelto en el inicializador perezoso de
 * `useState` (no en un `useEffect`): así no hace falta un `setState`
 * síncrono apenas monta, que `react-hooks/set-state-in-effect` marca como
 * error. Sin `window` en el server, arranca en `true` (oculto) — no cambia
 * lo que se ve en el primer render de todos modos, porque `evento` también
 * arranca en `null`.
 */
function estadoInicialInstalada(): boolean {
  return typeof window === "undefined" ? true : enModoStandalone()
}

export interface EstadoInstalacionPwa {
  /** ¿Llegó `beforeinstallprompt` y todavía no se usó (ni se descartó)? */
  promptCapturado: boolean
  /** ¿La app ya corre instalada? */
  enModoStandalone: boolean
  /** `true` mientras `instalar()` espera la respuesta de la persona. */
  instalando: boolean
  /**
   * Dispara `prompt()` sobre el evento guardado y espera `userChoice`. Sin
   * evento capturado no hace nada -defensivo: ningún llamador debería poder
   * invocarla sin haber chequeado antes `promptCapturado`, pero no hay
   * ninguna garantía de tipos que lo obligue-.
   */
  instalar: () => Promise<void>
}

export function useInstalacionPwa(): EstadoInstalacionPwa {
  const [evento, setEvento] = React.useState<EventoAntesDeInstalar | null>(null)
  const [instalada, setInstalada] = React.useState(estadoInicialInstalada)
  const [instalando, setInstalando] = React.useState(false)

  React.useEffect(() => {
    function alCapturarPrompt(evento: Event) {
      evento.preventDefault()
      setEvento(evento as EventoAntesDeInstalar)
    }

    function alInstalar() {
      setInstalada(true)
      setEvento(null)
    }

    window.addEventListener("beforeinstallprompt", alCapturarPrompt)
    window.addEventListener("appinstalled", alInstalar)
    return () => {
      window.removeEventListener("beforeinstallprompt", alCapturarPrompt)
      window.removeEventListener("appinstalled", alInstalar)
    }
  }, [])

  const instalar = React.useCallback(async () => {
    if (!evento) {
      return
    }
    setInstalando(true)
    try {
      await evento.prompt()
      await evento.userChoice
      // Un `beforeinstallprompt` se usa una sola vez, haya aceptado o no: se
      // descarta. Si el navegador quiere volver a ofrecer la instalación,
      // dispara el evento de nuevo por su cuenta.
      setEvento(null)
    } finally {
      setInstalando(false)
    }
  }, [evento])

  return {
    promptCapturado: evento !== null,
    enModoStandalone: instalada,
    instalando,
    instalar,
  }
}
