/**
 * Formato de lectura de una medición de `vital_signs` (Sprint 9, tarea 9.1).
 * Función pura y testeable: recibe los campos ya tipados (nunca la fila cruda
 * de Supabase) y arma el texto que se muestra en `/signos` -"120/80 mmHg",
 * "95 mg/dL", "70,5 kg"-, con coma decimal (`es-AR`) para el peso.
 */

import type { SignoTipo } from "@/lib/signos/tipos"

export interface ValoresMedicionSigno {
  tipo: SignoTipo
  systolic: number | null
  diastolic: number | null
  pulse: number | null
  value: number | null
}

const FORMATO_DECIMAL = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 })

/** "120/80 mmHg", con el pulso entre paréntesis si se cargó ("120/80 mmHg (72 lat/min)"). */
function formatearTension(medicion: ValoresMedicionSigno): string {
  const base = `${medicion.systolic ?? "—"}/${medicion.diastolic ?? "—"} mmHg`
  return medicion.pulse != null ? `${base} (${medicion.pulse} lat/min)` : base
}

/** "95 mg/dL" o "70,5 kg" según el tipo. */
export function formatearValorSigno(medicion: ValoresMedicionSigno): string {
  if (medicion.tipo === "tension") {
    return formatearTension(medicion)
  }
  const valor = medicion.value != null ? FORMATO_DECIMAL.format(medicion.value) : "—"
  return medicion.tipo === "glucemia" ? `${valor} mg/dL` : `${valor} kg`
}
