/**
 * Schema Zod de entrada de `crearTurno` / `actualizarTurno`
 * (`app/(app)/(con-nav)/turnos/actions.ts`, Sprint 6, tarea 6.1).
 *
 * Primera línea de defensa, **no** la única: la base repite las mismas
 * coherencias con sus propios `CHECK` (`appointments_specialty_no_vacia`,
 * `appointments_latitud_valida`, `appointments_longitud_valida`,
 * `appointments_coordenadas_completas` en
 * `supabase/migrations/20260812200000_schema_inicial.sql`) y `status` es un
 * enum de Postgres que rechaza cualquier valor inventado desde la app -es el
 * criterio de aceptación explícito de la tarea-. Los límites de acá están
 * calcados de esos `CHECK` a propósito, mismo criterio que
 * `lib/validacion/confirmacion-documento.schema.ts`: que el error se muestre
 * ANTES de gastar el viaje de red, con el mismo criterio en las dos puntas.
 *
 * ## Fecha futura solo para el ALTA
 *
 * `exigirFechaFutura` es un parámetro de `validarTurno`, no una constante del
 * schema: crear un turno exige que sea a futuro (criterio de aceptación del
 * roadmap: "Turno con fecha pasada en el alta → error de validación claro"),
 * pero EDITAR uno ya existente no -el turno completado del seed, por
 * ejemplo, quedó con fecha pasada a propósito, y corregirle una nota de
 * preparación no tiene por qué exigir moverlo al futuro-.
 *
 * ## Coordenadas: validadas como texto, convertidas afuera de Zod
 *
 * `latitud`/`longitud` se validan (presencia coherente, formato numérico,
 * rango) dentro de un único `superRefine` sobre las dos strings crudas, y
 * recién se convierten a `number` en `validarTurno`, ya fuera del pipeline de
 * Zod. Encadenar `.transform()` DESPUÉS de `.superRefine()` en un
 * `z.object()` es válido en Zod, pero deja la lectura del refine mirando dos
 * formas distintas del dato según el orden de declaración; mantener el
 * refine sobre las strings crudas y convertir después es más fácil de leer
 * y de auditar.
 *
 * ## Ciudad y provincia (Sprint 16, tarea 16.1)
 *
 * `lugarCiudad` es texto libre opcional, igual que `lugarNombre`/
 * `lugarDireccion`. `lugarProvincia` es un dominio CERRADO: `""` (el
 * `<Select>` sin elegir nada) se transforma en `undefined` ANTES del enum,
 * mismo patrón exacto que `grupoSanguineo` en `lib/validacion/sos.schema.ts`,
 * así que "vacío" nunca compite con las 24 jurisdicciones válidas de
 * `PROVINCIAS_ARGENTINAS`. El `CHECK` `appointments_location_province_valida`
 * (`supabase/migrations/20260817231000_ciudad_provincia_direcciones.sql`) es
 * la misma lista copiada en el borde de la base.
 */

import { z } from "zod"

import { combinarFechaHoraUshuaia } from "@/lib/turnos/fecha"
import { PROVINCIAS_ARGENTINAS } from "@/lib/ubicacion/provincias"

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/
const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

const MENSAJE_FECHA_FORMATO = "La fecha debe estar en formato AAAA-MM-DD."
const MENSAJE_HORA_FORMATO = "La hora debe estar en formato HH:MM."
const MENSAJE_FECHA_HORA_INEXISTENTE = "Esa fecha y hora no son válidas."
const MENSAJE_FECHA_FUTURA = "La fecha y la hora del turno tienen que ser futuras."
const MENSAJE_COORDENADAS_INCOMPLETAS =
  "Cargá las dos coordenadas (latitud y longitud) o dejá las dos en blanco."
const MENSAJE_PROVINCIA_INVALIDA = "Elegí una provincia de la lista."

/** Acepta coma o punto decimal (mismo criterio que `campo-numero.tsx#decimal`). Devuelve `null` si no es un número válido. */
function parsearDecimal(valor: string): number | null {
  const normalizado = valor.trim().replace(",", ".")
  if (normalizado.length === 0) return null
  const numero = Number(normalizado)
  return Number.isFinite(numero) ? numero : null
}

const campoTexto = (max: number, mensajeLargo: string) =>
  z.string({ message: "Ese campo debe ser texto." }).trim().max(max, mensajeLargo)

const campoTextoOpcional = (max: number, mensajeLargo: string) =>
  campoTexto(max, mensajeLargo)
    .optional()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined))

/** Coordenada como texto crudo: solo normaliza `""` a `undefined`; el parseo numérico ocurre en el `superRefine` del objeto. */
const campoCoordenada = z
  .string({ message: "Ese campo debe ser texto." })
  .trim()
  .max(30, "Ese valor no parece una coordenada.")
  .optional()
  .transform((valor) => (valor && valor.length > 0 ? valor : undefined))

