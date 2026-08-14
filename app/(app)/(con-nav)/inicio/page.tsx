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

import { ActivityIcon, CreditCardIcon, HeartPulseIcon, PillIcon } from "lucide-react"

import { ActivarNotificaciones } from "@/components/notificaciones/activar-notificaciones"
import { BotonSos } from "@/components/inicio/boton-sos"
import { ProximoTurno } from "@/components/inicio/proximo-turno"
import { CLASE_TARJETA_BASE, CLASE_TARJETA_INTERACTIVA } from "@/components/base/tarjeta"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerTomasDeHoy } from "@/lib/medicacion/tomas-de-hoy"
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

  // Resumen mínimo de la card de medicación (Sprint 7, tarea 7.3): un fetch
  // simple y best-effort, la misma función que arma la sección completa de
  // `/medicacion` (`lib/medicacion/tomas-de-hoy.ts`) para no divergir en el
  // criterio de "hoy". `requerirSesion()` acá NO repite el viaje a la base
  // de `obtenerPerfilActivo()` -esa está memoizada con `cache()`-, es solo
  // el cliente de Supabase que esta función necesita y que
  // `obtenerPerfilActivo()` no expone.
  const { supabase } = await requerirSesion()
  const tomasDeHoy = await obtenerTomasDeHoy(supabase, perfil.id)
  const tomasPendientesHoy = tomasDeHoy.filter((toma) => toma.status === "pending").length

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-8 px-4 py-12 text-center">
      {/*
        Botón SOS (Sprint 8, tarea 8.3): primera cosa bajo el encabezado del
        perfil (que renderiza el layout, no esta página), arriba incluso del
        saludo. Ver el comentario de cabecera de `boton-sos.tsx` para el
        criterio de "menos de 2 toques desde cualquier pantalla" y por qué no
        suma un quinto ítem a la bottom nav.
      */}
      <BotonSos />

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
          <span className="text-sm text-muted-foreground">
            {textoResumenTomas(tomasDeHoy.length, tomasPendientesHoy)}
          </span>
        </span>
      </Link>

      {/*
        Acceso a /signos (Sprint 9, tarea 9.1). Mismo patrón que la card de
        Coberturas de abajo: sin fetch propio -"Card simple", ni contador ni
        consulta a la base, el resumen con los últimos valores vive en la
        pantalla de destino-, igual para cualquier permiso: Diego (`can_view`)
        también puede ver los signos vitales de Roberto, solo que sin los
        botones de carga dentro de la pantalla.
      */}
      <Link
        href="/signos"
        className={cn(CLASE_TARJETA_BASE, CLASE_TARJETA_INTERACTIVA, "w-full max-w-sm flex-row items-center gap-3 px-(--card-spacing)")}
      >
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <ActivityIcon className="size-5" />
        </span>
        <span className="flex flex-col text-left">
          <span className="text-base font-semibold text-foreground">Signos vitales</span>
          <span className="text-sm text-muted-foreground">Cargar tensión, glucemia y peso</span>
        </span>
      </Link>

      {/*
        Acceso a /coberturas (Sprint 8, tarea 8.1). Mismo patrón que la card
        de Medicación de arriba: sin fetch propio -es un acceso directo, no
        un resumen-, igual para cualquier permiso. "Card simple", como pide
        el criterio de la tarea: sin contador ni consulta a la base.
      */}
      <Link
        href="/coberturas"
        className={cn(CLASE_TARJETA_BASE, CLASE_TARJETA_INTERACTIVA, "w-full max-w-sm flex-row items-center gap-3 px-(--card-spacing)")}
      >
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <CreditCardIcon className="size-5" />
        </span>
        <span className="flex flex-col text-left">
          <span className="text-base font-semibold text-foreground">Coberturas</span>
          <span className="text-sm text-muted-foreground">Obra social, prepaga y credenciales</span>
        </span>
      </Link>

      {/*
        Acceso a /perfil/sos (Sprint 8, tarea 8.2): la pantalla de EDICIÓN de
        los datos vitales. La entrada GRANDE a la ficha de lectura llega con
        el botón SOS de la tarea 8.3 (`components/inicio/boton-sos.tsx`) y no
        es esta card.

        A diferencia de las dos de arriba, esta SÍ depende del permiso:
        `/perfil/sos` exige `can_manage` (espeja
        `profiles_update_administrador`, nota ② de docs/modelo-permisos.md) y
        redirige a `/inicio` a quien no lo tenga. Mostrarle la card a un
        `can_view` sería ofrecerle un camino que rebota.
      */}
      {permisos.canManage && (
        <Link
          href="/perfil/sos"
          className={cn(CLASE_TARJETA_BASE, CLASE_TARJETA_INTERACTIVA, "w-full max-w-sm flex-row items-center gap-3 px-(--card-spacing)")}
        >
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <HeartPulseIcon className="size-5" />
          </span>
          <span className="flex flex-col text-left">
            <span className="text-base font-semibold text-foreground">Ficha SOS</span>
            <span className="text-sm text-muted-foreground">Editar datos vitales</span>
          </span>
        </Link>
      )}

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

/**
 * Segunda línea de la card de medicación (Sprint 7, tarea 7.3): resumen
 * mínimo, no un fetch propio de la tarjeta -es la misma consulta de
 * `lib/medicacion/tomas-de-hoy.ts` que arma la sección completa de
 * `/medicacion`-. Sin tomas programadas hoy (perfil sin medicación con
 * horario, o solo `as_needed`) conserva el texto genérico de siempre; con
 * tomas, el dato accionable es cuántas faltan, y solo cuando no queda
 * ninguna pendiente confirma que ya están todas registradas.
 */
function textoResumenTomas(totalHoy: number, pendientes: number): string {
  if (totalHoy === 0) {
    return "Ver horarios, stock y días restantes"
  }
  if (pendientes === 0) {
    return "Todas las tomas de hoy están registradas"
  }
  return `${pendientes} ${pendientes === 1 ? "toma pendiente" : "tomas pendientes"} hoy`
}
