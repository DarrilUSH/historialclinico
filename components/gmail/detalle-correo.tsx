"use client"

/**
 * Diálogo de detalle de un correo de la bandeja de Gmail (ampliación de
 * alcance en vivo, pedido del usuario en producción, 2026-08-18): "Correos
 * que ya revisaste" muestra asunto y remitente RECORTADOS -la densidad chica
 * los trunca con `truncate`- y no había forma de ver el resto. Cada ítem de
 * la bandeja -pendiente o ya revisado- ahora es TOCABLE y abre esta
 * información completa, sin recortar, junto con las acciones que
 * correspondan a su estado.
 *
 * Envuelve `components/ui/dialog.tsx` (Base UI: foco atrapado, Escape, click
 * afuera, todo ya resuelto ahí), igual que `dialogo-confirmacion.tsx`, pero
 * **no** es un diálogo de confirmación: acá no hay nada destructivo que
 * confirmar, es una vista de SOLO LECTURA con accesos directos a las mismas
 * acciones que ya existen en la tarjeta -tocar "Revisar este estudio" desde
 * adentro del diálogo hace exactamente lo mismo que tocarlo en la tarjeta,
 * porque es el MISMO `<form action={...}>`, no una copia-.
 *
 * `DialogTrigger` (Base UI) ya renderiza un `<button>` nativo: envolver el
 * bloque de asunto/remitente/fecha ahí adentro basta para que sea tocable,
 * con piso táctil (`min-h-tactil`) y el asunto COMPLETO como nombre accesible
 * (`aria-label`) -aunque el texto VISIBLE siga truncado por el ancho de la
 * tarjeta-.
 */

