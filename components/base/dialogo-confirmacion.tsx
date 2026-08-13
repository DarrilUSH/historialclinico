"use client"

/**
 * Diálogo de confirmación Senior UX para acciones destructivas: título
 * claro, la consecuencia en una sola línea sin tecnicismos, y dos botones
 * GRANDES -cancelar primero en el DOM (y por lo tanto primero en el orden de
 * foco: en una acción destructiva la salida fácil tiene que ganar por
 * defecto) y confirmar en destructivo-.
 *
 * Envuelve `components/ui/dialog.tsx` (Base UI: focus trap, Escape, click
 * afuera, todo ya resuelto ahí) y ejecuta la Server Action que le pasen SOLO
 * al tocar "confirmar" -nunca al abrir el diálogo ni al tocar el
 * disparador-. Reemplaza el diálogo casero que tenía
 * `components/familia/tarjeta-permiso.tsx` para revocar un acceso.
 */

import * as React from "react"
import { useFormStatus } from "react-dom"
import { TriangleAlertIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export interface DialogoConfirmacionProps {
  /**
   * Elemento que abre el diálogo -normalmente `<Boton variant="destructivo">`-.
   * Sigue el patrón `render` de Base UI (igual que el resto de
   * `components/ui/`): este componente le inyecta el manejador de apertura,
   * y `children` es el contenido visible del disparador (ícono + texto).
   */
  disparador: React.ReactElement
  children: React.ReactNode
  /** Título claro de la pregunta ("¿Revocar el acceso de María?"). */
  titulo: string
  /** La consecuencia de confirmar, en una sola línea, sin tecnicismos. */
  consecuencia: string
  textoConfirmar?: string
  textoCancelar?: string
  /**
   * Server Action del formulario interno -el `enviarAccion` que devuelve
   * `useActionState`, o una Server Action ya bindeada con `.bind(null, ...)`-.
   * Se ejecuta solo al confirmar.
   */
  accion: (formData: FormData) => void | Promise<void>
  /** Campos ocultos que viajan con el submit (perfilId, permisoId, etc.). */
  camposOcultos?: Record<string, string>
  /** Mensaje de error del intento anterior, si lo hay. */
  error?: string | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function DialogoConfirmacion({
  disparador,
  children,
  titulo,
  consecuencia,
  textoConfirmar = "Sí, confirmar",
  textoCancelar = "Cancelar",
  accion,
  camposOcultos,
  error,
  open,
  onOpenChange,
}: DialogoConfirmacionProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={disparador}>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <TriangleAlertIcon
              className="size-6 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <DialogTitle>{titulo}</DialogTitle>
          </div>
          <DialogDescription>{consecuencia}</DialogDescription>
        </DialogHeader>

        <form action={accion}>
          {camposOcultos &&
            Object.entries(camposOcultos).map(([nombre, valor]) => (
              <input key={nombre} type="hidden" name={nombre} value={valor} />
            ))}

          {error && (
            <Alerta variante="error" className="mb-4">
              {error}
            </Alerta>
          )}

          <DialogFooter>
            {/* Cancelar primero en el DOM: primero en el orden de foco. */}
            <DialogClose render={<Boton variant="outline" size="lg" type="button" />}>
              {textoCancelar}
            </DialogClose>
            <BotonConfirmar texto={textoConfirmar} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BotonConfirmar({ texto }: { texto: string }) {
  const { pending } = useFormStatus()
  return (
    <Boton type="submit" variant="destructivo" size="lg" cargando={pending}>
      {texto}
    </Boton>
  )
}
