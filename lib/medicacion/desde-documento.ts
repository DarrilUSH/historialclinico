/**
 * De un renglón de receta a un formulario de medicación a medio llenar
 * (Sprint 20 — "una foto, el lugar correcto").
 *
 * Lógica pura, sin React y sin red: la usa `/medicacion/nuevo` para armar los
 * `valoresIniciales` del formulario cuando se llega desde la pantalla de
 * revisión de un documento, y la ejercita
 * `tests/unit/medicacion-desde-documento.test.ts`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA REGLA QUE MANDA SOBRE TODO ESTE ARCHIVO: LA DOSIS NO SE ADIVINA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Una dosis inventada en una aplicación médica no es un bug cosmético: es que
 * alguien de 70 años, que confía en lo que la pantalla le muestra, tome de más
 * o de menos. El encargo del sprint lo pide con todas las letras y acá queda
 * escrito en el código, no solo en un comentario de diseño.
 *
 * Entonces, tres decisiones concretas:
 *
 * 1. **El modelo devuelve TEXTO LITERAL, no números.** `dosis_texto` y
 *    `frecuencia_texto` (`lib/gemini/schemas.ts`) son cadenas copiadas del
 *    papel. No hay ningún campo numérico en el contrato de extracción donde una
 *    dosis inventada pueda entrar con forma de dato válido.
 *
 * 2. **`interpretarDosis` traduce solo lo INEQUÍVOCO y ante la duda devuelve
 *    `null`.** Acepta "1 comprimido", "medio comprimido", "10 ml", "2 gotas":
 *    formas contables o de volumen donde leer mal es implausible. NO acepta
 *    miligramos ni gramos, aunque el papel los ponga en ese renglón, porque
 *    "500 mg" es indistinguible de la CONCENTRACIÓN de la pastilla y confundir
 *    una cosa con la otra es exactamente el error caro. Tampoco acepta un
 *    número pelado: "COVERAM 5/5" es una concentración, no cinco comprimidos.
 *
 * 3. **Lo que no se traduce, no se pierde: va a "Notas", literal.** Si el papel
 *    dice "cada 12 horas" y este archivo no se anima a convertirlo en un
 *    esquema de horarios, la frase queda escrita donde la persona la va a leer
 *    mientras completa el campo. Peor que no traducir es traducir y que el
 *    original desaparezca.
 *
 * La FRECUENCIA no se interpreta nunca, ni siquiera en los casos fáciles: el
 * esquema de `medications` es un CHECK de tres estados con horarios o intervalo
 * (`medications_esquema_coherente`), y "1 por día" no dice A QUÉ HORA. Elegir
 * una hora por la persona sería programarle un recordatorio a las 8 de la
 * mañana porque sí. El `<Select>` arranca en su default de siempre y la persona
 * pone sus horarios, con la frase del papel a la vista.
 */

import type { MedicamentoExtraido } from "@/lib/gemini/schemas"

/**
 * Los campos del formulario de medicación que esta traducción puede llenar.
 * Subconjunto estructural de `ValoresMedicacion`
 * (`components/medicacion/formulario-medicacion.tsx`): se declara acá para que
 * `lib/` no dependa de un componente cliente, y TypeScript coteja la forma en
 * el punto de uso.
 *
 * Los que NO están son deliberados: `frecuencia`, `horarios`,
 * `intervaloHoras`, `fechaFin` y `stock` los pone la persona. Ver el encabezado.
 */
export interface PrecargaMedicacion {
  nombre: string
  droga: string
  presentacion: string
  dosisCantidad: string
  /**
   * `undefined` cuando la dosis no se pudo leer sin suponer — a propósito, y no
   * cadena vacía: el formulario tiene su propio default ("comprimido") con
   * `?? "comprimido"`, y una cadena vacía lo pisaría dejando un campo
   * `required` en blanco. Llegar desde un documento no puede ser PEOR que el
   * alta a mano.
   */
  dosisUnidad?: string
  fechaInicio: string
  notas: string
}

