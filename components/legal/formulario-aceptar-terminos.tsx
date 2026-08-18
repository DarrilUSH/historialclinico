"use client"

/**
 * Formulario del gate de consentimiento del primer ingreso (Sprint 15,
 * tarea 15.2): un checkbox y un botón, nada más.
 *
 * Es un componente propio y no una configuración de `FormularioAuth`
 * (`components/auth/formulario-auth.tsx`) por dos razones concretas:
 *
 * 1. **No tiene campos.** `FormularioAuth` está armado alrededor de un array
 *    de `campos`; pasarle uno vacío funcionaría, pero dejaría un componente
 *    de formulario genérico haciendo de contenedor de un solo checkbox.
 * 2. **La pantalla necesita un segundo `<form>` afuera** —el de "Cerrar
 *    sesión"—, y `FormularioAuth` renderiza su `pie` DENTRO del suyo: un
 *    `<form>` anidado dentro de otro es HTML inválido y el navegador lo
 *    desarma de formas impredecibles.
 *
 * El checkbox es el mismo `<ConsentimientoLegal />` que usa `/registro`, con
 * el mismo `name="aceptaLegales"`: sin marcar por defecto, `required` del
 * lado del cliente, links a `/privacidad` y `/terminos` en pestaña nueva
 * -leer no debe costar perder el lugar- y revalidado del lado del servidor
 * por `aceptarTerminos` (`app/(auth)/actions.ts`), que es la defensa real.
 */

import { useActionState } from "react"
import { useFormStatus } from "react-dom"

import { aceptarTerminos, type EstadoAuth } from "@/app/(auth)/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { ConsentimientoLegal } from "@/components/legal/consentimiento"

const ESTADO_INICIAL: EstadoAuth = { error: null, mensaje: null }
const ID_ERROR = "aceptar-terminos-error"

export function FormularioAceptarTerminos() {
  const [estado, enviarAccion] = useActionState(aceptarTerminos, ESTADO_INICIAL)

  return (
    <form action={enviarAccion} className="flex flex-col gap-5 chica:gap-3">
      <div className="rounded-lg border border-border bg-muted/40 p-3 chica:p-2">
        <ConsentimientoLegal />
      </div>

      {estado.error && (
        <Alerta variante="error" id={ID_ERROR}>
          {estado.error}
        </Alerta>
      )}

      <BotonAceptar />
    </form>
  )
}

function BotonAceptar() {
  const { pending } = useFormStatus()

  return (
    <Boton type="submit" cargando={pending} className="w-full">
      {pending ? "Un momento…" : "Aceptar y entrar"}
    </Boton>
  )
}
