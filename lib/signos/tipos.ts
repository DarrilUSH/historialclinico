/**
 * Los tres tipos de signo vital de la carga rápida (Sprint 9, tarea 9.1 —
 * ROADMAP_SPRINTS.md), y la traducción entre el nombre en español que usa la
 * interfaz (`?tipo=tension|glucemia|peso`, el mismo que viaja en el
 * `FormData`) y `vital_sign_type` (`TipoSignoVital`,
 * `supabase/migrations/20260812200000_schema_inicial.sql` §4.9), el enum de
 * Postgres que exige la columna `vital_signs.type`.
 *
 * Se usa español en la URL y en el `FormData` a propósito -mismo criterio que
 * `frecuencia`/`horarios` en `lib/validacion/medicacion.schema.ts`-: es lo
 * que escribe el formulario y lo que arma cada uno de los tres botones
 * grandes de `/signos`, y así ningún componente de interfaz necesita conocer
 * los nombres en inglés del enum de la base.
 */

import type { TipoSignoVital } from "@/types/dominio"

export type SignoTipo = "tension" | "glucemia" | "peso"

export const TIPOS_SIGNO: readonly SignoTipo[] = ["tension", "glucemia", "peso"]

/** `SignoTipo` → `vital_sign_type` de la base. */
export const TIPO_A_DB: Record<SignoTipo, TipoSignoVital> = {
  tension: "blood_pressure",
  glucemia: "glucose",
  peso: "weight",
}

/** `vital_sign_type` de la base → `SignoTipo`. */
export const DB_A_TIPO: Record<TipoSignoVital, SignoTipo> = {
  blood_pressure: "tension",
  glucose: "glucemia",
  weight: "peso",
}

/** Nombre completo del tipo, para encabezados de sección ("Tensión arterial", agrupando la lista de `/signos`). */
export const ETIQUETA_TIPO: Record<SignoTipo, string> = {
  tension: "Tensión arterial",
  glucemia: "Glucemia",
  peso: "Peso",
}

/** Texto de los tres botones grandes de `/signos` y el título de `/signos/nuevo` -criterio de aceptación del roadmap: "Cargar tensión" / "Cargar glucemia" / "Cargar peso", sin dropdown. */
export const ETIQUETA_CARGAR: Record<SignoTipo, string> = {
  tension: "Cargar tensión",
  glucemia: "Cargar glucemia",
  peso: "Cargar peso",
}

/** Unidad mostrada como sufijo de cada campo numérico (`components/base/campo-numero.tsx#sufijo`) y en el listado. */
export const UNIDAD_TIPO: Record<SignoTipo, string> = {
  tension: "mmHg",
  glucemia: "mg/dL",
  peso: "kg",
}

/** `valor is SignoTipo`, para validar `searchParams.tipo` y el campo `tipo` del `FormData` sin repetir el `includes` en cada punto de entrada. */
export function esSignoTipo(valor: string | undefined | null): valor is SignoTipo {
  return valor != null && (TIPOS_SIGNO as readonly string[]).includes(valor)
}
