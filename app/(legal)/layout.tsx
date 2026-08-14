/**
 * Layout de las páginas legales (Sprint 12, tarea 12.1): `/privacidad` y
 * `/terminos`. Público, SIN sesión (`RUTAS_PUBLICAS` en `lib/auth/rutas.ts`)
 * -tienen que poder leerse antes de crear una cuenta- y visitable CON
 * sesión también -el link del pie de `app/(app)/(con-nav)/layout.tsx` entra
 * acá sin salir de la app-.
 *
 * A diferencia de `app/(auth)/layout.tsx` (una tarjeta angosta centrada),
 * este es contenido de LECTURA larga: una columna de ancho de lectura
 * cómodo (`max-w-prose`), alineada a la izquierda y no centrada como
 * bloque, con más aire vertical. `docs/densidad.md`: el cuerpo respeta el
 * piso de `text-base` (16px) en los dos modos y la sangría se aprieta con
 * `chica:` como el resto de la app — no hay una escala tipográfica
 * distinta para "modo lectura".
 */

import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"

export default function LayoutLegal({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-prose flex-1 flex-col gap-8 px-4 py-10 sm:py-14 chica:gap-6 chica:py-6">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a Historial Médico
      </Link>

      {children}
    </main>
  )
}
