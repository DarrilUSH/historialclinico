"use client"

/**
 * Tarjeta interactiva de un perfil de destino en `SelectorDestino`
 * (`components/compartir/selector-destino.tsx`, que sigue siendo Server
 * Component: solo esta tarjeta -el `<form>` y su botón- se separó a un
 * Client Component mínimo, mismo criterio y mismo motivo que
 * `components/perfiles/tarjeta-perfil.tsx`).
 *
 * ## Mismo problema, mismo fix que `tarjeta-perfil.tsx`
 *
 * `elegirPerfilParaCompartido` (`app/(app)/(sin-nav)/compartir/actions.ts`)
 * es, igual que `elegirPerfil`, un `<form action>` CRUDO sin
 * `useActionState` que SIEMPRE termina en un único `redirect()` fuera de
 * cualquier `try/catch`. Eso la deja con la misma ventana sin feedback -acá
 * además descarga el archivo temporal y lo entrega a `ingestarDocumento`,
 * así que puede tardar más que elegir un perfil sin más- y la misma
 * necesidad de blindarse contra un doble toque: sin guardia, dos `submit`
 * sincrónicos viajan como dos peticiones reales y podrían correr
 * `ingestarDocumento` dos veces en una carrera -antes de que cualquiera de
 * las dos termine de escribir, ninguna ve todavía la huella de la otra-,
 * dejando dos documentos donde debía haber uno. Ver el comentario de
 * cabecera de `tarjeta-perfil.tsx` para el mecanismo completo (por qué un
 * `ref` síncrono y no `disabled`/`useState`, y por qué acá tampoco hace
 * falta liberarlo en un `useEffect`).
 */

import { useRef, type FormEvent, type ReactNode } from "react"
import { useFormStatus } from "react-dom"

import { Loader2Icon, ShieldCheckIcon, UploadIcon, UserRoundIcon } from "lucide-react"

import { elegirPerfilParaCompartido } from "@/app/(app)/(sin-nav)/compartir/actions"
import { colorAvatarPara, inicialesDe } from "@/lib/perfiles/avatar"
import { cn } from "@/lib/utils"
import type { Perfil } from "@/types/dominio"

export interface PerfilDestino {
  perfil: Perfil
  esPropio: boolean
  canManage: boolean
}

export interface TarjetaDestinoProps extends PerfilDestino {
  /** Id de la fila de `shared_uploads_temp` que se está por mover. */
  archivoId: string
  /**
   * Reintento de "Cargar igual" (hotfix de huella digital): agrega el campo
   * oculto `forzar=1` para que `elegirPerfilParaCompartido` cargue el
   * archivo igual en vez de repetir el aviso de duplicado.
   */
  forzar: boolean
}

export function TarjetaDestino({ archivoId, perfil, esPropio, canManage, forzar }: TarjetaDestinoProps) {
  // Guardia anti doble-envío: ver el comentario de cabecera del archivo.
  const enviandoRef = useRef(false)

  function bloquearEnvioDuplicado(evento: FormEvent<HTMLFormElement>) {
    if (enviandoRef.current) {
      evento.preventDefault()
      return
    }
    enviandoRef.current = true
  }

  return (
    <form
      onSubmit={bloquearEnvioDuplicado}
      action={elegirPerfilParaCompartido.bind(null, archivoId, perfil.id)}
    >
      {forzar && <input type="hidden" name="forzar" value="1" />}
      <BotonTarjetaDestino perfil={perfil} esPropio={esPropio} canManage={canManage} />
    </form>
  )
}

function BotonTarjetaDestino({ perfil, esPropio, canManage }: PerfilDestino) {
  // Ver el comentario de cabecera del archivo: solo funciona por vivir en un
  // componente hijo del `<form>` de arriba.
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(
        "flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-suave",
        "transition-[transform,box-shadow,opacity] duration-[var(--duracion-media)] ease-salida",
        "hover:-translate-y-0.5 hover:border-primary hover:shadow-elevada",
        "active:translate-y-0 active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        // Estado pendiente: mismo tratamiento que `tarjeta-perfil.tsx` -sin
        // mover el layout, solo opacidad, cursor y contenido interno-.
        "disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-border disabled:hover:shadow-suave",
        // Modo chica (Sprint 13, tarea 13.6): mismo criterio que
        // `components/perfiles/tarjeta-perfil.tsx` -menos padding, avatar
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
        {pending ? (
          <Loader2Icon className="size-6 animate-spin chica:size-5" aria-hidden="true" />
        ) : (
          inicialesDe(perfil.full_name)
        )}
      </span>

      <div className="flex min-w-0 flex-col gap-1 chica:gap-0.5">
        <span className="truncate text-lg font-semibold text-foreground chica:text-base">
          {perfil.full_name}
        </span>
        {pending ? (
          <span className="text-sm font-medium text-muted-foreground">Cargando…</span>
        ) : (
          <BadgeRelacion esPropio={esPropio} canManage={canManage} />
        )}
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
