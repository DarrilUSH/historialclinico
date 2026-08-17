"use client"

/**
 * Banner PERSISTENTE de alertas de signos vitales (Sprint 9, tarea 9.3 —
 * ROADMAP_SPRINTS.md). El criterio de aceptación es literal: *"el banner
 * queda hasta que se lo marca visto y eso se registra con usuario y hora"*.
 *
 * ## Qué muestra y de dónde sale
 *
 * Una fila por alerta SIN VER (`vital_sign_alerts.acknowledged_at is null`,
 * `lib/signos/alertas-sin-ver.ts`), con `mensaje` -el texto que ya redactó
 * `lib/signos/evaluar.ts`, con el descargo clínico incluido- tal cual se
 * guardó. No es el texto del push (`lib/signos/notificar.ts` arma uno
 * agrupado y más corto, pensado para una notificación); acá SÍ interesa el
 * detalle regla por regla, porque quien mira el banner ya está en la pantalla
 * y puede leer tranquilo.
 *
 * ## Por qué es `estatica`
 *
 * Mismo criterio que `components/medicacion/banner-renovacion.tsx`: un aviso
 * que está SIEMPRE en pantalla mientras haya algo sin ver no puede llevar
 * `role="alert"` -interrumpiría a un lector de pantalla en cada carga de
 * página, spam que no aporta nada-. La urgencia real ya la resolvió el push
 * que sonó hace segundos; este banner es la red de contención para quien no
 * lo vio (o lo silenció), no una alarma nueva.
 *
 * ## "Ya lo vi" por alerta, y "Marcar todas" desde la segunda
 *
 * El artefacto nombrado por el ROADMAP es una sola Server Action,
 * `marcarAlertaVista(alertaId)` -un `UPDATE` de una fila-, así que cada
 * alerta tiene SIEMPRE su propio botón (mismo patrón de
 * `components/medicacion/registro-toma.tsx#FilaToma`: un `useActionState`
 * por fila, para que el error de una no tape el estado de las demás). Con dos
 * o más alertas sin ver se agrega además "Marcar todas como vistas": llama a
 * la MISMA acción una vez por `id`, en secuencia, desde el cliente -no hay
 * una segunda Server Action de borrado masivo-, porque la decisión de
 * producto (Senior UX) es que alguien con la tensión Y el peso fuera de
 * rango en la misma pantalla no debería tener que tocar "Ya lo vi" dos veces
 * para una situación que ya miró entera. Con una sola alerta el botón
 * bulk no aporta nada y no se muestra.
 *
 * ## Chica (Sprint 14, tanda A): fila densa, SIN truncar el mensaje
 *
 * Cada `<li>` pasa de columna a fila -mensaje a la izquierda, "Ya lo vi"
 * compacto a la derecha (`items-start`: el botón queda arriba, no centrado
 * contra un mensaje de varias líneas)-, con menos aire alrededor.
 *
 * El encargo original de esta tanda pedía además truncar el mensaje a 2
 * líneas. Se descarta a propósito: `alerta.mensaje` es texto clínico
 * (`lib/signos/evaluar.ts#DESCARGO_CLINICO` incluido, "Presión sistólica
 * alta: 170 mmHg (umbral de alerta: 160). Valor orientativo — no reemplaza
 * el criterio médico." → 3-4 líneas reales a 14px), y docs/densidad.md §4
 * regla 5 ("la densidad no saca contenido") junto con la regla explícita del
 * encargo de esta misma tanda ("información clínica nunca se oculta") pesan
 * más que la cifra "2 líneas". Truncar CUALQUIER cantidad de líneas de este
 * mensaje con `line-clamp` sería esconder, no reorganizar -literalmente lo
 * que ese comentario de más arriba ("NUNCA se recorta -ni `truncate` ni
 * `line-clamp`- en ningún modo") ya decía antes de esta tanda-. Lo que se
 * aprieta en chica sigue siendo el aire alrededor, nunca el texto.
 */

import { useActionState, useTransition } from "react"

import { marcarAlertaVista, type EstadoSignoAccion } from "@/app/(app)/(con-nav)/signos/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import type { AlertaSinVer } from "@/lib/signos/alertas-sin-ver"

const ESTADO_INICIAL: EstadoSignoAccion = { error: null }

