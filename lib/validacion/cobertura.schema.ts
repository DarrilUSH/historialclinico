/**
 * Schema Zod de entrada de `crearCobertura` / `actualizarCobertura`
 * (`app/(app)/(con-nav)/coberturas/actions.ts`, Sprint 8, tarea 8.1).
 *
 * Primera línea de defensa, **no** la única: la base repite la única
 * coherencia real de `insurance_cards`
 * (`supabase/migrations/20260812200000_schema_inicial.sql` §4.10) —
 * `insurance_cards_provider_no_vacio` — mismo criterio que
 * `lib/validacion/medicacion.schema.ts`: que el error se muestre ANTES de
 * gastar el viaje de red.
 *
 * Las otras dos reglas del modelo -una sola cobertura principal por perfil
 * (`insurance_cards_una_principal_idx`, índice parcial) y no repetir
 * proveedor+afiliado (`insurance_cards_cobertura_unica`, UNIQUE)- no se
 * pueden validar acá: dependen de las OTRAS filas del perfil, que este
 * schema no ve. Se traducen recién en `actions.ts`, a partir del código
 * `23505` que devuelve Postgres.
 *
 * `esPrincipal` llega ya como `boolean` (la Server Action lo arma con
 * `formData.get("esPrincipal") === "on"`, el valor que manda un
 * `<input type="checkbox">`/`Checkbox` marcado) — nunca como string "true"/"false".
 */

import { z } from "zod"

const MENSAJE_PROVEEDOR_VACIO = "Indicá el nombre de la obra social o prepaga."
const MENSAJE_PROVEEDOR_LARGO =
  "El nombre de la obra social o prepaga es demasiado largo (máx. 200 caracteres)."
const MENSAJE_PLAN_LARGO = "El plan es demasiado largo (máx. 150 caracteres)."
const MENSAJE_AFILIADO_LARGO =
  "El número de afiliado es demasiado largo (máx. 100 caracteres)."

const campoTexto = (max: number, mensajeLargo: string) =>
  z.string({ message: "Ese campo debe ser texto." }).trim().max(max, mensajeLargo)

const campoTextoOpcional = (max: number, mensajeLargo: string) =>
  campoTexto(max, mensajeLargo)
    .optional()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined))

const schemaCobertura = z.object({
  proveedor: campoTexto(200, MENSAJE_PROVEEDOR_LARGO).min(1, MENSAJE_PROVEEDOR_VACIO),
  plan: campoTextoOpcional(150, MENSAJE_PLAN_LARGO),
  numeroAfiliado: campoTextoOpcional(100, MENSAJE_AFILIADO_LARGO),
  esPrincipal: z.boolean({ message: "El valor de \"principal\" no es válido." }),
})

export interface DatosCoberturaValidado {
  proveedor: string
  plan?: string
  numeroAfiliado?: string
  esPrincipal: boolean
}

export function validarCobertura(
  data: unknown,
): { ok: true; datos: DatosCoberturaValidado } | { ok: false; error: string } {
  const resultado = schemaCobertura.safeParse(data)

  if (!resultado.success) {
    return { ok: false, error: resultado.error.issues[0]?.message ?? "Los datos no son válidos." }
  }

  return { ok: true, datos: resultado.data }
}
