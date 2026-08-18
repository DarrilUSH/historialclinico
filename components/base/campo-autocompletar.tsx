"use client"

/**
 * Campo de texto con sugerencias (Sprint 16, tarea 16.2). Mismo contrato
 * Senior UX que `campo-texto.tsx` -etiqueta SIEMPRE visible arriba, ayuda
 * opcional debajo, error asociado por `aria-describedby` +
 * `aria-invalid`- pero construido sobre `components/ui/autocomplete.tsx`
 * (`@base-ui/react/autocomplete`) en vez de `components/ui/input.tsx`: a
 * medida que la persona tipea, sugiere coincidencias de `opciones`
 * (insensible a tildes/mayúsculas, `lib/especialidades/coincidencias.ts`),
 * pero el valor final siempre es lo que haya quedado escrito -si nada
 * matchea, el texto tipeado vale tal cual, nunca se fuerza a elegir de la
 * lista-.
 *
 * Es un campo de UN solo valor (`value`/`onChange` de texto), pensado para
 * "Especialidad" en `components/turnos/formulario-turno.tsx` -un turno es
 * para UNA especialidad concreta-. El campo de VARIAS especialidades de
 * `components/medicos/formulario-medico.tsx` (chips) NO usa este
 * componente: arma su propio campo de "borrador" sobre las mismas piezas de
 * `components/ui/autocomplete.tsx`, porque ahí el Enter/clic en una
 * sugerencia tiene que AGREGAR un chip en vez de completar un único input
 * -ver el comentario de cabecera de `formulario-medico.tsx`-.
 *
 * ## Por qué no hace falta manejar Enter a mano acá
 *
 * A diferencia del campo de chips, este es un input de formulario común: si
 * la persona tipea texto libre y aprieta Enter sin haber resaltado ninguna
 * sugerencia, `@base-ui/react` deja pasar el Enter para que el `<form>` lo
 * trate como cualquier otro input de texto -mismo comportamiento que ya
 * tenía el `CampoTexto` de "Especialidad" antes de esta tarea, cero
 * regresión-. Si hay una sugerencia resaltada (flecha ↓/↑ primero), Enter la
 * selecciona y la vuelca al campo sin enviar el formulario -mejora, no
 * regresión-.
 */

import * as React from "react"

import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@/components/ui/autocomplete"
import { Label } from "@/components/ui/label"
import { especialidadCoincide } from "@/lib/especialidades/coincidencias"
import { cn } from "@/lib/utils"

export interface CampoAutocompletarProps {
  /** `id` del input, `htmlFor` del label y, si no se pasa `name`, también el `name`. */
  id: string
  /** Etiqueta SIEMPRE visible arriba del campo. */
  label: string
  /** Catálogo de sugerencias. Texto libre siempre permitido, esto solo alimenta el desplegable. */
  opciones: readonly string[]
  value: string
  onChange: (valor: string) => void
  name?: string
  /** Texto de ayuda opcional debajo del campo. Se oculta mientras hay error. */
  ayuda?: string
  /** Mensaje de error propio de este campo. */
  error?: string
  required?: boolean
  maxLength?: number
  placeholder?: string
  /** Texto que se muestra en el desplegable cuando nada de `opciones` matchea lo tecleado. */
  textoSinCoincidencias?: string
}

const TEXTO_SIN_COINCIDENCIAS_DEFECTO = "Sin coincidencias en el catálogo — se guarda lo que escribiste."

export function CampoAutocompletar({
  id,
  label,
  opciones,
  value,
  onChange,
  name,
  ayuda,
  error,
  required,
  maxLength,
  placeholder,
  textoSinCoincidencias = TEXTO_SIN_COINCIDENCIAS_DEFECTO,
}: CampoAutocompletarProps) {
  const idAyuda = ayuda && !error ? `${id}-ayuda` : undefined
  const idError = error ? `${id}-error` : undefined
  const describedBy = [idAyuda, idError].filter(Boolean).join(" ") || undefined

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>

      <Autocomplete
        items={opciones}
        value={value}
        onValueChange={(valor) => onChange(valor)}
        filter={especialidadCoincide}
        openOnInputClick
      >
        <AutocompleteInputGroup>
          <AutocompleteInput
            id={id}
            name={name ?? id}
            required={required}
            maxLength={maxLength}
            placeholder={placeholder}
            autoComplete="off"
            className={cn(value.length > 0 && "pr-11")}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
          {value.length > 0 && <AutocompleteClear />}
        </AutocompleteInputGroup>

        <AutocompletePopup>
          <AutocompleteEmpty>{textoSinCoincidencias}</AutocompleteEmpty>
          <AutocompleteList>
            {(opcion: string) => (
              <AutocompleteItem key={opcion} value={opcion}>
                {opcion}
              </AutocompleteItem>
            )}
          </AutocompleteList>
        </AutocompletePopup>
      </Autocomplete>

      {ayuda && !error && (
        <p id={idAyuda} className="text-sm text-muted-foreground">
          {ayuda}
        </p>
      )}

      {error && (
        <p id={idError} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
