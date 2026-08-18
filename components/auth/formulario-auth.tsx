"use client"

/**
 * Formulario de autenticación compartido por /login, /registro, /recuperar
 * y /recuperar/confirmar. Un solo componente configurable por props en vez
 * de cuatro casi iguales, para no repetir la lógica de estado
 * (`useActionState`), el estado de carga del botón (`useFormStatus`) y las
 * reglas de Senior UX (labels siempre visibles, campos grandes, error en
 * texto además de color).
 *
 * ## Modo chica (Sprint 13, tarea 13.6)
 *
 * La tarjeta en sí ya se achica sola -`Card` (`components/ui/card.tsx`) arma
 * su padding con `--card-spacing`, un múltiplo del token `--spacing` que
 * `app/globals.css` §5 redefine en compacta-, así que acá solo hace falta
 * apretar los gaps EXPLÍCITOS entre campos y entre el botón y el pie, que
 * son estructura y no salen gratis de ningún token.
 *
 * ## Velo de espera (Sprint 14, "Feedback de espera global")
 *
 * `mensajeEspera` es OPCIONAL y a propósito: lo pasan `/login` y `/registro`
 * ("Ingresando…" / "Creando tu cuenta…"), porque las dos disparan una
 * verificación real contra Supabase Auth que puede notarse en una conexión
 * lenta. `/recuperar` y `/recuperar/confirmar` no lo pasan -son un solo
 * envío de correo o un `UPDATE` de contraseña, casos que ya cubre el spinner
 * del propio botón (`Boton`, prop `cargando`, ver `BotonEnviar` más abajo)
 * sin que haga falta tapar la pantalla entera-. `VeloEnvio` es un componente
 * aparte, no inline en `BotonEnviar`, porque `useFormStatus()` exige un
 * descendiente del `<form>`: separarlo dejó cada uno con una sola
 * responsabilidad (el botón se deshabilita y muestra su propio spinner; el
 * velo es la señal grande y accesible que pide el ROADMAP para el público
 * mayor) sin duplicar la lectura de `pending`.
 */

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoTexto } from "@/components/base/campo-texto"
import { VeloEspera } from "@/components/base/velo-espera"
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
  /**
   * Mensaje del velo de espera global mientras la Server Action está en
   * vuelo ("Ingresando…", "Creando tu cuenta…"). Sin este prop no se monta
   * ningún velo -ver el comentario del encabezado sobre por qué
   * `/recuperar` y `/recuperar/confirmar` no lo pasan-.
   */
  mensajeEspera?: string
  /** Contenido debajo del botón: links a otras pantallas del flujo. */
  pie?: React.ReactNode
  /**
   * Contenido DENTRO del `<form>`, entre los campos y el botón de envío
   * (Sprint 12, tarea 12.1). Hoy el único uso es
   * `<ConsentimientoLegal />` en `/registro`: tiene que viajar en el mismo
   * `formData` que el resto del formulario, así que no alcanza con `pie`
   * -que también vive dentro del `<form>`, pero DESPUÉS del botón-.
   */
  consentimiento?: React.ReactNode
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
  mensajeEspera,
  pie,
  consentimiento,
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
          <CardContent className="flex flex-col gap-5 chica:gap-3">
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

            {consentimiento}

            {estado.error && (
              <Alerta variante="error" id={ID_ERROR}>
                {estado.error}
              </Alerta>
            )}
          </CardContent>

          <CardFooter className="flex flex-col items-stretch gap-4 chica:gap-3">
            <BotonEnviar>{textoBoton}</BotonEnviar>
            {pie}
          </CardFooter>

          {mensajeEspera && <VeloEnvio mensaje={mensajeEspera} />}
        </form>
      )}

      {huboExito && pie && (
        <CardFooter className="flex flex-col items-stretch gap-4 chica:gap-3">{pie}</CardFooter>
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

/**
 * Separado de `BotonEnviar` a propósito: los dos leen el mismo `pending` de
 * `useFormStatus()`, pero son dos señales distintas (el botón se deshabilita
 * y muestra su propio spinner chico; esto es el aviso grande a pantalla
 * completa) y fundirlos en un solo componente mezclaría dos
 * responsabilidades sin necesidad -ver el comentario del encabezado del
 * archivo-.
 */
function VeloEnvio({ mensaje }: { mensaje: string }) {
  const { pending } = useFormStatus()

  return <VeloEspera visible={pending} mensaje={mensaje} />
}
