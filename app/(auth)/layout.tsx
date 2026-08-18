/**
 * Layout mínimo para las pantallas de autenticación: centra la tarjeta del
 * formulario en la pantalla, con padding suficiente para que no toque los
 * bordes en mobile. El diseño formal (paleta, tipografía Senior UX) llega en
 * el Sprint 3 — acá solo se usan los tokens default de shadcn.
 *
 * ## Modo chica (Sprint 13, tarea 13.6)
 *
 * Estas cuatro pantallas corren SIN sesión (`/login`, `/registro`,
 * `/recuperar`, `/recuperar/confirmar`), pero el modo de letra viaja igual:
 * lo resuelve la cookie `tamano` -que sobrevive al logout hasta que se borra
 * explícitamente, ver `docs/densidad.md` §3- sin necesitar la fila de
 * `profiles`. Un dispositivo que ya eligió letra chica ve el login chico
 * antes de identificarse, verificable con
 * `curl -b tamano=chica http://localhost:3000/login`.
 *
 * ## Pie con las páginas legales (Sprint 12, tarea 12.1)
 *
 * El criterio de aceptación del ROADMAP exige que `/privacidad` y
 * `/terminos` sean "accesibles desde el pie sin sesión": `<PiePaginasLegales
 * />` va debajo de la tarjeta, dentro del mismo `<main>` -no es un segundo
 * landmark-, verificable sin sesión con `curl http://localhost:3000/login`.
 *
 * `mostrarAyuda={false}` (tarea #14): `/ayuda` vive bajo sesión
 * (`app/(app)/(con-nav)/ayuda/`), así que un tercer link a una pantalla a la
 * que nadie sin sesión puede entrar no aporta nada acá — mismo criterio con
 * el que este pie NO ofrece "Cerrar sesión" en estas cuatro pantallas.
 */

import type { ReactNode } from "react"

import { PiePaginasLegales } from "@/components/legal/pie-paginas-legales"
import { RegistroServiceWorkerAnonimo } from "@/components/pwa/registro-sw-anonimo"

export default function LayoutAuth({ children }: { children: ReactNode }) {
  return (
    // `<main>` y no `<div>` (Sprint 11, auditoría a11y): estas cuatro
    // pantallas -/login, /registro, /recuperar, /recuperar/confirmar- eran las
    // únicas de la app sin ningún landmark, así que un lector de pantalla no
    // tenía dónde saltar y "ir al contenido principal" no encontraba nada.
    // El shell autenticado ya trae su propio <main>
    // (`app/(app)/(con-nav)/layout.tsx`), y este árbol es hermano del de aquel:
    // nunca hay dos <main> en la misma página.
    <main className="flex min-h-dvh w-full flex-1 flex-col items-center justify-center gap-2 bg-muted/30 px-4 py-10 chica:gap-1 chica:px-3 chica:py-6">
      {/* Hotfix instalación PWA (2026-08-18): el worker también se registra
          en las pantallas de entrada — sin esto, instalar la app parado en
          /login la degrada a un acceso directo. Ver el encabezado de
          components/pwa/registro-sw-anonimo.tsx. */}
      <RegistroServiceWorkerAnonimo />
      {children}
      <PiePaginasLegales mostrarAyuda={false} />
    </main>
  )
}
