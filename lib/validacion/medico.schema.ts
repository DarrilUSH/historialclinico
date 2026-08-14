/**
 * Schema Zod de entrada de `crearMedico` / `actualizarMedico`
 * (`app/(app)/(con-nav)/medicos/actions.ts`, Sprint 10, tarea 10.1).
 *
 * Primera línea de defensa, **no** la única: la base repite las mismas
 * coherencias con sus propios `CHECK` de
 * `supabase/migrations/20260812200000_schema_inicial.sql` §4.3 —
 * `doctors_full_name_no_vacio`, `doctors_latitud_valida`,
 * `doctors_longitud_valida` y `doctors_coordenadas_completas` — mismo
 * criterio que `lib/validacion/turno.schema.ts`: que el error se muestre
 * ANTES de gastar el viaje de red, con el mismo criterio en las dos puntas.
 *
 * ## Coordenadas: calcadas de `turno.schema.ts`, con su propia copia
 *
 * `latitude`/`longitude` son opcionales pero solo pueden venir JUNTAS
 * (`doctors_coordenadas_completas`) y dentro del rango de un par
 * lat/lng real (`doctors_latitud_valida`/`doctors_longitud_valida`). La
 * validación (presencia coherente, formato numérico, rango) vive en un único
 * `superRefine` sobre las dos strings crudas, igual que en
 * `lib/validacion/turno.schema.ts`, y recién se convierte a `number` en
 * `validarMedico`, ya fuera del pipeline de Zod. Se duplica el helper en vez
 * de importarlo cross-dominio: cada schema de `lib/validacion/` es dueño de
 * su propia copia, mismo criterio que `medicacion.schema.ts` con
 * `parsearDecimal`.
 *
 * Ushuaia (y todo el hemisferio sur/oeste) tiene latitud y longitud siempre
 * negativas, así que el formulario usa `CampoNumero` con `permiteNegativo`
 * (ver `components/medicos/formulario-medico.tsx`), y este schema acepta el
 * signo `-` en las dos strings crudas.
 */

import { z } from "zod"

const MENSAJE_COORDENADAS_INCOMPLETAS =
  "Cargá las dos coordenadas (latitud y longitud) o dejá las dos en blanco."

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

const schemaMedico = z
  .object({
    nombre: campoTexto(200, "El nombre es demasiado largo (máx. 200 caracteres).").min(
      1,
      "El nombre del médico es obligatorio.",
    ),

    especialidad: campoTextoOpcional(150, "La especialidad es demasiado larga (máx. 150 caracteres)."),

    matricula: campoTextoOpcional(100, "La matrícula es demasiado larga (máx. 100 caracteres)."),

    institucion: campoTextoOpcional(150, "La institución es demasiado larga (máx. 150 caracteres)."),

    telefono: campoTextoOpcional(50, "El teléfono es demasiado largo (máx. 50 caracteres)."),

    direccion: campoTextoOpcional(300, "La dirección es demasiado larga (máx. 300 caracteres)."),

    latitud: campoCoordenada,
    longitud: campoCoordenada,

    notas: campoTextoOpcional(2000, "Las notas son demasiado largas (máx. 2000 caracteres)."),
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
      return
    }

    if (huboLatitud && huboLongitud) {
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
  })

export interface DatosMedicoValidado {
  nombre: string
  especialidad?: string
  matricula?: string
  institucion?: string
  telefono?: string
  direccion?: string
  latitud?: number
  longitud?: number
  notas?: string
}

export function validarMedico(
  data: unknown,
): { ok: true; datos: DatosMedicoValidado } | { ok: false; error: string } {
  const resultado = schemaMedico.safeParse(data)

  if (!resultado.success) {
    return { ok: false, error: resultado.error.issues[0]?.message ?? "Los datos no son válidos." }
  }

  const { latitud, longitud, ...resto } = resultado.data

  return {
    ok: true,
    datos: {
      ...resto,
      latitud: latitud !== undefined ? parsearDecimal(latitud)! : undefined,
      longitud: longitud !== undefined ? parsearDecimal(longitud)! : undefined,
    },
  }
}
