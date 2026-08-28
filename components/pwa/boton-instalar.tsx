"use client"

/**
 * Botón de instalación de la PWA (Sprint 11, tarea 11.1). Vive en `/inicio`,
 * discreto: no es un banner de página completa, es un botón `outline`
 * chico como cualquier acción secundaria de la app.
 *
 * ## El gesto es de la persona, no de la carga de la página
 *
 * Chrome/Edge en Android disparan `beforeinstallprompt` cuando el manifest ya
 * es válido y la app todavía no está instalada. `mobile-ux-patterns` marca
 * pedir permisos o prompts en el pageload, así que `instalar()` -que llama a
 * `evento.prompt()` por detrás, ver `hooks/usar-instalacion-pwa.ts`- solo se
 * dispara desde este `onClick`, con un toque real de la persona en el medio,
 * nunca antes.
 *
 * ## iOS no tiene este evento, y este botón no le agrega nada
 *
 * Safari en iOS jamás dispara `beforeinstallprompt`: ahí instalar es
 * "Compartir → Agregar a inicio", una acción manual del sistema operativo que
 * ningún código puede disparar. Sin el evento, `debeMostrarBotonInstalar`
 * (`lib/pwa/boton-instalar.ts`) da `false` para siempre y este componente
 * devuelve `null` en todo iPhone/iPad. Este botón en particular no ofrece
 * instrucciones alternativas para ese caso -la tarjeta de consejo de
 * `/inicio`, `components/inicio/consejo.tsx`, sí lo hace, con su propio
 * estado `"instrucciones_ios"`-.
 *
 * ## Por qué se esconde con la app ya instalada
 *
 * `display-mode: standalone` (Android y escritorio) y `navigator.standalone`
 * (el flag propio de iOS, sin tipar en el DOM estándar) son las dos señales
 * de "esto ya se abrió como app" que resuelve `useInstalacionPwa`. Ofrecerle
 * "Instalar la app" a alguien que ya la tiene instalada y la está usando así
 * sería un botón sin ninguna acción útil detrás. El hook también escucha
 * `appinstalled`, así que cubre además a quien instala desde el menú del
 * navegador en vez de este botón: la próxima vez que el componente
 * reevalúe, ya no se ofrece.
 */

import { DownloadIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { useInstalacionPwa } from "@/hooks/usar-instalacion-pwa"
import { debeMostrarBotonInstalar } from "@/lib/pwa/boton-instalar"

export function BotonInstalar() {
  const { promptCapturado, enModoStandalone, instalando, instalar } = useInstalacionPwa()

  if (!debeMostrarBotonInstalar({ promptCapturado, enModoStandalone })) {
    return null
  }

  return (
    <Boton variant="outline" size="sm" onClick={instalar} cargando={instalando}>
      <DownloadIcon aria-hidden="true" />
      Instalar la app
    </Boton>
  )
}
