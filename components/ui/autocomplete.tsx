"use client"

/**
 * Wrapper temático de `@base-ui/react/autocomplete` (Sprint 16, tarea 16.2),
 * mismo nivel que `components/ui/select.tsx`: acá vive el estilo (Tailwind),
 * `components/base/campo-autocompletar.tsx` agrega la capa Senior UX
 * (etiqueta, ayuda, error) y `components/medicos/formulario-medico.tsx`
 * arma su propio campo de chips reusando estas piezas directamente -mismo
 * criterio que `components/sos/formulario-sos.tsx#CampoLista`, que usa
 * `components/ui/input.tsx` en crudo en vez de `campo-texto.tsx`, porque el
 * campo de "borrador" de una lista no es un campo de formulario común: no
 * tiene `name` propio, cada ítem confirmado viaja como su propio input
 * oculto-.
 *
 * ## `Autocomplete`, no `Combobox`
 *
 * `@base-ui/react` separa los dos componentes a propósito: `Combobox` es un
 * `<Select>` buscable -el valor final tiene que ser uno de la lista de
 * `items`-, `Autocomplete` es un campo de texto libre con sugerencias -el
 * valor final es lo que haya quedado escrito, la lista es una ayuda que
 * nunca bloquea-. Todo campo de especialidad de esta app acepta texto que no
 * está en `lib/especialidades/catalogo.ts` (una especialidad rara no puede
 * frenar la carga de un turno o de un médico), así que `Autocomplete` es el
 * primitivo correcto, no `Combobox`.
 *
 * ## Por qué el input NO lleva `items` como filtro implícito
 *
 * A diferencia de `Select` (que sí necesita `items` para poder mostrar el
 * label del valor elegido incluso con el popup cerrado -lección de
 * `docs/estado-proyecto.md#Decisiones/lecciones`: "el Select necesita items
 * para mostrar labels"-), acá `items` cumple una función distinta: le da al
 * componente la lista completa para filtrar mientras la persona tipea. El
 * filtro en sí (`filter`) lo pasa cada consumidor explícito
 * (`lib/especialidades/coincidencias.ts#especialidadCoincide`) en vez de
 * confiar en el default interno de la librería -ver el comentario de
 * cabecera de `coincidencias.ts` para el motivo completo-.
 */

import * as React from "react"
import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete"

import { cn } from "@/lib/utils"

const Autocomplete = AutocompletePrimitive.Root

function AutocompleteInputGroup({
  className,
  ...props
}: AutocompletePrimitive.InputGroup.Props) {
  return (
    <AutocompletePrimitive.InputGroup
      data-slot="autocomplete-input-group"
      className={cn("relative flex w-full items-center", className)}
      {...props}
    />
  )
}

function AutocompleteInput({ className, ...props }: AutocompletePrimitive.Input.Props) {
  return (
    <AutocompletePrimitive.Input
      data-slot="autocomplete-input"
      className={cn(
        // Mismas clases que `components/ui/input.tsx`: alto táctil
        // garantizado y 18px SIEMPRE, para que este campo no desentone al
        // lado de cualquier `CampoTexto` del mismo formulario.
        "min-h-tactil w-full min-w-0 rounded-lg border border-input bg-transparent px-3.5 py-2 text-base transition-colors duration-150 ease-salida outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

function AutocompleteClear({ className, ...props }: AutocompletePrimitive.Clear.Props) {
  return (
    <AutocompletePrimitive.Clear
      data-slot="autocomplete-clear"
      aria-label="Borrar el texto"
      className={cn(
        // Calcado del botón de mostrar/ocultar contraseña de
        // `campo-texto.tsx`: mismo tamaño táctil, misma posición absoluta
        // sobre el borde derecho del campo.
        "absolute top-1/2 right-1 flex size-tactil shrink-0 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 ease-salida outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
      {...props}
    />
  )
}

function AutocompletePopup({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  ...props
}: AutocompletePrimitive.Popup.Props &
  Pick<AutocompletePrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <AutocompletePrimitive.Portal>
      <AutocompletePrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <AutocompletePrimitive.Popup
          data-slot="autocomplete-popup"
          className={cn(
            "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
        </AutocompletePrimitive.Popup>
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  )
}

/**
 * Lista de sugerencias DENTRO de `AutocompletePopup`. Separada de `Popup` a
 * propósito -no un único componente que las junte, como pasa en
 * `select.tsx#SelectContent`-: `AutocompleteEmpty` tiene que ser HERMANO de
 * la lista, no estar adentro (mismo lugar que ocupan los botones de scroll
 * en `SelectContent`), así que `Popup` solo pone el contenedor posicionado y
 * cada consumidor arma adentro `<AutocompleteEmpty>` + `<AutocompleteList>`
 * como corresponda. Mezclar los dos como hijos de un solo componente rompía
 * el tipo del render-prop: JSX convierte "un elemento + una función" en un
 * array, y el `children` de `@base-ui/react`'s `List` solo reconoce el modo
 * de colección cuando `children` es una función SOLA (`typeof children ===
 * "function"`), nunca un array que la contenga.
 */
function AutocompleteList({ className, ...props }: AutocompletePrimitive.List.Props) {
  return (
    <AutocompletePrimitive.List
      data-slot="autocomplete-list"
      className={cn("flex flex-col gap-0.5 p-1", className)}
      {...props}
    />
  )
}

function AutocompleteItem({ className, children, ...props }: AutocompletePrimitive.Item.Props) {
  return (
    <AutocompletePrimitive.Item
      data-slot="autocomplete-item"
      className={cn(
        // `min-h-tactil` (no un `h-` fijo): piso de 40px en chica / ~49,5px
        // en grande, mismo token que el resto del proyecto -criterio de
        // aceptación de la tarea: "táctil-cómodo (piso 40px en chica)"-. El
        // resaltado usa `data-highlighted` (no `:hover`/`:focus`): a
        // diferencia de un `<Select>`, acá el foco real del DOM se queda
        // siempre en el input -patrón ARIA combobox de
        // `aria-activedescendant`-, así que ningún ítem recibe foco nativo.
        "flex min-h-tactil w-full cursor-default items-center rounded-md px-3 py-2 text-base outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </AutocompletePrimitive.Item>
  )
}

function AutocompleteEmpty({ className, ...props }: AutocompletePrimitive.Empty.Props) {
  return (
    <AutocompletePrimitive.Empty
      data-slot="autocomplete-empty"
      className={cn("px-3 py-2 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Autocomplete,
  AutocompleteClear,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
}
