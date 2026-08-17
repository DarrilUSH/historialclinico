/**
 * `/perfil/sos`: edición de la ficha de datos vitales del perfil activo
 * (Sprint 8, tarea 8.2 — ROADMAP_SPRINTS.md). Contrato del modelo:
 * `docs/modelo-sos.md`.
 *
 * Esta pantalla es la de EDICIÓN. La ficha de LECTURA -grande, de máximo
 * contraste, con el `tel:` del contacto- es `/sos`, tarea 8.3, y no se
 * construye acá.
 *
 * ## Permiso: `can_manage`
 *
 * Espeja `profiles_update_administrador` (`docs/modelo-permisos.md` §6, nota
 * ②). Un `can_view` o `can_upload` que fuerce esta URL vuelve a `/inicio`
 * sin ver el formulario. Es guarda de INTERFAZ, no LA guarda: `guardarFichaSos`
 * vuelve a exigir el permiso y RLS es la última palabra -mismo criterio que
 * `medicacion/[id]/editar/page.tsx`-.
 *
 * ## La ficha se lee de `activo.perfil`, sin consulta nueva
 *
 * `obtenerPerfilActivo()` ya trae la fila entera de `profiles` (`select("*")`)
 * y está memoizada con `cache()` por request, así que las ocho columnas SOS
 * ya están en memoria: volver a consultarlas sería un viaje redundante a la
 * base para traer exactamente lo mismo.
 *
 * ## La cobertura principal se MUESTRA, pero no se edita acá
 *
 * Sale de `insurance_cards` con `is_primary = true` (tarea 8.1) y **no se
 * copia** en `profiles`: es el único dato de la ficha SOS que vive en otra
 * tabla. Se muestra en solo lectura, con el enlace a `/coberturas`, para que
 * quede claro dónde se cambia -si se editara desde dos lugares, uno de los
 * dos quedaría viejo, que en una ficha de emergencia es peor que no tenerlo-.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon, CreditCardIcon, HeartPulseIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Tarjeta } from "@/components/base/tarjeta"
import { FormularioSos, type ValoresSos } from "@/components/sos/formulario-sos"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { formatearRevisionSos } from "@/lib/sos/frescura"

export const metadata: Metadata = {
  title: "Ficha SOS — Historial Médico",
}

export default async function PaginaFichaSos({
  searchParams,
}: {
  searchParams: Promise<{ guardada?: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canManage) {
    redirect("/inicio")
  }

  const { perfil } = activo
  const { guardada } = await searchParams

  const { supabase } = await requerirSesion({ desde: "/perfil/sos" })

  // Cobertura principal (tarea 8.1): solo lectura, ver el encabezado.
  const { data: coberturaPrincipal } = await supabase
    .from("insurance_cards")
    .select("provider, plan, member_number")
    .eq("profile_id", perfil.id)
    .eq("is_primary", true)
    .maybeSingle()

  const valoresIniciales: ValoresSos = {
    grupoSanguineo: perfil.blood_type ?? "",
    alergias: perfil.allergies ?? [],
    condicionesCronicas: perfil.chronic_conditions ?? [],
    medicacionCritica: perfil.critical_medication ?? [],
    contactoNombre: perfil.emergency_contact ?? "",
    contactoTelefono: perfil.emergency_contact_phone ?? "",
    contactoVinculo: perfil.emergency_contact_relationship ?? "",
    notas: perfil.sos_notes ?? "",
  }

  const ultimaRevision = formatearRevisionSos(perfil.sos_updated_at)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-3 chica:py-3">
      <Link
        href="/inicio"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver al inicio
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-balance">
          <HeartPulseIcon className="size-6 shrink-0 text-primary" aria-hidden="true" />
          Ficha SOS
        </h1>
        <p className="text-base text-muted-foreground">
          Los datos vitales de {perfil.full_name} que se leen en una emergencia, incluso sin
          señal.
        </p>
        <p className="text-sm text-muted-foreground">
          {ultimaRevision
            ? `Última revisión: ${ultimaRevision}.`
            : "Todavía no se cargó ningún dato vital en este perfil."}
        </p>
      </div>

      {guardada === "1" && (
        <Alerta variante="exito" titulo="Ficha SOS guardada">
          Ya está disponible para la pantalla de emergencia.
        </Alerta>
      )}

      <FormularioSos valoresIniciales={valoresIniciales} />

      {/*
        Cobertura principal: dato de la ficha SOS que NO vive en `profiles`
        (ver el encabezado). Se muestra abajo del formulario, fuera de él, para
        que nadie lo confunda con un campo editable de esta pantalla.
      */}
      <Tarjeta className="gap-2 chica:gap-1.5">
        <h2 className="flex items-center gap-2 px-(--card-spacing) text-base font-semibold">
          <CreditCardIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          Cobertura principal
        </h2>
        <div className="flex flex-col gap-1 px-(--card-spacing) text-base">
          {coberturaPrincipal ? (
            <p>
              {coberturaPrincipal.provider}
              {coberturaPrincipal.plan ? ` — ${coberturaPrincipal.plan}` : ""}
              {coberturaPrincipal.member_number ? ` · N.º ${coberturaPrincipal.member_number}` : ""}
            </p>
          ) : (
            <p className="text-muted-foreground">
              No hay ninguna cobertura marcada como principal.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            La ficha SOS la toma de la billetera de coberturas.{" "}
            <Link href="/coberturas" className="font-medium text-primary underline">
              Ir a coberturas
            </Link>
          </p>
        </div>
      </Tarjeta>
    </div>
  )
}
