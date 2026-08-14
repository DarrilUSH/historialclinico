"use client"

/**
 * Registra el service worker al abrir la aplicación y le pide que precargue la
 * ficha SOS del perfil activo (Sprint 8, tarea 8.4).
 *
 * Se monta en el layout de `(con-nav)`, que es donde ya hay sesión y perfil
 * activo resueltos. No pinta nada: devuelve `null`.
 *
 * ## Por qué no renderiza ni un pixel, y por qué eso importa
 *
 * `/sos` es, deliberadamente, la ruta con menos JavaScript de la app: la ficha
 * entera es un Server Component sin hidratación (ver el encabezado de
 * `components/sos/ficha-sos.tsx`). Este componente **no cambia eso**: vive en
 * el layout, no en la ficha, y si su JS no llega a cargarse —o el navegador no
 * soporta service workers— la ficha se sigue viendo completa. Lo único que se
 * pierde en ese caso es la copia offline, que es exactamente la degradación
 * correcta.
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
 * que no tener ninguna. Como `/sos` se guarda bajo una única clave de caché, la
 * precarga del perfil nuevo pisa la del anterior.
 */

import * as React from "react"

import { precargarFichaSos, registrarServiceWorker } from "@/lib/pwa/registrar-sw"

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

export function RegistroServiceWorker({ perfilId }: { perfilId: string }) {
  React.useEffect(() => {
    let cancelado = false

    async function preparar() {
      try {
        const registro = await registrarServiceWorker()
        if (!registro || cancelado || yaPrecargo(perfilId)) {
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

  return null
}
