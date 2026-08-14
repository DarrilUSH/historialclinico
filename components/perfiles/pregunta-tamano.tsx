/**
 * "¿Cómo preferís ver la app?" — el segundo conmutador del modo de letra
 * (Sprint 13), en el selector de perfiles.
 *
 * ## Por qué acá, y por qué siempre
 *
 * El selector es la pantalla por la que pasa toda sesión después del login, y
 * es la única en la que la persona ya está identificada pero todavía no está
 * mirando datos de nadie: el momento exacto para preguntarle cómo quiere ver
 * la app. Se muestra SIEMPRE y no solo la primera vez (decisión del usuario
 * sobre el mockup): una preferencia que se pregunta una vez y después hay que
 * ir a buscar a un menú es una preferencia que nadie cambia. El botón A/a del
 * encabezado cubre el cambio sobre la marcha; esto cubre el "recordame que
 * existe".
 *
 * ## Server Component con `<form>` nativos, sin una línea de JavaScript
 *
 * Mismo patrón que `SelectorPerfiles`: cada opción es su propio `<form>` con
 * `cambiarTamano.bind(null, modo)`. Un submit basta, funciona con JavaScript
 * deshabilitado y no arrastra estado de cliente a una pantalla que no tiene
 * ninguno.
 *
 * El efecto se ve en el acto y en esta misma pantalla: la acción revalida el
 * layout raíz, así que la respuesta al submit ES el selector redibujado con el
 * tamaño nuevo. Elegir "Letra chica" acá se siente como una vista previa de lo
 * que va a pasar en toda la app, que es exactamente lo que conviene que se
 * sienta.
 *
 * (El botón A/a del encabezado sí es un Client Component, y el comentario de
 * `components/navegacion/boton-tamano.tsx` explica por qué la respuesta no es
 * la misma en los dos lados.)
 */

import { CheckIcon } from "lucide-react"

import { cambiarTamano } from "@/app/(app)/actions"
import { MODOS, TAMANOS, type Tamano } from "@/lib/densidad/tamano"
import { cn } from "@/lib/utils"

interface PreguntaTamanoProps {
  /** Modo vigente de la cuenta. Marca cuál de las dos opciones viene elegida. */
  tamano: Tamano
}

export function PreguntaTamano({ tamano }: PreguntaTamanoProps) {
  return (
    <section
      aria-labelledby="titulo-pregunta-tamano"
      className="flex w-full max-w-2xl flex-col items-center gap-4 chica:gap-2.5"
    >
      {/* Más discreta en chica -título un escalón más chico, menos aire-,
          pero SIGUE VISIBLE (ROADMAP Sprint 13, "opción A"): quien ya activó
          el modo compacto sigue teniendo que poder verla y cambiarla, no
          hace falta ir a buscarla a un menú. */}
      <div className="flex flex-col items-center gap-1 text-center chica:gap-0.5">
        <h2
          id="titulo-pregunta-tamano"
          className="text-xl font-semibold text-foreground chica:text-lg"
        >
          ¿Cómo preferís ver la app?
        </h2>
        <p className="text-sm text-muted-foreground">
          Es tu preferencia, no la del perfil que elijas. Podés cambiarla cuando
          quieras con el botón <span className="font-semibold">A/a</span> de
          arriba de la pantalla.
        </p>
      </div>

      {/* `role="group"` + `aria-pressed` en cada botón: son dos botones de
          alternancia que se comportan como un control segmentado. Un lector de
          pantalla anuncia "Letra grande, botón de alternancia, presionado" y
          "Letra chica, botón de alternancia, no presionado", que dice todo lo
          que hay que saber sin activarlos para averiguarlo. */}
      <div
        role="group"
        aria-labelledby="titulo-pregunta-tamano"
        className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 chica:gap-2"
      >
        {TAMANOS.map((modo) => {
          const elegido = modo === tamano

          return (
            <form key={modo} action={cambiarTamano.bind(null, modo)}>
              <button
                type="submit"
                aria-pressed={elegido}
                className={cn(
                  "flex w-full min-h-tactil-amplio flex-col items-start gap-1 rounded-xl border bg-card p-4 text-left",
                  "transition-[border-color,box-shadow] duration-[var(--duracion-media)] ease-salida",
                  "hover:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  "chica:min-h-tactil chica:gap-0.5 chica:p-3",
                  elegido
                    ? "border-primary shadow-suave ring-1 ring-primary"
                    : "border-border",
                )}
              >
                <span className="flex w-full items-center gap-2">
                  {/* El glifo es el ícono de la opción: la "A" y la "a" con el
                      tamaño relativo que representan. Decorativo. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "font-semibold leading-none",
                      modo === "grande" ? "text-2xl" : "text-base",
                      elegido ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {MODOS[modo].glifo}
                  </span>
                  <span className="flex-1 text-base font-semibold text-foreground">
                    {MODOS[modo].etiqueta}
                  </span>
                  {/* El color nunca es la única señal (docs/design-system.md §8,
                      regla 2): la opción vigente lleva además tilde y el texto
                      "Elegida" para lectura visual y por lector de pantalla. */}
                  {elegido ? (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                      <CheckIcon className="size-4" aria-hidden="true" />
                      Elegida
                    </span>
                  ) : null}
                </span>
                <span className="text-sm text-muted-foreground">
                  {MODOS[modo].descripcion}
                </span>
              </button>
            </form>
          )
        })}
      </div>
    </section>
  )
}
