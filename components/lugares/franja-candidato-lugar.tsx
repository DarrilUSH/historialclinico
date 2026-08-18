"use client"

/**
 * Franja "¿Es este?" bajo el campo Lugar (cruces inteligentes, agosto 2026):
 * cuando la IA precargó `lugarNombre`/institución a partir de un mensaje o un
 * documento, cruza ese texto contra el catálogo REFES
 * (`app/(app)/(con-nav)/lugares/actions.ts#candidatosLugarAction` →
 * `lib/lugares/candidatos.ts`) y ofrece completar el lugar con el registro
 * oficial -nombre, dirección y coordenadas incluidas- de un solo toque.
 *
 * Reusada por `components/turnos/formulario-turno.tsx` (bajo "Lugar", campo
 * `CampoLugar`) y por `components/documentos/formulario-revision.tsx` (bajo
 * "Institución", que en un documento no tiene dirección/ciudad/provincia
 * propias -`onUsar` ahí solo toma `centro.nombre`-).
 *
 * ## SIEMPRE sugerencia, nunca automático
 *
 * Este componente NUNCA llama a `onUsar` por sí mismo: solo lo hace la
 * persona, tocando "Usar este". Sin coincidencia clara (`resultado.tipo ===
 * "ninguno"`), no se renderiza nada -ni un cartel de "no encontramos nada",
 * que sería ruido para el caso más común (un lugar que no está en el
 * catálogo, o directamente no hace falta cruzar nada)-.
 *
 * ## "No" recuerda la decisión durante esta edición, nunca globalmente
 *
 * `descartados` es un `Set` guardado en un `ref`: sobrevive re-renders de
 * este componente pero se pierde al desmontar el formulario (recargar la
 * página, navegar a otro lado). Ni médicos con `localStorage` ni una columna
 * en la base -es una preferencia de ESTA edición, no una configuración
 * persistente-.
 */

import * as React from "react"

import { XIcon } from "lucide-react"

import { candidatosLugarAction } from "@/app/(app)/(con-nav)/lugares/actions"
import { Boton } from "@/components/base/boton"
import type { LugarExtraidoParaCotejo, ResultadoCandidatosLugar } from "@/lib/lugares/candidatos"
import { descripcionDeSugerencia, type CentroSugerido } from "@/lib/lugares/sugerencias"

export interface FranjaCandidatoLugarProps {
  /**
   * Lo que la IA extrajo para este lugar en la ÚLTIMA precarga aplicada.
   * `null` = nada que cotejar todavía (no se renderiza nada). Cambiar el
   * VALOR (no solo la identidad del objeto) dispara una nueva búsqueda.
   */
  extraido: LugarExtraidoParaCotejo | null
  /** La persona tocó "Usar este" (o uno de la lista) sobre `centro`. */
  onUsar: (centro: CentroSugerido) => void
}

function clavePara(extraido: LugarExtraidoParaCotejo): string {
  return [extraido.nombre, extraido.direccion, extraido.ciudad, extraido.provincia]
    .map((parte) => (parte ?? "").trim().toLocaleLowerCase("es-AR"))
    .join("|")
}

export function FranjaCandidatoLugar({ extraido, onUsar }: FranjaCandidatoLugarProps) {
  const [resultado, setResultado] = React.useState<ResultadoCandidatosLugar | null>(null)
  const [descartados, setDescartados] = React.useState<ReadonlySet<string>>(() => new Set())
  const consultada = React.useRef<string | null>(null)

  const clave = extraido ? clavePara(extraido) : null

  // Si `clave` cambió desde el último render, el `resultado` que hay en
  // estado es de la búsqueda ANTERIOR: se limpia acá, sincrónicamente durante
  // el render, para no mostrar -ni por el instante que tarda la consulta
  // nueva- una coincidencia que ya no corresponde al texto actual. Ajuste
  // durante el render y no en un efecto -mismo patrón, y mismo motivo, que
  // `components/lugares/campo-lugar.tsx`-.
  const [claveMostrada, setClaveMostrada] = React.useState(clave)
  if (clave !== claveMostrada) {
    setClaveMostrada(clave)
    setResultado(null)
  }

  React.useEffect(() => {
    if (!extraido || !clave) return
    if (consultada.current === clave) return
    consultada.current = clave

    let cancelado = false
    void candidatosLugarAction(extraido).then((valor) => {
      if (!cancelado) setResultado(valor)
    })

    return () => {
      cancelado = true
    }
    // `extraido` es un objeto nuevo en cada render del padre; `clave` -sus
    // valores efectivos- es la dependencia real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  if (!clave || !resultado || resultado.tipo === "ninguno") return null
  if (descartados.has(clave)) return null

  function descartar() {
    if (clave) setDescartados((previo) => new Set(previo).add(clave))
  }

  const centros = resultado.tipo === "uno" ? [resultado.centro] : resultado.centros

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 chica:px-2.5 chica:py-1.5">
      <p className="text-sm font-medium text-foreground chica:text-xs">
        {resultado.tipo === "uno" ? "¿Es este el lugar, según el listado oficial?" : "¿Es alguno de estos?"}
      </p>
      <ul className="flex flex-col gap-1.5">
        {centros.map((centro) => (
          <li
            key={centro.refesId}
            className="flex flex-wrap items-center justify-between gap-2 text-sm chica:text-xs"
          >
            <span className="min-w-0 flex-1">
              <span className="font-semibold text-foreground">{centro.nombre}</span>
              {descripcionDeSugerencia(centro) && (
                <span className="text-muted-foreground"> — {descripcionDeSugerencia(centro)}</span>
              )}
            </span>
            <Boton type="button" size="sm" className="shrink-0" onClick={() => onUsar(centro)}>
              Usar este
            </Boton>
          </li>
        ))}
      </ul>
      <Boton
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit self-end"
        onClick={descartar}
      >
        <XIcon aria-hidden="true" />
        No
      </Boton>
    </div>
  )
}
