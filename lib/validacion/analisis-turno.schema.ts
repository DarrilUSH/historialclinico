/**
 * Schema Zod espejo de `SCHEMA_ANALISIS_MENSAJE_TURNO`
 * (`lib/gemini/schemas.ts`), Sprint 16, tarea 16.4. Mismo contrato que
 * `validarExtraccion` (`lib/validacion/documento.schema.ts`): `{ ok: true,
 * datos }` o `{ ok: false, errores }`, con mensajes en español que describen
 * la ESTRUCTURA que falló, nunca el contenido recibido — seguro de loguear
 * sin violar la regla de minimización (`docs/minimizacion-datos.md` §10).
 *
 * Los límites de longitud de acá son generosos a propósito: son una red de
 * seguridad contra una respuesta de Gemini corrupta o desproporcionada
 * (`responseSchema` ya limita bastante del lado de Google), no una validación
 * de negocio — esa la vuelve a hacer `lib/validacion/turno.schema.ts` cuando
 * la persona finalmente guarda el turno con los límites reales de
 * `appointments`.
 */

import { z } from "zod"

import {
  RELACIONES_MENSAJE_TURNO,
  TIPOS_PROFESIONAL_MENSAJE_TURNO,
  type AnalisisMensajeTurnoExtraido,
} from "@/lib/gemini/schemas"

const MAX_TEXTO_CORTO = 300
const MAX_DIRECCION = 400
const MAX_NOTA = 600
const MAX_NOTAS_POR_TURNO = 30
/**
 * Tope de turnos por análisis. Era 10 hasta agosto de 2026, elegido cuando el
 * único caso multi-turno conocido eran DOS mensajes pegados. El mensaje real
 * de las diez sesiones de kinesiología (`hb-central-kinesiologia-10-sesiones.txt`)
 * lo rozaba EXACTO: una serie de 12 o 20 sesiones -perfectamente normal en una
 * indicación de rehabilitación- habría hecho fallar la validación entera y
 * devuelto "No pudimos analizar el mensaje", perdiendo las 20. 40 cubre las
 * series largas reales sin dejar de ser una red contra una respuesta corrupta.
 */
export const MAX_TURNOS = 40
/** Serie más larga que se puede numerar sin que el valor deje de ser plausible: protege contra un `totalSesiones` disparatado, no valida negocio. */
const MAX_NUMERO_SESION = 400
const MAX_EXPLICACION = 500

const turnoExtraidoCrudoSchema = z
  .object({
    fechaTexto: z.string({ message: "fechaTexto debe ser texto." }).max(MAX_TEXTO_CORTO),
    diaSemanaTexto: z.string({ message: "diaSemanaTexto debe ser texto." }).max(60),
    horaTexto: z.string({ message: "horaTexto debe ser texto." }).max(60),
    tipoProfesional: z.enum(TIPOS_PROFESIONAL_MENSAJE_TURNO, {
      message: `tipoProfesional debe ser uno de: ${TIPOS_PROFESIONAL_MENSAJE_TURNO.join(", ")}.`,
    }),
    profesionalTexto: z.string({ message: "profesionalTexto debe ser texto." }).max(MAX_TEXTO_CORTO),
    especialidadTexto: z.string({ message: "especialidadTexto debe ser texto." }).max(MAX_TEXTO_CORTO),
    especialidadInferida: z.boolean({ message: "especialidadInferida debe ser un booleano." }),
    lugarNombre: z.string({ message: "lugarNombre debe ser texto." }).max(MAX_TEXTO_CORTO),
    lugarDireccion: z.string({ message: "lugarDireccion debe ser texto." }).max(MAX_DIRECCION),
    lugarCiudad: z.string({ message: "lugarCiudad debe ser texto." }).max(150),
    lugarProvincia: z.string({ message: "lugarProvincia debe ser texto." }).max(150),
    notas: z
      .array(z.string({ message: "Cada nota debe ser texto." }).max(MAX_NOTA))
      .max(MAX_NOTAS_POR_TURNO, `No puede haber más de ${MAX_NOTAS_POR_TURNO} notas por turno.`),
    numeroSesion: z
      .number({ message: "numeroSesion debe ser un número." })
      .int("numeroSesion debe ser un número entero.")
      .min(0, "numeroSesion no puede ser negativo.")
      .max(MAX_NUMERO_SESION, `numeroSesion no puede ser mayor que ${MAX_NUMERO_SESION}.`),
    totalSesiones: z
      .number({ message: "totalSesiones debe ser un número." })
      .int("totalSesiones debe ser un número entero.")
      .min(0, "totalSesiones no puede ser negativo.")
      .max(MAX_NUMERO_SESION, `totalSesiones no puede ser mayor que ${MAX_NUMERO_SESION}.`),
  })
  .strict()

export const AnalisisMensajeTurnoSchema = z
  .object({
    turnos: z
      .array(turnoExtraidoCrudoSchema)
      .max(MAX_TURNOS, `No puede haber más de ${MAX_TURNOS} turnos en un solo mensaje.`),
    relacion: z.enum(RELACIONES_MENSAJE_TURNO, {
      message: `relacion debe ser una de: ${RELACIONES_MENSAJE_TURNO.join(", ")}.`,
    }),
    explicacion: z.string({ message: "explicacion debe ser texto." }).max(MAX_EXPLICACION),
  })
  .strict()

/**
 * Valida la respuesta cruda de Gemini contra `AnalisisMensajeTurnoSchema`.
 * `errores` describe la ESTRUCTURA que falló, nunca el contenido del mensaje
 * ni de la respuesta — es seguro de loguear (`docs/minimizacion-datos.md` §10).
 */
export function validarAnalisisMensajeTurno(
  data: unknown,
): { ok: true; datos: AnalisisMensajeTurnoExtraido } | { ok: false; errores: string[] } {
  const resultado = AnalisisMensajeTurnoSchema.safeParse(data)

  if (resultado.success) {
    return { ok: true, datos: resultado.data }
  }

  const errores = resultado.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(raíz)"
    return `[${path}] ${issue.message}`
  })

  return { ok: false, errores }
}
