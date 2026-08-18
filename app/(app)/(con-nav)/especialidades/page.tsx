/**
 * `/especialidades`: los médicos del perfil activo, agrupados por
 * especialidad (Sprint 16, tarea 16.3 — ROADMAP_SPRINTS.md §Sprint 16,
 * ítem 3, "cards de Lugares y Especialidades").
 *
 * ## Qué agrega sobre `/medicos`
 *
 * `/medicos` contesta "¿a quién tengo cargado?" y se ordena por nombre.
 * Esta pantalla contesta la pregunta inversa, que es la que aparece cuando
 * hace falta un turno: **"¿a quién tengo para cardiología?"**. Es la misma
 * lista de `doctors`, leída por el otro lado. No hay tabla nueva ni columna
 * nueva: usa `specialties[]` de la tarea 16.2, y por eso una médica que es
 * clínica Y cardióloga aparece bajo las dos (ver
 * `lib/especialidades/agrupar.ts`).
 *
 * Solo los ACTIVOS. Los dados de baja siguen visibles en `/medicos`, que es
 * el histórico; una pantalla que existe para elegir a quién pedirle turno no
 * tiene por qué ofrecer a quien ya no atiende.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { StethoscopeIcon, UserPlusIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { TarjetaMedicoActivo } from "@/components/medicos/tarjeta-medico"
import { requerirSesion } from "@/lib/auth/guardas"
import { agruparPorEspecialidad } from "@/lib/especialidades/agrupar"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Especialidades — Historial Médico",
}

const COLUMNAS_MEDICO =
  "id, profile_id, full_name, specialties, license_number, institution, phone, address, city, province, latitude, longitude, notes, is_active, deactivated_at, created_by_profile_id, created_at, updated_at"

export default async function PaginaEspecialidades() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { supabase } = await requerirSesion({ desde: "/especialidades" })

  const { data, error } = await supabase
    .from("doctors")
    .select(COLUMNAS_MEDICO)
    .eq("profile_id", activo.perfil.id)
    .eq("is_active", true)
    .order("full_name", { ascending: true })

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold">No pudimos cargar las especialidades</h1>
        <p className="max-w-md text-base text-muted-foreground">
          Probá recargar la página en unos segundos. Si el problema sigue, escribinos.
        </p>
      </div>
    )
  }

  const medicos = data ?? []
  const grupos = agruparPorEspecialidad(medicos)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3 chica:gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Especialidades</h1>
        {activo.permisos.canUpload && (
          <Boton render={<Link href="/medicos/nuevo" />} nativeButton={false} size="lg">
            <UserPlusIcon aria-hidden="true" />
            <span className="chica:hidden">Agregar médico</span>
            <span className="hidden chica:inline">Agregar</span>
          </Boton>
        )}
      </div>

      {medicos.length === 0 ? (
        <EstadoVacio puedeCargar={activo.permisos.canUpload} />
      ) : (
        <>
          <p className="text-base text-muted-foreground chica:text-sm">
            Los médicos de este perfil, ordenados por especialidad. Quien tiene más de una aparece
            en cada una.
          </p>

          {grupos.map((grupo) => (
            <section key={grupo.clave || "sin-especialidad"} className="flex flex-col gap-3 chica:gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-balance chica:text-base">
                {grupo.etiqueta}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {grupo.medicos.length}
                </span>
              </h2>
              <ul className="flex flex-col gap-3 chica:gap-2">
                {grupo.medicos.map((medico) => (
                  <li key={medico.id}>
                    {/* `nivelTitulo="h3"`: acá el h2 es la ESPECIALIDAD que
                        agrupa, así que el nombre del médico tiene que colgar
                        de ella. En `/medicos`, donde la lista cuelga directo
                        del h1, la misma tarjeta usa su h2 por defecto. */}
                    <TarjetaMedicoActivo
                      medico={medico}
                      puedeEditar={activo.permisos.canManage}
                      nivelTitulo="h3"
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

function EstadoVacio({ puedeCargar }: { puedeCargar: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border p-8 text-center chica:gap-3 chica:p-5">
      <span
        className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary chica:size-11"
        aria-hidden="true"
      >
        <StethoscopeIcon className="size-7 chica:size-5" />
      </span>
      <h2 className="text-lg font-semibold">Todavía no hay médicos cargados</h2>
      <p className="max-w-md text-base text-muted-foreground chica:text-sm">
        Cuando cargues un médico y le pongas su especialidad, acá vas a ver de un vistazo a quién
        tenés para cada una: el cardiólogo, la clínica, el oftalmólogo.
      </p>
      {puedeCargar && (
        <Boton render={<Link href="/medicos/nuevo" />} nativeButton={false} size="lg">
          <UserPlusIcon aria-hidden="true" />
          Cargar el primer médico
        </Boton>
      )}
    </div>
  )
}
