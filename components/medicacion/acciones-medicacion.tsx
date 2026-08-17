"use client"

/**
 * Acciones de estado de una medicación, en `/medicacion` (Sprint 7, tarea
 * 7.2). Mismo criterio que `components/turnos/acciones-estado-turno.tsx`:
 * las dos exigen `can_manage` -acá ya validado por quien renderiza la
 * tarjeta (`puedeEditar`, ver `components/medicacion/tarjeta-medicacion.tsx`)-,
 * así que no se repite esa guarda de UI acá.
 *
 * - `AccionesMedicacionActiva` — "Editar" (navega) + "Suspender", con
 *   `DialogoConfirmacion` porque suspender saca la medicación de la lista
 *   activa (criterio de aceptación: "suspender la deja en el histórico sin
 *   borrar filas" — el diálogo dice explícitamente que NO se borra nada).
 * - `BotonReactivar` — sin diálogo: reactivar no es destructivo, mismo
 *   criterio que `confirmarTurno`/`completarTurno` (transiciones que
 *   AVANZAN el estado, sin confirmación) frente a `cancelarTurno` (sí la
 *   tiene).
 *
 * Las dos Server Actions (`suspenderMedicacion`, `reactivarMedicacion`)
 * tienen firma `(prevState, formData)` para poder usarse con
 * `useActionState`: un `<form action={...}>` de Server Component no puede
 * pasarles el `prevState`, así que este archivo es "use client" y las
 * envuelve acá.
 *
 * ## Chica (Sprint 14, tanda A): iconos-botón de 40px
 *
 * El criterio de la tanda pide las acciones como "iconos-botón de 40px a la
 * derecha" en la fila densa de `tarjeta-medicacion.tsx`. Mismo criterio que
 * el resto del rediseño -A/a tiene que reflujar al instante, sin volver al
 * servidor (docs/densidad.md §3)-, así que esto NO es un `if` de JS sobre un
 * prop de tamaño: son DOS árboles, uno con el botón de texto de siempre
 * (`chica:hidden`) y otro con el ícono solo (`hidden chica:flex`), del mismo
 * modo que ya lo resuelve `SeccionTipo` en `app/(app)/(con-nav)/signos/page.tsx`.
 * `size="icon-sm"` ya trae `chica:size-tactil` (`components/ui/button.tsx`),
 * el piso de 40px de docs/densidad.md §4 regla 2. Cada ícono lleva
 * `aria-label` -un botón sin texto visible necesita nombre accesible propio,
 * WCAG 4.1.2- con el nombre de la medicación, para que dos "Editar" en la
 * misma pantalla (Enalapril, Glucophage) se anuncien distinto a un lector de
 * pantalla.
 */

import Link from "next/link"
import { useActionState } from "react"

import { PauseIcon, PencilIcon, RotateCcwIcon } from "lucide-react"

import {
  reactivarMedicacion,
  suspenderMedicacion,
  type EstadoMedicacionAccion,
} from "@/app/(app)/(con-nav)/medicacion/actions"
import { Boton } from "@/components/base/boton"
import { DialogoConfirmacion } from "@/components/base/dialogo-confirmacion"

const ESTADO_INICIAL: EstadoMedicacionAccion = { error: null }

export function AccionesMedicacionActiva({
  medicacionId,
  nombre,
}: {
  medicacionId: string
  nombre: string
}) {
  const [estadoSuspender, enviarSuspender] = useActionState(suspenderMedicacion, ESTADO_INICIAL)

  return (
    <div className="flex flex-wrap gap-2 chica:gap-1.5">
      {/* Grande: sin cambios. */}
      <div className="flex flex-wrap gap-2 chica:hidden">
        <Boton
          render={<Link href={`/medicacion/${medicacionId}/editar`} />}
          nativeButton={false}
          variant="outline"
          size="sm"
        >
          <PencilIcon aria-hidden="true" />
          Editar
        </Boton>

        <DialogoConfirmacion
          disparador={<Boton variant="destructivo" size="sm" />}
          titulo={`¿Suspender ${nombre}?`}
          consecuencia="Pasa al histórico y deja de contar para el stock y los días restantes. No se borra ningún dato: podés reactivarla cuando quieras."
          accion={enviarSuspender}
          camposOcultos={{ medicacionId }}
          error={estadoSuspender.error}
          textoConfirmar="Sí, suspender"
          textoCancelar="Volver"
        >
          Suspender
        </DialogoConfirmacion>
      </div>

      {/* Chica: mismos dos botones, solo ícono + `aria-label`. */}
      <div className="hidden items-center gap-1.5 chica:flex">
        <Boton
          render={<Link href={`/medicacion/${medicacionId}/editar`} aria-label={`Editar ${nombre}`} />}
          nativeButton={false}
          variant="outline"
          size="icon-sm"
        >
          <PencilIcon aria-hidden="true" />
        </Boton>

        <DialogoConfirmacion
          disparador={<Boton variant="destructivo" size="icon-sm" aria-label={`Suspender ${nombre}`} />}
          titulo={`¿Suspender ${nombre}?`}
          consecuencia="Pasa al histórico y deja de contar para el stock y los días restantes. No se borra ningún dato: podés reactivarla cuando quieras."
          accion={enviarSuspender}
          camposOcultos={{ medicacionId }}
          error={estadoSuspender.error}
          textoConfirmar="Sí, suspender"
          textoCancelar="Volver"
        >
          <PauseIcon aria-hidden="true" />
        </DialogoConfirmacion>
      </div>
    </div>
  )
}

export function BotonReactivar({ medicacionId, nombre }: { medicacionId: string; nombre?: string }) {
  const [estado, enviarAccion, pendiente] = useActionState(reactivarMedicacion, ESTADO_INICIAL)

  return (
    <form action={enviarAccion} className="flex flex-col items-start gap-2">
      <input type="hidden" name="medicacionId" value={medicacionId} />
      {estado.error && <p className="text-sm font-medium text-destructive">{estado.error}</p>}

      {/* Grande: sin cambios. */}
      <Boton type="submit" variant="outline" size="sm" cargando={pendiente} className="chica:hidden">
        <RotateCcwIcon aria-hidden="true" />
        Reactivar
      </Boton>

      {/* Chica: mismo botón, solo ícono + `aria-label`. */}
      <Boton
        type="submit"
        variant="outline"
        size="icon-sm"
        cargando={pendiente}
        aria-label={nombre ? `Reactivar ${nombre}` : "Reactivar"}
        className="hidden chica:inline-flex"
      >
        <RotateCcwIcon aria-hidden="true" />
      </Boton>
    </form>
  )
}
