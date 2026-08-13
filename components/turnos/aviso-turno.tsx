"use client"

/**
 * Toast de "listo" al volver a `/turnos` después de crear, editar, confirmar,
 * completar o cancelar un turno. Mismo patrón que
 * `components/estudios/aviso-confirmacion.tsx`: las Server Actions de
 * `actions.ts` no pueden pintar el toast ellas mismas -`redirect()`
 * interrumpe el render antes de que exista una pantalla-, así que redirigen
 * con `?creado=1` / `?editado=1` / `?confirmado=1` / `?completado=1` /
 * `?cancelado=1` y este componente lee el search param, dispara el toast
 * (`sonner`, montado en `app/(app)/(con-nav)/layout.tsx`) y limpia la URL con
 * `router.replace()` para que recargar la página no lo repita.
 */

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { toast } from "sonner"

const MENSAJE_POR_PARAM: Record<string, { titulo: string; descripcion: string }> = {
  creado: { titulo: "Turno guardado", descripcion: "Ya lo vas a ver en tus próximos turnos." },
  editado: { titulo: "Turno actualizado", descripcion: "Guardamos los cambios." },
  confirmado: { titulo: "Turno confirmado", descripcion: "Quedó marcado como confirmado." },
  completado: { titulo: "Turno completado", descripcion: "Quedó marcado como completado." },
  cancelado: { titulo: "Turno cancelado", descripcion: "Va a verse tachado en tu lista." },
}

export function AvisoTurno() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  React.useEffect(() => {
    const clave = Object.keys(MENSAJE_POR_PARAM).find((param) => searchParams.get(param))
    if (!clave) return

    const mensaje = MENSAJE_POR_PARAM[clave]
    toast.success(mensaje.titulo, { description: mensaje.descripcion })

    router.replace(pathname)
    // Solo debe correr cuando cambian los search params de esta navegación
    // puntual: `router`/`pathname` son estables entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  return null
}
