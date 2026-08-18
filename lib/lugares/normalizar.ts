/**
 * Normalizaciones del catálogo REFES (Sprint 16, tarea 16.3). Lógica pura,
 * testeada en `tests/unit/lugares-normalizar.test.ts`.
 *
 * Dos cosas viven acá porque las dos tienen que decir EXACTAMENTE lo mismo en
 * los dos extremos de un mismo camino:
 *
 * 1. `normalizarBusqueda` — se aplica al INGERIR (arma
 *    `health_centers.search_text`) y al BUSCAR (normaliza lo que la persona
 *    teclea antes del `like`). Si las dos puntas no usaran la misma función,
 *    "cordoba" no encontraría "CÓRDOBA" y nadie se enteraría hasta que un
 *    usuario lo reportara.
 * 2. `provinciaCanonica` — traduce la jurisdicción del REFES ("CABA",
 *    "TIERRA DEL FUEGO", en mayúsculas) al valor exacto de
 *    `PROVINCIAS_ARGENTINAS` (`lib/ubicacion/provincias.ts`), que es lo que
 *    aceptan los CHECK `appointments_location_province_valida` y
 *    `doctors_province_valida`. Sin esta traducción, elegir un centro de CABA
 *    en el formulario de turno guardaría "CABA" y la base lo rechazaría.
 */

import { PROVINCIAS_ARGENTINAS, type ProvinciaArgentina } from "@/lib/ubicacion/provincias"

/**
 * "n"/"N" seguidas de U+0303 (tilde combinante): en lo que se convierten "ñ"
 * y "Ñ" después de `normalize("NFD")`.
 *
 * Los tres patrones de acá abajo se escriben con ESCAPES Unicode y no con el
 * carácter literal a propósito: una marca combinante suelta en el código
 * fuente se pega visualmente a la letra anterior -o al corchete del rango-,
 * es indistinguible de un carácter normal en cualquier editor, y vuelve
 * ilegible el diff. Mismo criterio que `tieneCaracteresDeControl` en
 * `lib/auth/rutas.ts`, que evita meter bytes de control literales en un `.ts`.
 */
const ENIE_DESCOMPUESTA = /n\u0303/g
const ENIE_MAYUSCULA_DESCOMPUESTA = /N\u0303/g

/** Bloque Unicode "Combining Diacritical Marks": los acentos que NFD dejó sueltos. */
const MARCAS_COMBINANTES = /[\u0300-\u036f]/g

/**
 * Minúsculas, sin tildes ni diéresis, con los espacios colapsados.
 *
 * El despojo de tildes se hace con la descomposición canónica de Unicode
 * (NFD separa "á" en "a" + acento combinante) y el borrado de las marcas
 * combinantes. Es el mismo criterio "insensible a tildes" que
 * `lib/especialidades/coincidencias.ts` consigue con `Intl.Collator` y
 * `sensitivity: "base"` -acá no se puede usar el collator porque el resultado
 * no se compara en memoria: se GUARDA en una columna
 * (`health_centers.search_text`) y después se busca con `like` desde
 * Postgres, que no conoce el collator del navegador-.
 *
 * La "ñ" se conserva a propósito: NFD la descompone en "n" + tilde y el
 * borrado la dejaría en "n". En castellano "ñ" y "n" son letras distintas, no
 * variantes de acento -"cañada" y "canada" no son la misma palabra-, y el
 * REFES está lleno de topónimos con ñ (LOS ÑIRES, PEÑA, GUAYMALLÉN). Quien
 * teclea "ñires" espera encontrarlos.
 */
export function normalizarBusqueda(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(ENIE_DESCOMPUESTA, "ñ")
    .replace(ENIE_MAYUSCULA_DESCOMPUESTA, "Ñ")
    .replace(MARCAS_COMBINANTES, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Índice de las 24 jurisdicciones por su nombre ya normalizado, para no
 * depender de mayúsculas ni tildes al mapear.
 */
const POR_NOMBRE_NORMALIZADO = new Map<string, ProvinciaArgentina>(
  PROVINCIAS_ARGENTINAS.map((provincia) => [normalizarBusqueda(provincia), provincia]),
)

/**
 * Nombres del REFES que NO coinciden con `PROVINCIAS_ARGENTINAS` ni siquiera
 * normalizados, y su equivalente canónico. Son los dos únicos casos de las 24
 * jurisdicciones que publica el REFES (verificado sobre la edición de
 * diciembre de 2025: las otras 22 coinciden carácter por carácter una vez
 * normalizadas).
 */
const ALIAS_REFES: Record<string, ProvinciaArgentina> = {
  caba: "Ciudad Autónoma de Buenos Aires",
  "tierra del fuego": "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
}

/**
 * Convierte el `provincia_nombre` del REFES al valor exacto de
 * `PROVINCIAS_ARGENTINAS`, o `null` si no lo reconoce.
 *
 * Devolver `null` en vez de inventar un valor es deliberado: si una edición
 * futura del REFES agrega o renombra una jurisdicción, el centro se guarda
 * igual (el catálogo no pierde filas) y lo único que pierde es la precarga de
 * "Provincia" en el formulario de turno. La alternativa -guardar el nombre
 * crudo- haría fallar el CHECK de `appointments.location_province` recién al
 * momento de guardar el turno, con un error que la persona no puede resolver.
 */
export function provinciaCanonica(nombreRefes: string | null | undefined): ProvinciaArgentina | null {
  if (!nombreRefes) return null

  const normalizado = normalizarBusqueda(nombreRefes)
  if (normalizado.length === 0) return null

  return ALIAS_REFES[normalizado] ?? POR_NOMBRE_NORMALIZADO.get(normalizado) ?? null
}
