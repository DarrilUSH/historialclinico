"use client"

/**
 * Barra de acciones de logística del turno.
 *
 * Botones interactivos:
 * - "Cómo llegar" (mapa): abre Google Maps — el protagonista
 * - "Pedir un viaje": UN atajo con el destino cargado
 * - "Agregar al calendario" (expandible): Google Calendar + descarga .ics
 *
 * Solo con coordenadas se muestra el atajo de viaje. "Cómo llegar" funciona
 * con coords O dirección.
 *
 * ## De tres apps a una, y por qué (Sprint 20, adenda)
 *
 * Una usuaria notó que el detalle de su turno le ofrecía "Didi, Uber y Cabify" y
 * que en su ciudad no operan todas. El primer arreglo posible -filtrar por
 * ciudad- es el equivocado, y el dueño lo dejó dicho: *"no te concentres en
 * Ushuaia, la idea es que esta app funcione en todo el mundo, donde se quiera
 * utilizar."*
 *
 * Reencuadrado así, el problema no es "tal app no está en tal ciudad" sino que
 * **cualquier lista fija de apps de transporte va a estar mal en algún lugar del
 * mundo**. Entonces: ninguna lógica condicionada a ciudad, provincia o país, y
 * la lista se recorta a lo que sirve en todas partes.
 *
 * Quedó uno, y el criterio para elegirlo fue mecánico y no comercial: es el
 * único cuyo enlace es una URL HTTPS común, así que tocarlo SIEMPRE abre algo.
 * Los otros dos eran esquemas `app://` que no hacen nada donde la app no está
 * instalada — botones muertos, que es justamente lo que este sprint vino a
 * sacar de la aplicación. El detalle está en el bloque "NEUTRALIDAD
 * GEOGRÁFICA" de `lib/logistica/deep-links.ts`.
 *
 * Y el que manda es el mapa: funciona en todo el planeta, no depende de ninguna
 * aplicación de terceros, y su vista de direcciones ya ofrece las opciones de
 * transporte que existan en ESE lugar, mantenidas por alguien que sí puede
 * saberlo.
 */

import { useState } from "react"
import Link from "next/link"
import { MapPinIcon, CarIcon, CalendarIcon, ChevronDownIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { linkComoLlegar, linkPedirViaje, linkGoogleCalendar } from "@/lib/logistica/deep-links"

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
  // Ya no hay estado de "viaje": con un solo atajo, el desplegable desapareció.
  const [expandidoCalendario, setExpandidoCalendario] = useState(false)

  // Generar links
  const linkMaps = linkComoLlegar({ latitude, longitude, direccion })
  const linkViaje = linkPedirViaje({ latitude, longitude, nombreLugar: ubicacion })
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
  const tieneViaje = linkViaje != null
  const tieneCalendario = linkCal != null

  if (!tieneMapas && !tieneViaje && !tieneCalendario) {
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

      {/*
        Pedir un viaje: UN atajo, sin panel desplegable (Sprint 20, adenda).

        Antes eran tres -Uber, DiDi, Cabify- detrás de un desplegable rotulado
        "Pedir viaje". Dos problemas, y el segundo es el de fondo:

        1. "Pedir viaje" PROMETE un viaje. Lo único que esta pantalla puede dar
           es un atajo con el destino cargado.
        2. Cualquier lista fija de apps de transporte está mal en algún lugar
           del mundo. La app tiene que funcionar donde se la quiera usar, así
           que la respuesta no es filtrar por ciudad -eso sería volver a asumir
           geografía- sino quedarse con lo que sirve en todas partes. Ver el
           bloque "NEUTRALIDAD GEOGRÁFICA" de `lib/logistica/deep-links.ts`.

        Con un solo destino, el desplegable dejó de tener sentido: era un toque
        de más para llegar a un único botón.
      */}
      {tieneViaje && (
        <Boton
          render={<a href={linkViaje!} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
          variant="secondary"
          size="sm"
          className="w-full justify-center chica:min-w-[30%] chica:flex-1 chica:gap-1 chica:px-2 chica:text-xs"
        >
          <CarIcon className="size-4 mr-2 chica:mr-1.5 chica:size-4" aria-hidden="true" />
          <span className="chica:hidden">Pedir un viaje</span>
          <span className="hidden chica:inline">Viaje</span>
        </Boton>
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
