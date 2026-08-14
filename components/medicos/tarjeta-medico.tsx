/**
 * Tarjetas del directorio de médicos (Sprint 10, tarea 10.1). Dos variantes,
 * para las dos secciones de `/medicos`:
 *
 * - `TarjetaMedicoActivo` — nombre, especialidad, matrícula e institución,
 *   más los dos accesos rápidos que pide el criterio de aceptación del
 *   roadmap: "Llamar" (`tel:`, botón GRANDE, solo si hay teléfono cargado) y
 *   "Cómo llegar" (`lib/logistica/deep-links.ts#linkComoLlegar`, que ya
 *   resuelve coordenadas O dirección — mismo helper que usa
 *   `components/turnos/acciones-turno.tsx`, sin reimplementarlo). Ninguno de
 *   los dos botones se renderiza sin datos: un botón "Llamar" inerte es peor
 *   que no mostrarlo, mismo criterio que ya aplica `components/sos/ficha-sos.tsx`.
 * - `TarjetaMedicoBaja` — versión reducida para la sección colapsada de
 *   dados de baja: sin botones de logística -un médico dado de baja no es al
 *   que se llama para sacar un turno nuevo-, con la fecha de la baja y el
 *   botón "Reactivar".
 *
 * `puedeEditar` (= `can_manage` del perfil activo) decide si se muestran
 * "Editar"/"Dar de baja"/"Reactivar" -mismo criterio que
 * `components/medicacion/tarjeta-medicacion.tsx#puedeEditar`-: Diego
 * (`can_view`) ve el directorio completo, sin ningún botón de edición.
 */

import { MapPinnedIcon, PhoneIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { Tarjeta } from "@/components/base/tarjeta"
import { AccionesMedicoActivo, BotonReactivar } from "@/components/medicos/acciones-medico"
import { linkComoLlegar } from "@/lib/logistica/deep-links"
import type { Database } from "@/types/database.types"

type FilaMedico = Database["public"]["Tables"]["doctors"]["Row"]

const FORMATO_FECHA_CORTA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
})

/** Fechas `timestamptz` (`deactivated_at`): se recorta a la parte de fecha antes de formatear, mismo criterio que `components/medicacion/tarjeta-medicacion.tsx#formatearFecha`. */
function formatearFecha(fechaIso: string): string {
  return FORMATO_FECHA_CORTA.format(new Date(`${fechaIso.slice(0, 10)}T00:00:00Z`))
}

function DatosMedico({ medico }: { medico: FilaMedico }) {
  return (
    <div className="flex flex-col gap-1">
      {/* h2 y no h3: mismo caso que `tarjeta-cobertura.tsx` -el h2 de
          `/medicos` solo existe en el estado vacío, así que con la lista
          cargada el h3 saltaba un nivel desde el h1 (Sprint 11, WCAG 1.3.1)-.
          El tamaño lo sigue dando `text-lg`. */}
      <h2 className="text-lg font-semibold text-balance text-foreground">{medico.full_name}</h2>
      {medico.specialty && <p className="text-base text-muted-foreground">{medico.specialty}</p>}
      <p className="text-sm text-muted-foreground">
        {[
          medico.license_number ? `Matrícula ${medico.license_number}` : null,
          medico.institution,
        ]
          .filter(Boolean)
          .join(" · ") || null}
      </p>
    </div>
  )
}

export function TarjetaMedicoActivo({
  medico,
  puedeEditar,
}: {
  medico: FilaMedico
  puedeEditar: boolean
}) {
  const urlComoLlegar = linkComoLlegar({
    latitude: medico.latitude,
    longitude: medico.longitude,
    direccion: medico.address,
  })

  return (
    <Tarjeta className="gap-4 px-(--card-spacing)">
      <DatosMedico medico={medico} />

      {(medico.phone || urlComoLlegar) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {medico.phone && (
            <Boton
              render={<a href={`tel:${medico.phone}`} />}
              nativeButton={false}
              size="lg"
              className="w-full"
            >
              <PhoneIcon aria-hidden="true" />
              Llamar
            </Boton>
          )}
          {urlComoLlegar && (
            <Boton
              render={<a href={urlComoLlegar} target="_blank" rel="noreferrer" />}
              nativeButton={false}
              variant="outline"
              size="lg"
              className="w-full"
            >
              <MapPinnedIcon aria-hidden="true" />
              Cómo llegar
            </Boton>
          )}
        </div>
      )}

      {puedeEditar && <AccionesMedicoActivo medicoId={medico.id} nombre={medico.full_name} />}
    </Tarjeta>
  )
}

export function TarjetaMedicoBaja({
  medico,
  puedeEditar,
}: {
  medico: FilaMedico
  puedeEditar: boolean
}) {
  return (
    <Tarjeta className="gap-3 px-(--card-spacing) opacity-80">
      <DatosMedico medico={medico} />

      {medico.deactivated_at && (
        <p className="text-sm text-muted-foreground">
          Dado de baja el {formatearFecha(medico.deactivated_at)}
        </p>
      )}

      {puedeEditar && <BotonReactivar medicoId={medico.id} />}
    </Tarjeta>
  )
}
