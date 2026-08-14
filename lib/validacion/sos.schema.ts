/**
 * Schema Zod de entrada de `guardarFichaSos`
 * (`app/(app)/(con-nav)/perfil/sos/actions.ts`, Sprint 8, tarea 8.2).
 *
 * Contrato completo del modelo: `docs/modelo-sos.md`.
 *
 * Primera línea de defensa, **no** la única. La única coherencia que la base
 * repite por su cuenta es `profiles_blood_type_valido`
 * (`supabase/migrations/20260812200000_schema_inicial.sql` §4.1), y este
 * schema la calca **exactamente**: los mismos ocho valores, ni uno más. Un
 * grupo sanguíneo inválido no llega nunca a la base — y si llegara, el CHECK
 * lo rechaza con `23514`. Mismo criterio que `lib/validacion/medicacion.schema.ts`.
 *
 * ## Qué valida la base y qué solo valida este schema
 *
 * | Regla | ¿La base? | ¿Acá? |
 * |---|---|---|
 * | `blood_type` ∈ los 8 valores, o NULL | ✅ `profiles_blood_type_valido` | ✅ enum estricto |
 * | Los tres arrays son `text[] NOT NULL DEFAULT '{}'` | ✅ tipo + default | ✅ siempre devuelve array |
 * | Ítems no vacíos, sin duplicados, con tope de largo y de cantidad | ❌ | ✅ |
 * | Formato del teléfono del contacto | ❌ | ✅ |
 * | Vínculo/teléfono exigen nombre de contacto | ❌ | ✅ |
 * | Topes de largo de nombre, vínculo y notas | ❌ | ✅ |
 *
 * Las filas ❌ son **reglas de aplicación**, no del modelo: la base acepta
 * cualquier texto en esas columnas a propósito (ver `docs/modelo-sos.md` §4).
 * Se documentan acá para que nadie asuma que existe una red de contención
 * abajo que en realidad no está.
 *
 * ## Los arrays llegan como arrays, nunca como texto separado por comas
 *
 * `alergias`, `condicionesCronicas` y `medicacionCritica` vienen de
 * `FormData.getAll(...)`: un valor por chip agregado en
 * `components/sos/formulario-sos.tsx`, exactamente el mismo mecanismo que los
 * horarios de `components/medicacion/formulario-medicacion.tsx`. Nunca un
 * campo de texto libre con comas: "Alergia a la penicilina, con shock" es UNA
 * alergia y partirla por comas la convertiría en dos entradas falsas.
 *
 * ## Grupo sanguíneo: `""` es "no lo sé", y significa NULL
 *
 * El desplegable ofrece los ocho grupos más "No lo sé". Esa opción manda
 * cadena vacía y se transforma en `undefined`, que la Server Action escribe
 * como `null`. Es una distinción real: NULL es "no sabemos el grupo", y la
 * ficha SOS lo muestra como tal en vez de inventar un valor por defecto que
 * un paramédico podría leer como dato confirmado.
 */

import { z } from "zod"

/**
 * Los ocho valores de `profiles_blood_type_valido`, en el mismo orden en que
 * los lista el CHECK. Se exporta porque `components/sos/formulario-sos.tsx`
 * arma el desplegable con esta misma constante: una sola fuente para el
 * cliente y el servidor.
 */
export const GRUPOS_SANGUINEOS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const

export type GrupoSanguineo = (typeof GRUPOS_SANGUINEOS)[number]

/** Máximo de ítems por lista. Una ficha de emergencia con 30 alergias ya no se lee de un vistazo; es un tope de legibilidad, no de almacenamiento. */
export const MAX_ITEMS_LISTA = 30

/** Máximo de caracteres por ítem de lista. */
export const MAX_LARGO_ITEM = 120

export const MAX_LARGO_CONTACTO = 120
export const MAX_LARGO_VINCULO = 60
export const MAX_LARGO_NOTAS = 2000

/** Largos del teléfono del contacto, contando separadores visuales. */
export const MIN_LARGO_TELEFONO = 6
export const MAX_LARGO_TELEFONO = 20

/**
 * Validación pragmática de teléfono argentino: dígitos y separadores
 * visuales (`+`, espacio, guion, paréntesis, punto), con el `+` solo al
 * principio. **No** se valida el plan de numeración (0/15, código de área,
 * "9" de celular): las variantes reales que la gente escribe son demasiadas
 * y rechazar un número correcto porque no matchea un patrón canónico es peor
 * que aceptar uno raro — este teléfono termina en un enlace `tel:` de la
 * ficha SOS, y `tel:` acepta separadores visuales (RFC 3966 §3).
 *
 * El largo mínimo se controla aparte sobre los DÍGITOS, no sobre la cadena:
 * `"--- ---"` pasa el patrón pero no es un teléfono.
 */
const PATRON_TELEFONO = /^\+?[0-9\s().-]+$/
const MINIMO_DIGITOS_TELEFONO = 6

const MENSAJE_GRUPO_INVALIDO =
  "Elegí un grupo sanguíneo válido (A+, A-, B+, B-, AB+, AB-, O+, O-) o \"No lo sé\"."
const MENSAJE_ITEM_LARGO = `Cada entrada de la lista puede tener hasta ${MAX_LARGO_ITEM} caracteres.`
const MENSAJE_LISTA_LLENA = `No se pueden cargar más de ${MAX_ITEMS_LISTA} entradas en una misma lista.`
const MENSAJE_TELEFONO_FORMATO =
  "El teléfono solo puede tener números, espacios, guiones, paréntesis y un + al principio."
