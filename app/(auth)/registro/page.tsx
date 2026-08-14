import type { Metadata } from "next"
import Link from "next/link"

import { FormularioAuth } from "@/components/auth/formulario-auth"
import { ConsentimientoLegal } from "@/components/legal/consentimiento"
import { registrarse } from "@/app/(auth)/actions"

export const metadata: Metadata = {
  title: "Crear cuenta — Historial Médico",
}

export default function PaginaRegistro() {
  return (
    <FormularioAuth
      titulo="Crear cuenta"
      descripcion="Registrate para empezar a guardar tu historial médico y el de tu familia."
      accion={registrarse}
      textoBoton="Crear cuenta"
      campos={[
        {
          id: "fullName",
          etiqueta: "Nombre completo",
          tipo: "text",
          autoComplete: "name",
        },
        {
          id: "email",
          etiqueta: "Correo electrónico",
          tipo: "email",
          autoComplete: "email",
        },
        {
          id: "password",
          etiqueta: "Contraseña",
          tipo: "password",
          autoComplete: "new-password",
          ayuda: "Mínimo 8 caracteres.",
        },
        {
          id: "confirmarPassword",
          etiqueta: "Confirmar contraseña",
          tipo: "password",
          autoComplete: "new-password",
        },
      ]}
      consentimiento={<ConsentimientoLegal />}
      pie={
        <p className="text-center text-base text-muted-foreground">
          ¿Ya tenés cuenta?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Iniciá sesión
          </Link>
        </p>
      }
    />
  )
}
