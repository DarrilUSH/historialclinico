/**
 * Schema Zod de entrada de `crearMedicacion` / `actualizarMedicacion`
 * (`app/(app)/(con-nav)/medicacion/actions.ts`, Sprint 7, tarea 7.2).
 *
 * Primera línea de defensa, **no** la única: la base repite las mismas
 * coherencias con sus propios `CHECK` de
 * `supabase/migrations/20260812200000_schema_inicial.sql` §4.7 —
 * `medications_name_no_vacio`, `medications_dose_amount_positiva`,
 * `medications_stock_no_negativo`, `medications_interval_hours_valido`,
 * `medications_fechas_coherentes` y, la más importante,
 * `medications_esquema_coherente` (qué combinación de `schedule_times` /
 * `interval_hours` es válida según `frequency`) — mismo criterio que
 * `lib/validacion/turno.schema.ts`: que el error se muestre ANTES de gastar
 * el viaje de red, con el mismo criterio en las dos puntas, así un error de
 * `CHECK` de base nunca llega crudo a la pantalla.
 *
 * ## `medications_esquema_coherente`, calcado
 *
 * | `frecuencia` | `horarios` | `intervaloHoras` |
 * |---|---|---|
 * | `daily` | ≥ 1 horario `HH:MM`, sin repetidos | ausente |
 * | `interval_hours` | ausente | 1 a 24 |
 * | `as_needed` | ausente | ausente |
 *
 * `horarios` llega como un array (`FormData.getAll("horarios")`, un valor por
 * chip agregado en `components/medicacion/formulario-medicacion.tsx`) — nunca
 * un campo de texto libre, que es exactamente lo que pide el criterio de
 * aceptación del ROADMAP ("horarios como chips de hora, no un free text").
 */

import { z } from "zod"

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/
const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

const MENSAJE_FECHA_FORMATO = "La fecha debe estar en formato AAAA-MM-DD."
const MENSAJE_FECHA_INEXISTENTE = "Esa fecha no es válida."
const MENSAJE_FECHA_FIN_ANTERIOR =
  "La fecha de fin no puede ser anterior a la fecha de inicio."
const MENSAJE_HORARIOS_VACIOS = 'Agregá al menos un horario para "todos los días".'
const MENSAJE_HORARIO_INVALIDO = "Uno de los horarios no tiene un formato válido."
const MENSAJE_HORARIOS_DUPLICADOS = "Hay un horario repetido."
const MENSAJE_HORARIOS_SOBRAN = 'Los horarios solo se usan con "todos los días".'
const MENSAJE_INTERVALO_FALTA = "Indicá cada cuántas horas se toma (de 1 a 24)."
const MENSAJE_INTERVALO_SOBRA = 'El intervalo en horas solo se usa con "cada N horas".'

/** Acepta coma o punto decimal (mismo criterio que `turno.schema.ts#parsearDecimal`). `null` si no es un número válido. */
function parsearDecimal(valor: string): number | null {
  const normalizado = valor.trim().replace(",", ".")
  if (normalizado.length === 0) return null
  const numero = Number(normalizado)
  return Number.isFinite(numero) ? numero : null
}

/** Valida una fecha `YYYY-MM-DD` en calendario (rechaza "2026-02-30"). Mismo criterio que `confirmacion-documento.schema.ts#validarFechaEstudio`, sin las cotas de futuro/1900 -que no aplican a un tratamiento-. */
function fechaValida(raw: string): boolean {
  const match = raw.match(PATRON_FECHA)
  if (!match) return false
  const [anio, mes, dia] = raw.split("-").map(Number)
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 12, 0, 0))
  return (
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
  )
}

const campoTexto = (max: number, mensajeLargo: string) =>
  z.string({ message: "Ese campo debe ser texto." }).trim().max(max, mensajeLargo)

const campoTextoOpcional = (max: number, mensajeLargo: string) =>
  campoTexto(max, mensajeLargo)
    .optional()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined))

