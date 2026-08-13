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
  /**
   * Permite un signo `-` opcional al inicio. Default `false` a propósito: los
   * valores clínicos que usó este campo hasta el Sprint 5 (peso, dosis,
   * tensión, stock) nunca son negativos, y aceptar un "-" ahí convertiría un
   * error de carga en un dato guardado sin aviso. Sprint 6 lo necesita para
   * coordenadas geográficas (`components/turnos/formulario-turno.tsx`):
   * Ushuaia, como el resto del hemisferio sur y oeste, tiene latitud y
   * longitud siempre negativas.
   */
  permiteNegativo?: boolean
}

export function CampoNumero({ decimal = false, permiteNegativo = false, ...props }: CampoNumeroProps) {
  const signo = permiteNegativo ? "-?" : ""
  return (
    <CampoTexto
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      pattern={decimal ? `${signo}[0-9]*[.,]?[0-9]*` : `${signo}[0-9]*`}
      {...props}
    />
  )
}
