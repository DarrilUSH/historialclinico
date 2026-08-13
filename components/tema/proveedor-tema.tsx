"use client"

import { ThemeProvider } from "next-themes"
import type { ComponentProps } from "react"

/**
 * Proveedor de tema claro/oscuro.
 *
 * Estrategia `class`: next-themes escribe `class="light"` o `class="dark"` en
 * `<html>` antes del primer pintado (script bloqueante, sin parpadeo). Esa
 * clase es la única fuente de verdad del tema: los tokens de `app/globals.css`
 * y las utilidades `dark:` de los componentes leen lo mismo.
 *
 * Por defecto sigue la preferencia del sistema operativo. Cuando exista el
 * conmutador de tema en la interfaz, alcanza con `useTheme()` de next-themes.
 */
export function ProveedorTema({
  children,
  ...props
}: ComponentProps<typeof ThemeProvider>) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </ThemeProvider>
  )
}