function construirSchemaTurno(exigirFechaFutura: boolean, ahora: Date) {
  return z
    .object({
      especialidad: campoTexto(100, "La especialidad es demasiado larga (máx. 100 caracteres).").min(
        1,
        "La especialidad es obligatoria.",
      ),

      medico: campoTextoOpcional(150, "El nombre del médico es demasiado largo (máx. 150 caracteres)."),

      fecha: z
        .string({ message: "La fecha debe ser texto." })
        .trim()
        .regex(PATRON_FECHA, MENSAJE_FECHA_FORMATO),

      hora: z
        .string({ message: "La hora debe ser texto." })
        .trim()
        .regex(PATRON_HORA, MENSAJE_HORA_FORMATO),

      lugarNombre: campoTextoOpcional(150, "El nombre del lugar es demasiado largo (máx. 150 caracteres)."),

      lugarDireccion: campoTextoOpcional(
        300,
        "La dirección es demasiado larga (máx. 300 caracteres).",
      ),

      lugarCiudad: campoTextoOpcional(100, "La ciudad es demasiado larga (máx. 100 caracteres)."),

      // Calco EXACTO del patrón de `grupoSanguineo` en
      // `lib/validacion/sos.schema.ts`: `""` (el `<Select>` en "Elegí una
      // provincia") se transforma en `undefined` ANTES del enum, para que
      // "vacío" nunca compita con las 24 jurisdicciones válidas.
      lugarProvincia: z
        .string({ message: "La provincia debe ser texto." })
        .trim()
        .optional()
        .transform((valor) => (valor && valor.length > 0 ? valor : undefined))
        .pipe(z.enum(PROVINCIAS_ARGENTINAS, { message: MENSAJE_PROVINCIA_INVALIDA }).optional()),

      latitud: campoCoordenada,
      longitud: campoCoordenada,

      notasPreparacion: campoTextoOpcional(
        2000,
        "Las notas de preparación son demasiado largas (máx. 2000 caracteres).",
      ),
    })
    .superRefine((datos, ctx) => {
      const huboLatitud = datos.latitud !== undefined
      const huboLongitud = datos.longitud !== undefined

      if (huboLatitud !== huboLongitud) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: MENSAJE_COORDENADAS_INCOMPLETAS,
          path: huboLatitud ? ["longitud"] : ["latitud"],
        })
      } else if (huboLatitud && huboLongitud) {
        const latitud = parsearDecimal(datos.latitud!)
        const longitud = parsearDecimal(datos.longitud!)

        if (latitud === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "La latitud no es un número válido.",
            path: ["latitud"],
          })
        } else if (latitud < -90 || latitud > 90) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "La latitud tiene que estar entre -90 y 90.",
            path: ["latitud"],
          })
        }

        if (longitud === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "La longitud no es un número válido.",
            path: ["longitud"],
          })
        } else if (longitud < -180 || longitud > 180) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "La longitud tiene que estar entre -180 y 180.",
            path: ["longitud"],
          })
        }
      }

      const combinada = combinarFechaHoraUshuaia(datos.fecha, datos.hora)
      if (!combinada) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: MENSAJE_FECHA_HORA_INEXISTENTE,
          path: ["fecha"],
        })
        return
      }

      if (exigirFechaFutura && combinada.getTime() <= ahora.getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: MENSAJE_FECHA_FUTURA,
          path: ["fecha"],
        })
      }
    })
}

export interface DatosTurnoValidado {
  especialidad: string
  medico?: string
  fecha: string
  hora: string
  /** `appointment_date` listo para insertar/actualizar: el ISO UTC de `fecha`+`hora` combinadas en Ushuaia. */
  fechaHoraIso: string
  lugarNombre?: string
  lugarDireccion?: string
  lugarCiudad?: string
  lugarProvincia?: string
  latitud?: number
  longitud?: number
  notasPreparacion?: string
}

export interface OpcionesValidacionTurno {
  /** `true` para el alta (`crearTurno`), `false` para la edición (`actualizarTurno`). */
  exigirFechaFutura: boolean
  /** "Ahora" contra el que se compara la fecha futura. Default `new Date()`; los tests lo fijan. */
  ahora?: Date
}

export function validarTurno(
  data: unknown,
  opciones: OpcionesValidacionTurno,
): { ok: true; datos: DatosTurnoValidado } | { ok: false; error: string } {
  const ahora = opciones.ahora ?? new Date()
  const schema = construirSchemaTurno(opciones.exigirFechaFutura, ahora)
  const resultado = schema.safeParse(data)

  if (!resultado.success) {
    return { ok: false, error: resultado.error.issues[0]?.message ?? "Los datos no son válidos." }
  }

  const { fecha, hora, latitud, longitud, ...resto } = resultado.data
  // Ya pasó el `superRefine` de arriba: fecha/hora existen como calendario y
  // las coordenadas (si vinieron) son numéricas y están en rango, así que las
  // conversiones de acá no pueden fallar.
  const combinada = combinarFechaHoraUshuaia(fecha, hora)!

  return {
    ok: true,
    datos: {
      ...resto,
      fecha,
      hora,
      fechaHoraIso: combinada.toISOString(),
      latitud: latitud !== undefined ? parsearDecimal(latitud)! : undefined,
      longitud: longitud !== undefined ? parsearDecimal(longitud)! : undefined,
    },
  }
}
