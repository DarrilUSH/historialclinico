"use client"

/**
 * Campo "Lugar" del formulario de turno, con autocompletar contra el catálogo
 * REFES (Sprint 16, tarea 16.3).
 *
 * Mismo contrato Senior UX que `campo-texto.tsx` y
 * `components/base/campo-autocompletar.tsx` -etiqueta siempre visible, ayuda
 * debajo, texto libre SIEMPRE válido-, pero con dos diferencias que obligan a
 * un componente propio en vez de reusar `CampoAutocompletar`:
 *
 * 1. **Las sugerencias no son una lista fija en memoria.** El catálogo tiene
 *    36.046 centros: no se le pueden mandar al navegador como se le manda el
 *    catálogo de 80 especialidades de la tarea 16.2. Cada tecleo consulta la
 *    base con una Server Action, con antirrebote.
 * 2. **Elegir una sugerencia no completa un campo, completa CINCO.** Nombre,
 *    dirección, ciudad, provincia y las coordenadas del registro oficial
 *    (`lib/lugares/sugerencias.ts#precargaDesdeCentro`, que documenta por qué
 *    acá sí se pisa lo que había). Un `CampoAutocompletar` de un solo valor
 *    de texto no puede expresar eso.
 *
 * ## Antirrebote de 300 ms, y las respuestas fuera de orden
 *
 * Sin antirrebote, escribir "hospital" son ocho consultas a la base. Con 300
 * ms, una. Y como una respuesta lenta de una consulta vieja puede llegar
 * DESPUÉS de una rápida de la consulta nueva, cada búsqueda lleva un número
 * de secuencia y se descarta si ya hay una más nueva contestada: sin eso, el
 * desplegable se llenaría con los resultados de "hos" justo después de haber
 * mostrado los de "hospital".
 *
 * ## Si el catálogo está vacío, este componente no se usa
 *
 * `components/turnos/formulario-turno.tsx` renderiza el `CampoTexto` de
 * siempre cuando nunca se sincronizó el catálogo. No se le ofrece a la
 * persona un buscador que no puede encontrar nada, ni se le explica que le
 * falta hacer algo: el campo simplemente sigue siendo lo que era.
 */

import * as React from "react"

import { buscarLugaresAction } from "@/app/(app)/(con-nav)/lugares/actions"
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@/components/ui/autocomplete"
import { Label } from "@/components/ui/label"
import { centroCoincide } from "@/lib/lugares/coincidencias"
import { descripcionDeSugerencia, type CentroSugerido } from "@/lib/lugares/sugerencias"
import { cn } from "@/lib/utils"

/** Milisegundos de quietud del teclado antes de consultar. */
const ANTIRREBOTE_MS = 300

export interface CampoLugarProps {
  id: string
  label: string
  value: string
  onChange: (valor: string) => void
  /** Se dispara al elegir un centro del catálogo (clic o Enter sobre la sugerencia resaltada). */
  onElegirCentro: (centro: CentroSugerido) => void
  ayuda?: string
  maxLength?: number
  placeholder?: string
}

