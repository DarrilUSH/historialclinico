/**
 * `/medicacion`: medicación del perfil activo (Sprint 7, tarea 7.2 —
 * ROADMAP_SPRINTS.md). Dos secciones: "Activa" (lee `v_medicacion_estado`,
 * que ya trae `dias_restantes`/`necesita_renovacion` resueltos —
 * docs/modelo-medicacion.md §2) y "Suspendidas" (histórico, colapsado,
 * lee `medications` directo porque la vista NO incluye suspendidas).
 *
 * Botón "Agregar medicación" solo si `can_upload`
 * (`medications_insert_puede_cargar`) — Diego (`can_view`) ve la lista sin
 * él, y sin los botones "Editar"/"Suspender"/"Reactivar" de cada tarjeta
 * (`puedeEditar = permisos.canManage`, ver `components/medicacion/tarjeta-medicacion.tsx`).
 *
 * No hay entrada en la bottom nav (no hay slot libre en Sprint 7): se llega
 * desde una card en `/inicio` (`app/(app)/(con-nav)/inicio/page.tsx`) o por
 * URL directa. La bottom nav con 5+ accesos es el Sprint 9.
 *
 * `?perfil=` (Sprint 7.4): el push de renovación de receta arma la url como
 * `/medicacion?perfil={profile_id_de_la_medicacion}` (`lib/medicacion/alertas.ts`),
 * que puede no ser el perfil activo de quien toca el aviso — María con su
 * propio perfil activo recibiendo la alerta de un remedio de Roberto. Igual que
 * `turnos/page.tsx`, esta página NO puede procesarlo: cambiar el perfil activo
 * escribe una cookie, y Next.js solo lo permite en un Server Action o un Route
 * Handler. Se reenvía a `/medicacion/enlace`, que es quien lo hace.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { PillBottleIcon, PillIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import {
  anclaDeMedicacion,
  BannerRenovacion,
  type MedicacionEnRenovacion,
} from "@/components/medicacion/banner-renovacion"
import { SeccionTomasDeHoy } from "@/components/medicacion/registro-toma"
import { SeccionSuspendidas } from "@/components/medicacion/seccion-suspendidas"
import { TarjetaMedicacionActiva, TarjetaMedicacionSuspendida } from "@/components/medicacion/tarjeta-medicacion"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerTomasDeHoy } from "@/lib/medicacion/tomas-de-hoy"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Medicación — Historial Médico",
}

const COLUMNAS_SUSPENDIDAS =
  "id, name, active_ingredient, presentation, dose_amount, dose_unit, frequency, schedule_times, interval_hours, stock_units, suspended_at, start_date, end_date, notes, prescription_document_id, profile_id, created_at, updated_at, is_active, created_by_profile_id"

export default async function PaginaMedicacion({
  searchParams,
}: {
  searchParams: Promise<{ perfil?: string | string[] }>
}) {
  // Deep link del push de renovación (ver el encabezado). Se reenvía ANTES de
  // leer nada: consultar con el perfil viejo para después cambiarlo sería una
  // consulta tirada y un parpadeo de la lista equivocada.
  const { perfil: parametroPerfil } = await searchParams
  const valorPerfil = Array.isArray(parametroPerfil) ? parametroPerfil[0] : parametroPerfil
  if (valorPerfil) {
    redirect(`/medicacion/enlace?perfil=${encodeURIComponent(valorPerfil)}`)
  }

  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { supabase } = await requerirSesion({ desde: "/medicacion" })

  const [
    { data: activas, error: errorActivas },
    { data: suspendidas, error: errorSuspendidas },
    tomasDeHoy,
  ] = await Promise.all([
    supabase
      .from("v_medicacion_estado")
      .select("*")
      .eq("profile_id", activo.perfil.id)
      .order("necesita_renovacion", { ascending: false })
      .order("name", { ascending: true }),
    supabase
      .from("medications")
      .select(COLUMNAS_SUSPENDIDAS)
      .eq("profile_id", activo.perfil.id)
      .eq("is_active", false)
      .order("suspended_at", { ascending: false }),
    // Sprint 7, tarea 7.3: la sección "Tomas de hoy" arriba del listado.
    obtenerTomasDeHoy(supabase, activo.perfil.id),
  ])

  if (errorActivas || errorSuspendidas) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold">No pudimos cargar la medicación</h1>
        <p className="max-w-md text-base text-muted-foreground">
          Probá recargar la página en unos segundos. Si el problema sigue, escribinos.
        </p>
      </div>
    )
  }

  const listaActivas = activas ?? []
  const listaSuspendidas = suspendidas ?? []
  const sinMedicacion = listaActivas.length === 0 && listaSuspendidas.length === 0

  // El banner de la tarea 7.4 se arma de la MISMA lista que ya se leyó: la
  // condición es la columna `necesita_renovacion` de la vista, no una consulta
  // extra ni una lectura de `medication_renewal_alerts` -esa tabla es la cola
  // del push, no la fuente de verdad de la pantalla-. Cero queries agregadas.
  const enRenovacion: MedicacionEnRenovacion[] = listaActivas
    .filter((medicacion) => medicacion.necesita_renovacion)
    .map((medicacion) => ({
      medicationId: medicacion.medication_id ?? "",
      nombre: medicacion.name ?? "",
      diasRestantes: medicacion.dias_restantes ?? 0,
    }))

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3 chica:gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Medicación</h1>
        {activo.permisos.canUpload && <BotonAgregarMedicacion />}
      </div>

      {sinMedicacion ? (
        <EstadoVacio puedeCargar={activo.permisos.canUpload} />
      ) : (
        <>
          <BannerRenovacion medicaciones={enRenovacion} />

          <SeccionTomasDeHoy tomas={tomasDeHoy} puedeRegistrar={activo.permisos.canUpload} />

          {listaActivas.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-base text-muted-foreground chica:p-4">
              No tenés medicación activa cargada.
            </p>
          ) : (
            <ul className="flex flex-col gap-3 chica:gap-2">
              {listaActivas.map((medicacion) => (
                // El `id` es el destino de los links del banner; `scroll-mt`
                // deja aire arriba para que la tarjeta no quede pegada al borde
                // superior al saltar hasta ella.
                <li
                  key={medicacion.medication_id}
                  id={anclaDeMedicacion(medicacion.medication_id ?? "")}
                  className="scroll-mt-4"
                >
                  <TarjetaMedicacionActiva
                    medicacion={medicacion}
                    puedeEditar={activo.permisos.canManage}
                  />
                </li>
              ))}
            </ul>
          )}

          {listaSuspendidas.length > 0 && (
            <SeccionSuspendidas cantidad={listaSuspendidas.length}>
              <ul className="flex flex-col gap-3 chica:gap-2">
                {listaSuspendidas.map((medicacion) => (
                  <li key={medicacion.id}>
                    <TarjetaMedicacionSuspendida
                      medicacion={medicacion}
                      puedeEditar={activo.permisos.canManage}
                    />
                  </li>
                ))}
              </ul>
            </SeccionSuspendidas>
          )}
        </>
      )}
    </div>
  )
}

function BotonAgregarMedicacion() {
  return (
    <Boton render={<Link href="/medicacion/nuevo" />} nativeButton={false} size="lg">
      <PillIcon aria-hidden="true" />
      Agregar medicación
    </Boton>
  )
}

function EstadoVacio({ puedeCargar }: { puedeCargar: boolean }) {
  return (
    <div className="flex w-full flex-col items-center gap-4 px-4 py-12 text-center chica:gap-3 chica:py-8">
      <span
        className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary chica:size-12"
        aria-hidden="true"
      >
        <PillBottleIcon className="size-8 chica:size-6" />
      </span>
      <h2 className="text-xl font-semibold text-balance text-foreground">
        Todavía no hay medicación cargada
      </h2>
      <p className="max-w-sm text-base text-muted-foreground">
        Acá vas a ver qué toma, a qué hora y cuántos días de stock quedan.
      </p>
      {puedeCargar && (
        <Boton render={<Link href="/medicacion/nuevo" />} nativeButton={false} size="lg" className="mt-2">
          <PillIcon aria-hidden="true" />
          Cargar la primera medicación
        </Boton>
      )}
    </div>
  )
}
