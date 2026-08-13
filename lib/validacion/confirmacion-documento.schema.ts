/**
 * Schema Zod de entrada de las Server Actions `confirmarDocumento` y
 * `descartarDocumento` (`app/(app)/(con-nav)/estudios/actions.ts`).
 *
 * Es la primera línea de defensa, **no** la única: el RPC
 * `confirmar_documento_recien_subido` (`supabase/migrations/20260813010000_confirmacion_documentos.sql`)
 * repite las mismas tres validaciones de valores (título, categoría, fecha)
 * dentro de la base, porque una Server Action puede tener un bug o quedar
 * desactualizada y la base es la última palabra. Los límites de acá están
 * calcados de los del RPC a propósito, para que un error de validación se
 * muestre ANTES de gastar el viaje de red, con el mismo criterio en las dos
 * puntas.
 */

import { z } from 'zod'

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MENSAJE_FECHA_FORMATO = 'La fecha debe estar en formato AAAA-MM-DD.'
const MENSAJE_FECHA_INEXISTENTE = 'Esa fecha no existe.'
const MENSAJE_FECHA_FUTURA = 'La fecha del estudio no puede ser futura.'
const MENSAJE_FECHA_MUY_ANTIGUA = 'La fecha del estudio no puede ser anterior a 1900.'

/**
 * Valida una fecha `YYYY-MM-DD`: formato, existencia semántica (rechaza
 * "2026-02-30"), no futura y posterior a 1900 — el mismo trío que exige el
 * RPC (`nueva_fecha > current_date` y `nueva_fecha <= date '1900-12-31'`).
 * Se compara contra la fecha de HOY en UTC: `document_date` es un `date`
 * puro sin hora, y el input nativo `type="date"` del formulario ya entrega
 * el valor en la zona horaria del dispositivo — comparar dos strings
 * `YYYY-MM-DD` como fechas UTC evita el bug clásico de arrastrar la hora
 * actual (ver la regla del proyecto sobre `createFromFormat`/fechas puras).
 */
function validarFechaEstudio(raw: string, ctx: z.RefinementCtx) {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_FECHA_FORMATO })
    return
  }

  const [, anioStr, mesStr, diaStr] = match
  const anio = Number(anioStr)
  const mes = Number(mesStr)
  const dia = Number(diaStr)

  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 12, 0, 0))
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_FECHA_INEXISTENTE })
    return
  }

  if (anio <= 1900) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_FECHA_MUY_ANTIGUA })
    return
  }

  const hoy = new Date()
  const hoyUtc = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate())
  if (fecha.getTime() > hoyUtc + 24 * 60 * 60 * 1000 - 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_FECHA_FUTURA })
  }
}

export const schemaConfirmacionDocumento = z.object({
  documentoId: z
    .string({ message: 'Falta indicar qué documento confirmar.' })
    .trim()
    .regex(PATRON_UUID, 'Falta indicar qué documento confirmar.'),

  titulo: z
    .string({ message: 'El título debe ser texto.' })
    .trim()
    .min(1, 'El título no puede estar vacío.')
    .max(200, 'El título es demasiado largo (máx. 200 caracteres).'),

  categoria: z.enum(['laboratory', 'imaging', 'prescription', 'consultation', 'other'], {
    message: 'Elegí una categoría válida.',
  }),

  fecha: z
    .string({ message: 'La fecha debe ser texto.' })
    .trim()
    .superRefine(validarFechaEstudio),

  resumen: z
    .string({ message: 'El resumen debe ser texto.' })
    .trim()
    .max(2000, 'El resumen es demasiado largo (máx. 2000 caracteres).')
    .optional()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined)),

  // Institución, especialidad y médico: mismo patrón opcional que `resumen`
  // -viajan como texto libre, vacío se normaliza a `undefined`-. Los topes de
  // longitud están calcados de la guarda 6 del RPC
  // (`supabase/migrations/20260813030000_confirmacion_metadatos_completos.sql`),
  // mismo criterio del resto de este archivo: que un error de validación se
  // muestre ANTES de gastar el viaje de red.
  institucion: z
    .string({ message: 'La institución debe ser texto.' })
    .trim()
    .max(150, 'La institución es demasiado larga (máx. 150 caracteres).')
    .optional()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined)),

  especialidad: z
    .string({ message: 'La especialidad debe ser texto.' })
    .trim()
    .max(100, 'La especialidad es demasiado larga (máx. 100 caracteres).')
    .optional()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined)),

  medico: z
    .string({ message: 'El nombre del médico debe ser texto.' })
    .trim()
    .max(100, 'El nombre del médico es demasiado largo (máx. 100 caracteres).')
    .optional()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined)),
})

export type ConfirmacionDocumento = z.infer<typeof schemaConfirmacionDocumento>

export function validarConfirmacionDocumento(
  data: unknown,
): { ok: true; datos: ConfirmacionDocumento } | { ok: false; error: string } {
  const resultado = schemaConfirmacionDocumento.safeParse(data)
  if (resultado.success) {
    return { ok: true, datos: resultado.data }
  }
  return { ok: false, error: resultado.error.issues[0]?.message ?? 'Los datos no son válidos.' }
}

export const schemaDescarteDocumento = z.object({
  documentoId: z
    .string({ message: 'Falta indicar qué documento descartar.' })
    .trim()
    .regex(PATRON_UUID, 'Falta indicar qué documento descartar.'),
})

export function validarDescarteDocumento(
  data: unknown,
): { ok: true; datos: { documentoId: string } } | { ok: false; error: string } {
  const resultado = schemaDescarteDocumento.safeParse(data)
  if (resultado.success) {
    return { ok: true, datos: resultado.data }
  }
  return { ok: false, error: resultado.error.issues[0]?.message ?? 'Los datos no son válidos.' }
}
