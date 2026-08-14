/**
 * Banner de renovación de receta (Sprint 7, tarea 7.4). El aviso **agregado**
 * que va arriba del listado de `/medicacion` cuando hay al menos una medicación
 * con `necesita_renovacion`.
 *
 * ## Por qué existe si la tarjeta ya avisa
 *
 * La tarea 7.2 ya pinta la caja de stock de cada tarjeta y agrega el renglón
 * "Quedan pocos días — conviene pedir la renovación de la receta"
 * (`components/medicacion/tarjeta-medicacion.tsx`). Eso resuelve *"¿cómo está
 * esta medicación?"* pero no *"¿tengo algo que hacer hoy?"*: con cinco
 * medicaciones cargadas hay que recorrer cinco tarjetas —desplazándose— para
 * responderlo, y la que necesita receta puede ser la última.
 *
 * El banner responde esa segunda pregunta de una sola mirada, arriba del todo y
 * sin desplazamiento. **No duplica el aviso de la tarjeta**: no repite su texto
 * ni su ícono de stock; enumera *cuáles* son y linkea a cada una. La tarjeta
 * sigue siendo la que explica el detalle (unidades, fecha estimada de fin,
 * acceso a la receta).
 *
 * ## Por qué el link es un ancla y no una ruta
 *
 * `/medicacion/{id}` no existe: el módulo tiene `page.tsx`, `nuevo/` y
 * `[id]/editar/`. Mandar a la pantalla de edición a alguien que solo quiere ver
 * cuánto queda es peor que no linkear. El ancla lleva a la tarjeta de esa
 * medicación **dentro de esta misma pantalla**, que es donde está toda la
 * información y los botones que correspondan según el permiso.
 *
 * ## El tono
 *
 * "Conviene pedir la renovación", no "¡Atención!" ni "Urgente". Quedan días —
 * ese es el punto entero de que la alerta sea *preventiva*— y una app que le
 * grita a una persona mayor por algo que puede resolver mañana es una app que
 * se termina silenciando. El color de advertencia y el ícono van juntos, nunca
 * el color solo (`docs/design-system.md` §8, regla 2), y eso lo garantiza el
 * componente `Alerta`.
 */

import Link from "next/link"

import { Alerta } from "@/components/base/alerta"
import { fraseDeStockRestante } from "@/lib/medicacion/alertas"

/** Lo mínimo que el banner necesita de cada fila de `v_medicacion_estado`. */
export interface MedicacionEnRenovacion {
  medicationId: string
  nombre: string
  diasRestantes: number
}

/**
 * Id del ancla de la tarjeta de una medicación en `/medicacion`.
 *
 * Vive acá —y no suelto en la página— para que el destino del link y el `id`
 * del `<li>` no puedan separarse: un ancla rota no falla en ningún test, solo
 * no hace nada cuando alguien la toca.
 */
export function anclaDeMedicacion(medicationId: string): string {
  return `medicacion-${medicationId}`
}

export function BannerRenovacion({
  medicaciones,
}: {
  medicaciones: MedicacionEnRenovacion[]
}) {
  if (medicaciones.length === 0) {
    return null
  }

  const esUna = medicaciones.length === 1

  return (
    <Alerta
      variante="advertencia"
      titulo={esUna ? "Conviene renovar la receta" : "Conviene renovar las recetas"}
      // `estatica`: el banner está en pantalla cada vez que se entra a
      // /medicacion con stock bajo. Sin esto, un lector de pantalla lo
      // anunciaría interrumpiendo en cada carga de página.
      estatica
    >
      <p>
        {esUna
          ? "Esta medicación tiene menos de 5 días de stock:"
          : `Estas ${medicaciones.length} medicaciones tienen menos de 5 días de stock:`}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5 chica:gap-1">
        {medicaciones.map((medicacion) => (
          <li key={medicacion.medicationId}>
            <Link
              href={`#${anclaDeMedicacion(medicacion.medicationId)}`}
              className="rounded-sm underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            >
              {medicacion.nombre}
            </Link>{" "}
            — {fraseDeStockRestante(medicacion.diasRestantes)}
          </li>
        ))}
      </ul>
    </Alerta>
  )
}
