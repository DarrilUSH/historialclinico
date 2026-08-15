"use client"

/**
 * Conmutador A/a del encabezado (Sprint 13): alterna entre el modo grande y el
 * compacto **al instante y sin recargar**, desde cualquier pantalla de la app.
 *
 * ## Por qué es un Client Component si el otro conmutador no lo es
 *
 * La pregunta del selector de perfiles
 * (`components/perfiles/pregunta-tamano.tsx`) es un Server Component con dos
 * `<form>` nativos: ahí la persona está eligiendo, la pantalla se rearma
 * entera y un submit está perfecto. Acá el requisito es otro —"alterna al
 * instante", criterio del ROADMAP—: un submit de formulario significaría
 * esperar el ida y vuelta al servidor mirando la pantalla vieja. Por eso este
 * botón cambia el atributo del DOM primero y avisa al servidor después.
 *
 * ## El orden importa: DOM, después la acción
 *
 * `document.documentElement.setAttribute("data-tamano", …)` es lo que hace que
 * el cambio se vea en el mismo frame del toque: los tokens de `globals.css` §5
 * cuelgan de ese atributo, así que toda la app se reescala sin que React tenga
 * que renderizar nada. Es el mismo mecanismo con el que next-themes cambia de
 * tema.
 *
 * La Server Action que viene después persiste la preferencia y revalida el
 * layout raíz; cuando llega esa respuesta, React vuelve a pintar
 * `<html data-tamano>` con el MISMO valor que ya está puesto, así que no hay un
 * segundo salto.
 *
 * No se deshabilita mientras está pendiente: un conmutador que se traba entre
 * toques se siente roto, y volver a tocarlo antes de que responda el servidor
 * es una operación perfectamente válida (gana el último toque, que es el que
 * la acción persiste).
 *
 * ## Hotfix 2026-08-14: el mecanismo estaba bien, faltaba el aviso del toque
 *
 * Reporte real de un usuario en el celular: "toco A/a y parece que no
 * funciona el tap" -el atributo del DOM y los tokens SÍ cambiaban al
 * instante (lo de arriba seguía siendo cierto), pero el propio botón que se
 * tocó se quedaba mudo durante el viaje a la Server Action, así que el dedo
 * no tenía ninguna señal de que el toque había registrado.
 *
 * La causa de ese silencio era `useOptimistic`: su setter se llamaba DENTRO
 * del callback de `useTransition`, y una actualización de estado en
 * prioridad de transición no está garantizada en el mismo tick del evento
 * -React puede diferirla si hay otro trabajo compitiendo por el hilo
 * principal, que es exactamente lo que pasa en un teléfono de gama media
 * bajo carga-. Se reemplazó por un `useState` de toda la vida, actualizado
 * de forma SÍNCRONA en el mismo `onClick` que escribe el atributo del DOM:
 * ahora el glifo se invierte en el mismo tick del tap, sin depender de la
 * prioridad con la que React decida programar un render. `useTransition`
 * se conserva, pero solo para lo que le corresponde -marcar `pendiente`
 * mientras la Server Action está en vuelo, para el aviso sutil de abajo-, y
 * `tamanoVisible` se resincroniza con la prop cuando cambia por una razón
 * ajena a este botón (por ejemplo, se restauró un valor porque la acción no
 * pudo persistir) **ajustando el estado durante el render, no en un
 * `useEffect`** -el patrón que React documenta para "derivar estado de
 * props" (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes):
 * un efecto acá dispararía un render extra después de pintar, que es
 * exactamente la clase de demora que este hotfix vino a sacar.
 *
 * Se sumaron dos señales más, las tres pensadas para el mismo dedo que
 * reportó el bug:
 *
 * 1. **Glifo instantáneo** (arriba): la "A"/"a" resaltada se invierte antes
 *    de que exista siquiera una promesa en vuelo.
 * 2. **Aviso de "aplicando"**: el botón baja de opacidad mientras `pendiente`
 *    es `true` -sutil a propósito, nunca oculta el glifo ni lo reemplaza por
 *    un spinner: en un toggle de DOS estados conocidos, un spinner tapando
 *    el glifo sería peor señal que la opacidad, porque por un instante no se
 *    vería NINGÚN estado-. Sigue sin deshabilitarse: la regla de arriba no
 *    cambió.
 * 3. **Vibración háptica** (`navigator.vibrate(10)`): progressive
 *    enhancement -Chrome Android la tiene, Safari iOS no expone la API y el
 *    botón sigue funcionando igual sin ella-, un toque de 10ms para
 *    confirmar por el otro sentido que el tap registró.
 */

