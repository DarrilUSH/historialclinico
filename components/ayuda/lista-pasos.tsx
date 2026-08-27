"use client"

/**
 * Los seis pasos del tutorial de bienvenida, siempre consultable, con su
 * estado real ✓/pendiente (tarea #14, `docs/tutorial-bienvenida.md`).
 *
 * A diferencia de `components/inicio/consejo.tsx` -que elige UN consejo
 * filtrado por descarte/postergación- esta lista muestra los SEIS SIEMPRE,
 * ignora el descarte por completo (un paso que la persona ya tocó "No
 * mostrar más" en `/inicio` sigue apareciendo acá con su estado real: "¿Cómo
 * empiezo?" es la referencia completa, no otra copia del consejo
 * contextual) y no tiene ningún límite de "uno por vez".
 *
 * Mismo reparto servidor/cliente que la tarjeta de `/inicio`: las cuatro
 * condiciones "server-conocibles" llegan resueltas desde
 * `lib/consejos/servidor.ts#resolverEstadoPasos`, y las dos restantes
 * (`instalar_app`, `notificaciones`) se completan acá tras montar. El
 * estado inicial de esas dos es `false` (pendiente) tanto en el HTML del
 * servidor como en la primera pasada de hidratación -nunca se lee `window`
 * antes de montar, mismo patrón que
 * `components/pwa/boton-instalar.tsx#estadoInicialInstalada`-, así que no
 * hay mismatch de hidratación; la corrección llega en el primer
 * `useEffect`, sin que esta pantalla necesite el cuidado "sin parpadeo" de
 * la tarjeta de `/inicio` -acá no compite por prioridad con nada, cada fila
 * es independiente-.
 */

import * as React from "react"
import Link from "next/link"
import { CheckIcon, CircleIcon } from "lucide-react"
import { toast } from "sonner"

import { Boton } from "@/components/base/boton"
import { CLASE_TARJETA_BASE } from "@/components/base/tarjeta"
import {
  instalarAppPendiente,
  notificacionesPendiente,
  type PermisoNotificacionPush,
} from "@/lib/consejos/condiciones-cliente"
import { CONTENIDO_CONSEJOS, hrefCta } from "@/lib/consejos/contenido"
import { esRutaDeEnlaceDePerfil } from "@/lib/enlaces-perfil"
import type { CondicionesServidor } from "@/lib/consejos/servidor"
import { CONSEJO_IDS, type ConsejoId } from "@/lib/consejos/tipos"
import { activarNotificacionesPush, MENSAJE_NOTIFICACIONES_DENEGADAS } from "@/lib/push/activar"
import { cn } from "@/lib/utils"

const CONSULTA_VIEWPORT_MOVIL = "(max-width: 767px)"

function enModoStandalone(): boolean {
  const standaloneIOS = (window.navigator as Navigator & { standalone?: boolean }).standalone
  return window.matchMedia("(display-mode: standalone)").matches || standaloneIOS === true
}

function permisoNotificacionActual(): PermisoNotificacionPush {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "sin_soporte"
  }
  return Notification.permission
}

function estadoInicial(condiciones: CondicionesServidor): Record<ConsejoId, boolean> {
  return {
    ficha_sos: !condiciones.fichaSosVacia,
    gmail: !condiciones.sinGmail,
    compartir_familia: !condiciones.sinPermisosOtorgados,
    perfil_gestionado: !condiciones.unSoloPerfilVisible,
    // Sin `window` durante el render del servidor ni en la primera pasada
    // de hidratación: arrancan "pendiente" (`false`) en los dos lados por
    // igual, y el `useEffect` de abajo corrige apenas monta.
    instalar_app: false,
    notificaciones: false,
  }
}

