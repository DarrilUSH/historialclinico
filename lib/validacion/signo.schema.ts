/**
 * Schema Zod de entrada de `registrarSigno`
 * (`app/(app)/(con-nav)/signos/actions.ts`, Sprint 9, tarea 9.1 —
 * ROADMAP_SPRINTS.md).
 *
 * Primera línea de defensa, **no** la única: la base repite las mismas
 * coherencias con sus propios `CHECK` de
 * `supabase/migrations/20260812200000_schema_inicial.sql` §4.9 —
 * `vital_signs_campos_por_tipo`, `vital_signs_sistolica_plausible`,
 * `vital_signs_diastolica_plausible`, `vital_signs_sistolica_mayor_diastolica`,
 * `vital_signs_pulso_plausible` y `vital_signs_valor_positivo` -, mismo
 * criterio que `lib/validacion/turno.schema.ts` y
 * `lib/validacion/medicacion.schema.ts`: que el error se muestre ANTES de
 * gastar el viaje de red, con el mismo criterio en las dos puntas, así un
 * error de `CHECK` de base nunca llega crudo a la pantalla.
 *
 * ## Los rangos, calcados columna por columna
 *
 * | CHECK de la base | Rango acá |
 * |---|---|
 * | `vital_signs_sistolica_plausible` | sistólica 50–300 |
 * | `vital_signs_diastolica_plausible` | diastólica 30–200 |
 * | `vital_signs_sistolica_mayor_diastolica` | sistólica > diastólica |
 * | `vital_signs_pulso_plausible` | pulso 20–250 (opcional) |
 * | `vital_signs_valor_positivo` | glucemia/peso > 0 |
 *
 * Ningún rango de acá inventa un tope que la base no tenga: el motor de
 * umbrales clínicos (alertas por valor peligroso, no implausible) es la
 * tarea 9.2 del roadmap, una capa aparte.
 *
 * ## Fecha futura: SIEMPRE se rechaza
 *
 * A diferencia de `turno.schema.ts` (que solo exige fecha futura en el
 * alta), acá no hay "edición": una medición SIEMPRE describe algo que ya
 * pasó, así que `measured_at` > "ahora" se rechaza siempre. El combinado
 * fecha+hora usa `combinarFechaHoraUshuaia` (`lib/turnos/fecha.ts`) -el
 * mismo borde reloj-de-pared → instante UTC que ya usa `turnos`-, así que
 * NUNCA se compara una fecha pura (`YYYY-MM-DD`) arrastrando la hora actual
 * del proceso: el formulario siempre manda fecha Y hora, y las dos entran
 * juntas a `combinarFechaHoraUshuaia` antes de cualquier comparación (el bug
 * de "la fecha no puede ser futura" que describe el roadmap es, en el fondo,
 * comparar una fecha sin hora contra un instante completo -acá eso no puede
 * pasar-).
 */

import { z } from "zod"

import { combinarFechaHoraUshuaia } from "@/lib/turnos/fecha"
import { TIPOS_SIGNO, type SignoTipo } from "@/lib/signos/tipos"

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/
const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

const MENSAJE_TIPO_INVALIDO = "Elegí qué signo vital estás cargando."
const MENSAJE_FECHA_FORMATO = "La fecha debe estar en formato AAAA-MM-DD."
const MENSAJE_HORA_FORMATO = "La hora debe estar en formato HH:MM."
const MENSAJE_FECHA_HORA_INEXISTENTE = "Esa fecha y hora no son válidas."
const MENSAJE_FECHA_FUTURA = "La fecha y la hora de la medición no pueden ser futuras."

const RANGO_SISTOLICA = { min: 50, max: 300 }
const RANGO_DIASTOLICA = { min: 30, max: 200 }
const RANGO_PULSO = { min: 20, max: 250 }

/** Solo dígitos -sistólica, diastólica y pulso son `smallint`, nunca decimales-. `null` si está vacío o no es un entero. */
function parsearEntero(valor: string): number | null {
  const normalizado = valor.trim()
  if (normalizado.length === 0 || !/^\d+$/.test(normalizado)) return null
  return Number(normalizado)
}

/** Acepta coma o punto decimal (mismo criterio que `campo-numero.tsx#decimal`): `value` es `numeric`, el peso llega con decimales. `null` si no es un número válido. */
function parsearDecimal(valor: string): number | null {
  const normalizado = valor.trim().replace(",", ".")
  if (normalizado.length === 0) return null
  const numero = Number(normalizado)
  return Number.isFinite(numero) ? numero : null
}

const campoTexto = z.string({ message: "Ese campo debe ser texto." }).trim()

