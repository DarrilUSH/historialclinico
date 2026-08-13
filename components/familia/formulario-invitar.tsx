"use client"

/**
 * Formulario "invitar por email" de `/familia`. Minimización a propósito
 * (docs/modelo-permisos.md §9.1 y §1.4): `can_view` no aparece como casilla
 * -se otorga siempre, es la base del acceso- y `can_upload` / `can_manage`
 * llegan SIN marcar por defecto, con una explicación de una línea cada una.
 */

import { useActionState, useEffect, useRef } from "react"
import { useFormStatus } from "react-dom"
import { CircleCheckIcon, Loader2Icon, SendIcon } from "lucide-react"

import { invitarFamiliar, type EstadoFamilia } from "@/app/(app)/familia/actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface FormularioInvitarProps {
  perfilId: string
}

const ESTADO_INICIAL: EstadoFamilia = { error: null, mensaje: null }

export function FormularioInvitar({ perfilId }: FormularioInvitarProps) {
  const [estado, enviarAccion] = useActionState(invitarFamiliar, ESTADO_INICIAL)
  const formRef = useRef<HTMLFormElement>(null)

  // Éxito: limpia el formulario para la próxima invitación. Es un formulario
  // no controlado (defaultChecked/value), así que se limpia con reset() en
  // vez de resetear estado de React.
  useEffect(() => {
    if (estado.mensaje) {
      formRef.current?.reset()
    }
  }, [estado.mensaje])

  return (
    <form
      ref={formRef}
      action={enviarAccion}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-suave"
    >
      <input type="hidden" name="perfilId" value={perfilId} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="familia-email" className="text-base font-medium">
          Invitar por email
        </Label>
        <Input
          id="familia-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="nombre@ejemplo.com.ar"
          aria-invalid={estado.error ? true : undefined}
          aria-describedby={estado.error ? "familia-email-error" : undefined}
          className="h-11 text-base"
        />
        <p className="text-sm text-muted-foreground">
          Tiene que ser el email de una cuenta ya creada en Historial Médico. Por defecto solo va
          a poder ver el historial.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex items-start gap-2.5 text-sm">
          <Checkbox name="canUpload" className="mt-0.5" />
          <span>
            <span className="font-medium text-foreground">Puede cargar datos</span>
            <br />
            <span className="text-muted-foreground">
              Sube documentos, turnos, medicación y mediciones nuevas.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm">
          <Checkbox name="canManage" className="mt-0.5" />
          <span>
            <span className="font-medium text-foreground">Administra</span>
            <br />
            <span className="text-muted-foreground">
              Edita y borra datos, y puede otorgar o revocar accesos de otras personas.
            </span>
          </span>
        </label>
      </div>

      {estado.error && (
        <p
          id="familia-email-error"
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive"
        >
          {estado.error}
        </p>
      )}

      {estado.mensaje && !estado.error && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-exito/40 bg-exito-suave px-3 py-2.5 text-base font-medium text-exito-fuerte"
        >
          <CircleCheckIcon className="size-4 shrink-0" aria-hidden="true" />
          {estado.mensaje}
        </p>
      )}

      <BotonInvitar />
    </form>
  )
}

function BotonInvitar() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} className="h-11 gap-2 text-base">
      {pending ? (
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <SendIcon className="size-4" aria-hidden="true" />
      )}
      {pending ? "Enviando…" : "Otorgar acceso"}
    </Button>
  )
}
