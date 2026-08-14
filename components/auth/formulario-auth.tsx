"use client"

/**
 * Formulario de autenticación compartido por /login, /registro, /recuperar
 * y /recuperar/confirmar. Un solo componente configurable por props en vez
 * de cuatro casi iguales, para no repetir la lógica de estado
 * (`useActionState`), el estado de carga del botón (`useFormStatus`) y las
 * reglas de Senior UX (labels siempre visibles, campos grandes, error en
 * texto además de color).
 */

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoTexto } from "@/components/base/campo-texto"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { EstadoAuth } from "@/app/(auth)/actions"

export interface CampoFormularioAuth {
  /** Se usa como `id`, `name` del input y como llave de React. */
  id: string
  etiqueta: string
  tipo?: React.HTMLInputTypeAttribute
  autoComplete: React.HTMLInputAutoCompleteAttribute
  requerido?: boolean
  ayuda?: string
}

interface FormularioAuthProps {
  titulo: string
  descripcion?: string
  accion: (estado: EstadoAuth, formData: FormData) => Promise<EstadoAuth>
  campos: CampoFormularioAuth[]
  /** Campos ocultos (por ejemplo el `code` del link de recupero). */
  camposOcultos?: Record<string, string>
  textoBoton: string
  /** Contenido debajo del botón: links a otras pantallas del flujo. */
  pie?: React.ReactNode
}

const ESTADO_INICIAL: EstadoAuth = { error: null, mensaje: null }
const ID_ERROR = "formulario-auth-error"

export function FormularioAuth({
  titulo,
  descripcion,
  accion,
  campos,
  camposOcultos,
  textoBoton,
  pie,
}: FormularioAuthProps) {
  const [estado, enviarAccion] = useActionState(accion, ESTADO_INICIAL)

  const huboExito = Boolean(estado.mensaje) && !estado.error

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        {/* `como="h1"` (Sprint 11, auditoría a11y): en estas pantallas la
            tarjeta es la pantalla entera, así que su título es el h1 de la
            página. Sin esto, /login, /registro, /recuperar y
            /recuperar/confirmar no tenían ningún encabezado en el DOM. */}
        <CardTitle como="h1" className="text-2xl font-semibold">
          {titulo}
        </CardTitle>
        {descripcion && (
          <CardDescription className="text-base leading-relaxed">
            {descripcion}
          </CardDescription>
        )}
      </CardHeader>

      {huboExito ? (
        <CardContent>
          <Alerta variante="exito">{estado.mensaje}</Alerta>
        </CardContent>
      ) : (
        <form action={enviarAccion} noValidate>
          <CardContent className="flex flex-col gap-5">
            {camposOcultos &&
              Object.entries(camposOcultos).map(([nombre, valor]) => (
                <input key={nombre} type="hidden" name={nombre} value={valor} />
              ))}

            {campos.map((campo) => (
              <CampoTexto
                key={campo.id}
                id={campo.id}
                label={campo.etiqueta}
                type={campo.tipo ?? "text"}
                autoComplete={campo.autoComplete}
                required={campo.requerido ?? true}
                ayuda={campo.ayuda}
                invalido={Boolean(estado.error)}
                describedBy={estado.error ? ID_ERROR : undefined}
              />
            ))}

            {estado.error && (
              <Alerta variante="error" id={ID_ERROR}>
                {estado.error}
              </Alerta>
            )}
          </CardContent>

          <CardFooter className="flex flex-col items-stretch gap-4">
            <BotonEnviar>{textoBoton}</BotonEnviar>
            {pie}
          </CardFooter>
        </form>
      )}

      {huboExito && pie && (
        <CardFooter className="flex flex-col items-stretch gap-4">{pie}</CardFooter>
      )}
    </Card>
  )
}

function BotonEnviar({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()

  return (
    <Boton type="submit" cargando={pending} className="w-full">
      {pending ? "Un momento…" : children}
    </Boton>
  )
}
