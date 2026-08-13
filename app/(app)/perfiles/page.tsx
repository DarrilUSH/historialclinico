/**
 * Stub del selector de perfiles — se implementa en la tarea "Selector de
 * perfiles estilo Netflix" (Sprint 2). Esta versión solo existe para poder
 * probar el flujo completo de auth: muestra el email logueado, con un botón
 * de cerrar sesión para poder volver a probar el login sin abrir una ventana
 * de incógnito.
 *
 * Uso canónico de `requerirSesion()`: la página no chequea la sesión a mano
 * ni contempla el caso "sin sesión". Si no hay sesión, la guarda corta el
 * render y redirige a `/login?desde=/perfiles`. Es doble cobertura a
 * propósito —`proxy.ts` ya redirige antes de llegar acá—: el proxy depende de
 * su `matcher`, y una pantalla que toca datos de salud no puede depender de
 * que nadie edite un regex.
 */

import type { Metadata } from "next"

import { Button } from "@/components/ui/button"
import { requerirSesion } from "@/lib/auth/guardas"
import { cerrarSesion } from "@/app/(auth)/actions"

export const metadata: Metadata = {
  title: "Perfiles — Historial Médico",
}

export default async function PaginaPerfiles() {
  const { usuario } = await requerirSesion({ desde: "/perfiles" })

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <h1 className="text-2xl font-semibold">Selector de perfiles — próximamente</h1>

      <p className="text-base text-muted-foreground">
        Sesión iniciada como{" "}
        <span className="font-medium text-foreground">{usuario.email}</span>
      </p>

      <form action={cerrarSesion}>
        <Button type="submit" variant="outline" className="h-12 text-base">
          Cerrar sesión
        </Button>
      </form>
    </main>
  )
}
