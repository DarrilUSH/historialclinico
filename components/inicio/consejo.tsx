"use client"

/**
 * Consejo del tutorial de bienvenida (tarea #14): UN consejo por visita,
 * arriba de la grilla de `/inicio`, el de mayor prioridad entre los seis que
 * `lib/consejos/tipos.ts#CONSEJO_IDS` define. Contrato completo:
 * `docs/tutorial-bienvenida.md`.
 *
 * ## Por qué esto es un Client Component y no directamente el resultado del servidor
 *
 * Dos de los seis consejos (`instalar_app`, `notificaciones`) dependen de
 * señales que solo el navegador tiene (`display-mode: standalone`,
 * `Notification.permission`): `/inicio` (Server Component) le pasa a este
 * componente el mejor consejo entre los CUATRO que sí pudo evaluar
 * (`elegidoServidor`, `lib/consejos/servidor.ts`) más el descarte/
 * postergación de los seis, y este componente completa el cuadro tras
 * montar.
 *
 * ## Sin parpadeo, con una excepción declarada
 *
 * El primer render de este componente -tanto el HTML que llega del servidor
 * como la primera pasada de hidratación en el cliente, ANTES de que corra
 * el `useEffect`- muestra `elegidoServidor` tal cual, tratando
 * `instalar_app`/`notificaciones` como si NO aplicaran. Es EXACTAMENTE lo
 * mismo que ve el servidor, así que hidratar no cambia nada visible.
 *
 * Recién en el `useEffect` (después de montar) se leen las señales reales
 * del navegador. Si ninguna de las dos le gana al consejo del servidor -el
 * caso más común-, `elegido` no cambia y no hay ninguna transición que ver.
 * Si SÍ le gana -el celular no tiene la app instalada, o las notificaciones
 * siguen sin activar-, la tarjeta cambia de contenido después de montar, con
 * un fundido (`animate-in fade-in`, respeta `prefers-reduced-motion` por la
 * regla global de `app/globals.css`). Es la excepción que el encargo de la
 * tarea deja explícita: "el consejo client-side aparece tras montar, con
 * transición suave, nunca salta el layout" — el fundido ocurre siempre
 * DENTRO del mismo lugar que ya ocupaba la tarjeta (o donde no había nada,
 * si `elegidoServidor` era `null`), nunca empuja al resto de la pantalla de
 * un salto.
 *
 * La `key={elegido}` del contenedor es lo que dispara el fundido solo
 * cuando el contenido efectivamente cambia: React desmonta la tarjeta vieja
 * y monta una nueva con la animación de entrada; si `elegido` no cambia,
 * sigue siendo el mismo nodo del DOM y no hay ninguna animación que jugar.
 *
 * ## `instalar_app` tiene TRES estados, no dos
 *
 * Reporte del dueño de la app: la tarjeta "Instalá la app en tu teléfono"
 * tenía "Ahora no" y "No mostrar más" pero NINGÚN botón que instalara nada
 * -"sino es al pedo ese cartel"-. La razón de fondo es que "¿está pendiente
 * instalar?" no alcanza para decidir qué mostrar: hace falta saber además
 * SI hay algo que ofrecer, y cómo. `lib/pwa/boton-instalar.ts
 * #estadoTarjetaInstalar` lo resuelve en tres estados -`"instalar"` (hay
 * `beforeinstallprompt` capturado, va un botón real que lo dispara),
 * `"instrucciones_ios"` (Safari nunca dispara ese evento, va la instrucción
 * manual) y `"oculto"` (ya instalada, desktop, o ningún navegador todavía
 * dio señales)- y este componente usa `pendiente: estado !== "oculto"` para
 * la prioridad: si Chrome todavía no emitió el evento, `instalar_app` cede
 * el lugar al siguiente consejo pendiente en vez de ocupar la única tarjeta
 * de la visita con algo que no tiene ninguna acción que ofrecer todavía.
 *
 * La captura de `beforeinstallprompt`/`appinstalled` vive en
 * `hooks/usar-instalacion-pwa.ts`, compartida con el botón suelto de
 * `components/pwa/boton-instalar.tsx` -antes de este cambio cada uno tenía
 * su propia copia del mismo `useEffect`, la otra mitad del bug: la lógica
 * que sabía instalar nunca llegaba hasta esta tarjeta-.
 */

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"

