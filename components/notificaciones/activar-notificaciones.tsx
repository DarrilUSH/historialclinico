"use client"

/**
 * Banner de activación de recordatorios (Sprint 6, tarea 6.3).
 *
 * Es la ÚNICA puerta por la que este producto pide el permiso de
 * notificaciones, y lo pide detrás de un botón que dice para qué sirve.
 *
 * ## Por qué el permiso se pide acá y no al cargar la app
 *
 * En Chrome, un `denied` es definitivo: el sitio no vuelve a preguntar nunca
 * y recuperarlo exige entrar a la configuración del navegador. Un prompt
 * disparado en el pageload -que se descarta por reflejo antes de leerlo-
 * quema para siempre la posibilidad de avisarle a esta persona que tiene
 * turno mañana. El banner explica primero, pregunta después, y solo cuando
 * hubo un click de verdad (`lib/push/suscripcion.ts` documenta el detalle
 * técnico del gesto).
 *
 * ## Los cinco estados, y por qué ninguno se puede resolver en el servidor
 *
 * | Estado | Qué se ve |
 * |---|---|
 * | `comprobando` | nada (evita el parpadeo del banner en cada carga) |
 * | `sin_soporte` | nada — no hay nada que ofrecer |
 * | `inactivo` | el banner con "Activar recordatorios" |
 * | `activo` | "Notificaciones activadas" + baja discreta |
 * | `denegado` | cómo revertirlo desde el navegador |
 *
 * El estado real vive en el NAVEGADOR (`Notification.permission` +
 * `pushManager.getSubscription()`), no en la base: la fila de
 * `push_subscriptions` puede existir mientras la persona ya borró la
 * suscripción desde Chrome, y ahí el banner tiene que volver a ofrecerse. Por
 * eso el componente arranca en `comprobando` y se resuelve en un efecto, en
 * vez de recibir el estado desde el Server Component que lo renderiza.
 *
 * Los avisos de resultado van por `sonner` -el mismo `<Toaster>` del layout
 * con nav- para no mover la página bajo el dedo de quien acaba de tocar el
 * botón.
 */

import { useCallback, useEffect, useState } from "react"
import { BellIcon, BellOffIcon, BellRingIcon, SendIcon } from "lucide-react"
import { toast } from "sonner"

import { guardarSuscripcion, revocarSuscripcion } from "@/app/(app)/(con-nav)/inicio/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { Tarjeta } from "@/components/base/tarjeta"
import { haySoportePush } from "@/lib/push/registrar-sw"
import {
  cancelarSuscripcion,
  estadoPermiso,
  obtenerSuscripcionActual,
  pedirPermisoYSuscribir,
} from "@/lib/push/suscripcion"

type EstadoBanner = "comprobando" | "sin_soporte" | "inactivo" | "activo" | "denegado"

const MENSAJE_DENEGADO =
  "Bloqueaste las notificaciones para este sitio. Para reactivarlas, tocá el candado (o el ícono de ajustes) a la izquierda de la dirección web y permití las notificaciones."

