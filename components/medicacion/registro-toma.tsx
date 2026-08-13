"use client"

/**
 * "Tomas de hoy" (Sprint 7, tarea 7.3 — ROADMAP_SPRINTS.md): una fila por
 * cada toma programada de HOY del perfil activo (`lib/medicacion/tomas-de-hoy.ts`),
 * con hora programada, estado, y las dos acciones que invocan los RPC
 * `registrar_toma`/`revertir_toma` entregados en la tarea 7.1
 * (`docs/modelo-medicacion.md` §4 y §6):
 *
 * - "Ya la tomé" — botón grande (`size="lg"`, el mismo objetivo táctil
 *   amplio que el resto de la app), directo, sin diálogo: registrar no es
 *   destructivo, mismo criterio que `BotonReactivar` de
 *   `components/medicacion/acciones-medicacion.tsx` frente a "Suspender".
 * - "Me equivoqué, deshacer" — con `DialogoConfirmacion`, porque revertir
 *   deshace un dato ya cargado (mismo criterio que "Suspender").
 *
 * Solo se ofrecen a quien tiene `can_upload` (`puedeRegistrar`): un viewer
 * puro (Diego, `can_view`) VE la lista completa -hora, medicación, estado-
 * pero sin ningún botón, mismo criterio que `puedeEditar` en
 * `components/medicacion/tarjeta-medicacion.tsx`. La guarda real vive en el
 * servidor (`requerirPermiso(..., "upload")` dentro de `registrarToma`/
 * `revertirToma`, `app/(app)/(con-nav)/medicacion/actions.ts`); esto es solo
 * para no mostrar un botón que de entrada va a fallar.
 *
 * El botón de deshacer solo aparece para tomas `taken`: el RPC ya rechaza
 * una toma de otro día (docs/modelo-medicacion.md §6, "el día se mide en
 * Ushuaia"), pero como esta lista YA está acotada a las tomas de HOY, todo lo
 * que llegue acá con `status = 'taken'` es, por construcción, de hoy — así
 * que nunca se ofrece un botón que el RPC vaya a rechazar por fecha.
 */

import { useActionState } from "react"

import { CheckIcon, ClockIcon, PillIcon, RotateCcwIcon } from "lucide-react"

import { registrarToma, revertirToma, type EstadoMedicacionAccion } from "@/app/(app)/(con-nav)/medicacion/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { DialogoConfirmacion } from "@/components/base/dialogo-confirmacion"
import { Tarjeta } from "@/components/base/tarjeta"
import { formatearHoraToma, textoEstadoToma, type EstadoIntakeToma } from "@/lib/medicacion/formato-toma"

export interface TomaDeHoyVista {
  id: string
  medicationId: string
  medicationName: string
  doseAmount: number | null
  doseUnit: string | null
  scheduledAt: string
  status: EstadoIntakeToma
  takenAt: string | null
}

const ESTADO_INICIAL: EstadoMedicacionAccion = { error: null }

function textoDosis(dosis: number | null, unidad: string | null): string {
  if (dosis === null) return ""
  const texto = Number.isInteger(dosis) ? String(dosis) : String(dosis).replace(".", ",")
  return `${texto} ${unidad ?? ""}`.trim()
}

export function SeccionTomasDeHoy({
  tomas,
  puedeRegistrar,
}: {
  tomas: TomaDeHoyVista[]
  puedeRegistrar: boolean
}) {
  if (tomas.length === 0) return null

  return (
    <section className="flex flex-col gap-3" aria-labelledby="tomas-de-hoy-titulo">
      <h2 id="tomas-de-hoy-titulo" className="text-lg font-semibold tracking-tight text-foreground">
        Tomas de hoy
      </h2>
      <ul className="flex flex-col gap-3">
        {tomas.map((toma) => (
          <li key={toma.id}>
            <FilaToma toma={toma} puedeRegistrar={puedeRegistrar} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function EstadoBadge({ toma }: { toma: TomaDeHoyVista }) {
  const texto = textoEstadoToma(toma.status, toma.takenAt)

  if (toma.status === "taken") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-exito-suave px-2.5 py-1 text-sm font-medium text-exito-fuerte">
        <CheckIcon className="size-4 shrink-0" aria-hidden="true" />
        {texto}
      </span>
    )
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-muted-foreground">
      {toma.status === "pending" && <ClockIcon className="size-4 shrink-0" aria-hidden="true" />}
      {texto}
    </span>
  )
}

function FilaToma({ toma, puedeRegistrar }: { toma: TomaDeHoyVista; puedeRegistrar: boolean }) {
  const [estadoRegistrar, enviarRegistrar, pendienteRegistrar] = useActionState(
    registrarToma,
    ESTADO_INICIAL,
  )
  const [estadoRevertir, enviarRevertir] = useActionState(revertirToma, ESTADO_INICIAL)

  return (
    <Tarjeta className="gap-3 px-(--card-spacing)">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <PillIcon className="size-4.5" />
          </span>
          <div className="flex flex-col">
            <span className="text-base font-semibold text-foreground">{toma.medicationName}</span>
            <span className="text-sm text-muted-foreground">
              {formatearHoraToma(toma.scheduledAt)}
              {toma.doseAmount !== null && ` · ${textoDosis(toma.doseAmount, toma.doseUnit)}`}
            </span>
          </div>
        </div>
        <EstadoBadge toma={toma} />
      </div>

      {estadoRegistrar.error && (
        <Alerta variante="error" className="text-sm">
          {estadoRegistrar.error}
        </Alerta>
      )}

      {puedeRegistrar && toma.status === "pending" && (
        <form action={enviarRegistrar}>
          <input type="hidden" name="tomaId" value={toma.id} />
          <Boton type="submit" size="lg" cargando={pendienteRegistrar} className="w-full">
            <CheckIcon aria-hidden="true" />
            Ya la tomé
          </Boton>
        </form>
      )}

      {puedeRegistrar && toma.status === "taken" && (
        <DialogoConfirmacion
          disparador={<Boton variant="outline" size="sm" />}
          titulo={`¿Deshacer esta toma de ${toma.medicationName}?`}
          consecuencia="Vuelve a quedar pendiente y se restituye exactamente el stock que se había descontado. Solo se puede deshacer el mismo día en que se registró."
          accion={enviarRevertir}
          camposOcultos={{ tomaId: toma.id }}
          error={estadoRevertir.error}
          textoConfirmar="Sí, deshacer"
          textoCancelar="Volver"
        >
          <RotateCcwIcon aria-hidden="true" />
          Me equivoqué, deshacer
        </DialogoConfirmacion>
      )}
    </Tarjeta>
  )
}
