"use client"

/**
 * Formulario de edición de "Mis datos" (`/perfil/datos`): nombre completo,
 * fecha de nacimiento, DNI y teléfono del perfil activo. Contrato de
 * validación: `lib/validacion/perfil-datos.schema.ts`. Server Action:
 * `app/(app)/(con-nav)/perfil/datos/actions.ts`.
 *
 * Mismo molde estructural que `components/sos/formulario-sos.tsx`: un solo
 * `useActionState`, sin distinción "crear"/"editar" -la fila de `profiles`
 * siempre existe-, error único de `<Alerta>` arriba del botón.
 *
 * ## Edad en vivo bajo el campo de fecha
 *
 * `calcularEdad` (`lib/perfiles/edad.ts`) es una función pura -sin
 * `server-only`, a diferencia de las guardas- así que este Client Component
 * la reusa tal cual para recalcular la edad en cada tecleo, sin pedirle nada
 * al servidor y sin reimplementar el cálculo. Es la MISMA función que usa la
 * ficha SOS: cambiar la fecha acá y ver la edad en `/sos` un minuto después
 * siempre da el mismo número.
 *
 * ## Guardia anti doble-envío
 *
 * `guardarDatosPerfil` SÍ redirige en éxito (`redirect("/perfil/datos?guardada=1")`),
 * así que -mismo razonamiento que documenta el encabezado de
 * `formulario-sos.tsx`- el componente se desmonta antes de que un segundo
 * `submit` encolado llegue a dispararse de verdad. La guardia de todas
 * formas se aplica -mismo patrón `enviandoRef` que
 * `formulario-crear-gestionado.tsx`, commit 7285c4c-: es una línea de
 * defensa en profundidad barata (nunca ejecuta un segundo `UPDATE` mientras
 * el primero sigue en vuelo, redirija o no) y mantiene un único patrón
 * copiable en todos los formularios que escriben sobre `profiles`.
 */

import * as React from "react"
import { useActionState, useEffect, useRef, type FormEvent } from "react"
import { useFormStatus } from "react-dom"

import { CakeIcon, IdCardIcon, PhoneIcon, SaveIcon, UserIcon } from "lucide-react"

import {
  guardarDatosPerfil,
  type EstadoDatosPerfilAccion,
} from "@/app/(app)/(con-nav)/perfil/datos/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoTexto } from "@/components/base/campo-texto"
import { calcularEdad } from "@/lib/perfiles/edad"
import { hoyIsoUshuaia } from "@/lib/turnos/fecha"

export interface ValoresDatosPerfil {
  fullName: string
  dateOfBirth: string
  nationalId: string
  phone: string
}

const ESTADO_INICIAL: EstadoDatosPerfilAccion = { error: null }

export function FormularioDatosPerfil({
  valoresIniciales,
}: {
  valoresIniciales: ValoresDatosPerfil
}) {
  const [estado, enviarAccion, pendiente] = useActionState(guardarDatosPerfil, ESTADO_INICIAL)

  // Edad en vivo: arranca con la edad que ya corresponde al valor cargado
  // del servidor, y se recalcula en cada cambio del campo de fecha -ver el
  // comentario de cabecera del archivo-.
  const [fechaNacimiento, setFechaNacimiento] = React.useState(valoresIniciales.dateOfBirth)
  const edad = calcularEdad(fechaNacimiento || null)

  // Guardia contra el doble envío (ver comentario de cabecera del archivo).
  const enviandoRef = useRef(false)

  function bloquearEnvioDuplicado(evento: FormEvent<HTMLFormElement>) {
    if (enviandoRef.current) {
      evento.preventDefault()
      return
    }
    enviandoRef.current = true
  }

  useEffect(() => {
    if (!pendiente) enviandoRef.current = false
  }, [pendiente])

  return (
    <form
      onSubmit={bloquearEnvioDuplicado}
      action={enviarAccion}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-suave chica:gap-2.5 chica:p-3"
    >
      <CampoTexto
        id="datos-perfil-nombre"
        name="fullName"
        label="Nombre completo"
        required
        maxLength={150}
        autoComplete="name"
        icono={<UserIcon aria-hidden="true" />}
        defaultValue={valoresIniciales.fullName}
        conDictado
      />

      <div className="flex flex-col gap-1.5">
        <CampoTexto
          id="datos-perfil-nacimiento"
          name="dateOfBirth"
          label="Fecha de nacimiento"
          type="date"
          max={hoyIsoUshuaia()}
          icono={<CakeIcon aria-hidden="true" />}
          defaultValue={valoresIniciales.dateOfBirth}
          onChange={(evento) => setFechaNacimiento(evento.target.value)}
          ayuda={edad !== null ? `${edad} ${edad === 1 ? "año" : "años"}` : undefined}
        />
      </div>

      <CampoTexto
        id="datos-perfil-dni"
        name="nationalId"
        label="DNI (opcional)"
        inputMode="numeric"
        autoComplete="off"
        placeholder="30.123.456"
        icono={<IdCardIcon aria-hidden="true" />}
        defaultValue={valoresIniciales.nationalId}
        ayuda="7 u 8 dígitos, con o sin puntos."
      />

      <CampoTexto
        id="datos-perfil-telefono"
        name="phone"
        label="Teléfono (opcional)"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+54 9 2901 123456"
        icono={<PhoneIcon aria-hidden="true" />}
        defaultValue={valoresIniciales.phone}
      />

      {estado.error && <Alerta variante="error">{estado.error}</Alerta>}

      <BotonGuardar />
    </form>
  )
}

function BotonGuardar() {
  const { pending } = useFormStatus()
  return (
    <Boton type="submit" cargando={pending} className="gap-2">
      {!pending && <SaveIcon className="size-4" aria-hidden="true" />}
      {pending ? "Guardando…" : "Guardar"}
    </Boton>
  )
}
