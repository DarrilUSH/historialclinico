"use client"

/**
 * "Volver a estudios" desde el detalle de un documento (Sprint 5, tarea 5.3).
 *
 * ## Por qué no alcanza con `<Link href="/estudios">` a secas
 *
 * `tarjeta-estudio.tsx` navega al detalle desde `/estudios?categoria=...` -o
 * cualquier otra combinación de filtros y de `?hasta=` de paginación
 * (`lib/estudios/filtros.ts`)-. Un link fijo a `/estudios` pelado perdería
 * esos filtros: la persona volvería a la lista completa, no a donde estaba.
 *
 * ## Por qué NO alcanza con mirar `document.referrer`
 *
 * `tarjeta-estudio.tsx` es un `<Link>` de Next.js: navega client-side, vía
 * `pushState`, sin recarga de documento. `document.referrer` solo se fija en
 * una navegación de DOCUMENTO completa (o al cargar la pestaña por primera
 * vez) y queda CONGELADO durante toda la sesión de cliente que sigue -pasar
 * de `/estudios` a `/estudios/{id}` con un `<Link>` no lo actualiza-. Confiar
 * en `document.referrer` para saber "¿la pantalla anterior era `/estudios`?"
 * daría falsos negativos en el caso más común (navegación normal dentro de la
 * app) y volvería este botón inútil casi siempre.
 *
 * ## La señal que sí sirve: la propia pila de `window.history`
 *
 * Next.js empuja una entrada de historial real por cada `<Link>` que se
 * sigue, así que `history.back()` (lo que hace `router.back()`) recupera la
 * URL anterior completa -con `?categoria=...&hasta=...` incluido- sin que
 * este componente tenga que reconstruir nada. El único caso en el que
 * `router.back()` NO sirve es cuando no hay una entrada previa que valga la
 * pena recuperar: la persona abrió este detalle directo (favorito, enlace
 * compartido, URL tipeada a mano) en una pestaña nueva. `window.history.length
 * <= 1` es la señal de ese caso -nada para "volver" dentro de esta pestaña-, y
 * ahí se deja que el `<Link href="/estudios">` navegue normal: es el mejor
 * fallback disponible cuando no hay filtros previos que reconstruir.
 *
 * Un tercer caso de borde -la pestaña tiene historial, pero de OTRO sitio
 * (la persona llegó tipeando la URL después de haber navegado afuera de la
 * app en la misma pestaña)- se cubre con `document.referrer`: si existe y es
 * de otro origen, tampoco se intenta `back()`, para no sacar a la persona de
 * la aplicación sin que lo haya pedido.
 */

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

export function BotonVolverEstudios() {
  const router = useRouter()

  function manejarClick(evento: React.MouseEvent<HTMLAnchorElement>) {
    if (typeof window === "undefined") return

    if (window.history.length <= 1) {
      // Nada que recuperar en esta pestaña: se deja el <Link> normal.
      return
    }

    if (document.referrer) {
      try {
        if (new URL(document.referrer).origin !== window.location.origin) {
          // El historial de la pestaña viene de otro sitio: no sacar a la
          // persona de la app sin que lo haya pedido.
          return
        }
      } catch {
        // Referrer no parseable: se sigue con el intento de volver.
      }
    }

    evento.preventDefault()
    router.back()
  }

  return (
    <Link
      href="/estudios"
      onClick={manejarClick}
      className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" aria-hidden="true" />
      Volver a estudios
    </Link>
  )
}
