/**
 * `/perfil/gmail`: conectar y desconectar la casilla de Gmail de la CUENTA
 * (Sprint 17, tarea 17.1).
 *
 * ## Por qué acá y no en una pantalla de perfil
 *
 * El proyecto todavía no tiene una pantalla de configuración de cuenta —el
 * comentario del pie legal en `app/(app)/(con-nav)/layout.tsx` lo dice con
 * todas las letras—, así que se sigue el patrón que ya existe: `/perfil/sos`
 * es una pantalla propia a la que se llega por una card de `/inicio`, y esta
 * es su hermana. Inventar una pantalla de "Configuración" con dos ítems sería
 * más superficie de la que pide la tarea, y esconder la conexión de Gmail
 * dentro de un menú la volvería imposible de encontrar para el público de
 * esta app.
 *
 * ## Es de la CUENTA, no del perfil activo
 *
 * La card de `/inicio` no está gateada por permiso y la pantalla no pide
 * ninguno: lo que se conecta es la casilla de quien inició sesión, la misma
 * esté mirando el historial de quien esté. Mismo caso que las notificaciones
 * push (nota ⑰ de la migración de RLS) y que el modo de letra: cambiar de
 * perfil no cambia de quién es el correo. La pantalla lo dice explícitamente,
 * porque en una app donde uno pasa el día "viendo a Roberto" la ambigüedad es
 * real.
 *
 * ## Las fechas se formatean en el servidor
 *
 * `Intl.DateTimeFormat` anclado a `America/Argentina/Ushuaia`, igual que el
 * resto del proyecto, y el resultado viaja como texto ya armado. Formatearlas
 * en el cliente funcionaría —la zona está fijada, así que no habría desajuste
 * de hidratación— pero obligaría a mandar los ISO crudos a un Client Component
 * para volver a resolver ahí lo mismo.
 */

import type { Metadata } from "next"
import Link from "next/link"

import { ArrowLeftIcon, MailIcon } from "lucide-react"

import { PanelConexionGmail } from "@/components/gmail/panel-conexion-gmail"
import { requerirSesion } from "@/lib/auth/guardas"
import { esResultadoConexion, obtenerConexionGmail } from "@/lib/gmail/conexion"

export const metadata: Metadata = {
  title: "Conectar Gmail — Historial Médico",
}

/** Toda la app opera en la hora de Ushuaia (mismo criterio que `lib/sos/frescura.ts`). */
const ZONA_HORARIA = "America/Argentina/Ushuaia"

/** "18 de agosto de 2026". Fecha para leer, no un sello técnico: acá no hace falta la hora. */
const FORMATO_FECHA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA,
  day: "numeric",
  month: "long",
  year: "numeric",
})

/** "18/08/2026 14:30". Sello de frescura de la última revisión. */
const FORMATO_SELLO = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** Espacios que ICU intercala y que hay que normalizar (mismo criterio que `lib/sos/frescura.ts`). */
const ESPACIOS_INVISIBLES = /[  ]/g

function formatear(iso: string | null, formato: Intl.DateTimeFormat): string | null {
  if (!iso) return null
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return null
  return formato.format(fecha).replace(ESPACIOS_INVISIBLES, " ")
}

export default async function PaginaGmail({
  searchParams,
}: {
  searchParams: Promise<{ resultado?: string }>
}) {
  const { usuario, supabase } = await requerirSesion({ desde: "/perfil/gmail" })

  const [conexion, parametros] = await Promise.all([
    obtenerConexionGmail(supabase, usuario.id),
    searchParams,
  ])

  const resultado = esResultadoConexion(parametros.resultado) ? parametros.resultado : null

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-3 chica:py-3">
      <Link
        href="/inicio"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver al inicio
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-balance">
          <MailIcon className="size-6 shrink-0 text-primary" aria-hidden="true" />
          Tu Gmail
        </h1>
        <p className="text-base text-muted-foreground">
          Traer solos los turnos y los estudios que las clínicas te mandan por correo.
        </p>
        <p className="text-sm text-muted-foreground">
          Esta conexión es de tu cuenta: vale para todos los perfiles que administrás, no solo para
          el que estás viendo ahora.
        </p>
      </div>

      <PanelConexionGmail
        resultado={resultado}
        conexion={
          conexion === null
            ? null
            : {
                email: conexion.email,
                estado: conexion.estado,
                labelName: conexion.labelName,
                tieneEtiqueta: conexion.labelId !== null,
                conectadaElTexto:
                  formatear(conexion.conectadaEl, FORMATO_FECHA) ?? "hace un rato",
                ultimoOkTexto: formatear(conexion.ultimoOk, FORMATO_SELLO),
                vencidaElTexto: formatear(conexion.vencidaEl, FORMATO_FECHA),
              }
        }
      />
    </div>
  )
}
