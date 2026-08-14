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
 */

import Link from "next/link"
import { useActionState } from "react"

import { PencilIcon, RotateCcwIcon } from "lucide-react"

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
      <Boton render={<Link href={`/medicacion/${medicacionId}/editar`} />} nativeButton={false} variant="outline" size="sm">
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
  )
}

export function BotonReactivar({ medicacionId }: { medicacionId: string }) {
  const [estado, enviarAccion, pendiente] = useActionState(reactivarMedicacion, ESTADO_INICIAL)

  return (
    <form action={enviarAccion} className="flex flex-col items-start gap-2">
      <input type="hidden" name="medicacionId" value={medicacionId} />
      {estado.error && <p className="text-sm font-medium text-destructive">{estado.error}</p>}
      <Boton type="submit" variant="outline" size="sm" cargando={pendiente}>
        <RotateCcwIcon aria-hidden="true" />
        Reactivar
      </Boton>
    </form>
  )
}
