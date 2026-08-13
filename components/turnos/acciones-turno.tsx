"use client"

/**
 * Barra de acciones de logística del turno.
 *
 * Botones interactivos:
 * - "Cómo llegar" (mapa): abre Google Maps
 * - "Pedir viaje" (expandible): muestra opciones de Uber, DiDi, Cabify
 * - "Agregar al calendario" (expandible): Google Calendar + descarga .ics
 *
 * Solo con coordenadas se muestra "Pedir viaje". "Cómo llegar" funciona
 * con coords O dirección.
 */

import { useState } from "react"
import Link from "next/link"
import { MapPinIcon, CarIcon, CalendarIcon, ChevronDownIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { linkComoLlegar, linksPedirViaje, linkGoogleCalendar } from "@/lib/logistica/deep-links"

export interface AccionesTurnoProps {
  turnoId: string
  especialidad?: string | null
  nombreMedico?: string | null
  apellidoMedico?: string | null
  fechaHora?: string | null
  ubicacion?: string | null
  direccion?: string | null
  latitude?: number | null
  longitude?: number | null
  notas?: string | null
}

export function AccionesTurno({
  turnoId,
  especialidad,
  nombreMedico,
  apellidoMedico,
  fechaHora,
  ubicacion,
  direccion,
  latitude,
  longitude,
  notas,
}: AccionesTurnoProps) {
  const [expandidoViaje, setExpandidoViaje] = useState(false)
  const [expandidoCalendario, setExpandidoCalendario] = useState(false)

  // Generar links
  const linkMaps = linkComoLlegar({ latitude, longitude, direccion })
  const linksPedidos = linksPedirViaje({ latitude, longitude, nombreLugar: ubicacion })
  const linkCal = linkGoogleCalendar({
    especialidad,
    nombreMedico,
    apellidoMedico,
    fechaHora,
    direccion,
    notas,
  })

  // Verificar si hay algo que mostrar
  const tieneMapas = linkMaps != null
  const tieneViajes = linksPedidos.uber != null || linksPedidos.didi != null || linksPedidos.cabify != null
  const tieneCalendario = linkCal != null

  if (!tieneMapas && !tieneViajes && !tieneCalendario) {
    return null
  }

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      {/* Cómo llegar */}
      {tieneMapas && (
        <Boton
          render={<a href={linkMaps} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
          variant="secondary"
          size="sm"
          className="w-full justify-start"
        >
          <MapPinIcon className="size-4 mr-2" aria-hidden="true" />
          Cómo llegar
        </Boton>
      )}

      {/* Pedir viaje: expandible con opciones */}
      {tieneViajes && (
        <div className="space-y-2">
          <Boton
            onClick={() => setExpandidoViaje(!expandidoViaje)}
            variant="secondary"
            size="sm"
            className="w-full justify-between"
          >
            <span className="flex items-center">
              <CarIcon className="size-4 mr-2" aria-hidden="true" />
              Pedir viaje
            </span>
            <ChevronDownIcon
              className={`size-4 transition-transform ${expandidoViaje ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </Boton>

          {expandidoViaje && (
            <div className="pl-4 space-y-2 border-l border-muted-foreground">
              {/* Uber */}
              {linksPedidos.uber && (
                <Boton
                  render={<a href={linksPedidos.uber} target="_blank" rel="noopener noreferrer" />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-sm"
                >
                  <span className="font-semibold text-foreground">Uber</span>
                </Boton>
              )}

              {/* DiDi */}
              {linksPedidos.didi && (
                <Boton
                  render={<a href={linksPedidos.didi} target="_blank" rel="noopener noreferrer" />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-sm"
                >
                  <span className="font-semibold text-foreground">DiDi</span>
                </Boton>
              )}

              {/* Cabify */}
              {linksPedidos.cabify && (
                <Boton
                  render={<a href={linksPedidos.cabify} target="_blank" rel="noopener noreferrer" />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-sm"
                >
                  <span className="font-semibold text-foreground">Cabify</span>
                </Boton>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sin coordenadas: explicación */}
      {!tieneViajes && !latitude && !longitude && (
        <p className="text-xs text-muted-foreground px-2 py-1">
          Cargá las coordenadas del lugar para pedir un viaje
        </p>
      )}

      {/* Agregar al calendario: expandible */}
      {tieneCalendario && (
        <div className="space-y-2">
          <Boton
            onClick={() => setExpandidoCalendario(!expandidoCalendario)}
            variant="secondary"
            size="sm"
            className="w-full justify-between"
          >
            <span className="flex items-center">
              <CalendarIcon className="size-4 mr-2" aria-hidden="true" />
              Al calendario
            </span>
            <ChevronDownIcon
              className={`size-4 transition-transform ${expandidoCalendario ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </Boton>

          {expandidoCalendario && (
            <div className="pl-4 space-y-2 border-l border-muted-foreground">
              {/* Google Calendar */}
              <Boton
                render={<a href={linkCal} target="_blank" rel="noopener noreferrer" />}
                nativeButton={false}
                variant="ghost"
                size="sm"
                className="w-full justify-start text-sm"
              >
                <span className="font-semibold text-foreground">Google Calendar</span>
              </Boton>

              {/* Descargar .ics */}
              <Boton
                render={<Link href={`/api/turnos/${turnoId}/ics`} />}
                nativeButton={false}
                variant="ghost"
                size="sm"
                className="w-full justify-start text-sm"
              >
                <span className="font-semibold text-foreground">Descargar .ics</span>
              </Boton>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
