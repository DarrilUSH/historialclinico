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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
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

      {activo.permisos.canUpload && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {TIPOS_SIGNO.map((tipo) => (
            <BotonCargar key={tipo} tipo={tipo} />
          ))}
        </div>
      )}

      {sinMediciones ? (
        <EstadoVacio puedeCargar={activo.permisos.canUpload} />
      ) : (
        <div className="flex flex-col gap-6">
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
    <Boton
      render={<Link href={`/signos/nuevo?tipo=${tipo}`} />}
      nativeButton={false}
      size="lg"
      className="w-full"
    >
      <PlusIcon aria-hidden="true" />
      {ETIQUETA_CARGAR[tipo]}
    </Boton>
  )
}

function SeccionTipo({ tipo, mediciones }: { tipo: SignoTipo; mediciones: MedicionSigno[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">{ETIQUETA_TIPO[tipo]}</h2>
      <ul className="flex flex-col gap-2">
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
    </div>
  )
}

function EstadoVacio({ puedeCargar }: { puedeCargar: boolean }) {
  return (
    <div className="flex w-full flex-col items-center gap-4 px-4 py-12 text-center">
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
