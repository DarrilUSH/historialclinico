"use client"

/**
 * Envoltorio "use client" para diferir `ActivarNotificaciones` y
 * `BotonInstalar` fuera del First Load JS de `/inicio` (Sprint 11, tarea
 * 11.6). Las dos son las últimas cosas de la pantalla, ninguna aporta al
 * contenido que define el LCP (el saludo del perfil y las cards de arriba
 * ya pintaron), y las dos arrancan invisibles de por sí -
 * `ActivarNotificaciones` en `estado === "comprobando"` hasta que un efecto
 * resuelve el permiso real del navegador, `BotonInstalar` sin ningún
 * `beforeinstallprompt` capturado todavía- así que cargarlas más tarde no
 * cambia nada de lo que se ve al entrar.
 *
 * `next/dynamic` con `ssr: false` SOLO diere el chunk cuando el `dynamic()`
 * vive dentro de un Client Component (esto): llamarlo directo desde el
 * Server Component de `page.tsx` no logra el code splitting real -ver
 * `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`, sección
 * "Skipping SSR"-. Por eso este archivo existe: es el único rol que cumple,
 * mover el `ssr: false` al lado correcto de la frontera cliente/servidor.
 *
 * Sin `loading`: las dos ya devuelven `null` mientras deciden qué mostrar
 * (ver sus propios encabezados), así que el `null` por defecto de
 * `next/dynamic` mientras baja el chunk es exactamente el mismo estado
 * visual que tenían antes de este cambio -no hay salto de layout que
 * evitar acá, a diferencia de los gráficos de Recharts.
 */

import dynamic from "next/dynamic"

const ActivarNotificaciones = dynamic(
  () =>
    import("@/components/notificaciones/activar-notificaciones").then(
      (mod) => mod.ActivarNotificaciones,
    ),
  { ssr: false },
)

const BotonInstalar = dynamic(
  () => import("@/components/pwa/boton-instalar").then((mod) => mod.BotonInstalar),
  { ssr: false },
)

export function AccionesDiferidasInicio() {
  return (
    <>
      <ActivarNotificaciones />
      <BotonInstalar />
    </>
  )
}