const schemaMedicacion = z
  .object({
    nombre: campoTexto(200, "El nombre es demasiado largo (máx. 200 caracteres).").min(
      1,
      "El nombre comercial es obligatorio.",
    ),

    droga: campoTextoOpcional(150, "La droga es demasiado larga (máx. 150 caracteres)."),

    presentacion: campoTextoOpcional(
      150,
      "La presentación es demasiado larga (máx. 150 caracteres).",
    ),

    dosisCantidad: z
      .string({ message: "La dosis debe ser texto." })
      .trim()
      .min(1, "Indicá la cantidad por toma.")
      .refine((valor) => {
        const numero = parsearDecimal(valor)
        return numero !== null && numero > 0
      }, "La dosis por toma tiene que ser un número mayor a 0."),

    dosisUnidad: campoTexto(
      40,
      "La unidad de la dosis es demasiado larga (máx. 40 caracteres).",
    ).min(1, "Indicá la unidad de la dosis (comprimido, ml, gotas...)."),

    frecuencia: z.enum(["daily", "interval_hours", "as_needed"], {
      message: "Elegí una frecuencia válida.",
    }),

    // `FormData.getAll("horarios")` siempre da un array (vacío si no hay
    // ningún chip cargado): nunca `undefined`, así que el default es solo
    // una red de seguridad para llamadas directas al schema (tests).
    horarios: z.array(z.string()).default([]),

    intervaloHoras: z
      .string({ message: "El intervalo debe ser texto." })
      .trim()
      .optional()
      .transform((valor) => (valor && valor.length > 0 ? valor : undefined)),

    fechaInicio: z
      .string({ message: "La fecha de inicio debe ser texto." })
      .trim()
      .regex(PATRON_FECHA, MENSAJE_FECHA_FORMATO)
      .refine(fechaValida, MENSAJE_FECHA_INEXISTENTE),

    fechaFin: z
      .string({ message: "La fecha de fin debe ser texto." })
      .trim()
      .optional()
      .transform((valor) => (valor && valor.length > 0 ? valor : undefined)),

    stock: z
      .string({ message: "El stock debe ser texto." })
      .trim()
      .optional()
      .transform((valor) => (valor && valor.length > 0 ? valor : undefined)),

    notas: campoTextoOpcional(2000, "Las notas son demasiado largas (máx. 2000 caracteres)."),
  })
  .superRefine((datos, ctx) => {
    // ── medications_esquema_coherente, calcado columna por columna ─────────
    if (datos.frecuencia === "daily") {
      if (datos.intervaloHoras !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_INTERVALO_SOBRA, path: ["intervaloHoras"] })
      }

      const horarios = datos.horarios.map((h) => h.trim()).filter((h) => h.length > 0)
      if (horarios.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_HORARIOS_VACIOS, path: ["horarios"] })
      } else if (!horarios.every((h) => PATRON_HORA.test(h))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_HORARIO_INVALIDO, path: ["horarios"] })
      } else if (new Set(horarios).size !== horarios.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_HORARIOS_DUPLICADOS, path: ["horarios"] })
      }
    } else if (datos.frecuencia === "interval_hours") {
      if (datos.horarios.some((h) => h.trim().length > 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_HORARIOS_SOBRAN, path: ["horarios"] })
      }

      if (datos.intervaloHoras === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_INTERVALO_FALTA, path: ["intervaloHoras"] })
      } else {
        const numero = Number(datos.intervaloHoras)
        if (!Number.isInteger(numero) || numero < 1 || numero > 24) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_INTERVALO_FALTA, path: ["intervaloHoras"] })
        }
      }
    } else {
      // as_needed: ni horarios ni intervalo.
      if (datos.horarios.some((h) => h.trim().length > 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_HORARIOS_SOBRAN, path: ["horarios"] })
      }
      if (datos.intervaloHoras !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_INTERVALO_SOBRA, path: ["intervaloHoras"] })
      }
    }

    // ── medications_fechas_coherentes: end_date is null or end_date >= start_date ──
    if (datos.fechaFin !== undefined) {
      if (!PATRON_FECHA.test(datos.fechaFin) || !fechaValida(datos.fechaFin)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_FECHA_INEXISTENTE, path: ["fechaFin"] })
      } else if (datos.fechaFin < datos.fechaInicio) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_FECHA_FIN_ANTERIOR, path: ["fechaFin"] })
      }
    }

    // ── medications_stock_no_negativo: stock_units is null or stock_units >= 0 ──
    if (datos.stock !== undefined) {
      const numero = parsearDecimal(datos.stock)
      if (numero === null || numero < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "El stock tiene que ser un número mayor o igual a 0.",
          path: ["stock"],
        })
      }
    }
  })

export interface DatosMedicacionValidado {
  nombre: string
  droga?: string
  presentacion?: string
  dosisCantidad: number
  dosisUnidad: string
  frecuencia: "daily" | "interval_hours" | "as_needed"
  /** Solo para `daily`: horarios `HH:MM`, ya deduplicados. `[]` para el resto. */
  horarios: string[]
  /** Solo para `interval_hours`. `undefined` para el resto. */
  intervaloHoras?: number
  fechaInicio: string
  fechaFin?: string
  stock?: number
  notas?: string
}

export function validarMedicacion(
  data: unknown,
): { ok: true; datos: DatosMedicacionValidado } | { ok: false; error: string } {
  const resultado = schemaMedicacion.safeParse(data)

  if (!resultado.success) {
    return { ok: false, error: resultado.error.issues[0]?.message ?? "Los datos no son válidos." }
  }

  const { dosisCantidad, intervaloHoras, stock, horarios, ...resto } = resultado.data

  return {
    ok: true,
    datos: {
      ...resto,
      dosisCantidad: parsearDecimal(dosisCantidad)!,
      horarios: resto.frecuencia === "daily" ? [...new Set(horarios.map((h) => h.trim()))] : [],
      intervaloHoras: intervaloHoras !== undefined ? Number(intervaloHoras) : undefined,
      stock: stock !== undefined ? parsearDecimal(stock)! : undefined,
    },
  }
}
