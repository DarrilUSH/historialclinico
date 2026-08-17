/**
 * `/signos`: signos vitales del perfil activo (Sprint 9, tarea 9.1 —
 * ROADMAP_SPRINTS.md). Dos partes:
 *
 * - Tres accesos GRANDES "Cargar tensión" / "Cargar glucemia" / "Cargar
 *   peso" -solo si `can_upload`, mismo criterio que el botón "Agregar
 *   medicación" de `/medicacion`- que van directo a
 *   `/signos/nuevo?tipo=...` con el tipo ya elegido: Senior UX, "la persona
 *   mayor no elige de un dropdown, toca el botón de lo que va a cargar".
 * - Un listado agrupado por tipo con las últimas mediciones -"últimos
 *   valores primero"-, visible para cualquier permiso (Diego, `can_view`,
 *   también puede ver los signos vitales de Roberto, solo que sin los
 *   botones de carga).
 *
 * Sin entrada en la bottom nav todavía (no hay slot libre, mismo motivo que
 * documenta `/medicacion`): se llega desde la card de `/inicio`
 * (`app/(app)/(con-nav)/inicio/page.tsx`) o por URL directa.
 *
 * Arriba de las dos partes va el banner persistente de alertas (Sprint 9,
 * tarea 9.3): `components/signos/banner-alerta.tsx`, con las filas de
 * `vital_sign_alerts` sin ver del perfil activo. Solo se pide -y solo lo deja
 * leer RLS- a quien administra el perfil (`can_manage`, el mismo conjunto que
 * recibió el push que trajo hasta acá vía `/signos/enlace`).
 *
 * Junto al título, el link "Ver historial" (Sprint 9, tarea 9.4) lleva a
 * `/signos/historial` -el gráfico de la serie de cada signo con banda de
 * referencia sombreada-. Visible para cualquier permiso, sin condición: leer
 * el historial no exige `can_upload` (a diferencia de los tres botones de
 * carga) y la propia pantalla de destino se degrada sola sin mediciones.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ChartLineIcon, PlusIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { Tarjeta } from "@/components/base/tarjeta"
import { BannerAlertasSignos } from "@/components/signos/banner-alerta"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { obtenerAlertasSinVer } from "@/lib/signos/alertas-sin-ver"
import { obtenerUltimasMedicionesPorTipo, type MedicionSigno } from "@/lib/signos/consultas"
import { formatearValorSigno } from "@/lib/signos/formato"
import {
  ETIQUETA_CARGAR,
  ETIQUETA_TIPO,
  TIPOS_SIGNO,
  type SignoTipo,
} from "@/lib/signos/tipos"
import { formatearFechaLargaTurno, formatearHoraTurno } from "@/lib/turnos/formato"
import { tiempoRelativo } from "@/lib/turnos/tiempo-relativo"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Signos vitales — Historial Médico",
}

export default async function PaginaSignos() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { supabase } = await requerirSesion({ desde: "/signos" })

  // El banner de alertas (tarea 9.3) solo tiene sentido -y solo lo deja leer
  // RLS- a quien administra el perfil (titular o can_manage): es el mismo
  // conjunto que recibe el push. Pedirlo solo bajo ese permiso evita una
  // consulta que la base igual vaciaría para can_view/can_upload.
  const [porTipo, alertasSinVer] = await Promise.all([
    obtenerUltimasMedicionesPorTipo(supabase, activo.perfil.id),
    activo.permisos.canManage ? obtenerAlertasSinVer(supabase, activo.perfil.id) : Promise.resolve([]),
  ])
  const sinMediciones = TIPOS_SIGNO.every((tipo) => porTipo[tipo].length === 0)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <div className="flex items-center justify-between gap-3 chica:gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Signos vitales</h1>
        <Link
          href="/signos/historial"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:underline"
        >
          <ChartLineIcon className="size-4" aria-hidden="true" />
          Ver historial
        </Link>
      </div>

      <BannerAlertasSignos alertas={alertasSinVer} />

      {/* Chica (Sprint 13, tarea 13.4): los tres botones de carga -"Cargar
          tensión"/"Cargar glucemia"/"Cargar peso"- ya eran fila de 3 desde
          `sm:` (pantallas anchas); en chica pasan a fila de 3 SIEMPRE, mismo
          patrón que las tres tarjetas de `cargador-documento.tsx` (Tanda 2):
          la fila compacta no depende del ancho de viewport sino del modo. */}
      {activo.permisos.canUpload && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 chica:grid-cols-3 chica:gap-2">
          {TIPOS_SIGNO.map((tipo) => (
            <BotonCargar key={tipo} tipo={tipo} />
          ))}
        </div>
      )}

      {sinMediciones ? (
        <EstadoVacio puedeCargar={activo.permisos.canUpload} />
      ) : (
        <div className="flex flex-col gap-6 chica:gap-4">
          {TIPOS_SIGNO.map((tipo) =>
            porTipo[tipo].length > 0 ? (
              <SeccionTipo key={tipo} tipo={tipo} mediciones={porTipo[tipo]} />
            ) : null,
          )}
        </div>
      )}
    </div>
  )
}

