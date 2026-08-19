/**
 * Schema Zod de entrada de `guardarDatosPerfil`
 * (`app/(app)/(con-nav)/perfil/datos/actions.ts`).
 *
 * Cierra el hueco que reportó el dueño del producto: la ficha SOS permite
 * cargar grupo sanguíneo, alergias y contacto de emergencia, pero **nunca**
 * pidió el nombre completo, la fecha de nacimiento, el DNI ni el teléfono
 * del titular del perfil — los cuatro viven en `profiles`
 * (`supabase/migrations/20260812200000_schema_inicial.sql` §4.1) desde el
 * esquema inicial, pero solo se escriben una vez: al crear un perfil
 * gestionado (`crear_perfil_gestionado`, solo nombre y fecha) o por el
 * trigger de alta de cuenta (solo nombre). Nunca existió una pantalla de
 * EDICIÓN. Consecuencia real, verificada en la ficha SOS y en la ficha para
 * el médico: "Edad no registrada" para siempre, y un nombre mal escrito al
 * registrarse es incorregible.
 *
 * ## Qué valida la base y qué solo valida este schema
 *
 * | Regla | ¿La base? | ¿Acá? |
 * |---|---|---|
 * | `full_name` no vacío | ✅ `profiles_full_name_no_vacio` | ✅ trim + mínimo 1 carácter |
 * | `date_of_birth` es una fecha válida o NULL | ✅ tipo `date` | ✅ formato `YYYY-MM-DD` |
 * | `date_of_birth` no futura | ❌ | ✅ (mismo criterio que `crearPerfilGestionado`) |
 * | `date_of_birth` no absurdamente antigua | ❌ | ✅ tope de 130 años |
 * | Formato de `national_id` | ❌ | ✅ 7-8 dígitos, tolera puntos |
 * | Formato de `phone` | ❌ | ✅ mismo criterio pragmático que `sos.schema.ts` |
 *
 * Las filas ❌ son reglas de APLICACIÓN: la base acepta cualquier texto en
 * `national_id` y `phone` a propósito (son columnas `text` sin CHECK, ver el
 * esquema). No hay ningún algoritmo de dígito verificador de DNI real en
 * Argentina —a diferencia del CUIT/CUIL— así que este schema no inventa uno:
 * valida forma (cantidad de dígitos), no autenticidad.
 *
 * ## `date_of_birth` es OPCIONAL en esta pantalla, a diferencia del alta
 *
 * `crearPerfilGestionado` (`app/(app)/(con-nav)/familia/actions.ts`) exige
 * la fecha de nacimiento porque es un alta guiada, de un solo campo por vez.
 * Acá es una edición de un perfil que puede llevar años sin ese dato
 * cargado: exigirlo de golpe bloquearía guardar el teléfono de alguien que
 * todavía no tiene la fecha a mano. `date_of_birth`, `national_id` y `phone`
 * son los tres opcionales; `full_name` es el único obligatorio, porque la
 * base ya lo exige.
 *
 * ## Fechas puras, sin `Date`
 *
 * Igual que `crearPerfilGestionado`: la comparación "¿es futura?" se hace
 * como comparación de STRINGS `YYYY-MM-DD` contra `hoyIsoUshuaia()`, nunca
 * construyendo un `Date` — es el equivalente TypeScript del bang `!Y-m-d` de
 * la regla global del usuario (ver el comentario completo en
 * `lib/perfiles/edad.ts`, que esta misma pantalla reusa para mostrar la
 * edad).
 */

import { z } from "zod"

export const MAX_LARGO_NOMBRE = 150
/** DNI argentino: 7 u 8 dígitos. No hay dígito verificador que validar. */
export const LARGO_MINIMO_DNI = 7
export const LARGO_MAXIMO_DNI = 8
export const MIN_LARGO_TELEFONO = 6
export const MAX_LARGO_TELEFONO = 20
/** Nadie registrado en la app tiene más de 130 años: tope de razonabilidad, no un límite biológico exacto. */
const MAX_ANIOS_EDAD = 130

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/
/** Solo dígitos y puntos como separador de miles ("30.123.456" o "30123456"). */
const PATRON_DNI_CRUDO = /^[\d.]+$/
/** Mismo criterio pragmático que `lib/validacion/sos.schema.ts`: dígitos y separadores visuales, `+` solo al inicio. */
const PATRON_TELEFONO = /^\+?[0-9\s().-]+$/
const MINIMO_DIGITOS_TELEFONO = 6

const MENSAJE_NOMBRE_VACIO = "Ingresá el nombre completo."
const MENSAJE_NOMBRE_LARGO = `El nombre es demasiado largo (máx. ${MAX_LARGO_NOMBRE} caracteres).`
const MENSAJE_FECHA_FORMATO = "La fecha de nacimiento no es válida."
const MENSAJE_FECHA_FUTURA = "La fecha de nacimiento no puede ser futura."
const MENSAJE_FECHA_MUY_ANTIGUA = "Esa fecha de nacimiento no parece correcta. Revisala."
const MENSAJE_DNI_FORMATO =
  "El DNI solo puede tener números y puntos como separador (por ejemplo 30.123.456)."
const MENSAJE_DNI_LARGO = `El DNI debe tener ${LARGO_MINIMO_DNI} u ${LARGO_MAXIMO_DNI} dígitos.`
const MENSAJE_TELEFONO_FORMATO =
  "El teléfono solo puede tener números, espacios, guiones, paréntesis y un + al principio."
