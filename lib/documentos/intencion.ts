/**
 * La INTENCIÓN de un documento, leída sin sorpresas (Sprint 20 — "una foto, el
 * lugar correcto").
 *
 * Lógica pura, sin React y sin red: la usan la pantalla de revisión
 * (`components/documentos/banner-ruteo-documento.tsx`), las dos pantallas de
 * destino (`/medicacion/nuevo`, `/turnos/nuevo`) y la compuerta de auto-carga
 * de Gmail (`lib/gmail/auto-ingesta.ts`). La ejercita
 * `tests/unit/documento-intencion.test.ts`.
 *
 * ## Por qué existe este archivo y no se lee `extraccion.intencion` a pelo
 *
 * Porque `intencion` puede NO estar, y el código que la consume no debería
 * tener que acordarse de eso en cada punto de uso. Falta en dos situaciones
 * reales, las dos esperables:
 *
 * 1. **Extracciones anteriores al Sprint 20.** El día del deploy puede haber
 *    documentos subidos y todavía sin confirmar, con su `ai_extraction` ya
 *    escrito por el contrato viejo.
 * 2. **Un modelo que omite un campo pedido.** Pasa, y el resto del pipeline ya
 *    está construido asumiendo que puede pasar (`titulo`, `paciente`).
 *
 * En los dos casos la respuesta correcta es la misma y es la conservadora:
 * `"estudio_realizado"`, es decir, **exactamente el comportamiento que la app
 * tenía antes de que el clasificador existiera**. Nadie ve un cartel de ruteo
 * por un campo que no vino.
 */

import type {
  DocumentoMedicoExtraido,
  IntencionDocumentoExtraida,
  MedicamentoExtraido,
} from "@/lib/gemini/schemas"

/** Las cinco intenciones, en el mismo orden que el enum del `responseSchema`. */
export const INTENCIONES_DOCUMENTO = [
  "estudio_realizado",
  "receta_o_medicacion",
  "turno_o_cita",
  "orden_de_practica",
  "otro",
] as const satisfies readonly IntencionDocumentoExtraida[]

/**
 * La intención por defecto: el camino de siempre, el que ya pasa por revisión
 * humana. Ver el encabezado para por qué el default es este y no `"otro"`.
 */
export const INTENCION_POR_DEFECTO: IntencionDocumentoExtraida = "estudio_realizado"

function esIntencionConocida(valor: unknown): valor is IntencionDocumentoExtraida {
  return (
    typeof valor === "string" &&
    (INTENCIONES_DOCUMENTO as readonly string[]).includes(valor)
  )
}

/**
 * La intención de una extracción, siempre. Sin extracción, con el campo
 * ausente, o con un valor que no reconocemos: `"estudio_realizado"`.
 *
 * El caso "valor que no reconocemos" es defensivo y no debería ocurrir -Zod
 * rechaza un enum fuera de la lista antes de que esto se ejecute-, pero este
 * archivo también lee jsonb que ya estaban en la base, y ahí no hay ningún Zod
 * de por medio.
 */
export function intencionDeExtraccion(
  extraccion: Pick<DocumentoMedicoExtraido, "intencion"> | null | undefined,
): IntencionDocumentoExtraida {
  const cruda = extraccion?.intencion
  return esIntencionConocida(cruda) ? cruda : INTENCION_POR_DEFECTO
}

/**
 * Los medicamentos de una extracción, siempre como lista. Ausente = lista
 * vacía, igual que `metricas` cuando el documento no es de laboratorio.
 */
export function medicamentosDeExtraccion(
  extraccion: Pick<DocumentoMedicoExtraido, "medicamentos"> | null | undefined,
): MedicamentoExtraido[] {
  return extraccion?.medicamentos ?? []
}

/**
 * ¿Esta intención dice que el papel NO es un estudio realizado?
 *
 * `"otro"` cuenta como que NO se pudo clasificar, así que se comporta igual que
 * `"estudio_realizado"` a los fines del ruteo: no hay adónde derivar un
 * presupuesto ni un carnet. Lo que separa es "esto tiene otro destino", no
 * "esto no es un estudio".
 */
export function tieneDestinoPropio(intencion: IntencionDocumentoExtraida): boolean {
  return (
    intencion === "receta_o_medicacion" ||
    intencion === "turno_o_cita" ||
    intencion === "orden_de_practica"
  )
}