import { descartarConsejo, posponerConsejo } from "@/app/(app)/(con-nav)/inicio/actions"
import { Boton } from "@/components/base/boton"
import { CLASE_TARJETA_BASE } from "@/components/base/tarjeta"
import { useInstalacionPwa } from "@/hooks/usar-instalacion-pwa"
import { notificacionesPendiente, type PermisoNotificacionPush } from "@/lib/consejos/condiciones-cliente"
import {
  CONTENIDO_CONSEJOS,
  cuerpoInstalarApp,
  hrefCta,
  type CtaConsejo as TipoCta,
} from "@/lib/consejos/contenido"
import { esRutaDeEnlaceDePerfil } from "@/lib/enlaces-perfil"
import { elegirConsejo, type EstadoConsejo } from "@/lib/consejos/logica"
import { CONSEJO_IDS, type ConsejoId } from "@/lib/consejos/tipos"
import { detectarIOS, estadoTarjetaInstalar, type EstadoTarjetaInstalar } from "@/lib/pwa/boton-instalar"
import { activarNotificacionesPush, MENSAJE_NOTIFICACIONES_DENEGADAS } from "@/lib/push/activar"
import { cn } from "@/lib/utils"

/** Mismo breakpoint `md` que usa Tailwind (`767px` = justo debajo de `768px`). */
const CONSULTA_VIEWPORT_MOVIL = "(max-width: 767px)"

function permisoNotificacionActual(): PermisoNotificacionPush {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "sin_soporte"
  }
  return Notification.permission
}

export interface DescarteConsejoProps {
  descartado: boolean
  pospuestoActivo: boolean
}

export interface ConsejoInicioProps {
  /** El mejor consejo "server-conocible", o `null`. Ver `lib/consejos/servidor.ts`. */
  elegidoServidor: ConsejoId | null
  /** Descarte/postergación de los SEIS consejos, ya resueltos contra la sesión vigente. */
  descarte: Record<ConsejoId, DescarteConsejoProps>
  /** Perfil PROPIO de la cuenta, para las CTA que necesitan aterrizar ahí sin importar el perfil activo. */
  perfilPropioId: string | null
}

export function ConsejoInicio({ elegidoServidor, descarte, perfilPropioId }: ConsejoInicioProps) {
  const [elegido, setElegido] = React.useState<ConsejoId | null>(elegidoServidor)
  const [estadoInstalarApp, setEstadoInstalarApp] = React.useState<EstadoTarjetaInstalar>("oculto")
  // Cuenta las veces que hay que reevaluar por un motivo DISTINTO de la
  // captura de instalación: hoy solo la dispara `TarjetaConsejo#onCompletar`
  // (activar notificaciones desde la propia tarjeta). Sumarla a las
  // dependencias del efecto de abajo es lo que permite volver a evaluar sin
  // sacar el cálculo del cuerpo del efecto -ver el comentario de ahí para
  // el porqué-.
  const [version, forzarReevaluacion] = React.useReducer((v: number) => v + 1, 0)
  const instalacion = useInstalacionPwa()

  React.useEffect(() => {
    // La evaluación vive DECLARADA ACÁ ADENTRO -no en un `useCallback` de
    // afuera- a propósito: `react-hooks/set-state-in-effect` marca error una
    // llamada síncrona, en el cuerpo del efecto, a una función que setea
    // estado y que el efecto no declaró él mismo (mismo motivo por el que
    // `components/notificaciones/activar-notificaciones.tsx#comprobar` es una
    // función local al efecto y no un `useCallback`). El resultado es
    // idéntico: se recalcula tras montar y cada vez que cambia algo que
    // vino del servidor, sin violar la regla.
    function evaluar() {
      const permiso = permisoNotificacionActual()
      const estadoInstalar = estadoTarjetaInstalar({
        promptCapturado: instalacion.promptCapturado,
        enModoStandalone: instalacion.enModoStandalone,
        esIOS: detectarIOS({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }),
        esViewportMovil: window.matchMedia(CONSULTA_VIEWPORT_MOVIL).matches,
      })
      setEstadoInstalarApp(estadoInstalar)

      const estados: EstadoConsejo[] = CONSEJO_IDS.map((id) => {
        if (id === "instalar_app") {
          // Un botón muerto es peor que ningún cartel: si el estado da
          // "oculto" -ya instalada, desktop, o Chrome que todavía no emitió
          // `beforeinstallprompt`-, este consejo no compite por la tarjeta y
          // el siguiente pendiente en `CONSEJO_IDS` gana en su lugar. Ver el
          // encabezado del archivo, sección "TRES estados".
          return { id, pendiente: estadoInstalar !== "oculto", ...descarte.instalar_app }
        }
        if (id === "notificaciones") {
          return { id, pendiente: notificacionesPendiente(permiso), ...descarte.notificaciones }
        }
        // Los cuatro "server-conocibles": el servidor ya evaluó su condición
        // real (y su descarte/postergación) y devolvió, a lo sumo, UN
        // ganador entre ellos. Acá alcanza con saber si este id fue ese
        // ganador — ver el encabezado de `lib/consejos/logica.ts` para por
        // qué esto no necesita repetir las cuatro condiciones en el cliente.
        return { id, pendiente: id === elegidoServidor, descartado: false, pospuestoActivo: false }
      })

      setElegido(elegirConsejo(estados))
    }

    evaluar()
    // Sin listener propio de `appinstalled` acá: `instalacion.enModoStandalone`
    // (del hook compartido, que sí lo escucha) es una dependencia de este
    // efecto, así que instalar desde el menú del navegador -sin tocar
    // ningún botón de esta app- también dispara una reevaluación. Lo mismo
    // para `instalacion.promptCapturado`: si Chrome emite
    // `beforeinstallprompt` recién DESPUÉS de montar (no hay garantía de
    // cuándo llega), la tarjeta pasa de "oculto" a "instalar" sin que la
    // persona tenga que recargar la página.
  }, [
    elegidoServidor,
    descarte,
    version,
    instalacion.promptCapturado,
    instalacion.enModoStandalone,
  ])

  if (!elegido) {
    return null
  }

  return (
    <div key={elegido} className="w-full max-w-sm animate-in fade-in duration-300">
      <TarjetaConsejo
        id={elegido}
        perfilPropioId={perfilPropioId}
        onCompletar={() => forzarReevaluacion()}
        estadoInstalarApp={estadoInstalarApp}
        instalandoApp={instalacion.instalando}
        onInstalarApp={instalacion.instalar}
      />
    </div>
  )
}

