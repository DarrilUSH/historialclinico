import type { Metadata } from "next"
import Link from "next/link"

import { FormularioAuth } from "@/components/auth/formulario-auth"
import { PurgaCacheOffline } from "@/components/pwa/purga-cache-offline"
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
    <div className="flex w-full max-w-md flex-col gap-4 chica:gap-3">
      {/* Llegar acá significa que este dispositivo no tiene sesión —por logout
          o porque venció—, así que la copia offline de la ficha de salud que
          haya quedado guardada se borra. No pinta nada. Ver
          `lib/pwa/registrar-sw.ts#purgarCacheOffline`. */}
      <PurgaCacheOffline />

      {contrasenaRecuperada && (
        <p
          role="status"
          className="rounded-lg border border-exito/40 bg-exito-suave px-4 py-3 text-base font-medium text-exito-fuerte chica:px-3 chica:py-2"
        >
          Tu contraseña se actualizó correctamente.{" "}
          {/* Chica (Sprint 13, tarea 13.6): la instrucción es redundante en
              esta pantalla -ya estás en el login, no hace falta decírtelo-,
              así que queda como ayuda contextual que se oculta en compacto. */}
          <span className="chica:hidden">Iniciá sesión con la nueva contraseña.</span>
        </p>
      )}

      {destino && !contrasenaRecuperada && (
        <p
          role="status"
          className="rounded-lg border border-border bg-muted px-4 py-3 text-base font-medium chica:px-3 chica:py-2"
        >
          Para ver esa página necesitás iniciar sesión.{" "}
          <span className="chica:hidden">Después te llevamos ahí.</span>
        </p>
      )}

      <FormularioAuth
        titulo="Iniciar sesión"
        descripcion="Ingresá con tu correo y tu contraseña para ver tu historial médico."
        accion={iniciarSesion}
        textoBoton="Iniciar sesión"
        mensajeEspera="Ingresando…"
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
          <div className="flex flex-col items-center gap-3 text-base chica:gap-2">
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
