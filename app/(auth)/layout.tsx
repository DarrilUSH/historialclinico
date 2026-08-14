/**
 * Layout mínimo para las pantallas de autenticación: centra la tarjeta del
 * formulario en la pantalla, con padding suficiente para que no toque los
 * bordes en mobile. El diseño formal (paleta, tipografía Senior UX) llega en
 * el Sprint 3 — acá solo se usan los tokens default de shadcn.
 */

import type { ReactNode } from "react"

export default function LayoutAuth({ children }: { children: ReactNode }) {
  return (
    // `<main>` y no `<div>` (Sprint 11, auditoría a11y): estas cuatro
    // pantallas -/login, /registro, /recuperar, /recuperar/confirmar- eran las
    // únicas de la app sin ningún landmark, así que un lector de pantalla no
    // tenía dónde saltar y "ir al contenido principal" no encontraba nada.
    // El shell autenticado ya trae su propio <main>
    // (`app/(app)/(con-nav)/layout.tsx`), y este árbol es hermano del de aquel:
    // nunca hay dos <main> en la misma página.
    <main className="flex min-h-dvh w-full flex-1 items-center justify-center bg-muted/30 px-4 py-10">
      {children}
    </main>
  )
}