const ERROR_GENERICO = "No pudimos guardar tu elección. Probá de nuevo en unos minutos."

function TarjetaConsejo({
  id,
  perfilPropioId,
  onCompletar,
  estadoInstalarApp,
  instalandoApp,
  onInstalarApp,
}: {
  id: ConsejoId
  perfilPropioId: string | null
  /**
   * Llamada cuando la función del consejo se completó DESDE la propia
   * tarjeta (solo pasa con "notificaciones": activarlas acá mismo cambia
   * `Notification.permission` sin que haya una navegación de por medio, así
   * que nadie más va a volver a evaluar la condición). Vuelve a correr la
   * misma lógica de prioridad del padre — no oculta la tarjeta a ciegas,
   * por si el siguiente consejo en la lista también aplicara.
   */
  onCompletar: () => void
  /** Solo importa cuando `id === "instalar_app"`: qué puede ofrecer el navegador. Ver el encabezado del archivo. */
  estadoInstalarApp: EstadoTarjetaInstalar
  instalandoApp: boolean
  onInstalarApp: () => Promise<void>
}) {
  const contenido = CONTENIDO_CONSEJOS[id]
  const Icono = contenido.Icono
  const [oculto, setOculto] = React.useState(false)
  // `instalar_app` es el único consejo cuyo cuerpo y CTA dependen del
  // estado del navegador -ver "TRES estados" en el encabezado del archivo-:
  // el resto usa `contenido.cuerpo`/`contenido.cta` tal cual, sin overrides.
  const esInstalarApp = id === "instalar_app"
  const cuerpo = esInstalarApp ? cuerpoInstalarApp(estadoInstalarApp) : contenido.cuerpo
  // Sin botón en "instrucciones_ios": la instrucción manual ya está en el
  // cuerpo (no hay ningún `prompt()` que un botón pudiera disparar en
  // Safari), y en "oculto" esta tarjeta ni debería estar en pantalla
  // (`pendiente` dio `false` en el padre) — el `null` acá es solo defensivo.
  const cta = esInstalarApp ? (estadoInstalarApp === "instalar" ? contenido.cta : null) : contenido.cta
  const [posponiendo, iniciarPostergacion] = React.useTransition()
  const [descartando, iniciarDescarte] = React.useTransition()

  function posponer() {
    iniciarPostergacion(async () => {
      const resultado = await posponerConsejo(id)
      if (!resultado.ok) {
        toast.error(ERROR_GENERICO, { description: resultado.error ?? undefined })
        return
      }
      setOculto(true)
    })
  }

  function descartar() {
    iniciarDescarte(async () => {
      const resultado = await descartarConsejo(id)
      if (!resultado.ok) {
        toast.error(ERROR_GENERICO, { description: resultado.error ?? undefined })
        return
      }
      setOculto(true)
    })
  }

  if (oculto) {
    return null
  }

  return (
    <section
      aria-label="Consejo de bienvenida"
      className={cn(CLASE_TARJETA_BASE, "items-stretch gap-4 px-(--card-spacing) text-left chica:gap-3")}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary chica:size-9"
          aria-hidden="true"
        >
          <Icono className="size-5 chica:size-4.5" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">{contenido.titulo}</h2>
          <p className="text-sm text-muted-foreground">{cuerpo}</p>
        </div>
      </div>

      <CtaDelConsejo
        cta={cta}
        perfilPropioId={perfilPropioId}
        onCompletar={onCompletar}
        instalandoApp={instalandoApp}
        onInstalarApp={onInstalarApp}
      />

      {/* "Ahora no" / "No mostrar más": `size="sm"` es el mismo tamaño que
          usan las acciones secundarias de esta misma pantalla ("Desactivar"
          en `ActivarNotificaciones`, "Ya lo vi" en `BannerAlertasSignos`) —
          cumple el piso táctil de 40px en chica (`chica:min-h-tactil` del
          propio `size="sm"`, ver `components/ui/button.tsx`). */}
      <div className="flex items-center justify-end gap-2">
        <Boton
          variant="ghost"
          size="sm"
          onClick={posponer}
          cargando={posponiendo}
          disabled={descartando}
          className="text-muted-foreground"
        >
          Ahora no
        </Boton>
        <Boton
          variant="ghost"
          size="sm"
          onClick={descartar}
          cargando={descartando}
          disabled={posponiendo}
          className="text-muted-foreground"
        >
          No mostrar más
        </Boton>
      </div>
    </section>
  )
}

