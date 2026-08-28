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

/**
 * `?creados=10` (creación en lote desde un mensaje con varias sesiones,
 * agosto 2026) es el único param que lleva un VALOR con significado: la
 * cantidad. Se lee aparte porque el resto son banderas `=1` y el título tiene
 * que decir el número -"10 turnos guardados" es la confirmación que la persona
 * necesita para saber que no se perdió ninguna sesión-.
 */
const PARAM_LOTE = "creados"

/** Cantidad plausible de turnos de un lote, o `null`. Un valor manipulado en la URL no pinta ningún toast en vez de pintar uno absurdo. */
function cantidadCreada(valor: string | null): number | null {
  if (valor === null) return null
  const numero = Number(valor)
  return Number.isInteger(numero) && numero > 0 && numero <= 100 ? numero : null
}

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
    const cantidad = cantidadCreada(searchParams.get(PARAM_LOTE))
    if (cantidad !== null) {
      toast.success(cantidad === 1 ? "Turno guardado" : `${cantidad} turnos guardados`, {
        description: "Ya los vas a ver en tus próximos turnos, cada uno con su recordatorio.",
      })
      router.replace(pathname)
      return
    }

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
