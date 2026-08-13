import type { Metadata } from "next"
import Link from "next/link"

import { FormularioAuth } from "@/components/auth/formulario-auth"
import { iniciarSesion } from "@/app/(auth)/actions"
import { PARAM_DESDE, destinoSeguro } from "@/lib/auth/rutas"

export const metadata: Metadata = {
  title: "Iniciar sesión — Historial Médico",
}

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ recuperada?: string; desde?: string }>
}) {
  const parametros = await searchParams
  const contrasenaRecuperada = parametros.recuperada === "1"

  // `?desde=` lo pone `proxy.ts` cuando alguien sin sesión pide una ruta
  // privada. Se valida acá (open redirect) y viaja como campo oculto para
  // que la Server Action pueda devolver a la persona a donde quería ir.
  const destino = destinoSeguro(parametros.desde)

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      {contrasenaRecuperada && (
        <p
          role="status"
          className="rounded-lg border border-exito/40 bg-exito-suave px-4 py-3 text-base font-medium text-exito-fuerte"
        >
          Tu contraseña se actualizó correctamente. Iniciá sesión con la nueva contraseña.
        </p>
      )}

      {destino && !contrasenaRecuperada && (
        <p
          role="status"
          className="rounded-lg border border-border bg-muted px-4 py-3 text-base font-medium"
        >
          Para ver esa página necesitás iniciar sesión. Después te llevamos ahí.
        </p>
      )}

      <FormularioAuth
        titulo="Iniciar sesión"
        descripcion="Ingresá con tu correo y tu contraseña para ver tu historial médico."
        accion={iniciarSesion}
        textoBoton="Iniciar sesión"
        camposOcultos={destino ? { [PARAM_DESDE]: destino } : undefined}
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