function BotonCargar({ tipo }: { tipo: SignoTipo }) {
  return (
    // Chica: el botón de `size="lg"` trae `whitespace-nowrap` de fábrica
    // (`components/ui/button.tsx`) -correcto en grande, donde entra en una
    // sola línea a ancho completo-, pero en la fila de 3 columnas "Cargar
    // glucemia" no entra en un tercio del ancho sin envolver. Se pasa a
    // layout vertical -ícono arriba, etiqueta abajo, `chica:whitespace-normal`
    // para permitir el salto de línea- en vez de recortar el texto: el ícono
    // ya se achica solo (`[&_svg:not([class*='size-'])]:size-6` de
    // `buttonVariants` ya deriva de `--spacing`, sin tocarlo acá).
    <Boton
      render={<Link href={`/signos/nuevo?tipo=${tipo}`} />}
      nativeButton={false}
      size="lg"
      className="w-full chica:h-auto chica:min-h-tactil chica:flex-col chica:gap-1 chica:px-2 chica:py-2.5 chica:text-xs chica:whitespace-normal chica:text-center"
    >
      <PlusIcon aria-hidden="true" />
      {ETIQUETA_CARGAR[tipo]}
    </Boton>
  )
}

function SeccionTipo({ tipo, mediciones }: { tipo: SignoTipo; mediciones: MedicionSigno[] }) {
  return (
    <div className="flex flex-col gap-3 chica:gap-1.5">
      <h2 className="text-lg font-semibold text-foreground">{ETIQUETA_TIPO[tipo]}</h2>

      {/* Grande: sin cambios (docs/densidad.md §4 regla 1) -tarjetas
          apiladas, envueltas en `chica:hidden` en vez de tocadas-. */}
      <ul className="flex flex-col gap-2 chica:hidden">
        {mediciones.map((medicion, indice) => (
          <li key={medicion.id}>
            <Tarjeta className={cn("gap-1 px-(--card-spacing)", indice === 0 && "ring-primary/40")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="numeros-clinicos text-xl font-bold text-foreground">
                  {formatearValorSigno(medicion)}
                </p>
                <p className="text-sm text-muted-foreground">{tiempoRelativo(medicion.measuredAt)}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {formatearFechaLargaTurno(medicion.measuredAt)} · {formatearHoraTurno(medicion.measuredAt)} hs
              </p>
            </Tarjeta>
          </li>
        ))}
      </ul>

      {/* Chica (Sprint 14, tanda A): TABLA densa -el criterio del sprint
          pide "columnas tipo/valor/fecha, una fila por medición". La
          columna "tipo" no se repite en cada fila -sería el mismo texto en
          las 5 filas de la sección- porque ya la da el `<h2>` de arriba: la
          agrupación por tipo es la misma que armó la tarea 9.1
          (`lib/signos/consultas.ts#obtenerUltimasMedicionesPorTipo`, para
          que un tipo con muchas cargas no desplace a otro) y repetirla como
          celda sería MENOS legible, no más. Una `<table>` real -no un grid
          imitando tabla- es la semántica correcta para datos tabulares:
          un lector de pantalla anuncia "columna Valor, fila 2" en vez de
          leer divs sueltos. Ningún dato se saca -docs/densidad.md §4 regla
          5-: valor, tiempo relativo, fecha larga y hora siguen los cuatro,
          la columna Fecha los apila en dos renglones chicos. */}
      <div className="hidden overflow-x-auto rounded-lg border border-border chica:block">
        <table className="w-full border-collapse">
          <caption className="sr-only">Últimas mediciones de {ETIQUETA_TIPO[tipo].toLowerCase()}</caption>
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th scope="col" className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">
                Valor
              </th>
              <th scope="col" className="px-2 py-1.5 text-right text-xs font-medium text-muted-foreground">
                Fecha
              </th>
            </tr>
          </thead>
          <tbody>
            {mediciones.map((medicion, indice) => (
              <tr
                key={medicion.id}
                className={cn("border-b border-border last:border-0", indice === 0 && "bg-primary/5")}
              >
                <td className="numeros-clinicos px-2 py-1.5 text-left text-sm font-semibold text-foreground">
                  {formatearValorSigno(medicion)}
                </td>
                <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                  <span className="block">{tiempoRelativo(medicion.measuredAt)}</span>
                  <span className="block">
                    {formatearFechaLargaTurno(medicion.measuredAt)} · {formatearHoraTurno(medicion.measuredAt)} hs
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EstadoVacio({ puedeCargar }: { puedeCargar: boolean }) {
  return (
    <div className="flex w-full flex-col items-center gap-4 px-4 py-12 text-center chica:gap-3 chica:py-8">
      <h2 className="text-xl font-semibold text-balance text-foreground">
        Todavía no hay mediciones cargadas
      </h2>
      <p className="max-w-sm text-base text-muted-foreground">
        {puedeCargar
          ? "Tocá uno de los botones de arriba para cargar la primera tensión, glucemia o peso."
          : "Todavía no se cargó ninguna medición para este perfil."}
      </p>
    </div>
  )
}
