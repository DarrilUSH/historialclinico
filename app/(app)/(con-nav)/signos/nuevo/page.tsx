/**
 * `/signos/nuevo?tipo=tension|glucemia|peso`: alta de UNA medición (Sprint 9,
 * tarea 9.1). Exige `can_upload` (`vital_signs_insert_puede_cargar`,
 * `docs/modelo-permisos.md`) -un `can_view` que llegue acá a mano se
 * redirige a `/signos` antes de ver el formulario; si igualmente postea la
 * Server Action, `registrarSigno` vuelve a exigir el permiso y RLS es la
 * última palabra-.
 *
 * `tipo` es un `searchParams`, no un segmento de ruta: así los tres botones
 * grandes de `/signos` son links simples (`?tipo=tension`, etc.) sin
 * necesidad de tres carpetas idénticas. Un `tipo` ausente o inválido -URL
 * escrita a mano, link viejo- redirige a `/signos` en vez de mostrar un
 * formulario a medio armar.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { FormularioSigno } from "@/components/signos/formulario-signo"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { obtenerUltimaMedicion } from "@/lib/signos/consultas"
import { esSignoTipo, ETIQUETA_CARGAR } from "@/lib/signos/tipos"
import { hoyIsoUshuaia, horaUshuaia } from "@/lib/turnos/fecha"

export const metadata: Metadata = {
  title: "Nueva medición — Historial Médico",
}

export default async function PaginaNuevoSigno({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string | string[] }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canUpload) {
    redirect("/signos")
  }

  const { tipo: parametroTipo } = await searchParams
  const valorTipo = Array.isArray(parametroTipo) ? parametroTipo[0] : parametroTipo
  if (!esSignoTipo(valorTipo)) {
    redirect("/signos")
  }

  const { supabase } = await requerirSesion({ desde: "/signos" })
  const ultima = await obtenerUltimaMedicion(supabase, activo.perfil.id, valorTipo)

  const ahora = new Date()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <Link
        href="/signos"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a signos vitales
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {ETIQUETA_CARGAR[valorTipo]}
        </h1>
        <p className="text-base text-muted-foreground">Para {activo.perfil.full_name}.</p>
      </div>

      <FormularioSigno
        tipo={valorTipo}
        valoresIniciales={
          ultima
            ? {
                sistolica: ultima.systolic != null ? String(ultima.systolic) : undefined,
                diastolica: ultima.diastolic != null ? String(ultima.diastolic) : undefined,
                pulso: ultima.pulse != null ? String(ultima.pulse) : undefined,
                valor: ultima.value != null ? String(ultima.value) : undefined,
              }
            : undefined
        }
        fechaInicial={hoyIsoUshuaia(ahora)}
        horaInicial={horaUshuaia(ahora)}
      />
    </div>
  )
}
