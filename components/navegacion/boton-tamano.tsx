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
 * segundo salto. `useOptimistic` mantiene el estado visual del botón alineado
 * con el DOM durante ese intervalo, y se resincroniza solo con la prop cuando
 * la acción termina.
 *
 * No se deshabilita mientras está pendiente: un conmutador que se traba entre
 * toques se siente roto, y volver a tocarlo antes de que responda el servidor
 * es una operación perfectamente válida (gana el último toque, que es el que
 * la acción persiste).
 */

import { useOptimistic, useTransition } from "react"

import { cambiarTamano } from "@/app/(app)/actions"
import { ATRIBUTO_TAMANO, MODOS, type Tamano, alternar } from "@/lib/densidad/tamano"
import { cn } from "@/lib/utils"

interface BotonTamanoProps {
  /** Modo vigente, resuelto server-side por `obtenerTamano()` en el layout raíz. */
  tamano: Tamano
}

export function BotonTamano({ tamano }: BotonTamanoProps) {
  const [, iniciarTransicion] = useTransition()
  const [tamanoVisible, mostrarOptimista] = useOptimistic(tamano)

  function alternarTamano() {
    const siguiente = alternar(tamanoVisible)

    // Efecto inmediato, antes de cualquier viaje al servidor.
    document.documentElement.setAttribute(ATRIBUTO_TAMANO, siguiente)

    iniciarTransicion(async () => {
      mostrarOptimista(siguiente)
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
      className={cn(
        "objetivo-tactil inline-flex shrink-0 items-baseline justify-center gap-0.5 rounded-lg px-2",
        "font-semibold transition-colors duration-150 ease-salida",
        "hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        "chica:px-1.5",
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
