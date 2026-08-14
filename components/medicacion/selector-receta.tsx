"use client"

/**
 * Selector de receta para edición de medicación (Sprint 7, tarea 7.5).
 * Muestra la receta asociada si existe, o un Select para elegir una entre
 * los documentos confirmados categoría `prescription` del perfil activo.
 * Si no hay recetas cargadas, muestra un texto explicativo.
 */

import * as React from "react"
import { useActionState } from "react"
import Link from "next/link"

import { XIcon } from "lucide-react"

import {
  asociarReceta,
  desasociarReceta,
} from "@/app/(app)/(con-nav)/medicacion/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { DialogoConfirmacion } from "@/components/base/dialogo-confirmacion"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type DocumentoReceta = {
  id: string
  title: string
}

export function SelectorReceta({
  medicacionId,
  recetaActualId,
  recetaActualTitulo,
  recetasDisponibles,
}: {
  medicacionId: string
  recetaActualId: string | null
  recetaActualTitulo: string | null
  recetasDisponibles: DocumentoReceta[]
}) {
  const [estadoAsociar, asociarAction] = useActionState(asociarReceta, { error: null })
  const [estadoDesasociar, desasociarAction] = useActionState(desasociarReceta, { error: null })
  const [recetaSeleccionada, setRecetaSeleccionada] = React.useState<string | null>(null)

  const manejarDesasociar = (formData: FormData) => {
    desasociarAction(formData)
  }

  // El Select de Base UI necesita `items` para renderizar el LABEL en el
  // trigger; sin esto mostraría el value crudo (acá, un uuid) al seleccionar.
  const itemsRecetas = recetasDisponibles.map((receta) => ({
    value: receta.id,
    label: receta.title,
  }))
  const error = estadoAsociar.error ?? estadoDesasociar.error

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 chica:gap-2 chica:p-3">
      <Label className="text-base font-semibold">Receta asociada</Label>

      {error && <Alerta variante="error">{error}</Alerta>}

      {recetaActualId ? (
        /* Receta ya asociada: muestra título + botón "Quitar" */
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between rounded-lg bg-background p-3 chica:p-2.5">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">{recetaActualTitulo}</p>
              <Link
                href={`/estudios/${recetaActualId}`}
                className="w-fit text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Ver receta
              </Link>
            </div>
            <DialogoConfirmacion
              titulo="Quitar receta"
              consecuencia="La receta se desvinculará de esta medicación, pero el documento seguirá guardado en tu historial."
              textoConfirmar="Quitar"
              disparador={
                <Boton
                  size="sm"
                  variant="ghost"
                  aria-label="Quitar receta"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <XIcon className="size-4" aria-hidden="true" />
                </Boton>
              }
              accion={manejarDesasociar}
            >
              <input type="hidden" name="medicacionId" value={medicacionId} />
            </DialogoConfirmacion>
          </div>
        </div>
      ) : recetasDisponibles.length > 0 ? (
        /* Sin receta actual, pero hay recetas disponibles: Select + botón "Asociar" */
        <div className="flex flex-col gap-2">
          <Select
            items={itemsRecetas}
            value={recetaSeleccionada ?? undefined}
            onValueChange={setRecetaSeleccionada}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Elegí una receta cargada" />
            </SelectTrigger>
            <SelectContent>
              {recetasDisponibles.map((receta) => (
                <SelectItem key={receta.id} value={receta.id}>
                  {receta.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <form action={asociarAction} className="flex gap-2">
            <input type="hidden" name="medicacionId" value={medicacionId} />
            <input type="hidden" name="recetaId" value={recetaSeleccionada ?? ""} />
            <Boton
              type="submit"
              size="sm"
              disabled={!recetaSeleccionada}
              className="flex-1"
            >
              Asociar
            </Boton>
          </form>
        </div>
      ) : (
        /* Sin receta actual ni disponibles: texto explicativo */
        <Alerta variante="info" estatica className="text-sm">
          Todavía no hay recetas cargadas. Cargá una primero desde{" "}
          <Link href="/estudios" className="font-medium underline hover:no-underline">
            Estudios
          </Link>
          .
        </Alerta>
      )}
    </div>
  )
}
