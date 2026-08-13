"use client"

/**
 * Una fila de la lista de accesos de `/familia`: a quién se le otorgó acceso
 * sobre el perfil activo, con sus flags como badges, un mini-formulario para
 * editar `can_upload` / `can_manage`, y un botón de revocar que abre un
 * diálogo de confirmación (shadcn/base-ui `Dialog`) antes de borrar la fila.
 *
 * `can_view` nunca se expone como casilla: es la base fija de todo acceso
 * (docs/modelo-permisos.md §4.1) y la única forma de quitarla es revocar el
 * acceso entero.
 *
 * Cuando `bloqueadaPorOtroAdministrador` es `true` (nota ⑥ de
 * docs/seguridad-rls.md §3.2: un administrador no puede tocar la fila
 * `can_manage` de otro), la tarjeta se muestra en modo solo-lectura: ni el
 * formulario de edición ni el botón de revocar aparecen, porque la base los
 * va a rechazar igual -"la UI no debe ofrecer lo que la base va a
 * rechazar"-.
 */

import type { ReactNode } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import {
  EyeIcon,
  Loader2Icon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"

import { actualizarPermiso, revocarPermiso, type EstadoFamilia } from "@/app/(app)/familia/actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { colorAvatarPara, inicialesDe } from "@/lib/perfiles/avatar"
import { cn } from "@/lib/utils"

export interface FilaPermiso {
  /** id de la fila de `family_permissions`. */
  id: string
  /** `granted_profile_id`: a quién se le otorgó el acceso. */
  perfilVinculadoId: string
  nombre: string
  canUpload: boolean
  canManage: boolean
}

interface TarjetaPermisoProps {
  /** Perfil dueño (el perfil activo), para las Server Actions. */
  perfilId: string
  permiso: FilaPermiso
  bloqueadaPorOtroAdministrador: boolean
}

const ESTADO_INICIAL: EstadoFamilia = { error: null, mensaje: null }

export function TarjetaPermiso({
  perfilId,
  permiso,
  bloqueadaPorOtroAdministrador,
}: TarjetaPermisoProps) {
  const [estadoEdicion, enviarEdicion] = useActionState(actualizarPermiso, ESTADO_INICIAL)
  const [estadoRevocacion, enviarRevocacion] = useActionState(revocarPermiso, ESTADO_INICIAL)

  // El diálogo queda sin controlar (`Dialog` maneja su propio abierto/cerrado):
  // una revocación exitosa borra la fila en el servidor y `revalidatePath`
  // desmonta esta tarjeta entera -diálogo incluido-, así que no hace falta
  // cerrarla a mano. Un error la deja abierta sola, porque nada la cierra.
  return (
    <li className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 ring-1 ring-foreground/5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white",
            colorAvatarPara(permiso.perfilVinculadoId),
          )}
          aria-hidden="true"
        >
          {inicialesDe(permiso.nombre)}
        </span>
        <div className="flex flex-col gap-2">
          <span className="text-base font-semibold text-foreground">{permiso.nombre}</span>
          <div className="flex flex-wrap gap-1.5">
            <BadgeFlag icono={<EyeIcon className="size-3.5" aria-hidden="true" />}>
              Ve el historial
            </BadgeFlag>
            {permiso.canUpload && (
              <BadgeFlag icono={<UploadIcon className="size-3.5" aria-hidden="true" />}>
                Puede cargar datos
              </BadgeFlag>
            )}
            {permiso.canManage && (
              <BadgeFlag icono={<ShieldCheckIcon className="size-3.5" aria-hidden="true" />}>
                Administra
              </BadgeFlag>
            )}
          </div>
          {bloqueadaPorOtroAdministrador && (
            <p className="max-w-xs text-xs text-muted-foreground">
              Es otro administrador de este perfil: no podés editar ni revocar su acceso.
            </p>
          )}
        </div>
      </div>

      {!bloqueadaPorOtroAdministrador && (
        <div className="flex flex-col gap-3 sm:w-64 sm:shrink-0 sm:items-stretch">
          <form
            // La clave incluye los valores actuales del servidor: si esta
            // fila se guarda (o cambia por otra vía) React desmonta y
            // vuelve a montar el formulario en vez de reutilizar el DOM, así
            // que los checkboxes -no controlados a propósito, para que se
            // puedan tocar los dos y mandar un solo POST- nunca quedan
            // mostrando un valor que ya no coincide con la base.
            key={`${permiso.canUpload}-${permiso.canManage}`}
            action={enviarEdicion}
            className="flex flex-col gap-2.5 rounded-lg bg-muted/50 p-3"
          >
            <input type="hidden" name="perfilId" value={perfilId} />
            <input type="hidden" name="permisoId" value={permiso.id} />

            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="canUpload" defaultChecked={permiso.canUpload} className="mt-0.5" />
              <span>
                <span className="font-medium text-foreground">Puede cargar datos</span>
                <br />
                <span className="text-muted-foreground">
                  Sube documentos, turnos y mediciones nuevas.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="canManage" defaultChecked={permiso.canManage} className="mt-0.5" />
              <span>
                <span className="font-medium text-foreground">Administra</span>
                <br />
                <span className="text-muted-foreground">
                  Edita y borra datos, y otorga o revoca accesos.
                </span>
              </span>
            </label>

            {estadoEdicion.error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {estadoEdicion.error}
              </p>
            )}

            <BotonGuardar />
          </form>

          <Dialog>
            <DialogTrigger render={<Button type="button" variant="destructive" size="sm" />}>
              <Trash2Icon className="size-4" aria-hidden="true" />
              Revocar acceso
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>¿Revocar el acceso de {permiso.nombre}?</DialogTitle>
                <DialogDescription>
                  Deja de ver este historial de inmediato: sus próximas consultas van a devolver
                  cero resultados. Lo que ya vio mientras tuvo acceso queda igual en el registro
                  de accesos.
                </DialogDescription>
              </DialogHeader>
              <form action={enviarRevocacion}>
                <input type="hidden" name="perfilId" value={perfilId} />
                <input type="hidden" name="permisoId" value={permiso.id} />
                {estadoRevocacion.error && (
                  <p role="alert" className="mb-1 text-sm font-medium text-destructive">
                    {estadoRevocacion.error}
                  </p>
                )}
                <DialogFooter>
                  <DialogClose render={<Button type="button" variant="outline" />}>
                    Cancelar
                  </DialogClose>
                  <BotonRevocar />
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </li>
  )
}

function BotonGuardar() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending} aria-busy={pending}>
      {pending && <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />}
      {pending ? "Guardando…" : "Guardar cambios"}
    </Button>
  )
}

function BotonRevocar() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="destructive" disabled={pending} aria-busy={pending}>
      {pending && <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />}
      {pending ? "Revocando…" : "Sí, revocar"}
    </Button>
  )
}

function BadgeFlag({ children, icono }: { children: ReactNode; icono: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
      {icono}
      {children}
    </span>
  )
}
