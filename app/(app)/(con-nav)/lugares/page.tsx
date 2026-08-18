/**
 * `/lugares`: buscador del catálogo REFES de establecimientos de salud del
 * país (Sprint 16, tarea 16.3 — ROADMAP_SPRINTS.md §Sprint 16, ítem 3).
 *
 * ## Qué es este catálogo y por qué está en una app familiar
 *
 * El Ministerio de Salud publica el Registro Federal de Establecimientos de
 * Salud (REFES) como dato abierto: 36.046 hospitales, clínicas, laboratorios,
 * centros de rehabilitación y consultorios, **con sus coordenadas**. Para la
 * familia del usuario eso resuelve dos cosas concretas: encontrar la
 * dirección exacta de un lugar del que solo se sabe el nombre ("el San Jorge
 * de Ushuaia") y llegar hasta ahí con un toque, sin geocodificar nada y sin
 * pagar una sola llamada a una API de mapas.
 *
 * ## El estado de los filtros vive en la URL
 *
 * Esta página lee `searchParams` y consulta la base en el servidor: al
 * navegador solo llegan los 40 resultados que se muestran, nunca las 36 mil
 * filas. Ver el encabezado de `components/lugares/filtros-catalogo.tsx`.
 *
 * ## Sin perfil activo requerido
 *
 * A diferencia de casi todas las pantallas con nav, esta NO llama a
 * `obtenerPerfilActivo()`: el catálogo es un dato público del Estado, igual
 * para todas las familias, y no hay nada que autorizar por perfil. Alcanza
 * con la sesión —`requerirSesion`, más `health_centers_select_con_sesion` del
 * lado de la base—. El layout con nav igual exige perfil activo para
 * renderizar el encabezado, así que la persona nunca llega acá "suelta".
 */

import type { Metadata } from "next"
import Link from "next/link"

import { HospitalIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { BotonActualizarCatalogo } from "@/components/lugares/boton-actualizar"
import { FiltrosCatalogo } from "@/components/lugares/filtros-catalogo"
import { TarjetaCentro } from "@/components/lugares/tarjeta-centro"
import { requerirSesion } from "@/lib/auth/guardas"
import { buscarCentros, leerEstadoCatalogo } from "@/lib/lugares/consulta"

export const metadata: Metadata = {
  title: "Lugares — Historial Médico",
}

const FORMATO_NUMERO = new Intl.NumberFormat("es-AR")
const FORMATO_FECHA = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "America/Argentina/Ushuaia",
})

/** Resultados por página. Más que esto en un teléfono es una lista que nadie recorre. */
const LIMITE = 40

function primerValor(valor: string | string[] | undefined): string {
  if (Array.isArray(valor)) return valor[0] ?? ""
  return valor ?? ""
}

export default async function PaginaLugares({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { supabase } = await requerirSesion({ desde: "/lugares" })
  const parametros = await searchParams

  const consulta = primerValor(parametros.q)
  const provincia = primerValor(parametros.provincia)
  const localidad = primerValor(parametros.localidad)
  const categoria = primerValor(parametros.tipo)

  const estado = await leerEstadoCatalogo(supabase)
  const catalogoVacio = estado.centros === 0

  let centros: Awaited<ReturnType<typeof buscarCentros>>["centros"] = []
  let total = 0
  let errorConsulta: string | null = null

  if (!catalogoVacio) {
    try {
      const resultado = await buscarCentros(supabase, {
        consulta,
        provincia,
        localidad,
        categoria,
        limite: LIMITE,
      })
      centros = resultado.centros
      total = resultado.total
    } catch {
      errorConsulta =
        "No pudimos consultar el catálogo en este momento. Probá recargar la página en unos segundos."
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Lugares</h1>
        <p className="text-base text-muted-foreground chica:text-sm">
          Centros de salud de todo el país, del Registro Federal del Ministerio de Salud.
        </p>
      </div>

      <section
        aria-label="Estado del catálogo"
        className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4 chica:gap-2 chica:p-3"
      >
        <p className="text-sm text-muted-foreground">
          {catalogoVacio
            ? "Todavía no descargaste el catálogo."
            : `${FORMATO_NUMERO.format(estado.centros)} centros · última actualización: ${
                estado.ultimaActualizacion
                  ? FORMATO_FECHA.format(new Date(estado.ultimaActualizacion))
                  : "sin registrar"
              }`}
        </p>

        <BotonActualizarCatalogo
          sincronizandoAlCargar={estado.sincronizando}
          hayCorridaIncompleta={estado.hayCorridaIncompleta}
        />

        {estado.ultimoError && (
          <Alerta variante="advertencia" estatica>
            La última actualización no terminó: {estado.ultimoError}
          </Alerta>
        )}
      </section>

      {catalogoVacio ? (
        <CatalogoVacio />
      ) : (
        <>
          <FiltrosCatalogo
            consulta={consulta}
            provincia={provincia}
            localidad={localidad}
            categoria={categoria}
          />

          {errorConsulta ? (
            <Alerta variante="error">{errorConsulta}</Alerta>
          ) : (
            <section aria-label="Resultados" className="flex flex-col gap-3 chica:gap-2">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {total === 0
                  ? "Ningún centro coincide con esa búsqueda."
                  : total > centros.length
                    ? `${FORMATO_NUMERO.format(total)} centros encontrados — se muestran los primeros ${centros.length}. Afiná la búsqueda para ver el que buscás.`
                    : `${FORMATO_NUMERO.format(total)} ${total === 1 ? "centro encontrado" : "centros encontrados"}.`}
              </p>

              {total === 0 && (
                <p className="rounded-xl border border-dashed border-border p-6 text-center text-base text-muted-foreground chica:p-4">
                  Probá con menos palabras, o sacá el filtro de provincia o de tipo. El registro
                  guarda los nombres tal como los inscribió cada establecimiento, así que a veces
                  conviene buscar una sola palabra distintiva.
                </p>
              )}

              <ul className="flex flex-col gap-3 chica:gap-2">
                {centros.map((centro) => (
                  <li key={centro.refes_id}>
                    <TarjetaCentro centro={centro} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Fuente: Registro Federal de Establecimientos de Salud (REFES), Ministerio de Salud de la
        Nación — datos.salud.gob.ar, licencia CC-BY-4.0. Los datos son los que publica el registro
        oficial: puede haber nombres abreviados o domicilios sin normalizar.
      </p>
    </div>
  )
}

function CatalogoVacio() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border p-8 text-center chica:gap-3 chica:p-5">
      <span
        className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary chica:size-11"
        aria-hidden="true"
      >
        <HospitalIcon className="size-7 chica:size-5" />
      </span>
      <h2 className="text-lg font-semibold">Todavía no hay centros cargados</h2>
      <p className="max-w-md text-base text-muted-foreground chica:text-sm">
        Tocá <strong>Actualizar</strong> acá arriba para descargar el listado oficial del Ministerio
        de Salud. Son unos 36.000 centros de todo el país y tarda menos de un minuto. Después vas a
        poder buscarlos por nombre, provincia y tipo, y usarlos al cargar un turno.
      </p>
      <Boton render={<Link href="/turnos/nuevo" />} nativeButton={false} variant="outline" size="lg">
        Ir a cargar un turno
      </Boton>
    </div>
  )
}
