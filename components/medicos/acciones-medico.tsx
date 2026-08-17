"use client"

/**
 * Acciones de estado de un médico, en `/medicos` (Sprint 10, tarea 10.1).
 * Mismo criterio que `components/medicacion/acciones-medicacion.tsx`:
 * las dos exigen `can_manage` -acá ya validado por quien renderiza la
 * tarjeta (`puedeEditar`, ver `components/medicos/tarjeta-medico.tsx`)-, así
 * que no se repite esa guarda de UI acá.
 *
 * - `AccionesMedicoActivo` — "Editar" (navega) + "Dar de baja", con
 *   `DialogoConfirmacion` porque dar de baja saca al médico del directorio
 *   activo (criterio de aceptación: "baja lógica" — el diálogo dice
 *   explícitamente que NO se borra nada ni rompe turnos ya vinculados).
 * - `BotonReactivar` — sin diálogo: reactivar no es destructivo, mismo
 *   criterio que `BotonReactivar` de medicación frente a "Dar de baja" (que
 *   sí tiene confirmación).
 *
 * Las dos Server Actions (`darDeBajaMedico`, `reactivarMedico`) tienen firma
 * `(prevState, formData)` para poder usarse con `useActionState`: un
 * `<form action={...}>` de Server Component no puede pasarles el
 * `prevState`, así que este archivo es "use client" y las envuelve acá.
 *
 * ## Chica (Sprint 14, tanda B): íconos-botón de 40px
 *
 * Mismo patrón que `components/medicacion/acciones-medicacion.tsx` (tanda A
 * del sprint): DOS árboles -uno con el botón de texto de siempre
 * (`chica:hidden`), otro con el ícono solo (`hidden chica:flex`)-, nunca un
 * `if` de JS sobre un prop de tamaño, para que A/a reflufe al instante sin
 * volver al servidor (docs/densidad.md §3). `size="icon-sm"` ya trae
 * `chica:size-tactil` (`components/ui/button.tsx`), el piso de 40px de
 * docs/densidad.md §4 regla 2. Cada ícono lleva `aria-label` con el nombre
 * del médico, mismo motivo que la tanda A: dos "Editar" en la misma pantalla
 * (Dr. Rodríguez, Dra. Torres) tienen que anunciarse distinto.
 */

import Link from "next/link"
import { useActionState } from "react"

import { PencilIcon, RotateCcwIcon, UserRoundXIcon } from "lucide-react"

import {
  darDeBajaMedico,
  reactivarMedico,
  type EstadoMedicoAccion,
} from "@/app/(app)/(con-nav)/medicos/actions"
import { Boton } from "@/components/base/boton"
import { DialogoConfirmacion } from "@/components/base/dialogo-confirmacion"

const ESTADO_INICIAL: EstadoMedicoAccion = { error: null }

export function AccionesMedicoActivo({ medicoId, nombre }: { medicoId: string; nombre: string }) {
  const [estadoBaja, enviarBaja] = useActionState(darDeBajaMedico, ESTADO_INICIAL)

  return (
    <div className="flex flex-wrap gap-2 chica:gap-1.5">
      {/* Grande: sin cambios. */}
      <div className="flex flex-wrap gap-2 chica:hidden">
        <Boton
          render={<Link href={`/medicos/${medicoId}/editar`} />}
          nativeButton={false}
          variant="outline"
          size="sm"
        >
          <PencilIcon aria-hidden="true" />
          Editar
        </Boton>

        <DialogoConfirmacion
          disparador={<Boton variant="destructivo" size="sm" />}
          titulo={`¿Dar de baja a ${nombre}?`}
          consecuencia="Deja de aparecer en el directorio activo y en el selector de turnos. No se borra ningún dato: los turnos y documentos que ya lo tienen cargado lo siguen mostrando, y podés reactivarlo cuando quieras."
          accion={enviarBaja}
          camposOcultos={{ medicoId }}
          error={estadoBaja.error}
          textoConfirmar="Sí, dar de baja"
          textoCancelar="Volver"
        >
          Dar de baja
        </DialogoConfirmacion>
      </div>

      {/* Chica: mismos dos botones, solo ícono + `aria-label`. */}
      <div className="hidden items-center gap-1.5 chica:flex">
        <Boton
          render={<Link href={`/medicos/${medicoId}/editar`} aria-label={`Editar ${nombre}`} />}
          nativeButton={false}
          variant="outline"
          size="icon-sm"
        >
          <PencilIcon aria-hidden="true" />
        </Boton>

        <DialogoConfirmacion
          disparador={<Boton variant="destructivo" size="icon-sm" aria-label={`Dar de baja a ${nombre}`} />}
          titulo={`¿Dar de baja a ${nombre}?`}
          consecuencia="Deja de aparecer en el directorio activo y en el selector de turnos. No se borra ningún dato: los turnos y documentos que ya lo tienen cargado lo siguen mostrando, y podés reactivarlo cuando quieras."
          accion={enviarBaja}
          camposOcultos={{ medicoId }}
          error={estadoBaja.error}
          textoConfirmar="Sí, dar de baja"
          textoCancelar="Volver"
        >
          <UserRoundXIcon aria-hidden="true" />
        </DialogoConfirmacion>
      </div>
    </div>
  )
}

export function BotonReactivar({ medicoId, nombre }: { medicoId: string; nombre?: string }) {
  const [estado, enviarAccion, pendiente] = useActionState(reactivarMedico, ESTADO_INICIAL)

  return (
    <form action={enviarAccion} className="flex flex-col items-start gap-2">
      <input type="hidden" name="medicoId" value={medicoId} />
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
        aria-label={nombre ? `Reactivar a ${nombre}` : "Reactivar"}
        className="hidden chica:inline-flex"
      >
        <RotateCcwIcon aria-hidden="true" />
      </Boton>
    </form>
  )
}
