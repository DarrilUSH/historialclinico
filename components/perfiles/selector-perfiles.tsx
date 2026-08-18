/**
 * Grilla del selector de perfiles ("estilo Netflix"): una tarjeta grande por
 * perfil visible, con avatar de iniciales, nombre en tipografía grande y un
 * badge que explica la relación con ese perfil.
 *
 * Server Component puro. Cada tarjeta es un `<form>` con su propia Server
 * Action (`elegirPerfil.bind(null, perfil.id)`), así que elegir un perfil
 * funciona con un solo submit nativo, sin JavaScript de cliente ni estado
 * intermedio.
 *
 * Senior UX: tarjetas grandes (bastante más que el mínimo de 48×48px),
 * tipografía de nombre en `text-xl`/`text-2xl`, sin animación de entrada ni
 * micro-interacciones de más -la única señal de interactividad es un
 * levantamiento sutil al pasar el mouse y un retroceso al presionar-.
 *
 * ## Distinción de "perfil gestionado" (Sprint 15, tarea 15.1)
 *
 * `BadgeRelacion` (esPropio/canUpload/canManage) contesta "¿qué podés hacer
 * vos con este perfil?" -y ya decía "Gestionado por vos" para un
 * `can_manage` que no es el tuyo, sea o no el perfil gestionado-.
 * `perfil.user_id === null` contesta una pregunta DISTINTA: "¿esta persona
 * tiene cuenta propia, o depende de que alguien entre a mirar sus datos?".
 * Las dos pueden divergir -un `can_manage` sobre un perfil CON cuenta
 * también existe (docs/modelo-permisos.md §4.3)-, así que se muestran como
 * dos señales separadas: la segunda, un subtítulo chico y discreto, nunca
 * reemplaza a la primera. Texto neutro a propósito -"sin cuenta propia", no
 * "niño" ni "adulto mayor"-: el mismo mecanismo sirve para los dos casos.
 */

import type { ReactNode } from "react"

import { EyeIcon, ShieldCheckIcon, UploadIcon, UserRoundIcon } from "lucide-react"

import { elegirPerfil } from "@/app/(app)/(sin-nav)/perfiles/actions"
import { colorAvatarPara, inicialesDe } from "@/lib/perfiles/avatar"
import { cn } from "@/lib/utils"
import type { Perfil } from "@/types/dominio"

export interface PerfilConRelacion {
  perfil: Perfil
  /** El actor es el titular con cuenta de este perfil. */
  esPropio: boolean
  canUpload: boolean
  canManage: boolean
}

interface SelectorPerfilesProps {
  perfiles: PerfilConRelacion[]
}

export function SelectorPerfiles({ perfiles }: SelectorPerfilesProps) {
  if (perfiles.length === 0) {
    return (
      <p className="max-w-md text-center text-base text-muted-foreground">
        Todavía no hay perfiles disponibles para tu cuenta. Si esperabas ver
        uno, pedile a quien te invitó que revise tu acceso.
      </p>
    )
  }

  return (
    <div className="grid w-full max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2 chica:gap-3">
      {perfiles.map(({ perfil, esPropio, canUpload, canManage }) => (
        <form key={perfil.id} action={elegirPerfil.bind(null, perfil.id)}>
          <TarjetaPerfil
            perfil={perfil}
            esPropio={esPropio}
            canUpload={canUpload}
            canManage={canManage}
          />
        </form>
      ))}
    </div>
  )
}

function TarjetaPerfil({
  perfil,
  esPropio,
  canUpload,
  canManage,
}: PerfilConRelacion) {
  return (
    <button
      type="submit"
      className={cn(
        "flex w-full min-h-48 flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card p-8 text-center shadow-suave",
        "transition-[transform,box-shadow] duration-[var(--duracion-media)] ease-salida",
        "hover:-translate-y-0.5 hover:border-primary hover:shadow-elevada",
        "active:translate-y-0 active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        // Modo chica (Sprint 13, tarea 13.2): perfiles más chicos -menos
        // padding, avatar más chico, menor alto mínimo- para que entren más
        // sin scroll. El nombre y el badge de relación no se tocan: siguen
        // completos, solo el aire alrededor se aprieta.
        "chica:min-h-36 chica:gap-2.5 chica:p-5",
      )}
    >
      <span
        className={cn(
          "flex size-24 shrink-0 items-center justify-center rounded-full text-3xl font-semibold text-avatar-foreground",
          "chica:size-16 chica:text-xl",
          colorAvatarPara(perfil.id),
        )}
        aria-hidden="true"
      >
        {inicialesDe(perfil.full_name)}
      </span>

      <span className="text-xl font-semibold text-balance text-foreground sm:text-2xl">
        {perfil.full_name}
      </span>

      <div className="flex flex-col items-center gap-1">
        <BadgeRelacion esPropio={esPropio} canUpload={canUpload} canManage={canManage} />
        {perfil.user_id === null && (
          <span className="text-xs text-muted-foreground">Sin cuenta propia</span>
        )}
      </div>
    </button>
  )
}

function BadgeRelacion({
  esPropio,
  canUpload,
  canManage,
}: Pick<PerfilConRelacion, "esPropio" | "canUpload" | "canManage">) {
  if (esPropio) {
    return (
      <Badge icono={<UserRoundIcon className="size-3.5" aria-hidden="true" />} tono="primary">
        Tu perfil
      </Badge>
    )
  }
  if (canManage) {
    return (
      <Badge icono={<ShieldCheckIcon className="size-3.5" aria-hidden="true" />} tono="neutro">
        Gestionado por vos
      </Badge>
    )
  }
  if (canUpload) {
    return (
      <Badge icono={<UploadIcon className="size-3.5" aria-hidden="true" />} tono="neutro">
        Podés cargar datos
      </Badge>
    )
  }
  return (
    <Badge icono={<EyeIcon className="size-3.5" aria-hidden="true" />} tono="apagado">
      Solo lectura
    </Badge>
  )
}

function Badge({
  children,
  icono,
  tono,
}: {
  children: ReactNode
  icono: ReactNode
  tono: "primary" | "neutro" | "apagado"
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
        tono === "primary" && "bg-primary/10 text-primary",
        tono === "neutro" && "bg-muted text-foreground",
        tono === "apagado" && "bg-muted text-muted-foreground",
      )}
    >
      {icono}
      {children}
    </span>
  )
}
