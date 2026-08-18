"use client"

/**
 * Registro del service worker en las pantallas SIN sesión — hotfix de la
 * regresión de instalación reportada desde producción (2026-08-18).
 *
 * ## El caso real que esto corrige
 *
 * `RegistroServiceWorker` (`components/pwa/registro-service-worker.tsx`) vive
 * en el layout de `(con-nav)` porque además de registrar el worker precachea
 * la ficha SOS del perfil ACTIVO — necesita sesión. La consecuencia, nunca
 * pisada hasta hoy: en `/login`, `/registro` y `/recuperar` NO hay service
 * worker. Quien instala la aplicación parado en una de esas pantallas —el
 * caso real: el usuario, con su cuenta recién reseteada, instalando desde el
 * login— no tiene worker controlando en el momento en que Chrome evalúa la
 * instalabilidad, y Android degrada la instalación a un ACCESO DIRECTO (ícono
 * con el badge de Chrome, sin "Desinstalar") en vez de acuñar la aplicación
 * real. Nadie lo había notado antes porque la instalación siempre se había
 * hecho con la sesión ya iniciada, donde el shell logueado registra el worker.
 *
 * ## Por qué esto NO viola el "punto único de registro"
 *
 * Reusa EXACTAMENTE la misma función (`lib/pwa/registrar-sw.ts`, el único
 * `navigator.serviceWorker.register()` del proyecto). `register()` es
 * idempotente para el mismo script y scope: cuando la persona inicia sesión y
 * el layout logueado vuelve a llamarla, recibe el MISMO registration — no hay
 * dos workers, no hay pisadas. Acá no hay precarga de SOS (no hay perfil) ni
 * aviso de actualización (sigue siendo del shell logueado): solo el registro,
 * que es lo único que la instalabilidad necesita.
 *
 * No renderiza ni un pixel, y si el registro falla o el navegador no soporta
 * workers, el login sigue exactamente igual — la misma degradación silenciosa
 * que documenta `registro-service-worker.tsx`.
 */

import * as React from "react"

import { registrarServiceWorker } from "@/lib/pwa/registrar-sw"

export function RegistroServiceWorkerAnonimo() {
  React.useEffect(() => {
    registrarServiceWorker().catch(() => {
      // Mejor esfuerzo a propósito: sin worker no hay instalación rica ni
      // offline, pero el formulario de entrada no depende de nada de eso.
    })
  }, [])

  return null
}
