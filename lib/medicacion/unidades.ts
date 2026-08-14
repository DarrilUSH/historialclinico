/**
 * Cantidades y unidades de medicación, en castellano (Sprint 7).
 *
 * Módulo **puro**: no lee la base, no toca el reloj, no importa `server-only`.
 * Lo consumen tanto la interfaz (`components/medicacion/tarjeta-medicacion.tsx`)
 * como el texto de las alertas push (`lib/medicacion/alertas.ts`), y por eso
 * vive acá y no dentro de ninguno de los dos — mismo criterio que
 * `lib/medicacion/formato-toma.ts`.
 *
 * ## El bug que lo justifica
 *
 * La tarjeta de medicación decía **"90 comprimido disponibles"**: concatenaba
 * `stock_units` con `dose_unit` tal cual, y `dose_unit` se guarda en singular
 * (`medications.dose_unit`, default `'comprimido'`) porque su uso primario es
 * la dosis por toma —"1 comprimido"—. Es la misma cadena en los dos lugares y
 * solo uno de los dos la quiere en singular.
 *
 * ## Por qué no se resuelve con `${unidad}s`
 *
 * `dose_unit` es **texto libre** de hasta 40 caracteres (no hay CHECK ni enum:
 * ver el comentario de `components/medicacion/formulario-medicacion.tsx` sobre
 * por qué no es un `<Select>`). Lo que llega de verdad son tres familias:
 *
 * | Familia | Ejemplos | Plural correcto |
 * |---|---|---|
 * | Sustantivos comunes | comprimido, cápsula, gota, parche, sobre | +`s` |
 * | Sustantivos en consonante | unidad, papel | +`es` |
 * | **Abreviaturas de medida** | ml, mg, g, UI, cc | **invariables** |
 *
 * La tercera fila es la que rompe la regla ingenua: la RAE fija que los
 * símbolos de unidades de medida **no llevan plural** ("5 mg", nunca "5 mgs"),
 * y `${unidad}s` produciría "10 mls".
 */

/**
 * Símbolos de unidades de medida, que en castellano son **invariables**
 * (RAE: los símbolos no admiten plural ni punto abreviativo).
 *
 * `puff` y `spray` no son símbolos sino préstamos, pero se listan acá por el
 * mismo efecto práctico: las recetas del producto escriben "2 puff", y
 * "2 puffs" leído en voz alta a una persona mayor no aporta nada.
 *
 * La comparación es en minúsculas, así que alcanza con listar una forma.
 */
const UNIDADES_INVARIABLES = new Set([
  "ml",
  "mg",
  "g",
  "kg",
  "mcg",
  "µg",
  "cc",
  "l",
  "ui",
  "u",
  "mmol",
  "meq",
  "%",
  "puff",
  "spray",
])

const VOCALES_SIMPLES = new Set(["a", "e", "i", "o", "u"])

/** Consonantes tras las que el plural castellano es `-es` (unidad → unidades). */
const CONSONANTES_CON_ES = new Set(["d", "l", "n", "r"])

/**
 * Pluraliza una unidad de dosis según la cantidad.
 *
 * Las reglas, en orden, y **deliberadamente pocas**: el caso que importa es
 * "comprimido", y lo que no se sabe pluralizar se deja intacto en vez de
 * inventar una forma rara. Un "3 puff" es correcto; un "3 puffes" es un bug
 * visible.
 *
 * 1. `cantidad === 1` (o unidad vacía) → tal cual. El singular es el dato
 *    guardado; no hay nada que hacer.
 * 2. Símbolo de medida (`ml`, `mg`, `UI`, …) → tal cual: son invariables.
 * 3. Termina en `-ón` → `-ones` (aplicación → aplicaciones). Es la única
 *    irregularidad que aparece de verdad en unidades de dosis, y sin ella la
 *    regla 5 daría "aplicaciónes".
 * 4. Termina en vocal simple → `+s` (comprimido, gota, cápsula, sobre, parche).
 * 5. Termina en `d`, `l`, `n` o `r` → `+es` (unidad → unidades).
 * 6. Cualquier otra cosa → tal cual. Cubre las que ya vienen en plural
 *    ("gotas"), las invariables terminadas en `s`/`z` ("dosis") y todo lo
 *    imprevisto.
 *
 * Se preserva la capitalización original: se decide sobre una copia en
 * minúsculas y se opera sobre la cadena tal como vino.
 */
export function pluralizarUnidad(cantidad: number, unidad: string | null | undefined): string {
  const base = unidad?.trim() ?? ""
  if (base === "" || cantidad === 1) {
    return base
  }

  const minuscula = base.toLocaleLowerCase("es-AR")

  if (UNIDADES_INVARIABLES.has(minuscula)) {
    return base
  }

  if (minuscula.endsWith("ón")) {
    return `${base.slice(0, -2)}ones`
  }

  const ultima = minuscula.slice(-1)

  if (VOCALES_SIMPLES.has(ultima)) {
    return `${base}s`
  }

  if (CONSONANTES_CON_ES.has(ultima)) {
    return `${base}es`
  }

  return base
}

/**
 * Número para mostrar, con coma decimal.
 *
 * `numeric` de PostgreSQL llega como `number` por `supabase-js`. Los enteros se
 * muestran pelados ("90", no "90,0") porque el caso abrumador es contar
 * comprimidos; los decimales usan la coma del castellano rioplatense (7,5 ml).
 */
export function formatearCantidad(cantidad: number | null | undefined): string {
  const valor = cantidad ?? 0
  return Number.isInteger(valor) ? String(valor) : String(valor).replace(".", ",")
}

/**
 * `"1 comprimido"`, `"90 comprimidos"`, `"7,5 ml"`.
 *
 * Es la única forma correcta de concatenar una cantidad con `dose_unit`, tanto
 * para la dosis por toma como para el stock. Sin unidad devuelve solo el
 * número, sin espacio colgando.
 */
export function textoCantidadConUnidad(
  cantidad: number | null | undefined,
  unidad: string | null | undefined,
): string {
  const valor = cantidad ?? 0
  return `${formatearCantidad(valor)} ${pluralizarUnidad(valor, unidad)}`.trim()
}
