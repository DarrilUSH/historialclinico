/**
 * `/medicos`: directorio de médicos del perfil activo (Sprint 10, tarea
 * 10.1 — ROADMAP_SPRINTS.md). Dos secciones: "Activos" (`doctors` con
 * `is_active = true`, orden alfabético) y "Dados de baja" (histórico,
 * colapsado, mismo patrón que "Suspendidas" de `/medicacion`).
 *
 * Botón "Agregar médico" solo si `can_upload` (`doctors_insert_puede_cargar`,
 * `docs/modelo-permisos.md` §6) — Diego (`can_view`) ve el directorio sin él,
 * y sin los botones "Editar"/"Dar de baja"/"Reactivar" de cada tarjeta
 * (`puedeEditar = permisos.canManage`, ver
 * `components/medicos/tarjeta-medico.tsx`).
 *
 * No hay entrada en la bottom nav (Sprint 10 no tiene slot libre, mismo
 * criterio que `/medicacion` y `/coberturas`): se llega desde una card en
 * `/inicio` (`app/(app)/(con-nav)/inicio/page.tsx`) o por URL directa.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { StethoscopeIcon, UserPlusIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { SeccionBajaMedicos } from "@/components/medicos/seccion-baja"
import { TarjetaMedicoActivo, TarjetaMedicoBaja } from "@/components/medicos/tarjeta-medico"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Médicos — Historial Médico",
}

const COLUMNAS_MEDICO =
  "id, profile_id, full_name, specialty, license_number, institution, phone, address, latitude, longitude, notes, is_active, deactivated_at, created_by_profile_id, created_at, updated_at"

export default async function PaginaMedicos() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { supabase } = await requerirSesion({ desde: "/medicos" })

  const [{ data: activos, error: errorActivos }, { data: baja, error: errorBaja }] = await Promise.all([
    supabase
      .from("doctors")
      .select(COLUMNAS_MEDICO)
      .eq("profile_id", activo.perfil.id)
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    supabase
      .from("doctors")
      .select(COLUMNAS_MEDICO)
      .eq("profile_id", activo.perfil.id)
      .eq("is_active", false)
      .order("deactivated_at", { ascending: false }),
  ])

  if (errorActivos || errorBaja) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold">No pudimos cargar el directorio</h1>
        <p className="max-w-md text-base text-muted-foreground">
          Probá recargar la página en unos segundos. Si el problema sigue, escribinos.
        </p>
      </div>
    )
  }

  const listaActivos = activos ?? []
  const listaBaja = baja ?? []
  const sinMedicos = listaActivos.length === 0 && listaBaja.length === 0

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Médicos</h1>
        {activo.permisos.canUpload && <BotonAgregarMedico />}
      </div>

      {sinMedicos ? (
        <EstadoVacio puedeCargar={activo.permisos.canUpload} />
      ) : (
        <>
          {listaActivos.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-base text-muted-foreground">
              No tenés médicos activos en el directorio.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {listaActivos.map((medico) => (
                <li key={medico.id}>
                  <TarjetaMedicoActivo medico={medico} puedeEditar={activo.permisos.canManage} />
                </li>
              ))}
            </ul>
          )}

          {listaBaja.length > 0 && (
            <SeccionBajaMedicos cantidad={listaBaja.length}>
              <ul className="flex flex-col gap-3">
                {listaBaja.map((medico) => (
                  <li key={medico.id}>
                    <TarjetaMedicoBaja medico={medico} puedeEditar={activo.permisos.canManage} />
                  </li>
                ))}
              </ul>
            </SeccionBajaMedicos>
          )}
        </>
      )}
    </div>
  )
}

function BotonAgregarMedico() {
  return (
    <Boton render={<Link href="/medicos/nuevo" />} nativeButton={false} size="lg">
      <UserPlusIcon aria-hidden="true" />
      Agregar médico
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
        <StethoscopeIcon className="size-8" />
      </span>
      <h2 className="text-xl font-semibold text-balance text-foreground">
        Todavía no hay médicos cargados
      </h2>
      <p className="max-w-sm text-base text-muted-foreground">
        Acá vas a tener el nombre, la especialidad y los datos de contacto de cada profesional, a
        un toque de distancia.
      </p>
      {puedeCargar && (
        <Boton render={<Link href="/medicos/nuevo" />} nativeButton={false} size="lg" className="mt-2">
          <UserPlusIcon aria-hidden="true" />
          Cargar el primer médico
        </Boton>
      )}
    </div>
  )
}
