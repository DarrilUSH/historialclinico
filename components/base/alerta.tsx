/**
 * Alerta Senior UX: cuatro variantes semánticas -info, éxito, advertencia,
 * error- con ícono y texto SIEMPRE juntos (docs/design-system.md §8, regla
 * 2: "el color nunca es la única señal"). Reutiliza los mismos tokens y los
 * mismos íconos que `components/ui/sonner.tsx` para que un toast y una
 * alerta inline se lean como el mismo sistema.
 *
 * `role`: `error`/`advertencia` llevan `role="alert"` (interrumpe al lector
 * de pantalla) SOLO cuando la alerta es dinámica -aparece como resultado de
 * una acción, el caso típico de un formulario-, que es el comportamiento por
 * defecto (`estatica={false}`). Un aviso que está SIEMPRE en pantalla debe
 * pasar `estatica`: con `role="alert"` en cada carga de página, un lector de
 * pantalla lo anunciaría cada vez, spam que no aporta nada. `info`/`éxito`
 * usan `role="status"` (anuncio educado, no interrumpe) en el mismo caso
 * dinámico, y ningún rol si son estáticas.
 */

import * as React from "react"
import {
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

export type VarianteAlerta = "info" | "exito" | "advertencia" | "error"

const ICONOS: Record<VarianteAlerta, React.ComponentType<{ className?: string }>> = {
  info: InfoIcon,
  exito: CircleCheckIcon,
  advertencia: TriangleAlertIcon,
  error: OctagonXIcon,
}

const ESTILOS: Record<VarianteAlerta, string> = {
  info: "border-border bg-muted text-foreground",
  exito: "border-exito/40 bg-exito-suave text-exito-fuerte",
  advertencia: "border-advertencia/40 bg-advertencia-suave text-advertencia-fuerte",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
}

export interface AlertaProps extends Omit<React.ComponentProps<"div">, "className"> {
  variante: VarianteAlerta
  /** Título corto opcional, en negrita, arriba del texto. */
  titulo?: string
  /**
   * Marca esta alerta como un aviso ESTÁTICO que siempre está en pantalla
   * (no aparece como resultado de una acción). Suprime el `role` para no
   * interrumpir lectores de pantalla en cada carga de página. Default
   * `false`.
   */
  estatica?: boolean
  className?: string
  children: React.ReactNode
}

export function Alerta({
  variante,
  titulo,
  estatica = false,
  className,
  children,
  ...props
}: AlertaProps) {
  const Icono = ICONOS[variante]
  const esUrgente = variante === "error" || variante === "advertencia"
  const role = estatica ? undefined : esUrgente ? "alert" : "status"

  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-base font-medium",
        ESTILOS[variante],
        className,
      )}
      {...props}
    >
      <Icono className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        {titulo && <p className="font-semibold">{titulo}</p>}
        <div>{children}</div>
      </div>
    </div>
  )
}
