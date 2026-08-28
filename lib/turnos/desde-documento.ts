/**
 * De un papel fotografiado a la pantalla de turno nuevo (Sprint 20 — "una foto,
 * el lugar correcto").
 *
 * Lógica pura, sin React y sin red: la usa `/turnos/nuevo` cuando se llega con
 * `?doc=<uuid>` desde la pantalla de revisión de un documento, y la ejercita
 * `tests/unit/turnos-desde-documento.test.ts`.
 *
 * ## Dos papeles, dos caminos, y ninguno duplica lo que ya existe
 *
 * **Un TURNO (`turno_o_cita`)** -la captura de la agenda del Hospital Británico
 * con sus dos turnos confirmados- no se traduce campo por campo acá. Se le pasa
 * el TEXTO al analizador de mensajes que ya existe desde el Sprint 16
 * (`components/turnos/analizador-mensaje-turno.tsx` →
 * `lib/turnos/analizar-mensaje.ts`), que ya sabe leer 1..N turnos, fusionar una
 * confirmación con su turno, avisar cuando el año quedó inferido y crear el
 * lote entero con sus recordatorios. Reimplementar acá una fracción de eso
 * sería tener dos definiciones de "qué es un turno bien leído" separándose en
 * silencio. `textoParaAnalizador` arma ese texto; el resto ya está escrito y
 * probado.
 *
 * Sí, eso cuesta una segunda llamada a Gemini. Es deliberado y está acotado:
 * **la dispara la persona al tocar el botón**, no la subida del archivo. La
 * regla del sprint -UNA llamada por documento- protege la cuota del free tier
 * en el camino automático, no prohíbe que alguien pida explícitamente un
 * segundo trabajo. Un turno mal leído es un turno al que no se llega.
 *
 * **Una ORDEN (`orden_de_practica`)** sí se traduce acá, y es trivial: no hay
 * nada que analizar porque el papel NO tiene día ni hora -esa es justamente su
 * naturaleza-. Se precargan la especialidad y, en las notas, qué práctica es y
 * quién la pidió. La fecha la pone la persona cuando saque el turno.
 */

import type { DocumentoMedicoExtraido } from "@/lib/gemini/schemas"

/**
 * Los campos del formulario de turno que esta traducción puede llenar.
 * Subconjunto estructural de `ValoresTurno`
 * (`components/turnos/formulario-turno.tsx`): se declara acá para que `lib/` no
 * dependa de un componente cliente.
 *
 * **`fecha` y `hora` no están, y es el punto del asunto.** Una orden médica no
 * dice cuándo: ponerle la fecha de emisión sería afirmar que el turno es para
 * ese día, y ponerle hoy sería peor todavía.
 */
export interface PrecargaTurnoDesdeOrden {
  especialidad: string
  notasPreparacion: string
}

/** `"3 de noviembre de 2026"` no: acá alcanza con la fecha tal cual, que es lo que el papel imprime. */
function lineaSiHay(etiqueta: string, valor: string | null | undefined): string | null {
  const limpio = (valor ?? "").trim()
  return limpio.length > 0 ? `${etiqueta}: ${limpio}` : null
}

/**
 * La orden leída, traducida a lo que el formulario de turno puede recibir.
 *
 * La especialidad va a su campo -es lo que la persona va a buscar cuando pida
 * el turno-. Todo lo demás va a NOTAS y no a los campos de identidad del turno,
 * por una razón concreta: **quien FIRMA una orden no es quien va a ATENDER el
 * turno.** Poner al médico solicitante en el campo "Médico" del turno crearía
 * una cita con el profesional equivocado, y encima cotejaría contra el
 * directorio y ofrecería vincularlo. En notas dice la verdad -"la pidió tal"- y
 * no afirma nada que no sepamos.
 */
export function precargaDesdeOrden(extraccion: DocumentoMedicoExtraido): PrecargaTurnoDesdeOrden {
  const lineas = [
    lineaSiHay("Práctica", extraccion.titulo),
    lineaSiHay("La pidió", extraccion.medico),
    lineaSiHay("Emitida el", extraccion.fecha),
    lineaSiHay("Institución", extraccion.institucion),
  ].filter((linea): linea is string => linea !== null)

  const encabezado =
    lineas.length > 0
      ? "Pedido de estudio que fotografiaste:"
      : "Pedido de estudio que fotografiaste."

  return {
    especialidad: extraccion.especialidad.trim(),
    notasPreparacion: [encabezado, ...lineas].join("\n"),
  }
}

/**
 * El texto que se le pasa al analizador de mensajes de turno.
 *
 * Se arma con los campos de la extracción en un orden que se lee como el
 * mensaje que una clínica manda, porque eso es exactamente lo que el analizador
 * fue entrenado a leer (`lib/gemini/prompt-turno.ts`). El grueso lo aporta
 * `texto_completo`, que para `turno_o_cita` viene con la TRANSCRIPCIÓN LITERAL
 * de la foto (regla 9 de `lib/gemini/prompt-documento.ts`) — ahí están las
 * fechas, las horas y las direcciones de todos los turnos de la captura.
 *
 * Los otros campos se suman como contexto y nunca lo reemplazan: si la captura
 * traía dos turnos, el segundo vive SOLO en `texto_completo`, así que un texto
 * armado a partir de `titulo`/`fecha`/`institucion` perdería uno de los dos.
 */
export function textoParaAnalizador(extraccion: DocumentoMedicoExtraido): string {
  const partes = [
    lineaSiHay("Institución", extraccion.institucion),
    lineaSiHay("Profesional", extraccion.medico),
    lineaSiHay("Especialidad", extraccion.especialidad),
    lineaSiHay("Fecha", extraccion.fecha),
    (extraccion.texto_completo ?? "").trim(),
    extraccion.resumen.trim(),
  ].filter((parte): parte is string => typeof parte === "string" && parte.length > 0)

  return partes.join("\n")
}