export function BannerAlertasSignos({
  alertas,
  className,
}: {
  alertas: AlertaSinVer[]
  /**
   * `/signos` (`components/medicacion/banner-renovacion.tsx` en su gemelo de
   * medicación) vive en un contenedor sin `items-center`, así que el banner
   * ya estira al 100% por default de flexbox y no necesita nada acá. `/inicio`
   * SÍ centra sus hijos (`items-center`) y les fija `max-w-sm` uno por uno
   * -mismas cards de "Medicación", "Coberturas", etc.-, así que le pasa
   * `className="w-full max-w-sm"` para no desentonar con el resto de la
   * pantalla.
   */
  className?: string
}) {
  if (alertas.length === 0) {
    return null
  }

  const esUna = alertas.length === 1

  return (
    <Alerta
      variante="advertencia"
      titulo={esUna ? "Hay una alerta de signos vitales sin ver" : `Hay ${alertas.length} alertas de signos vitales sin ver`}
      estatica
      className={className}
    >
      <ul className="mt-2 flex flex-col gap-3 chica:mt-1.5 chica:gap-2">
        {alertas.map((alerta) => (
          <FilaAlerta key={alerta.id} alerta={alerta} />
        ))}
      </ul>
      {!esUna && (
        <div className="mt-3 chica:mt-2">
          <BotonMarcarTodas ids={alertas.map((alerta) => alerta.id)} />
        </div>
      )}
    </Alerta>
  )
}

function FilaAlerta({ alerta }: { alerta: AlertaSinVer }) {
  const [estado, enviar, pendiente] = useActionState(marcarAlertaVista, ESTADO_INICIAL)

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-advertencia/30 bg-background/60 p-3 chica:flex-row chica:flex-wrap chica:items-start chica:justify-between chica:gap-2 chica:p-2">
      {/* El mensaje clínico NUNCA se recorta -ni `truncate` ni `line-clamp`-
          en ningún modo: docs/densidad.md §4 regla 5 (ver el comentario de
          cabecera del archivo, sección Sprint 14). Lo que se aprieta en
          chica es el aire alrededor y el eje (fila en vez de columna), no el
          texto: envuelve las líneas que necesite. */}
      {/* `/inicio` centra todo su contenido (`text-center` en el contenedor
          raíz de `app/(app)/(con-nav)/inicio/page.tsx`), correcto para la
          columna apilada de grande. En la fila de chica un párrafo de varias
          líneas centrado contra un botón a la derecha queda irregular y
          difícil de barrer con la vista -`chica:text-left` lo corrige sin
          tocar la alineación de grande. */}
      <p className="chica:min-w-0 chica:flex-1 chica:text-left">{alerta.mensaje}</p>
      {estado.error && (
        <Alerta variante="error" className="text-sm chica:basis-full">
          {estado.error}
        </Alerta>
      )}
      <form action={enviar} className="chica:shrink-0">
        <input type="hidden" name="alertaId" value={alerta.id} />
        <Boton
          type="submit"
          variant="outline"
          size="sm"
          cargando={pendiente}
          className="chica:px-2.5 chica:text-xs"
        >
          Ya lo vi
        </Boton>
      </form>
    </li>
  )
}

/**
 * Marca TODAS las alertas sin ver pasadas por `ids` invocando
 * `marcarAlertaVista` una vez por cada una, en secuencia -no hay Server
 * Action de borrado masivo, ver el encabezado del archivo-. `useTransition`
 * y no `useActionState` porque este botón no envía un `<form>` propio: dispara
 * varias llamadas a la misma acción una tras otra.
 */
function BotonMarcarTodas({ ids }: { ids: string[] }) {
  const [pendiente, iniciarTransicion] = useTransition()

  function manejarClick() {
    iniciarTransicion(async () => {
      for (const id of ids) {
        const formData = new FormData()
        formData.set("alertaId", id)
        // Los errores individuales ya se ven en la fila propia si el usuario
        // vuelve a tocar "Ya lo vi" de a una; acá se ignoran a propósito para
        // que una alerta que falla (por ejemplo, el permiso se perdió a mitad
        // de camino) no corte el loop y deje sin marcar el resto.
        await marcarAlertaVista(ESTADO_INICIAL, formData)
      }
    })
  }

  return (
    <Boton type="button" variant="outline" size="sm" cargando={pendiente} onClick={manejarClick}>
      Marcar todas como vistas
    </Boton>
  )
}
