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
  const detalle =
    [medico.license_number ? `Matrícula ${medico.license_number}` : null, medico.institution]
      .filter(Boolean)
      .join(" · ") || null

  return (
    <div className="flex flex-col gap-1 chica:gap-0.5">
      {/* h2 y no h3: mismo caso que `tarjeta-cobertura.tsx` -el h2 de
          `/medicos` solo existe en el estado vacío, así que con la lista
          cargada el h3 saltaba un nivel desde el h1 (Sprint 11, WCAG 1.3.1)-.
          El tamaño lo sigue dando `text-lg`. */}
      <h2 className="text-lg font-semibold text-balance text-foreground">{medico.full_name}</h2>
      {/* Especialidad + matrícula + institución: TRES líneas en grande.
          Chica (Sprint 13, tarea 13.5) las combina en UNA -mismo patrón que
          `tarjeta-medicacion.tsx` (Tanda 3)-: las versiones largas se ocultan
          con `chica:hidden`, la combinada con `hidden chica:block`. */}
      {medico.specialty && (
        <p className="text-base text-muted-foreground chica:hidden">{medico.specialty}</p>
      )}
      {detalle && <p className="text-sm text-muted-foreground chica:hidden">{detalle}</p>}
      {(medico.specialty || detalle) && (
        <p className="hidden text-sm text-muted-foreground chica:block">
          {[medico.specialty, detalle].filter(Boolean).join(" · ")}
        </p>
      )}
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
    <Tarjeta className="gap-4 px-(--card-spacing) chica:gap-3">
      <DatosMedico medico={medico} />

      {/* Llamar / Cómo llegar: ya son una fila a partir de `sm:`. Chica
          (Sprint 13, tarea 13.5) los pone en fila en CUALQUIER ancho -es el
          criterio de aceptación del ROADMAP-, con menos aire entre ellos.
          `size="lg"` sigue siendo `min-h-tactil-amplio`, que en chica ya
          computa ~49,5px por el token (docs/densidad.md §5): siguen muy por
          encima del piso de 40px sin tocar la altura a mano.

          Sprint 14 (tanda B): "Cómo llegar" gana un label corto ("Llegar")
          en chica -mismo patrón `chica:hidden`/`hidden chica:inline` que ya
          usa `components/turnos/acciones-turno.tsx`: el texto completo
          queda en el árbol de accesibilidad de GRANDE, el corto en el de
          CHICA, nunca los dos a la vez-. "Llamar" ya es corto (7
          caracteres) y no necesita una segunda versión. Siguen siendo
          `size="lg"` con rótulo visible en los dos modos, no íconos SIN
          texto: a diferencia de Editar/Dar de baja en `acciones-medico.tsx`
          (acciones secundarias de administración), "Llamar" y "Cómo llegar"
          son la acción principal de esta tarjeta para cualquier sesión
          -incluida la de solo lectura, sin `puedeEditar`-. */}
      {(medico.phone || urlComoLlegar) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 chica:grid-cols-2 chica:gap-1.5">
          {medico.phone && (
            <Boton
              render={<a href={`tel:${medico.phone}`} />}
              nativeButton={false}
              size="lg"
              className="w-full chica:px-3 chica:text-base"
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
              className="w-full chica:px-3 chica:text-base"
            >
              <MapPinnedIcon aria-hidden="true" />
              <span className="chica:hidden">Cómo llegar</span>
              <span className="hidden chica:inline">Llegar</span>
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
    <Tarjeta className="gap-3 px-(--card-spacing) opacity-80 chica:gap-2">
      <DatosMedico medico={medico} />

      {medico.deactivated_at && (
        <p className="text-sm text-muted-foreground">
          Dado de baja el {formatearFecha(medico.deactivated_at)}
        </p>
      )}

      {puedeEditar && <BotonReactivar medicoId={medico.id} nombre={medico.full_name} />}
    </Tarjeta>
  )
}
