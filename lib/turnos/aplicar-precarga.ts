/**
 * Decide qué campos del formulario de turno pisa una nueva precarga de IA
 * (Sprint 16, tarea 16.4). Lógica pura -sin React-, usada por
 * `components/turnos/formulario-turno.tsx` y testeada en
 * `tests/unit/aplicar-precarga-turno.test.ts`.
 *
 * ## La decisión: "Analizar" pisa lo que puso la IA la vez anterior, nunca lo que tipeó la persona
 *
 * El encargo de la tarea es explícito y con una tensión real: "Analizar de
 * nuevo con otro texto pisa la precarga anterior, [pero] no los campos que la
 * persona ya editó a mano si es razonable distinguirlo — decidí y documentá."
 * Dos reglas ingenuas no alcanzan:
 *
 * - "Solo completar lo vacío" (el criterio de
 *   `lib/turnos/autocompletar-medico.ts` al elegir un médico del directorio)
 *   NO sirve acá: después de la PRIMERA pasada, los campos ya no están
 *   vacíos, así que una segunda pasada con un mensaje distinto no podría
 *   corregir NADA -viola literalmente "pisa la precarga anterior"-.
 * - "Pisar siempre todo" (el criterio de
 *   `lib/lugares/sugerencias.ts#precargaDesdeCentro` al elegir un centro del
 *   catálogo) tampoco sirve: ahí la persona elige explícitamente "el lugar es
 *   ESTE" sobre el campo que está tocando; acá "Analizar" puede correr con la
 *   persona ya habiendo corregido a mano media hora médica que el mensaje
 *   tenía mal, y una segunda pasada no debería borrar esa corrección.
 *
 * La solución: recordar, campo por campo, cuál fue el ÚLTIMO valor que puso
 * la IA (`ultimaPrecargaPrevia`, un `Partial` que arranca vacío la primera
 * vez). Un campo se pisa con la propuesta nueva si:
 *
 * 1. Está vacío ahora mismo, o
 * 2. Su valor actual es EXACTAMENTE el que dejó la IA la vez anterior -es
 *    decir, la persona no lo tocó desde entonces-.
 *
 * Si el valor actual no coincide con lo que dejó la última precarga (y no
 * está vacío), se interpreta como una edición manual y se conserva tal cual,
 * para SIEMPRE respecto de futuras precargas -una vez que la persona corrige
 * un campo a mano, "Analizar" no vuelve a tocarlo, aunque el mensaje nuevo
 * traiga otro valor-.
 */

export interface CamposPrecargables {
  especialidad: string
  medico: string
  fecha: string
  hora: string
  lugarNombre: string
  lugarDireccion: string
  lugarCiudad: string
  lugarProvincia: string
  notasPreparacion: string
}

const CLAVES_PRECARGABLES: (keyof CamposPrecargables)[] = [
  "especialidad",
  "medico",
  "fecha",
  "hora",
  "lugarNombre",
  "lugarDireccion",
  "lugarCiudad",
  "lugarProvincia",
  "notasPreparacion",
]

export interface ResultadoAplicarPrecarga {
  /** Los campos del formulario después de aplicar la precarga. */
  siguientes: CamposPrecargables
  /**
   * Lo que quedó puesto por la IA en cada campo que ella controla, para
   * comparar en la PRÓXIMA llamada a `aplicarPrecarga`. Un campo ausente acá
   * significa "la persona lo tiene bajo su propio control" -ya sea porque lo
   * editó a mano, o porque esta propuesta no traía nada para él-.
   */
  ultimaPrecarga: Partial<CamposPrecargables>
}

/**
 * Aplica `propuesta` sobre `actuales` según la regla del encabezado de este
 * archivo. `ultimaPrecargaPrevia` es `{}` en el primer análisis del
 * formulario (nada bajo control de la IA todavía).
 */
export function aplicarPrecarga(
  actuales: CamposPrecargables,
  propuesta: CamposPrecargables,
  ultimaPrecargaPrevia: Partial<CamposPrecargables>,
): ResultadoAplicarPrecarga {
  const siguientes: CamposPrecargables = { ...actuales }
  const ultimaPrecarga: Partial<CamposPrecargables> = {}

  for (const clave of CLAVES_PRECARGABLES) {
    const valorActual = actuales[clave]
    const valorPropuesto = propuesta[clave]
    const estaVacio = valorActual.trim().length === 0
    const siguePrecargaAnterior =
      ultimaPrecargaPrevia[clave] !== undefined && valorActual === ultimaPrecargaPrevia[clave]

    if (valorPropuesto.length === 0) {
      // La propuesta nueva no trae nada para este campo. Si seguía intacto
      // desde la última precarga, se lo sigue considerando "de la IA" (con su
      // valor actual, que no cambia); si la persona lo editó, sigue siendo
      // suyo. En ningún caso se vacía un campo que ya tenía contenido.
      if (siguePrecargaAnterior) ultimaPrecarga[clave] = valorActual
      continue
    }

    if (estaVacio || siguePrecargaAnterior) {
      siguientes[clave] = valorPropuesto
      ultimaPrecarga[clave] = valorPropuesto
    }
    // Si no está vacío y no coincide con la última precarga de la IA, es una
    // edición manual: se conserva tal cual, y no vuelve a marcarse como "de
    // la IA" -queda bajo control de la persona para futuras precargas-.
  }

  return { siguientes, ultimaPrecarga }
}