export function ListaPasosAyuda({
  condicionesServidor,
  perfilPropioId,
}: {
  condicionesServidor: CondicionesServidor
  perfilPropioId: string | null
}) {
  const [completados, setCompletados] = React.useState<Record<ConsejoId, boolean>>(() =>
    estadoInicial(condicionesServidor),
  )

  React.useEffect(() => {
    // Declarada ACÁ ADENTRO, no en un `useCallback` de afuera: es el mismo
    // motivo que documenta `components/inicio/consejo.tsx` -la regla
    // `react-hooks/set-state-in-effect` exige que la función que setea
    // estado la declare el propio efecto, mismo patrón que
    // `ActivarNotificaciones#comprobar`-.
    function evaluarCliente() {
      setCompletados((anterior) => ({
        ...anterior,
        instalar_app: !instalarAppPendiente({
          enModoStandalone: enModoStandalone(),
          esViewportMovil: window.matchMedia(CONSULTA_VIEWPORT_MOVIL).matches,
        }),
        notificaciones: !notificacionesPendiente(permisoNotificacionActual()),
      }))
    }

    evaluarCliente()
    window.addEventListener("appinstalled", evaluarCliente)
    return () => window.removeEventListener("appinstalled", evaluarCliente)
  }, [])

  return (
    <ol className="flex flex-col gap-3 chica:gap-2">
      {CONSEJO_IDS.map((id, indice) => (
        <PasoFila
          key={id}
          numero={indice + 1}
          id={id}
          completado={completados[id]}
          perfilPropioId={perfilPropioId}
          onCompletar={() => setCompletados((anterior) => ({ ...anterior, [id]: true }))}
        />
      ))}
    </ol>
  )
}

function PasoFila({
  numero,
  id,
  completado,
  perfilPropioId,
  onCompletar,
}: {
  numero: number
  id: ConsejoId
  completado: boolean
  perfilPropioId: string | null
  onCompletar: () => void
}) {
  const contenido = CONTENIDO_CONSEJOS[id]
  const Icono = contenido.Icono
  const cta = contenido.cta
  const href = hrefCta(cta, perfilPropioId)

  return (
    <li className={cn(CLASE_TARJETA_BASE, "flex-row items-start gap-3 px-(--card-spacing)")}>
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          completado ? "bg-exito-suave text-exito-fuerte" : "bg-primary/10 text-primary",
        )}
        aria-hidden="true"
      >
        {completado ? <CheckIcon className="size-5" /> : <Icono className="size-4.5" />}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-muted-foreground">Paso {numero}</span>
          <h2 className="text-base font-semibold text-foreground">{contenido.titulo}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{contenido.cuerpo}</p>

        {/* El color nunca es la única señal (docs/design-system.md §8, regla
            2): el estado se dice con palabras -"Hecho"/"Pendiente"- además
            del ícono y del color de fondo de arriba. */}
        {completado ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-exito-fuerte">
            <CheckIcon className="size-4" aria-hidden="true" />
            Hecho
          </span>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <CircleIcon className="size-4" aria-hidden="true" />
              Pendiente
            </span>
            {cta !== null &&
              (cta.tipo === "activar_notificaciones" ? (
                <BotonActivarDesdeAyuda texto={cta.texto} onCompletar={onCompletar} />
              ) : (
                <Link
                  href={href!}
                  // Un enlace que cambia el perfil activo NO se prefetchea:
                  // prefetchearlo era ejecutarlo. Ver `lib/enlaces-perfil.ts`
                  // -la guarda de verdad está en el servidor; esto es defensa
                  // en profundidad, y además precargar un endpoint que solo
                  // redirige no sirve para nada-.
                  prefetch={esRutaDeEnlaceDePerfil(href) ? false : undefined}
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {cta.texto}
                </Link>
              ))}
          </div>
        )}
      </div>
    </li>
  )
}

function BotonActivarDesdeAyuda({ texto, onCompletar }: { texto: string; onCompletar: () => void }) {
  const [activando, setActivando] = React.useState(false)

  async function activar() {
    setActivando(true)
    try {
      const resultado = await activarNotificacionesPush()

      if (resultado.estado === "denegado") {
        toast.error("Las notificaciones están bloqueadas", {
          description: MENSAJE_NOTIFICACIONES_DENEGADAS,
        })
        return
      }
      if (resultado.estado === "sin_respuesta") {
        return
      }
      if (resultado.estado === "error") {
        toast.error("No pudimos activar las notificaciones", {
          description: "Probá de nuevo en unos minutos.",
        })
        return
      }

      toast.success("Listo, te vamos a avisar")
      onCompletar()
    } finally {
      setActivando(false)
    }
  }

  return (
    <Boton variant="outline" size="sm" onClick={activar} cargando={activando}>
      {texto}
    </Boton>
  )
}
