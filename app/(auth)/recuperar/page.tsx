import type { Metadata } from "next"
import Link from "next/link"

import { FormularioAuth } from "@/components/auth/formulario-auth"
import { recuperarContrasena } from "@/app/(auth)/actions"

export const metadata: Metadata = {
  title: "Recuperar contraseña — Historial Médico",
}

export default function PaginaRecuperar() {
  return (
    <FormularioAuth
      titulo="Recuperar contraseña"
      descripcion="Ingresá tu correo electrónico y te mandamos un enlace para elegir una contraseña nueva."
      accion={recuperarContrasena}
      textoBoton="Enviar enlace"
      campos={[
        {
          id: "email",
          etiqueta: "Correo electrónico",
          tipo: "email",
          autoComplete: "email",
        },
      ]}
      pie={
        <p className="text-center text-base text-muted-foreground">
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Volver a iniciar sesión
          </Link>
        </p>
      }
    />
  )
}
