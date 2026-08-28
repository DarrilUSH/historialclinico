/**
 * Schema Zod de entrada de `crearTurnosEnLote`
 * (`app/(app)/(con-nav)/turnos/actions.ts`, agosto 2026): la lista de turnos
 * que la persona marcó en la pantalla de confirmación de un mensaje con varias
 * sesiones.
 *
 * ## Por qué hay un schema aparte y no se reusa `validarTurno` a secas
 *
 * `lib/validacion/turno.schema.ts` valida UN turno y ya viene de un `FormData`
 * -strings, siempre-. Acá el payload llega como objeto JSON desde un Client
 * Component (mismo patrón que `guardarSuscripcion` en
 * `app/(app)/(con-nav)/inicio/actions.ts`, que también recibe `unknown` y lo
 * valida antes de tocar nada), así que primero hay que asegurar la FORMA
 * -que sea un objeto con un array de objetos de strings, de largo acotado- y
 * recién después cada elemento pasa por `validarTurno`, que sigue siendo la
 * única autoridad sobre las reglas de negocio de un turno (fecha futura,
 * largos, provincia del dominio cerrado). Sin este paso previo, un cliente
 * modificado podría mandar `{ turnos: 50_000 }` o un array de nulls y hacer
 * explotar el bucle en vez de recibir un error claro.
 *
 * El tope de turnos es el MISMO que el del analizador
 * (`lib/validacion/analisis-turno.schema.ts#MAX_TURNOS`): la pantalla no puede
 * ofrecer para crear más turnos de los que el análisis puede devolver.
 */

import { z } from "zod"

import { MAX_TURNOS } from "@/lib/validacion/analisis-turno.schema"

/** El MISMO tope que el analizador, importado en vez de copiado para que no puedan divergir — ver el encabezado. */
export const MAX_TURNOS_POR_LOTE = MAX_TURNOS

const MENSAJE_LOTE_VACIO = "Marcá al menos un turno antes de confirmar."
const MENSAJE_LOTE_ENORME = `No podemos crear más de ${MAX_TURNOS_POR_LOTE} turnos de una vez.`

/**
 * Un turno del lote tal como lo manda el cliente: exactamente los campos de
 * `CamposPrecargablesTurno` (`lib/turnos/construir-propuestas.ts`), todos
 * string. Los largos de acá son generosos -la validación real la hace
 * `validarTurno` después-: solo evitan que un payload absurdo entre al bucle.
 */
const turnoDelLoteSchema = z
  .object({
    especialidad: z.string().max(500),
    medico: z.string().max(500),
    fecha: z.string().max(40),
    hora: z.string().max(40),
    lugarNombre: z.string().max(500),
    lugarDireccion: z.string().max(1000),
    lugarCiudad: z.string().max(300),
    lugarProvincia: z.string().max(300),
    notasPreparacion: z.string().max(5000),
  })
  .strict()

export const LoteTurnosSchema = z
  .object({
    turnos: z
      .array(turnoDelLoteSchema, { message: MENSAJE_LOTE_VACIO })
      .min(1, MENSAJE_LOTE_VACIO)
      .max(MAX_TURNOS_POR_LOTE, MENSAJE_LOTE_ENORME),
  })
  .strict()

export type TurnoDelLote = z.infer<typeof turnoDelLoteSchema>

/**
 * Valida el payload de `crearTurnosEnLote`. Mismo contrato que el resto de
 * los validadores del proyecto: `{ ok: true, turnos }` o `{ ok: false, error }`
 * con un mensaje en castellano listo para mostrar.
 */
export function validarLoteTurnos(
  data: unknown,
): { ok: true; turnos: TurnoDelLote[] } | { ok: false; error: string } {
  const resultado = LoteTurnosSchema.safeParse(data)

  if (!resultado.success) {
    return { ok: false, error: resultado.error.issues[0]?.message ?? "Los datos no son válidos." }
  }

  return { ok: true, turnos: resultado.data.turnos }
}
