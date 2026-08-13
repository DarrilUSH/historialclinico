/**
 * Home. El botón SOS destacado llega en el Sprint 8 (`components/inicio/boton-sos.tsx`);
 * por ahora esta pantalla confirma el perfil activo y cierra el flujo
 * login → selector → perfil activo de punta a punta.
 *
 * El shell (bottom nav, header con "Cambiar" de perfil) ya no vive acá: lo
 * resuelve `app/(app)/(con-nav)/layout.tsx` para las cuatro pantallas con
 * nav, así que esta página no repite el link "Cambiar de perfil" que tenía
 * antes del Sprint 3.
 *
 * Igual vuelve a llamar `obtenerPerfilActivo()` (memoizada con `cache()`,
 * ver `lib/perfil-activo.ts`) y redirige si no hay perfil válido: no confía
 * en que "el layout ya lo validó" -esta página tiene que ser correcta por sí
 * sola, sea cual sea el árbol que la termine renderizando-, y el costo real
 * es cero porque comparte el resultado memoizado del layout dentro del mismo
 * request.
 *
 * La raíz de esta pantalla es un `<div>`, no un `<main>`: ese landmark ya lo
 * pone el layout una sola vez para las cuatro pantallas con nav (dos `<main>`
 * anidados son inválidos y confunden a un lector de pantalla).
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { PillIcon } from "lucide-react"

import { ActivarNotificaciones } from "@/components/notificaciones/activar-notificaciones"
import { ProximoTurno } from "@/components/inicio/proximo-turno"
import { CLASE_TARJETA_BASE, CLASE_TARJETA_INTERACTIVA } from "@/components/base/tarjeta"
import { cn } from "@/lib/utils"
import { obtenerPerfilActivo, type PermisosPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Inicio — Historial Médico",
}

export default async function PaginaInicio() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { perfil, permisos } = activo

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-8 px-4 py-12 text-center">
      <div className="flex flex-col items-center gap-2">
        <p className="text-lg text-muted-foreground">Estás viendo el historial de</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {perfil.full_name}
        </h1>
        <p className="text-base text-muted-foreground">{descripcionRelacion(permisos)}</p>
      </div>

      {/* Próximo turno (Sprint 6, tarea 6.3) */}
      <ProximoTurno />

      {/*
        Acceso a /medicacion (Sprint 7, tarea 7.2). Sin slot propio en la
        bottom nav todavía -llega en el Sprint 9-, así que por ahora el
        camino de entrada es esta card simple: sin fetch propio (a
        diferencia de `ProximoTurno`, que sí resuelve datos), es solo un
        acceso directo, igual para cualquier permiso -Diego (`can_view`)
        también puede ver la medicación de Roberto, solo que sin botones de
        edición dentro de la pantalla-.
      */}
      <Link
        href="/medicacion"
        className={cn(CLASE_TARJETA_BASE, CLASE_TARJETA_INTERACTIVA, "w-full max-w-sm flex-row items-center gap-3 px-(--card-spacing)")}
      >
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <PillIcon className="size-5" />
        </span>
        <span className="flex flex-col text-left">
          <span className="text-base font-semibold text-foreground">Medicación</span>
          <span className="text-sm text-muted-foreground">Ver horarios, stock y días restantes</span>
        </span>
      </Link>

      {/*
        El banner de recordatorios se renderiza SIEMPRE desde el servidor y
        decide en el cliente si tiene algo que mostrar: el estado real
        (permiso del navegador + suscripción viva en el Push Service) no
        existe del lado del servidor. Ver el encabezado del componente.

        No depende del perfil activo a propósito: la suscripción pertenece a
        la CUENTA y al navegador, no al perfil que se está viendo (nota ⑰ de
        la migración de RLS). Cambiar de perfil no tiene que ofrecer activar
        de nuevo lo que ya está activo.
      */}
      <ActivarNotificaciones />
    </div>
  )
}

function descripcionRelacion(permisos: PermisosPerfilActivo): string {
  if (permisos.esPropio) {
    return "Este es tu perfil."
  }
  if (permisos.canManage) {
    return "Lo administrás vos: podés cargar y editar sus datos."
  }
  if (permisos.canUpload) {
    return "Podés cargar datos en este perfil."
  }
  return "Tenés acceso de solo lectura a este perfil."
}