export function ActivarNotificaciones() {
  const [estado, setEstado] = useState<EstadoBanner>("comprobando")
  const [trabajando, setTrabajando] = useState(false)

  useEffect(() => {
    let vigente = true

    async function comprobar() {
      if (!haySoportePush()) {
        if (vigente) setEstado("sin_soporte")
        return
      }

      if (estadoPermiso() === "denied") {
        if (vigente) setEstado("denegado")
        return
      }

      const suscripcion = await obtenerSuscripcionActual()
      if (vigente) {
        setEstado(suscripcion ? "activo" : "inactivo")
      }
    }

    void comprobar()
    return () => {
      vigente = false
    }
  }, [])

  const activar = useCallback(async () => {
    setTrabajando(true)
    try {
      const resultado = await pedirPermisoYSuscribir(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
      )

      if (resultado.estado === "denegado") {
        setEstado("denegado")
        return
      }
      if (resultado.estado === "sin_respuesta") {
        // Cerró el prompt sin decidir. No se insiste ni se muestra un error:
        // el banner sigue ahí para cuando quiera.
        return
      }
      if (resultado.estado === "error") {
        console.error("[push] No se pudo suscribir:", resultado.mensaje)
        toast.error("No pudimos activar las notificaciones", {
          description: "Probá de nuevo en unos minutos.",
        })
        return
      }

      const guardado = await guardarSuscripcion(resultado.datos)
      if (!guardado.ok) {
        // La suscripción quedó viva en el navegador pero no en nuestra base:
        // se deshace para que el estado de las dos puntas coincida. Dejarla
        // colgada haría que el banner mostrara "activadas" y no llegara nunca
        // ninguna notificación.
        await cancelarSuscripcion()
        toast.error("No pudimos activar las notificaciones", {
          description: guardado.error ?? undefined,
        })
        return
      }

      setEstado("activo")
      toast.success("Listo, te vamos a avisar", {
        description: "Vas a recibir un recordatorio antes de cada turno.",
      })
    } finally {
      setTrabajando(false)
    }
  }, [])

  const desactivar = useCallback(async () => {
    setTrabajando(true)
    try {
      const endpoint = await cancelarSuscripcion()
      if (endpoint) {
        const resultado = await revocarSuscripcion({ endpoint })
        if (!resultado.ok) {
          toast.error("No pudimos desactivar las notificaciones", {
            description: resultado.error ?? undefined,
          })
          return
        }
      }
      setEstado("inactivo")
      toast.success("Notificaciones desactivadas", {
        description: "Ya no vas a recibir recordatorios en este dispositivo.",
      })
    } finally {
      setTrabajando(false)
    }
  }, [])

  if (estado === "comprobando" || estado === "sin_soporte") {
    return null
  }

  if (estado === "denegado") {
    return (
      <Alerta variante="advertencia" titulo="Las notificaciones están bloqueadas" estatica>
        {MENSAJE_DENEGADO}
      </Alerta>
    )
  }

  if (estado === "activo") {
    return (
      <Tarjeta className="w-full max-w-md px-(--card-spacing) text-left">
        <div className="flex items-start gap-3">
          <BellRingIcon className="mt-0.5 size-6 shrink-0 text-exito" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">Notificaciones activadas</p>
            <p className="text-sm text-muted-foreground">
              Te vamos a avisar antes de cada turno en este dispositivo.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Boton
            variant="ghost"
            size="sm"
            onClick={desactivar}
            cargando={trabajando}
            className="text-muted-foreground"
          >
            <BellOffIcon aria-hidden="true" />
            Desactivar
          </Boton>
          <BotonPrueba />
        </div>
      </Tarjeta>
    )
  }

  return (
    <Tarjeta variante="destacada" className="w-full max-w-md px-(--card-spacing) text-left">
      <div className="flex items-start gap-3">
        <BellIcon className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-semibold">No te pierdas ningún turno</p>
          <p className="text-sm text-muted-foreground">
            Activá los recordatorios y te avisamos días antes, y otra vez unas horas
            antes, sin que tengas que abrir la aplicación.
          </p>
        </div>
      </div>
      <Boton onClick={activar} cargando={trabajando} className="w-full sm:w-auto">
        Activar recordatorios
      </Boton>
    </Tarjeta>
  )
}

/**
 * Botón de prueba — **solo desarrollo**.
 *
 * `process.env.NODE_ENV` lo resuelve el compilador en tiempo de build, así
 * que en producción este componente se elimina del bundle entero junto con el
 * `fetch` a `/api/push/probar` (que además responde 404 fuera de desarrollo,
 * igual que `/estado`). Existe porque el circuito completo -VAPID, cifrado,
 * Push Service, service worker, bandeja del sistema- solo se puede verificar
 * mandando un push de verdad a un teléfono de verdad, y hacerlo con `curl`
 * exigiría copiar a mano la cookie de sesión del celular.
 */
function BotonPrueba() {
  const [enviando, setEnviando] = useState(false)

  if (process.env.NODE_ENV !== "development") {
    return null
  }

  async function enviar() {
    setEnviando(true)
    try {
      const respuesta = await fetch("/api/push/probar", { method: "POST" })
      const cuerpo = (await respuesta.json()) as {
        enviados?: number
        revocadas?: number
        error?: string
      }

      if (!respuesta.ok) {
        toast.error("No se pudo enviar la prueba", { description: cuerpo.error })
        return
      }

      toast.success(`Push de prueba enviado a ${cuerpo.enviados ?? 0} dispositivo(s)`, {
        description: cuerpo.revocadas
          ? `${cuerpo.revocadas} suscripción(es) muerta(s) marcada(s) como revocada(s).`
          : "Debería aparecer en la bandeja en unos segundos.",
      })
    } catch (error) {
      toast.error("No se pudo enviar la prueba", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Boton variant="outline" size="sm" onClick={enviar} cargando={enviando}>
      <SendIcon aria-hidden="true" />
      Enviar prueba (dev)
    </Boton>
  )
}
