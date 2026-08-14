"use client"

/**
 * Acciones de una cobertura, en `/coberturas` (Sprint 8, tarea 8.1). Mismo
 * criterio que `components/medicacion/acciones-medicacion.tsx`: las tres
 * exigen `can_manage` -acá ya validado por quien renderiza la tarjeta
 * (`puedeEditar`, ver `components/coberturas/tarjeta-cobertura.tsx`)-, así
 * que no se repite esa guarda de UI acá.
 *
 * - "Editar" navega al formulario completo.
 * - "Marcar como principal" -solo si todavía no lo es- es una transición
 *   simple, sin diálogo: no es destructiva (mismo criterio que
 *   `BotonReactivar` en medicación frente a "Suspender").
 * - "Eliminar" SÍ lleva `DialogoConfirmacion`: borra la fila y encola la
 *   purga de las dos fotos (`docs/modelo-permisos.md`, contrato de
 *   `storage_purge_queue`), y esta vez es irreversible de verdad -a
 *   diferencia de "Suspender" en medicación, `insurance_cards` no tiene baja
 *   lógica-.
 */

import Link from "next/link"
import { useActionState } from "react"

import { PencilIcon, StarIcon, Trash2Icon } from "lucide-react"

import {
  eliminarCobertura,
  marcarPrincipal,
  type EstadoCoberturaAccion,
} from "@/app/(app)/(con-nav)/coberturas/actions"
import { Boton } from "@/components/base/boton"
import { DialogoConfirmacion } from "@/components/base/dialogo-confirmacion"

const ESTADO_INICIAL: EstadoCoberturaAccion = { error: null }

export function AccionesCobertura({
  coberturaId,
  proveedor,
  esPrincipal,
}: {
  coberturaId: string
  proveedor: string
  esPrincipal: boolean
}) {
  const [estadoPrincipal, enviarPrincipal, pendientePrincipal] = useActionState(
    marcarPrincipal,
    ESTADO_INICIAL,
  )
  const [estadoEliminar, enviarEliminar] = useActionState(eliminarCobertura, ESTADO_INICIAL)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 chica:gap-1.5">
        <Boton
          render={<Link href={`/coberturas/${coberturaId}/editar`} />}
          nativeButton={false}
          variant="outline"
          size="sm"
        >
          <PencilIcon aria-hidden="true" />
          Editar
        </Boton>

        {!esPrincipal && (
          <form action={enviarPrincipal}>
            <input type="hidden" name="coberturaId" value={coberturaId} />
            <Boton type="submit" variant="outline" size="sm" cargando={pendientePrincipal}>
              <StarIcon aria-hidden="true" />
              Marcar como principal
            </Boton>
          </form>
        )}

        <DialogoConfirmacion
          disparador={<Boton variant="destructivo" size="sm" />}
          titulo={`¿Eliminar la cobertura de ${proveedor}?`}
          consecuencia="Se borran los datos y las fotos de la credencial. Esta acción no se puede deshacer."
          accion={enviarEliminar}
          camposOcultos={{ coberturaId }}
          error={estadoEliminar.error}
          textoConfirmar="Sí, eliminar"
          textoCancelar="Volver"
        >
          <Trash2Icon aria-hidden="true" />
          Eliminar
        </DialogoConfirmacion>
      </div>

      {estadoPrincipal.error && (
        <p className="text-sm font-medium text-destructive">{estadoPrincipal.error}</p>
      )}
    </div>
  )
}
