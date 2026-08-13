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
import { CircleCheckIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
        <CardTitle className="text-2xl font-semibold">{titulo}</CardTitle>
        {descripcion && (
          <CardDescription className="text-base leading-relaxed">
            {descripcion}
          </CardDescription>
        )}
      </CardHeader>

      {huboExito ? (
        <CardContent>
          <div
            role="status"
            className="flex items-start gap-3 rounded-lg border border-green-600/30 bg-green-600/10 px-4 py-3 text-base font-medium text-green-700 dark:text-green-400"
          >
            <CircleCheckIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <span>{estado.mensaje}</span>
          </div>
        </CardContent>
      ) : (
        <form action={enviarAccion} noValidate>
          <CardContent className="flex flex-col gap-5">
            {camposOcultos &&
              Object.entries(camposOcultos).map(([nombre, valor]) => (
                <input key={nombre} type="hidden" name={nombre} value={valor} />
              ))}

            {campos.map((campo) => (
              <div key={campo.id} className="flex flex-col gap-2">
                <Label htmlFor={campo.id} className="text-base font-medium">
                  {campo.etiqueta}
                </Label>
                <Input
                  id={campo.id}
                  name={campo.id}
                  type={campo.tipo ?? "text"}
                  autoComplete={campo.autoComplete}
                  required={campo.requerido ?? true}
                  aria-invalid={estado.error ? true : undefined}
                  aria-describedby={estado.error ? "formulario-auth-error" : undefined}
                  className="h-12 text-base md:text-base"
                />
                {campo.ayuda && (
                  <p className="text-sm text-muted-foreground">{campo.ayuda}</p>
                )}
              </div>
            ))}

            {estado.error && (
              <p
                id="formulario-auth-error"
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-base font-medium text-destructive"
              >
                {estado.error}
              </p>
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
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="h-12 w-full text-base"
    >
      {pending && <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />}
      {pending ? "Un momento…" : children}
    </Button>
  )
}
