/**
 * Vista "Próximo turno" en la home (Sprint 6, tarea 6.3 — ROADMAP_SPRINTS.md).
 *
 * Bloque destacado que muestra el turno más próximo del perfil activo que NO
 * esté cancelado, o un estado vacío si no hay turnos futuros.
 *
 * Server Component: obtiene el perfil activo + el próximo turno desde la base,
 * aplica RLS automáticamente (vía el cliente server-side con la sesión actual).
 *
 * Si hay turno:
 *   - Reutiliza `TarjetaTurno` completa con todas las acciones de logística
 *   - Muestra link "Ver todos los turnos" → /turnos
 *
 * Si NO hay turno:
 *   - Tarjeta sobria con "No tenés turnos programados"
 *   - Botón "Agendar turno" → /turnos/nuevo (solo si can_upload)
 *   - Link "Ver todos los turnos" igual (para turnos pasados)
 *
 * Posicionamiento en la jerarquía de /inicio:
 *   1. Saludo del perfil ("Estás viendo...")
 *   2. Este bloque (Próximo turno)
 *   3. Banner de notificaciones
 *   4. Otros bloques futuros
 */

import Link from "next/link"
import { CalendarIcon, PlusIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { Tarjeta } from "@/components/base/tarjeta"
import { TarjetaTurno } from "@/components/turnos/tarjeta-turno"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { obtenerProximoTurno } from "@/lib/turnos/obtener-proximo"
import { createClient } from "@/lib/supabase/server"

export async function ProximoTurno() {
  // Obtener perfil activo con permisos
  const activo = await obtenerPerfilActivo()
  if (!activo) {
    // No debería ocurrir acá (el layout ya lo valida), pero si llega sin perfil,
    // el componente se renderiza silenciosamente vacío
    return null
  }

  const { perfil, permisos } = activo

  // Cliente server-side: usa la sesión actual, aplica RLS automáticamente
  const supabase = await createClient()

  // Obtener próximo turno
  let proximoTurno = null
  try {
    proximoTurno = await obtenerProximoTurno(supabase, perfil.id)
  } catch (error) {
    console.error("[ProximoTurno] Fallo al obtener próximo turno:", error)
    // En caso de error, seguir sin mostrar turno (graceful degradation)
  }

  return (
    <div className="w-full space-y-3">
      {/* Con turno */}
      {proximoTurno ? (
        <>
          <TarjetaTurno
            turno={proximoTurno}
            puedeEditar={permisos.canManage || permisos.esPropio}
          />
          <div className="flex justify-center">
            <Boton
              render={<Link href="/turnos" />}
              nativeButton={false}
              variant="ghost"
              size="sm"
              className="text-primary"
            >
              Ver todos los turnos
            </Boton>
          </div>
        </>
      ) : (
        /* Sin turno */
        <>
          <Tarjeta className="flex flex-col items-center gap-4 px-(--card-spacing) py-8 text-center chica:gap-3 chica:py-6">
            <CalendarIcon className="size-12 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-lg font-semibold text-foreground">No tenés turnos programados</p>
              <p className="text-sm text-muted-foreground">
                Cargá un nuevo turno o revisá los turnos pasados.
              </p>
            </div>

            {/* Botón "Agendar turno" solo si can_upload */}
            {permisos.canUpload && (
              <Boton render={<Link href="/turnos/nuevo" />} nativeButton={false}>
                <PlusIcon className="size-4" aria-hidden="true" />
                Agendar turno
              </Boton>
            )}
          </Tarjeta>

          <div className="flex justify-center">
            <Boton
              render={<Link href="/turnos" />}
              nativeButton={false}
              variant="ghost"
              size="sm"
              className="text-primary"
            >
              Ver todos los turnos
            </Boton>
          </div>
        </>
      )}
    </div>
  )
}