const MENSAJE_TELEFONO_LARGO = `El teléfono tiene que tener entre ${MIN_LARGO_TELEFONO} y ${MAX_LARGO_TELEFONO} caracteres.`
const MENSAJE_TELEFONO_CORTO = "Ese teléfono tiene muy pocos números para poder llamar."

/** `""` (campo vacío) se transforma en `undefined` antes de cualquier otra validación: los tres campos opcionales comparten este primer paso. */
const opcional = (valor: string) => (valor.trim().length > 0 ? valor.trim() : undefined)

const schemaDatosPerfil = z
  .object({
    fullName: z
      .string({ message: "El nombre debe ser texto." })
      .trim()
      .min(1, MENSAJE_NOMBRE_VACIO)
      .max(MAX_LARGO_NOMBRE, MENSAJE_NOMBRE_LARGO),

    dateOfBirth: z
      .string({ message: "La fecha de nacimiento debe ser texto." })
      .transform(opcional)
      .optional(),

    nationalId: z
      .string({ message: "El DNI debe ser texto." })
      .transform(opcional)
      .optional(),

    phone: z
      .string({ message: "El teléfono debe ser texto." })
      .transform(opcional)
      .optional(),
  })
  .superRefine((datos, ctx) => {
    const fecha = datos.dateOfBirth
    if (fecha !== undefined) {
      if (!PATRON_FECHA.test(fecha)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_FECHA_FORMATO, path: ["dateOfBirth"] })
      } else {
        const [anioNac, mesNac, diaNac] = fecha.split("-").map(Number)
        const hoyIso = hoyIsoUshuaiaLocal()
        const [anioHoy, mesHoy, diaHoy] = hoyIso.split("-").map(Number)

        const esFutura =
          anioNac > anioHoy ||
          (anioNac === anioHoy && (mesNac > mesHoy || (mesNac === mesHoy && diaNac > diaHoy)))

        if (esFutura) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_FECHA_FUTURA, path: ["dateOfBirth"] })
        } else if (anioNac < anioHoy - MAX_ANIOS_EDAD) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: MENSAJE_FECHA_MUY_ANTIGUA,
            path: ["dateOfBirth"],
          })
        }
      }
    }

    const dni = datos.nationalId
    if (dni !== undefined) {
      if (!PATRON_DNI_CRUDO.test(dni)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_DNI_FORMATO, path: ["nationalId"] })
      } else {
        const soloDigitos = dni.replace(/\./g, "")
        if (soloDigitos.length < LARGO_MINIMO_DNI || soloDigitos.length > LARGO_MAXIMO_DNI) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_DNI_LARGO, path: ["nationalId"] })
        }
      }
    }

    const telefono = datos.phone
    if (telefono !== undefined) {
      if (telefono.length < MIN_LARGO_TELEFONO || telefono.length > MAX_LARGO_TELEFONO) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_TELEFONO_LARGO, path: ["phone"] })
      } else if (!PATRON_TELEFONO.test(telefono)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_TELEFONO_FORMATO, path: ["phone"] })
      } else if ((telefono.match(/\d/g)?.length ?? 0) < MINIMO_DIGITOS_TELEFONO) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_TELEFONO_CORTO, path: ["phone"] })
      }
    }
  })

/**
 * Copia local y deliberada de `hoyIsoUshuaia()` (`lib/turnos/fecha.ts`).
 *
 * Este archivo es `lib/validacion/`, que en todo el proyecto se mantiene sin
 * dependencias de `lib/turnos/` ni de ningún otro dominio -cada schema de
 * `lib/validacion/*.schema.ts` es una hoja, no un nodo intermedio-. Duplicar
 * ocho líneas de `Intl.DateTimeFormat` es más barato que introducir el primer
 * acoplamiento cruzado de la carpeta, y la implementación es tan chica que
 * diverge tan poco como para no justificar la dependencia. Si el criterio de
 * "hoy" cambiara de huso alguna vez, hay que tocar los dos lugares -y
 * `tests/unit/perfil-datos-schema.test.ts` lo cubre contra el mismo caso que
 * `tests/unit/rutas.test.ts` usa para `lib/turnos/fecha.ts`-.
 */
function hoyIsoUshuaiaLocal(ahora: Date = new Date()): string {
  const formato = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Ushuaia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return formato.format(ahora)
}

export interface DatosPerfilValidado {
  fullName: string
  /** `undefined` = no cargada → la Server Action escribe `null`. */
  dateOfBirth?: string
  /** Ya normalizado a solo dígitos (sin puntos). `undefined` = no cargado → `null`. */
  nationalId?: string
  phone?: string
}

export function validarDatosPerfil(
  data: unknown,
): { ok: true; datos: DatosPerfilValidado } | { ok: false; error: string } {
  const resultado = schemaDatosPerfil.safeParse(data)

  if (!resultado.success) {
    return { ok: false, error: resultado.error.issues[0]?.message ?? "Los datos no son válidos." }
  }

  const { fullName, dateOfBirth, nationalId, phone } = resultado.data

  return {
    ok: true,
    datos: {
      fullName,
      dateOfBirth,
      // Se guarda normalizado (sin puntos): "30.123.456" y "30123456" son el
      // mismo documento, y guardarlo sin separadores evita que una búsqueda
      // futura por DNI tenga que normalizar en cada consulta.
      nationalId: nationalId?.replace(/\./g, ""),
      phone,
    },
  }
}
