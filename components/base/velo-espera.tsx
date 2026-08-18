"use client"

/**
 * Velo de espera global (Sprint 14): overlay que cubre toda la pantalla
 * mientras una operación tarda más de lo instantáneo -subir un estudio,
 * esperar a que Gemini lo lea, guardar la confirmación, cambiar el tamaño de
 * letra, iniciar sesión o crear una cuenta-. Antes de este componente esas
 * esperas quedaban mudas para el público mayor de la app: la pantalla no
 * decía nada mientras "pensaba", y varios segundos de silencio se leen como
 * "se rompió", no como "está trabajando".
 *
 * ## Cuándo usarlo (y cuándo NO)
 *
 * Reservado a operaciones que de verdad pueden tardar más de 1-2 segundos:
 * subida y lectura de estudios, cambio de tamaño de letra (viaja al
 * servidor), login y registro. Los formularios rápidos de la app -turnos,
 * signos, medicación, coberturas, médicos, familia- YA tienen su propio
 * spinner en el botón de envío (`components/base/boton.tsx`, prop
 * `cargando`) y eso alcanza: son un solo INSERT/UPDATE que normalmente
 * resuelve en fracciones de segundo, y una tarjeta a pantalla completa por
 * cada guardado rápido sería ruido, no ayuda. El criterio para usar este
 * componente es "¿esta operación puede tardar más de 1-2 segundos en el peor
 * caso real (subida de archivo, llamada a un modelo de IA, round-trip que
 * además revalida una ruta)?" -si sí, va acá; si no, con el spinner del botón
 * sobra-.
 *
 * ## Aparición diferida (evita el parpadeo)
 *
 * El velo NO se monta apenas `visible` pasa a `true`: espera `retrasoMs`
 * (450ms por defecto) por si la operación termina antes -la mayoría de los
 * guardados rápidos-, y en ese caso nunca llega a aparecer. Por debajo de
 * ~400-500ms un indicador que aparece y desaparece de inmediato se percibe
 * como un parpadeo molesto, no como información. Una vez que aparece, se
 * desmonta apenas `visible` vuelve a `false` -sin esperar ninguna animación
 * de salida-: la operación ya terminó, no hay nada más que comunicar.
 *
 * ## Accesibilidad
 *
 * - `role="status"` + `aria-live="polite"` en la tarjeta: un lector de
 *   pantalla anuncia el mensaje sin interrumpir lo que estuviera leyendo, y
 *   vuelve a anunciar cuando `mensaje` cambia (las etapas de la ingesta de
 *   estudios).
 * - **Bloquea toda interacción debajo, pero sin atrapar el foco DETRÁS del
 *   velo.** El overlay a pantalla completa ya intercepta el puntero (está
 *   arriba en el z-index y cubre todo el viewport), pero eso solo resuelve el
 *   mouse/touch: la tecla Tab no sabe nada de superposición visual y seguiría
 *   enfocando botones y links invisibles debajo si no se hace nada más. Por
 *   eso, mientras el velo está montado, se marca `inert` en cada hijo de
 *   `<body>` que no sea el propio velo -el atributo estándar que saca un
 *   subárbol entero de la navegación por teclado y del árbol de
 *   accesibilidad de una sola vez, con soporte nativo en todos los
 *   navegadores del proyecto- y se restaura al desmontar. No es un `<dialog>`
 *   modal con foco atrapado ADENTRO: no hay nada que enfocar en una tarjeta
 *   de solo lectura, así que un focus trap clásico (Tab en círculo dentro del
 *   velo) no tendría sentido acá; alcanza con que el foco no pueda salir
 *   hacia atrás mientras la operación está en curso.
 * - Portal a `document.body`: así el z-index gana siempre, sin depender de en
 *   qué `overflow`/`transform`/`z-index` local esté montado el componente que
 *   lo usa (mismo motivo que `DialogPortal` de `components/ui/dialog.tsx`).
 *
 * ## Tema y densidad
 *
 * Solo tokens de `docs/design-system.md` -`bg-background`, `bg-card`,
 * `text-foreground`, `text-primary`, etc.- así que sigue el tema claro/oscuro
 * sin código propio. El tamaño (spinner, tipografía, espaciado) se define en
 * la escala GRANDE y se ajusta con `chica:` -no hay una prop de tamaño-: el
 * mismo criterio que el resto de `components/base/`.
 */

