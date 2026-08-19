/**
 * Header mínimo del shell (Sprint 3): quién es el perfil activo y un acceso
 * directo para cambiarlo. Vive arriba de cada pantalla bajo
 * `app/(app)/(con-nav)/`, servido por el layout de ese route group -nunca
 * en `/perfiles`, que es justamente donde se elige el perfil activo-.
 *
 * Server Component puro: no necesita estado ni efectos, así que no paga el
 * costo de un Client Component solo para mostrar un nombre y un enlace.
 *
 * Sticky pero sobrio a propósito (ROADMAP_SPRINTS.md): fondo sólido de la
 * app, sin blur ni translucidez -esta app no hace glassmorphism en ningún
 * lado (docs/design-system.md §5)-, un único hairline (`border-borde-sutil`)
 * como límite inferior.
 *
 * ## El avatar y el nombre son un enlace a "Mis datos"
 *
 * Hueco de producto real: nunca existió una pantalla para editar el nombre,
 * la fecha de nacimiento, el DNI o el teléfono del perfil ACTIVO -solo se
 * cargaban una vez, al crear el perfil-. El header es el lugar de la app
 * donde el avatar y el nombre ya son "la tarjeta de este perfil" en cada
 * pantalla con nav, así que convertirlos en el acceso a `/perfil/datos` no
 * agrega un elemento nuevo: reutiliza uno que ya estaba ahí, con el mismo
 * criterio que usan las apps de banco/salud con las que esta compite
 * (tocar el avatar propio abre "mi perfil"). El botón "Cambiar" de perfil
 * sigue siendo un control aparte -cambiar DE perfil y editar los datos DE
 * ESTE perfil son dos acciones distintas- y no compite por espacio: son dos
 * objetivos táctiles independientes, cada uno con su propio `size-tactil`.
 */

import Link from "next/link"

import { ArrowLeftRightIcon } from "lucide-react"

import { BotonTamano } from "@/components/navegacion/boton-tamano"
import type { Tamano } from "@/lib/densidad/tamano"
import { colorAvatarPara, inicialesDe } from "@/lib/perfiles/avatar"
import { cn } from "@/lib/utils"
import type { Perfil } from "@/types/dominio"

interface EncabezadoPerfilProps {
  perfil: Perfil
  /** `permisos.esPropio` del perfil activo: decide "Tu historial" vs "Viendo a {nombre}". */
  esPropio: boolean
  /**
   * Modo de letra de la CUENTA logueada (Sprint 13) — no del perfil de arriba.
   * Es la distinción central del sprint y por eso viaja como prop aparte de
   * `perfil`: si alguna vez alguien intenta leerlo de `perfil.display_density`,
   * la app le mostraría a María el tamaño que eligió Roberto.
   */
  tamano: Tamano
}

export function EncabezadoPerfil({ perfil, esPropio, tamano }: EncabezadoPerfilProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-borde-sutil bg-background">
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2.5 chica:gap-1.5 chica:px-3 chica:py-2">
        <Link
          href="/perfil/datos"
          aria-label={
            esPropio ? "Mis datos: nombre, fecha de nacimiento, DNI y teléfono" : `Datos de ${perfil.full_name}`
          }
          className="objetivo-tactil flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 -mx-1 transition-colors duration-150 ease-salida hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-avatar-foreground",
              colorAvatarPara(perfil.id),
            )}
            aria-hidden="true"
          >
            {inicialesDe(perfil.full_name)}
          </span>

          <p className="min-w-0 flex-1 truncate text-base font-medium text-foreground">
            {esPropio ? "Tu historial" : `Viendo a ${perfil.full_name}`}
          </p>
        </Link>

        {/* Conmutador de tamaño, SIEMPRE visible (ROADMAP Sprint 13, "opción
            A"): la persona tiene que poder achicar o agrandar la letra desde
            donde esté, sin ir a buscar una pantalla de preferencias. Va antes
            de "Cambiar" porque es la acción más frecuente de las dos y queda
            más cerca del centro de la pantalla, más fácil de alcanzar con el
            pulgar. */}
        <BotonTamano tamano={tamano} />

        <Link
          href="/perfiles"
          className="objetivo-tactil inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary transition-colors duration-150 ease-salida hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 chica:gap-1 chica:px-2"
        >
          <ArrowLeftRightIcon className="size-4" aria-hidden="true" />
          Cambiar
        </Link>
      </div>
    </header>
  )
}
