/**
 * Schema Zod para validar las extracciones de Gemini (`DocumentoMedicoExtraido`).
 *
 * Es un espejo estricto del `SCHEMA_DOCUMENTO_MEDICO` definido en
 * `lib/gemini/schemas.ts`, pero EJECUTABLE: valida el JSON crudo de Gemini
 * antes de persistirlo en la base de datos.
 *
 * Requisitos especiales:
 * - **Fechas:** formato `YYYY-MM-DD` con validación semántica (no 2026-02-30).
 * - **Strings:** `.trim()` para remover espacios, límites de longitud razonables.
 * - **Métricas:** máximo 50 elementos, nombre no vacío, valor numérico finito.
 * - **Mensajes:** en español, explícitos y entendibles para mostrar en log/UI.
 *
 * Uso en `app/api/documentos/extraer/route.ts`:
 *   const resultado = validarExtraccion(datosDeGemini)
 *   if (!resultado.ok) {
 *     console.error("Datos inválidos:", resultado.errores)
 *     return json({ error: "..." }, 502)
 *   }
 *   // resultado.datos es seguro de persistir
 */

import { z } from 'zod'
import type { DocumentoMedicoExtraido } from '@/lib/gemini/schemas'

/**
 * Valida que una string sea una fecha válida en formato YYYY-MM-DD.
 *
 * Rechaza:
 * - Formato incorrecto ("15/03/2026", "2026/03/15", vacío)
 * - Fechas inexistentes ("2026-02-30", "2026-13-01")
 * - Fechas con hora/zona horaria
 *
 * Acepta:
 * - Fechas correctamente formateadas en YYYY-MM-DD
 * - Fechas en el pasado, presente y futuro (el modelo puede a veces adivinar;
 *   el Route Handler es quien decide si rechaza fecha futura)
 *
 * Nota sobre parsing: el regex admite días hasta 31 (el refine lo deja pasar
 * para 2026-02-31 porque Date lo "ajusta" silenciosamente a marzo 3). El
 * approach conservador es: si el modelo devuelve "2026-02-30", sabemos que la
 * foto era ilegible. El refine parseá a las 12:00 UTC para evitar el pitfall
 * local del parsing de fecha-solo.
 */
function validarFecha(raw: unknown): { ok: boolean; error?: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'La fecha debe ser texto' }
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, error: 'La fecha no puede estar vacía' }
  }

  // Validar formato YYYY-MM-DD
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return {
      ok: false,
      error: `La fecha debe estar en formato YYYY-MM-DD (recibido: "${trimmed}")`,
    }
  }

  const [, yearStr, monthStr, dayStr] = match
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const day = parseInt(dayStr, 10)

  // Validaciones semánticas
  if (month < 1 || month > 12) {
    return { ok: false, error: `Mes inválido: ${month}` }
  }

  // Crear fecha a las 12:00 UTC para evitar ajustes de zona horaria local
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))

  // Si la fecha se "ajustó" silenciosamente (ej: 30 febrero → 2 marzo), rechazar
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return {
      ok: false,
      error: `Fecha inexistente: ${trimmed} (¿${month} tiene ${day} días?)`,
    }
  }

  return { ok: true }
}

/**
 * Schema Zod espejo de `SCHEMA_DOCUMENTO_MEDICO`.
 *
 * Todos los campos tienen mensajes custom en español. Las coerciones
 * (ej: `string().trim()`) aplican transformaciones sobre el input,
 * nunca rechazan — el esquema es quien decide si rechaza.
 */
export const schemaExtraccionDocumento = z
  .object({
    fecha: z
      .string({ message: 'La fecha debe ser texto' })
      .trim()
      .max(10, 'La fecha es demasiado larga')
      .superRefine((raw, ctx) => {
        const validacion = validarFecha(raw)
        if (!validacion.ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: validacion.error || 'Fecha inválida',
          })
        }
      }),

    especialidad: z
      .string({ message: 'La especialidad debe ser texto' })
      .trim()
      .max(100, 'La especialidad es demasiado larga (máx. 100 caracteres)'),

    institucion: z
      .string({ message: 'La institución debe ser texto' })
      .trim()
      .max(150, 'La institución es demasiado larga (máx. 150 caracteres)'),

    medico: z
      .string({ message: 'El médico debe ser texto' })
      .trim()
      .max(100, 'El nombre del médico es demasiado largo (máx. 100 caracteres)'),

    resumen: z
      .string({ message: 'El resumen debe ser texto' })
      .trim()
      .min(1, 'El resumen no puede estar vacío')
      .max(500, 'El resumen es demasiado largo (máx. 500 caracteres)'),

    categoria: z.enum(['laboratory', 'imaging', 'prescription', 'consultation', 'other'], {
      message:
        'La categoría debe ser una de: laboratory, imaging, prescription, consultation, other',
    }),

    metricas: z
      .array(
        z.object(
          {
            nombre: z
              .string({ message: 'El nombre de la métrica debe ser texto' })
              .trim()
              .min(1, 'El nombre de la métrica no puede estar vacío')
              .max(100, 'El nombre de la métrica es demasiado largo (máx. 100 caracteres)'),

            valor: z
              .number({ message: 'El valor debe ser un número' })
              .refine(
                (n) => Number.isFinite(n),
                'El valor debe ser un número finito (no Infinity ni NaN)',
              ),

            unidad: z
              .string({ message: 'La unidad debe ser texto' })
              .trim()
              .max(50, 'La unidad es demasiado larga (máx. 50 caracteres)'),

            rango: z
              .string({ message: 'El rango debe ser texto' })
              .trim()
              .max(100, 'El rango es demasiado largo (máx. 100 caracteres)'),
          },
          {
            message: 'Cada métrica debe tener nombre, valor, unidad y rango',
          },
        ),
      )
      .max(50, 'Hay demasiadas métricas (máx. 50)'),

    texto_completo: z
      .string({ message: 'El texto completo debe ser texto' })
      .trim()
      .max(500, 'El extracto de texto es demasiado largo (máx. 500 caracteres)')
      .optional(),
  })
  .strict()

/**
 * Valida un objeto desconocido contra el schema de extracción de Gemini.
 *
 * @param data - JSON desconocido (típicamente la respuesta cruda de Gemini).
 * @returns `{ ok: true, datos }` si es válido; `{ ok: false, errores }` si no.
 *
 * Los errores son siempre un array de strings en español, explícitos y listos
 * para loguear o mostrar.
 *
 * @example
 *   const resultado = validarExtraccion(respuestaDeGemini)
 *   if (!resultado.ok) {
 *     console.error("Validación fallida:", resultado.errores)
 *     return json({ error: "Datos inválidos de Gemini" }, 502)
 *   }
 *   await supabase.from("documents").update({ ai_summary: resultado.datos.resumen })
 */
export function validarExtraccion(
  data: unknown,
): { ok: true; datos: DocumentoMedicoExtraido } | { ok: false; errores: string[] } {
  const resultado = schemaExtraccionDocumento.safeParse(data)

  if (resultado.success) {
    return {
      ok: true,
      datos: resultado.data as DocumentoMedicoExtraido,
    }
  }

  const errores = resultado.error.issues.map((err) => {
    const path = err.path.length > 0 ? `${err.path.join('.')}` : '(raíz)'
    return `[${path}] ${err.message}`
  })

  return {
    ok: false,
    errores,
  }
}
