"use client"

/**
 * Checkbox de consentimiento informado del registro (Ley 25.326, Sprint 12,
 * tarea 12.1). Vive en `/registro` (`app/(auth)/registro/page.tsx`, pasado
 * como `consentimiento` a `FormularioAuth`) y su `name="aceptaLegales"` es
 * lo que `registrarse` (`app/(auth)/actions.ts`) valida en el servidor.
 *
 * ## Sin dark patterns (criterio de aceptación del ROADMAP)
 *
 * - **Sin marcar por defecto**: `Checkbox` (`components/ui/checkbox.tsx`) no
 *   recibe `defaultChecked`, así que arranca destildado como cualquier otro
 *   checkbox del proyecto (mismo patrón que `can_upload`/`can_manage` en
 *   `components/familia/formulario-invitar.tsx`).
 * - **`required`**: gate del lado del cliente para feedback inmediato del
 *   navegador. No es la defensa real -eso lo hace `registrarse`, que
 *   revalida server-side porque un `formData` se puede alterar-, es
 *   conveniencia.
 * - **Los links abren en pestaña nueva** (`target="_blank"`): leer la
 *   política no debe costar perder lo que ya se tipeó en el formulario. Es
 *   la diferencia entre "podés leer antes de aceptar" (correcto) y "leer te
 *   hace perder tu progreso" (fricción que empuja a aceptar sin leer, que es
 *   la forma más común de dark pattern en este tipo de checkbox).
 * - **Un solo texto, sin letra chica aparte**: el propio checkbox ES el
 *   consentimiento, no hay una casilla "acepto" separada de una nota al pie
 *   que diga lo que de verdad se está aceptando.
 */

import Link from "next/link"

import { Checkbox } from "@/components/ui/checkbox"

export function ConsentimientoLegal() {
  return (
    <label className="flex items-start gap-2.5 text-sm chica:gap-2">
      <Checkbox name="aceptaLegales" required aria-required="true" className="mt-0.5" />
      <span className="text-foreground">
        Leí y acepto la{" "}
        <Link
          href="/privacidad"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Política de Privacidad
        </Link>{" "}
        y los{" "}
        <Link
          href="/terminos"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Términos y Condiciones
        </Link>
        .
      </span>
    </label>
  )
}
