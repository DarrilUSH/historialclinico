"use client"

/**
 * Acciones de estado de un turno, en `/turnos/[id]/editar` (Sprint 6, tarea
 * 6.1): confirmar (pendiente→confirmado), completar (→completado) y cancelar
 * (→cancelado, con diálogo de confirmación -criterio de aceptación del
 * roadmap-). Las tres exigen `can_manage` -ver el comentario de cabecera de
 * `app/(app)/(con-nav)/turnos/actions.ts`-, mismo permiso que ya exige poder
 * llegar a esta pantalla (`/turnos/[id]/editar` redirige si no hay
 * `canManage`), así que acá no se repite esa guarda de UI: si la persona
 * llegó hasta este componente, ya tiene el permiso.
 *
 * Un turno `completed` o `cancelled` no ofrece más transiciones -son estados
 * terminales de esta tarea (no hay "reabrir un turno cancelado")-, y se
 * muestra un aviso en vez de botones que fallarían igual del lado del
 * servidor.
 */

import { useActionState } from "react"

import { CheckCheckIcon, CircleCheckIcon } from "lucide-react"

import {
  cancelarTurno,
  completarTurno,
  confirmarTurno,
  type EstadoTurnoAccion,
} from "@/app/(app)/(con-nav)/turnos/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { DialogoConfirmacion } from "@/components/base/dialogo-confirmacion"
import type { EstadoTurno } from "@/types/dominio"

const ESTADO_INICIAL: EstadoTurnoAccion = { error: null }

export function AccionesEstadoTurno({ turnoId, estado }: { turnoId: string; estado: EstadoTurno }) {
  const [estadoConfirmar, enviarConfirmar, pendienteConfirmar] = useActionState(
    confirmarTurno,
    ESTADO_INICIAL,
  )
  const [estadoCompletar, enviarCompletar, pendienteCompletar] = useActionState(
    completarTurno,
    ESTADO_INICIAL,
  )
  const [estadoCancelar, enviarCancelar] = useActionState(cancelarTurno, ESTADO_INICIAL)

  if (estado === "completed") {
    return (
      <Alerta variante="info" estatica>
        Este turno ya está marcado como completado.
      </Alerta>
    )
  }

  if (estado === "cancelled") {
    return (
      <Alerta variante="advertencia" estatica>
        Este turno está cancelado.
      </Alerta>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {estado === "pending" && (
        <form action={enviarConfirmar}>
          <input type="hidden" name="turnoId" value={turnoId} />
          {estadoConfirmar.error && (
            <Alerta variante="error" className="mb-3">
              {estadoConfirmar.error}
            </Alerta>
          )}
          <Boton type="submit" size="lg" cargando={pendienteConfirmar} className="w-full">
            <CircleCheckIcon aria-hidden="true" />
            Confirmar turno
          </Boton>
        </form>
      )}

      <form action={enviarCompletar}>
        <input type="hidden" name="turnoId" value={turnoId} />
        {estadoCompletar.error && (
          <Alerta variante="error" className="mb-3">
            {estadoCompletar.error}
          </Alerta>
        )}
        <Boton type="submit" variant="outline" size="lg" cargando={pendienteCompletar} className="w-full">
          <CheckCheckIcon aria-hidden="true" />
          Marcar como completado
        </Boton>
      </form>

      <DialogoConfirmacion
        disparador={<Boton variant="destructivo" size="lg" className="w-full" />}
        titulo="¿Cancelar este turno?"
        consecuencia="El turno va a quedar marcado como cancelado y se va a ver tachado en tu lista. Vas a poder seguir viéndolo, pero no vas a poder confirmarlo ni completarlo."
        accion={enviarCancelar}
        camposOcultos={{ turnoId }}
        error={estadoCancelar.error}
        textoConfirmar="Sí, cancelar turno"
        textoCancelar="Volver"
      >
        Cancelar turno
      </DialogoConfirmacion>
    </div>
  )
}
