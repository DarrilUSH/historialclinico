"use client"

/**
 * Registra el service worker al abrir la aplicación y le pide que precargue la
 * ficha SOS del perfil activo (Sprint 8, tarea 8.4). Desde el Sprint 11 (11.3)
 * es además el dueño del registro que necesita el aviso de actualización.
 *
 * Se monta en el layout de `(con-nav)`, que es donde ya hay sesión y perfil
 * activo resueltos.
 *
 * ## Por qué casi nunca renderiza un pixel, y por qué eso importa
 *
 * `/sos` es, deliberadamente, la ruta con menos JavaScript de la app: la ficha
 * entera es un Server Component sin hidratación (ver el encabezado de
 * `components/sos/ficha-sos.tsx`). Este componente **no cambia eso**: vive en
 * el layout, no en la ficha, y si su JS no llega a cargarse —o el navegador no
 * soporta service workers— la ficha se sigue viendo completa. Lo único que se
 * pierde en ese caso es la copia offline, que es exactamente la degradación
 * correcta.
 *
 * Lo único que puede llegar a pintar es `AvisoActualizacion`, y solo cuando hay
 * una versión nueva del worker esperando. Se monta desde acá —en vez de
 * ponerlo suelto en el layout— porque necesita **el mismo**
 * `ServiceWorkerRegistration`: hay un solo `navigator.serviceWorker.register()`
 * en todo el proyecto (`lib/pwa/registrar-sw.ts`), y pedirlo dos veces desde
 * dos componentes distintos sería empezar a repartir esa responsabilidad.
 *
 * ## Una precarga por sesión de pestaña y por perfil
 *
 * Precargar `/sos` significa bajar el HTML, sus estáticos, las fotos de la
 * credencial y el payload JSON. Hacerlo en cada navegación sería un gasto de
 * datos absurdo en un celular. La marca va en `sessionStorage` —no en
 * `localStorage`— porque el criterio es "una vez cada vez que la persona abre
 * la app", no "una vez en la vida": abrir la app de nuevo es justamente el
 * momento en que conviene refrescar la copia.
 *
 * La clave incluye el `perfilId`, así que **cambiar de perfil vuelve a
 * precargar**. Es indispensable: María administra su propio perfil y el de
 * Roberto, y una copia offline de la ficha equivocada en una guardia es peor
 * que no tener ninguna.
 *
 * ## El caché offline es de UN perfil por vez (arreglo del 2026-08-23)
 *
 * Esta era la mitad de la historia, y la que faltaba costaba caro. El caché
 * `paginas` guarda `/sos`, `/turnos`, `/medicacion` y `/coberturas` bajo **una
 * clave por URL, sin ningún discriminante de perfil** (`public/sw.js`,
 * `RUTAS_PAGINA_OFFLINE`). El razonamiento anterior era que la precarga del
 * perfil nuevo pisaba la del anterior; el agujero es que la precarga está
 * condicionada por `yaPrecargo()`, que es una marca por PESTAÑA y por perfil:
 * volver a un perfil ya precargado en esta misma sesión de pestaña **saltea la
 * precarga**, y el `/sos` guardado sigue siendo el del OTRO perfil. Y las
 * otras tres pantallas no se precargan nunca (docs/offline.md §2.1, punto 2):
 * entran al caché solo cuando alguien las abre, y ahí se quedan.
 *
 * Reproducido con un build de producción el 2026-08-23: con **María** como
 * perfil activo y el teléfono sin señal, `/sos` mostraba la ficha de
 * **Roberto** —grupo sanguíneo, alergias y medicación crítica de otra
 * persona— con el encabezado diciendo "Viendo a Roberto Gómez". En una guardia
 * eso no es un bug de interfaz: es el dato equivocado en el peor momento
 * posible.
 *
 * El arreglo es el más chico que cierra la clase entera de problema, no solo
 * el síntoma: **el dispositivo guarda offline los datos de un solo perfil a la
 * vez**. Se recuerda en `localStorage` de qué perfil son los datos que hay en
 * disco -`localStorage` y no `sessionStorage` a propósito: el caché sobrevive
 * al cierre de la app, así que la marca también tiene que sobrevivir-, y en
 * cuanto el perfil activo no coincide se purgan las tres familias con datos
 * (`purgarCacheOffline`, la misma que corre al llegar a `/login`) antes de
 * precargar la ficha nueva.
 *
 * De paso, mejora la minimización de datos (docs/minimizacion-datos.md): antes
 * un teléfono que administraba tres perfiles podía terminar con retazos de los
 * tres escritos en disco; ahora tiene los del perfil que está mirando y nada
 * más.
 */

import * as React from "react"

