"use client"

/**
 * Tarjeta de un centro de salud del catálogo REFES (Sprint 16, tarea 16.3).
 *
 * Muestra el nombre, el tipo de establecimiento, la dirección completa
 * (calle + localidad + provincia, armada con `lib/ubicacion/formato.ts` como
 * el resto de la app) y el sitio web si el REFES lo publica. Abajo, las dos
 * acciones que hacen que este catálogo sirva para algo el día del turno:
 * **"Cómo llegar"** y **"Pedir un viaje"**, con las MISMAS funciones de
 * `lib/logistica/deep-links.ts` que usan la tarjeta de turno y la de médico.
 *
 * ## Las coordenadas salen del REFES: cero geocodificación
 *
 * El CSV oficial trae `longitud` y `latitud` para el 79% de los
 * establecimientos (28.340 de 36.046 en la edición vigente). Cuando están,
 * `linkComoLlegar` arma el deep link con `destination=lat,lng` -el camino
 * exacto, sin depender de que Google interprete bien "30 e/ 5 Y 6"- y
 * "Pedir un viaje" puede existir, porque ninguna app de viaje acepta un
 * destino en texto libre. Cuando no están, "Cómo llegar" cae en la búsqueda
 * por dirección y el atajo de viaje no se muestra: exactamente el mismo
 * comportamiento que un turno sin coordenadas, sin código nuevo.
 *
 * ## Un solo atajo de viaje, sin desplegable (Sprint 20, adenda)
 *
 * Eran tres -Uber, DiDi, Cabify- detrás de un panel expandible. Se redujo a uno
 * por la regla de neutralidad geográfica del producto: cualquier lista fija de
 * apps de transporte está mal en algún lugar del mundo, y dos de las tres eran
 * esquemas `app://` que no hacen NADA donde la app no está instalada. El
 * criterio y la evidencia, en el bloque "NEUTRALIDAD GEOGRÁFICA" de
 * `lib/logistica/deep-links.ts`. Con un solo destino el desplegable perdió
 * sentido, así que este componente ya no tiene estado propio.
 */

import * as React from "react"

import { CarIcon, ExternalLinkIcon, MapPinIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { CLASE_TARJETA_BASE } from "@/components/base/tarjeta"
import { direccionDelCentro, tipoDelCentro, urlSitioWeb } from "@/lib/lugares/formato"
import { linkComoLlegar, linkPedirViaje } from "@/lib/logistica/deep-links"
import { cn } from "@/lib/utils"

export interface CentroEnTarjeta {
  refes_id: string
  name: string
  typology_code: string | null
  typology_name: string | null
  funding_origin: string | null
  province: string | null
  province_refes: string
  locality_name: string | null
  postal_code: string | null
  address: string | null
  website: string | null
  latitude: number | null
  longitude: number | null
}

export function TarjetaCentro({ centro }: { centro: CentroEnTarjeta }) {
  const direccion = direccionDelCentro(centro)
  const tipo = tipoDelCentro(centro)
  const sitio = urlSitioWeb(centro.website)

  const urlComoLlegar = linkComoLlegar({
    latitude: centro.latitude,
    longitude: centro.longitude,
    direccion,
  })
  const urlPedirViaje = linkPedirViaje({
    latitude: centro.latitude,
    longitude: centro.longitude,
    nombreLugar: centro.name,
  })

  return (
    <article className={cn(CLASE_TARJETA_BASE, "px-(--card-spacing)")}>
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-balance text-foreground">{centro.name}</h3>
        {tipo && <p className="text-sm text-muted-foreground">{tipo}</p>}
      </div>

      {direccion && (
        <p className="text-base text-foreground chica:text-sm">
          {direccion}
          {centro.postal_code ? ` (CP ${centro.postal_code})` : ""}
        </p>
      )}

      {/* El origen del financiamiento contesta la pregunta que la familia se
          hace primero -"¿esto es público o privado?"-, así que va visible y
          no escondido en un detalle. */}
      {centro.funding_origin && (
        <p className="text-sm text-muted-foreground">Financiamiento: {centro.funding_origin}</p>
      )}

      {sitio && (
        <a
          href={sitio}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-primary underline underline-offset-2 hover:no-underline"
        >
          <ExternalLinkIcon className="size-4 shrink-0" aria-hidden="true" />
          {centro.website}
        </a>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-2 chica:flex-row chica:flex-wrap chica:items-start">
        {urlComoLlegar && (
          <Boton
            render={<a href={urlComoLlegar} target="_blank" rel="noopener noreferrer" />}
            nativeButton={false}
            variant="secondary"
            size="sm"
            className="w-full justify-start chica:min-w-[40%] chica:flex-1 chica:justify-center chica:px-2 chica:text-xs"
          >
            <MapPinIcon className="mr-2 size-4 chica:mr-1.5" aria-hidden="true" />
            <span className="chica:hidden">Cómo llegar</span>
            <span className="hidden chica:inline">Llegar</span>
          </Boton>
        )}

        {urlPedirViaje ? (
          <Boton
            render={<a href={urlPedirViaje} target="_blank" rel="noopener noreferrer" />}
            nativeButton={false}
            variant="secondary"
            size="sm"
            className="w-full justify-start chica:min-w-[40%] chica:flex-1 chica:justify-center chica:px-2 chica:text-xs"
          >
            <CarIcon className="mr-2 size-4 chica:mr-1.5" aria-hidden="true" />
            <span className="chica:hidden">Pedir un viaje</span>
            <span className="hidden chica:inline">Viaje</span>
          </Boton>
        ) : (
          <p className="px-2 py-1 text-xs text-muted-foreground chica:basis-full">
            El registro oficial no publica las coordenadas de este centro, así que no se puede pedir
            un viaje directo.
          </p>
        )}

      </div>
    </article>
  )
}