import { useState, useTransition } from "react"

import { cambiarTamano } from "@/app/(app)/actions"
import { ATRIBUTO_TAMANO, MODOS, type Tamano, alternar } from "@/lib/densidad/tamano"
import { cn } from "@/lib/utils"

interface BotonTamanoProps {
  /** Modo vigente, resuelto server-side por `obtenerTamano()` en el layout raíz. */
  tamano: Tamano
}

export function BotonTamano({ tamano }: BotonTamanoProps) {
  const [pendiente, iniciarTransicion] = useTransition()
  const [tamanoVisible, setTamanoVisible] = useState(tamano)

  // Resincroniza si la prop cambia por una razón ajena a este botón -la
  // fuente de verdad sigue siendo el servidor-. Ajustado EN EL RENDER, no en
  // un efecto: `tamanoPrevio` es el truco que documenta React para detectar
  // el cambio de prop sin pagar un ciclo extra de render después de pintar.
  // En el camino feliz es un no-op: `tamanoVisible` ya vale lo mismo que
  // `tamano` para cuando la acción termina y el layout raíz revalida.
  const [tamanoPrevio, setTamanoPrevio] = useState(tamano)
  if (tamano !== tamanoPrevio) {
    setTamanoPrevio(tamano)
    setTamanoVisible(tamano)
  }

  function alternarTamano() {
    const siguiente = alternar(tamanoVisible)

    // Las dos señales inmediatas, sincrónicas, en el mismo tick del tap:
    // el atributo que gobierna los tokens de TODA la app, y el estado local
    // que gobierna el glifo de ESTE botón. Ninguna de las dos espera a la
    // Server Action.
    document.documentElement.setAttribute(ATRIBUTO_TAMANO, siguiente)
    setTamanoVisible(siguiente)

    // Confirmación háptica opcional: nunca un requisito, por eso el chequeo
    // de soporte antes de llamarla.
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(10)
    }

    iniciarTransicion(async () => {
      await cambiarTamano(siguiente)
    })
  }

  const esChica = tamanoVisible === "chica"

  return (
    <button
      type="button"
      onClick={alternarTamano}
      // `aria-pressed` describe el estado de un botón de alternancia (WAI-ARIA
      // "toggle button"): presionado = modo compacto activo. La etiqueta
      // incluye además el estado en palabras, porque "presionado" por sí solo
      // no dice presionado PARA QUÉ, y quien navega con lector de pantalla
      // tiene que poder saber en qué modo está sin activarlo para averiguarlo.
      aria-pressed={esChica}
      aria-label={`Cambiar tamaño de letra. Ahora: ${MODOS[tamanoVisible].etiqueta.toLowerCase()}`}
      title="Cambiar tamaño de letra"
      // `aria-busy` es informativo únicamente -el botón sigue enfocable y
      // clicable mientras está pendiente, ver el porqué en el comentario de
      // arriba-, así que no hace falta anunciarlo con `aria-live`: quien usa
      // lector de pantalla ya recibe el estado nuevo en el próximo
      // `aria-label` cuando vuelve a consultar el botón.
      aria-busy={pendiente}
      className={cn(
        "objetivo-tactil inline-flex shrink-0 items-baseline justify-center gap-0.5 rounded-lg px-2",
        "font-semibold transition-[color,opacity] duration-150 ease-salida",
        "hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        "chica:px-1.5",
        // Aviso sutil de "aplicando": solo opacidad, nunca tapa el glifo.
        pendiente && "opacity-60",
      )}
    >
      {/* Las dos letras son una imagen hecha de tipografía -la "A" grande y la
          "a" chica son EL ícono de esta función-, así que van ocultas al árbol
          de accesibilidad: lo que se anuncia es la `aria-label` de arriba. El
          modo vigente se marca con color Y con peso, nunca solo con color
          (regla 2 de docs/design-system.md §8). */}
      <span
        aria-hidden="true"
        className={cn("text-lg leading-none", esChica ? "text-muted-foreground" : "text-primary")}
      >
        {MODOS.grande.glifo}
      </span>
      <span
        aria-hidden="true"
        className={cn("text-xs leading-none", esChica ? "text-primary" : "text-muted-foreground")}
      >
        {MODOS.chica.glifo}
      </span>
    </button>
  )
}