export function CampoLugar({
  id,
  label,
  value,
  onChange,
  onElegirCentro,
  ayuda,
  maxLength,
  placeholder,
}: CampoLugarProps) {
  const [sugerencias, setSugerencias] = React.useState<CentroSugerido[]>([])
  const [buscando, setBuscando] = React.useState(false)

  // Número de secuencia de la última búsqueda LANZADA y de la última
  // APLICADA: descarta respuestas que llegan tarde (ver el encabezado).
  const secuencia = React.useRef(0)
  const ultimaAplicada = React.useRef(0)

  // Ajuste SINCRÓNICO durante el render cuando cambia `value`, no en un
  // efecto: "hay una búsqueda pendiente" y "las sugerencias viejas ya no
  // valen" se deducen del texto tecleado sin esperar a nada asincrónico, y
  // hacerlo en un efecto dispara un render extra que el linter de reglas de
  // hooks del proyecto (`react-hooks/set-state-in-effect`) marca. Es el mismo
  // patrón, y por el mismo motivo, que `components/base/velo-espera.tsx` y
  // `components/navegacion/boton-tamano.tsx`
  // (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [valorPrevio, setValorPrevio] = React.useState(value)
  if (value !== valorPrevio) {
    setValorPrevio(value)
    if (value.trim().length < 3) {
      setSugerencias([])
      setBuscando(false)
    } else {
      setBuscando(true)
    }
  }

  // El efecto se queda solo con lo que SÍ es asincrónico: el temporizador del
  // antirrebote y la consulta al servidor.
  React.useEffect(() => {
    const texto = value.trim()

    if (texto.length < 3) return

    const mio = (secuencia.current += 1)

    const temporizador = window.setTimeout(() => {
      void buscarLugaresAction(texto)
        .then((resultados) => {
          if (mio < ultimaAplicada.current) return
          ultimaAplicada.current = mio
          setSugerencias(resultados)
        })
        .catch(() => {
          // La acción ya devuelve `[]` ante cualquier fallo; esto cubre un
          // corte de red del propio POST. Sin sugerencias, el campo sigue
          // siendo un campo de texto común: no hay nada que avisarle a nadie.
          if (mio < ultimaAplicada.current) return
          ultimaAplicada.current = mio
          setSugerencias([])
        })
        .finally(() => {
          if (mio >= ultimaAplicada.current) setBuscando(false)
        })
    }, ANTIRREBOTE_MS)

    return () => window.clearTimeout(temporizador)
  }, [value])

  const idAyuda = ayuda ? `${id}-ayuda` : undefined

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>

      <Autocomplete
        items={sugerencias}
        value={value}
        onValueChange={(valor) => onChange(String(valor ?? ""))}
        itemToStringValue={(centro: CentroSugerido) => centro.nombre}
        // El servidor ya filtró con el mismo criterio (ver
        // `lib/lugares/coincidencias.ts`); este filtro solo evita el parpadeo
        // de mostrar las sugerencias de lo tecleado hace 300 ms mientras la
        // consulta nueva viaja.
        filter={(centro: CentroSugerido, consulta: string) =>
          centroCoincide(
            [centro.nombre, centro.localidad, centro.departamento, centro.provincia ?? centro.provinciaRefes]
              .filter(Boolean)
              .join(" "),
            consulta,
          )
        }
        openOnInputClick
      >
        <AutocompleteInputGroup>
          <AutocompleteInput
            id={id}
            name={id}
            maxLength={maxLength}
            placeholder={placeholder}
            autoComplete="off"
            className={cn(value.length > 0 && "pr-11")}
            aria-describedby={idAyuda}
          />
          {value.length > 0 && <AutocompleteClear />}
        </AutocompleteInputGroup>

        <AutocompletePopup>
          <AutocompleteEmpty>
            {buscando
              ? "Buscando en el catálogo…"
              : "Sin coincidencias en el catálogo — se guarda lo que escribiste."}
          </AutocompleteEmpty>
          <AutocompleteList>
            {(centro: CentroSugerido) => (
              <AutocompleteItem
                key={centro.refesId}
                value={centro}
                // `onClick` y no el `onValueChange` de la raíz: ese solo
                // entrega el TEXTO elegido, y dos centros pueden llamarse
                // igual en dos ciudades distintas -"CENTRO MEDICO SAN
                // FRANCISCO" existe cinco veces en el registro-, así que
                // buscar el objeto por su nombre elegiría el equivocado.
                // `@base-ui/react` simula un clic sobre el ítem resaltado al
                // apretar Enter, así que este manejador cubre por igual el
                // toque y el teclado (mismo apoyo que documenta
                // `components/medicos/formulario-medico.tsx`).
                onClick={() => onElegirCentro(centro)}
                className="flex-col items-start gap-0.5 py-2"
              >
                <span className="text-base font-medium text-foreground">{centro.nombre}</span>
                {descripcionDeSugerencia(centro) && (
                  <span className="text-sm text-muted-foreground">
                    {descripcionDeSugerencia(centro)}
                  </span>
                )}
              </AutocompleteItem>
            )}
          </AutocompleteList>
        </AutocompletePopup>
      </Autocomplete>

      {ayuda && (
        <p id={idAyuda} className="text-sm text-muted-foreground">
          {ayuda}
        </p>
      )}
    </div>
  )
}