/** Una dosis que sí se pudo leer sin interpretar nada. */
export interface DosisInterpretada {
  /** Cantidad como texto, listo para un `defaultValue` de `CampoNumero`. */
  cantidad: string
  /** Unidad en singular, como la escribe el formulario ("comprimido", "ml"). */
  unidad: string
}

/**
 * Unidades ACEPTADAS, con su forma singular. Son todas contables o de volumen:
 * "3 comprimidos" o "10 ml" no se pueden confundir con la concentración de la
 * pastilla.
 *
 * `mg`, `g`, `mcg`, `UI` y demás quedan AFUERA a propósito, aunque aparezcan en
 * recetas reales: "500 mg" en el renglón de la dosis es indistinguible de la
 * concentración impresa en la caja, y este archivo prefiere dejar el campo
 * vacío -que la persona completa mirando el papel- antes que arriesgar el error
 * caro. La frase original igual queda en "Notas".
 */
const UNIDADES_ACEPTADAS: ReadonlyMap<string, string> = new Map([
  ["comprimido", "comprimido"],
  ["comprimidos", "comprimido"],
  ["compr", "comprimido"],
  ["comp", "comprimido"],
  ["pastilla", "comprimido"],
  ["pastillas", "comprimido"],
  ["capsula", "cápsula"],
  ["capsulas", "cápsula"],
  ["cápsula", "cápsula"],
  ["cápsulas", "cápsula"],
  ["ml", "ml"],
  ["mililitro", "ml"],
  ["mililitros", "ml"],
  ["cc", "ml"],
  ["gota", "gota"],
  ["gotas", "gota"],
  ["puff", "puff"],
  ["puffs", "puff"],
  ["sobre", "sobre"],
  ["sobres", "sobre"],
  ["ampolla", "ampolla"],
  ["ampollas", "ampolla"],
  ["unidad", "unidad"],
  ["unidades", "unidad"],
])

/**
 * Cantidades escritas con palabras que no admiten otra lectura. Deliberadamente
 * cortísima: "medio comprimido" y "un comprimido" son el 90% de lo que una
 * receta escribe con letras, y agregar "algunos" o "varios" sería justamente
 * empezar a interpretar.
 */
const CANTIDADES_EN_PALABRAS: ReadonlyMap<string, string> = new Map([
  ["medio", "0.5"],
  ["media", "0.5"],
  ["un", "1"],
  ["uno", "1"],
  ["una", "1"],
  ["dos", "2"],
  ["tres", "3"],
])

/** Bloque Unicode "Combining Diacritical Marks": los acentos que NFD dejó sueltos. */
const MARCAS_COMBINANTES = /[\u0300-\u036f]/g

/** Quita tildes para cotejar palabras sin depender de cómo se escribió el papel. */
function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(MARCAS_COMBINANTES, "")
}

/**
 * Lee una dosis del texto literal del papel, o devuelve `null`.
 *
 * `null` NO es un error: es la respuesta correcta y la más frecuente. Significa
 * "el papel no lo dice, o no lo dice de una forma que se pueda leer sin
 * suponer", y el campo del formulario queda vacío para que lo complete una
 * persona con el papel delante.
 *
 * Solo reconoce el patrón `<cantidad> <unidad>` al PRINCIPIO del texto, con la
 * unidad en la lista blanca de arriba. Todo lo demás -"según indicación",
 * "500 mg", "5/5", "1-0-1"- devuelve `null`.
 */
export function interpretarDosis(dosisTexto: string): DosisInterpretada | null {
  const limpio = sinTildes(dosisTexto.trim().toLowerCase())
  if (limpio.length === 0) return null

  const coincidencia = /^([\d]{1,3}(?:[.,][\d]{1,2})?|[a-z]+)\s*([a-z]+)\b/.exec(limpio)
  if (!coincidencia) return null

  const [, cantidadCruda, unidadCruda] = coincidencia

  const unidad = UNIDADES_ACEPTADAS.get(unidadCruda)
  if (!unidad) return null

  // Número escrito con dígitos: se acepta tal cual, con la coma decimal
  // argentina normalizada al punto que espera `<input type="number">`.
  if (/^[\d]/.test(cantidadCruda)) {
    const cantidad = cantidadCruda.replace(",", ".")
    // Cero no es una dosis: es una lectura fallida o un renglón tachado.
    if (Number(cantidad) <= 0) return null
    return { cantidad, unidad }
  }

  const enPalabras = CANTIDADES_EN_PALABRAS.get(cantidadCruda)
  return enPalabras ? { cantidad: enPalabras, unidad } : null
}

