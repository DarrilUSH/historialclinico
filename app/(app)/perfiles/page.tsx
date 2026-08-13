/**
 * Stub del selector de perfiles — se implementa en la tarea "Selector de
 * perfiles estilo Netflix" (Sprint 2). Esta versión solo existe para poder
 * probar el flujo completo de auth: confirma server-side que hay sesión y
 * muestra el email logueado, con un botón de cerrar sesión para poder
 * volver a probar el login sin abrir una ventana de incógnito.
 *
 * Todavía no hay guardas de rutas privadas (tarea siguiente del roadmap),
 * así que esta página no redirige si no hay sesión: solo muestra un mensaje
 * distinto.
 */

import type { Metadata } from "next"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"
import { cerrarSesion } from "@/app/(auth)/actions"

export const metadata: Metadata = {
  title: "Perfiles — Historial Médico",
}

export default async function PaginaPerfiles() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <h1 className="text-2xl font-semibold">Selector de perfiles — próximamente</h1>

      {user ? (
        <>
          <p className="text-base text-muted-foreground">
            Sesión iniciada como{" "}
            <span className="font-medium text-foreground">{user.email}</span>
          </p>
          <form action={cerrarSesion}>
            <Button type="submit" variant="outline" className="h-12 text-base">
              Cerrar sesión
            </Button>
          </form>
        </>
      ) : (
        <p className="text-base text-muted-foreground">
          No hay una sesión iniciada.{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Iniciar sesión
          </Link>
        </p>
      )}
    </main>
  )
}
