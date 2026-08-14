/**
 * Selector de PERFIL DE DESTINO para un archivo recibido por Web Share
 * Target (Sprint 11, tarea 11.2). Mismo espíritu visual que
 * `components/perfiles/selector-perfiles.tsx` (tarjetas grandes, un `<form>`
 * nativo por tarjeta con la Server Action bindeada), pero con dos diferencias
 * a propósito:
 *
 * - Solo lista perfiles donde la sesión puede cargar (`canUpload`): a
 *   diferencia del selector de perfiles del Sprint 2 -que muestra TODOS los
 *   perfiles visibles, incluidos los de solo lectura, porque ahí la acción es
 *   "entrar a mirar"-, acá la acción es "cargar un documento", así que un
 *   perfil de solo lectura no tiene sentido como destino. Si la lista queda
 *   vacía, se explica por qué en vez de mostrar una grilla en blanco.
 * - El badge nunca puede decir "Solo lectura" (por construcción, todos los
 *   perfiles que llegan acá ya tienen `canUpload`), así que se simplifica a
 *   "Tu perfil" / "Gestionado por vos" / "Podés cargar datos".
 *
 * Server Component puro: no hace falta estado de cliente, cada tarjeta ya es
 * un formulario nativo con su propia Server Action bindeada
 * (`elegirPerfilParaCompartido.bind(null, archivoId, perfil.id)`).
 *
 * ## Modo chica (Sprint 13, tarea 13.6)
 *
 * Mismo patrón que `components/perfiles/selector-perfiles.tsx` (Tanda 1):
 * tarjetas más chicas -menos padding, avatar más chico- sin sacar el nombre
 * ni el badge de relación, que siguen completos.
 */

import type { ReactNode } from "react"

import { ShieldCheckIcon, UploadIcon, UserRoundIcon } from "lucide-react"

import { elegirPerfilParaCompartido } from "@/app/(app)/(sin-nav)/compartir/actions"
import { colorAvatarPara, inicialesDe } from "@/lib/perfiles/avatar"
import { cn } from "@/lib/utils"
import type { Perfil } from "@/types/dominio"

export interface PerfilDestino {
  perfil: Perfil
  esPropio: boolean
  canManage: boolean
}

export interface SelectorDestinoProps {
  /** Id de la fila de `shared_uploads_temp` que se está por mover. */
  archivoId: string
  perfiles: PerfilDestino[]
}

export function SelectorDestino({ archivoId, perfiles }: SelectorDestinoProps) {
  if (perfiles.length === 0) {
    return (
      <p className="max-w-md text-base text-muted-foreground">
        No tenés ningún perfil donde puedas cargar documentos. Pedile a quien administra el perfil
        que corresponde que te dé permiso de carga, o subí el archivo desde tu propio perfil en
        &ldquo;Estudios&rdquo;.
      </p>
    )
  }

  return (
    <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 chica:gap-3">
      {perfiles.map(({ perfil, esPropio, canManage }) => (
        <form key={perfil.id} action={elegirPerfilParaCompartido.bind(null, archivoId, perfil.id)}>
          <TarjetaDestino perfil={perfil} esPropio={esPropio} canManage={canManage} />
        </form>
      ))}
    </div>
  )
}

function TarjetaDestino({ perfil, esPropio, canManage }: PerfilDestino) {
  return (
    <button
      type="submit"
      className={cn(
        "flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-suave",
        "transition-[transform,box-shadow] duration-[var(--duracion-media)] ease-salida",
        "hover:-translate-y-0.5 hover:border-primary hover:shadow-elevada",
        "active:translate-y-0 active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        // Modo chica (Sprint 13, tarea 13.6): mismo criterio que
        // `components/perfiles/selector-perfiles.tsx` -menos padding, avatar
        // más chico-, para que el selector de destino entre más compacto.
        "chica:gap-3 chica:p-3",
      )}
    >
      <span
        className={cn(
          "flex size-14 shrink-0 items-center justify-center rounded-full text-xl font-semibold text-avatar-foreground",
          "chica:size-11 chica:text-base",
          colorAvatarPara(perfil.id),
        )}
        aria-hidden="true"
      >
        {inicialesDe(perfil.full_name)}
      </span>

      <div className="flex min-w-0 flex-col gap-1 chica:gap-0.5">
        <span className="truncate text-lg font-semibold text-foreground chica:text-base">
          {perfil.full_name}
        </span>
        <BadgeRelacion esPropio={esPropio} canManage={canManage} />
      </div>
    </button>
  )
}

function BadgeRelacion({ esPropio, canManage }: { esPropio: boolean; canManage: boolean }) {
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
  return (
    <Badge icono={<UploadIcon className="size-3.5" aria-hidden="true" />} tono="neutro">
      Podés cargar datos
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
  tono: "primary" | "neutro"
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium",
        tono === "primary" && "bg-primary/10 text-primary",
        tono === "neutro" && "bg-muted text-foreground",
      )}
    >
      {icono}
      {children}
    </span>
  )
}
