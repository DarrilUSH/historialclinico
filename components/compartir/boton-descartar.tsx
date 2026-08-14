"use client"

/**
 * Botón "Descartar" de `/compartir` (Sprint 11, tarea 11.2): envuelve
 * `DialogoConfirmacion` con `useActionState(descartarCompartido, ...)`, mismo
 * patrón que el "Cancelar" de `components/documentos/formulario-revision.tsx`
 * con `descartarDocumento`. Vive en un archivo aparte -y no directo en
 * `page.tsx`- porque `useActionState` es un hook de cliente y `page.tsx` es
 * un Server Component (necesita `cookies()` para el guard de sesión).
 */

import { useActionState } from "react"

import { Boton } from "@/components/base/boton"
import { DialogoConfirmacion } from "@/components/base/dialogo-confirmacion"
import { descartarCompartido, type EstadoDescarteCompartido } from "@/app/(app)/(sin-nav)/compartir/actions"

const ESTADO_INICIAL: EstadoDescarteCompartido = { error: null }

export function BotonDescartarCompartido({ archivoId }: { archivoId: string }) {
  const [estado, enviarDescarte] = useActionState(descartarCompartido, ESTADO_INICIAL)

  return (
    <DialogoConfirmacion
      disparador={<Boton variant="outline" size="lg" />}
      titulo="¿Descartar este archivo?"
      consecuencia="Vamos a borrar el archivo que compartiste. No va a quedar guardado en ningún historial, y esta acción no se puede deshacer."
      accion={enviarDescarte}
      camposOcultos={{ archivoId }}
      error={estado.error}
      textoConfirmar="Sí, descartar"
      textoCancelar="Seguir eligiendo perfil"
    >
      Descartar
    </DialogoConfirmacion>
  )
}
