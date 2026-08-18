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
 *
 * ## Ciudad y provincia (Sprint 16, tarea 16.1)
 *
 * `ciudad` es texto libre opcional, igual que `institucion`. `provincia` es
 * un dominio CERRADO -calco exacto del patrón de `lugarProvincia` en
 * `lib/validacion/turno.schema.ts`, que a su vez calca `grupoSanguineo` de
 * `lib/validacion/sos.schema.ts`-: `""` se transforma en `undefined` antes
 * del enum, para que "vacío" nunca compita con las 24 jurisdicciones válidas
 * de `PROVINCIAS_ARGENTINAS`. El `CHECK` `doctors_province_valida`
 * (`supabase/migrations/20260817231000_ciudad_provincia_direcciones.sql`) es
 * la misma lista copiada en el borde de la base.
 *
 * ## Especialidades: array, texto libre, sin catálogo cerrado (Sprint 16, tarea 16.2)
 *
 * `especialidades` reemplaza al viejo `especialidad` (un solo valor): un
 * médico puede tener cero o más -`components/medicos/formulario-medico.tsx`
 * las carga como chips, mismo patrón que `alergias`/`condicionesCronicas`/
 * `medicacionCritica` de `lib/validacion/sos.schema.ts`-. La validación de
 * acá es una COPIA local de `listaSos` (trim, descarta vacíos, deduplica sin
 * distinguir mayúsculas con `toLocaleLowerCase("es-AR")`, tope de largo por
 * ítem y de cantidad total), mismo criterio documentado en
 * `sos.schema.ts`: "cada schema de `lib/validacion/` es dueño de su propia
 * copia" en vez de importar cross-dominio. `lib/especialidades/catalogo.ts`
 * SOLO alimenta el autocompletar (`components/base/campo-autocompletar.tsx`)
 * -nunca hay un `z.enum()` ni un `CHECK` que la limite-: una especialidad
 * rara no puede bloquear el alta de un médico. El `CHECK`
 * `doctors_specialties_sin_vacios` y el tope de cantidad
 * `doctors_specialties_cantidad_razonable`
 * (`supabase/migrations/20260818090000_especialidades_multiples.sql`) son la
 * red de la base para lo que este schema ya garantiza del lado de la app.
 */

import { z } from "zod"

import { MAX_ESPECIALIDADES_POR_MEDICO, MAX_LARGO_ESPECIALIDAD } from "@/lib/especialidades/catalogo"
import { PROVINCIAS_ARGENTINAS } from "@/lib/ubicacion/provincias"

const MENSAJE_COORDENADAS_INCOMPLETAS =
  "Cargá las dos coordenadas (latitud y longitud) o dejá las dos en blanco."
const MENSAJE_PROVINCIA_INVALIDA = "Elegí una provincia de la lista."
const MENSAJE_ESPECIALIDAD_LARGA = `Cada especialidad puede tener hasta ${MAX_LARGO_ESPECIALIDAD} caracteres.`
const MENSAJE_DEMASIADAS_ESPECIALIDADES = `No se pueden cargar más de ${MAX_ESPECIALIDADES_POR_MEDICO} especialidades para un mismo médico.`

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

/**
 * `especialidades`: copia local de `listaSos` (`lib/validacion/sos.schema.ts`)
 * -trim, descarta vacíos, deduplica sin distinguir mayúsculas, topes de largo
 * y de cantidad-. Ver el comentario de cabecera del archivo.
 */
const listaEspecialidades = z
  .array(z.string({ message: "Cada especialidad debe ser texto." }))
  .default([])
  .transform((items) => {
    const vistos = new Set<string>()
    const resultado: string[] = []
    for (const item of items) {
      const limpio = item.trim()
      if (limpio.length === 0) continue
      const clave = limpio.toLocaleLowerCase("es-AR")
      if (vistos.has(clave)) continue
      vistos.add(clave)
      resultado.push(limpio)
    }
    return resultado
  })
  .superRefine((items, ctx) => {
    if (items.some((item) => item.length > MAX_LARGO_ESPECIALIDAD)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_ESPECIALIDAD_LARGA })
    }
    if (items.length > MAX_ESPECIALIDADES_POR_MEDICO) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_DEMASIADAS_ESPECIALIDADES })
    }
  })

const schemaMedico = z
  .object({
    nombre: campoTexto(200, "El nombre es demasiado largo (máx. 200 caracteres).").min(
      1,
      "El nombre del médico es obligatorio.",
    ),

    especialidades: listaEspecialidades,

    matricula: campoTextoOpcional(100, "La matrícula es demasiado larga (máx. 100 caracteres)."),

    institucion: campoTextoOpcional(150, "La institución es demasiado larga (máx. 150 caracteres)."),

    telefono: campoTextoOpcional(50, "El teléfono es demasiado largo (máx. 50 caracteres)."),

    direccion: campoTextoOpcional(300, "La dirección es demasiado larga (máx. 300 caracteres)."),

    ciudad: campoTextoOpcional(100, "La ciudad es demasiado larga (máx. 100 caracteres)."),

    provincia: z
      .string({ message: "La provincia debe ser texto." })
      .trim()
      .optional()
      .transform((valor) => (valor && valor.length > 0 ? valor : undefined))
      .pipe(z.enum(PROVINCIAS_ARGENTINAS, { message: MENSAJE_PROVINCIA_INVALIDA }).optional()),

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
  /** Ya trimeadas, sin vacías y sin duplicados. `[]` si no cargó ninguna. */
  especialidades: string[]
  matricula?: string
  institucion?: string
  telefono?: string
  direccion?: string
  ciudad?: string
  provincia?: string
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
