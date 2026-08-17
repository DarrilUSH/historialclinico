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

  // Chica (Sprint 13, tarea 13.4): las tres acciones de arriba -Cómo llegar,
  // Pedir viaje, Al calendario- pasan de columna completa a una FILA
  // compacta (`chica:flex-row chica:flex-wrap`, cada una `chica:flex-1` para
  // repartirse el ancho por partes iguales, según cuántas de las tres estén
  // presentes). El DOM no se reordena -mismo criterio que
  // `tarjeta-turno.tsx`-: es la MISMA lista de hijos, solo que en chica se
  // acomodan en fila en vez de en columna. Los paneles expandibles (Uber/
  // DiDi/Cabify, Google Calendar/.ics) siguen colgando debajo de su propio
  // botón disparador, ahora dentro de una columna más angosta -texto corto,
  // sin truncar-, y el aviso "Sin coordenadas" se fuerza a su propia línea
  // completa (`chica:basis-full`) para no competir por ancho con los botones.
  //
  // Sprint 14 (tanda A): "iconos con label corto" del criterio del sprint —
  // los tres disparadores llevan ahora DOS spans de texto ("Cómo llegar" /
  // "Llegar", "Pedir viaje" / "Viaje", "Al calendario" / "Agenda"), mismo
  // patrón `chica:hidden` / `hidden chica:inline` que `tarjeta-medicacion.tsx`:
  // el texto completo queda en grande, el corto en chica, nunca los dos en el
  // árbol de accesibilidad a la vez. A un tercio de los ~380px útiles cada
  // botón, el label completo llegaba a envolver a dos líneas; el corto entra
  // en una sola sin recortar información -son rótulos de botón, no datos
  // clínicos: la acción sigue siendo la misma al tocarlo-.
  return (
    <div className="flex flex-col gap-2 pt-2 border-t border-border chica:flex-row chica:flex-wrap chica:items-start">
      {/* Cómo llegar */}
      {tieneMapas && (
        <Boton
          render={<a href={linkMaps} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
          variant="secondary"
          size="sm"
          className="w-full justify-start chica:min-w-[30%] chica:flex-1 chica:justify-center chica:px-2 chica:text-xs"
        >
          <MapPinIcon className="size-4 mr-2 chica:mr-1.5 chica:size-4" aria-hidden="true" />
          {/* Chica (Sprint 14, tanda A): label corto -"Llegar"- para que las
              tres acciones entren en fila sin envolver el texto; el mismo
              patrón `chica:hidden`/`hidden chica:inline` que ya usa
              `tarjeta-medicacion.tsx`, así que el texto completo sigue en el
              árbol de accesibilidad de GRANDE y el corto en el de CHICA,
              nunca los dos a la vez. */}
          <span className="chica:hidden">Cómo llegar</span>
          <span className="hidden chica:inline">Llegar</span>
        </Boton>
      )}

      {/* Pedir viaje: expandible con opciones */}
      {tieneViajes && (
        <div className="flex flex-col gap-2 chica:min-w-[30%] chica:flex-1">
          <Boton
            onClick={() => setExpandidoViaje(!expandidoViaje)}
            variant="secondary"
            size="sm"
            className="w-full justify-between chica:justify-center chica:gap-1 chica:px-2 chica:text-xs"
          >
            <span className="flex items-center">
              <CarIcon className="size-4 mr-2 chica:mr-1.5 chica:size-4" aria-hidden="true" />
              <span className="chica:hidden">Pedir viaje</span>
              <span className="hidden chica:inline">Viaje</span>
            </span>
            <ChevronDownIcon
              className={`size-4 transition-transform chica:size-3.5 ${expandidoViaje ? "rotate-180" : ""}`}
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
        <p className="text-xs text-muted-foreground px-2 py-1 chica:basis-full">
          Cargá las coordenadas del lugar para pedir un viaje
        </p>
      )}

      {/* Agregar al calendario: expandible */}
      {tieneCalendario && (
        <div className="flex flex-col gap-2 chica:min-w-[30%] chica:flex-1">
          <Boton
            onClick={() => setExpandidoCalendario(!expandidoCalendario)}
            variant="secondary"
            size="sm"
            className="w-full justify-between chica:justify-center chica:gap-1 chica:px-2 chica:text-xs"
          >
            <span className="flex items-center">
              <CalendarIcon className="size-4 mr-2 chica:mr-1.5 chica:size-4" aria-hidden="true" />
              <span className="chica:hidden">Al calendario</span>
              <span className="hidden chica:inline">Agenda</span>
            </span>
            <ChevronDownIcon
              className={`size-4 transition-transform chica:size-3.5 ${expandidoCalendario ? "rotate-180" : ""}`}
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
