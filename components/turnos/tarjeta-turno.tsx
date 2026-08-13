/**
 * Tarjeta de un turno en `/turnos` (Sprint 6, tarea 6.1).
 *
 * Fecha y hora van PROMINENTES arriba -"los mayores necesitan verla grande"-,
 * en dos renglones grandes (día y hora) más el "cuánto falta" en lenguaje
 * natural debajo (`lib/turnos/tiempo-relativo.ts`). Especialidad, médico y
 * lugar son datos secundarios, y el estado se ve como
 * `BadgeEstadoTurno` -ícono + texto + color, nunca solo color-.
 *
 * Un turno `cancelled` se pinta tachado y atenuado (criterio de aceptación
 * del roadmap: "Los turnos cancelados se ven tachados/atenuados en la
 * lista"), pero SIGUE en su sección (Próximos o Pasados, según la fecha):
 * cancelar no lo saca de la vista, solo cambia cómo se ve.
 *
 * Server Component puro (sin estado ni efectos): la edición no vive en la
 * tarjeta entera -a diferencia de `tarjeta-estudio.tsx`, que es un `<Link>`
 * de punta a punta- porque acá el pie de la tarjeta va a sumar, en la tarea
 * 6.2, los botones de logística (Cómo llegar / Pedir viaje / Agregar al
 * calendario), y esos son controles interactivos propios. Envolver TODA la
 * tarjeta en un `<Link>` (como hace `tarjeta-estudio.tsx`) dejaría esos
 * botones anidados dentro de un `<a>` -HTML inválido, mismo problema que ya
 * evita `components/base/tarjeta.tsx#TarjetaInteractiva` para el caso
 * `<button>` dentro de `<Link>`-. Por eso "Editar" es un botón chico y
 * explícito en el pie, no toda la superficie de la tarjeta.
 */

import Link from "next/link"

import { MapPinIcon, PencilIcon, StethoscopeIcon, UserRoundIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { BadgeEstadoTurno } from "@/components/turnos/badge-estado-turno"
import { Tarjeta } from "@/components/base/tarjeta"
import { formatearFechaLargaTurno, formatearHoraTurno } from "@/lib/turnos/formato"
import { tiempoRelativo } from "@/lib/turnos/tiempo-relativo"
import { cn } from "@/lib/utils"
import type { EstadoTurno } from "@/types/dominio"

export interface TurnoParaTarjeta {
  id: string
  specialty: string
  doctor_name: string | null
  appointment_date: string
  location_name: string | null
  location_address: string | null
  status: EstadoTurno
}

export interface TarjetaTurnoProps {
  turno: TurnoParaTarjeta
  /** `can_manage` (o titular) sobre el perfil activo: muestra el botón "Editar". Diego (`can_view`) no lo ve. */
  puedeEditar: boolean
  /** "Ahora" contra el que se calcula `tiempoRelativo`. Default `new Date()`. */
  ahora?: Date
}

export function TarjetaTurno({ turno, puedeEditar, ahora = new Date() }: TarjetaTurnoProps) {
  const cancelado = turno.status === "cancelled"
  const lugar = [turno.location_name, turno.location_address].filter(Boolean).join(" — ")

  return (
    <Tarjeta className={cn("gap-3 px-(--card-spacing)", cancelado && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p
            className={cn(
              "text-xl font-semibold text-balance text-foreground capitalize",
              cancelado && "line-through decoration-2",
            )}
          >
            {formatearFechaLargaTurno(turno.appointment_date)}
          </p>
          <p
            className={cn(
              "numeros-clinicos text-2xl font-bold text-foreground",
              cancelado && "line-through decoration-2",
            )}
          >
            {formatearHoraTurno(turno.appointment_date)} hs
          </p>
          <p className="text-sm text-muted-foreground">{tiempoRelativo(turno.appointment_date, ahora)}</p>
        </div>

        <BadgeEstadoTurno estado={turno.status} />
      </div>

      <div className={cn("flex flex-col gap-1.5", cancelado && "line-through decoration-2")}>
        <p className="flex items-center gap-2 text-lg font-medium text-foreground">
          <StethoscopeIcon className="size-5 shrink-0 text-primary" aria-hidden="true" />
          {turno.specialty}
        </p>

        {turno.doctor_name && (
          <p className="flex items-center gap-2 text-base text-muted-foreground">
            <UserRoundIcon className="size-4 shrink-0" aria-hidden="true" />
            {turno.doctor_name}
          </p>
        )}

        {lugar && (
          <p className="flex items-center gap-2 text-base text-muted-foreground">
            <MapPinIcon className="size-4 shrink-0" aria-hidden="true" />
            {lugar}
          </p>
        )}
      </div>

      {/* CONTRATO Sprint 6, tarea 6.2 (ROADMAP_SPRINTS.md): acá van los
          botones de logística -Cómo llegar / Pedir viaje / Agregar al
          calendario- (`components/turnos/acciones-turno.tsx`,
          `lib/logistica/deep-links.ts`). Reciben `turno.location_name`,
          `turno.location_address`, latitude/longitude y `appointment_date`
          (no expuestos todavía en `TurnoParaTarjeta`: sumarlos ahí). Van en
          esta misma fila de pie, junto al botón "Editar" -no anidados dentro
          de él ni de ningún `<Link>` que envuelva la tarjeta, ver el
          comentario de cabecera-. */}
      {puedeEditar && (
        <div className="flex justify-end">
          <Boton
            render={<Link href={`/turnos/${turno.id}/editar`} />}
            nativeButton={false}
            variant="outline"
            size="sm"
          >
            <PencilIcon aria-hidden="true" />
            Editar
          </Boton>
        </div>
      )}
    </Tarjeta>
  )
}