import * as React from "react"
import { createPortal } from "react-dom"
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface VeloEsperaProps {
  /**
   * La operación está en curso. El velo puede tardar hasta `retrasoMs` en
   * aparecer, y se desmonta apenas esto vuelve a `false`.
   */
  visible: boolean
  /** Mensaje principal, en tipografía generosa. Puede cambiar mientras el velo está visible (etapas de un mismo flujo). */
  mensaje: string
  /** Texto secundario opcional, más chico y en `muted-foreground`. */
  submensaje?: string
  /** Milisegundos de espera antes de montar el velo. Default 450. */
  retrasoMs?: number
  className?: string
}

const RETRASO_POR_DEFECTO = 450

export function VeloEspera({
  visible,
  mensaje,
  submensaje,
  retrasoMs = RETRASO_POR_DEFECTO,
  className,
}: VeloEsperaProps) {
  const [montado, setMontado] = React.useState(false)
  const contenedorRef = React.useRef<HTMLDivElement | null>(null)

  // Ocultamiento inmediato: igual que `tamanoPrevio` en
  // `components/navegacion/boton-tamano.tsx`, ajusta el estado
  // SINCRÓNICAMENTE durante el render cuando `visible` pasa a `false`, en vez
  // de en un efecto -evita el ciclo de render extra que dispararía un efecto
  // (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
  // y es exactamente el patrón que el linter de reglas de hooks del proyecto
  // (`react-hooks/set-state-in-effect`) pide para un `setState` de efecto que
  // no depende de nada asincrónico-. El caso "pasa a `true`" NO se ajusta acá:
  // ese sí depende de algo asincrónico de verdad (el temporizador de abajo).
  const [visiblePrevio, setVisiblePrevio] = React.useState(visible)
  if (visible !== visiblePrevio) {
    setVisiblePrevio(visible)
    if (!visible) setMontado(false)
  }

  // Aparición diferida: un solo timer, cancelado si `visible` vuelve a
  // `false` antes de disparar (la operación terminó rápido) o si cambia
  // `retrasoMs`/se desmonta el componente que usa el velo.
  React.useEffect(() => {
    if (!visible) return

    const id = window.setTimeout(() => setMontado(true), retrasoMs)
    return () => window.clearTimeout(id)
  }, [visible, retrasoMs])

  // Bloqueo de teclado detrás del velo (ver "Accesibilidad" en el
  // encabezado). Corre en un efecto aparte del de arriba porque depende de
  // `montado` -el DOM del portal ya existe-, no de `visible`.
  React.useEffect(() => {
    if (!montado || typeof document === "undefined") return

    const cuerpo = document.body
    const propio = contenedorRef.current
    const marcados: Element[] = []

    for (const hijo of Array.from(cuerpo.children)) {
      if (hijo === propio) continue
      if (hijo.hasAttribute("inert")) continue
      hijo.setAttribute("inert", "")
      marcados.push(hijo)
    }

    const overflowPrevio = cuerpo.style.overflow
    cuerpo.style.overflow = "hidden"

    return () => {
      for (const hijo of marcados) hijo.removeAttribute("inert")
      cuerpo.style.overflow = overflowPrevio
    }
  }, [montado])

  if (!montado || typeof document === "undefined") return null

  return createPortal(
    <div
      ref={contenedorRef}
      data-slot="velo-espera"
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center p-4",
        "bg-background/80 backdrop-blur-sm",
        "duration-[var(--duracion-media)] ease-entrada animate-in fade-in-0",
        className,
      )}
    >
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex w-full max-w-sm flex-col items-center gap-4 rounded-xl px-6 py-8 text-center",
          "bg-card text-card-foreground shadow-elevada ring-1 ring-border",
          "duration-[var(--duracion-media)] ease-entrada animate-in fade-in-0 zoom-in-95",
          "chica:gap-3 chica:px-5 chica:py-6",
        )}
      >
        <Loader2Icon
          className="size-12 shrink-0 animate-spin text-primary chica:size-9"
          aria-hidden="true"
        />
        <p className="text-xl font-semibold text-balance text-foreground chica:text-lg">
          {mensaje}
        </p>
        {submensaje && (
          <p className="text-base text-balance text-muted-foreground chica:text-sm">
            {submensaje}
          </p>
        )}
      </div>
    </div>,
    document.body,
  )
}
