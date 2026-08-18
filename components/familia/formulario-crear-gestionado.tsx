"use client"

/**
 * "Crear un perfil para un familiar sin cuenta" (Sprint 15, tarea 15.1).
 * Vive en `/familia`, independiente del perfil activo: crear un perfil
 * gestionado nuevo no depende de qué perfil esté eligiendo el selector en
 * este momento, así que el formulario no recibe ningún `perfilId` -a
 * diferencia de `FormularioInvitar`, que sí otorga acceso SOBRE un perfil
 * puntual-.
 *
 * Texto neutro a propósito (docs/modelo-permisos.md §8.4: el modelo no
 * distingue por edad, ninguna política lee `date_of_birth`): sirve igual
 * para el hijo de alguien que para un padre o una madre mayor sin email.
 * Nunca dice "niño" ni "adulto mayor" en la copy visible.
 *
 * Consentimiento del representante: un único checkbox, sin marcar por
 * defecto -mismo criterio que `confirmoAcceso` en `FormularioInvitar` y
 * `<ConsentimientoLegal />` en `/registro`-, con el texto legal fijo (Ley
 * 25.326, patria potestad/tutela). `crearPerfilGestionado`
 * (`app/(app)/(con-nav)/familia/actions.ts`) revalida el checkbox del lado
 * del servidor y, si el alta tiene éxito, el RPC transaccional
 * `crear_perfil_gestionado` deja la constancia en `consents` con
 * `document: "acceso_familiar_representante"` en la MISMA transacción que
 * crea el perfil -a diferencia del flujo de invitación, acá el
 * consentimiento no es una constancia aparte de una acción que ya ocurrió:
 * es parte de la operación atómica-.
 */

import { useActionState, useEffect, useRef } from "react"
import { useFormStatus } from "react-dom"
import { UserPlusIcon } from "lucide-react"

import {
  crearPerfilGestionado,
  type EstadoCrearGestionado,
} from "@/app/(app)/(con-nav)/familia/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoTexto } from "@/components/base/campo-texto"
import { Checkbox } from "@/components/ui/checkbox"
import { hoyIsoUshuaia } from "@/lib/turnos/fecha"

const ESTADO_INICIAL: EstadoCrearGestionado = { error: null, mensaje: null }

export function FormularioCrearGestionado() {
  const [estado, enviarAccion] = useActionState(crearPerfilGestionado, ESTADO_INICIAL)
  const formRef = useRef<HTMLFormElement>(null)

  // Éxito: limpia el formulario para poder cargar a otra persona a
  // continuación, mismo patrón que FormularioInvitar (formulario no
  // controlado, así que se limpia con reset() y no con estado de React).
  useEffect(() => {
    if (estado.mensaje) {
      formRef.current?.reset()
    }
  }, [estado.mensaje])

  return (
    <form
      ref={formRef}
      action={enviarAccion}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-suave chica:gap-2.5 chica:p-3"
    >
      <CampoTexto
        id="crear-gestionado-nombre"
        name="fullName"
        label="Nombre completo"
        required
        autoComplete="off"
        placeholder="Nombre y apellido"
      />

      <CampoTexto
        id="crear-gestionado-nacimiento"
        name="dateOfBirth"
        label="Fecha de nacimiento"
        type="date"
        required
        max={hoyIsoUshuaia()}
      />

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 chica:gap-1.5 chica:p-2">
        <p className="text-sm font-medium text-foreground">
          Vas a crear un historial médico para otra persona y vas a poder verlo, cargarlo y
          administrarlo. Después podés autorizar a otros familiares con el mismo mecanismo que
          ya usás para invitar.
        </p>
        <label className="flex items-start gap-2.5 text-sm chica:gap-2">
          <Checkbox name="confirmoRepresentante" required aria-required="true" className="mt-0.5" />
          <span className="text-foreground">
            Confirmo que soy representante legal (madre, padre o tutor/a) o responsable de esta
            persona, y que doy el consentimiento correspondiente para crear y gestionar este
            historial en su nombre (Ley 25.326).
          </span>
        </label>
      </div>

      {estado.error && <Alerta variante="error">{estado.error}</Alerta>}
      {estado.mensaje && !estado.error && <Alerta variante="exito">{estado.mensaje}</Alerta>}

      <BotonCrear />
    </form>
  )
}

function BotonCrear() {
  const { pending } = useFormStatus()
  return (
    <Boton type="submit" cargando={pending} className="gap-2">
      {!pending && <UserPlusIcon className="size-4" aria-hidden="true" />}
      {pending ? "Creando…" : "Crear perfil"}
    </Boton>
  )
}
