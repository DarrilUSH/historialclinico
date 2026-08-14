/**
 * `/coberturas`: billetera de credenciales de cobertura del perfil activo
 * (Sprint 8, tarea 8.1 — ROADMAP_SPRINTS.md). La principal se lista primero.
 * Botón "Agregar cobertura" solo si `can_upload`
 * (`insurance_cards` INSERT, docs/modelo-permisos.md §6) — un `can_view`
 * como Diego ve la billetera de Roberto sin ese botón y sin las acciones de
 * cada tarjeta (`puedeEditar = permisos.canManage`, ver
 * `components/coberturas/tarjeta-cobertura.tsx`).
 *
 * Sin entrada en la bottom nav (no hay slot libre): se llega desde una card
 * simple en `/inicio`, mismo patrón que la card de medicación de la tarea
 * 7.2.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { CreditCardIcon, PlusIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { TarjetaCobertura } from "@/components/coberturas/tarjeta-cobertura"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Coberturas — Historial Médico",
}

export default async function PaginaCoberturas() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { supabase } = await requerirSesion({ desde: "/coberturas" })

  const { data: coberturas, error } = await supabase
    .from("insurance_cards")
    .select("id, provider, plan, member_number, is_primary, front_storage_path, back_storage_path")
    .eq("profile_id", activo.perfil.id)
    .order("is_primary", { ascending: false })
    .order("provider", { ascending: true })

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold">No pudimos cargar las coberturas</h1>
        <p className="max-w-md text-base text-muted-foreground">
          Probá recargar la página en unos segundos. Si el problema sigue, escribinos.
        </p>
      </div>
    )
  }

  const lista = coberturas ?? []

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3 chica:gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Coberturas</h1>
        {activo.permisos.canUpload && <BotonAgregarCobertura />}
      </div>

      {lista.length === 0 ? (
        <EstadoVacio puedeCargar={activo.permisos.canUpload} />
      ) : (
        <ul className="flex flex-col gap-3 chica:gap-2">
          {lista.map((cobertura) => (
            <li key={cobertura.id}>
              <TarjetaCobertura cobertura={cobertura} puedeEditar={activo.permisos.canManage} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BotonAgregarCobertura() {
  return (
    <Boton render={<Link href="/coberturas/nuevo" />} nativeButton={false} size="lg">
      <PlusIcon aria-hidden="true" />
      Agregar cobertura
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
        <CreditCardIcon className="size-8 chica:size-6" />
      </span>
      <h2 className="text-xl font-semibold text-balance text-foreground">
        Todavía no hay coberturas cargadas
      </h2>
      <p className="max-w-sm text-base text-muted-foreground">
        Guardá acá la obra social o prepaga, el número de afiliado y las fotos de la credencial
        para tenerlas a mano.
      </p>
      {puedeCargar && (
        <Boton render={<Link href="/coberturas/nuevo" />} nativeButton={false} size="lg" className="mt-2">
          <PlusIcon aria-hidden="true" />
          Cargar la primera cobertura
        </Boton>
      )}
    </div>
  )
}