/**
 * Lo que el papel dice y este archivo NO tradujo a un campo, escrito para que
 * la persona lo lea mientras completa el formulario.
 *
 * Se arma siempre que haya algo que decir, incluso cuando la dosis SÍ se pudo
 * interpretar: dejar la frase original a la vista es lo que permite darse
 * cuenta de que la traducción se equivocó.
 */
export function notasDelPapel(medicamento: MedicamentoExtraido): string {
  const partes: string[] = []

  const dosis = medicamento.dosis_texto.trim()
  const frecuencia = medicamento.frecuencia_texto.trim()

  if (dosis.length > 0) partes.push(`dosis «${dosis}»`)
  if (frecuencia.length > 0) partes.push(`frecuencia «${frecuencia}»`)

  if (partes.length === 0) {
    return "Cargado desde un documento que fotografiaste. El papel no decía la dosis ni cada cuánto tomarlo: completalo vos."
  }

  return `Cargado desde un documento que fotografiaste. El papel decía: ${partes.join(" y ")}.`
}

/** Avisos para mostrar al lado del medicamento en la lista de la pantalla de revisión. */
export function avisosDelMedicamento(medicamento: MedicamentoExtraido): string[] {
  const avisos: string[] = []

  if (interpretarDosis(medicamento.dosis_texto) === null) {
    avisos.push("El papel no dice cuánto tomar — lo completás vos.")
  }
  if (medicamento.frecuencia_texto.trim().length === 0) {
    avisos.push("El papel no dice cada cuánto — lo completás vos.")
  }

  return avisos
}

/**
 * Una línea para identificar el medicamento en la lista de confirmación:
 * `"COVERAM 5/5 — perindopril/amlodipina"`. Solo con lo que el papel imprime.
 */
export function resumenMedicamento(medicamento: MedicamentoExtraido): string {
  const cabeza = [medicamento.nombre.trim(), medicamento.presentacion.trim()]
    .filter((parte) => parte.length > 0)
    .join(" ")
  const droga = medicamento.droga.trim()
  return droga.length > 0 ? `${cabeza} — ${droga}` : cabeza
}

export interface OpcionesPrecargaMedicacion {
  /** Hoy en `YYYY-MM-DD`, hora de pared de Ushuaia. El formulario exige fecha de inicio y hoy es el default editable razonable — no es un dato leído del papel. */
  hoyIso: string
}

/**
 * El medicamento leído, traducido a lo que el formulario puede recibir.
 *
 * `fechaInicio` es HOY y no una fecha del papel: es cuándo la persona empieza a
 * registrar la toma en la aplicación, no cuándo se recetó. El campo es
 * `required` en el formulario y editable, así que un default de hoy le ahorra
 * un toque sin afirmar nada sobre el documento.
 */
export function precargaDesdeMedicamento(
  medicamento: MedicamentoExtraido,
  opciones: OpcionesPrecargaMedicacion,
): PrecargaMedicacion {
  const dosis = interpretarDosis(medicamento.dosis_texto)

  return {
    nombre: medicamento.nombre.trim(),
    droga: medicamento.droga.trim(),
    presentacion: medicamento.presentacion.trim(),
    // Vacío cuando no se pudo leer sin suponer: el campo queda en blanco y lo
    // completa la persona con el papel delante. La unidad, en cambio, se deja
    // SIN definir para que el formulario aplique su propio default de siempre
    // -ver el comentario de `PrecargaMedicacion.dosisUnidad`-.
    dosisCantidad: dosis?.cantidad ?? "",
    dosisUnidad: dosis?.unidad,
    fechaInicio: opciones.hoyIso,
    notas: notasDelPapel(medicamento),
  }
}
