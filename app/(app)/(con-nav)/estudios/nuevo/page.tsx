/**
 * `/estudios/nuevo`: página provisoria del Sprint 4 que monta el cargador de
 * documentos (`components/documentos/cargador-documento.tsx`). No reemplaza
 * nada -`/estudios` sigue siendo el stub del Sprint 3-, solo le agrega la
 * puerta de entrada "Subir estudio" que lleva acá.
 *
 * El pipeline real de subida (Server Action a Storage privado, extracción con
 * Gemini, revisión y persistencia de métricas) llega en las tareas
 * siguientes del Sprint 4 (ROADMAP_SPRINTS.md). Por ahora, confirmar un
 * archivo en el cargador solo muestra "Listo para subir: …".
 *
 * Mismo patrón que `/inicio`, `/familia`, `/estudios` y `/turnos`: revalida
 * `obtenerPerfilActivo()` y redirige si no hay perfil activo válido, aunque
 * el layout ya lo hizo (memoizado con `cache()`, sin costo extra de red).
 */

import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { obtenerPerfilActivo } from "@/lib/perfil-activo"

import { PantallaNuevoEstudio } from "./pantalla-carga"

export const metadata: Metadata = {
  title: "Subir estudio — Historial Médico",
}

export default async function PaginaNuevoEstudio() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  return <PantallaNuevoEstudio />
}
