"use client"

/**
 * Formulario "invitar por email" de `/familia`. Minimización a propósito
 * (docs/modelo-permisos.md §9.1 y §1.4): `can_view` no aparece como casilla
 * -se otorga siempre, es la base del acceso- y `can_upload` / `can_manage`
 * llegan SIN marcar por defecto, con una explicación de una línea cada una.
 */

import { useActionState, useEffect, useRef } from "react"
import { useFormStatus } from "react-dom"
import { SendIcon } from "lucide-react"

import { invitarFamiliar, type EstadoFamilia } from "@/app/(app)/(con-nav)/familia/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoTexto } from "@/components/base/campo-texto"
import { Checkbox } from "@/components/ui/checkbox"

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
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-suave chica:gap-3 chica:p-4"
    >
      <input type="hidden" name="perfilId" value={perfilId} />

      <CampoTexto
        id="familia-email"
        name="email"
        label="Invitar por email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="nombre@ejemplo.com.ar"
        ayuda="Tiene que ser el email de una cuenta ya creada en Historial Médico. Por defecto solo va a poder ver el historial."
        error={estado.error ?? undefined}
      />

      <div className="flex flex-col gap-3 chica:gap-2">
        <label className="flex items-start gap-2.5 text-sm chica:gap-2">
          <Checkbox name="canUpload" className="mt-0.5" />
          <span>
            <span className="font-medium text-foreground">Puede cargar datos</span>
            <br />
            <span className="text-muted-foreground chica:hidden">
              Sube documentos, turnos, medicación y mediciones nuevas.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm chica:gap-2">
          <Checkbox name="canManage" className="mt-0.5" />
          <span>
            <span className="font-medium text-foreground">Administra</span>
            <br />
            <span className="text-muted-foreground chica:hidden">
              Edita y borra datos, y puede otorgar o revocar accesos de otras personas.
            </span>
          </span>
        </label>
      </div>

      {estado.mensaje && !estado.error && (
        <Alerta variante="exito">{estado.mensaje}</Alerta>
      )}

      <BotonInvitar />
    </form>
  )
}

function BotonInvitar() {
  const { pending } = useFormStatus()
  return (
    <Boton type="submit" cargando={pending} className="gap-2">
      {!pending && <SendIcon className="size-4" aria-hidden="true" />}
      {pending ? "Enviando…" : "Otorgar acceso"}
    </Boton>
  )
}
