/**
 * `/coberturas/[id]/editar`: edición de una cobertura ya cargada (Sprint 8,
 * tarea 8.1). Exige `can_manage` (`insurance_cards` UPDATE,
 * `docs/modelo-permisos.md` §6) — un `can_view`/`can_upload` que fuerce esta
 * URL se redirige a `/coberturas` sin ver el formulario: RLS sigue siendo la
 * última palabra.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { FormularioCobertura } from "@/components/coberturas/formulario-cobertura"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Editar cobertura — Historial Médico",
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaEditarCobertura({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canManage) {
    redirect("/coberturas")
  }

  const { id } = await params

  if (!PATRON_UUID.test(id)) {
    redirect("/coberturas")
  }

  const { supabase } = await requerirSesion({ desde: "/coberturas" })

  const { data: cobertura } = await supabase
    .from("insurance_cards")
    .select("id, provider, plan, member_number, is_primary, front_storage_path, back_storage_path")
    .eq("id", id)
    .eq("profile_id", activo.perfil.id)
    .maybeSingle()

  if (!cobertura) {
    redirect("/coberturas")
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <Link
        href="/coberturas"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a coberturas
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Editar cobertura</h1>
        <p className="text-base text-muted-foreground">{cobertura.provider}</p>
      </div>

      <FormularioCobertura
        modo="editar"
        coberturaId={cobertura.id}
        valoresIniciales={{
          proveedor: cobertura.provider,
          plan: cobertura.plan ?? "",
          numeroAfiliado: cobertura.member_number ?? "",
          esPrincipal: cobertura.is_primary,
        }}
        tieneFrenteExistente={!!cobertura.front_storage_path}
        tieneDorsoExistente={!!cobertura.back_storage_path}
      />
    </div>
  )
}
