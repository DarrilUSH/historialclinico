/**
 * `/sos`: la ficha de emergencia de máxima legibilidad (Sprint 8, tarea
 * 8.3 — ROADMAP_SPRINTS.md). Contrato completo: `docs/modelo-sos.md` §5.
 * La pantalla de EDICIÓN de estos mismos datos es `/perfil/sos` (tarea 8.2)
 * y no vive acá.
 *
 * ## Dos toques desde cualquier pantalla con nav
 *
 * bottom nav → "Inicio" (toque 1) → botón SOS, primero bajo el encabezado
 * (toque 2) → esta pantalla. Ver el comentario de cabecera de
 * `components/inicio/boton-sos.tsx` para por qué NO hay un quinto ítem de
 * nav directo a `/sos`.
 *
 * ## Server Component puro
 *
 * Ni esta página ni `FichaSos` llevan `"use client"`. El único elemento
 * interactivo de toda la pantalla es el `<a href="tel:...">` del contacto de
 * emergencia, y un enlace nativo no necesita hidratación. Esta es,
 * deliberadamente, la ruta con menos JS de toda la app: la tarea 8.4 la va a
 * cachear para que abra completa en modo avión, y cuanto menos JS dependa de
 * cargarse y ejecutarse, más robusta esa cache offline.
 *
 * ## Exactamente las DOS consultas del contrato, ninguna más
 *
 * 1. La ficha entera viaja gratis en `obtenerPerfilActivo()`
 *    (`lib/perfil-activo.ts`): ya trae la fila completa de `profiles`
 *    (`select("*")`, memoizada con `cache()` por request) porque el layout
 *    de `(con-nav)` ya la pidió para el encabezado. Las ocho columnas SOS
 *    están en memoria sin ningún viaje adicional.
 * 2. La cobertura principal (`insurance_cards` con `is_primary = true`) es
 *    la ÚNICA consulta propia de esta pantalla: es el único dato de la
 *    ficha SOS que no vive en `profiles` (`docs/modelo-sos.md` §4.3).
 *
 * Ningún otro fetch: ver "Evitá fetches que no sean del contrato" en el
 * encargo de esta tarea.
 *
 * ## Visible para cualquiera con `view`, sin gate de `canManage`
 *
 * A diferencia de `/perfil/sos` (edición, exige `canManage`), leer la ficha
 * alcanza con `view` -la misma barrera que ya cruzó `obtenerPerfilActivo` al
 * devolver algo distinto de `null`-. No hay chequeo de permiso adicional acá
 * porque no hace falta uno: es lectura, y quien llegó a `/inicio` ya puede
 * leerla.
 */

import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { FichaSos } from "@/components/sos/ficha-sos"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Ficha SOS — Historial Médico",
}

export default async function PaginaSos() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { perfil } = activo

  const { supabase } = await requerirSesion({ desde: "/sos" })

  // Única consulta propia de esta pantalla (ver el encabezado): la
  // cobertura principal no vive en `profiles`, así que no llega gratis con
  // `obtenerPerfilActivo()`.
  const { data: coberturaPrincipal } = await supabase
    .from("insurance_cards")
    .select("id, provider, plan, member_number, front_storage_path, back_storage_path")
    .eq("profile_id", perfil.id)
    .eq("is_primary", true)
    .maybeSingle()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <FichaSos
        perfil={perfil}
        coberturaPrincipal={
          coberturaPrincipal
            ? {
                id: coberturaPrincipal.id,
                provider: coberturaPrincipal.provider,
                plan: coberturaPrincipal.plan,
                member_number: coberturaPrincipal.member_number,
                // Solo si HAY foto: la ficha no debe pintar un `<img>` roto.
                // Los paths no salen de acá -la imagen se pide por la URL
                // estable `/api/credenciales/{id}/imagen`, que revalida
                // permiso-, así que lo único que viaja al componente es si esa
                // cara existe. Ver `docs/offline.md` §4.
                tieneFrente: Boolean(coberturaPrincipal.front_storage_path),
                tieneDorso: Boolean(coberturaPrincipal.back_storage_path),
              }
            : null
        }
      />
    </div>
  )
}