const schemaBase = z.object({
  tipo: z.enum(TIPOS_SIGNO as [SignoTipo, ...SignoTipo[]], { message: MENSAJE_TIPO_INVALIDO }),
  sistolica: campoTexto,
  diastolica: campoTexto,
  /** Único campo realmente opcional del formulario: puede llegar `""`. */
  pulso: campoTexto,
  valor: campoTexto,
  fecha: campoTexto.regex(PATRON_FECHA, MENSAJE_FECHA_FORMATO),
  hora: campoTexto.regex(PATRON_HORA, MENSAJE_HORA_FORMATO),
})

function construirSchema(ahora: Date) {
  return schemaBase.superRefine((datos, ctx) => {
    const combinada = combinarFechaHoraUshuaia(datos.fecha, datos.hora)
    if (!combinada) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_FECHA_HORA_INEXISTENTE, path: ["fecha"] })
    } else if (combinada.getTime() > ahora.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_FECHA_FUTURA, path: ["fecha"] })
    }

    // ── vital_signs_campos_por_tipo + los CHECK de rango, calcados ─────────
    if (datos.tipo === "tension") {
      const sistolica = parsearEntero(datos.sistolica)
      const diastolica = parsearEntero(datos.diastolica)
      const pulsoCrudo = datos.pulso.trim()
      const pulso = pulsoCrudo.length > 0 ? parsearEntero(datos.pulso) : null

      if (sistolica === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ingresá la presión sistólica.", path: ["sistolica"] })
      } else if (sistolica < RANGO_SISTOLICA.min || sistolica > RANGO_SISTOLICA.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Revisá el valor: una sistólica de ${sistolica} no parece correcta.`,
          path: ["sistolica"],
        })
      }

      if (diastolica === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ingresá la presión diastólica.", path: ["diastolica"] })
      } else if (diastolica < RANGO_DIASTOLICA.min || diastolica > RANGO_DIASTOLICA.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Revisá el valor: una diastólica de ${diastolica} no parece correcta.`,
          path: ["diastolica"],
        })
      }

      if (sistolica !== null && diastolica !== null && sistolica <= diastolica) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "La sistólica tiene que ser mayor que la diastólica. Revisá los dos valores.",
          path: ["diastolica"],
        })
      }

      if (pulsoCrudo.length > 0) {
        if (pulso === null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "El pulso no es un número válido.", path: ["pulso"] })
        } else if (pulso < RANGO_PULSO.min || pulso > RANGO_PULSO.max) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Revisá el valor: un pulso de ${pulso} no parece correcto.`,
            path: ["pulso"],
          })
        }
      }
    } else {
      const valor = parsearDecimal(datos.valor)
      const etiqueta = datos.tipo === "glucemia" ? "la glucemia" : "el peso"

      if (valor === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Ingresá ${etiqueta}.`, path: ["valor"] })
      } else if (valor <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `El valor tiene que ser mayor a 0.`,
          path: ["valor"],
        })
      }
    }
  })
}

export interface DatosSignoValidado {
  tipo: SignoTipo
  /** Solo para `tipo === "tension"`. */
  systolic?: number
  /** Solo para `tipo === "tension"`. */
  diastolic?: number
  /** Solo para `tipo === "tension"`, y solo si se cargó (opcional). */
  pulse?: number
  /** Solo para `tipo === "glucemia" | "peso"`. */
  value?: number
  /** `measured_at` listo para insertar: el ISO UTC de `fecha`+`hora` combinadas en Ushuaia. */
  measuredAtIso: string
}

export function validarSigno(
  data: unknown,
  opciones: { ahora?: Date } = {},
): { ok: true; datos: DatosSignoValidado } | { ok: false; error: string } {
  const ahora = opciones.ahora ?? new Date()
  const schema = construirSchema(ahora)
  const resultado = schema.safeParse(data)

  if (!resultado.success) {
    return { ok: false, error: resultado.error.issues[0]?.message ?? "Los datos no son válidos." }
  }

  const { tipo, sistolica, diastolica, pulso, valor, fecha, hora } = resultado.data
  // Ya pasó el `superRefine` de arriba: fecha/hora existen como calendario y
  // no son futuras, así que la conversión de acá no puede fallar.
  const measuredAtIso = combinarFechaHoraUshuaia(fecha, hora)!.toISOString()

  if (tipo === "tension") {
    return {
      ok: true,
      datos: {
        tipo,
        systolic: parsearEntero(sistolica)!,
        diastolic: parsearEntero(diastolica)!,
        pulse: pulso.trim().length > 0 ? parsearEntero(pulso)! : undefined,
        measuredAtIso,
      },
    }
  }

  return {
    ok: true,
    datos: {
      tipo,
      value: parsearDecimal(valor)!,
      measuredAtIso,
    },
  }
}
