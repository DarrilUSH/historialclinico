/**
 * Layout mínimo para las pantallas de autenticación: centra la tarjeta del
 * formulario en la pantalla, con padding suficiente para que no toque los
 * bordes en mobile. El diseño formal (paleta, tipografía Senior UX) llega en
 * el Sprint 3 — acá solo se usan los tokens default de shadcn.
 */

import type { ReactNode } from "react"

export default function LayoutAuth({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full flex-1 items-center justify-center bg-muted/30 px-4 py-10">
      {children}
    </div>
  )
}
