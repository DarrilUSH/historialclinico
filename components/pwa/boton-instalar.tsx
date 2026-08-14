"use client"

/**
 * Botón de instalación de la PWA (Sprint 11, tarea 11.1). Vive en `/inicio`,
 * discreto: no es un banner de página completa, es un botón `outline`
 * chico como cualquier acción secundaria de la app.
 *
 * ## El gesto es de la persona, no de la carga de la página
 *
 * Chrome/Edge en Android disparan `beforeinstallprompt` cuando el manifest ya
 * es válido y la app todavía no está instalada. Cancelar el evento por
 * defecto (`preventDefault`) es lo que permite guardarlo y ofrecerlo más
 * tarde con este botón en vez del mini-infobar del navegador — y ese
 * "más tarde" importa: `mobile-ux-patterns` marca pedir permisos o prompts en
 * el pageload, y `evento.prompt()` recién se llama dentro del `onClick`, con
 * un toque real de la persona en el medio, nunca en el `useEffect` que lo
 * capturó.
 *
 * ## iOS no tiene este evento, y esta tarea no le agrega nada
 *
 * Safari en iOS jamás dispara `beforeinstallprompt`: ahí instalar es
 * "Compartir → Agregar a inicio", una acción manual del sistema operativo que
 * ningún código puede disparar. Sin el evento, `debeMostrarBotonInstalar`
 * (`lib/pwa/boton-instalar.ts`) da `false` para siempre y este componente
 * devuelve `null` en todo iPhone. No hay instrucciones alternativas acá
 * -"tocá Compartir y después Agregar a inicio"-; queda documentado como
 * pendiente para una tarea futura si hace falta.
 *
 * ## Por qué se esconde con la app ya instalada
 *
 * `display-mode: standalone` (Android y escritorio) y `navigator.standalone`
 * (el flag propio de iOS, sin tipar en el DOM estándar) son las dos señales
 * de "esto ya se abrió como app". Ofrecerle "Instalar la app" a alguien que
 * ya la tiene instalada y la está usando así sería un botón sin ninguna
 * acción útil detrás. El handler de `appinstalled` cubre además el caso de
 * quien instala desde el menú del navegador en vez de este botón: la próxima
 * vez que el componente reevalúe, ya no se ofrece.
 */

import * as React from "react"
import { DownloadIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { debeMostrarBotonInstalar } from "@/lib/pwa/boton-instalar"

/**
 * `BeforeInstallPromptEvent` no forma parte del DOM estándar (es una
 * extensión de Chromium): se tipa a mano acá en vez de traer un paquete
 * solo para esto.
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
 * `useState` (no en un `useEffect`): así no hace falta un `setState` síncrono
 * apenas monta, que `react-hooks/set-state-in-effect` marca como error. Sin
 * `window` en el server, arranca en `true` (oculto) — no cambia lo que se ve
 * en el primer render de todos modos, porque `evento` también arranca en
 * `null` y `debeMostrarBotonInstalar` ya exige el prompt capturado.
 */
function estadoInicialInstalada(): boolean {
  return typeof window === "undefined" ? true : enModoStandalone()
}

export function BotonInstalar() {
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

  async function instalar() {
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
  }

  if (!debeMostrarBotonInstalar({ promptCapturado: evento !== null, enModoStandalone: instalada })) {
    return null
  }

  return (
    <Boton variant="outline" size="sm" onClick={instalar} cargando={instalando}>
      <DownloadIcon aria-hidden="true" />
      Instalar la app
    </Boton>
  )
}
