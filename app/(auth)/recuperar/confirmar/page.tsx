import type { Metadata } from "next"
import Link from "next/link"

import { FormularioAuth } from "@/components/auth/formulario-auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { actualizarContrasena } from "@/app/(auth)/actions"

export const metadata: Metadata = {
  title: "Elegir nueva contraseña — Historial Médico",
}

export default async function PaginaRecuperarConfirmar({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>
}) {
  const parametros = await searchParams
  const codigo = parametros.code

  if (!codigo) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          {/* `como="h1"`: esta rama no pasa por `FormularioAuth`, así que
              necesita marcar su propio encabezado de pantalla (Sprint 11). */}
          <CardTitle como="h1" className="text-2xl font-semibold">
            Enlace no válido
          </CardTitle>
          <CardDescription className="text-base leading-relaxed">
            Este enlace ya no es válido o ya expiró.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-base">
            Pedí un enlace nuevo desde{" "}
            <Link
              href="/recuperar"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Recuperar contraseña
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <FormularioAuth
      titulo="Elegí tu nueva contraseña"
      descripcion="Escribila dos veces para evitar errores de tipeo."
      accion={actualizarContrasena}
      textoBoton="Guardar contraseña"
      camposOcultos={{ code: codigo }}
      campos={[
        {
          id: "password",
          etiqueta: "Nueva contraseña",
          tipo: "password",
          autoComplete: "new-password",
          ayuda: "Mínimo 8 caracteres.",
        },
        {
          id: "confirmarPassword",
          etiqueta: "Confirmar nueva contraseña",
          tipo: "password",
          autoComplete: "new-password",
        },
      ]}
    />
  )
}
