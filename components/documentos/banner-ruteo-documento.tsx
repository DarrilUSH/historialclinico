"use client"

/**
 * El cartel de ruteo de la pantalla de revisión (Sprint 20 — "una foto, el
 * lugar correcto"): *"esto parece una lista de medicamentos"*, *"esto parece un
 * turno"*, *"esto es un pedido de estudio a realizar"*.
 *
 * ## Qué decide y qué NO decide este componente
 *
 * NADA. Qué cartel corresponde, con qué palabras y hacia dónde lo resuelve
 * `ofrecerRuteo` (`lib/documentos/ruteo.ts`), que es puro y se prueba sin DOM —
 * mismo reparto que `describirLoteDePropuestas` con la lista de turnos. Acá
 * solo se pinta, y se lleva la única cosa que sí es de pantalla: qué
 * medicamentos quedaron marcados.
 *
 * ## Se ofrece arriba, no se bloquea abajo
 *
 * El cartel va ENCIMA del formulario de revisión, que sigue entero y editable.
 * Si la persona lo ignora y toca "Confirmar y guardar", el papel entra al
 * historial como cualquier documento, exactamente como antes de este sprint. La
 * regla de oro del flujo de ingesta no se toca: **la IA nunca guarda sola**, y
 * ahora tampoco decide sola adónde va.
 *
 * ## La lista de medicamentos: el mismo patrón mental que el lote de turnos
 *
 * El caso real es un papelito manuscrito con tres renglones (COVERAM 5/5,
 * LIPOMAX 105, ROSUVASTATINA 10). Se muestran los tres con su casilla, todas
 * marcadas, y se desmarca lo que sobre — calcado de
 * `components/turnos/analizador-mensaje-turno.tsx`, porque es la misma pregunta
 * ("encontré varios, ¿cuáles querés?") y no hay ninguna razón para que se vea
 * distinta.
 *
 * Debajo de cada uno se dice, sin vueltas, LO QUE EL PAPEL NO DICE
 * (`avisosDelMedicamento`). No es un detalle: la persona tiene que saber, antes
 * de tocar el botón, que la dosis la va a poner ella. Un formulario que
 * aparece medio vacío sin haberlo anunciado se lee como un error de la
 * aplicación, no como una decisión de seguridad.
 */

import * as React from "react"
import Link from "next/link"

import { CalendarPlusIcon, PillIcon, TriangleAlertIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { hrefRuteo, type OfertaRuteo } from "@/lib/documentos/ruteo"
import { avisosDelMedicamento, resumenMedicamento } from "@/lib/medicacion/desde-documento"
import type { MedicamentoExtraido } from "@/lib/gemini/schemas"

export interface BannerRuteoDocumentoProps {
  documentoId: string
  /** El cartel a mostrar, ya resuelto por `ofrecerRuteo`. */
  oferta: OfertaRuteo
  /** Los medicamentos leídos. Solo se usan cuando el destino es Medicación; en los demás casos llega vacío. */
  medicamentos: readonly MedicamentoExtraido[]
}

const ID_LISTA_MEDICAMENTOS = "ruteo-medicamentos"

export function BannerRuteoDocumento({
  documentoId,
  oferta,
  medicamentos,
}: BannerRuteoDocumentoProps) {
  const conLista = oferta.destino === "medicacion" && medicamentos.length > 0

  const [marcados, setMarcados] = React.useState<boolean[]>(() =>
    medicamentos.map(() => true),
  )

  function alternar(indice: number) {
    setMarcados((previos) => previos.map((marcado, i) => (i === indice ? !marcado : marcado)))
  }

  const indicesMarcados = marcados.flatMap((marcado, indice) => (marcado ? [indice] : []))
  const cantidadMarcados = indicesMarcados.length
  const Icono = oferta.destino === "medicacion" ? PillIcon : CalendarPlusIcon

  // `fecha_futura` es una advertencia real -algo no cierra en lo que se leyó-;
  // una intención detectada es información, no un problema. `estatica` en los
  // dos casos: el cartel está en pantalla desde que carga la revisión, y un
  // `role="alert"` en cada carga interrumpe al lector de pantalla sin motivo
  // (mismo criterio que el aviso de título repetido).
  const variante = oferta.motivo === "fecha_futura" ? "advertencia" : "info"

  return (
    <section
      aria-label="Sugerencia de dónde guardar este documento"
      className="flex flex-col gap-3"
    >
      <Alerta variante={variante} estatica titulo={oferta.titulo}>
        {oferta.cuerpo}
      </Alerta>

      {conLista && (
        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-base font-medium text-foreground chica:text-sm">
            Elegí cuáles cargar
          </legend>

          <ul id={ID_LISTA_MEDICAMENTOS} className="flex flex-col gap-1">
            {medicamentos.map((medicamento, indice) => {
              const avisos = avisosDelMedicamento(medicamento)
              return (
                <li key={`${medicamento.nombre}-${indice}`}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted chica:gap-2">
                    <input
                      type="checkbox"
                      checked={marcados[indice] ?? false}
                      onChange={() => alternar(indice)}
                      className="mt-1 size-6 shrink-0 cursor-pointer accent-primary chica:size-5"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-base font-medium text-foreground chica:text-sm">
                        {resumenMedicamento(medicamento)}
                      </span>
                      {medicamento.dosis_texto.trim().length > 0 && (
                        <span className="text-sm text-muted-foreground chica:text-xs">
                          Dosis: {medicamento.dosis_texto}
                        </span>
                      )}
                      {medicamento.frecuencia_texto.trim().length > 0 && (
                        <span className="text-sm text-muted-foreground chica:text-xs">
                          Frecuencia: {medicamento.frecuencia_texto}
                        </span>
                      )}
                      {avisos.map((aviso) => (
                        <span
                          key={aviso}
                          className="flex items-center gap-1.5 text-sm text-advertencia-fuerte chica:text-xs"
                        >
                          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
                          {aviso}
                        </span>
                      ))}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </fieldset>
      )}

      {/* Sin ninguno marcado no hay nada que precargar: se muestra un botón
          DESHABILITADO de verdad y no un enlace con `aria-disabled`, que sigue
          siendo navegable con el teclado y llevaría a un formulario vacío que
          no explicaría por qué está vacío. */}
      {conLista && cantidadMarcados === 0 ? (
        <Boton type="button" size="lg" variant="outline" disabled className="w-full sm:w-fit">
          <Icono aria-hidden="true" />
          {oferta.textoBoton}
        </Boton>
      ) : (
        <Boton
          render={
            <Link href={hrefRuteo(oferta, documentoId, conLista ? indicesMarcados : [])} />
          }
          nativeButton={false}
          size="lg"
          variant="outline"
          className="w-full sm:w-fit"
        >
          <Icono aria-hidden="true" />
          {conLista && cantidadMarcados !== medicamentos.length
            ? `${oferta.textoBoton} (${cantidadMarcados})`
            : oferta.textoBoton}
        </Boton>
      )}

      <p className="text-sm text-muted-foreground">
        Si no, seguí abajo y guardalo como un documento más de tu historial.
      </p>
    </section>
  )
}