import { AvisoActualizacion } from "@/components/pwa/aviso-actualizacion"
import {
  precargarFichaSos,
  purgarCacheOffline,
  registrarServiceWorker,
} from "@/lib/pwa/registrar-sw"

/**
 * Marca persistente de **de qué perfil son los datos guardados en este
 * dispositivo**. Ver el encabezado: es lo que convierte "el caché se pisa,
 * seguro" en una garantía verificable.
 */
const CLAVE_PERFIL_EN_DISCO = "historial-medico:perfil-offline"

function perfilConDatosEnDisco(): string | null {
  try {
    return window.localStorage.getItem(CLAVE_PERFIL_EN_DISCO)
  } catch {
    // Modo privado o storage bloqueado. Devolver `null` hace que el perfil
    // actual se lea como "distinto del guardado" y se purgue: sin memoria, la
    // opción segura es asumir que lo que hay en disco es de otro.
    return null
  }
}

function anotarPerfilEnDisco(perfilId: string): void {
  try {
    window.localStorage.setItem(CLAVE_PERFIL_EN_DISCO, perfilId)
  } catch {
    // Ídem: sin marca, la próxima apertura vuelve a purgar y precargar. Se
    // gastan datos de más, nunca se muestra la ficha de otra persona.
  }
}

/** Marca de "esta pestaña ya precargó la ficha de este perfil". */
function clavePrecarga(perfilId: string): string {
  return `historial-medico:precarga-sos:${perfilId}`
}

function yaPrecargo(perfilId: string): boolean {
  try {
    return window.sessionStorage.getItem(clavePrecarga(perfilId)) === "1"
  } catch {
    // Modo privado o storage bloqueado: se precarga igual. Gastar datos de más
    // es un problema mucho menor que no tener la ficha cuando hace falta.
    return false
  }
}

function marcarPrecargado(perfilId: string): void {
  try {
    window.sessionStorage.setItem(clavePrecarga(perfilId), "1")
  } catch {
    // Ídem.
  }
}

/**
 * Borra la marca de precarga de esta pestaña. La usa la purga: después de
 * vaciar el caché, "ya precargué en esta pestaña" pasó a ser mentira, y
 * dejarla puesta es exactamente lo que producía el bug del encabezado.
 */
function olvidarPrecarga(perfilId: string): void {
  try {
    window.sessionStorage.removeItem(clavePrecarga(perfilId))
  } catch {
    // Ídem.
  }
}

export function RegistroServiceWorker({ perfilId }: { perfilId: string }) {
  const [registro, setRegistro] = React.useState<ServiceWorkerRegistration | null>(null)

  React.useEffect(() => {
    let cancelado = false

    async function preparar() {
      try {
        // La purga va PRIMERO y fuera del `if` de la precarga: si lo que hay
        // en disco es de otro perfil, hay que sacarlo aunque esta pestaña ya
        // haya precargado -que es justamente el caso que dejaba la ficha
        // equivocada guardada, ver el encabezado-. Y va antes del registro
        // del worker porque `purgarCacheOffline` usa la Cache API directamente
        // desde la ventana: funciona aunque el worker no llegue a registrarse.
        const enDisco = perfilConDatosEnDisco()
        if (enDisco !== perfilId) {
          await purgarCacheOffline()
          if (cancelado) {
            return
          }
          // La marca se anota DESPUÉS de purgar: si la purga falla y lanza
          // -no lo hace, `purgarCacheOffline` nunca lanza, pero el orden es lo
          // que hace que eso no importe-, el disco queda anotado como del
          // perfil viejo y la próxima apertura vuelve a intentarlo.
          anotarPerfilEnDisco(perfilId)
          // Lo que se purgó incluye la ficha de ESTE perfil si la hubiera, así
          // que la marca de precarga por pestaña ya no vale: hay que volver a
          // bajarla.
          olvidarPrecarga(perfilId)
        }

        const registro = await registrarServiceWorker()
        if (!registro || cancelado) {
          return
        }

        // El registro se guarda SIEMPRE, aunque esta pestaña ya haya precargado
        // la ficha: es lo que necesita el aviso de actualización, que no tiene
        // nada que ver con la precarga.
        setRegistro(registro)

        if (yaPrecargo(perfilId)) {
          return
        }
        precargarFichaSos(registro, perfilId)
        marcarPrecargado(perfilId)
      } catch {
        // El registro puede fallar por contexto no seguro o por un navegador
        // que lo bloquea. La app entera funciona igual sin service worker: lo
        // único que no hay es modo offline, y no hay nada que decirle a la
        // persona sobre eso en este momento.
      }
    }

    void preparar()
    return () => {
      cancelado = true
    }
  }, [perfilId])

  if (!registro) {
    return null
  }

  return <AvisoActualizacion registro={registro} />
}
