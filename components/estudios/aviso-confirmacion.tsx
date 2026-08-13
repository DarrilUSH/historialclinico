"use client"

/**
 * Toast de "listo" al volver a `/estudios` después de confirmar o descartar
 * un documento desde la pantalla de revisión (Sprint 4, tarea 4.5).
 *
 * `confirmarDocumento` y `descartarDocumento`
 * (`app/(app)/(con-nav)/estudios/actions.ts`) redirigen a
 * `/estudios?confirmado=1` o `/estudios?descartado=1` -el mensaje de éxito no
 * puede mostrarse DESDE la Server Action porque `redirect()` interrumpe el
 * render antes de que exista una pantalla donde pintarlo-. Este componente
 * lee ese search param en el cliente, dispara el toast (`sonner`, montado en
 * `app/(app)/(con-nav)/layout.tsx`) y limpia la URL con `router.replace()`
 * para que recargar la página no repita el aviso.
 *
 * Envuelto en `<Suspense>` por quien lo usa (`estudios/page.tsx`):
 * `useSearchParams()` opta el árbol por debajo suyo a client-side rendering
 * durante la navegación, y Next.js recomienda un límite de Suspense propio
 * para no arrastrar a toda la página -que además ya es dinámica por
 * `cookies()`, así que esto es defensivo, no correctivo de un bug real-.
 */

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { toast } from "sonner"

export function AvisoConfirmacion() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  React.useEffect(() => {
    const confirmado = searchParams.get("confirmado")
    const descartado = searchParams.get("descartado")

    if (!confirmado && !descartado) return

    if (confirmado) {
      toast.success("Documento confirmado", {
        description: "Ya quedó guardado en el historial.",
      })
    } else if (descartado) {
      toast("Documento descartado", {
        description: "No quedó guardado en el historial.",
      })
    }

    router.replace(pathname)
    // Solo debe correr cuando cambian los search params de esta navegación
    // puntual: `router`/`pathname` son estables entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  return null
}
