/**
 * Botón SOS: acceso destacado a la ficha de emergencia (`/sos`, Sprint 8,
 * tarea 8.3 — ROADMAP_SPRINTS.md). Vive en `/inicio`, como primer elemento
 * bajo el encabezado del perfil, antes que cualquier otra card.
 *
 * ## Criterio "menos de 2 toques desde cualquier pantalla"
 *
 * No se agrega un quinto ítem a la bottom nav: 4 accesos es la decisión de
 * diseño del Sprint 3 (ver el encabezado de `components/navegacion/bottom-nav.tsx`)
 * y el roadmap de este sprint la reafirma explícitamente ("NO agregues
 * quinto item"). El camino universal desde CUALQUIER pantalla con nav
 * (`/estudios`, `/turnos`, `/familia`) es: bottom nav → "Inicio" (toque 1,
 * el ítem ya está siempre visible) → este botón, primera cosa de la
 * pantalla (toque 2) → `/sos`. Ese recorrido de dos toques es el que cumple
 * el criterio de aceptación, no un atajo directo por pantalla.
 *
 * ## Por qué es un `<Link>` de navegación pura, no una tarjeta
 *
 * A diferencia de las cards de `/inicio` (`CLASE_TARJETA_BASE` /
 * `CLASE_TARJETA_INTERACTIVA`, `components/base/tarjeta.tsx`), este botón
 * tiene una identidad visual propia y deliberadamente distinta: no es "una
 * card más", es la señal de emergencia de toda la pantalla. Por eso no
 * reutiliza esas clases -mismas reglas de tamaño táctil y de foco, pero su
 * propio color-.
 *
 * ## Visible para TODO el que ve el perfil, sin gate de permiso
 *
 * A diferencia de la card "Ficha SOS" de `/inicio` (que abre la EDICIÓN y
 * exige `canManage`), este botón abre la LECTURA: alcanza con `view`, que ya
 * es la condición para estar parado en `/inicio` siquiera
 * (`obtenerPerfilActivo` la revalida en cada request). Diego, que solo tiene
 * `can_view` sobre el perfil de Roberto, ve este botón igual que María.
 *
 * ## Color: `--sos`, reservado exclusivamente a este botón
 *
 * `docs/design-system.md` §2.4: "`--sos` no se usa para nada más. Ni
 * alertas, ni badges, ni decoración." Los tres pares de contraste
 * (`sos-foreground`/`sos`, `sos`/`background`, `sos`/`card`,
 * `sos-borde`/`background`) ya están verificados en
 * `scripts/verificar-contraste.mjs` -98/98 PASS, ambos temas- desde que se
 * definieron los tokens: no hace falta agregar ningún par nuevo para este
 * componente.
 *
 * ## Alto: `--spacing-sos-boton` (`app/globals.css`)
 *
 * Token dedicado en vez de una utilidad de Tailwind a mano: `max(64px,
 * 3.75rem)` garantiza el piso de 64px que pide el roadmap ("bastante más de
 * 48×48px") incluso si el navegador no agrandó la tipografía del sistema,
 * mismo patrón que `--spacing-tactil` / `--spacing-tactil-amplio`.
 */

import Link from "next/link"
import { SirenIcon } from "lucide-react"

export function BotonSos() {
  return (
    <Link
      href="/sos"
      className="flex min-h-sos-boton w-full max-w-sm items-center justify-center gap-3 rounded-xl border-2 border-sos-borde bg-sos px-6 text-center text-xl font-bold text-sos-foreground shadow-elevada transition-[transform,box-shadow] duration-(--duracion-media) ease-salida hover:-translate-y-0.5 hover:shadow-elevada focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 active:scale-[0.995]"
    >
      <SirenIcon className="size-8 shrink-0" aria-hidden="true" />
      SOS · Ficha de emergencia
    </Link>
  )
}