import type { ReactNode } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Boton } from "@/components/base/boton"
import {
  CalendarPlusIcon,
  FileTextIcon,
  MailOpenIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"

import type { AdjuntoParaBandeja, CorreoParaBandeja, CorreoProcesadoParaBandeja } from "./bandeja-gmail"

/** Fila etiqueta/valor del cuerpo del diálogo. Mismo patrón en los dos diálogos de este archivo. */
function FilaDetalle({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-sm font-medium text-muted-foreground">{etiqueta}</p>
      <div className="text-base text-foreground">{children}</div>
    </div>
  )
}

function ListaAdjuntos({ adjuntos }: { adjuntos: AdjuntoParaBandeja[] }) {
  if (adjuntos.length === 0) return <p className="text-base text-muted-foreground">Sin adjuntos.</p>

  return (
    <ul className="flex flex-col gap-1.5">
      {adjuntos.map((adjunto) => (
        <li key={adjunto.id} className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <FileTextIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="break-all">{adjunto.nombre}</span>
            <span className="shrink-0 text-muted-foreground">({adjunto.tamanoTexto})</span>
          </span>
          {!adjunto.apto && adjunto.motivoTexto && (
            <span className="pl-6 text-sm text-muted-foreground">{adjunto.motivoTexto}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

export interface DialogoDetallePendienteProps {
  correo: CorreoParaBandeja
  puedeCargar: boolean
  accionIngerir: (formData: FormData) => void
  accionDescartar: (formData: FormData) => void
  accionAprender: (formData: FormData) => void
}

/** Detalle de un correo PENDIENTE: qué trae adentro y las mismas acciones que la tarjeta. */
export function DialogoDetallePendiente({
  correo,
  puedeCargar,
  accionIngerir,
  accionDescartar,
  accionAprender,
}: DialogoDetallePendienteProps) {
  const aptos = correo.adjuntos.filter((adjunto) => adjunto.apto)

  return (
    <Dialog>
      <DialogTrigger
        className="min-h-tactil w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Ver el detalle completo del correo: ${correo.asunto}, de ${correo.remitente}`}
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-base font-semibold chica:text-sm">{correo.asunto}</span>
          <span className="text-sm text-muted-foreground chica:text-xs">
            <span className="break-all">{correo.remitente}</span> · {correo.fechaTexto}
          </span>
        </span>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{correo.asunto}</DialogTitle>
          <DialogDescription>Todavía esperando revisión.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <FilaDetalle etiqueta="Remitente">
            <span className="break-all">{correo.remitente}</span>
            {correo.remitente !== correo.remitenteEmail && (
              <span className="block break-all text-sm text-muted-foreground">
                {correo.remitenteEmail}
              </span>
            )}
          </FilaDetalle>

          <FilaDetalle etiqueta="Fecha">{correo.fechaTexto}</FilaDetalle>

          <FilaDetalle etiqueta="Qué contenía">
            <ListaAdjuntos adjuntos={correo.adjuntos} />
            {correo.pareceTurno && (
              <p className="mt-2 text-base">Además, el texto tiene pinta de aviso de turno.</p>
            )}
          </FilaDetalle>
        </div>

        <DialogFooter showCloseButton>
          {puedeCargar &&
            aptos.map((adjunto) => (
              <form key={adjunto.id} action={accionIngerir}>
                <input type="hidden" name="correoId" value={correo.id} />
                <input type="hidden" name="adjuntoId" value={adjunto.id} />
                <Boton type="submit" size="lg" className="w-full sm:w-auto">
                  <MailOpenIcon aria-hidden="true" />
                  Revisar {aptos.length > 1 ? adjunto.nombre : "este estudio"}
                </Boton>
              </form>
            ))}

          {correo.pareceTurno && puedeCargar && (
            <Boton
              render={<a href={`/turnos/nuevo?gmail=${correo.id}`} />}
              nativeButton={false}
              variant="outline"
              size="lg"
              className="w-full sm:w-auto"
            >
              <CalendarPlusIcon aria-hidden="true" />
              Revisar este turno
            </Boton>
          )}

          {!correo.tieneFiltro && (
            <form action={accionAprender}>
              <input type="hidden" name="correoId" value={correo.id} />
              <Boton type="submit" variant="outline" size="lg" className="w-full sm:w-auto">
                <RefreshCwIcon aria-hidden="true" />
                Traer solos los de {correo.remitenteEmail}
              </Boton>
            </form>
          )}

          <form action={accionDescartar}>
            <input type="hidden" name="correoId" value={correo.id} />
            <Boton type="submit" variant="outline" size="lg" className="w-full sm:w-auto">
              <Trash2Icon aria-hidden="true" />
              No me sirve
            </Boton>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface DialogoDetalleProcesadoProps {
  correo: CorreoProcesadoParaBandeja
  accionReabrir: (formData: FormData) => void
}

/** Detalle de un correo YA REVISADO: qué traía, qué se hizo, y el link a lo que produjo. */
export function DialogoDetalleProcesado({ correo, accionReabrir }: DialogoDetalleProcesadoProps) {
  return (
    <Dialog>
      <DialogTrigger
        className="min-h-tactil flex min-w-0 flex-1 flex-col rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Ver el detalle completo del correo: ${correo.asunto}, de ${correo.remitente}, ${correo.destinoTexto}`}
      >
        <span className="truncate text-base font-medium chica:text-sm">{correo.asunto}</span>
        <span className="truncate text-sm text-muted-foreground chica:text-xs">
          {correo.remitente} · {correo.fechaTexto} · {correo.destinoTexto}
        </span>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{correo.asunto}</DialogTitle>
          <DialogDescription>{correo.destinoTexto}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <FilaDetalle etiqueta="Remitente">
            <span className="break-all">{correo.remitente}</span>
            {correo.remitente !== correo.remitenteEmail && (
              <span className="block break-all text-sm text-muted-foreground">
                {correo.remitenteEmail}
              </span>
            )}
          </FilaDetalle>

          <FilaDetalle etiqueta="Fecha">{correo.fechaTexto}</FilaDetalle>

          <FilaDetalle etiqueta="Qué contenía">
            <ListaAdjuntos adjuntos={correo.adjuntos} />
            {correo.pareceTurno && (
              <p className="mt-2 text-base">Además, el texto tenía pinta de aviso de turno.</p>
            )}
          </FilaDetalle>

          <FilaDetalle etiqueta="Qué se hizo">{correo.destinoTexto}</FilaDetalle>
        </div>

        <DialogFooter showCloseButton>
          {correo.documentoId && (
            <Boton
              render={<a href={`/estudios/${correo.documentoId}`} />}
              nativeButton={false}
              size="lg"
              className="w-full sm:w-auto"
            >
              Ver el estudio
            </Boton>
          )}
          {correo.appointmentId && (
            <Boton
              render={<a href={`/turnos/${correo.appointmentId}/editar`} />}
              nativeButton={false}
              size="lg"
              className="w-full sm:w-auto"
            >
              Ver el turno
            </Boton>
          )}
          {correo.puedeReabrir && (
            <form action={accionReabrir}>
              <input type="hidden" name="correoId" value={correo.id} />
              <Boton type="submit" variant="outline" size="lg" className="w-full sm:w-auto">
                <RotateCcwIcon aria-hidden="true" />
                Volver a la lista
              </Boton>
            </form>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
