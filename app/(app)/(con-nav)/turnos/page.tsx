/**
 * `/turnos`: agenda de turnos del perfil activo (Sprint 6, tarea 6.1 —
 * ROADMAP_SPRINTS.md). Reemplaza el stub de navegación del Sprint 3.
 *
 * Dos secciones, separadas por FECHA (no por estado): "Próximos"
 * (`appointment_date >= ahora`, ascendente -el más cercano primero-) y
 * "Pasados" (`appointment_date < ahora`, descendente, colapsados detrás de
 * "Ver anteriores" — `components/turnos/seccion-pasados.tsx`). Un turno
 * `cancelled` NO se saca de su sección: sigue viviendo donde le corresponde
 * por fecha, tachado (`components/turnos/tarjeta-turno.tsx`) — cancelar
 * cambia cómo se ve, no dónde aparece.
 *
 * `ahora` se calcula UNA sola vez acá y se pasa a las dos consultas y a cada
 * `TarjetaTurno` (su `tiempoRelativo`): así el corte entre "Próximos" y
 * "Pasados" y el texto "hoy a las..." que ve cada tarjeta usan exactamente
 * el mismo instante, sin la ventana rarísima -pero real, si cada llamada
 * usara `new Date()` por su cuenta- de que un turno quede en "Próximos" con
 * el texto "hace unos segundos".
 *
 * Botón "Nuevo turno" solo si `can_upload` (docs/modelo-permisos.md §6.1:
 * INSERT en `appointments` = dueño O `can_upload` O `can_manage`) — Diego
 * (`can_view`) ve la lista sin él, y sin el botón "Editar" de cada tarjeta.
 *
 * `?perfil=` (Sprint 6.6, docs/recordatorios.md §9): un deep link que puede
 * traer el `profile_id` del TURNO, no el del perfil activo de quien llega acá
 * -típicamente al tocar la notificación de un recordatorio-. Esta página se
 * limita a reenviarlo a `/turnos/enlace` (`turnos/enlace/route.ts`), el único
 * lugar que puede escribir la cookie de perfil activo.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense } from "react"

import { CalendarDaysIcon, CalendarPlusIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { AvisoTurno } from "@/components/turnos/aviso-turno"
import { SeccionPasados } from "@/components/turnos/seccion-pasados"
import { TarjetaTurno, type TurnoParaTarjeta } from "@/components/turnos/tarjeta-turno"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Turnos — Historial Médico",
}

const COLUMNAS = "id, specialty, doctor_name, appointment_date, location_name, location_address, status"

export default async function PaginaTurnos({
  searchParams,
}: {
  searchParams: Promise<{ perfil?: string | string[] }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  // Deep link de una notificación de turno (Sprint 6.6, docs/recordatorios.md
  // §9): el payload push arma la url como `/turnos?perfil={profile_id_del_turno}`
  // (`lib/turnos/recordatorios.ts`), que puede no ser el perfil activo de
  // quien toca el aviso -María con su propio perfil activo, notificación de
  // un turno de Roberto-.
  //
  // Esta página NO puede procesar el parámetro ella misma: cambiar el
  // perfil activo escribe una cookie, y Next.js solo permite escribir
  // cookies durante un Server Action o un Route Handler, nunca durante el
  // render de un Server Component (ni siquiera si ese componente después
  // llama a `redirect()`). Por eso se delega en `/turnos/enlace`
  // (`app/(app)/(con-nav)/turnos/enlace/route.ts`), que sí corre en esa fase.
  const { perfil: parametroPerfil } = await searchParams
  if (parametroPerfil) {
    const valor = Array.isArray(parametroPerfil) ? parametroPerfil[0] : parametroPerfil
    redirect(`/turnos/enlace?perfil=${encodeURIComponent(valor)}`)
  }

  const { supabase } = await requerirSesion({ desde: "/turnos" })
  const ahora = new Date()
  const ahoraIso = ahora.toISOString()

  const [{ data: proximos, error: errorProximos }, { data: pasados, error: errorPasados }] =
    await Promise.all([
      supabase
        .from("appointments")
        .select(COLUMNAS)
        .eq("profile_id", activo.perfil.id)
        .gte("appointment_date", ahoraIso)
        .order("appointment_date", { ascending: true }),
      supabase
        .from("appointments")
        .select(COLUMNAS)
        .eq("profile_id", activo.perfil.id)
        .lt("appointment_date", ahoraIso)
        .order("appointment_date", { ascending: false }),
    ])

  if (errorProximos || errorPasados) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold">No pudimos cargar tus turnos</h1>
        <p className="max-w-md text-base text-muted-foreground">
          Probá recargar la página en unos segundos. Si el problema sigue, escribinos.
        </p>
      </div>
    )
  }

  const listaProximos: TurnoParaTarjeta[] = proximos ?? []
  const listaPasados: TurnoParaTarjeta[] = pasados ?? []
  const sinTurnos = listaProximos.length === 0 && listaPasados.length === 0

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <Suspense fallback={null}>
        <AvisoTurno />
      </Suspense>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Turnos</h1>
        {activo.permisos.canUpload && <BotonNuevoTurno />}
      </div>

      {sinTurnos ? (
        <EstadoVacio puedeCargar={activo.permisos.canUpload} />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              Próximos
            </h2>
            {listaProximos.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-base text-muted-foreground">
                No tenés turnos próximos.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {listaProximos.map((turno) => (
                  <li key={turno.id}>
                    <TarjetaTurno turno={turno} puedeEditar={activo.permisos.canManage} ahora={ahora} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {listaPasados.length > 0 && (
            <SeccionPasados cantidad={listaPasados.length}>
              <ul className="flex flex-col gap-3">
                {listaPasados.map((turno) => (
                  <li key={turno.id}>
                    <TarjetaTurno turno={turno} puedeEditar={activo.permisos.canManage} ahora={ahora} />
                  </li>
                ))}
              </ul>
            </SeccionPasados>
          )}
        </>
      )}
    </div>
  )
}

function BotonNuevoTurno() {
  return (
    <Boton render={<Link href="/turnos/nuevo" />} nativeButton={false} size="lg">
      <CalendarPlusIcon aria-hidden="true" />
      Nuevo turno
    </Boton>
  )
}

function EstadoVacio({ puedeCargar }: { puedeCargar: boolean }) {
  return (
    <div className="flex w-full flex-col items-center gap-4 px-4 py-12 text-center">
      <span
        className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <CalendarDaysIcon className="size-8" />
      </span>
      <h2 className="text-xl font-semibold text-balance text-foreground">
        Todavía no tenés turnos cargados
      </h2>
      <p className="max-w-sm text-base text-muted-foreground">
        Acá vas a ver tus turnos médicos, con cuánto falta para cada uno y cómo llegar.
      </p>
      {puedeCargar && (
        <Boton render={<Link href="/turnos/nuevo" />} nativeButton={false} size="lg" className="mt-2">
          <CalendarPlusIcon aria-hidden="true" />
          Cargar mi primer turno
        </Boton>
      )}
    </div>
  )
}
