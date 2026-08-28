/**
 * `/medicacion/nuevo`: alta de medicación (Sprint 7, tarea 7.2). Exige
 * `can_upload` (`medications_insert_puede_cargar`, `docs/modelo-permisos.md`)
 * — un `can_view` que llegue acá a mano se redirige a `/medicacion` antes de
 * ver el formulario; si igualmente postea la Server Action, `crearMedicacion`
 * vuelve a exigir el permiso (`requerirPermiso`) y RLS es la última palabra.
 *
 * ## Sprint 20 — llegar acá desde una foto de la receta
 *
 * `?doc=<uuid>&med=<índices>&hechos=<n>`: la pantalla de revisión de un
 * documento clasificado como `receta_o_medicacion` manda para acá con los
 * medicamentos que la persona marcó. Esta página lee la extracción de la fila
 * -con el cliente del USUARIO, RLS decide- y precarga el PRIMERO de la cola.
 *
 * **La cola vive entera en la URL**, y eso no es pereza: es lo que hace que
 * cerrar la pantalla en el medio no rompa nada. Lo que ya se guardó quedó
 * guardado; lo que faltaba sigue estando en el documento, que todavía está
 * esperando revisión. Sin sesión, sin `sessionStorage`, sin una tabla de
 * "cargas en curso" que habría que limpiar.
 *
 * **Nada de la receta viaja por la URL**: van un uuid y una lista de
 * posiciones. Los nombres, las dosis y las presentaciones se leen de la base
 * acá adentro (`docs/minimizacion-datos.md`: los datos de salud no van en la
 * barra del navegador).
 *
 * Cualquier parámetro que no cierre -documento inexistente, ya confirmado,
 * índices inventados- se ignora en silencio y la pantalla queda como el alta
 * manual de siempre. Nunca es un error: es una precarga que no se pudo hacer.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { FormularioMedicacion } from "@/components/medicacion/formulario-medicacion"
import { requerirSesion } from "@/lib/auth/guardas"
import { leerExtraccionDeDocumento } from "@/lib/documentos/leer-extraccion"
import { medicamentosDeExtraccion } from "@/lib/documentos/intencion"
import { parsearIndicesMedicamentos } from "@/lib/documentos/ruteo"
import { precargaDesdeMedicamento } from "@/lib/medicacion/desde-documento"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { hoyIsoUshuaia } from "@/lib/turnos/fecha"

export const metadata: Metadata = {
  title: "Nueva medicación — Historial Médico",
}

/** Cuántos medicamentos de la cola ya se cargaron. Solo alimenta una frase de progreso. */
function hechosDesdeParametro(crudo: string | undefined): number {
  if (!crudo || !/^\d{1,2}$/.test(crudo)) return 0
  const cantidad = Number(crudo)
  return cantidad > 0 && cantidad <= 20 ? cantidad : 0
}

export default async function PaginaNuevaMedicacion({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string; med?: string; hechos?: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canUpload) {
    redirect("/medicacion")
  }

  const { doc, med, hechos } = await searchParams

  const { supabase } = await requerirSesion({ desde: "/medicacion/nuevo" })
  const origen = await leerExtraccionDeDocumento(supabase, doc)
  const medicamentos = medicamentosDeExtraccion(origen?.extraccion)

  // Sin `?med=` explícito se toman todos: es el caso de un enlace armado a mano
  // o de un documento con un solo medicamento. Con `?med=` presente pero sin
  // ningún índice válido, la lista queda vacía y no se precarga nada.
  const indices =
    medicamentos.length === 0
      ? []
      : med === undefined
        ? medicamentos.map((_, indice) => indice)
        : parsearIndicesMedicamentos(med, medicamentos.length)

  const [indiceActual, ...pendientes] = indices
  const medicamentoActual = indiceActual === undefined ? null : medicamentos[indiceActual]
  const yaHechos = hechosDesdeParametro(hechos)
  const totalDeLaCola = yaHechos + indices.length

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <Link
        href="/medicacion"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a medicación
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Nueva medicación</h1>
        <p className="text-base text-muted-foreground">
          {medicamentoActual
            ? `Lo leímos del documento que fotografiaste. Revisá los datos de ${activo.perfil.full_name} y completá lo que el papel no decía.`
            : `Cargá los datos de la medicación de ${activo.perfil.full_name}.`}
        </p>
        {medicamentoActual && totalDeLaCola > 1 && (
          <p className="text-sm font-medium text-foreground">
            Medicamento {yaHechos + 1} de {totalDeLaCola}
            {pendientes.length > 0 && " — al guardar seguimos con el siguiente."}
          </p>
        )}
      </div>

      <FormularioMedicacion
        modo="crear"
        valoresIniciales={
          medicamentoActual
            ? precargaDesdeMedicamento(medicamentoActual, { hoyIso: hoyIsoUshuaia() })
            : undefined
        }
        continuacion={
          origen && medicamentoActual
            ? { documentoId: origen.documentoId, pendientes, hechos: yaHechos }
            : undefined
        }
      />
    </div>
  )
}
