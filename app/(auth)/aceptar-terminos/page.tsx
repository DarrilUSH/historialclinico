/**
 * Gate de consentimiento del primer ingreso (Sprint 15, tarea 15.2).
 *
 * Quien llega acá es, en la práctica, una sola persona: el titular de un
 * perfil que acaba de ser GRADUADO (`docs/modelo-permisos.md` §8.6, migración
 * `20260817230000_graduacion.sql`). Su cuenta la creó quien administraba su
 * historial hasta ayer, así que nació sin ninguna fila de `consents`: hasta la
 * graduación regía el consentimiento del representante
 * (`acceso_familiar_representante`, tarea 15.1), que dice algo sobre ÉL y no
 * se transfiere. Los documentos los tiene que aceptar el nuevo titular en
 * persona, y esta pantalla es donde lo hace.
 *
 * ## Por qué vive en `app/(auth)/` y no en `app/(app)/`
 *
 * El gate lo aplica `app/(app)/layout.tsx`. Si esta pantalla colgara de ese
 * mismo layout, el gate la mandaría a sí misma: un bucle infinito de
 * redirecciones. Como hermana del árbol autenticado, además, hereda el shell
 * de `app/(auth)/layout.tsx` -tarjeta centrada, sin bottom nav, con el pie de
 * páginas legales-, que es exactamente la forma que corresponde a una
 * pantalla de paso previa a entrar.
 *
 * Es una ruta **privada** (regla "privado por defecto" de `lib/auth/rutas.ts`:
 * no está en `RUTAS_PUBLICAS`), y no está en `RUTAS_SOLO_ANONIMAS` porque solo
 * tiene sentido CON sesión abierta.
 *
 * ## El texto
 *
 * En castellano llano y sin jerga: quien lo lee puede ser un adolescente que
 * estrena su primera cuenta o una persona mayor que hasta ayer no entraba a la
 * aplicación. Se explica qué es lo que está aceptando y qué pasó con su
 * historial —que ya existía, que sigue completo y que ahora es suyo—, sin
 * pedirle que deduzca nada. "Cerrar sesión" queda siempre a mano: aceptar
 * tiene que ser una decisión, y una decisión sin salida no lo es.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { LogOutIcon } from "lucide-react"

import { cerrarSesion } from "@/app/(auth)/actions"
import { FormularioAceptarTerminos } from "@/components/legal/formulario-aceptar-terminos"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requerirSesion } from "@/lib/auth/guardas"
import { RUTA_ACEPTAR_TERMINOS, RUTA_POST_LOGIN } from "@/lib/auth/rutas"
import { cuentaAceptoLegalesDeAlta } from "@/lib/legales"

export const metadata: Metadata = {
  title: "Aceptar los términos — Historial Médico",
}

export default async function PaginaAceptarTerminos() {
  // Sesión obligatoria: sin ella no hay cuenta a la que asociarle el
  // consentimiento. `desde` para volver acá si el login se interpone.
  const { usuario } = await requerirSesion({ desde: RUTA_ACEPTAR_TERMINOS })

  // Quien ya firmó no tiene nada que hacer en esta pantalla —y podría llegar
  // por el botón "atrás" del navegador justo después de aceptar—. Se lo manda
  // al selector de perfiles en vez de ofrecerle firmar dos veces: `consents`
  // no tiene constraint única (firmar una versión nueva es una fila más,
  // legítima), así que la deduplicación es responsabilidad de quien escribe.
  if (await cuentaAceptoLegalesDeAlta()) {
    redirect(RUTA_POST_LOGIN)
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle como="h1" className="text-2xl font-semibold">
          Ya tenés tu propia cuenta
        </CardTitle>
        <CardDescription className="text-base leading-relaxed">
          Entraste por primera vez con tu correo{" "}
          <span className="font-medium text-foreground">{usuario.email}</span>. Antes de
          empezar, necesitamos que aceptes vos mismo las condiciones de uso.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5 chica:gap-3">
        <div className="flex flex-col gap-2 text-base leading-relaxed text-muted-foreground chica:gap-1.5">
          <p>
            Tu historial médico <strong className="text-foreground">ya existe y está completo</strong>:
            lo venía cargando un familiar tuyo. Desde ahora es tuyo y lo administrás vos.
          </p>
          <p>
            Las personas que hasta hoy podían verlo{" "}
            <strong className="text-foreground">siguen teniendo acceso</strong>. Cuando entres,
            podés revisar quiénes son y quitarles el acceso a quien quieras desde la pantalla{" "}
            <strong className="text-foreground">Familia</strong>.
          </p>
          <p>
            Te conviene también cambiar la contraseña que te dieron, desde{" "}
            <Link
              href="/recuperar"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Olvidé mi contraseña
            </Link>
            .
          </p>
        </div>

        <FormularioAceptarTerminos />
      </CardContent>

      {/*
        Fuera del <form> de arriba a propósito: un <form> anidado dentro de
        otro es HTML inválido. Va en su propio bloque, con jerarquía visual
        claramente menor -es la salida, no la acción principal-.
      */}
      <CardContent className="border-t border-border pt-5 chica:pt-3">
        <form action={cerrarSesion}>
          <Button
            type="submit"
            variant="ghost"
            className="h-10 w-full gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <LogOutIcon className="size-4" aria-hidden="true" />
            Cerrar sesión
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
