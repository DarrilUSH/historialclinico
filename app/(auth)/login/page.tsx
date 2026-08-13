import type { Metadata } from "next"
import Link from "next/link"

import { FormularioAuth } from "@/components/auth/formulario-auth"
import { iniciarSesion } from "@/app/(auth)/actions"

export const metadata: Metadata = {
  title: "Iniciar sesión — Historial Médico",
}

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ recuperada?: string }>
}) {
  const parametros = await searchParams
  const contrasenaRecuperada = parametros.recuperada === "1"

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      {contrasenaRecuperada && (
        <p
          role="status"
          className="rounded-lg border border-green-600/30 bg-green-600/10 px-4 py-3 text-base font-medium text-green-700 dark:text-green-400"
        >
          Tu contraseña se actualizó correctamente. Iniciá sesión con la nueva contraseña.
        </p>
      )}

      <FormularioAuth
        titulo="Iniciar sesión"
        descripcion="Ingresá con tu correo y tu contraseña para ver tu historial médico."
        accion={iniciarSesion}
        textoBoton="Iniciar sesión"
        campos={[
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
            autoComplete: "current-password",
          },
        ]}
        pie={
          <div className="flex flex-col items-center gap-3 text-base">
            <Link
              href="/recuperar"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Olvidé mi contraseña
            </Link>
            <p className="text-muted-foreground">
              ¿No tenés cuenta?{" "}
              <Link
                href="/registro"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Registrate
              </Link>
            </p>
          </div>
        }
      />
    </div>
  )
}
