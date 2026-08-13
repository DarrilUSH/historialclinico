"use client"

/**
 * Campo numérico Senior UX: mismo layout y accesibilidad que `campo-texto.tsx`
 * (lo envuelve directamente), agregando lo que un valor numérico necesita:
 * `inputMode` correcto para que Android abra el teclado numérico, `pattern`
 * para la validación nativa del formulario, y soporte de `sufijo` para la
 * unidad clínica (mg/dl, kg, latidos/min) que van a usar los formularios de
 * signos vitales y medicación de sprints futuros.
 *
 * Se usa `type="text"` en vez de `type="number"` a propósito: `number` tiene
 * flechas de spinner inconsistentes entre navegadores, deja escribir "e"/"-"
 * en algunos, y con coma decimal (locale es-AR) el parseo nativo falla. Con
 * `inputMode` + `pattern` se consigue el mismo teclado numérico en Android
 * sin esos problemas.
 */

import { CampoTexto, type CampoTextoProps } from "@/components/base/campo-texto"

export interface CampoNumeroProps
  extends Omit<CampoTextoProps, "type" | "inputMode" | "pattern"> {
  /**
   * Habilita coma o punto decimal (peso, dosis fraccionada). Default
   * `false`: solo enteros (tensión, frecuencia cardíaca), teclado numérico
   * simple sin tecla de coma/punto.
   */
  decimal?: boolean
}

export function CampoNumero({ decimal = false, ...props }: CampoNumeroProps) {
  return (
    <CampoTexto
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      pattern={decimal ? "[0-9]*[.,]?[0-9]*" : "[0-9]*"}
      {...props}
    />
  )
}
