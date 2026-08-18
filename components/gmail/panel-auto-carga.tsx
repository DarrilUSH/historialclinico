"use client"

/**
 * El interruptor de la carga automática (Sprint 17).
 *
 * ## Lo que esta pantalla tiene que lograr, antes que verse bien
 *
 * Que la persona entienda, ANTES de prenderlo, que está autorizando a que algo
 * entre a un historial médico sin que ella lo mire. Por eso:
 *
 * - **Arranca apagado**, siempre, y no hay ningún "recomendado" ni ninguna
 *   sugerencia de prenderlo. Es una decisión de la persona, no un default con
 *   el que la app la empuja.
 * - **El perfil de destino se elige en el mismo gesto.** No hay forma de
 *   prenderlo "y después vemos a quién": el botón de guardar no acepta el
 *   encendido sin destino, y la base tampoco.
 * - **Dice qué significa "sin dudas" con ejemplos**, no con la palabra
 *   "criterios". La lista de abajo es literalmente lo que hace la compuerta.
 * - **Dice que se puede deshacer**, en el mismo bloque donde se prende. Que la
 *   salida esté a la vista antes de entrar es lo que hace que la decisión sea
 *   reversible de verdad y no solo en teoría.
 *
 * ## Un `<select>` nativo y no el `Select` de Base UI
 *
 * Este formulario se manda a una Server Action con `useActionState`. El
 * `<select>` nativo viaja en el `FormData` sin ningún puente, funciona sin
 * JavaScript, y en Android abre la rueda del sistema —que para el público de
 * esta app es más fácil de usar que un menú flotante dibujado por la página—.
 * El `Select` de `components/ui` es el correcto cuando hace falta contenido
 * rico en las opciones; acá las opciones son nombres de personas.
 *
 * ## "Evaluar pendientes" (hotfix de duplicados semánticos)
 *
 * Vive en el mismo panel, ABAJO del interruptor y solo cuando está prendido
 * (`activa`): sin auto-carga encendida no hay compuerta que correr, y la
 * Server Action (`lib/gmail/auto-carga.ts#evaluarPendientesGmail`) lo
 * verifica igual del lado del servidor. Es un `useActionState` PROPIO -no
 * comparte el del interruptor- porque son dos acciones independientes que
 * pueden dispararse por separado, con su propio velo de progreso: la tanda
 * puede tardar (hasta `LIMITE_EVALUAR_PENDIENTES_POR_TANDA` llamadas reales a
 * Gemini), así que "Guardar" del interruptor no se puede quedar esperando a
 * que termine.
 */

import * as React from "react"
import { useActionState } from "react"