const MENSAJE_TELEFONO_LARGO = `El teléfono tiene que tener entre ${MIN_LARGO_TELEFONO} y ${MAX_LARGO_TELEFONO} caracteres.`
const MENSAJE_TELEFONO_CORTO = "Ese teléfono tiene muy pocos números para poder llamar."
const MENSAJE_CONTACTO_SIN_NOMBRE =
  "Poné el nombre del contacto de emergencia: un teléfono o un vínculo sin nombre no le sirve a quien tiene que llamar."

const campoTexto = (max: number, mensajeLargo: string) =>
  z.string({ message: "Ese campo debe ser texto." }).trim().max(max, mensajeLargo)

const campoTextoOpcional = (max: number, mensajeLargo: string) =>
  campoTexto(max, mensajeLargo)
    .optional()
    .transform((valor) => (valor && valor.length > 0 ? valor : undefined))

/**
 * Una de las tres listas SOS. Los ítems llegan crudos de `getAll`: se
 * trimean, se descartan los vacíos y se deduplican **sin distinguir
 * mayúsculas** (`"Penicilina"` y `"penicilina"` son la misma alergia y
 * repetirlas en una ficha de emergencia es ruido). La comparación es solo
 * para decidir el duplicado: el valor que se guarda es el que la persona
 * escribió, con sus tildes y su capitalización intactas.
 */
const listaSos = z
  .array(z.string({ message: "Cada entrada de la lista debe ser texto." }))
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
    if (items.some((item) => item.length > MAX_LARGO_ITEM)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_ITEM_LARGO })
    }
    if (items.length > MAX_ITEMS_LISTA) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_LISTA_LLENA })
    }
  })

const schemaSos = z
  .object({
    // Calco EXACTO de `profiles_blood_type_valido`. `""` (la opción "No lo
    // sé" del desplegable) se transforma en `undefined` ANTES del enum, así
    // que "vacío" nunca compite con los ocho valores válidos.
    grupoSanguineo: z
      .string({ message: "El grupo sanguíneo debe ser texto." })
      .trim()
      .optional()
      .transform((valor) => (valor && valor.length > 0 ? valor : undefined))
      .pipe(z.enum(GRUPOS_SANGUINEOS, { message: MENSAJE_GRUPO_INVALIDO }).optional()),

    alergias: listaSos,
    condicionesCronicas: listaSos,
    medicacionCritica: listaSos,

    contactoNombre: campoTextoOpcional(
      MAX_LARGO_CONTACTO,
      `El nombre del contacto es demasiado largo (máx. ${MAX_LARGO_CONTACTO} caracteres).`,
    ),

    contactoTelefono: z
      .string({ message: "El teléfono debe ser texto." })
      .trim()
      .optional()
      .transform((valor) => (valor && valor.length > 0 ? valor : undefined)),

    contactoVinculo: campoTextoOpcional(
      MAX_LARGO_VINCULO,
      `El vínculo es demasiado largo (máx. ${MAX_LARGO_VINCULO} caracteres).`,
    ),

    notas: campoTextoOpcional(
      MAX_LARGO_NOTAS,
      `Las observaciones son demasiado largas (máx. ${MAX_LARGO_NOTAS} caracteres).`,
    ),
  })
  .superRefine((datos, ctx) => {
    const telefono = datos.contactoTelefono
    if (telefono !== undefined) {
      if (telefono.length < MIN_LARGO_TELEFONO || telefono.length > MAX_LARGO_TELEFONO) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: MENSAJE_TELEFONO_LARGO,
          path: ["contactoTelefono"],
        })
      } else if (!PATRON_TELEFONO.test(telefono)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: MENSAJE_TELEFONO_FORMATO,
          path: ["contactoTelefono"],
        })
      } else if ((telefono.match(/\d/g)?.length ?? 0) < MINIMO_DIGITOS_TELEFONO) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: MENSAJE_TELEFONO_CORTO,
          path: ["contactoTelefono"],
        })
      }
    }

    // Regla de aplicación sin contraparte en la base (ver la tabla del
    // encabezado): el teléfono y el vínculo describen a ALGUIEN. Sin nombre,
    // la ficha mostraría "Llamar a — (hija)" y quien atiende no sabe a quién
    // pidió. El nombre solo, en cambio, sí sirve: identifica a quién buscar
    // aunque no haya número cargado.
    if (
      datos.contactoNombre === undefined &&
      (datos.contactoTelefono !== undefined || datos.contactoVinculo !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: MENSAJE_CONTACTO_SIN_NOMBRE,
        path: ["contactoNombre"],
      })
    }
  })

export interface DatosSosValidado {
  /** `undefined` = "No lo sé" → la Server Action escribe `null`. */
  grupoSanguineo?: GrupoSanguineo
  /** Ya trimeadas, sin vacíos y sin duplicados. `[]` si no hay ninguna. */
  alergias: string[]
  condicionesCronicas: string[]
  medicacionCritica: string[]
  contactoNombre?: string
  contactoTelefono?: string
  contactoVinculo?: string
  notas?: string
}

export function validarFichaSos(
  data: unknown,
): { ok: true; datos: DatosSosValidado } | { ok: false; error: string } {
  const resultado = schemaSos.safeParse(data)

  if (!resultado.success) {
    return { ok: false, error: resultado.error.issues[0]?.message ?? "Los datos no son válidos." }
  }

  return { ok: true, datos: resultado.data }
}
