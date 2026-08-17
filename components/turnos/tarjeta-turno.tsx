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
 *
 * ## Modo chica (Sprint 13, tarea 13.2): cabecera horizontal
 *
 * En grande, la cabecera es dos bloques apilados -fecha/hora arriba (con el
 * badge de estado flotando a la derecha por `justify-between`), especialidad
 * /médico/lugar debajo-. En chica se reorganiza a DOS COLUMNAS: fecha y hora
 * a la izquierda (con el badge debajo, en la misma columna angosta),
 * especialidad/médico/lugar a la derecha. El pie de acciones (Cómo llegar /
 * Pedir viaje / Editar) sigue debajo, a ancho completo en los dos modos -son
 * los controles interactivos, no se comprimen horizontalmente-.
 *
 * El cambio es puramente de EJE (columna → fila): el orden de los elementos
 * en el DOM no se toca, así que el orden de lectura de un lector de pantalla
 * es el mismo en los dos modos (fecha, hora, cuánto falta, estado,
 * especialidad, médico, lugar, acciones). Compartido por `/inicio`
 * (`components/inicio/proximo-turno.tsx`) y por la lista completa de
 * `/turnos`: un solo lugar para el rediseño, sin duplicar el componente.
 *
 * ### Sprint 14 (tanda A): la columna angosta "a media altura"
 *
 * La retokenización de la tarea 14.1 ya achica `text-xl`/`text-2xl` solo con
 * los tokens (sale gratis), pero la columna angosta seguía parada en 3
 * renglones propios (fecha, hora, "cuánto falta") más el badge. Acá se
 * REORGANIZA -no se saca nada, docs/densidad.md §4 regla 5-: fecha y hora se
 * combinan en un solo renglón (`formatearFechaCortaTurno` + la hora de
 * siempre, con `numeros-clinicos`) y "cuánto falta" queda como segundo
 * renglón, mismo patrón `chica:hidden` / `hidden chica:block` que ya usa
 * `tarjeta-medicacion.tsx` para droga+presentación: dos bloques con el MISMO
 * dato, uno por modo, nunca los dos en el árbol de accesibilidad a la vez
 * (`display:none` los saca del árbol). El badge es el mismo nodo en los dos
 * modos, sin duplicar.
 */

import Link from "next/link"

import { MapPinIcon, PencilIcon, StethoscopeIcon, UserRoundIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { BadgeEstadoTurno } from "@/components/turnos/badge-estado-turno"
import { AccionesTurno } from "@/components/turnos/acciones-turno"
import { Tarjeta } from "@/components/base/tarjeta"
import { formatearFechaCortaTurno, formatearFechaLargaTurno, formatearHoraTurno } from "@/lib/turnos/formato"
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
  latitude?: number | null
  longitude?: number | null
  preparation_notes?: string | null
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
    <Tarjeta className={cn("gap-3 px-(--card-spacing) chica:gap-2", cancelado && "opacity-60")}>
      <div className="flex flex-col gap-3 chica:flex-row chica:items-stretch">
        <div className="flex flex-wrap items-start justify-between gap-3 chica:w-[38%] chica:shrink-0 chica:flex-col chica:flex-nowrap chica:items-start chica:justify-start chica:gap-1.5 chica:border-r chica:border-borde-sutil chica:pr-3">
          {/* Grande: sin cambios -fecha y hora en renglones grandes apilados, "cuánto falta" debajo-. */}
          <div className="flex flex-col gap-0.5 chica:hidden">
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

          {/* Chica (Sprint 14, tanda A): "a media altura" del criterio del
              sprint -fecha y hora COMBINADAS en un solo renglón (mismo dato
              que en grande, sin sacar nada, docs/densidad.md §4 regla 5),
              "cuánto falta" en el segundo. De 3 renglones de texto propios
              pasa a 2, más el badge -que sigue siendo el mismo nodo, ver
              abajo-. */}
          <div className="hidden flex-col gap-0.5 chica:flex">
            <p
              className={cn(
                "numeros-clinicos text-base font-bold text-balance text-foreground capitalize",
                cancelado && "line-through decoration-2",
              )}
            >
              {formatearFechaCortaTurno(turno.appointment_date)} · {formatearHoraTurno(turno.appointment_date)} hs
            </p>
            <p className="text-xs text-muted-foreground">{tiempoRelativo(turno.appointment_date, ahora)}</p>
          </div>

          <BadgeEstadoTurno estado={turno.status} />
        </div>

        <div
          className={cn(
            "flex flex-col gap-1.5 chica:min-w-0 chica:flex-1 chica:justify-center",
            cancelado && "line-through decoration-2",
          )}
        >
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
      </div>

      {/* Botones de logística + Editar */}
      <div className="space-y-2">
        <AccionesTurno
          turnoId={turno.id}
          especialidad={turno.specialty}
          nombreMedico={turno.doctor_name?.split(" ").slice(0, -1).join(" ") || undefined}
          apellidoMedico={turno.doctor_name?.split(" ").slice(-1).join("") || undefined}
          fechaHora={turno.appointment_date}
          ubicacion={turno.location_name || undefined}
          direccion={turno.location_address || undefined}
          latitude={turno.latitude}
          longitude={turno.longitude}
          notas={turno.preparation_notes || undefined}
        />

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
      </div>
    </Tarjeta>
  )
}