import { RefreshCwIcon, SparklesIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { Tarjeta } from "@/components/base/tarjeta"
import { VeloEspera } from "@/components/base/velo-espera"
import { evaluarPendientesGmail, guardarAutoCargaGmail } from "@/app/(app)/(con-nav)/perfil/gmail/actions"
import {
  ESTADO_AUTO_CARGA_INICIAL,
  ESTADO_EVALUAR_PENDIENTES_INICIAL,
  type EstadoAutoCargaGmail,
  type EstadoEvaluarPendientesGmail,
} from "@/lib/gmail/acciones"

export interface PerfilElegibleAutoCarga {
  id: string
  nombre: string
  esPropio: boolean
}

export interface PanelAutoCargaProps {
  activa: boolean
  perfilElegidoId: string | null
  /** "18 de agosto de 2026", ya formateado en el servidor. `null` si está apagada. */
  desdeTexto: string | null
  /** Los perfiles que la cuenta ADMINISTRA (ver `lib/perfiles/administrados.ts`). */
  perfiles: PerfilElegibleAutoCarga[]
}

export function PanelAutoCarga({
  activa,
  perfilElegidoId,
  desdeTexto,
  perfiles,
}: PanelAutoCargaProps) {
  const [estado, guardar, guardando] = useActionState<EstadoAutoCargaGmail, FormData>(
    guardarAutoCargaGmail,
    ESTADO_AUTO_CARGA_INICIAL,
  )

  // "Evaluar pendientes" (hotfix de duplicados semánticos): acción PROPIA,
  // ver el encabezado del archivo. `evaluarPendientesGmail` no necesita nada
  // del FormData -mismo criterio que `desconectarGmail`
  // (`components/gmail/panel-conexion-gmail.tsx`)-, así que el formulario
  // que la dispara no tiene ni un campo.
  const [estadoEvaluar, evaluarPendientes, evaluandoPendientes] = useActionState<
    EstadoEvaluarPendientesGmail,
    FormData
  >(evaluarPendientesGmail, ESTADO_EVALUAR_PENDIENTES_INICIAL)

  /**
   * Estado local del interruptor, para mostrar u ocultar el selector de perfil
   * sin ir al servidor. El valor que MANDA es el del campo oculto del
   * formulario: acá no se decide nada, solo se dibuja.
   *
   * **No hay ninguna lógica para re-sincronizarlo con la prop, y es a
   * propósito.** Quien renderiza este panel le pone una `key` derivada de la
   * configuración guardada (`app/(app)/(con-nav)/perfil/gmail/page.tsx`), así
   * que cuando el servidor confirma un cambio el componente se MONTA DE NUEVO
   * y los dos estados no controlados -este `useState` y el `defaultValue` del
   * `<select>`- se inicializan solos con lo que quedó guardado.
   *
   * Se llegó a esto por un bug encontrado en el Galaxy real: con el estado
   * reconciliado a mano, después de guardar el interruptor quedaba dibujado
   * apagado y el selector volvía a "Elegí un perfil…" aunque la pantalla ya
   * dijera "Está prendida desde el …". El motivo es que `defaultValue` es
   * *uncontrolled*: React lo aplica AL MONTAR y nunca más, así que ninguna
   * cantidad de reconciliación del checkbox iba a arreglar el `<select>`. La
   * `key` resuelve los dos con el mismo gesto, que es la señal de que era el
   * remonte -y no la reconciliación- lo que faltaba.
   */
  const [quiereActiva, setQuiereActiva] = React.useState(activa)

  const sinPerfiles = perfiles.length === 0

  return (
    <Tarjeta className="flex flex-col gap-4 p-5 chica:gap-3 chica:p-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold chica:text-base">
          <SparklesIcon className="size-5 shrink-0 text-primary" aria-hidden="true" />
          Carga automática
        </h2>
        <p className="text-base text-muted-foreground chica:text-sm">
          Solo cuando la inteligencia artificial no tiene ninguna duda. Todo lo demás te lo dejamos
          acá abajo para que lo mires vos.
        </p>
      </div>

      {estado.error && <Alerta variante="error">{estado.error}</Alerta>}
      {!estado.error && estado.mensaje && <Alerta variante="exito">{estado.mensaje}</Alerta>}

      {sinPerfiles ? (
        <Alerta variante="advertencia">
          Para prender la carga automática necesitás administrar al menos un perfil. Los estudios
          que entran solos se tienen que poder sacar de un toque, y para eso hace falta ese permiso.
        </Alerta>
      ) : (
        <form action={guardar} className="flex flex-col gap-4 chica:gap-3">
          {/*
            El campo oculto es el que viaja: el checkbox visible solo mueve el
            estado local. Así el formulario manda "1"/"0" sin depender de la
            semántica de los checkbox no marcados (que directamente no se
            envían).
          */}
          <input type="hidden" name="activar" value={quiereActiva ? "1" : "0"} />

          <label className="flex cursor-pointer items-start gap-3 chica:gap-2">
            <input
              type="checkbox"
              checked={quiereActiva}
              onChange={(evento) => setQuiereActiva(evento.target.checked)}
              className="mt-1 size-6 shrink-0 cursor-pointer accent-primary chica:size-5"
            />
            <span className="flex flex-col gap-1">
              <span className="text-base font-medium chica:text-sm">
                Cargar solos los que se lean sin ninguna duda
              </span>
              <span className="text-sm text-muted-foreground chica:text-xs">
                {activa && desdeTexto
                  ? `Está prendida desde el ${desdeTexto}.`
                  : "Ahora está apagada: todo espera tu revisión."}
              </span>
            </span>
          </label>

          {quiereActiva && (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="perfil-auto-carga"
                className="text-base font-medium chica:text-sm"
              >
                ¿A quién le sumamos lo que entre solo?
              </label>
              <select
                id="perfil-auto-carga"
                name="perfilId"
                defaultValue={perfilElegidoId ?? ""}
                className="h-12 w-full rounded-md border-2 border-input bg-transparent px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 chica:h-11 chica:text-sm"
              >
                <option value="">Elegí un perfil…</option>
                {perfiles.map((perfil) => (
                  <option key={perfil.id} value={perfil.id}>
                    {perfil.nombre}
                    {perfil.esPropio ? " (vos)" : ""}
                  </option>
                ))}
              </select>
              <p className="text-sm text-muted-foreground chica:text-xs">
                Si un correo viene a nombre de otra persona, no se carga solo: te lo dejamos para
                que lo revises.
              </p>
            </div>
          )}

          <Boton type="submit" cargando={guardando} className="w-fit">
            Guardar
          </Boton>
        </form>
      )}

      {activa && (
        <div className="flex flex-col gap-2 border-t border-border pt-4 chica:pt-3">
          <p className="text-sm text-muted-foreground chica:text-xs">
            ¿Prendiste esto con correos que ya estaban esperando? Pasalos por acá.
          </p>

          {estadoEvaluar.error && <Alerta variante="error">{estadoEvaluar.error}</Alerta>}
          {!estadoEvaluar.error && estadoEvaluar.mensaje && (
            <Alerta variante="exito">{estadoEvaluar.mensaje}</Alerta>
          )}

          <form action={evaluarPendientes}>
            <Boton
              type="submit"
              variant="outline"
              cargando={evaluandoPendientes}
              className="w-fit"
            >
              <RefreshCwIcon aria-hidden="true" />
              Evaluar pendientes
            </Boton>
          </form>
        </div>
      )}

      <VeloEspera
        visible={evaluandoPendientes}
        mensaje="Revisando tus correos pendientes…"
        submensaje="Esto puede tardar un momento. No cierres la aplicación."
      />

      <details className="rounded-lg border border-border p-3 chica:p-2">
        <summary className="cursor-pointer text-base font-medium chica:text-sm">
          ¿Qué quiere decir «sin ninguna duda»?
        </summary>
        <div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground chica:mt-1.5 chica:text-xs">
          <p>Un correo entra solo únicamente si se cumple TODO esto:</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>El nombre que figura en el estudio o en el aviso es el del perfil que elegiste.</li>
            <li>Se pudo leer la fecha, y qué tipo de estudio es, y de dónde viene.</li>
            <li>En un turno: día, hora, especialidad y profesional, sin nada supuesto.</li>
            <li>No está repetido con algo que ya tenías cargado.</li>
          </ul>
          <p>
            Si falta una sola de esas cosas, el correo queda esperando en la lista de abajo y te
            decimos por qué. Y todo lo que entre solo lo podés sacar de un toque con «Deshacer».
          </p>
        </div>
      </details>
    </Tarjeta>
  )
}
