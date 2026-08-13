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
    <div className="grid w-full max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2">
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
      )}
    >
      <span
        className={cn(
          "flex size-24 shrink-0 items-center justify-center rounded-full text-3xl font-semibold text-avatar-foreground",
          colorAvatarPara(perfil.id),
        )}
        aria-hidden="true"
      >
        {inicialesDe(perfil.full_name)}
      </span>

      <span className="text-xl font-semibold text-balance text-foreground sm:text-2xl">
        {perfil.full_name}
      </span>

      <BadgeRelacion esPropio={esPropio} canUpload={canUpload} canManage={canManage} />
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
