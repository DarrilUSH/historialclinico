/**
 * Shell mínimo del route group SIN bottom nav (`/perfiles`, `/ficha`,
 * `/ficha/historial`, `/compartir`). A diferencia de `(con-nav)`, acá no hay
 * encabezado de perfil ni barra inferior -son pantallas de paso, de impresión
 * o de elección de perfil-, así que lo único que aporta este layout es el
 * landmark `<main>`.
 *
 * ## Por qué existe (Sprint 11, auditoría de accesibilidad WCAG 2.1 AA)
 *
 * Este route group NO tenía `layout.tsx`, así que sus rutas colgaban directo
 * del layout raíz y ninguna quedaba dentro de un landmark: `/ficha`,
 * `/ficha/historial`, `/ficha/historial/[id]` y `/compartir` no tenían ningún
 * `<main>` (WCAG 1.3.1), y un lector de pantalla no tenía a dónde saltar. La
 * única que se lo auto-proveía era `/perfiles`, en dos de sus ramas de
 * `return`; esos `<main>` se bajaron a `<div>` al crear este archivo, para no
 * terminar con dos landmarks `main` anidados en la misma página.
 *
 * `flex flex-1 flex-col` replica exactamente lo que hace el `<main>` del
 * shell con nav (`app/(app)/(con-nav)/layout.tsx`): como `<body>` es
 * `flex min-h-full flex-col`, este elemento crece para ocupar el alto
 * disponible y sus hijas siguen controlando su propio ancho (`mx-auto
 * max-w-3xl`), su alto (`min-h-dvh` en `/perfiles`) y sus estilos de
 * impresión (`print:` en `/ficha`) igual que cuando colgaban del `<body>`.
 */

import type { ReactNode } from "react"

export default function LayoutSinNav({ children }: { children: ReactNode }) {
  return <main className="flex flex-1 flex-col">{children}</main>
}