function CtaDelConsejo({
  cta,
  perfilPropioId,
  onCompletar,
  instalandoApp,
  onInstalarApp,
}: {
  cta: TipoCta
  perfilPropioId: string | null
  onCompletar: () => void
  instalandoApp: boolean
  onInstalarApp: () => Promise<void>
}) {
  if (cta === null) {
    return null
  }

  if (cta.tipo === "activar_notificaciones") {
    return <BotonActivarNotificaciones texto={cta.texto} onCompletar={onCompletar} />
  }

  if (cta.tipo === "instalar_app") {
    // Mismo patrón que `BotonActivarNotificaciones`, más simple: el estado
    // de carga y la función a disparar ya vienen resueltos por
    // `hooks/usar-instalacion-pwa.ts` (compartido con el botón suelto de
    // `components/pwa/boton-instalar.tsx`), así que acá no hace falta
    // ningún `useState` propio.
    return (
      <Boton size="lg" className="w-full" onClick={onInstalarApp} cargando={instalandoApp}>
        {cta.texto}
      </Boton>
    )
  }

  const href = hrefCta(cta, perfilPropioId)!

  return (
    <Boton
      render={
        <Link
          href={href}
          // Un enlace que cambia el perfil activo NO se prefetchea:
          // prefetchearlo era ejecutarlo, y este CTA es EXACTAMENTE el que
          // disparó el bug -se dibuja en `/inicio` viendo un perfil gestionado
          // y apunta al perfil de la cuenta-. Ver `lib/enlaces-perfil.ts`.
          prefetch={esRutaDeEnlaceDePerfil(href) ? false : undefined}
        />
      }
      nativeButton={false}
      size="lg"
      className="w-full"
    >
      {cta.texto}
    </Boton>
  )
}

function BotonActivarNotificaciones({
  texto,
  onCompletar,
}: {
  texto: string
  onCompletar: () => void
}) {
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
        // Cerró el prompt sin decidir: no se insiste, la tarjeta sigue ahí.
        return
      }
      if (resultado.estado === "error") {
        toast.error("No pudimos activar las notificaciones", {
          description: "Probá de nuevo en unos minutos.",
        })
        return
      }

      toast.success("Listo, te vamos a avisar", {
        description: "Vas a recibir un recordatorio antes de cada turno.",
      })
      onCompletar()
    } finally {
      setActivando(false)
    }
  }

  return (
    <Boton size="lg" className="w-full" onClick={activar} cargando={activando}>
      {texto}
    </Boton>
  )
}
